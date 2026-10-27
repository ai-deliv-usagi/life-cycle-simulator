import type { YearLedger } from './ledger';

// ゲームの型定義。仕様は docs/SPEC.md「データ型」、追加分は docs/DESIGN.md §3。
// 金額は円の整数、ステータスは 0〜100、価値観は -2〜+2。

// ---- 基本の列挙 ----

export type Education = 'junior_high' | 'high' | 'vocational' | 'university';
export type JobId = 'sales' | 'office' | 'engineer' | 'parttime' | 'factory' | 'owner' | 'none'; // owner = 社長(第2弾。ガチャでは出ない)
export type BusinessScale = 'small' | 'large'; // 起業の規模: 小さく/大きく
export type FamilyTier = 1 | 2 | 3 | 4 | 5; // 5=太い, 1=実家が借金持ち
export type RegionId = 'metro' | 'city' | 'rural'; // 大都市/地方都市/田舎
export type SpouseType = 'fulltime' | 'parttime' | 'homemaker'; // 共働き/扶養内パート/専業
export type Gender = 'male' | 'female';

export type WorkStyle = 'regular' | 'normal' | 'overtime' | 'grind'; // 定時/普通/残業多め/激務
export type Spending = 'frugal' | 'normal' | 'comfort' | 'lavish'; // 節約/普通/ゆとり/浪費
export type Invest = 'deposit' | 'index' | 'stocks' | 'speculative'; // 預金/積立/個別株/信用・仮想通貨
export type HealthCare = 'ignore' | 'normal' | 'active'; // 気にしない/普通/意識高め
export type EducationPolicy = 'public' | 'private'; // 子どもの教育: 公立中心/私立中心(中学から私立)

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
  education: EducationPolicy; // 子どもの教育(第2弾。子どもがいるときだけ効く)
  /** 毎月決まった額(円)を積み立てる。0 なら余ったお金の半分を配分どおりに回す */
  investMonthly: number;
}

/** 古いセーブや簡単な指定のための入力形。invest に1つの資産名を渡すと100%扱い */
export type PolicyInput = Omit<Policy, 'invest' | 'prepay' | 'education' | 'investMonthly'> & {
  invest: InvestAllocation | Invest;
  prepay?: boolean;
  education?: EducationPolicy;
  investMonthly?: number;
};

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
  home?: number; // 持ち家の時価(第2弾)。純資産に入る
  mortgage?: number; // 住宅ローンの残高(第2弾)
}

/** 投資資産ごとの元本(つぎ込んだ額)。運用成績の表示用 */
export type InvestedPrincipal = Pick<Assets, 'index' | 'stocks' | 'speculative'>;

/** 持ち家(第2弾) */
export interface Home {
  boughtMonth: number;
  price: number; // 買った値段(固定資産税・修繕の基準)
  payment: number; // 住宅ローンの毎月の返済額
}

/** 経営している会社(第2弾)。役員報酬 = salaryBase × level */
export interface Business {
  since: number; // 起業した月(開始からの経過月)。ここから12ヶ月ごとに決算
  scale: BusinessScale;
  level: number; // 業績(1で役員報酬が基準額)。決算ごとに掛け算で動く
}

/** NISAに入れられる資産(信用・仮想通貨は入れられない) */
export type NisaKey = 'index' | 'stocks';

/** NISA(第2弾)。assets.index / stocks は特定口座との合計で、NISAの分は時価の割合 frac で持つ */
export interface NisaState {
  frac: Record<NisaKey, number>; // 時価のうちNISAの割合(0〜1)
  principal: Record<NisaKey, number>; // NISAの元本(簿価)。生涯の枠に数える
  year: { tsumitate: number; growth: number }; // 今年使った枠(暦の1月に戻る)
}

export interface StudentLoan {
  interestFree: boolean;
  annualRate: number; // 無利子なら 0
  monthlyPayment: number; // 元利均等の毎月の返済額
}

