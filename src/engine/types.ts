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
export type LifeType = 'winner' | 'poor_happy' | 'rich_unhappy' | 'hardship';

// ---- プレイヤーが決めるもの ----

export interface Policy {
  work: WorkStyle;
  spending: Spending;
  invest: Invest;
  health: HealthCare;
}

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
}

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
  lastMonthlyPay: number; // 直近の額面月給(失業給付用)
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
  yearly: { age: number; netWorth: number; happiness: number }[];
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
  region?: RegionId[];
}

export type ProbMod =
  | { stat: keyof Stats; above?: number; below?: number; mul: number }
  | { value: keyof Values; above?: number; below?: number; mul: number }
  | { flag: string; equals: boolean | number; mul: number }
  | { age: true; above?: number; below?: number; mul: number }
  | { work: WorkStyle[]; mul: number }
  | { healthCare: HealthCare[]; mul: number }
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
  assetShock?: { pct: number; targets?: (keyof Assets)[] };
  inheritance?: boolean;
  region?: RegionId;
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
  probFrom?: 'layoffRate';
  probMods?: ProbMod[];
  once?: boolean;
  cooldownMonths?: number;
  effects?: Effects;
  choices?: Choice[];
}

// ---- 調整用データ(src/data/*.json)----
// Balance(balance.json)の型はステップ2でデータと一緒に定義する。

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
