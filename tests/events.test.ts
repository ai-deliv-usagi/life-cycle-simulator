import { describe, expect, it } from 'vitest';
import { defaultData, validateData } from '../src/data/index';
import {
  applyChoice,
  applyEffects,
  availableChoices,
  conditionsMet,
  drawEvent,
  eventProb,
  fireEvent,
  isEligible,
} from '../src/engine/events';
import { createRng } from '../src/engine/rng';
import type { EventDef, GameData } from '../src/engine/types';
import { flatRng, makeState, setAge } from './helpers';

const byId = (id: string): EventDef => {
  const ev = defaultData.events.find((e) => e.id === id);
  if (!ev) throw new Error(id);
  return ev;
};

describe('events.json', () => {
  it('検査を通り、カテゴリごとの数が仕様どおり(ライフ25・キャリア13・お金13・健康12・社会2 + 再就職・再雇用)', () => {
    expect(validateData(defaultData)).toEqual([]);
    const count: Record<string, number> = {};
    for (const e of defaultData.events) count[e.category] = (count[e.category] ?? 0) + 1;
    expect(count).toEqual({ life: 25, career: 13, money: 13, health: 12, social: 2, system: 2 });
  });
});

describe('条件', () => {
  it('年齢の範囲(ageMax 歳のうちは対象)', () => {
    const c = { ageMin: 25, ageMax: 35 };
    expect(conditionsMet(c, setAge(makeState(), 24.9))).toBe(false);
    expect(conditionsMet(c, setAge(makeState(), 25))).toBe(true);
    expect(conditionsMet(c, setAge(makeState(), 35.9))).toBe(true);
    expect(conditionsMet(c, setAge(makeState(), 36))).toBe(false);
  });

  it('flags.married は character.married を見る', () => {
    const s = makeState();
    expect(conditionsMet({ flags: { married: false } }, s)).toBe(true);
    s.character.married = true;
    expect(conditionsMet({ flags: { married: true } }, s)).toBe(true);
  });

  it('雇用中・退職・投資残高・地域・職業', () => {
    const s = makeState({ region: 'rural', job: 'parttime' });
    expect(conditionsMet({ employed: true }, s)).toBe(true);
    expect(conditionsMet({ jobNotIn: ['parttime'] }, s)).toBe(false);
    expect(conditionsMet({ region: ['metro', 'city'] }, s)).toBe(false);
    expect(conditionsMet({ minInvested: 1 }, s)).toBe(false);
    s.assets.stocks = 1;
    expect(conditionsMet({ minInvested: 1 }, s)).toBe(true);
    s.character.retired = true;
    expect(conditionsMet({ employed: true }, s)).toBe(false);
    expect(conditionsMet({ retired: true }, s)).toBe(true);
  });

  it('once は1回だけ、cooldown の間は起きない', () => {
    const s = setAge(makeState(), 50);
    const ill = byId('parent_ill');
    expect(isEligible(ill, s)).toBe(true);
    fireEvent(s, ill, flatRng);
    s.pendingEvent = undefined;
    s.month += 1000;
    expect(isEligible(ill, s)).toBe(false);

    const t = setAge(makeState(), 30);
    const wedding = byId('wedding_rush');
    fireEvent(t, wedding, flatRng);
    t.month += 23;
    expect(isEligible(wedding, t)).toBe(false);
    t.month += 1;
    expect(isEligible(wedding, t)).toBe(true);
  });

  it('条件を満たさないイベントは何年回しても起きない', () => {
    const s = setAge(makeState(), 30); // 未婚 → 離婚の危機・プロポーズは起きない。車なし → 車が壊れるは起きない
    const rng = createRng(1);
    const fired = new Set<string>();
    for (let m = 0; m < 2000; m++) {
      const ev = drawEvent(s, rng);
      if (ev) fired.add(ev.id);
    }
    for (const id of ['divorce_crisis', 'proposal', 'car_broke', 'reemployment', 'parent_death']) {
      expect(fired.has(id)).toBe(false);
    }
    expect(fired.size).toBeGreaterThan(5);
  });
});