export interface Character {
  name: string;
  gender?: Gender; // 第2弾。古いセーブにはない(男女の平均で扱う)
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
  children?: Child[]; // 第2弾。古いセーブにはない
}

/** 子ども。年齢は (state.month − birthMonth) / 12 */
export interface Child {
  birthMonth: number; // 生まれた月(開始からの経過月)
  university: boolean; // 大学に進むか(生まれたときに決まる)。進まなければ高校卒業で独立
}

export type LogType = 'event' | 'choice' | 'policy' | 'year_summary' | 'death';

export interface LogEntry {
  month: number;
  ageMonths: number;
  type: LogType;
  id?: string;
  text: string;
  snapshot: { netWorth: number; health: number; happiness: number };
  /** イベント・選択でお金が動いたとき: 純資産の増減(円。出費はマイナス、ローンで払っても出費に数える) */
  money?: number;
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
  nisa?: NisaState; // 第2弾。古いセーブにはない(NISAの分は0)
  business?: Business; // 第2弾。起業して会社を経営している間だけある
  home?: Home; // 第2弾。持ち家があるときだけ(時価は assets.home)
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
  gender?: Gender; // rollCharacter は必ず決める。省略すると男女の平均で扱う(テスト用)
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
  maxFinancial?: number; // 金融資産の上限(円)。お金があれば使わないリボ払いなど
  region?: RegionId[];
  jobNotIn?: JobId[]; // この職業のときは起きない
  jobIn?: JobId[]; // この職業のときだけ起きる
  spouseType?: SpouseType[]; // 配偶者がこのタイプのときだけ
  gender?: Gender; // 本人の性別(古いセーブで性別がないときは満たさない)
  childrenBelow?: number; // 子どもの人数がこれ未満
  childAge?: [number, number]; // 子どもの誰かがこの年齢(歳、両端を含む)
  hasBusiness?: boolean; // 会社を経営しているか
  hasHome?: boolean; // 持ち家があるか
  ageWindows?: [number, number][]; // この年齢の範囲(歳、両端を含む)のどれかに入っているときだけ
  homeYears?: number; // 家を買ってからこの年数以上
  minBusinessLevel?: number; // 会社の業績がこれ以上
}

export type ProbMod =
  | { stat: keyof Stats; above?: number; below?: number; mul: number }
  | { value: keyof Values; above?: number; below?: number; mul: number }
  | { flag: string; equals?: boolean | number; above?: number; below?: number; mul: number }
  | { age: true; above?: number; below?: number; mul: number }
  | { work: WorkStyle[]; mul: number }
  | { healthCare: HealthCare[]; mul: number }
  | { spending: Spending[]; mul: number }
  | { partnerYears: true; above?: number; below?: number; mul: number } // 恋人と付き合っている年数
  | { financial: true; above?: number; below?: number; mul: number } // 金融資産(円)
  | { region: RegionId[]; mul: number };

export type LuxuryItem = 'car' | 'brand' | 'furniture';

