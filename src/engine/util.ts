// engine 共通の小さなヘルパー
import type { Assets, GameState, LogEntry, LogType } from './types';

export function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

/** ステータス(0〜100) */
export function clampStat(x: number): number {
  return clamp(x, 0, 100);
}

/** 価値観(-2〜+2) */
export function clampValue(x: number): number {
  return clamp(x, -2, 2);
}

/** 金額は円の整数 */
export function roundYen(x: number): number {
  return Math.round(x);
}

/** 金融資産(借金は引かない) */
export function financialAssets(assets: Assets): number {
  return assets.cash + assets.index + assets.stocks + assets.speculative;
}

/** 純資産 = 金融資産 + 家の時価 − 借金 − 奨学金の残高 − ローンの残高 − 住宅ローンの残高 */
export function netWorth(assets: Assets): number {
  return (
    financialAssets(assets) +
    (assets.home ?? 0) -
    assets.debt -
    assets.studentLoan -
    (assets.loan ?? 0) -
    (assets.mortgage ?? 0)
  );
}

export function ageYears(state: GameState): number {
  return state.ageMonths / 12;
}

/** log に1件足す(snapshot は今の状態から作る) */
export function addLog(state: GameState, type: LogType, text: string, id?: string): void {
  const entry: LogEntry = {
    month: state.month,
    ageMonths: state.ageMonths,
    type,
    ...(id !== undefined ? { id } : {}),
    text,
    snapshot: {
      netWorth: netWorth(state.assets),
      health: Math.round(state.stats.health),
      happiness: Math.round(state.happinessHistory.at(-1) ?? 0),
    },
  };
  state.log.push(entry);
}

export function findById<T extends { id: string }>(items: readonly T[], id: string, label: string): T {
  const found = items.find((x) => x.id === id);
  if (!found) throw new Error(`unknown ${label}: ${id}`);
  return found;
}

/** 元利均等の毎月の返済額 */
export function annuityPayment(principal: number, annualRate: number, months: number): number {
  if (annualRate === 0) return roundYen(principal / months);
  const r = annualRate / 12;
  return roundYen((principal * r) / (1 - (1 + r) ** -months));
}