describe('確率', () => {
  it('probMods を掛ける', () => {
    const s = setAge(makeState({ luck: 50 }), 30);
    const ev = byId('cold');
    const base = eventProb(ev, s);
    s.stats.health = 30;
    expect(eventProb(ev, s)).toBeCloseTo(base * 2);
  });

  it('運: 良いイベントは運が高いほど、悪いイベントは運が低いほど起きやすい', () => {
    const good = byId('windfall_bonus');
    const bad = byId('traffic_accident');
    const lucky = makeState({ luck: 100 });
    const unlucky = makeState({ luck: 0 });
    expect(eventProb(good, lucky)).toBeCloseTo(0.004 * 1.2);
    expect(eventProb(good, unlucky)).toBeCloseTo(0.004 * 0.8);
    expect(eventProb(bad, lucky)).toBeCloseTo(0.0004 * 0.8);
    expect(eventProb(bad, unlucky)).toBeCloseTo(0.0004 * 1.2);
    expect(eventProb(byId('lottery'), lucky)).toBeCloseTo(0.004); // good 未指定は運の影響なし
  });

  it('リストラは職業のリストラ率 × 不況中3倍 × 運', () => {
    const s = makeState({ job: 'parttime', luck: 50 });
    const layoff = byId('layoff');
    expect(eventProb(layoff, s)).toBeCloseTo(0.001);
    s.flags.recession = 5;
    expect(eventProb(layoff, s)).toBeCloseTo(0.003);
  });

  it('同じシードなら同じイベント列', () => {
    const run = () => {
      const s = setAge(makeState(), 30);
      const rng = createRng(42);
      return Array.from({ length: 500 }, () => drawEvent(s, rng)?.id ?? null);
    };
    expect(run()).toEqual(run());
  });

  it('当たったものが複数なら確率で重み付けして1件だけ', () => {
    const always = (id: string, p: number): EventDef => ({ id, category: 'life', title: id, text: '', conditions: {}, baseProb: p });
    const data: GameData = { ...defaultData, events: [always('a', 1), always('b', 1)] };
    const rng = createRng(3);
    const s = makeState();
    const seen = new Set(Array.from({ length: 50 }, () => drawEvent(s, rng, data)?.id));
    expect(seen).toEqual(new Set(['a', 'b']));
  });
});

describe('発生と選択', () => {
  it('選択肢なしのイベントは効果を即適用してログに残す', () => {
    const s = makeState();
    fireEvent(s, byId('traffic_accident'), flatRng);
    expect(s.assets.cash).toBe(-200_000);
    expect(s.pendingEvent).toBeUndefined();
    expect(s.log.at(-1)).toMatchObject({ type: 'event', id: 'traffic_accident' });
    expect(s.eventHistory.traffic_accident).toEqual({ count: 1, lastMonth: 0 });
  });

  it('選択肢ありのイベントは pendingEvent をセットして止まる', () => {
    const s = setAge(makeState(), 30);
    fireEvent(s, byId('certification'), flatRng);
    expect(s.pendingEvent).toEqual({ eventId: 'certification', month: 0 });
    expect(s.assets.cash).toBe(0);
  });

  it('選択で効果と価値観の変化(±0.1、−2〜+2)を適用し、ログに残す', () => {
    const s = setAge(makeState(), 30);
    s.flags.partner = true;
    s.values.relation = -1.95;
    applyChoice(s, byId('proposal'), 0, createRng(1));
    expect(s.character.married).toBe(true);
    expect(s.character.spouse).not.toBeNull();
    expect(s.flags.partner).toBe(false);
    expect(s.assets.cash).toBe(0); // 貯金がないので式代はローンになる
    expect(s.assets.loan).toBe(2_000_000);
    expect(s.values.relation).toBe(-2);
    expect(s.log.at(-1)).toMatchObject({ type: 'choice', text: 'プロポーズのチャンス: 「結婚する」' });
    expect(s.log.some((e) => e.id === 'auto_loan')).toBe(true);
  });

  it('outcomes は確率で分岐し、結果をログに書く', () => {
    const results = new Set<string>();
    const rng = createRng(5);
    for (let i = 0; i < 200; i++) {
      const s = makeState({ initialCash: 1_000_000 });
      applyChoice(s, byId('friend_loan'), 0, rng);
      results.add(s.log.at(-1)!.text);
    }
    expect(results).toEqual(
      new Set(['友人に借金を頼まれる: 「貸す」 → 約束どおり返ってきた', '友人に借金を頼まれる: 「貸す」 → 返ってこなかった']),
    );
  });

  it('条件を満たさない選択肢は出ず、選ぶとエラー', () => {
    const metro = makeState({ region: 'metro' });
    const labels = availableChoices(byId('moving'), metro).map((c) => c.choice.label);
    expect(labels).toEqual(['地方へ移る', '近場で住み替える', 'やめておく']);
    expect(() => applyChoice(metro, byId('moving'), 0, flatRng)).toThrow();

    const rural = makeState({ region: 'rural', hasCar: true });
    expect(availableChoices(byId('car_broke'), rural).map((c) => c.choice.label)).not.toContain('手放す');

    const single = makeState();
    expect(availableChoices(byId('reunion'), single).map((c) => c.index)).toEqual([1, 2]);
  });

  it('引っ越しで地域が変わる', () => {
    const s = makeState({ region: 'city' });
    applyChoice(s, byId('moving'), 0, flatRng);
    expect(s.character.region).toBe('metro');
  });
});

