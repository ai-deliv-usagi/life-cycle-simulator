import { describe, expect, it } from 'vitest';
import { computeResult, lifeType } from '../src/engine/result';
import type { GameState } from '../src/engine/types';
import { addLog } from '../src/engine/util';
import { makeState } from './helpers';

describe('lifeType', () => {
  it('平均幸福度60・最終資産3,000万円で4象限に分ける', () => {
    expect(lifeType(60, 30_000_000)).toBe('winner');
    expect(lifeType(60, 29_999_999)).toBe('poor_happy');
    expect(lifeType(59.9, 30_000_000)).toBe('rich_unhappy');
    expect(lifeType(40, -1_000_000)).toBe('hardship');
  });
});

/** 2年と6ヶ月生きて死んだ人生を作る */
function deadLife(): GameState {
  const s = makeState();
  for (let m = 1; m <= 30; m++) {
    s.month = m;
    s.ageMonths = s.startAge * 12 + m;
    s.happinessHistory.push(m <= 12 ? 50 : m <= 24 ? 70 : 80);
    s.assets.cash = m * 100_000;
    if (m === 5) addLog(s, 'event', '風邪で休む', 'cold');
    if (m === 6) addLog(s, 'policy', '方針変更');
    if (m % 12 === 0) addLog(s, 'year_summary', `${m / 12}年目`);
  }
  s.assets.studentLoan = 500_000;
  s.dead = { cause: 'illness', ageMonths: s.ageMonths };
  addLog(s, 'death', '病気で亡くなった');
  return s;
}

describe('computeResult', () => {
  it('享年・死因・最終資産(奨学金を引く)・生涯幸福スコア', () => {
    const r = computeResult(deadLife());
    expect(r.ageAtDeath).toBe(24);
    expect(r.cause).toBe('illness');
    expect(r.finalNetWorth).toBe(3_000_000 - 500_000);
    expect(r.lifetimeHappiness).toBeCloseTo((50 * 12 + 70 * 12 + 80 * 6) / 30);
    expect(r.lifeType).toBe('poor_happy');
  });

  it('年ごとの推移: 年間サマリーごとの純資産と1年の平均幸福度、最後に死亡時点', () => {
    const r = computeResult(deadLife());
    expect(r.yearly).toEqual([
      { age: 23, netWorth: 1_200_000, happiness: 50 },
      { age: 24, netWorth: 2_400_000, happiness: 70 },
      { age: 24.5, netWorth: 2_500_000, happiness: 80 },
    ]);
  });

  it('年表は event / choice / death だけ', () => {
    const r = computeResult(deadLife());
    expect(r.timeline.map((e) => e.type)).toEqual(['event', 'death']);
  });

  it('生きているとエラー', () => {
    expect(() => computeResult(makeState())).toThrow();
  });
});
