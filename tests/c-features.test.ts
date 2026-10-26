import { describe, expect, it } from 'vitest';
import { defaultData } from '../src/data/index';
import { applyChoice, availableChoices, isEligible } from '../src/engine/events';
import { calcExpenses, calcIncome, applyMonthlyMoney, declareBankruptcy, takeLoan } from '../src/engine/money';
import { allocationOf, normalizePolicy } from '../src/engine/policy';
import { createRng } from '../src/engine/rng';
import { effectiveWork } from '../src/engine/stats';
import { changePolicy, getMonthlyView, stepMonth } from '../src/engine/step';
import type { EventDef } from '../src/engine/types';
import { netWorth } from '../src/engine/util';
import { flatRng, makeState, setAge } from './helpers';

const byId = (id: string): EventDef => defaultData.events.find((e) => e.id === id)!;

describe('投資の配分', () => {
  it('1つの資産名は100%、配分は10%刻み・合計100に直す', () => {
    expect(allocationOf('stocks')).toEqual({ deposit: 0, index: 0, stocks: 100, speculative: 0 });
    expect(allocationOf({ deposit: 0, index: 72, stocks: 0, speculative: 0 })).toEqual({ deposit: 30, index: 70, stocks: 0, speculative: 0 });
    expect(allocationOf({ deposit: 50, index: 50, stocks: 30, speculative: 0 })).toEqual({ deposit: 20, index: 50, stocks: 30, speculative: 0 });
    expect(normalizePolicy({ work: 'normal', spending: 'normal', invest: 'index', health: 'normal' }).prepay).toBe(false);
  });

  it('投資に回す分を配分どおりに振り分け、預金の分は現金に残す', () => {
    const s = makeState({}, { invest: { deposit: 20, index: 50, stocks: 30, speculative: 0 } });
    const { income, expenses } = applyMonthlyMoney(s, flatRng);
    const budget = Math.round((income.total - expenses.total) * 0.5);
    expect(s.assets.index).toBe(Math.round(budget * 0.5));
    expect(s.assets.stocks).toBe(Math.round(budget * 0.3));
    expect(s.assets.speculative).toBe(0);
    expect(s.invested).toEqual({ index: s.assets.index, stocks: s.assets.stocks, speculative: 0 });
  });

  it('方針変更のログに配分が出る', () => {
    const s = changePolicy(makeState(), { work: 'normal', spending: 'normal', invest: { deposit: 30, index: 70, stocks: 0, speculative: 0 }, health: 'normal', prepay: true });
    expect(s.log.at(-1)!.text).toContain('預金30%・積立70%・繰上げ返済あり');
  });
});

describe('ローン', () => {
  it('審査に通れば残高と毎月の返済が増え、純資産から引かれる', () => {
    const s = makeState();
    expect(takeLoan(s, 1_200_000, 60)).toBe(true);
    expect(s.assets.loan).toBe(1_200_000);
    expect(s.character.loanPayment).toBeGreaterThan(20_000);
    expect(calcExpenses(s).loan).toBe(s.character.loanPayment);
    expect(netWorth(s.assets)).toBe(-1_200_000);
  });

  it('60回で返し終わり、返済が止まる', () => {
    const s = makeState();
    takeLoan(s, 1_200_000, 60);
    let months = 0;
    while ((s.assets.loan ?? 0) > 0 && months < 100) {
      applyMonthlyMoney(s, flatRng);
      months++;
    }
    expect(months).toBe(60);
    expect(s.character.loanPayment).toBe(0);
    expect(calcExpenses(s).loan).toBe(0);
  });

  it('信用が低い・ブラックリスト中は審査に通らない。ローンの選択肢は理由つきで選べない', () => {
    const s = makeState();
    s.stats.credit = 10;
    s.flags.partner = true;
    const bridal = availableChoices(byId('proposal'), s).find((c) => c.index === 1)!; // ブライダルローン
    expect(bridal.blocked).toBe('審査に通らない(信用が足りない)');
    expect(() => applyChoice(s, byId('proposal'), 1, createRng(1))).toThrow();

    const t = makeState();
    t.flags.blacklist = 10;
    expect(takeLoan(t, 1_000_000, 60)).toBe(false);
  });

  it('ブライダルローンで結婚すると、式代は現金ではなくローンになる', () => {
    const s = makeState();
    s.flags.partner = true;
    applyChoice(s, byId('proposal'), 1, createRng(1));
    expect(s.character.married).toBe(true);
    expect(s.assets.cash).toBe(0);
    expect(s.assets.loan).toBe(2_000_000);
  });

  it('自己破産でローンも消える', () => {
    const s = makeState();
    takeLoan(s, 1_000_000, 60);
    declareBankruptcy(s);
    expect(s.assets.loan).toBe(0);
    expect(s.character.loanPayment).toBe(0);
  });
});

