import { describe, expect, it } from 'vitest';
import { healthBaseline, updateStats } from '../src/engine/stats';
import type { GameState, Policy } from '../src/engine/types';
import { makeState, setAge } from './helpers';

/** 回帰項が0になるよう、健康を平常値・ストレスを30に置いてから1ヶ月進める */
function deltas(policy: Partial<Policy>, setup: (s: GameState) => void = () => {}) {
  const s = setAge(makeState({}, policy), 30);
  setup(s);
  s.stats.health = healthBaseline(s);
  s.stats.stress = 30;
  const before = { ...s.stats };
  updateStats(s);
  return {
    health: s.stats.health - before.health,
    stress: s.stats.stress - before.stress,
    skill: s.stats.skill - before.skill,
    relations: s.stats.relations - before.relations,
    credit: s.stats.credit - before.credit,
  };
}

describe('updateStats: 方針ごとの増減(体質50 → 減少は×1.0)', () => {
  it.each([
    ['regular', 0, -1, 0.1],
    ['normal', -0.05, 0, 0.2],
    ['overtime', -0.3, 1.5, 0.35],
    ['grind', -0.35, 1.8, 0.5],
  ] as const)('働き方 %s: 健康 %f / ストレス %f / スキル %f', (work, health, stress, skill) => {
    const d = deltas({ work, health: 'normal' });
    expect(d.health).toBeCloseTo(health);
    expect(d.stress).toBeCloseTo(stress);
    expect(d.skill).toBeCloseTo(skill);
  });

  it.each([
    ['ignore', -0.1, 0],
    ['normal', 0, 0],
    ['active', 0.3, -0.3],
  ] as const)('健康方針 %s: 健康 %f / ストレス %f(定時と合算)', (health, dh, ds) => {
    const d = deltas({ work: 'regular', health });
    expect(d.health).toBeCloseTo(dh);
    expect(d.stress).toBeCloseTo(-1 + ds);
  });

  it('浪費はストレス−0.5', () => {
    expect(deltas({ work: 'normal', health: 'normal', spending: 'lavish' }).stress).toBeCloseTo(-0.5);
  });

  it('体質が低いほど減り方が大きい(体質20 → ×1.3)', () => {
    const d = deltas({ work: 'grind', health: 'normal' }, (s) => (s.character.constitution = 20));
    expect(d.health).toBeCloseTo(-0.35 * 1.3);
  });

  it('退職後: 働き方の影響なし、ストレス−1、スキル変化0', () => {
    const d = deltas({ work: 'grind', health: 'normal' }, (s) => (s.character.retired = true));
    expect(d).toMatchObject({ skill: 0 });
    expect(d.health).toBeCloseTo(0);
    expect(d.stress).toBeCloseTo(-1);
  });

  it('無職: 定時扱い + ストレス+1', () => {
    const d = deltas({ work: 'grind', health: 'normal' }, (s) => (s.character.job = 'none'));
    expect(d.stress).toBeCloseTo(-1 + 1);
    expect(d.skill).toBeCloseTo(0.1);
  });

  it('人間関係−0.1/月、信用は借金があれば−0.5、なければ+0.1', () => {
    expect(deltas({}).relations).toBeCloseTo(-0.1);
    expect(deltas({}).credit).toBeCloseTo(0.1);
    expect(deltas({}, (s) => (s.assets.debt = 1)).credit).toBeCloseTo(-0.5);
    expect(deltas({}, (s) => (s.assets.studentLoan = 1_000_000)).credit).toBeCloseTo(0.1); // 奨学金では下げない
  });
});

describe('updateStats: 年齢・ストレス・回帰', () => {
  it('40歳以上で−0.05、60歳以上で−0.1、ストレス70以上で−0.3', () => {
    const at = (age: number, stress: number) => {
      const s = setAge(makeState({}, { work: 'regular', health: 'normal' }), age);
      s.stats.health = healthBaseline(s);
      s.stats.stress = stress;
      const h = s.stats.health;
      updateStats(s);
      return s.stats.health - h;
    };
    expect(at(45, 30)).toBeCloseTo(-0.05);
    expect(at(65, 30)).toBeCloseTo(-0.1);
    expect(at(30, 70)).toBeCloseTo(-0.3);
  });

  it('健康の平常値 = 65 + 0.4×(体質−50) − 0.4×max(0, 年齢−40)', () => {
    const s = setAge(makeState({ constitution: 70 }), 60);
    expect(healthBaseline(s)).toBeCloseTo(65 + 8 - 8);
  });

  it('健康とストレスは平常値に向かって戻る', () => {
    const s = setAge(makeState({}, { work: 'regular', health: 'normal' }), 30);
    s.stats.health = 20;
    s.stats.stress = 90;
    updateStats(s);
    // ストレス90なので健康は −0.3 も入る
    expect(s.stats.health).toBeCloseTo(20 - 0.3 + 0.03 * (65 - 20));
    expect(s.stats.stress).toBeCloseTo(90 - 1 + 0.03 * (30 - 90));
  });

  it('方針を続けると平常値まわりで落ち着く(0や100に張り付かない)', () => {
    for (const health of ['ignore', 'normal', 'active'] as const) {
      const s = setAge(makeState({}, { work: 'normal', health }), 22);
      for (let m = 0; m < 12 * 40; m++) {
        updateStats(s);
        s.ageMonths++;
      }
      expect(s.stats.health).toBeGreaterThan(20);
      expect(s.stats.health).toBeLessThan(90);
    }
  });

  it('ステータスは0〜100に収まり、達成感は減衰して0未満にならない', () => {
    const s = makeState({}, { work: 'grind', health: 'ignore' });
    s.stats = { health: 0.1, stress: 99.9, skill: 99.95, credit: 0.2, relations: 0.05 };
    s.assets.debt = 1;
    s.achievement = 0.1;
    for (let i = 0; i < 24; i++) updateStats(s);
    for (const v of Object.values(s.stats)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(s.stats.skill).toBe(100);
    expect(s.stats.credit).toBe(0);
    expect(s.achievement).toBe(0);
  });
});
