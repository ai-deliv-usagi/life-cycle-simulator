import { describe, expect, it } from 'vitest';
import { sellAsset } from '../src/engine/step';
import { netWorth } from '../src/engine/util';
import { makeState } from './helpers';

function holding() {
  const s = makeState();
  s.assets.cash = 100_000;
  s.assets.speculative = 1_200_000;
  s.invested = { index: 0, stocks: 0, speculative: 1_000_000 };
  return s;
}

describe('投資を売って預金にする', () => {
  it('売った額がそのまま預金になり(税金なし)、元本は売った割合だけ減る。純資産は変わらない', () => {
    const s = holding();
    const t = sellAsset(s, 'speculative', 600_000);
    expect(t.assets.speculative).toBe(600_000);
    expect(t.assets.cash).toBe(700_000);
    expect(t.invested!.speculative).toBe(500_000);
    expect(netWorth(t.assets)).toBe(netWorth(s.assets));
    expect(t.log.at(-1)).toMatchObject({ type: 'policy', id: 'sell', text: '売却: 信用・仮想通貨を60万円売って預金にした(損益 +10万円)' });
    // 元の state は変えない
    expect(s.assets.speculative).toBe(1_200_000);
  });

  it('持っている額より多く指定したら全部売る。0以下や持っていないときは何もしない', () => {
    const s = holding();
    const all = sellAsset(s, 'speculative', 9_999_999);
    expect(all.assets.speculative).toBe(0);
    expect(all.invested!.speculative).toBe(0);
    expect(all.assets.cash).toBe(1_300_000);
    expect(sellAsset(s, 'speculative', 0)).toBe(s);
    expect(sellAsset(s, 'index', 100_000)).toBe(s);
  });

  it('損をしているときは損益がマイナスで残る。亡くなったあとは売れない', () => {
    const s = holding();
    s.assets.speculative = 800_000;
    expect(sellAsset(s, 'speculative', 800_000).log.at(-1)!.text).toContain('(損益 −20万円)');
    s.dead = { cause: 'illness', ageMonths: s.ageMonths };
    expect(sellAsset(s, 'speculative', 100_000)).toBe(s);
  });
});
