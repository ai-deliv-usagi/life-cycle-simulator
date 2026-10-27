import { describe, expect, it } from 'vitest';
import { applyMonthlyMoney, monthlyGrossPay } from '../src/engine/money';
import { defaultData } from '../src/data/index';
import { applyChoice, applyEffects, availableChoices, eventProb, isEligible } from '../src/engine/events';
import { illnessDeathProb, karoshiProb, monthlyDeathProb, rollDeath } from '../src/engine/death';
import { createRng } from '../src/engine/rng';
import { getMonthlyView, isYearEnd, resolveChoice, stepMonth } from '../src/engine/step';
import { updateStats } from '../src/engine/stats';
import { computeResult } from '../src/engine/result';
import type { Rng } from '../src/engine/rng';
import type { EventDef } from '../src/engine/types';
import { flatRng, makeState, setAge } from './helpers';

const byId = (id: string): EventDef => defaultData.events.find((e) => e.id === id)!;
const labels = (ev: EventDef, s: ReturnType<typeof makeState>) => availableChoices(ev, s).map((c) => c.choice.label);

describe('大きな出費は自動でローン', () => {
  it('貯金と投資で足りない分を1万円単位でローンにする(30万円以上の出費だけ)', () => {
    const s = makeState();
    s.assets.cash = 500_000;
    s.assets.index = 200_000;
    s.invested!.index = 200_000; // 損益なし(税金がかからない)
    applyEffects(s, { cash: -2_500_000 }, flatRng);
    expect(s.assets.loan).toBe(1_800_000);
    // 残りは積立をその場で取り崩して払う(預金がマイナスのまま残らない)
    expect(s.assets.cash).toBe(0);
    expect(s.assets.index).toBe(0);
    expect(s.log.some((e) => e.id === 'auto_loan')).toBe(true);
    expect(s.log.at(-1)).toMatchObject({ id: 'forced_sale' });
    // 臨時の出費は自分で払った分だけ。ローンにした分は毎月の返済として支出に入る
    expect(s.ledger!.eventOut).toBe(700_000);
    expect(s.ledger!.eventIn).toBe(0);

    const small = makeState();
    applyEffects(small, { cash: -200_000 }, flatRng);
    expect(small.assets.loan ?? 0).toBe(0);
    expect(small.assets.cash).toBe(-200_000);
  });

  it('審査に落ちたらローンにならない(月末に投資を売り、足りなければカードローン)', () => {
    const s = makeState();
    s.stats.credit = 10;
    applyEffects(s, { cash: -1_000_000 }, flatRng);
    expect(s.assets.loan ?? 0).toBe(0);
    expect(s.assets.cash).toBe(-1_000_000);
  });

  it('リボ払いは現金を動かさずカードローンの借金になる。金額は支出の方針で変わる(浪費は1.6倍)', () => {
    const s = makeState({}, { spending: 'lavish' });
    applyChoice(s, byId('revolving'), 0, flatRng);
    expect(s.assets.debt).toBe(640_000);
    expect(s.assets.cash).toBe(0);
    expect(s.log.at(-1)).toMatchObject({ text: 'リボ払いの誘い: 「リボ払いで欲しいものを買う」', money: -640_000 });
    const t = makeState({}, { spending: 'comfort' });
    applyChoice(t, byId('revolving'), 0, flatRng);
    expect(t.assets.debt).toBe(520_000);
  });
});

describe('大病', () => {
  it('治療するかを選べる。治療しないと死亡リスクの高い状態が3年続く', () => {
    const ev = byId('serious_illness');
    expect(labels(ev, makeState())).toEqual(['治療に専念する', '治療しない']);
    const s = setAge(makeState(), 60);
    const base = monthlyDeathProb(s);
    applyChoice(s, ev, 1, flatRng);
    expect(s.flags.illnessUntreated).toBe(36);
    expect(illnessDeathProb(s)).toBeCloseTo(0.012);
    expect(illnessDeathProb(s)).toBeGreaterThan(base * 10);

    const t = setAge(makeState(), 60);
    applyChoice(t, ev, 0, flatRng);
    expect(t.flags.illnessTreated).toBe(12);
    expect(illnessDeathProb(t)).toBeLessThan(illnessDeathProb(s) / 5);
  });

  it('治療しないと健康が毎月少しずつ下がり、亡くなれば死因は病気', () => {
    const s = setAge(makeState(), 60);
    const t = setAge(makeState(), 60);
    s.flags.illnessUntreated = 36;
    updateStats(s);
    updateStats(t);
    expect(s.stats.health).toBeLessThan(t.stats.health);
    const always: Rng = { ...flatRng, chance: () => true };
    expect(rollDeath(s, always)).toBe('illness');
  });

  it('タイマーが切れたら(36ヶ月生き延びたら)リスクは元に戻る', () => {
    let s = setAge(makeState(), 60);
    s.flags.illnessUntreated = 1;
    s = stepMonth(s, createRng(1));
    expect(illnessDeathProb(s)).toBe(0);
  });

  it('再検査を放置すると5年間は大病が3倍起きやすい', () => {
    const s = setAge(makeState(), 50);
    const ev = byId('serious_illness');
    const before = eventProb(ev, s);
    applyChoice(s, byId('checkup'), 1, flatRng);
    expect(s.flags.checkupNeglect).toBe(60);
    expect(eventProb(ev, s)).toBeCloseTo(before * 3);
  });
});

