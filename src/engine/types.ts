import type { YearLedger } from './ledger';

// ゲームの型定義。仕様は docs/SPEC.md「データ型」、追加分は docs/DESIGN.md §3。
// 金額は円の整数、ステータスは 0〜100、価値観は -2〜+2。

// ---- 基本の列挙 ----

export type Education = 'junior_high' | 'high' | 'vocational' | 'university';
export type JobId = 'sales' | 'office' | 'engineer' | 'parttime' | 'factory' | 'none';
export type FamilyTier = 1 | 2 | 3 | 4 | 5; // 5=太い, 1=実家が借金持ち
export type RegionId = 'metro' | 'city' | 'rural'; // 大都市/地方都市/田舎
export type SpouseType = 'fulltime' | 'parttime' | 'homemaker'; // 共働き/扶養内パート/専業

export type WorkStyle = 'regular' | 'normal' | 'overtime' | 'grind'; // 定時/普通/残業多め/激務
export type Spending = 'frugal' | 'normal' | 'comfort' | 'lavish'; // 節約/普通/ゆとり/浪費
export type Invest = 'deposit' | 'index' | 'stocks' | 'speculative'; // 預金/積立/個別株/信用・仮想通貨
export type HealthCare = 'ignore' | 'normal' | 'active'; // 気にしない/普通/意識高め

export type DeathCause = 'illness' | 'overwork' | 'accident' | 'old_age';
export type HappinessPart = 'living' | 'security' | 'relations' | 'freeTime' | 'health' | 'achievement';
export type LifeType = 'winner' | 'poor_happy' | 'rich_unhappy' | 'hardship';

// ---- プレイヤーが決めるもの ----

/** 投資の配分(%)。合計100、10%刻み。預金の分は現金のまま */
export type InvestAllocation = Record<Invest, number>;

export interface Policy {
  work: WorkStyle;
  spending: Spending;
  invest: InvestAllocation;
  health: HealthCare;
  prepay: boolean; // 繰上げ返済する(投資に回す分で先にローンと奨学金を返す)
}

/** 古いセーブや簡単な指定のための入力形。invest に1つの資産名を渡すと100%扱い */
export type PolicyInput = Omit<Policy, 'invest' | 'prepay'> & { invest: InvestAllocation | Invest; prepay?: boolean };

export interface Values {
  risk: number; // -2 安定志向 .. +2 挑戦志向
  relation: number; // -2 家族重視 .. +2 自由志向
  spending: number; // -2 貯める派 .. +2 使う派
  work: number; // -2 生活のため .. +2 やりがい
}

// ---- 状態 ----

export interface Stats {
  health: number;
  stress: number;
  skill: number;
  credit: number;
  relations: number;
}

export interface Assets {
  cash: number;
  index: number;
  stocks: number;
  speculative: number;
  debt: number; // 資金ショートの借金(年15%)
  studentLoan: number; // 奨学金の残高(debt とは別枠)
  loan?: number; // ローンの残高(結婚式・車など。年3%・毎月返済)。古いセーブにはない
}

/** 投資資産ごとの元本(つぎ込んだ額)。運用成績の表示用 */
export type InvestedPrincipal = Pick<Assets, 'index' | 'stocks' | 'speculative'>;

export interface StudentLoan {
  interestFree: boolean;
  annualRate: number; // 無利子なら 0
  monthlyPayment: number; // 元利均等の毎月の返済額
}

export interface Character {
  name: string;
  education: Education;
  job: JobId;
  jobYears: number; // 現職の勤続年数
  familyTier: FamilyTier;
  constitution: number; // 体質 0-100(高いほど病気になりにくい)
  luck: number; // 運 0-100(隠し)
  married: boolean;
  retired: boolean;
  pensionMonths: number; // 厚生年金の加入月数
  avgMonthlyPay: number; // 年金計算用の平均月収
  previousJob?: JobId; // 再就職の「前職に戻る」用
  studentLoan: StudentLoan | null;
  lastMonthlyPay: number; // 直近の額面月給(失業給付・再雇用の給料用)
  loanPayment?: number; // ローンの毎月の返済額(複数のローンの合計)
  region: RegionId;
  spouse: SpouseType | null; // 未婚は null
}

