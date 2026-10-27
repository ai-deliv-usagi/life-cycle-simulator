import { describe, expect, it } from 'vitest';
import { applyReturns, investmentOutlook } from '../src/engine/money';
import { createRng } from '../src/engine/rng';
import { makeState } from './helpers';

describe('投資の見通し', () => {
  it('値動きの大きい投資ほど、ふつうの結果(中央値)が下がる', () => {
    const index = investmentOutlook('index', 10);
    const stocks = investmentOutlook('stocks', 10);
    const spec = investmentOutlook('speculative', 10);
    expect(index.median).toBeGreaterThan(1.3);
    expect(index.upShare).toBeGreaterThan(0.7);
    expect(spec.median).toBeLessThan(1);
    expect(spec.upShare).toBeLessThan(stocks.upShare);
    expect(spec.halfShare).toBeGreaterThan(stocks.halfShare);
  });

  it('近似は実際の値動き(1,000回)とおおむね合う', () => {
    const finals: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const s = makeState();
      s.assets.speculative = 1_000_000;
      const rng = createRng(i + 1);
      for (let m = 0; m < 120; m++) applyReturns(s, rng);
      finals.push(s.assets.speculative / 1_000_000);
    }
    const up = finals.filter((x) => x > 1).length / finals.length;
    expect(Math.abs(up - investmentOutlook('speculative', 10).upShare)).toBeLessThan(0.06);
  });
});