describe('免許返納', () => {
  it('70歳以上で車があると起き、返納すると車を手放す', () => {
    const ev = byId('license_return');
    expect(isEligible(ev, setAge(makeState({ hasCar: true }), 69))).toBe(false);
    const s = setAge(makeState({ hasCar: true }), 72);
    expect(isEligible(ev, s)).toBe(true);
    applyChoice(s, ev, 0, flatRng);
    expect(s.flags.hasCar).toBe(false);
  });

  it('運転を続けると交通事故と高齢ドライバーの事故が起きやすくなる', () => {
    const s = setAge(makeState({ hasCar: true }), 72);
    const accident = eventProb(byId('traffic_accident'), s);
    const crash = eventProb(byId('elderly_crash'), s);
    applyChoice(s, byId('license_return'), 1, flatRng);
    expect(eventProb(byId('traffic_accident'), s)).toBeCloseTo(accident * 2);
    expect(eventProb(byId('elderly_crash'), s)).toBeCloseTo(crash * 2);
  });
});

describe('小さな直し', () => {
  it('中古車もローンで買える', () => {
    const s = makeState();
    expect(labels(byId('car_purchase'), s)).toContain('中古車をローンで買う');
  });

  it('アルバイトには上司とのトラブルではなく店長とのトラブルが起きる', () => {
    const part = makeState({ job: 'parttime' });
    const office = makeState({ job: 'office' });
    expect(isEligible(byId('boss_trouble'), part)).toBe(false);
    expect(isEligible(byId('shop_trouble'), part)).toBe(true);
    expect(isEligible(byId('shop_trouble'), office)).toBe(false);
  });

  it('結婚式ラッシュは件数がわかる', () => {
    expect(byId('wedding_rush').text).toContain('3通');
  });
});

describe('方針で起きやすさが変わるイベント', () => {
  it('激務ほど過労・燃え尽きが起きやすく、恋人ができにくい', () => {
    for (const id of ['overwork_collapse', 'burnout']) {
      const grind = eventProb(byId(id), makeState({}, { work: 'grind' }));
      const regular = eventProb(byId(id), makeState({}, { work: 'regular' }));
      expect(grind).toBeGreaterThan(regular * 5);
    }
    const p = byId('partner');
    expect(eventProb(p, makeState({}, { work: 'grind' }))).toBeLessThan(eventProb(p, makeState({}, { work: 'regular' })) / 2);
  });

  it('浪費だと衝動買い・リボの誘いが多く、節約だと付き合いが悪いと言われる', () => {
    const lavish = makeState({}, { spending: 'lavish' });
    const frugal = makeState({}, { spending: 'frugal' });
    expect(eventProb(byId('impulse_buy'), lavish)).toBeGreaterThan(eventProb(byId('impulse_buy'), frugal) * 10);
    expect(eventProb(byId('revolving'), frugal)).toBe(0);
    expect(eventProb(byId('frugal_stingy'), lavish)).toBe(0);
    expect(eventProb(byId('frugal_stingy'), frugal)).toBeGreaterThan(0);
  });

  it('健康意識高めだとマラソン・早期発見、気にしないと生活習慣病', () => {
    const active = setAge(makeState({}, { health: 'active' }), 50);
    const ignore = setAge(makeState({}, { health: 'ignore' }), 50);
    expect(eventProb(byId('marathon'), ignore)).toBe(0);
    expect(eventProb(byId('early_detection'), ignore)).toBe(0);
    expect(eventProb(byId('marathon'), active)).toBeGreaterThan(0);
    expect(eventProb(byId('lifestyle_disease'), ignore)).toBeGreaterThan(eventProb(byId('lifestyle_disease'), active) * 10);
  });
});

describe('収入の内訳と資産の内訳', () => {
  it('画面用の値に今月の収入の内訳が入る', () => {
    const v = getMonthlyView(makeState({ job: 'engineer' }));
    expect(v.income.total).toBe(v.householdNet);
    expect(v.income.salary).toBeGreaterThan(0);
  });

  it('年間サマリーのログに年末の金融資産の内訳が残り、リザルトにも渡る', () => {
    let s = makeState({}, { invest: 'index' });
    const rng = createRng(3);
    for (let i = 0; i < 24 && !s.dead; i++) {
      s = stepMonth(s, rng);
      delete s.pendingEvent;
    }
    const summaries = s.log.filter((e) => e.type === 'year_summary');
    expect(summaries).toHaveLength(2);
    const last = summaries.at(-1)!;
    expect(last.assets).toEqual({ cash: s.assets.cash, index: s.assets.index, stocks: s.assets.stocks, speculative: s.assets.speculative });
    s.dead = { cause: 'illness', ageMonths: s.ageMonths };
    expect(computeResult(s).yearly[0]!.assets).toEqual(summaries[0]!.assets);
  });
});