export type LogType = 'event' | 'choice' | 'policy' | 'year_summary' | 'death';

export interface LogEntry {
  month: number;
  ageMonths: number;
  type: LogType;
  id?: string;
  text: string;
  snapshot: { netWorth: number; health: number; happiness: number };
  /** 年間サマリーだけ: 年末の金融資産の内訳(円) */
  assets?: { cash: number; index: number; stocks: number; speculative: number };
}

export interface PendingEvent {
  eventId: string;
  month: number; // 発生した月
}

export type Flags = Record<string, boolean | number>;

export interface GameState {
  seed: number;
  rngState: number; // 乱数の現在位置(セーブから同じ人生を再開するため)
  startAge: number; // 開始年齢
  eventHistory: Record<string, { count: number; lastMonth: number }>;
  month: number; // 開始からの経過月
  ageMonths: number; // 年齢(月単位)
  character: Character;
  values: Values;
  policy: Policy;
  stats: Stats;
  assets: Assets;
  invested?: InvestedPrincipal; // 古いセーブにはないので省略可
  ledger?: YearLedger; // 今年の収支(古いセーブにはない)
  lastLedger?: YearLedger; // 前の年の収支(年間サマリー用)
  adaptedSpending: number; // 慣れた生活水準(月額・実質)
  achievement: number; // 達成感の蓄積 0-100
  happinessHistory: number[]; // 月ごとの幸福度
  flags: Flags; // イベント用。予約キーは DESIGN.md §3
  log: LogEntry[];
  pendingEvent?: PendingEvent;
  dead?: { cause: DeathCause; ageMonths: number };
}

// ---- 初期ガチャ ----

export interface CharacterRoll {
  seed: number;
  education: Education;
  job: Exclude<JobId, 'none'>;
  familyTier: FamilyTier;
  region: RegionId;
  hasCar: boolean;
  constitution: number;
  luck: number;
  initialCash: number;
  studentLoan: (StudentLoan & { amount: number }) | null;
}

// ---- リザルト ----

export interface LifeResult {
  ageAtDeath: number;
  cause: DeathCause;
  finalNetWorth: number;
  lifetimeHappiness: number;
  lifeType: LifeType;
  yearly: { age: number; netWorth: number; happiness: number; assets?: NonNullable<LogEntry['assets']> }[];
  timeline: LogEntry[];
}

// ---- イベント定義(events.json)。DESIGN.md §7.1 ----

export interface EventConditions {
  ageMin?: number;
  ageMax?: number;
  flags?: Flags; // 一致判定。married は character.married に読み替える
  employed?: boolean; // job != 'none' かつ未退職
  retired?: boolean;
  minInvested?: number; // index+stocks+speculative の下限(円)
  minFinancial?: number; // 金融資産(預金+投資)の下限(円)。お金がないと起きない詐欺など
  region?: RegionId[];
  jobNotIn?: JobId[]; // この職業のときは起きない
  jobIn?: JobId[]; // この職業のときだけ起きる
}

export type ProbMod =
  | { stat: keyof Stats; above?: number; below?: number; mul: number }
  | { value: keyof Values; above?: number; below?: number; mul: number }
  | { flag: string; equals?: boolean | number; above?: number; below?: number; mul: number }
  | { age: true; above?: number; below?: number; mul: number }
  | { work: WorkStyle[]; mul: number }
  | { healthCare: HealthCare[]; mul: number }
  | { spending: Spending[]; mul: number }
  | { region: RegionId[]; mul: number };

