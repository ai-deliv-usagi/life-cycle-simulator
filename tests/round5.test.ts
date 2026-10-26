import { describe, expect, it } from 'vitest';
import { defaultData } from '../src/data/index';
import { applyChoice, choiceCost, eventProb, luxuryPrice } from '../src/engine/events';
import { applyMonthlyMoney, calcExpenses, calcIncome, debtRates } from '../src/engine/money';
import { allocationLabel } from '../src/engine/step';
import type { EventDef } from '../src/engine/types';
import { flatRng, makeState, setAge } from './helpers';

const byId = (id: string): EventDef => defaultData.events.find((e) => e.id === id)!;
const lux = defaultData.balance.luxury;

describe('高級品', () => {
  it('値段は金融資産 × 割合 × 支出の方針の倍率。貧しくても最低の値段、上限もある', () => {
    const poor = makeState();
    expect(luxuryPrice('car', poor)).toBe(lux.car.min);
    const rich = makeState({ initialCash: 50_000_000 });
    expect(luxuryPrice('car', rich)).toBe(7_500_000);
    const lavish = makeState({ initialCash: 50_000_000 }, { spending: 'lavish' });
    expect(luxuryPrice('car', lavish)).toBe(lux.car.max); // 1,350万円 → 上限
    expect(luxuryPrice('brand', makeState({ initialCash: 10_000_000 }))).toBe(300_000);
  });

  it('金融資産が多いほど、浪費家ほど起きやすい。節約家でもまれに起きる', () => {
    const ev = byId('luxury_car');
    const p = (cash: number, spending: 'frugal' | 'normal' | 'lavish') => eventProb(ev, setAge(makeState({ initialCash: cash }, { spending }), 40));
    expect(p(40_000_000, 'normal')).toBeCloseTo(p(0, 'normal') * 4);
    expect(p(0, 'lavish')).toBeGreaterThan(p(0, 'normal') * 3);
    expect(p(0, 'frugal')).toBeGreaterThan(0);
  });

  it('お金がなくても、ローン・リボなら買える。選択肢の目安に年利が付く', () => {
    const s = setAge(makeState(), 30);
    applyChoice(s, byId('luxury_car'), 1, flatRng);
    expect(s.assets.loan).toBe(lux.car.min);
    expect(s.flags.hasCar).toBe(true);
    expect(s.log.at(-1)!.money).toBe(-lux.car.min);
    const t = setAge(makeState(), 30);
    applyChoice(t, byId('luxury_brand'), 1, flatRng);
    expect(t.assets.debt).toBe(lux.brand.min);
    const cost = choiceCost(byId('luxury_brand'), byId('luxury_brand').choices![1]!, t);
    expect(cost).toMatchObject({ borrow: lux.brand.min, borrowRate: defaultData.balance.debtAnnualRate });
  });

  it('車の購入にも高級車の選択肢がある', () => {
    const labels = byId('car_purchase').choices!.map((c) => c.label);
    expect(labels).toContain('高級車を買う');
    expect(labels.at(-1)).toBe('買わない');
  });
});

describe('毎月決まった額の積立', () => {
  it('配分の預金を除いた比で分け、赤字の月も預金があるうちは続ける', () => {
    const s = makeState({ initialCash: 1_000_000 }, { invest: { deposit: 30, index: 35, stocks: 35, speculative: 0 }, investMonthly: 50_000 });
    s.character.job = 'none'; // 収入なしで赤字
    const r = applyMonthlyMoney(s, flatRng);
    expect(r.invested).toBe(50_000);
    expect(s.invested!.index).toBe(25_000);
    expect(s.invested!.stocks).toBe(25_000);
    expect(allocationLabel(s.policy)).toBe('毎月5万円(積立50%・個別株50%)');
  });

  it('預金が足りなければ、ある分だけ買う。決めていなければ今までどおり余りの半分', () => {
    const s = makeState({}, { invest: 'index', investMonthly: 100_000 });
    s.assets.cash = -(calcIncome(s).total - calcExpenses(s).total) + 30_000; // 今月の収支のあとに3万円だけ残る
    expect(applyMonthlyMoney(s, flatRng).invested).toBe(30_000);
    expect(allocationLabel(s.policy)).toBe('毎月10万円を積立に');
    const t = makeState({}, { invest: 'index' });
    const surplus = calcIncome(t).total - calcExpenses(t).total;
    expect(applyMonthlyMoney(t, flatRng).invested).toBe(Math.round(surplus * defaultData.balance.investShare));
  });
});

describe('預金が足りないときの投資の取り崩し', () => {
  it('売った投資と金額をログに残す', () => {
    const s = makeState({}, { invest: 'deposit' });
    s.assets.cash = -1_000_000;
    s.assets.speculative = 1_300_000;
    applyMonthlyMoney(s, flatRng);
    expect(s.assets.speculative).toBeLessThan(1_300_000);
    expect(s.log.at(-1)).toMatchObject({ id: 'forced_sale' });
    expect(s.log.at(-1)!.text).toContain('信用・仮想通貨を');
  });
});

describe('金利の表示', () => {
  it('カードローン・ローン・住宅ローン・奨学金の年利', () => {
    const s = makeState({ studentLoan: { interestFree: false, annualRate: 0.004, monthlyPayment: 15_000, amount: 2_400_000 } });
    expect(debtRates(s)).toEqual({ card: 0.15, loan: 0.03, mortgage: 0.01, studentLoan: 0.004 });
  });
});

describe('腰痛', () => {
  it('起きすぎないよう、基本確率は月0.15%', () => {
    expect(byId('back_pain').baseProb).toBe(0.0015);
  });
});
