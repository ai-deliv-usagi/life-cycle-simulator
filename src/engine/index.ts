// engine の公開API(DESIGN.md §2)。UI と scripts/balance.ts はここからだけ import する。
export { defaultData as gameData } from '../data/index';
export { availableChoices, choiceCost, selectableChoices, type ChoiceCost } from './events';
export { computeHappiness, HAPPINESS_PARTS, happinessParts, happinessWeights } from './happiness';
export { computeResult, DEATH_CAUSE_LABELS, LIFE_TYPE_LABELS } from './result';
export { createRng, deriveSeed, type Rng } from './rng';
export { createGame, rollCharacter } from './setup';
export type { MonthlyIncome } from './money';
export { debtRates } from './money';
export { emptyLedger, ledgerTotals, type ExpenseKey, type IncomeKey, type YearLedger } from './ledger';
export { allocationOf, INVEST_KEYS, normalizePolicy } from './policy';
export { nisaRoom, nisaValue } from './nisa';
export { businessValue, ownerSalary } from './business';
export { allocationLabel, buyAsset, changePolicy, sellAsset, type InvestKey, getMonthlyView, isYearEnd, POLICY_LABELS, resolveChoice, stepMonth, type MonthlyView } from './step';
export type * from './types';
export { netWorth } from './util';
export { monthsToRepay, upcoming, type Upcoming } from './upcoming';