export interface Effects {
  cash?: number;
  cashMonthsOfPay?: number; // 現在の額面月給 × n(無職・退職後は0)
  stats?: Partial<Stats>;
  setFlags?: Flags;
  addFlags?: Record<string, number>;
  mulFlags?: Record<string, number>;
  job?: JobId | 'random_other' | 'previous';
  achievement?: number;
  /** 資産を一律に増減。split=true は財産分与(元本も同じ割合で減らすので運用の損益にならない) */
  assetShock?: { pct: number; targets?: (keyof Assets)[]; split?: boolean };
  inheritance?: boolean;
  region?: RegionId;
  /** 住む場所を一段下げる(大都市→地方都市→田舎)。左遷の転勤など */
  relocate?: 'down';
  /** ローンで払う。審査(信用・ブラックリスト)に落ちたら現金で払う */
  loan?: { amount: number; months: number };
  /** カードローン・リボ払いの借金を増やす(現金は動かない) */
  debt?: number;
}

export interface Outcome {
  prob: number;
  text: string;
  effects: Effects;
}

export interface Choice {
  label: string;
  conditions?: EventConditions; // 満たさない選択肢は表示しない
  effects?: Effects;
  outcomes?: Outcome[]; // 確率分岐(合計1)
  valueShift?: Partial<Values>; // 符号だけ使う。大きさは balance.events.valueShiftStep
}

export type EventCategory = 'life' | 'career' | 'money' | 'health' | 'social' | 'system';

export interface EventDef {
  id: string;
  category: EventCategory;
  title: string;
  text: string;
  good?: boolean; // true=運で確率UP、false=運で確率DOWN、省略=運の影響なし
  conditions: EventConditions;
  baseProb: number;
  probFrom?: 'layoffRate' | 'spouseMortality'; // リストラ率 / 配偶者の死亡率(本人と同い年として基本死亡率から)
  probMods?: ProbMod[];
  once?: boolean;
  cooldownMonths?: number;
  effects?: Effects;
  choices?: Choice[];
}

// ---- 調整用データ(src/data/*.json)----

export interface EducationDef {
  id: Education;
  label: string;
  prob: number;
  startAge: number;
  startPayMul: number; // 初任給係数
  raiseMul: number; // 昇給係数
  loan: { prob: number; amount: number } | null;
}

export interface JobDef {
  id: Exclude<JobId, 'none'>;
  label: string;
  startPay: number; // 初年度年収
  peakPay: number; // 50歳時のピーク年収
  employeePension: boolean;
  severance: number; // 退職金(満額)
  layoffRate: number; // 月次リストラ率
  bonusMonths: number; // 年間のボーナス(月給の何ヶ月分)。6月と12月に半分ずつ
}

export interface FamilyDef {
  tier: FamilyTier;
  label: string;
  prob: number;
  initialCash: number;
  monthlyTransfer: number; // マイナスは親への送金
  inheritance: number;
}

export interface RegionDef {
  id: RegionId;
  label: string;
  prob: number;
  livingMul: number;
  payMul: number;
  carProb: number;
  carMonthlyCost: number;
  noCarFreeTime: number;
}

