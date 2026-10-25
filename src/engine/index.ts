// engine の公開API(DESIGN.md §2)。UI と scripts/balance.ts はここからだけ import する。
export { defaultData as gameData } from '../data/index';
export { availableChoices } from './events';
export { computeHappiness, HAPPINESS_PARTS, happinessParts } from './happiness';
export { computeResult, DEATH_CAUSE_LABELS, LIFE_TYPE_LABELS } from './result';
export { createRng, deriveSeed, type Rng } from './rng';
export { createGame, rollCharacter } from './setup';
export { emptyLedger, ledgerTotals, type ExpenseKey, type IncomeKey, type YearLedger } from './ledger';
export { allocationOf, INVEST_KEYS, normalizePolicy } from './policy';
export { allocationLabel, changePolicy, getMonthlyView, isYearEnd, POLICY_LABELS, resolveChoice, stepMonth, type MonthlyView } from './step';
export type * from './types';