export interface Effects {
  cash?: number;
  /** 高級品を買う。値段は金融資産と支出の方針で決まる(balance.luxury)。pay: 現金 / ローン / リボ */
  luxury?: { item: LuxuryItem; pay: 'cash' | 'loan' | 'revolving' };
  cashMonthsOfPay?: number; // 現在の額面月給 × n(無職・退職後は0)
  stats?: Partial<Stats>;
  setFlags?: Flags;
  addFlags?: Record<string, number>;
  mulFlags?: Record<string, number>;
  /** 職業を変える。other_industry は今と違う会社員の仕事(バイト・社長にはならない) */
  job?: JobId | 'random_other' | 'other_industry' | 'previous';
  /** 同じ職業のまま別の会社に移る(按分した退職金を受け取り、勤続年数が0に戻る) */
  changeEmployer?: boolean;
  achievement?: number;
  /** 資産を一律に増減。split=true は財産分与(元本も同じ割合で減らすので運用の損益にならない) */
  assetShock?: { pct: number; targets?: ('cash' | 'index' | 'stocks' | 'speculative')[]; split?: boolean };
  inheritance?: boolean;
  region?: RegionId;
  /** 住む場所を一段下げる(大都市→地方都市→田舎)。左遷の転勤など */
  relocate?: 'down';
  /** ローンで払う。審査(信用・ブラックリスト)に落ちたら現金で払う */
  loan?: { amount: number; months: number };
  /** カードローン・リボ払いの借金を増やす(現金は動かない) */
  debt?: number;
  /** 子どもが生まれる */
  addChild?: boolean;
  /** 起業する(元手を現金から払い、社長になる) */
  startBusiness?: BusinessScale;
  /** 会社の業績に掛ける */
  businessLevel?: number;
  /** 会社を売る(会社の価値を受け取り、無職になる) */
  sellBusiness?: boolean;
  /** 社長が引退して会社を事業承継する */
  retireOwner?: boolean;
  /** 家を買う。値は頭金の割合(0ならフルローン) */
  buyHome?: number;
  /** 家の時価に掛ける(災害など) */
  homeValue?: number;
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

/** イベントの金額の揺れ方(balance.events.spread)。none は制度や契約で決まる額 */
export type CostSpread = 'none' | 'small' | 'medium' | 'large';

export interface EventDef {
  id: string;
  category: EventCategory;
  /** 金額の揺れ方。省略するとカテゴリで決まる(balance.events.spreadByCategory) */
  spread?: CostSpread;
  /** 医療費。収入が少ない人・引退後は高額療養費で自己負担に上限がある(balance.medicalCap) */
  medical?: boolean;
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
  /** 出費(cash・debt のマイナス)を支出の方針で増減する(買い物・旅行など)。balance.events.spendingCostMul */
  scaleBySpending?: boolean;
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
  /** relations: 毎月の人間関係の増減(節約は付き合いが減る) */
  spending: Record<Spending, { living: number; stress: number; relations: number }>;
  healthCare: Record<HealthCare, { cost: number; health: number; stress: number }>;
  healthCostMaxShare: number; // 健康のための出費は手取りのこの割合まで
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
    oldAgeFrom: number; // この年齢から死亡率の上がり方が急になる
    oldAgeSlope: number; // その上乗せ(e^{slope × (年齢 − oldAgeFrom)})
    healthPivot: number;
    healthScale: number;
    healthFadeFrom: number; // 健康が良いことで死亡率が下がる効果が弱まり始める年齢
    healthFadeYears: number; // その効果がなくなるまでの年数
    highStressMul: number;
    /** 男女の死亡率の係数(男性は高く、女性は低い。平均寿命の差 約6年) */
    genderMul: Record<Gender, number>;
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
    skillAchievementShare: number; // 達成感 = スキル × この値 + achievement + 役職・会社の業績の分
    rankAchievement: number; // 役職1段(主任〜部長)あたりの達成感
    businessAchievement: number; // 社長の業績1あたりの達成感(businessAchievementMaxLevel まで)
    businessAchievementMaxLevel: number;
    /** 重み w = base + Σ 係数 × 価値観(最小 minWeight) */
    weights: Record<HappinessPart, { base: number } & Partial<Record<keyof Values, number>>>;
  };
  events: {
    luckGoodBase: number;
    luckGoodScale: number;
    luckBadBase: number;
    luckBadScale: number;
    valueShiftStep: number;
    spendingCostMul: Record<Spending, number>; // scaleBySpending のイベントの出費に掛ける
    /** 金額の揺れ: 倍率 = exp(N(−sigma²/2, sigma)) を min〜max に収める(平均がほぼ1になる) */
    spread: Record<CostSpread, { sigma: number; min: number; max: number }>;
    spreadByCategory: Record<EventCategory, CostSpread>;
  };
  /** 高額療養費: 額面年収が incomeBelow 未満か引退後なら、医療の出来事1回の自己負担は perEvent まで */
  medicalCap: { incomeBelow: number; perEvent: number };
  /** 高級品の値段 = 金融資産 × share × spendingCostMul を min〜max に収め、priceStep 円単位に丸める */
  luxury: Record<LuxuryItem, { share: number; min: number; max: number; loanMonths: number }> & { priceStep: number };
  /** 毎月 −1 する数値フラグと、その間の効果 */
  timers: {
    recession: { layoffMul: number };
    parentSupport: { monthlyCost: number };
    unemploymentBenefit: Record<string, never>;
    blacklist: Record<string, never>; // 自己破産後、借りられず再破産もできない残り月数
    rehire: Record<string, never>; // 再雇用の残り月数
    pregnant: Record<string, never>; // 出産までの残り月数(1になった月に生まれる)
    parentalLeave: Record<string, never>; // 本人の育休の残り月数
    spouseLeave: Record<string, never>; // 配偶者の育休の残り月数
    fertilityCare: Record<string, never>; // 不妊治療の残り月数(妊娠しやすい)
    maternityLeave: Record<string, never>; // 女性本人の産休の残り月数
    postpartum: Record<string, never>; // 出産からの残り月数(産後の2年は夫婦の危機が起きやすい)
    /** 大病の治療中・治療しないままの残り月数。その間は毎月 deathMonthly の死亡リスクと健康の増減がある */
    illnessTreated: { deathMonthly: number; health: number };
    illnessUntreated: { deathMonthly: number; health: number };
    checkupNeglect: { deathMonthly: number; health: number }; // 再検査を放置した残り月数(大病が起きやすい)
    trained: Record<string, never>; // 職業訓練を受けてからの残り月数(正社員の求人・登用・再就職が起きやすい)
  };
  studentLoan: { interestFreeProb: number; annualRate: number; months: number };
  unemployment: { months: number; payRate: number };
  spouse: {
    /** 本人の性別ごとの、配偶者のタイプの確率(性別のない古いセーブは types の prob) */
    probByGender: Record<Gender, Record<SpouseType, number>>;
    types: Record<SpouseType, { prob: number; monthlyNet: number; taxBenefit: number; employeePension: number }>;
  };
  /** graceMonths: 借金が上限を超えた状態がこの月数続いたら自己破産 */
  bankruptcy: { minLimit: number; incomeShare: number; stress: number; blacklistMonths: number; graceMonths: number };
  /** autoMinAmount 以上の出費が現金で払えないときは、足りない分を autoMonths 回のローンにする */
  /** maxPaymentRatio: ローンの毎月の返済の合計が額面の月収のこの割合まで(バイトは maxPaymentRatioParttime) */
  loan: { annualRate: number; minCredit: number; autoMinAmount: number; autoMonths: number; maxPaymentRatio: number; maxPaymentRatioParttime: number };
  /** ボーナスの月(暦)と、ゲーム開始の月(暦) */
  bonus: { months: number[]; startCalendarMonth: number };
  /** 再雇用(会社員)と、65歳を過ぎてもバイトを続ける期間・給料の割合 */
  rehire: { months: number; payRate: number; parttimeMonths: number; parttimePayRate: number };
  result: { netWorthLine: number; happinessLine: number };
  children: ChildrenBalance;
  gender: { femaleProb: number };
  business: BusinessBalance;
  housing: HousingBalance;
  /** NISAの枠(円)と、特定口座の利益にかかる税率 */
  nisa: { tsumitateAnnual: number; growthAnnual: number; lifetimeTotal: number; lifetimeGrowth: number; taxRate: number };
}

