// 方針の正規化(投資の配分)。古いセーブの「投資: 積立」のような1つの指定も配分に直す
import type { Invest, InvestAllocation, Policy, PolicyInput } from './types';

export const INVEST_KEYS: readonly Invest[] = ['deposit', 'index', 'stocks', 'speculative'];

export function allocationOf(invest: InvestAllocation | Invest): InvestAllocation {
  if (typeof invest === 'string') {
    return { deposit: 0, index: 0, stocks: 0, speculative: 0, [invest]: 100 };
  }
  const out = { deposit: 0, index: 0, stocks: 0, speculative: 0 };
  for (const k of INVEST_KEYS) out[k] = Math.max(0, Math.round((invest[k] ?? 0) / 10) * 10);
  // 合計が100でなければ、預金で調整する(足りない分を足す / 多すぎる分は預金から、それでも多ければ大きい順に削る)
  let total = INVEST_KEYS.reduce((s, k) => s + out[k], 0);
  if (total < 100) out.deposit += 100 - total;
  for (const k of ['deposit', 'speculative', 'stocks', 'index'] as const) {
    total = INVEST_KEYS.reduce((s, kk) => s + out[kk], 0);
    if (total <= 100) break;
    out[k] = Math.max(0, out[k] - (total - 100));
  }
  return out;
}

export function normalizePolicy(p: PolicyInput | Policy): Policy {
  return {
    work: p.work,
    spending: p.spending,
    health: p.health,
    invest: allocationOf(p.invest),
    prepay: p.prepay ?? false,
    education: p.education ?? 'public',
    investMonthly: Math.max(0, Math.round(p.investMonthly ?? 0)),
  };
}

/**
 * 毎月決まった額を積み立てるときの、積立・個別株・信用/仮想通貨の割合(合計1)。
 * 配分の「預金」は使わず、残りの3つの比で分ける。どれも0なら空
 */
export function fixedInvestShares(p: Policy): Partial<Record<Exclude<Invest, 'deposit'>, number>> {
  const keys = ['index', 'stocks', 'speculative'] as const;
  const total = keys.reduce((s, k) => s + p.invest[k], 0);
  const out: Partial<Record<Exclude<Invest, 'deposit'>, number>> = {};
  if (total <= 0) return out;
  for (const k of keys) if (p.invest[k] > 0) out[k] = p.invest[k] / total;
  return out;
}
