// engine 共通の小さなヘルパー

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

/** 元利均等の毎月の返済額 */
export function annuityPayment(principal: number, annualRate: number, months: number): number {
  if (annualRate === 0) return roundYen(principal / months);
  const r = annualRate / 12;
  return roundYen((principal * r) / (1 - (1 + r) ** -months));
}
