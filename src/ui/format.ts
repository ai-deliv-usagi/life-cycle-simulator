// 表示用の整形とラベル(UIの文言は日本語)
import { gameData, type Education, type FamilyTier, type JobId, type RegionId, type Values } from '../engine/index';

export function manYen(yen: number): string {
  const man = Math.round(yen / 10_000);
  return `${man.toLocaleString('ja-JP')}万円`;
}

/** 1億円以上は「1.2億円」 */
export function bigYen(yen: number): string {
  if (Math.abs(yen) >= 100_000_000) return `${(yen / 100_000_000).toFixed(1)}億円`;
  return manYen(yen);
}

export function yen(yen: number): string {
  return `${Math.round(yen).toLocaleString('ja-JP')}円`;
}

/** 符号つき。1万円未満は円で出す(「−0万円」にならないように) */
export function signedManYen(yen: number): string {
  const abs = Math.abs(yen);
  const body = abs < 10_000 ? `${Math.round(abs).toLocaleString('ja-JP')}円` : manYen(abs);
  return `${yen >= 0 ? '+' : '−'}${body}`;
}

/** 健康状態を言葉で(閾値は UI の定数。DESIGN.md §9.3) */
export function healthWord(health: number): string {
  if (health >= 80) return '絶好調';
  if (health >= 60) return '良好';
  if (health >= 40) return '普通';
  if (health >= 20) return '不調';
  return '危険';
}

export function educationLabel(id: Education): string {
  return gameData.education.find((e) => e.id === id)?.label ?? id;
}

export function jobLabel(id: JobId): string {
  if (id === 'none') return '無職';
  return gameData.jobs.find((j) => j.id === id)?.label ?? id;
}

export function familyLabel(tier: FamilyTier): string {
  return gameData.family.find((f) => f.tier === tier)?.label ?? String(tier);
}

export function regionLabel(id: RegionId): string {
  return gameData.regions.find((r) => r.id === id)?.label ?? id;
}

