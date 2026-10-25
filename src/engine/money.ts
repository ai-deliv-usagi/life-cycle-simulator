// お金の計算(SPEC.md「お金の計算」、DESIGN.md §4 の 2〜5・§5.1・§5.2・§5.5〜§5.7)
//
// calc 系の関数は state を読むだけ。apply 系の関数は stepMonth が複製した state を直接更新する
// (stepMonth の外から呼ぶときは呼び出し側で複製すること)。
import { defaultData } from '../data/index';
import { recordSeverance } from './ledger';
import type { Rng } from './rng';
import type { GameData, GameState, JobDef, JobId, RegionDef } from './types';
import { addLog, ageYears, annuityPayment, clamp, clampStat, findById, roundYen } from './util';

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

/** 定年後に再雇用で働いている(年金と給料の両方がある) */
export function isRehired(state: GameState): boolean {
  return state.character.retired && num(state, 'rehire', 0) > 0;
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

/** 年間のボーナスが月給の何ヶ月分か(無職・バイトは0) */
function bonusMonths(state: GameState, data: GameData): number {
  const job = jobDef(state.character.job, data);
  return job && !state.character.retired ? job.bonusMonths : 0;
}

/** 額面の月給(ボーナスを除く)。年収 = 月給 × (12 + ボーナスの月数) */
export function monthlyGrossPay(state: GameState, data: GameData = defaultData): number {
  return roundYen(annualGross(state, data) / (12 + bonusMonths(state, data)));
}

/** 暦の月(1〜12)。ゲームは4月に始まる */
export function calendarMonthOf(state: GameState, data: GameData = defaultData): number {
  return ((data.balance.bonus.startCalendarMonth - 1 + state.month) % 12) + 1;
}

/** 今月のボーナス(額面)。6月と12月に年間の半分ずつ */
export function bonusGross(state: GameState, data: GameData = defaultData): number {
  const months = bonusMonths(state, data);
  const b = data.balance.bonus;
  if (months <= 0 || !b.months.includes(calendarMonthOf(state, data))) return 0;
  return roundYen((monthlyGrossPay(state, data) * months) / b.months.length);
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
  salary: number; // 本人の給与の手取り(ボーナスを除く)
  bonus: number; // ボーナスの手取り(6月・12月)
  pension: number; // 年金の手取り(世帯)
  unemployment: number; // 失業給付
  spouse: number; // 配偶者の手取り + 配偶者控除による本人の手取り増
  family: number; // 実家からの仕送り
  total: number;
}

export function calcIncome(state: GameState, data: GameData = defaultData): MonthlyIncome {
  const c = state.character;
  const { balance } = data;
  let annual = annualGross(state, data);
  let monthly = monthlyGrossPay(state, data);
  if (isRehired(state)) {
    monthly = roundYen(c.lastMonthlyPay * balance.rehire.payRate); // 再雇用は退職前の月給の一定割合(ボーナスなし)
    annual = monthly * 12;
  }
  const rate = takeHomeRate(annual, data);
  const salary = roundYen(monthly * rate);
  const bonus = roundYen(bonusGross(state, data) * rate);
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

  return { salary, bonus, pension, unemployment, spouse, family, total: salary + bonus + pension + unemployment + spouse + family };
}

// ---- 支出 ----

function findFamily(state: GameState, data: GameData) {
  const f = data.family.find((x) => x.tier === state.character.familyTier);
  if (!f) throw new Error(`unknown family tier: ${state.character.familyTier}`);
  return f;
}

function spendingMul(state: GameState, data: GameData, welfare: boolean): number {
  // 生活保護中と、自己破産後に借りられない期間(ブラックリスト)は節約に固定
  const policy = welfare || num(state, 'blacklist', 0) > 0 ? 'frugal' : state.policy.spending;
  return data.balance.spending[policy].living;
}

/** 生活費以外の決まった支出(車・健康費・実家への送金・親への仕送り・奨学金・ローン) */
function obligations(state: GameState, data: GameData) {
  const { balance } = data;
  const region = regionDef(state, data);
  const transfer = findFamily(state, data).monthlyTransfer;
  return {
    car: bool(state, 'hasCar') ? region.carMonthlyCost : 0,
    health: balance.healthCare[state.policy.health].cost,
    remittance: transfer < 0 && bool(state, 'parentAlive') ? -transfer : 0,
    parentSupport: num(state, 'parentSupport', 0) > 0 ? balance.timers.parentSupport.monthlyCost : 0,
    studentLoan: studentLoanPayment(state).payment,
    loan: loanPayment(state, data).payment,
  };
}

/**
 * 生活費(実質)= 最低限の生活費(固定分) + (自由に使える手取り − 固定分)× 割合 × 支出方針の係数
 *               + ボーナス × ボーナスで使う割合 × 支出方針の係数(ボーナス月だけ)。
 * 収入が多いほど生活水準も上がり、車やローンがある人はそのぶん生活費を抑える。
 * 生活保護中は支出方針に関係なく「節約」。
 */
/** 生活費(物価を掛ける前)。最低限の生活費は地域係数込み(家賃の差)で先に取る */
function livingNominal(state: GameState, data: GameData, welfare: boolean): number {
  const l = data.balance.living;
  const fixed = (state.character.married ? l.married : l.single) * regionDef(state, data).livingMul;
  const o = obligations(state, data);
  const committed = o.car + o.health + o.remittance + o.parentSupport + o.studentLoan + o.loan;
  // 毎月の生活費は月々の収入で決める。ボーナス月はボーナスの一部を使う(残りは貯まる)
  const inc = calcIncome(state, data);
  const disposable = Math.max(0, inc.total - inc.bonus - committed);
  const mul = spendingMul(state, data, welfare);
  // 固定分は最低限の生活費として先に取り、残りの一定割合を使う(普通・節約なら月々の収入を超えない)
  const bonusSpend = Math.min(1, l.bonusSpendShare * mul) * inc.bonus; // ボーナス以上は使わない
  return fixed + l.incomeShare * Math.max(0, disposable - fixed) * mul + bonusSpend;
}

/** 幸福度の生活水準に使う実質の生活費(地域の家賃差・物価・決まった支出を除く。DESIGN.md §5.4) */
export function realLivingSpending(state: GameState, data: GameData = defaultData): number {
  const l = data.balance.living;
  const floor = state.character.married ? l.married : l.single;
  const rentGap = floor * (regionDef(state, data).livingMul - 1);
  return roundYen(livingNominal(state, data, bool(state, 'welfare')) - rentGap);
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

/** 今月のローンの返済額(利息込み)と、そのうち元本に充てる額 */
function loanPayment(state: GameState, data: GameData): { payment: number; principal: number } {
  const balance = state.assets.loan ?? 0;
  const monthly = state.character.loanPayment ?? 0;
  if (balance <= 0 || monthly <= 0) return { payment: 0, principal: 0 };
  const interest = roundYen((balance * data.balance.loan.annualRate) / 12);
  // 最終回: 残りが返済額以下、または円の丸めで数円だけ残る場合はまとめて返す
  if (balance + interest - monthly < monthly * 0.01) return { payment: balance + interest, principal: balance };
  return { payment: monthly, principal: monthly - interest };
}

/** ローンを組む。審査(信用・ブラックリスト)に通れば true。落ちたら何もしない */
export function takeLoan(state: GameState, amount: number, months: number, data: GameData = defaultData): boolean {
  const cfg = data.balance.loan;
  if (state.stats.credit < cfg.minCredit || num(state, 'blacklist', 0) > 0) return false;
  state.assets.loan = (state.assets.loan ?? 0) + amount;
  state.character.loanPayment = (state.character.loanPayment ?? 0) + annuityPayment(amount, cfg.annualRate, months);
  return true;
}

/** 繰上げ返済。使える額のうち、ローン → 奨学金の順に返し、使った額を返す */
function prepay(state: GameState, budget: number): number {
  const a = state.assets;
  let used = 0;
  const loan = Math.min(budget, a.loan ?? 0);
  if (loan > 0) {
    a.loan = (a.loan ?? 0) - loan;
    used += loan;
    if (a.loan <= 0) state.character.loanPayment = 0;
  }
  const student = Math.min(budget - used, a.studentLoan);
  if (student > 0) {
    a.studentLoan -= student;
    used += student;
  }
  a.cash -= used;
  return used;
}

export interface MonthlyExpenses {
  living: number;
  car: number;
  health: number;
  remittance: number; // 実家への送金
  parentSupport: number; // 親の病気の仕送り
  studentLoan: number;
  loan: number;
  total: number;
}

export function calcExpenses(
  state: GameState,
  data: GameData = defaultData,
  welfare: boolean = bool(state, 'welfare'),
): MonthlyExpenses {
  // 地域の生活費係数は最低限の生活費(主に家賃)にだけ掛ける。収入に応じた分は、地域の給料の差にすでに含まれている
  const living = roundYen(livingNominal(state, data, welfare) * num(state, 'priceLevel', 1));
  const { car, health, remittance, parentSupport, studentLoan, loan } = obligations(state, data);
  return {
    living,
    car,
    health,
    remittance,
    parentSupport,
    studentLoan,
    loan,
    total: living + car + health + remittance + parentSupport + studentLoan + loan,
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
  debtInterest: number;
  invested: number;
  prepaid: number;
  returns: number; // 運用損益(預金の利息を含む)
  welfare: number; // 生活保護で補った額
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
    c.lastMonthlyPay = monthlyGrossPay(state, data);
    c.jobYears += 1 / 12;
    if (jobDef(c.job, data)?.employeePension) {
      // 厚生年金はボーナスも含めた平均(年収/12)で計算する
      const avg = roundYen(annualGross(state, data) / 12);
      c.pensionMonths += 1;
      c.avgMonthlyPay += (avg - c.avgMonthlyPay) / c.pensionMonths;
    }
  }
  const income = calcIncome(state, data);

  // 3. 支出
  const expenses = calcExpenses(state, data);
  a.studentLoan -= studentLoanPayment(state).principal;
  const loanPrincipal = loanPayment(state, data).principal;
  if (loanPrincipal > 0) {
    a.loan = (a.loan ?? 0) - loanPrincipal;
    if (a.loan <= 0) c.loanPayment = 0;
  }
  a.cash += income.total - expenses.total;

  // 4. 借金の利息と返済、積立、運用リターン
  const debtInterest = roundYen((a.debt * balance.debtAnnualRate) / 12);
  a.debt += debtInterest;
  let invested = 0;
  let prepaid = 0;
  let surplus = income.total - expenses.total;
  if (surplus > 0 && a.debt > 0) {
    const repay = Math.max(0, Math.min(surplus, a.debt, a.cash));
    a.debt -= repay;
    a.cash -= repay;
    surplus -= repay;
  }
  if (surplus > 0) {
    // 余剰のうち投資に回す分。繰上げ返済するなら先にローン・奨学金を返し、残りを配分どおりに積み立てる
    let budget = Math.min(roundYen(surplus * balance.investShare), Math.max(0, a.cash));
    if (state.policy.prepay) {
      prepaid = prepay(state, budget);
      budget -= prepaid;
    }
    const alloc = state.policy.invest;
    for (const key of ['index', 'stocks', 'speculative'] as const) {
      const amount = roundYen((budget * alloc[key]) / 100);
      if (amount <= 0) continue;
      a.cash -= amount;
      a[key] += amount;
      invested += amount;
      if (state.invested) state.invested[key] += amount;
    }
  }
  const returns = applyReturns(state, rng, data);

  // 5. 資金ショート
  if (a.cash < 0) {
    for (const key of ['index', 'stocks', 'speculative'] as const) {
      const sell = Math.min(a[key], -a.cash);
      // 売った割合だけ元本も減らす
      if (state.invested && a[key] > 0) state.invested[key] = roundYen(state.invested[key] * (1 - sell / a[key]));
      a[key] -= sell;
      a.cash += sell;
      if (a.cash >= 0) break;
    }
  }
  // 生活保護は「節約しても収入で暮らせない」ときの下限。それ以外の不足は借金になる
  const minimalLiving = calcExpenses(state, data, true).total;
  let welfare = 0;
  if (a.cash < 0) {
    if (income.total < minimalLiving) {
      welfare = -a.cash;
      a.cash = 0;
      state.flags.welfare = true;
    } else {
      a.debt += -a.cash;
      a.cash = 0;
    }
  }
  // 免責から7年は再び自己破産できない(借金は延滞として残る)
  if (a.debt > debtLimit(state, data) && num(state, 'blacklist', 0) <= 0) declareBankruptcy(state, data);
  if (bool(state, 'welfare') && income.total >= minimalLiving) state.flags.welfare = false;

  return { income, expenses, debtInterest, invested, prepaid, returns, welfare };
}

/** 運用リターン。乱数の消費を保有額によらず一定にして、方針を変えても乱数列がずれないようにする */
/** 運用リターンを反映し、増えた額(減ったらマイナス。預金の利息を含む)を返す */
export function applyReturns(state: GameState, rng: Rng, data: GameData = defaultData): number {
  const cfg = data.balance.assets;
  const a = state.assets;
  const before = a.cash + a.index + a.stocks + a.speculative;
  if (a.cash > 0) a.cash += roundYen((a.cash * cfg.cash.mu) / 12);
  for (const key of ['index', 'stocks', 'speculative'] as const) {
    const r = rng.normal(cfg[key].mu / 12, cfg[key].sigma / Math.sqrt(12));
    a[key] = Math.max(0, roundYen(a[key] * (1 + r)));
  }
  if (rng.chance(cfg.speculative.crashProb)) {
    a.speculative = roundYen(a.speculative * (1 + cfg.speculative.crashPct));
  }
  return a.cash + a.index + a.stocks + a.speculative - before;
}

export function declareBankruptcy(state: GameState, data: GameData = defaultData): void {
  state.assets.debt = 0;
  state.assets.loan = 0; // ローンも免責される(奨学金は保証機関が残す扱いで残る)
  state.character.loanPayment = 0;
  state.stats.credit = 0;
  state.stats.stress = clampStat(state.stats.stress + data.balance.bankruptcy.stress);
  state.flags.bankrupt = true;
  state.flags.blacklist = data.balance.bankruptcy.blacklistMonths;
  addLog(state, 'event', '自己破産: 借金が返せなくなり、自己破産した', 'bankruptcy');
}

// ---- 退職・転職 ----

/** 65歳の退職。退職金を受け取る */
export function retire(state: GameState, data: GameData = defaultData): void {
  const severance = severancePay(state, data);
  state.assets.cash += severance;
  recordSeverance(state, severance);
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
  const severance = severancePay(state, data);
  state.assets.cash += severance;
  recordSeverance(state, severance);
  if (c.job !== 'none') c.previousJob = c.job;
  c.job = newJob;
  c.jobYears = 0;
  state.flags.payMul = 1;
  state.flags.rank = 0; // 役職は転職でリセット
  state.flags.unemploymentBenefit = newJob === 'none' ? data.balance.unemployment.months : 0;
}
