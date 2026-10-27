// お金の計算(SPEC.md「お金の計算」、DESIGN.md §4 の 2〜5・§5.1・§5.2・§5.5〜§5.7)
//
// calc 系の関数は state を読むだけ。apply 系の関数は stepMonth が複製した state を直接更新する
// (stepMonth の外から呼ぶときは呼び出し側で複製すること)。
import { defaultData } from '../data/index';
import { businessValue, endBusiness, ownerJob, ownerSalary } from './business';
import { homeOwnershipCost, housingDeduction, loseHome, mortgagePayment, ownsHome, rentPart, sellHome, updateHomeValue } from './housing';
import { childAllowance, childCost, parentalLeaveRate } from './children';
import { recordSeverance } from './ledger';
import { buyInvestment, resetNisaYear, sellForCash } from './nisa';
import { fixedInvestShares } from './policy';
import type { Rng } from './rng';
import type { Education, GameData, GameState, Invest, JobDef, JobId, RegionDef } from './types';
import { addLog, ageYears, annuityPayment, clamp, clampStat, findById, roundYen } from './util';

// ---- 参照 ----

function jobDef(job: JobId, data: GameData): JobDef | null {
  if (job === 'owner') return ownerJob(data);
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
/** 職業と学歴で決まる、その年齢の基準の年収(額面)。働き方・スキル・地域などを掛ける前 */
function careerBaseGross(job: JobDef, education: Education, age: number, startAge: number, data: GameData): number {
  const edu = findById(data.education, education, 'education');
  const { peakAge, declineFrom, declinePerYear } = data.balance.salary;
  const progress = clamp((age - startAge) / (peakAge - startAge), 0, 1);
  const start = job.startPay * edu.startPayMul;
  const peak = job.peakPay * edu.raiseMul;
  const decline = 1 - declinePerYear * Math.max(0, age - declineFrom); // 役職定年
  return (start + (peak - start) * progress) * decline;
}

export function annualGross(state: GameState, data: GameData = defaultData): number {
  const job = jobDef(state.character.job, data);
  if (!job || state.character.retired) return 0;
  if (job.id === 'owner') return ownerSalary(state, data) * 12; // 社長は会社の業績で決まる役員報酬
  const { balance } = data;
  const age = ageYears(state);
  const { skillBase, skillRange } = balance.salary;
  const base = careerBaseGross(job, state.character.education, age, state.startAge, data);
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

/**
 * 配偶者の毎月の手取り(ボーナスもならして含む)。共働きは職業・学歴の給料カーブ(本人と同い年)× 稼ぎの個人差、
 * 扶養内パートは基準額 × 個人差(年103万円の壁まで)。結婚したときの引きがない古いセーブは基準額
 */
export function spouseMonthlyNet(state: GameState, data: GameData = defaultData): number {
  const c = state.character;
  if (!c.married || !c.spouse) return 0;
  const s = data.balance.spouse;
  const t = s.types[c.spouse];
  const p = c.spouseProfile;
  if (!p || c.spouse === 'homemaker') return t.monthlyNet;
  if (c.spouse === 'parttime') return Math.min(s.parttimeMax, roundYen(t.monthlyNet * p.payMul));
  const job = jobDef(p.job, data);
  if (!job) return t.monthlyNet;
  const gross = careerBaseGross(job, p.education, ageYears(state), state.startAge, data) * p.payMul * regionDef(state, data).payMul;
  return roundYen((gross * takeHomeRate(gross, data)) / 12);
}

/** 共働きの配偶者の稼ぎが、基準(balance の monthlyNet)の何倍か。65歳で働き終えたときの額で見る */
function spouseIncomeRatio(state: GameState, data: GameData): number {
  const c = state.character;
  const p = c.spouseProfile;
  if (!p || c.spouse !== 'fulltime') return 1;
  const job = jobDef(p.job, data);
  if (!job) return 1;
  const gross = careerBaseGross(job, p.education, data.balance.pension.retireAge - 1, state.startAge, data) * p.payMul;
  return (gross * takeHomeRate(gross, data)) / 12 / data.balance.spouse.types.fulltime.monthlyNet;
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
  // 共働きの配偶者の厚生年金は、配偶者の稼ぎ(基準の手取りとの比)に合わせる
  const spouseType = c.married && c.spouse ? balance.spouse.types[c.spouse] : undefined;
  const spouseEmployee = spouseType && spouseType.employeePension > 0 ? roundYen(spouseType.employeePension * spouseIncomeRatio(state, data)) : 0;
  // 配偶者と死別したら遺族厚生年金。自分の厚生年金と多いほうを受け取る
  const own = Math.max(employeePension(state, data), num(state, 'survivorPension', 0));
  return basic + own + spouseEmployee;
}

/**
 * 退職金。勤続が長いほど伸びる(勤続年数の割合の severanceCurve 乗)。
 * 自分から辞める(転職・起業)ときは自己都合で減る(severanceVoluntaryRate)。バイト・無職は0
 */
export function severancePay(state: GameState, data: GameData = defaultData, voluntary = false): number {
  const job = jobDef(state.character.job, data);
  if (!job) return 0;
  const b = data.balance;
  const share = Math.min(1, state.character.jobYears / b.severanceYears) ** b.severanceCurve;
  return roundYen(job.severance * share * (voluntary ? b.severanceVoluntaryRate : 1));
}

export interface MonthlyIncome {
  salary: number; // 本人の給与の手取り(ボーナスを除く)
  bonus: number; // ボーナスの手取り(6月・12月)
  pension: number; // 年金の手取り(世帯)
  unemployment: number; // 失業給付
  spouse: number; // 配偶者の手取り + 配偶者控除による本人の手取り増
  family: number; // 実家からの仕送り
  childAllowance: number; // 児童手当
  parentalLeave: number; // 本人の育休手当(非課税)
  housingDeduction: number; // 住宅ローン控除で戻る税金
  total: number;
}

export function calcIncome(state: GameState, data: GameData = defaultData): MonthlyIncome {
  const c = state.character;
  const { balance } = data;
  let annual = annualGross(state, data);
  let monthly = monthlyGrossPay(state, data);
  if (isRehired(state)) {
    // 再雇用は退職前の月給の一定割合(ボーナスなし)。バイトはそのままの給料で続ける
    const rate = c.job === 'parttime' ? balance.rehire.parttimePayRate : balance.rehire.payRate;
    monthly = roundYen(c.lastMonthlyPay * rate);
    annual = monthly * 12;
  }
  const rate = takeHomeRate(annual, data);
  let salary = roundYen(monthly * rate);
  let bonus = roundYen(bonusGross(state, data) * rate);
  // 育休中は給与とボーナスが止まり、額面月給の一定割合を非課税で受け取る
  const maternity = num(state, 'maternityLeave', 0) > 0 ? data.balance.children.parentalLeave.maternityRate : null;
  const leaveRate = isEmployed(state) ? (maternity ?? parentalLeaveRate(num(state, 'parentalLeave', 0), false, data)) : null;
  const parentalLeave = leaveRate === null ? 0 : roundYen(monthly * leaveRate);
  if (leaveRate !== null) {
    salary = 0;
    bonus = 0;
  }
  const pension = c.retired ? roundYen(pensionMonthly(state, data) * balance.takeHome.pension) : 0;
  const unemployment =
    num(state, 'unemploymentBenefit', 0) > 0 ? roundYen(c.lastMonthlyPay * balance.unemployment.payRate) : 0;

  let spouse = 0;
  if (c.married && c.spouse && ageYears(state) < balance.pension.retireAge) {
    const t = balance.spouse.types[c.spouse];
    const net = spouseMonthlyNet(state, data);
    spouse = net + (salary > 0 ? t.taxBenefit : 0); // 控除は本人に給与があるときだけ
    const spouseLeave = parentalLeaveRate(num(state, 'spouseLeave', 0), true, data);
    if (spouseLeave !== null) spouse = roundYen(net * spouseLeave);
  }

  const transfer = findFamily(state, data).monthlyTransfer;
  const family = transfer > 0 && bool(state, 'parentAlive') ? transfer : 0;

  const allowance = childAllowance(state, data);
  // 住宅ローン控除は払った税金から戻るので、給与か年金があるときだけ
  const deduction = salary + bonus + pension > 0 ? housingDeduction(state, data) : 0;
  return {
    salary,
    bonus,
    pension,
    unemployment,
    spouse,
    family,
    childAllowance: allowance,
    parentalLeave,
    housingDeduction: deduction,
    total: salary + bonus + pension + unemployment + spouse + family + allowance + parentalLeave + deduction,
  };
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
function obligations(state: GameState, data: GameData, welfare: boolean) {
  const { balance } = data;
  const region = regionDef(state, data);
  const transfer = findFamily(state, data).monthlyTransfer;
  return {
    // 生活保護中は車を持てず(手放す)、医療費は医療扶助でかからない
    car: bool(state, 'hasCar') && !welfare ? region.carMonthlyCost : 0,
    // 健康のための出費は、手取りの healthCostMaxShare まで(収入が少なければ、歩く・自炊など安く済ませる)
    health: welfare ? 0 : Math.min(balance.healthCare[state.policy.health].cost, roundYen(calcIncome(state, data).total * balance.healthCostMaxShare)),
    remittance: transfer < 0 && bool(state, 'parentAlive') ? -transfer : 0,
    parentSupport: num(state, 'parentSupport', 0) > 0 ? balance.timers.parentSupport.monthlyCost : 0,
    studentLoan: studentLoanPayment(state).payment,
    loan: loanPayment(state, data).payment,
    children: childCost(state, data),
    mortgage: mortgagePayment(state, data).payment,
    homeCost: homeOwnershipCost(state, data),
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
  const floor = (state.character.married ? l.married : l.single) * regionDef(state, data).livingMul;
  const fixed = ownsHome(state) ? floor - rentPart(floor, data) : floor; // 持ち家は家賃がいらない
  const o = obligations(state, data, welfare);
  // 子どもの費用は一部だけ親の生活費を削ってまかない、残りは貯金が減る
  const committed =
    o.car +
    o.health +
    o.remittance +
    o.parentSupport +
    o.studentLoan +
    o.loan +
    o.mortgage +
    o.homeCost +
    o.children * data.balance.children.livingOffset;
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
  // 持ち家は家賃を払っていないが、住まいの中身は同じなので家賃の分を足して比べる
  const ownRent = ownsHome(state) ? rentPart(floor * regionDef(state, data).livingMul, data) : 0;
  return roundYen(livingNominal(state, data, bool(state, 'welfare')) - rentGap + ownRent);
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
/** incomeCheck: false は収入の基準を見ない(起業の元手。事業の計画で借りる創業融資) */
export interface LoanOptions {
  incomeCheck?: boolean;
}

/** ローンの審査で見る毎月の収入(額面)。働いていれば給料、引退していれば年金、それ以外は0 */
function loanIncome(state: GameState, data: GameData): number {
  if (isEmployed(state)) return annualGross(state, data) / 12;
  return state.character.retired ? pensionMonthly(state, data) : 0;
}

/**
 * ローンの審査。通らなければ理由を返す。信用と、返済負担率(ローンの毎月の返済の合計 ÷ 額面の月収)を見る。
 * バイトは基準が厳しい。住宅ローンは別枠(mortgageRejection)
 */
export function loanRejection(
  state: GameState,
  amount: number,
  months: number,
  data: GameData = defaultData,
  opts: LoanOptions = {},
): string | null {
  const cfg = data.balance.loan;
  if (state.stats.credit < cfg.minCredit || num(state, 'blacklist', 0) > 0) return '信用が足りない';
  if (opts.incomeCheck === false) return null;
  const ratio = state.character.job === 'parttime' ? cfg.maxPaymentRatioParttime : cfg.maxPaymentRatio;
  const payment = (state.character.loanPayment ?? 0) + annuityPayment(amount, cfg.annualRate, months);
  if (payment > loanIncome(state, data) * ratio) return '収入に対して返済が大きすぎる';
  return null;
}

export function takeLoan(
  state: GameState,
  amount: number,
  months: number,
  data: GameData = defaultData,
  opts: LoanOptions = {},
): boolean {
  const cfg = data.balance.loan;
  if (loanRejection(state, amount, months, data, opts)) return false;
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
  children: number; // 子どもの生活費と教育費
  mortgage: number; // 住宅ローンの返済
  homeCost: number; // 固定資産税・修繕
  total: number;
}

export function calcExpenses(
  state: GameState,
  data: GameData = defaultData,
  welfare: boolean = bool(state, 'welfare'),
): MonthlyExpenses {
  // 地域の生活費係数は最低限の生活費(主に家賃)にだけ掛ける。収入に応じた分は、地域の給料の差にすでに含まれている
  const living = roundYen(livingNominal(state, data, welfare) * num(state, 'priceLevel', 1));
  const { car, health, remittance, parentSupport, studentLoan, loan, children, mortgage, homeCost } = obligations(state, data, welfare);
  return {
    living,
    car,
    health,
    remittance,
    parentSupport,
    studentLoan,
    loan,
    children,
    mortgage,
    homeCost,
    total: living + car + health + remittance + parentSupport + studentLoan + loan + children + mortgage + homeCost,
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
  investTax: number; // 特定口座で売ったときの税金
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
  const mortgagePrincipal = mortgagePayment(state, data).principal;
  if (mortgagePrincipal > 0) a.mortgage = (a.mortgage ?? 0) - mortgagePrincipal;
  updateHomeValue(state, data);
  const loanPrincipal = loanPayment(state, data).principal;
  if (loanPrincipal > 0) {
    a.loan = (a.loan ?? 0) - loanPrincipal;
    if (a.loan <= 0) c.loanPayment = 0;
  }
  a.cash += income.total - expenses.total;

  // 4. 借金の利息と返済、積立、運用リターン。NISAの年の枠は暦の1月に戻る
  if (calendarMonthOf(state, data) === 1) resetNisaYear(state);
  const debtInterest = roundYen((a.debt * balance.debtAnnualRate) / 12);
  a.debt += debtInterest;
  let invested = 0;
  let prepaid = 0;
  let surplus = income.total - expenses.total;
  // カードローン(リボ)は毎月決まった額を預金から返す。繰上げ返済の方針なら預金で一括で返す
  if (a.debt > 0 && a.cash > 0) {
    const m = balance.debtMinPayment;
    const due = state.policy.prepay ? a.debt : Math.max(m.min, roundYen(a.debt * m.share));
    const pay = Math.min(due, a.debt, a.cash);
    a.debt -= pay;
    a.cash -= pay;
    surplus -= pay;
  }
  if (surplus > 0 && a.debt > 0) {
    const repay = Math.max(0, Math.min(surplus, a.debt, a.cash));
    a.debt -= repay;
    a.cash -= repay;
    surplus -= repay;
  }
  const monthly = state.policy.investMonthly ?? 0;
  if (monthly > 0) {
    // 毎月決まった額を積み立てる(赤字の月も、預金があるうちは続ける)。繰上げ返済は余ったお金の半分で
    if (state.policy.prepay && surplus > 0) prepaid = prepay(state, Math.min(roundYen(surplus * balance.investShare), Math.max(0, a.cash)));
    const budget = Math.min(monthly, Math.max(0, a.cash));
    for (const [key, share] of Object.entries(fixedInvestShares(state.policy)) as [Exclude<Invest, 'deposit'>, number][]) {
      const amount = roundYen(budget * share);
      if (amount <= 0) continue;
      a.cash -= amount;
      buyInvestment(state, key, amount, data);
      invested += amount;
    }
  } else if (surplus > 0) {
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
      buyInvestment(state, key, amount, data); // NISAの枠から先に使う
      invested += amount;
    }
  }
  const returns = applyReturns(state, rng, data);

  // 5. 資金ショート。特定口座から先に売り、利益には税金がかかる(そのぶん多めに売る)
  const investTax = coverWithInvestments(state, data);
  // 生活保護は「節約しても収入で暮らせない」ときの下限。それ以外の不足は借金になる。
  // 住宅ローンと固定資産税はボーナスで払う月もあるので、ここでは数えない(返せなければ借金が膨らみ、家を売る)
  const minimal = calcExpenses(state, data, true);
  let minimalLiving = minimal.total - minimal.mortgage - minimal.homeCost;
  if (a.cash < 0 && income.total < minimalLiving && ownsHome(state)) {
    // 生活保護を受ける前に、持ち家を手放す
    sellHome(state, '収入だけでは暮らせなくなり、家を手放した', data);
    minimalLiving = calcExpenses(state, data, true).total;
  }
  let welfare = 0;
  if (a.cash < 0) {
    if (income.total < minimalLiving) {
      welfare = -a.cash;
      a.cash = 0;
      if (!bool(state, 'welfare')) startWelfare(state);
    } else {
      a.debt += -a.cash;
      a.cash = 0;
    }
  }
  checkDebtLimit(state, data);
  if (bool(state, 'welfare') && income.total >= minimalLiving) state.flags.welfare = false;

  return { income, expenses, debtInterest, invested, prepaid, returns, welfare, investTax };
}

/**
 * 借金が借入上限を超えた状態が graceMonths 続いたら自己破産(超えた月に警告を出す)。
 * 免責から7年は再び自己破産できない(借金は延滞として残る)
 */
function checkDebtLimit(state: GameState, data: GameData): void {
  const limit = debtLimit(state, data);
  const over = num(state, 'overLimit', 0);
  if (state.assets.debt <= limit || num(state, 'blacklist', 0) > 0) {
    if (over > 0) state.flags.overLimit = 0;
    return;
  }
  if (ownsHome(state)) {
    // 破産する前に家を売って借金を返す(任意売却)
    sellHome(state, '借金が返せなくなり、家を売って返済にあてた', data);
    const repay = Math.min(state.assets.debt, Math.max(0, state.assets.cash));
    state.assets.debt -= repay;
    state.assets.cash -= repay;
    if (state.assets.debt <= limit) {
      state.flags.overLimit = 0;
      return;
    }
  }
  const grace = data.balance.bankruptcy.graceMonths;
  state.flags.overLimit = over + 1;
  if (over === 0 && grace > 1) {
    addLog(
      state,
      'event',
      `借金が限界に: 借金が借入上限(${manYen(limit)})を超えた。${grace}ヶ月のうちに減らせないと自己破産になる`,
      'debt_warning',
    );
  }
  if (over + 1 >= grace) {
    state.flags.overLimit = 0;
    declareBankruptcy(state, data);
  }
}

function manYen(yen: number): string {
  return `${Math.round(yen / 10_000).toLocaleString('ja-JP')}万円`;
}

/**
 * 大きな出費(autoMinAmount 以上)で、預金と投資を合わせても足りないとき、足りない分を1万円単位でローンにする。
 * 審査に落ちたらそのまま(月末に投資を売り、それでも足りなければカードローン)
 */
export function coverWithLoan(state: GameState, spent: number, data: GameData = defaultData, opts: LoanOptions = {}): void {
  const cfg = data.balance.loan;
  const a = state.assets;
  const short = -(a.cash + a.index + a.stocks + a.speculative);
  if (spent < cfg.autoMinAmount || short <= 0) return;
  const amount = Math.ceil(short / 10_000) * 10_000;
  if (!takeLoan(state, amount, cfg.autoMonths, data, opts)) return;
  a.cash += amount;
  addLog(
    state,
    'event',
    `ローンを組んだ: 貯金では足りず、${manYen(amount)}をローンにした(${cfg.autoMonths / 12}年で返済)`,
    'auto_loan',
  );
}

/**
 * 預金がマイナスなら、投資(積立 → 個別株 → 信用・仮想通貨の順)を売ってあてる。特定口座の利益には税金がかかる。
 * 払った税金を返す。知らないうちに投資がなくなったように見えないよう、ログに残す
 */
export function coverWithInvestments(state: GameState, data: GameData = defaultData): number {
  const a = state.assets;
  let tax = 0;
  if (a.cash >= 0) return 0;
  const sold: string[] = [];
  for (const key of ['index', 'stocks', 'speculative'] as const) {
    if (a[key] <= 0) continue;
    const sale = sellForCash(state, key, -a.cash, data);
    a.cash += sale.gross - sale.tax;
    tax += sale.tax;
    if (sale.gross > 0) sold.push(`${FORCED_SALE_LABELS[key]}を${Math.max(1, Math.round(sale.gross / 10_000)).toLocaleString('ja-JP')}万円`);
    if (a.cash >= 0) break;
  }
  if (sold.length > 0) addLog(state, 'event', `投資の取り崩し: 預金が足りず、${sold.join('・')}売ってあてた`, 'forced_sale');
  return tax;
}

/** 借りているものごとの年利(UI の表示用)。奨学金は借りた条件、無利子なら 0 */
export function debtRates(state: GameState, data: GameData = defaultData): { card: number; loan: number; mortgage: number; studentLoan: number } {
  const b = data.balance;
  return {
    card: b.debtAnnualRate,
    loan: b.loan.annualRate,
    mortgage: b.housing.mortgage.annualRate,
    studentLoan: state.character.studentLoan?.annualRate ?? 0,
  };
}

const FORCED_SALE_LABELS = { index: '積立', stocks: '個別株', speculative: '信用・仮想通貨' } as const;

/** 標準正規分布の累積分布(Abramowitz–Stegun の近似) */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/**
 * 投資を years 年持ったときの見通し(UI の表示用)。毎月の値動き N(mu/12, sigma/√12) の対数の平均と分散から近似する。
 * 振れ幅が大きいほど、平均は同じでも、ふつうの結果(中央値)は下がる。信用・仮想通貨はまれな暴落も入れる
 */
export function investmentOutlook(
  key: 'index' | 'stocks' | 'speculative',
  years: number,
  data: GameData = defaultData,
): { median: number; upShare: number; halfShare: number } {
  const c = data.balance.assets[key];
  const n = years * 12;
  const mu = c.mu / 12;
  const sd = c.sigma / Math.sqrt(12);
  let mean = n * (Math.log(1 + mu) - (sd * sd) / 2);
  let variance = n * sd * sd;
  if (key === 'speculative') {
    const s = data.balance.assets.speculative;
    const crashes = n * s.crashProb;
    const drop = Math.log(1 + s.crashPct);
    mean += crashes * drop;
    variance += crashes * drop * drop;
  }
  const z = (x: number) => (x - mean) / Math.sqrt(variance);
  return { median: Math.exp(mean), upShare: 1 - normalCdf(z(0)), halfShare: normalCdf(z(Math.log(0.5))) };
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

/** 生活保護を受け始める。車は手放す(原則として持てない) */
function startWelfare(state: GameState): void {
  state.flags.welfare = true;
  const hadCar = bool(state, 'hasCar');
  state.flags.hasCar = false;
  addLog(
    state,
    'event',
    `生活保護: 貯金を使い切り、生活保護を受けることになった${hadCar ? '。車は手放した' : ''}`,
    'welfare',
  );
}

export function declareBankruptcy(state: GameState, data: GameData = defaultData): void {
  state.assets.debt = 0;
  state.assets.loan = 0; // ローンも免責される(奨学金は保証機関が残す扱いで残る)
  loseHome(state); // 持ち家は競売になる
  state.character.loanPayment = 0;
  state.stats.credit = 0;
  state.stats.stress = clampStat(state.stats.stress + data.balance.bankruptcy.stress);
  state.flags.bankrupt = true;
  state.flags.blacklist = data.balance.bankruptcy.blacklistMonths;
  addLog(state, 'event', '自己破産: 借金が返せなくなり、自己破産した', 'bankruptcy');
}

// ---- 退職・転職 ----

/** 65歳の退職。退職金を受け取る(受け取った退職金を返す)。社長は会社を事業承継して、会社の価値の一部を受け取る */
export function retire(state: GameState, data: GameData = defaultData): number {
  const severance = severancePay(state, data);
  state.assets.cash += severance;
  recordSeverance(state, severance);
  if (state.business) {
    const price = roundYen(businessValue(state, data) * data.balance.business.successionShare);
    state.assets.cash += price;
    recordSeverance(state, price);
    endBusiness(state);
    addLog(state, 'event', `事業承継: 会社を後継者に引き継ぎ、${Math.round(price / 10_000).toLocaleString('ja-JP')}万円を受け取った`, 'business_succession');
  }
  state.character.retired = true;
  state.character.jobYears = 0;
  state.flags.unemploymentBenefit = 0;
  return severance;
}

/** 同じ職業のまま別の会社に移る。按分した退職金を受け取り、勤続年数は0に戻る(給料の水準と役職は持っていく) */
export function changeEmployer(state: GameState, data: GameData = defaultData): void {
  const severance = severancePay(state, data, true);
  state.assets.cash += severance;
  recordSeverance(state, severance);
  state.character.jobYears = 0;
}

/**
 * 職を変える(転職・リストラ・再就職)。按分した退職金を払い、勤続年数と昇給をリセットする。
 * 無職になるとき(リストラ)は失業給付を始め、職に就いたら打ち切る。
 */
export function changeJob(state: GameState, newJob: JobId, data: GameData = defaultData): void {
  const c = state.character;
  if (newJob === c.job) return;
  const wasOwner = c.job === 'owner';
  if (wasOwner) endBusiness(state); // 社長を辞める = 会社をたたむ
  const severance = severancePay(state, data, newJob !== 'none'); // 無職になる(リストラ)は会社都合、それ以外は自己都合
  state.assets.cash += severance;
  recordSeverance(state, severance);
  if (c.job !== 'none' && c.job !== 'owner') c.previousJob = c.job; // 再就職で「前職に戻る」のは会社員の仕事
  c.job = newJob;
  c.jobYears = 0;
  state.flags.payMul = 1;
  state.flags.rank = 0; // 役職は転職でリセット
  // 自営業(社長)には失業給付がない
  state.flags.unemploymentBenefit = newJob === 'none' && !wasOwner ? data.balance.unemployment.months : 0;
}
