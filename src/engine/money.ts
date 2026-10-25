// お金の計算(SPEC.md「お金の計算」、DESIGN.md §4 の 2〜5・§5.1・§5.2・§5.5〜§5.7)
//
// calc 系の関数は state を読むだけ。apply 系の関数は stepMonth が複製した state を直接更新する
// (stepMonth の外から呼ぶときは呼び出し側で複製すること)。
import { defaultData } from '../data/index';
import type { Rng } from './rng';
import type { GameData, GameState, JobDef, JobId, RegionDef } from './types';
import { addLog, ageYears, clamp, clampStat, findById, roundYen } from './util';

// ---- 参照 ----

function jobDef(job: JobId, data: GameData): JobDef | null {
  return job === 'none' ? null : findById(data.jobs, job, 'job');
}

function regionDef(state: GameState, data: GameData): RegionDef {
  return findById(data.regions, state.character.region, 'region');
}

function num(state: GameState, key: string, fallback: number): number {
  const v = state.flags[key];
  return typeof v === 'number' ? v : fallback;
}

function bool(state: GameState, key: string): boolean {
  return state.flags[key] === true;
}

export function isEmployed(state: GameState): boolean {
  return state.character.job !== 'none' && !state.character.retired;
}

// ---- 収入 ----

/** 額面年収(DESIGN.md §5.1)。無職・退職後は0 */
export function annualGross(state: GameState, data: GameData = defaultData): number {
  const job = jobDef(state.character.job, data);
  if (!job || state.character.retired) return 0;
  const { balance } = data;
  const edu = findById(data.education, state.character.education, 'education');
  const age = ageYears(state);
  const { peakAge, skillBase, skillRange } = balance.salary;
  const progress = clamp((age - state.startAge) / (peakAge - state.startAge), 0, 1);
  const start = job.startPay * edu.startPayMul;
  const peak = job.peakPay * edu.raiseMul;
  const base = start + (peak - start) * progress;
  const skillMul = skillBase + (skillRange * state.stats.skill) / 100;
  return roundYen(
    base *
      balance.work[state.policy.work].income *
      skillMul *
      num(state, 'payMul', 1) *
      regionDef(state, data).payMul,
  );
}

export function monthlyGrossPay(state: GameState, data: GameData = defaultData): number {
  return roundYen(annualGross(state, data) / 12);
}

/** 額面年収の帯で決まる手取り率(境界は「未満」で判定) */
export function takeHomeRate(annual: number, data: GameData = defaultData): number {
  for (const band of data.balance.takeHome.bands) {
    if (band.below === null || annual < band.below) return band.rate;
  }
  throw new Error('takeHome.bands must end with below: null');
}

/** 基礎年金(本人分、月額) */
export function basicPension(state: GameState, data: GameData = defaultData): number {
  const p = data.balance.pension;
  const years = Math.min(p.basicYears, p.retireAge - state.startAge);
  return roundYen(p.basicFull * Math.min(1, years / p.basicYears));
}

/** 厚生年金(本人分、月額) */
export function employeePension(state: GameState, data: GameData = defaultData): number {
  const c = state.character;
  return roundYen((c.avgMonthlyPay * data.balance.pension.employeeRate * c.pensionMonths) / 12);
}

/** 年金の額面(世帯、月額)。配偶者分の基礎年金と、共働きなら配偶者の厚生年金を含む */
export function pensionMonthly(state: GameState, data: GameData = defaultData): number {
  const c = state.character;
  const { balance } = data;
  const basic = basicPension(state, data) * (c.married ? balance.pension.spouseBasicMul : 1);
  const spouseEmployee = c.married && c.spouse ? balance.spouse.types[c.spouse].employeePension : 0;
  return basic + employeePension(state, data) + spouseEmployee;
}

/** 退職金(勤続年数で按分)。バイト・無職は0 */
export function severancePay(state: GameState, data: GameData = defaultData): number {
  const job = jobDef(state.character.job, data);
  if (!job) return 0;
  return roundYen(job.severance * Math.min(1, state.character.jobYears / data.balance.severanceYears));
}

export interface MonthlyIncome {
  salary: number; // 本人の給与の手取り
  pension: number; // 年金の手取り(世帯)
  unemployment: number; // 失業給付
  spouse: number; // 配偶者の手取り + 配偶者控除による本人の手取り増
  family: number; // 実家からの仕送り
  total: number;
}

