// リザルトと人生タイプ(SPEC.md「リザルトと人生タイプ」)
import { defaultData } from '../data/index';
import type { DeathCause, GameData, GameState, LifeResult, LifeType } from './types';
import { netWorth } from './util';

export const LIFE_TYPE_LABELS: Record<LifeType, string> = {
  winner: '豊かな勝ち組',
  poor_happy: '身軽な勝ち組',
  rich_unhappy: '金持ち不幸型',
  hardship: '苦労人型',
};

export const DEATH_CAUSE_LABELS: Record<DeathCause, string> = {
  illness: '病気',
  overwork: '過労',
  accident: '事故',
  old_age: '老衰',
};

export function lifeType(lifetimeHappiness: number, finalNetWorth: number, data: GameData = defaultData): LifeType {
  const { netWorthLine, happinessLine } = data.balance.result;
  const happy = lifetimeHappiness >= happinessLine;
  const rich = finalNetWorth >= netWorthLine;
  if (happy) return rich ? 'winner' : 'poor_happy';
  return rich ? 'rich_unhappy' : 'hardship';
}

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** 死亡した state からリザルトを作る */
export function computeResult(state: GameState, data: GameData = defaultData): LifeResult {
  if (!state.dead) throw new Error('computeResult: まだ死んでいない');
  const lifetimeHappiness = mean(state.happinessHistory);
  const finalNetWorth = netWorth(state.assets);

  // グラフ用: 年間サマリーの時点の純資産と、その1年間の幸福度の平均。最後に死亡時点を足す
  const yearly: LifeResult['yearly'] = [];
  for (const entry of state.log) {
    if (entry.type !== 'year_summary') continue;
    const months = state.happinessHistory.slice(Math.max(0, entry.month - 12), entry.month);
    yearly.push({
      age: entry.ageMonths / 12,
      netWorth: entry.snapshot.netWorth,
      happiness: mean(months),
      ...(entry.assets ? { assets: entry.assets } : {}),
    });
  }
  const lastYearEnd = yearly.length > 0 ? state.log.filter((e) => e.type === 'year_summary').at(-1)!.month : 0;
  if (state.month > lastYearEnd) {
    yearly.push({
      age: state.dead.ageMonths / 12,
      netWorth: finalNetWorth,
      happiness: mean(state.happinessHistory.slice(lastYearEnd)),
    });
  }

  return {
    ageAtDeath: Math.floor(state.dead.ageMonths / 12),
    cause: state.dead.cause,
    finalNetWorth,
    lifetimeHappiness,
    lifeType: lifeType(lifetimeHappiness, finalNetWorth, data),
    yearly,
    timeline: state.log.filter((e) => e.type === 'event' || e.type === 'choice' || e.type === 'death'),
  };
}
