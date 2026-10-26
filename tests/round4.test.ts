import { describe, expect, it } from 'vitest';
import { defaultData } from '../src/data/index';
import { applyChoice, applyEffects, eventProb, isEligible } from '../src/engine/events';
import { calcIncome } from '../src/engine/money';
import { createRng } from '../src/engine/rng';
import { getMonthlyView, stepMonth } from '../src/engine/step';
import type { EventDef } from '../src/engine/types';
import { flatRng, makeState, setAge } from './helpers';

const byId = (id: string): EventDef => defaultData.events.find((e) => e.id === id)!;

describe('恋人から結婚まで', () => {
  it('付き合い始めた月を覚え、1年目はプロポーズが起きにくく、3年を過ぎると起きやすい', () => {
    const s = setAge(makeState(), 28);
    s.month = 100;
    applyEffects(s, { setFlags: { partner: true } }, flatRng);
    expect(s.flags.partnerSince).toBe(100);
    const ev = byId('proposal');
    s.month = 106;
    const first = eventProb(ev, s);
    s.month = 100 + 30;
    const third = eventProb(ev, s);
    s.month = 100 + 48;
    const fifth = eventProb(ev, s);
    expect(first).toBeLessThan(third / 3);
    expect(fifth).toBeGreaterThan(third * 1.5);
  });
});

describe('結婚式ラッシュ', () => {
  it('人間関係が40未満なら1件、40〜70なら3件、70を超えると5件の招待', () => {
    const s = setAge(makeState(), 28);
    const which = () => ['wedding_rush_few', 'wedding_rush', 'wedding_rush_many'].filter((id) => eventProb(byId(id), s) > 0);
    s.stats.relations = 30;
    expect(which()).toEqual(['wedding_rush_few']);
    s.stats.relations = 55;
    expect(which()).toEqual(['wedding_rush']);
    s.stats.relations = 80;
    expect(which()).toEqual(['wedding_rush_many']);
    expect(byId('wedding_rush_many').text).toContain('5通');
    applyChoice(s, byId('wedding_rush_many'), 0, flatRng);
    expect(s.assets.cash).toBe(-250_000);
  });
});

describe('同窓会', () => {
  it('30・40・50・60・70歳の前後(±1歳)だけ', () => {
    const ev = byId('reunion');
    for (const age of [29, 30, 31, 40, 50, 60, 70]) expect(isEligible(ev, setAge(makeState(), age))).toBe(true);
    for (const age of [25, 28, 32, 35, 45, 55, 66, 75]) expect(isEligible(ev, setAge(makeState(), age))).toBe(false);
  });
});

describe('支出の方針で変わる出費', () => {
  it('買い物・旅行などは、節約0.6倍・普通1倍・ゆとり1.3倍・浪費1.8倍。ログの money に使った額が出る', () => {
    const cost = (spending: 'frugal' | 'normal' | 'comfort' | 'lavish') => {
      const s = setAge(makeState({ initialCash: 1_000_000 }, { spending }), 30); // 貯金があるのでローンにならない
      applyChoice(s, byId('travel'), 0, flatRng);
      return { cash: s.assets.cash - 1_000_000, log: s.log.at(-1)! };
    };
    expect(cost('frugal').cash).toBe(-240_000);
    expect(cost('normal').cash).toBe(-400_000);
    expect(cost('lavish').cash).toBe(-720_000);
    expect(cost('lavish').log).toMatchObject({ text: '旅行のチャンス: 「海外旅行に行く」', money: -720_000 });
  });

  it('出費のない選択肢や、方針で変わらないイベントはそのまま', () => {
    const s = setAge(makeState({}, { spending: 'lavish' }), 30);
    applyChoice(s, byId('appliance'), 0, flatRng);
    expect(s.assets.cash).toBe(-150_000);
    const t = setAge(makeState({}, { spending: 'lavish' }), 30);
    applyChoice(t, byId('travel'), 2, flatRng);
    expect(t.assets.cash).toBe(0);
    expect(t.log.at(-1)!.text).toBe('旅行のチャンス: 「家でゆっくりする」');
  });
});

describe('バイトには定年がない', () => {
  function at65(job: 'parttime' | 'sales') {
    let s = setAge(makeState({ job }), 65);
    s.ageMonths = 65 * 12 - 1;
    s.character.lastMonthlyPay = 160_000;
    s = stepMonth(s, createRng(1));
    delete s.pendingEvent;
    return s;
  }

  it('65歳で年金をもらい始め、バイトは同じ給料のまま続ける(定年退職のログは出ない)', () => {
    const s = at65('parttime');
    expect(s.log.some((e) => e.id === 'retirement')).toBe(false);
    expect(s.log.some((e) => e.id === 'pension_start')).toBe(true);
    expect(s.flags.rehire).toBe(59); // 65歳の月の分はもう受け取った(60ヶ月働く)
    const inc = calcIncome(s);
    expect(inc.salary).toBe(Math.round(160_000 * 0.8));
    expect(inc.pension).toBeGreaterThan(0);
    expect(getMonthlyView(s).jobLabel).toBe('バイト(年金あり)');
    expect(isEligible(byId('rehire_offer'), s)).toBe(false);
  });

  it('70歳で引退し、ログに残る。会社員は今までどおり定年退職', () => {
    let s = at65('parttime');
    s.flags.rehire = 1;
    s = stepMonth(s, createRng(2));
    expect(s.flags.rehire).toBe(0);
    expect(s.log.some((e) => e.id === 'work_end')).toBe(true);
    expect(calcIncome(s).salary).toBe(0);
    expect(at65('sales').log.some((e) => e.id === 'retirement')).toBe(true);
  });
});

describe('昇進は55歳まで', () => {
  it('役職定年(55歳)を過ぎると昇進の話は来ない', () => {
    const ev = byId('promotion');
    expect(eventProb(ev, setAge(makeState({ job: 'sales' }), 54))).toBeGreaterThan(0);
    expect(eventProb(ev, setAge(makeState({ job: 'sales' }), 56))).toBe(0);
  });
});

describe('ログのお金の増減', () => {
  it('イベントや選択でお金が動いたら、ログに純資産の増減が付く(動かなければ付かない)', () => {
    const s = setAge(makeState({ initialCash: 1_000_000 }), 30);
    applyChoice(s, byId('travel'), 0, flatRng);
    expect(s.log.at(-1)!.money).toBe(-400_000);
    applyChoice(s, byId('travel'), 2, flatRng);
    expect(s.log.at(-1)!.money).toBeUndefined();
  });
});
