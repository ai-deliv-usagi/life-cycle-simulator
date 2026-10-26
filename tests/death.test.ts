import { describe, expect, it } from 'vitest';
import {
  baseAnnualMortality,
  behaviorFactor,
  causeWeights,
  healthFactor,
  monthlyDeathProb,
  pickCause,
  rollDeath,
} from '../src/engine/death';
import { defaultData } from '../src/data/index';
import { createRng } from '../src/engine/rng';
import { updateStats } from '../src/engine/stats';
import type { Policy } from '../src/engine/types';
import { makeState, setAge } from './helpers';

describe('死亡率', () => {
  const { a } = defaultData.balance.death;
  it('基本死亡率: q = a·e^{0.085(年齢−20)}、上限1', () => {
    expect(baseAnnualMortality(20)).toBeCloseTo(a, 8);
    expect(baseAnnualMortality(80)).toBeCloseTo(a * Math.exp(0.085 * 60), 8);
    expect(baseAnnualMortality(200)).toBe(1);
  });

  it('健康補正: 2^((50−健康)/15)。100で約0.1倍、50で1倍、0で約10倍', () => {
    expect(healthFactor(100)).toBeCloseTo(2 ** (-50 / 15));
    expect(healthFactor(50)).toBeCloseTo(1);
    expect(healthFactor(0)).toBeCloseTo(2 ** (50 / 15));
  });

  it('85歳を過ぎると死亡率の上がり方が急になる(100歳で約2.5倍)', () => {
    expect(baseAnnualMortality(85)).toBeCloseTo(a * Math.exp(0.085 * 65), 8);
    expect(baseAnnualMortality(100)).toBeCloseTo(a * Math.exp(0.085 * 80) * Math.exp(0.06 * 15), 8);
    expect(baseAnnualMortality(100) * defaultData.balance.death.genderMul.female).toBeGreaterThan(0.2);
  });

  it('健康が良いことで死亡率が下がる効果は、80歳から15年かけてなくなる。健康が悪いことの害はそのまま', () => {
    const good = healthFactor(100);
    expect(healthFactor(100, defaultData, 80)).toBeCloseTo(good);
    expect(healthFactor(100, defaultData, 87.5)).toBeCloseTo(1 - (1 - good) / 2);
    expect(healthFactor(100, defaultData, 95)).toBe(1);
    expect(healthFactor(0, defaultData, 95)).toBeCloseTo(2 ** (50 / 15));
  });

  it('行動補正: 残業多め1.15、激務1.25、ストレス70以上でさらに1.2。退職後は働き方の補正なし', () => {
    expect(behaviorFactor(makeState({}, { work: 'normal' }))).toBe(1);
    expect(behaviorFactor(makeState({}, { work: 'overtime' }))).toBeCloseTo(1.15);
    const g = makeState({}, { work: 'grind' });
    g.stats.stress = 70;
    expect(behaviorFactor(g)).toBeCloseTo(1.25 * 1.2);
    g.character.retired = true;
    expect(behaviorFactor(g)).toBeCloseTo(1.2);
  });

  it('月の死亡確率 = q/12 × 健康補正 × 行動補正', () => {
    const s = setAge(makeState({}, { work: 'grind' }), 50);
    s.stats.health = 25;
    s.stats.stress = 30;
    expect(monthlyDeathProb(s)).toBeCloseTo((baseAnnualMortality(50) / 12) * 2 ** (25 / 15) * 1.25, 10);
  });

  it('120歳で必ず老衰', () => {
    const s = setAge(makeState(), 120);
    expect(monthlyDeathProb(s)).toBe(1);
    expect(rollDeath(s, createRng(1))).toBe('old_age');
  });
});

describe('死因', () => {
  it('重み: 病気=年齢×(100−健康)/50、過労=激務40/残業10、事故=10×(1.5−運/100)、老衰=85歳以上で(年齢−80)×5', () => {
    const s = setAge(makeState({ luck: 50 }, { work: 'grind' }), 90);
    s.stats.health = 50;
    expect(causeWeights(s)).toEqual({ illness: 90, overwork: 40, accident: 10, old_age: 50 });
    const young = setAge(makeState({ luck: 100 }, { work: 'overtime' }), 30);
    young.stats.health = 100;
    expect(causeWeights(young)).toEqual({ illness: 0, overwork: 10, accident: 5, old_age: 0 });
  });

  it('重みに比例して抽選される', () => {
    const s = setAge(makeState({ luck: 50 }, { work: 'regular' }), 40);
    s.stats.health = 50; // 病気40、事故10
    const rng = createRng(3);
    let illness = 0;
    for (let i = 0; i < 10_000; i++) if (pickCause(s, rng) === 'illness') illness++;
    expect(illness / 10_000).toBeCloseTo(0.8, 1);
  });

  it('同じ乱数なら同じ判定', () => {
    const s = setAge(makeState(), 80);
    const a = createRng(9);
    const b = createRng(9);
    for (let i = 0; i < 500; i++) expect(rollDeath(s, a)).toBe(rollDeath(s, b));
  });
});

/**
 * 方針を固定したときの平均寿命(イベントなし)。ステータスの変化と死亡率から期待値を計算する。
 * DESIGN.md §12 変更1 の試算と同じもの。
 */
function expectedLifespan(policy: Partial<Policy>): number {
  const s = setAge(makeState({ constitution: 50 }, policy), 22);
  let alive = 1;
  let expected = 0;
  while (alive > 1e-6) {
    s.ageMonths++;
    if (s.ageMonths === 65 * 12) s.character.retired = true;
    updateStats(s);
    const p = monthlyDeathProb(s);
    expected += alive * p * (s.ageMonths / 12);
    alive *= 1 - p;
  }
  return expected;
}

describe('寿命のバランス(イベントなし)', () => {
  // イベントで健康が削られる分、イベントなしの寿命は目安(78〜85歳)より少し長めにしてある
  // イベント(大病・過労死・事故など)が入ると、ここから2歳ほど短くなる(自動プレイの「普通」で約86歳)
  it('普通の働き方・普通の健康管理で82〜89歳', () => {
    const life = expectedLifespan({ work: 'normal', health: 'normal' });
    expect(life).toBeGreaterThan(82);
    expect(life).toBeLessThan(89);
  });

  it('激務で健康を気にしない(出世派の方針)は普通より5〜12歳短く、健康意識高めは長い', () => {
    const normal = expectedLifespan({ work: 'normal', health: 'normal' });
    const hustle = normal - expectedLifespan({ work: 'grind', health: 'ignore' });
    expect(hustle).toBeGreaterThan(5);
    expect(hustle).toBeLessThan(12);
    expect(expectedLifespan({ work: 'normal', health: 'active' })).toBeGreaterThan(normal);
  });
});
