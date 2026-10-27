import { describe, expect, it } from 'vitest';
import { applyEffects } from '../src/engine/events';
import { applyMonthlyMoney, applyReturns } from '../src/engine/money';
import { buyInvestment, nisaRoom, nisaValue, resetNisaYear } from '../src/engine/nisa';
import type { Rng } from '../src/engine/rng';
import { buyAsset, sellAsset } from '../src/engine/step';
import { netWorth } from '../src/engine/util';
import { flatRng, makeState } from './helpers';

/** 値動きを決めた乱数(毎月 r) */
const moving = (r: number): Rng => ({ ...flatRng, normal: () => r });

describe('NISAで買う', () => {
  it('積立はつみたて枠120万円 → 成長投資枠240万円の順、超えた分は特定口座', () => {
    const s = makeState();
    s.assets.cash = 5_000_000;
    let t = buyAsset(s, 'index', 1_000_000);
    expect(nisaValue(t, 'index')).toBe(1_000_000);
    expect(t.log.at(-1)!.text).toBe('購入: 預金で積立を100万円買った(NISA)');
    t = buyAsset(t, 'index', 3_000_000);
    expect(nisaValue(t, 'index')).toBe(3_600_000);
    expect(t.assets.index).toBe(4_000_000);
    expect(t.nisa!.year).toEqual({ tsumitate: 1_200_000, growth: 2_400_000 });
    expect(nisaRoom(t).index).toBe(0);
    expect(t.log.at(-1)!.text).toBe('購入: 預金で積立を300万円買った(うちNISA 260万円)');
  });

  it('個別株は成長投資枠だけ。信用・仮想通貨はNISAに入らない', () => {
    const s = makeState();
    s.assets.cash = 5_000_000;
    const t = buyAsset(buyAsset(s, 'stocks', 3_000_000), 'speculative', 1_000_000);
    expect(nisaValue(t, 'stocks')).toBe(2_400_000);
    expect(nisaValue(t, 'speculative')).toBe(0);
    expect(nisaRoom(t).index).toBe(1_200_000); // つみたて枠は残っている
  });

  it('暦の1月に今年の枠が戻る。生涯の枠は1,800万円(個別株は1,200万円)まで', () => {
    const s = makeState();
    for (let y = 0; y < 6; y++) {
      buyInvestment(s, 'index', 1_200_000);
      buyInvestment(s, 'stocks', 2_400_000);
      resetNisaYear(s);
    }
    expect(s.nisa!.principal).toEqual({ index: 6_000_000, stocks: 12_000_000 });
    expect(nisaRoom(s)).toEqual({ index: 0, stocks: 0, lifetime: 0 });
  });

  it('毎月の積立もNISAから先に入る', () => {
    const s = makeState({}, { invest: 'index' });
    const { invested } = applyMonthlyMoney(s, flatRng);
    expect(invested).toBeGreaterThan(0);
    expect(nisaValue(s, 'index')).toBe(s.assets.index);
  });
});

describe('値動きと売却', () => {
  it('値上がりしてもNISAの割合は変わらない', () => {
    const s = makeState();
    buyInvestment(s, 'index', 1_200_000);
    buyInvestment(s, 'index', 2_400_000 + 800_000); // 特定口座に80万円
    const frac = s.nisa!.frac.index;
    applyReturns(s, moving(0.5));
    expect(s.nisa!.frac.index).toBeCloseTo(frac);
    expect(nisaValue(s, 'index')).toBe(Math.round(3_600_000 * 1.5));
  });

  it('NISAから売ると非課税。売った元本のぶん生涯の枠が空く', () => {
    const s = makeState();
    buyInvestment(s, 'index', 1_000_000);
    applyReturns(s, moving(1)); // 2倍
    const t = sellAsset(s, 'index', 1_000_000, 'nisa');
    expect(t.assets.cash).toBe(1_000_000);
    expect(t.ledger!.investTax ?? 0).toBe(0);
    expect(t.nisa!.principal.index).toBe(500_000);
    expect(nisaRoom(t).lifetime).toBe(18_000_000 - 500_000);
    expect(t.log.at(-1)!.text).toBe('売却: 積立を100万円売って預金にした(損益 +50万円・NISA)');
  });

  it('特定口座から先に売る(auto)。特定口座の利益だけに税金', () => {
    const s = makeState();
    buyInvestment(s, 'stocks', 2_400_000); // NISA
    buyInvestment(s, 'stocks', 1_000_000); // 特定口座
    applyReturns(s, moving(1)); // 2倍: NISA 480万・特定 200万(元本100万)
    const t = sellAsset(s, 'stocks', 2_500_000);
    // 特定口座の200万を先に(利益100万に税金)、残り50万はNISAから
    expect(t.assets.cash).toBe(2_500_000 - 203_150);
    expect(nisaValue(t, 'stocks')).toBe(4_300_000);
    expect(t.assets.stocks).toBe(4_300_000);
    expect(netWorth(t.assets)).toBe(netWorth(s.assets) - 203_150);
  });

  it('資金ショートでは特定口座から先に売る', () => {
    const s = makeState({}, { spending: 'lavish' });
    s.flags.priceLevel = 1.1; // 赤字にする
    buyInvestment(s, 'index', 500_000); // NISA
    s.nisa!.year.tsumitate = 1_200_000;
    s.nisa!.year.growth = 2_400_000;
    buyInvestment(s, 'index', 500_000); // 枠がないので特定口座
    applyMonthlyMoney(s, flatRng);
    expect(nisaValue(s, 'index')).toBe(500_000);
    expect(s.assets.index).toBeLessThan(1_000_000);
  });

  it('離婚の財産分与では、NISAの元本も同じ割合で減り、割合は変わらない', () => {
    const s = makeState();
    buyInvestment(s, 'index', 1_000_000);
    applyEffects(s, { assetShock: { pct: -0.5, targets: ['index'], split: true } }, flatRng);
    expect(s.assets.index).toBe(500_000);
    expect(s.nisa!.principal.index).toBe(500_000);
    expect(nisaValue(s, 'index')).toBe(500_000);
  });

  it('古いセーブ(nisa がない)は全部特定口座として扱い、元本がわからなければ税金はかけない', () => {
    const s = makeState();
    delete s.nisa;
    delete s.invested;
    s.assets.stocks = 1_000_000;
    const t = sellAsset(s, 'stocks', 500_000);
    expect(t.assets.cash).toBe(500_000);
    expect(nisaValue(t, 'stocks')).toBe(0);
  });
});