/** balance.json。係数・確率・金額をまとめたもの(DESIGN.md §6.1) */
export interface Balance {
  startStats: Omit<Stats, 'health'>; // 健康は体質で決まる
  gacha: { constitution: { mean: number; sd: number }; luck: { mean: number; sd: number } };
  /** 額面年収 = 基準年収(peakAge まで線形) × … × (skillBase + skillRange × スキル/100) */
  /** declineFrom 歳からは役職定年で毎年 declinePerYear ずつ下がる */
  salary: { peakAge: number; skillBase: number; skillRange: number; declineFrom: number; declinePerYear: number };
  takeHome: { bands: { below: number | null; rate: number }[]; pension: number };
  work: Record<WorkStyle, { income: number; freeTime: number; health: number; stress: number; skill: number; death: number }>;
  spending: Record<Spending, { living: number; stress: number }>;
  healthCare: Record<HealthCare, { cost: number; health: number; stress: number }>;
  /** 基本生活費 = single/married の固定分 + incomeShare × 世帯の手取り */
  living: { single: number; married: number; incomeShare: number; bonusSpendShare: number };
  retiredFreeTime: number;
  unemployedStress: number;
  debtAnnualRate: number;
  /** カードローン(リボ)の毎月の返済 = max(min, 残高 × share)。預金から自動で返す */
  debtMinPayment: { share: number; min: number };
  investShare: number;
  assets: {
    cash: { mu: number; sigma: number };
    index: { mu: number; sigma: number };
    stocks: { mu: number; sigma: number };
    speculative: { mu: number; sigma: number; crashProb: number; crashPct: number };
  };
  /** survivorRate: 遺族厚生年金 = 亡くなった配偶者の厚生年金 × この割合(自分の厚生年金と多いほう) */
  pension: { basicFull: number; basicYears: number; employeeRate: number; spouseBasicMul: number; survivorRate: number; retireAge: number };
  severanceYears: number;
  stats: {
    age40Health: number;
    age60Health: number;
    highStress: number;
    highStressHealth: number;
    relationsDecay: number;
    creditWithDebt: number;
    creditNoDebt: number;
    retiredStress: number;
    healthReversion: number;
    healthBase: number;
    healthBaseConstitution: number;
    healthBaseAgeFrom: number;
    healthBaseAgeSlope: number;
    stressReversion: number;
    stressBase: number;
    achievementDecay: number;
  };
  death: {
    a: number;
    b: number;
    ageOffset: number;
    healthPivot: number;
    healthScale: number;
    highStressMul: number;
    /** 過労死: ストレスが minStress 以上で激務・残業多めのとき、年齢に関係なく毎月この確率 */
    karoshi: { grindMonthly: number; overtimeMonthly: number; minStress: number };
    maxAge: number;
    cause: {
      overworkGrind: number;
      overworkOvertime: number;
      accidentBase: number;
      oldAgeFrom: number;
      oldAgeOffset: number;
      oldAgeMul: number;
    };
  };
  happiness: {
    minWeight: number;
    marriedRelationsBonus: number;
    securityMonths: number;
    debtSecurityPenalty: number;
    livingAbsScale: number;
    livingAbsMax: number;
    livingRelMax: number;
    livingRelSlope: number;
    adaptMonths: number;
    skillAchievementShare: number; // 達成感 = スキル × この値 + achievement
    /** 重み w = base + Σ 係数 × 価値観(最小 minWeight) */
    weights: Record<HappinessPart, { base: number } & Partial<Record<keyof Values, number>>>;
  };
  events: { luckGoodBase: number; luckGoodScale: number; luckBadBase: number; luckBadScale: number; valueShiftStep: number };
  /** 毎月 −1 する数値フラグと、その間の効果 */
  timers: {
    recession: { layoffMul: number };
    parentSupport: { monthlyCost: number };
    unemploymentBenefit: Record<string, never>;
    blacklist: Record<string, never>; // 自己破産後、借りられず再破産もできない残り月数
    rehire: Record<string, never>; // 再雇用の残り月数
    /** 大病の治療中・治療しないままの残り月数。その間は毎月 deathMonthly の死亡リスクと健康の増減がある */
    illnessTreated: { deathMonthly: number; health: number };
    illnessUntreated: { deathMonthly: number; health: number };
    checkupNeglect: { deathMonthly: number; health: number }; // 再検査を放置した残り月数(大病が起きやすい)
  };
  studentLoan: { interestFreeProb: number; annualRate: number; months: number };
  unemployment: { months: number; payRate: number };
  spouse: {
    types: Record<SpouseType, { prob: number; monthlyNet: number; taxBenefit: number; employeePension: number }>;
  };
  /** graceMonths: 借金が上限を超えた状態がこの月数続いたら自己破産 */
  bankruptcy: { minLimit: number; incomeShare: number; stress: number; blacklistMonths: number; graceMonths: number };
  /** autoMinAmount 以上の出費が現金で払えないときは、足りない分を autoMonths 回のローンにする */
  loan: { annualRate: number; minCredit: number; autoMinAmount: number; autoMonths: number };
  /** ボーナスの月(暦)と、ゲーム開始の月(暦) */
  bonus: { months: number[]; startCalendarMonth: number };
  rehire: { months: number; payRate: number };
  result: { netWorthLine: number; happinessLine: number };
}

export interface GameData {
  education: EducationDef[];
  jobs: JobDef[];
  family: FamilyDef[];
  regions: RegionDef[];
  events: EventDef[];
  balance: Balance;
}