describe('年の切れ目の月に起きた選択イベント', () => {
  it('お金の出入りは締めたばかりの年の収支に入る', () => {
    let s = makeState();
    s.assets.cash = 1_000_000;
    const rng = createRng(1);
    for (let i = 0; i < 11; i++) {
      s = stepMonth(s, rng);
      delete s.pendingEvent;
    }
    s = stepMonth(s, rng);
    delete s.pendingEvent;
    expect(isYearEnd(s)).toBe(true);
    const ev = byId('appliance');
    s.eventHistory[ev.id] = { count: 1, lastMonth: s.month };
    s.pendingEvent = { eventId: ev.id, month: s.month };
    const before = s.lastLedger!.eventOut;
    s = resolveChoice(s, 0, rng);
    // 家電の値段は揺れる(0.7〜1.5倍)
    expect(s.lastLedger!.eventOut - before).toBeGreaterThanOrEqual(105_000);
    expect(s.lastLedger!.eventOut - before).toBeLessThanOrEqual(225_000);
    expect(s.ledger!.eventOut).toBe(0);
  });
});

describe('若くても過労死', () => {
  it('激務でストレスが高いと、年齢に関係なく過労死のリスクがある', () => {
    const s = setAge(makeState({}, { work: 'grind' }), 28);
    s.stats.stress = 60;
    expect(karoshiProb(s)).toBe(0);
    s.stats.stress = 80;
    expect(karoshiProb(s)).toBeCloseTo(0.00015);
    expect(karoshiProb(s)).toBeGreaterThan(monthlyDeathProb(s));
    const always: Rng = { ...flatRng, chance: () => true, next: () => 0 };
    expect(rollDeath(s, always)).toBe('overwork');
    s.policy.work = 'regular';
    expect(karoshiProb(s)).toBe(0);
  });
});

describe('お金がないと起きない詐欺', () => {
  it('オレオレ詐欺は200万円、投資詐欺は100万円の金融資産がないと起きない。貸すのは50万円あるときだけ', () => {
    const poor = setAge(makeState(), 75);
    const rich = setAge(makeState(), 75);
    rich.assets.index = 3_000_000;
    expect(isEligible(byId('ore_ore'), poor)).toBe(false);
    expect(isEligible(byId('ore_ore'), rich)).toBe(true);
    expect(isEligible(byId('scam'), poor)).toBe(false);
    expect(isEligible(byId('scam'), rich)).toBe(true);
    expect(labels(byId('friend_loan'), poor)).toEqual(['断る']);
    expect(labels(byId('friend_loan'), rich)).toEqual(['貸す', '断る']);
  });
});

describe('カードローン(リボ)の毎月の返済', () => {
  it('毎月、残高の3%(最低1万円)を預金から返す。赤字でも預金があれば減っていく', () => {
    const s = setAge(makeState({ job: 'office' }, { spending: 'lavish' }), 30);
    s.assets.cash = 1_000_000;
    s.assets.debt = 400_000;
    applyMonthlyMoney(s, flatRng);
    // 利息 5,000円 → 405,000円の3% = 12,150円を返す
    expect(s.assets.debt).toBeLessThanOrEqual(405_000 - 12_150);
    for (let i = 0; i < 23; i++) applyMonthlyMoney(s, flatRng);
    expect(s.assets.debt).toBeLessThan(300_000);
  });

  it('残高が少なければ最低1万円、残りがそれ以下なら残りを全部返す', () => {
    const s = makeState();
    s.assets.cash = 1_000_000;
    s.assets.debt = 8_000;
    applyMonthlyMoney(s, flatRng);
    expect(s.assets.debt).toBe(0);
  });

  it('繰上げ返済の方針なら、預金で一括で返す', () => {
    const s = makeState({}, { prepay: true });
    s.assets.cash = 1_000_000;
    s.assets.debt = 400_000;
    applyMonthlyMoney(s, flatRng);
    expect(s.assets.debt).toBe(0);
  });
});

describe('給料', () => {
  it('バイトは年収180万〜200万円でほとんど上がらず、月の額面は15万円前後', () => {
    const s = setAge(makeState({ job: 'parttime' }), 22);
    s.stats.skill = 50;
    expect(monthlyGrossPay(s)).toBe(150_000);
    expect(monthlyGrossPay(setAge(s, 50))).toBeLessThan(170_000);
  });
});