describe('効果', () => {
  it('結婚で配偶者の働き方を抽選し(35/35/30%)、離婚で資産半分・配偶者なし', () => {
    const rng = createRng(9);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 6000; i++) {
      const s = makeState();
      applyEffects(s, { setFlags: { married: true } }, rng);
      counts[s.character.spouse!] = (counts[s.character.spouse!] ?? 0) + 1;
    }
    expect(counts.fulltime! / 6000).toBeCloseTo(0.35, 1);
    expect(counts.parttime! / 6000).toBeCloseTo(0.35, 1);
    expect(counts.homemaker! / 6000).toBeCloseTo(0.3, 1);

    const s = makeState();
    applyEffects(s, { setFlags: { married: true } }, rng);
    s.assets = { ...s.assets, cash: 1_000_000, index: 2_000_000, debt: 300_000 };
    applyChoice(s, byId('divorce_crisis'), 1, rng);
    expect(s.character.married).toBe(false);
    expect(s.character.spouse).toBeNull();
    expect(s.assets).toMatchObject({ cash: 500_000, index: 1_000_000, debt: 300_000 });
  });

  it('財産分与(split)は元本も減らし、相場の暴落は元本を変えない', () => {
    const s = makeState();
    s.character.married = true;
    s.assets.index = 2_000_000;
    s.invested!.index = 1_000_000;
    applyChoice(s, byId('divorce_crisis'), 1, flatRng);
    expect(s.assets.index).toBe(1_000_000);
    expect(s.invested!.index).toBe(500_000);
    fireEvent(s, byId('recession'), flatRng);
    expect(s.assets.index).toBe(700_000);
    expect(s.invested!.index).toBe(500_000);
  });

  it('転職は現職以外へ、payMul は転職後の値になる', () => {
    const rng = createRng(2);
    for (let i = 0; i < 50; i++) {
      const s = makeState({ job: 'sales' });
      applyChoice(s, byId('job_offer'), 0, rng);
      expect(s.character.job).not.toBe('sales');
      expect(s.character.previousJob).toBe('sales');
      expect(s.flags.payMul).toBe(1.05);
    }
  });

  it('リストラ → 再就職(前の職業に戻る)', () => {
    const s = makeState({ job: 'factory' });
    fireEvent(s, byId('layoff'), flatRng);
    expect(s.character.job).toBe('none');
    expect(s.flags.unemploymentBenefit).toBe(6);
    expect(isEligible(byId('reemployment'), s)).toBe(true);
    applyChoice(s, byId('reemployment'), 0, flatRng);
    expect(s.character.job).toBe('factory');
    expect(s.flags.payMul).toBe(0.95);
    expect(s.flags.unemploymentBenefit).toBe(0);
  });

  it('月給の何ヶ月分・資産ショック・相続・物価・昇進', () => {
    const s = makeState({ familyTier: 5 });
    s.assets = { ...s.assets, index: 1_000_000, stocks: 1_000_000, cash: 0 };
    fireEvent(s, byId('windfall_bonus'), flatRng);
    expect(s.assets.cash).toBe(Math.round(3_220_000 / 16)); // 月給(年収 ÷ (12 + ボーナス4ヶ月))の1ヶ月分
    fireEvent(s, byId('recession'), flatRng);
    expect(s.assets).toMatchObject({ index: 700_000, stocks: 700_000 });
    expect(s.flags.recession).toBe(24);
    const before = s.assets.cash;
    fireEvent(s, byId('parent_death'), flatRng);
    expect(s.assets.cash - before).toBe(50_000_000);
    expect(s.flags.parentAlive).toBe(false);
    fireEvent(s, byId('inflation'), flatRng);
    fireEvent(s, byId('inflation'), flatRng);
    expect(s.flags.priceLevel).toBeCloseTo(1.1025);
    applyChoice(s, byId('promotion'), 0, flatRng);
    expect(s.flags.payMul).toBeCloseTo(1.1);
  });

  it('昇進は役職が上がるほど・年を取るほど話が来にくく、部長(4)より上はない', () => {
    const promo = byId('promotion');
    const s = setAge(makeState({ luck: 50 }), 30);
    const p0 = eventProb(promo, s);
    applyChoice(s, promo, 0, flatRng);
    expect(s.flags.rank).toBe(1);
    expect(eventProb(promo, s)).toBeCloseTo(p0 * 0.7);
    s.flags.rank = 4;
    expect(eventProb(promo, s)).toBe(0);
    const old = setAge(makeState({ luck: 50 }), 56);
    expect(eventProb(promo, old)).toBeCloseTo(p0 * 0.5 * 0.2);
  });

  it('転職すると役職は一般に戻る', () => {
    const s = makeState({ job: 'sales' });
    s.flags.rank = 3;
    applyChoice(s, byId('job_offer'), 0, createRng(1));
    expect(s.flags.rank).toBe(0);
  });

  it('ステータスは0〜100にクランプ', () => {
    const s = makeState();
    applyEffects(s, { stats: { health: -500, stress: 500 } }, flatRng);
    expect(s.stats.health).toBe(0);
    expect(s.stats.stress).toBe(100);
  });
});
