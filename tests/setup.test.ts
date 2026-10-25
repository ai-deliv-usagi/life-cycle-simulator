import { describe, expect, it } from 'vitest';
import { defaultData } from '../src/data/index';
import { realLivingSpending } from '../src/engine/money';
import { deriveSeed } from '../src/engine/rng';
import { createGame, rollCharacter } from '../src/engine/setup';
import type { CharacterRoll, Policy, Values } from '../src/engine/types';

const N = 20_000;
const rolls: CharacterRoll[] = Array.from({ length: N }, (_, i) => rollCharacter(i));

function share<T>(pred: (r: CharacterRoll) => T, value: T): number {
  return rolls.filter((r) => pred(r) === value).length / N;
}

const values: Values = { risk: 0, relation: 0, spending: 0, work: 0 };
const policy: Policy = { work: 'normal', spending: 'normal', invest: 'index', health: 'normal' };

describe('rollCharacter', () => {
  it('同じシードなら同じガチャ、違うシードなら(ほぼ)違うガチャ', () => {
    expect(rollCharacter(42)).toEqual(rollCharacter(42));
    const distinct = new Set(rolls.slice(0, 50).map((r) => JSON.stringify({ ...r, seed: 0 })));
    expect(distinct.size).toBeGreaterThan(45);
  });

  it('学歴・実家・地域の出現率が表どおり(±2%)', () => {
    for (const e of defaultData.education) expect(Math.abs(share((r) => r.education, e.id) - e.prob)).toBeLessThan(0.02);
    for (const f of defaultData.family) expect(Math.abs(share((r) => r.familyTier, f.tier) - f.prob)).toBeLessThan(0.02);
    for (const g of defaultData.regions) expect(Math.abs(share((r) => r.region, g.id) - g.prob)).toBeLessThan(0.02);
  });

  it('職業は等確率で、無職は出ない', () => {
    for (const j of defaultData.jobs) expect(Math.abs(share((r) => r.job, j.id) - 0.2)).toBeLessThan(0.02);
    expect(rolls.some((r) => (r.job as string) === 'none')).toBe(false);
  });

  it('車の保有率が地域ごとに表どおり(±3%)', () => {
    for (const g of defaultData.regions) {
      const inRegion = rolls.filter((r) => r.region === g.id);
      const withCar = inRegion.filter((r) => r.hasCar).length / inRegion.length;
      expect(Math.abs(withCar - g.carProb)).toBeLessThan(0.03);
    }
  });

  it('体質と運は0〜100の整数で、平均がおおむね50', () => {
    for (const key of ['constitution', 'luck'] as const) {
      for (const r of rolls) {
        expect(Number.isInteger(r[key])).toBe(true);
        expect(r[key]).toBeGreaterThanOrEqual(0);
        expect(r[key]).toBeLessThanOrEqual(100);
      }
      const mean = rolls.reduce((a, r) => a + r[key], 0) / N;
      expect(Math.abs(mean - 50)).toBeLessThan(1);
    }
  });

  it('奨学金は専門卒・大卒の約50%だけで、無利子が約35%', () => {
    expect(rolls.filter((r) => r.education === 'high' || r.education === 'junior_high').every((r) => r.studentLoan === null)).toBe(true);
    for (const id of ['vocational', 'university'] as const) {
      const group = rolls.filter((r) => r.education === id);
      expect(Math.abs(group.filter((r) => r.studentLoan).length / group.length - 0.5)).toBeLessThan(0.03);
    }
    const loans = rolls.flatMap((r) => (r.studentLoan ? [r.studentLoan] : []));
    expect(Math.abs(loans.filter((l) => l.interestFree).length / loans.length - 0.35)).toBeLessThan(0.03);
  });

  it('奨学金の月額: 300万円なら無利子12,500円、有利子(年1%)約13,797円', () => {
    const univ = rolls.filter((r) => r.education === 'university' && r.studentLoan);
    const free = univ.find((r) => r.studentLoan!.interestFree)!.studentLoan!;
    const paid = univ.find((r) => !r.studentLoan!.interestFree)!.studentLoan!;
    expect(free).toEqual({ amount: 3_000_000, interestFree: true, annualRate: 0, monthlyPayment: 12_500 });
    expect(paid.amount).toBe(3_000_000);
    expect(paid.annualRate).toBe(0.01);
    expect(paid.monthlyPayment).toBe(13_797);
  });

  it('初期の現金は実家の太さどおり', () => {
    for (const r of rolls.slice(0, 200)) {
      expect(r.initialCash).toBe(defaultData.family.find((f) => f.tier === r.familyTier)!.initialCash);
    }
  });
});

describe('createGame', () => {
  const univLoan = rolls.find((r) => r.education === 'university' && r.studentLoan && r.hasCar)!;

  it('初期ステータス・年齢・資産が仕様どおり', () => {
    const s = createGame(univLoan, values, policy, 'テスト');
    expect(s.startAge).toBe(22);
    expect(s.ageMonths).toBe(22 * 12);
    expect(s.month).toBe(0);
    expect(s.stats).toEqual({ health: univLoan.constitution, stress: 20, skill: 10, credit: 50, relations: 50 });
    expect(s.assets).toEqual({
      cash: univLoan.initialCash,
      index: 0,
      stocks: 0,
      speculative: 0,
      debt: 0,
      studentLoan: 3_000_000,
    });
    expect(s.character.studentLoan).toEqual({
      interestFree: univLoan.studentLoan!.interestFree,
      annualRate: univLoan.studentLoan!.annualRate,
      monthlyPayment: univLoan.studentLoan!.monthlyPayment,
    });
    expect(s.character.region).toBe(univLoan.region);
    expect(s.character.spouse).toBeNull();
    expect(s.flags.hasCar).toBe(true);
    expect(s.flags.payMul).toBe(1);
    expect(s.flags.parentAlive).toBe(true);
    expect(s.adaptedSpending).toBe(realLivingSpending(s));
    expect(s.log).toEqual([]);
  });

  it('開始年齢は学歴で決まる', () => {
    for (const e of defaultData.education) {
      const roll = rolls.find((r) => r.education === e.id)!;
      expect(createGame(roll, values, policy, 'x').startAge).toBe(e.startAge);
    }
  });

  it('人生の乱数列はガチャと別で、seed から決まる', () => {
    const s = createGame(univLoan, values, policy, 'x');
    expect(s.rngState).toBe(deriveSeed(univLoan.seed, 'life'));
    expect(s.rngState).not.toBe(deriveSeed(univLoan.seed, 'gacha'));
  });

  it('価値観は-2〜+2にクランプし、引数の方針を書き換えない', () => {
    const p: Policy = { ...policy };
    const s = createGame(univLoan, { risk: 5, relation: -3, spending: 1.5, work: -2 }, p, 'x');
    expect(s.values).toEqual({ risk: 2, relation: -2, spending: 1.5, work: -2 });
    s.policy.work = 'grind';
    expect(p.work).toBe('normal');
  });

  it('慣れの初期値は開始時の生活費(支出方針で変わる)', () => {
    const normal = createGame(univLoan, values, policy, 'x').adaptedSpending;
    const lavish = createGame(univLoan, values, { ...policy, spending: 'lavish' }, 'x').adaptedSpending;
    expect(lavish).toBeGreaterThan(normal);
  });

  it('GameState は JSON で往復できる(セーブ用)', () => {
    const s = createGame(univLoan, values, policy, 'x');
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