/** マイホーム(第2弾)。金額は円 */
export interface HousingBalance {
  rentShare: number; // 最低限の生活費のうち家賃の割合(持ち家なら払わない)
  price: Record<RegionId, number>; // 地域の相場(買う家の上限)
  priceIncomeMultiple: number; // 年収の何倍までの家を買うか
  minPrice: number;
  closingCost: number; // 諸費用(価格に対する割合。現金で払う)
  mortgage: { annualRate: number; years: number; maxAge: number; minYears: number; maxIncomeMultiple: number; minCredit: number };
  ownershipCostRate: number; // 固定資産税・修繕(価格に対する年率)
  valueChange: Record<RegionId, number>; // 家の時価の年率の変化
  sellCost: number; // 売るときの手数料など(時価に対する割合)
  deduction: { rate: number; years: number; maxBalance: number }; // 住宅ローン控除
  soloTransfer: { stress: number; relations: number }; // 持ち家で転勤になったとき(単身赴任)
}

/** 起業(第2弾)。金額は円(役員報酬は月額・額面) */
export interface BusinessBalance {
  label: string;
  capital: Record<BusinessScale, number>; // 元手
  salaryBase: Record<BusinessScale, number>; // level 1 のときの役員報酬
  salaryMin: number;
  salaryMax: number;
  startLevel: number;
  failLevel: number; // 決算でこれを下回ると廃業
  breakEvenLevel: number; // 会社の価値が出始める業績
  maxLevel: number;
  closeCost: Record<BusinessScale, number>; // 廃業の整理費用(借入の返済など)
  valuationMonths: number; // 会社の価値 = 基準の役員報酬 × (level − breakEvenLevel) × この月数
  successionShare: number; // 事業承継するとき受け取る割合
  retireAgeMax: number; // 社長に定年はないが、この年齢で必ず事業承継する
  /** 決算の伸び(対数・年率) ~ N(mu + 補正, sigma) */
  review: { mu: number; sigma: number; skillMul: number; luckMul: number; work: Record<WorkStyle, number>; recession: number };
}