export function calcIncome(state: GameState, data: GameData = defaultData): MonthlyIncome {
  const c = state.character;
  const { balance } = data;
  const annual = annualGross(state, data);
  const salary = roundYen((annual / 12) * takeHomeRate(annual, data));
  const pension = c.retired ? roundYen(pensionMonthly(state, data) * balance.takeHome.pension) : 0;
  const unemployment =
    num(state, 'unemploymentBenefit', 0) > 0 ? roundYen(c.lastMonthlyPay * balance.unemployment.payRate) : 0;

  let spouse = 0;
  if (c.married && c.spouse && ageYears(state) < balance.pension.retireAge) {
    const t = balance.spouse.types[c.spouse];
    spouse = t.monthlyNet + (salary > 0 ? t.taxBenefit : 0); // 控除は本人に給与があるときだけ
  }

  const transfer = findFamily(state, data).monthlyTransfer;
  const family = transfer > 0 && bool(state, 'parentAlive') ? transfer : 0;

  return { salary, pension, unemployment, spouse, family, total: salary + pension + unemployment + spouse + family };
}

// ---- 支出 ----

function findFamily(state: GameState, data: GameData) {
  const f = data.family.find((x) => x.tier === state.character.familyTier);
  if (!f) throw new Error(`unknown family tier: ${state.character.familyTier}`);
  return f;
}

function spendingMul(state: GameState, data: GameData, welfare: boolean): number {
  const policy = welfare ? 'frugal' : state.policy.spending; // 生活保護中は節約に固定
  return data.balance.spending[policy].living;
}

function baseLiving(state: GameState, data: GameData): number {
  const l = data.balance.living;
  return state.character.married ? l.married : l.single;
}

/** 幸福度の生活水準に使う実質の生活費(地域差・物価・健康費・送金を除く。DESIGN.md §5.4) */
export function realLivingSpending(state: GameState, data: GameData = defaultData): number {
  return roundYen(baseLiving(state, data) * spendingMul(state, data, bool(state, 'welfare')));
}

/** 今月の奨学金の返済額(利息込み)と、そのうち元本に充てる額 */
function studentLoanPayment(state: GameState): { payment: number; principal: number } {
  const loan = state.character.studentLoan;
  const balance = state.assets.studentLoan;
  if (!loan || balance <= 0) return { payment: 0, principal: 0 };
  const interest = roundYen((balance * loan.annualRate) / 12);
  if (loan.monthlyPayment >= balance + interest) return { payment: balance + interest, principal: balance };
  return { payment: loan.monthlyPayment, principal: loan.monthlyPayment - interest };
}

export interface MonthlyExpenses {
  living: number;
  car: number;
  health: number;
  remittance: number; // 実家への送金
  parentSupport: number; // 親の病気の仕送り
  studentLoan: number;
  total: number;
}

export function calcExpenses(
  state: GameState,
  data: GameData = defaultData,
  welfare: boolean = bool(state, 'welfare'),
): MonthlyExpenses {
  const { balance } = data;
  const region = regionDef(state, data);
  const living = roundYen(
    baseLiving(state, data) * region.livingMul * spendingMul(state, data, welfare) * num(state, 'priceLevel', 1),
  );
  const car = bool(state, 'hasCar') ? region.carMonthlyCost : 0;
  const health = balance.healthCare[state.policy.health].cost;
  const transfer = findFamily(state, data).monthlyTransfer;
  const remittance = transfer < 0 && bool(state, 'parentAlive') ? -transfer : 0;
  const parentSupport = num(state, 'parentSupport', 0) > 0 ? balance.timers.parentSupport.monthlyCost : 0;
  const studentLoan = studentLoanPayment(state).payment;
  return {
    living,
    car,
    health,
    remittance,
    parentSupport,
    studentLoan,
    total: living + car + health + remittance + parentSupport + studentLoan,
  };
}

// ---- 月次の適用 ----

/** 借入上限(DESIGN.md §5.6) */
export function debtLimit(state: GameState, data: GameData = defaultData): number {
  const b = data.balance.bankruptcy;
  return Math.max(b.minLimit, roundYen(annualGross(state, data) * b.incomeShare));
}

export interface MoneyResult {
  income: MonthlyIncome;
  expenses: MonthlyExpenses;
}

/**
 * 1ヶ月分のお金を適用する(DESIGN.md §4 の 2〜5)。
 * 収入 → 支出 → 借金の利息と返済 → 積立 → 運用リターン → 資金ショート → 自己破産・生活保護
 */
