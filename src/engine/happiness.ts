// 幸福度(SPEC.md「幸福度の計算と人生タイプ」、DESIGN.md §5.4)
import { defaultData } from '../data/index';
import { childEffects } from './children';
import { calcExpenses, realLivingSpending } from './money';
import { effectiveWork } from './stats';
import type { GameData, GameState, HappinessPart, Values } from './types';
import { clampStat, financialAssets, findById } from './util';

export const HAPPINESS_PARTS: readonly HappinessPart[] = [
  'living',
  'security',
  'relations',
  'freeTime',
  'health',
  'achievement',
];

export type HappinessBreakdown = Record<HappinessPart, number>;

/** 価値観で決まる各要素の重み(最小 minWeight) */
export function happinessWeights(values: Values, data: GameData = defaultData): HappinessBreakdown {
  const h = data.balance.happiness;
  const out = {} as HappinessBreakdown;
  for (const part of HAPPINESS_PARTS) {
    const cfg = h.weights[part];
    let w = cfg.base;
    for (const axis of Object.keys(values) as (keyof Values)[]) w += (cfg[axis] ?? 0) * values[axis];
    out[part] = Math.max(h.minWeight, w);
  }
  return out;
}

/** 生活水準: 絶対額(頭打ち)+ 慣れとの差 */
export function livingSatisfaction(spending: number, adapted: number, data: GameData = defaultData): number {
  const h = data.balance.happiness;
  const abs = h.livingAbsMax * (1 - Math.exp(-spending / h.livingAbsScale));
  const ratio = adapted > 0 ? spending / adapted : 1;
  const rel = (h.livingRelMax * (1 + Math.tanh(h.livingRelSlope * (ratio - 1)))) / 2;
  return clampStat(abs + rel);
}

/** 各要素の満たされ具合(0〜100) */
export function happinessParts(state: GameState, data: GameData = defaultData): HappinessBreakdown {
  const { balance } = data;
  const h = balance.happiness;
  const c = state.character;

  const months = calcExpenses(state, data).total * h.securityMonths;
  let security = 100 * Math.min(1, financialAssets(state.assets) / months);
  if (state.assets.debt > 0) security -= h.debtSecurityPenalty;
  if (state.flags.welfare === true) security = 0;

  const work = effectiveWork(state);
  let freeTime = work ? balance.work[work].freeTime : balance.retiredFreeTime;
  if (state.flags.hasCar !== true) freeTime += findById(data.regions, c.region, 'region').noCarFreeTime;
  const kids = childEffects(state, data);
  freeTime += kids.freeTime;

  return {
    living: livingSatisfaction(realLivingSpending(state, data), state.adaptedSpending, data),
    security: clampStat(security),
    relations: clampStat(state.stats.relations + (c.married ? h.marriedRelationsBonus : 0) + kids.relations),
    freeTime: clampStat(freeTime),
    health: clampStat(state.stats.health),
    achievement: clampStat(h.skillAchievementShare * state.stats.skill + state.achievement),
  };
}

/** 今月の幸福度(0〜100)= 重み付き平均 */
export function computeHappiness(state: GameState, data: GameData = defaultData): number {
  const parts = happinessParts(state, data);
  const weights = happinessWeights(state.values, data);
  let sum = 0;
  let total = 0;
  for (const part of HAPPINESS_PARTS) {
    sum += weights[part] * parts[part];
    total += weights[part];
  }
  return sum / total;
}

/** 慣れ: 約2年かけて今の生活水準に慣れる */
export function updateAdaptation(state: GameState, data: GameData = defaultData): void {
  const c = realLivingSpending(state, data);
  state.adaptedSpending += (c - state.adaptedSpending) / data.balance.happiness.adaptMonths;
}