/** 子ども(第2弾)。金額は1人あたりの月額 */
export interface ChildrenBalance {
  max: number;
  universityProb: number;
  /** 子どもの費用のうち、親の生活費を削ってまかなう割合(残りは貯金が減る) */
  livingOffset: number;
  /** 子どもの費用の倍率 = (世帯の毎月の手取り(ボーナス・児童手当を除く)÷ referenceIncome) ^ elasticity(min〜max) */
  costScale: { referenceIncome: number; elasticity: number; min: number; max: number };
  /** 年齢の段階。until 歳になるまで。education は教育方針ごとの学校・塾などの費用 */
  stages: { until: number; label: string; living: number; education: Record<EducationPolicy, number> }[];
  /** 児童手当: under3 は3歳未満、それ以外は高校生(18歳)まで。3人目からは third */
  allowance: { under3: number; school: number; third: number; until: number };
  /** 育休: months ヶ月。最初の firstMonths は額面月給の firstRate、残りは laterRate(非課税)。配偶者は手取りに spouse* を掛ける */
  parentalLeave: {
    months: number;
    firstMonths: number;
    firstRate: number;
    laterRate: number;
    spouseFirstRate: number;
    spouseLaterRate: number;
    /** 女性本人の産休(産後休業): 出産のあと maternityMonths は額面月給の maternityRate。出産で健康 birthHealth */
    maternityMonths: number;
    maternityRate: number;
    birthHealth: number;
  };
  /** 幸福度とストレス: 人間関係 +perChild(上限 relationsMax)、youngUntil 歳未満の子1人ごとに自由時間 freeTimePerYoung、babyUntil 歳未満の子1人ごとにストレス stressPerBaby/月 */
  happiness: { relationsPerChild: number; relationsMax: number; youngUntil: number; freeTimePerYoung: number; babyUntil: number; stressPerBaby: number };
}

export interface GameData {
  education: EducationDef[];
  jobs: JobDef[];
  family: FamilyDef[];
  regions: RegionDef[];
  events: EventDef[];
  balance: Balance;
}
