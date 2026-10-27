// ボタン1つで選べる「タイプ」(価値観)と「方針」の組み合わせ。選ぶのは最小限にして、細かい調整は「細かく決める」で
import type { InvestAllocation, Policy, Values } from '../engine/index';

export interface ValuePreset {
  id: string;
  label: string;
  description: string;
  values: Values;
  policy: string; // このタイプに合う方針(POLICY_PRESETS の id)
}

export interface PolicyPreset {
  id: string;
  label: string;
  description: string;
  policy: Omit<Policy, 'prepay' | 'education' | 'investMonthly'>;
}

const DEPOSIT_ONLY: InvestAllocation = { deposit: 100, index: 0, stocks: 0, speculative: 0 };
const INDEX_MAIN: InvestAllocation = { deposit: 30, index: 70, stocks: 0, speculative: 0 };
const BALANCED: InvestAllocation = { deposit: 20, index: 50, stocks: 30, speculative: 0 };
const AGGRESSIVE: InvestAllocation = { deposit: 0, index: 20, stocks: 50, speculative: 30 };

/** 価値観: risk(安定 −2 〜 挑戦 +2)、relation(家族 −2 〜 自由 +2)、spending(貯める −2 〜 使う +2)、work(生活 −2 〜 やりがい +2) */
export const VALUE_PRESETS: ValuePreset[] = [
  {
    id: 'steady',
    label: '堅実派',
    description: '安定志向で家族寄り、しっかり貯める',
    values: { risk: -2, relation: -1, spending: -2, work: 0 },
    policy: 'steady',
  },
  {
    id: 'climber',
    label: '出世派',
    description: '挑戦志向で、仕事のやりがいを重視する',
    values: { risk: 1, relation: 1, spending: 0, work: 2 },
    policy: 'ambitious',
  },
  {
    id: 'spender',
    label: '浪費家',
    description: '挑戦寄り・自由寄りで、お金は使う派',
    values: { risk: 1, relation: 1, spending: 2, work: 0 },
    policy: 'lavish',
  },
  {
    id: 'family',
    label: '家族思い',
    description: '家族を大事にし、生活とのバランスを取る',
    values: { risk: -1, relation: -2, spending: 0, work: -1 },
    policy: 'balance',
  },
  {
    id: 'free',
    label: '自由人',
    description: '自由志向で、自分の時間を大切にする',
    values: { risk: 1, relation: 2, spending: 1, work: -1 },
    policy: 'relaxed',
  },
  {
    id: 'neutral',
    label: 'ふつう',
    description: 'どれも中間',
    values: { risk: 0, relation: 0, spending: 0, work: 0 },
    policy: 'balance',
  },
];

export const POLICY_PRESETS: PolicyPreset[] = [
  {
    id: 'steady',
    label: '堅実',
    description: '定時で働き、節約して積立。健康にも気をつける',
    policy: { work: 'regular', spending: 'frugal', invest: INDEX_MAIN, health: 'active' },
  },
  {
    id: 'balance',
    label: 'バランス',
    description: 'ほどほどに働き、稼ぎに見合った暮らしで積立',
    policy: { work: 'normal', spending: 'normal', invest: INDEX_MAIN, health: 'normal' },
  },
  {
    id: 'ambitious',
    label: 'バリバリ',
    description: '残業して稼ぎ、出世を目指す。暮らしにはゆとりを、健康もほどほどに',
    policy: { work: 'overtime', spending: 'comfort', invest: BALANCED, health: 'normal' },
  },
  {
    id: 'hustle',
    label: 'モーレツ',
    description: '激務で稼ぎ、ゆとりある暮らし。投資は攻め気味',
    policy: { work: 'grind', spending: 'comfort', invest: BALANCED, health: 'ignore' },
  },
  {
    id: 'relaxed',
    label: 'のんびり',
    description: '定時で帰り、ゆとりのある暮らし。お金は預金',
    policy: { work: 'regular', spending: 'comfort', invest: DEPOSIT_ONLY, health: 'normal' },
  },
  {
    id: 'healthy',
    label: '健康第一',
    description: '定時で働き、健康に投資。長生きしやすい',
    policy: { work: 'regular', spending: 'normal', invest: INDEX_MAIN, health: 'active' },
  },
  {
    id: 'lavish',
    label: '浪費',
    description: 'ふつうに働き、使いたいだけ使う。投資は攻め',
    policy: { work: 'normal', spending: 'lavish', invest: AGGRESSIVE, health: 'normal' },
  },
];

/** 今の方針がどのプリセットと同じか(どれとも違えば undefined) */
export function presetIdOfPolicy(p: Policy): string | undefined {
  return POLICY_PRESETS.find(
    (x) =>
      x.policy.work === p.work &&
      x.policy.spending === p.spending &&
      x.policy.health === p.health &&
      (Object.keys(x.policy.invest) as (keyof InvestAllocation)[]).every((k) => x.policy.invest[k] === p.invest[k]),
  )?.id;
}
