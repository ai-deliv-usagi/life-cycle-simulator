// 方針の各選択肢を選ぶと、つまりどうなるか(細かい数字は出さない)
import type { EducationPolicy, HealthCare, Invest, Spending, WorkStyle } from '../engine/index';

const WORK: Record<WorkStyle, string> = {
  regular: '収入は控えめ。自由時間が多く、心と体にやさしい',
  normal: '収入も自由時間もほどほど',
  overtime: '稼げて出世もしやすいが、自由時間が減り、心と体の負担が増える',
  grind: 'いちばん稼げるが、体を壊しやすく、寿命が縮む',
};

const SPENDING: Record<Spending, string> = {
  frugal: 'お金は貯まりやすいが、暮らしの満足は低め。付き合いも減りがち',
  normal: '稼ぎに見合った暮らし。そこそこ貯まる',
  comfort: '暮らしの満足は上がるが、あまり貯まらない',
  lavish: '満足度は高いが、若いうちは借金になりやすい',
};

const HEALTH: Record<HealthCare, string> = {
  ignore: 'お金はかからないが、少しずつ健康が落ちる',
  normal: '少しお金をかけて、健康を保つ',
  active: 'お金はかかるが、健康で長生きしやすい',
};

const INVEST: Record<Invest, string> = {
  deposit: '増えないが、減らない',
  index: 'ゆっくり着実に増えやすい',
  stocks: '大きく増えることも、減ることもある',
  speculative: '一発逆転もあるが、暴落で大きく失うことも',
};

const EDUCATION: Record<EducationPolicy, string> = {
  public: '学費は抑えめ。子どもがいるときだけ効く',
  private: '中学から私立・大学も私立。お金はかなりかかる。子どもがいるときだけ効く',
};

export const workHelp = (w: WorkStyle): string => WORK[w];
export const spendingHelp = (s: Spending): string => SPENDING[s];
export const healthHelp = (c: HealthCare): string => HEALTH[c];
export const investHelp = (k: Invest): string => INVEST[k];
export const educationHelp = (e: EducationPolicy): string => EDUCATION[e];
