// 1年分の収支(年間サマリーの内訳用)。stepMonth が毎月足し、年の切れ目で lastLedger に移す
import type { MonthlyExpenses, MonthlyIncome } from './money';
import type { GameState } from './types';

export type IncomeKey = Exclude<keyof MonthlyIncome, 'total'> | 'severance';
export type ExpenseKey = Exclude<keyof MonthlyExpenses, 'total'>;

export interface YearLedger {
  income: Record<IncomeKey, number>;
  expenses: Record<ExpenseKey, number>;
  debtInterest: number; // カードローンの利息
  eventIn: number; // イベントでの臨時収入(相続・ボーナス・当選など)
  eventOut: number; // イベントでの出費(結婚式・家電・入院など)
  invested: number; // 投資に回した額
  prepaid: number; // 繰上げ返済した額
  returns?: number; // 運用損益(値上がり・値下がり・預金の利息)。古いセーブにはない
  welfare?: number; // 生活保護で補った額
  investTax?: number; // 特定口座で売ったときの税金(第2弾)
}

export function emptyLedger(): YearLedger {
  return {
    income: { salary: 0, bonus: 0, pension: 0, unemployment: 0, spouse: 0, family: 0, childAllowance: 0, parentalLeave: 0, housingDeduction: 0, severance: 0 },
    expenses: { living: 0, car: 0, health: 0, remittance: 0, parentSupport: 0, studentLoan: 0, loan: 0, children: 0, mortgage: 0, homeCost: 0 },
    debtInterest: 0,
    eventIn: 0,
    eventOut: 0,
    invested: 0,
    prepaid: 0,
    returns: 0,
    welfare: 0,
    investTax: 0,
  };
}

export function cloneLedger(l: YearLedger): YearLedger {
  return { ...l, income: { ...l.income }, expenses: { ...l.expenses } };
}

/** 古いセーブには ledger がないので、必要になったときに作る */
function ledgerOf(state: GameState): YearLedger {
  state.ledger ??= emptyLedger();
  return state.ledger;
}

export interface MonthMoney {
  income: MonthlyIncome;
  expenses: MonthlyExpenses;
  debtInterest: number;
  invested: number;
  prepaid: number;
  returns: number;
  welfare: number;
  investTax: number;
}

export function recordMonth(state: GameState, m: MonthMoney): void {
  const l = ledgerOf(state);
  for (const k of Object.keys(m.income) as (keyof MonthlyIncome)[]) {
    if (k !== 'total') l.income[k] = (l.income[k] ?? 0) + m.income[k];
  }
  for (const k of Object.keys(m.expenses) as (keyof MonthlyExpenses)[]) {
    if (k !== 'total') l.expenses[k] = (l.expenses[k] ?? 0) + m.expenses[k]; // 古いセーブの ledger にないキーもある
  }
  l.debtInterest += m.debtInterest;
  l.invested += m.invested;
  l.prepaid += m.prepaid;
  l.returns = (l.returns ?? 0) + m.returns;
  l.welfare = (l.welfare ?? 0) + m.welfare;
  l.investTax = (l.investTax ?? 0) + m.investTax;
}

/** イベントでの現金の出入り */
export function recordEventCash(state: GameState, amount: number): void {
  if (amount === 0) return;
  const l = ledgerOf(state);
  if (amount > 0) l.eventIn += amount;
  else l.eventOut += -amount;
}

export function recordSeverance(state: GameState, amount: number): void {
  if (amount > 0) ledgerOf(state).income.severance += amount;
}

/** 月の処理の外(手で売ったとき)の税金 */
export function recordInvestTax(state: GameState, tax: number): void {
  if (tax > 0) {
    const l = ledgerOf(state);
    l.investTax = (l.investTax ?? 0) + tax;
  }
}

/** 年の切れ目: 今年の分を lastLedger に移して、新しい年を始める */
export function closeYear(state: GameState): void {
  state.lastLedger = ledgerOf(state);
  state.ledger = emptyLedger();
}

export function ledgerTotals(l: YearLedger): { income: number; expenses: number } {
  const income = Object.values(l.income).reduce((a, b) => a + b, 0) + l.eventIn + (l.welfare ?? 0);
  const expenses = Object.values(l.expenses).reduce((a, b) => a + b, 0) + l.debtInterest + l.eventOut + (l.investTax ?? 0);
  return { income, expenses };
}