/** 体質を★5段階で(数値は隠す) */
export function stars(value: number): string {
  const n = Math.max(1, Math.min(5, Math.round(value / 20)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

export const VALUE_AXES: { key: keyof Values; left: string; right: string }[] = [
  { key: 'risk', left: '安定志向', right: '挑戦志向' },
  { key: 'relation', left: '家族重視', right: '自由志向' },
  { key: 'spending', left: '貯める派', right: '使う派' },
  { key: 'work', left: '生活重視', right: 'やりがい重視' },
];

export const STAT_LABELS = {
  health: '健康',
  stress: 'ストレス',
  skill: 'スキル',
  credit: '信用',
  relations: '人間関係',
} as const;

/** 選択肢つきイベントは「発生」と「選択」の2行になるので、選択の行だけ残す(選択の行にタイトルも入っている) */
export function collapseLog<T extends { type: string; id?: string; month: number }>(entries: readonly T[]): T[] {
  return entries.filter(
    (e, i) =>
      !(e.type === 'event' && entries.slice(i + 1).some((n) => n.type === 'choice' && n.id === e.id && n.month === e.month)),
  );
}

/** ゲーム開始は新卒の4月。経過月から暦の月(1〜12)を出す */
export function calendarMonth(month: number): number {
  return ((3 + month) % 12) + 1;
}

/** 「22歳4月」(ログや年表用) */
export function ageMonthLabel(ageMonths: number, month: number): string {
  return `${Math.floor(ageMonths / 12)}歳${calendarMonth(month)}月`;
}

/** 何年目か(開始の月を1年目の4月とする) */
export function yearNumber(month: number): number {
  return Math.floor(month / 12) + 1;
}

export const RANK_LABELS = ['', '主任', '係長', '課長', '部長'] as const;

/** 価値観の5段階(-2〜+2)。両端の名前から「とても〇〇 / やや〇〇 / 中間」を作る */
export function valueStepLabel(axis: { left: string; right: string }, v: number): string {
  const step = Math.round(v);
  if (step <= -2) return `とても${axis.left}`;
  if (step === -1) return `やや${axis.left}`;
  if (step === 0) return '中間';
  if (step === 1) return `やや${axis.right}`;
  return `とても${axis.right}`;
}

export function signedPercent(ratio: number): string {
  return `${ratio >= 0 ? '+' : '−'}${Math.abs(ratio * 100).toFixed(1)}%`;
}

export type StatLevel = 'good' | 'normal' | 'caution' | 'danger';

/** ステータスの状態(ストレスは高いほど悪い)。閾値は UI の定数 */
export function statLevel(key: keyof typeof STAT_LABELS, value: number): StatLevel {
  const v = key === 'stress' ? 100 - value : value;
  if (v >= 70) return 'good';
  if (v >= 40) return 'normal';
  if (v >= 20) return 'caution';
  return 'danger';
}

export const STAT_LEVEL_LABELS: Record<StatLevel, string> = { good: '良好', normal: '普通', caution: '注意', danger: '危険' };

export const HAPPINESS_PART_LABELS = {
  living: '生活の満足',
  security: 'お金の安心',
  relations: '人間関係',
  freeTime: '自由な時間',
  health: '健康',
  achievement: 'やりがい',
} as const;

/** 幸福度を顔の絵文字で(閾値は UI の定数) */
export function happinessFace(happiness: number): string {
  if (happiness >= 75) return '😄';
  if (happiness >= 60) return '🙂';
  if (happiness >= 45) return '😐';
  if (happiness >= 30) return '😟';
  return '😢';
}

/** 幸福度を言葉で(数値は出さない) */
export function happinessWord(happiness: number): string {
  if (happiness >= 75) return 'とても幸せ';
  if (happiness >= 60) return '幸せ';
  if (happiness >= 45) return 'ふつう';
  if (happiness >= 30) return 'つらい';
  return 'とてもつらい';
}

/** 幸福度の要素の満たされ具合を言葉で */
export function happinessPartWord(value: number): string {
  if (value >= 65) return '十分';
  if (value >= 40) return 'ふつう';
  return '足りない';
}

/** ステータスが下がる(ストレスは上がる)と何が起きるか */
export const STAT_EFFECTS: Record<keyof typeof STAT_LABELS, { what: string; bad: string; good: string }> = {
  health: {
    what: '体の調子。年齢とともに下がりやすい',
    bad: '低いと病気・入院・大病が起きやすく、亡くなる確率も上がる。幸福度の「健康」も下がる',
    good: '高いと病気になりにくく、長生きしやすい',
  },
  stress: {
    what: '心の負担。激務や借金、トラブルで上がる',
    bad: '高いと健康が落ち、過労で倒れる・燃え尽き・離婚の危機・過労死が起きやすくなる',
    good: '低いと健康を保ちやすい',
  },
  skill: {
    what: '仕事の腕前。働くほど上がる',
    bad: '低いと給料が上がりにくく、昇進・転職・再就職のチャンスも少ない',
    good: '高いと給料が上がり、昇進や転職、起業でも有利。やりがいも上がる',
  },
  credit: {
    what: '社会的な信用。借金があると下がる',
    bad: '低いとローンや住宅ローンの審査に落ち、投資詐欺にもあいやすい',
    good: '高いとローンが組みやすい',
  },
  relations: {
    what: '人とのつながり。何もしないと少しずつ下がる',
    bad: '低いと恋人ができにくく、離婚の危機が起きやすい。幸福度の「人間関係」も下がる',
    good: '高いと恋人ができやすく、結婚式や同窓会のお誘いも増える',
  },
};

/** 「大事な出来事で止める」で再生を止める出来事(選択肢のないもの。選択肢つきはモーダルで止まる) */
export const IMPORTANT_EVENTS: ReadonlySet<string> = new Set([
  'parent_death',
  'spouse_death',
  'layoff',
  'hospital',
  'traffic_accident',
  'elderly_crash',
  'natural_disaster',
  'recession',
  'pregnancy',
  'bankruptcy',
  'home_sold',
  'business_closed',
  'business_succession',
  'retirement',
]);

/** ログの文の「タイトル: 本文」からタイトルだけ */
export function logTitle(text: string): string {
  return text.split(':')[0] ?? text;
}

/** ログのお金の増減(「−12万円」)。動いていなければ空 */
export function moneyLabel(money: number | undefined): string {
  return money ? signedManYen(money) : '';
}

/** 年利・利回り(「年3%」「年0.1%」)。0 は「無利子」 */
export function annualRateLabel(rate: number): string {
  if (rate === 0) return '無利子';
  return `年${Number((rate * 100).toFixed(1))}%`;
}

// ---- アイコン(絵文字)。文字の前に添えて、ひと目でわかるようにする ----

export const JOB_ICONS: Record<JobId, string> = {
  sales: '💼',
  office: '🗂️',
  engineer: '💻',
  parttime: '🏪',
  factory: '🏭',
  owner: '👔',
  none: '🛋️',
};

export const EDUCATION_ICONS: Record<Education, string> = { junior_high: '📘', high: '🏫', vocational: '🛠️', university: '🎓' };

export const REGION_ICONS: Record<RegionId, string> = { metro: '🏙️', city: '🌆', rural: '🌾' };

export const STAT_ICONS: Record<keyof typeof STAT_LABELS, string> = {
  health: '❤️',
  stress: '😣',
  skill: '🛠️',
  credit: '🤝',
  relations: '👥',
};

/** イベントのカテゴリ(ログ・スナックバー・イベントの画面) */
export const CATEGORY_ICONS: Record<string, string> = {
  life: '🏠',
  career: '💼',
  money: '💰',
  health: '❤️',
  social: '🌐',
  system: '📌',
};

export const LIFE_TYPE_ICONS: Record<string, string> = { winner: '🏆', poor_happy: '🍃', rich_unhappy: '💸', hardship: '😩' };

export function genderIcon(gender: 'male' | 'female' | undefined): string {
  return gender === 'female' ? '👩' : gender === 'male' ? '👨' : '🧑';
}

/** ログのイベントのカテゴリのアイコン(イベント以外の記録は空) */
export function eventIcon(id: string | undefined): string {
  const ev = id ? gameData.events.find((e) => e.id === id) : undefined;
  return ev ? (CATEGORY_ICONS[ev.category] ?? '') : '';
}

// ---- リザルトの「人生のハイライト」 ----

/** 選んだら人生の節目になる選択肢(ラベルの先頭)。断った・見送ったものは出さない */
const MILESTONE_CHOICES: Record<string, string[]> = {
  proposal: ['結婚する'],
  promotion: ['受ける'],
  job_offer: ['同業他社に転職する', '異業種に転職する'],
  startup_chance: ['小さく起業する', '大きく起業する'],
  divorce_crisis: ['離婚する'],
  jukunen_divorce: ['別々の道を歩む'],
  regular_job_offer: ['応募して就職する'],
  regular_conversion: ['正社員になる'],
  birth: [''], // どの選択肢でも子どもが生まれる
  owner_retirement: ['引退して'],
  rehire_offer: ['再雇用で'],
};

/** 起きたら節目になる出来事(選択肢のないもの・記録) */
const MILESTONE_EVENTS = new Set([
  ...IMPORTANT_EVENTS,
  'grandchild',
  'child_independent',
  'home_bought',
  'pension_start',
  'work_end',
  'business_closed',
]);

/** 大きなお金の動き(これ以上なら節目として出す) */
const MILESTONE_MONEY = 3_000_000;

/** 年表から節目だけを選ぶ(結婚・出産・転職・昇進・マイホーム・大きなお金の動き・家族の死・定年・亡くなったとき) */
export function lifeHighlights<T extends { type: string; id?: string; text: string; money?: number }>(entries: readonly T[]): T[] {
  return entries.filter((e) => {
    if (e.type === 'death') return true;
    if (e.money !== undefined && Math.abs(e.money) >= MILESTONE_MONEY) return true;
    if (e.type === 'event') return MILESTONE_EVENTS.has(e.id ?? '');
    if (e.type === 'choice') {
      const labels = MILESTONE_CHOICES[e.id ?? ''];
      return labels !== undefined && labels.some((l) => e.text.includes(`「${l}`));
    }
    return false;
  });
}

/** 年代ごとに分ける(20代・30代…)。年代の若い順 */
export function byDecade<T extends { ageMonths: number }>(entries: readonly T[]): { decade: number; entries: T[] }[] {
  const groups = new Map<number, T[]>();
  for (const e of entries) {
    const decade = Math.floor(e.ageMonths / 120) * 10;
    groups.set(decade, [...(groups.get(decade) ?? []), e]);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([decade, list]) => ({ decade, entries: list }));
}