export function applyMonthlyMoney(state: GameState, rng: Rng, data: GameData = defaultData): MoneyResult {
  const { balance } = data;
  const c = state.character;
  const a = state.assets;

  // 2. 収入。年金の記録もここで更新する
  if (isEmployed(state)) {
    const gross = monthlyGrossPay(state, data);
    c.lastMonthlyPay = gross;
    c.jobYears += 1 / 12;
    if (jobDef(c.job, data)?.employeePension) {
      c.pensionMonths += 1;
      c.avgMonthlyPay += (gross - c.avgMonthlyPay) / c.pensionMonths;
    }
  }
  const income = calcIncome(state, data);

  // 3. 支出
  const expenses = calcExpenses(state, data);
  a.studentLoan -= studentLoanPayment(state).principal;
  a.cash += income.total - expenses.total;

  // 4. 借金の利息と返済、積立、運用リターン
  a.debt += roundYen((a.debt * balance.debtAnnualRate) / 12);
  let surplus = income.total - expenses.total;
  if (surplus > 0 && a.debt > 0) {
    const repay = Math.max(0, Math.min(surplus, a.debt, a.cash));
    a.debt -= repay;
    a.cash -= repay;
    surplus -= repay;
  }
  const target = state.policy.invest;
  if (surplus > 0 && target !== 'deposit') {
    const amount = Math.min(roundYen(surplus * balance.investShare), Math.max(0, a.cash));
    a.cash -= amount;
    a[target] += amount;
  }
  applyReturns(state, rng, data);

  // 5. 資金ショート
  if (a.cash < 0) {
    for (const key of ['index', 'stocks', 'speculative'] as const) {
      const sell = Math.min(a[key], -a.cash);
      a[key] -= sell;
      a.cash += sell;
      if (a.cash >= 0) break;
    }
  }
  if (a.cash < 0) {
    if (bool(state, 'bankrupt')) {
      // 自己破産のあとは生活保護で補う(借金にしない)
      a.cash = 0;
      state.flags.welfare = true;
    } else {
      a.debt += -a.cash;
      a.cash = 0;
    }
  }
  if (a.debt > debtLimit(state, data)) declareBankruptcy(state, data);

  // 生活保護は、収入が通常の支出を上回った月に終わる
  if (bool(state, 'welfare') && income.total >= calcExpenses(state, data, false).total) {
    state.flags.welfare = false;
  }

  return { income, expenses };
}

/** 運用リターン。乱数の消費を保有額によらず一定にして、方針を変えても乱数列がずれないようにする */
export function applyReturns(state: GameState, rng: Rng, data: GameData = defaultData): void {
  const cfg = data.balance.assets;
  const a = state.assets;
  if (a.cash > 0) a.cash += roundYen((a.cash * cfg.cash.mu) / 12);
  for (const key of ['index', 'stocks', 'speculative'] as const) {
    const r = rng.normal(cfg[key].mu / 12, cfg[key].sigma / Math.sqrt(12));
    a[key] = Math.max(0, roundYen(a[key] * (1 + r)));
  }
  if (rng.chance(cfg.speculative.crashProb)) {
    a.speculative = roundYen(a.speculative * (1 + cfg.speculative.crashPct));
  }
}

export function declareBankruptcy(state: GameState, data: GameData = defaultData): void {
  state.assets.debt = 0;
  state.stats.credit = 0;
  state.stats.stress = clampStat(state.stats.stress + data.balance.bankruptcy.stress);
  state.flags.bankrupt = true;
  addLog(state, 'event', '自己破産: 借金が返せなくなり、自己破産した', 'bankruptcy');
}

// ---- 退職・転職 ----

/** 65歳の退職。退職金を受け取る */
export function retire(state: GameState, data: GameData = defaultData): void {
  state.assets.cash += severancePay(state, data);
  state.character.retired = true;
  state.character.jobYears = 0;
  state.flags.unemploymentBenefit = 0;
}

/**
 * 職を変える(転職・リストラ・再就職)。按分した退職金を払い、勤続年数と昇給をリセットする。
 * 無職になるとき(リストラ)は失業給付を始め、職に就いたら打ち切る。
 */
export function changeJob(state: GameState, newJob: JobId, data: GameData = defaultData): void {
  const c = state.character;
  if (newJob === c.job) return;
  state.assets.cash += severancePay(state, data);
  if (c.job !== 'none') c.previousJob = c.job;
  c.job = newJob;
  c.jobYears = 0;
  state.flags.payMul = 1;
  state.flags.unemploymentBenefit = newJob === 'none' ? data.balance.unemployment.months : 0;
}