describe('繰上げ返済', () => {
  it('投資に回す分で、ローン → 奨学金の順に先に返す', () => {
    const s = makeState(
      { studentLoan: { amount: 3_000_000, interestFree: true, annualRate: 0, monthlyPayment: 12_500 } },
      { invest: 'index', prepay: true },
    );
    takeLoan(s, 2_000, 12);
    const loanBefore = s.assets.loan!;
    const studentBefore = s.assets.studentLoan;
    applyMonthlyMoney(s, flatRng);
    expect(s.assets.loan).toBe(0);
    expect(s.assets.studentLoan).toBeLessThan(studentBefore - 12_500);
    expect(s.assets.index).toBe(0); // 返済に使い切った
    expect(loanBefore).toBe(2_000);
  });

  it('繰上げ返済しない方針なら、決まった額だけ返して残りは積み立てる', () => {
    const s = makeState(
      { studentLoan: { amount: 3_000_000, interestFree: true, annualRate: 0, monthlyPayment: 12_500 } },
      { invest: 'index', prepay: false },
    );
    applyMonthlyMoney(s, flatRng);
    expect(s.assets.studentLoan).toBe(3_000_000 - 12_500);
    expect(s.assets.index).toBeGreaterThan(0);
  });
});

describe('再雇用', () => {
  function retiredAt65() {
    let s = setAge(makeState({ job: 'sales' }, { work: 'grind' }), 65);
    s.ageMonths = 65 * 12 - 1;
    s.character.lastMonthlyPay = 400_000;
    s = stepMonth(s, createRng(1));
    return s;
  }

  /** 再雇用の話(選択待ち)を片づけてから進める */
  function settle(s: ReturnType<typeof retiredAt65>) {
    delete s.pendingEvent;
    return s;
  }

  it('65歳で定年すると再雇用の話が来る(会社員だった人だけ、1回だけ)', () => {
    const s = retiredAt65();
    expect(s.character.retired).toBe(true);
    expect(s.pendingEvent?.eventId).toBe('rehire_offer');
    expect(isEligible(byId('rehire_offer'), settle(s))).toBe(false); // 1回だけ
    const none = setAge(makeState(), 65);
    none.character.retired = true;
    none.character.job = 'none';
    expect(isEligible(byId('rehire_offer'), none)).toBe(false);
  });

  it('再雇用中は年金に加えて、退職前の月給の半分(手取り)が入り、働き方は定時扱い', () => {
    const s = settle(retiredAt65());
    const before = calcIncome(s);
    applyChoice(s, byId('rehire_offer'), 0, flatRng);
    const after = calcIncome(s);
    expect(after.pension).toBe(before.pension);
    expect(after.salary).toBe(Math.round(200_000 * 0.8));
    expect(effectiveWork(s)).toBe('regular');
    expect(getMonthlyView(s).jobLabel).toBe('再雇用(営業)');
  });

  it('5年(60ヶ月)で終わり、普通の退職後に戻る', () => {
    let s = settle(retiredAt65());
    s.flags.rehire = 1;
    s = stepMonth(s, createRng(2));
    expect(s.flags.rehire).toBe(0);
    expect(calcIncome(s).salary).toBe(0);
    expect(effectiveWork(s)).toBeNull();
  });
});
