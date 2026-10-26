// NISAと特定口座(第2弾。DESIGN.md §17)
//
// assets.index / assets.stocks は2つの口座の合計。そのうちNISAの分は「割合」(frac)で持つ。
// 値上がり・暴落・財産分与は口座によらず同じ割合で効くので、割合は変わらない。
// 変わるのは買うときと売るときだけで、どちらもこのファイルの関数を通す。
// stepMonth などが複製した state を直接更新する。
import { defaultData } from '../data/index';
import type { GameData, GameState, NisaKey, NisaState } from './types';
import { roundYen } from './util';

export const NISA_KEYS: readonly NisaKey[] = ['index', 'stocks'];
type InvestKey = NisaKey | 'speculative';

export function emptyNisa(): NisaState {
  return { frac: { index: 0, stocks: 0 }, principal: { index: 0, stocks: 0 }, year: { tsumitate: 0, growth: 0 } };
}

/** 古いセーブには nisa がないので、必要になったときに作る */
function nisaOf(state: GameState): NisaState {
  state.nisa ??= emptyNisa();
  return state.nisa;
}

function isNisaKey(key: InvestKey): key is NisaKey {
  return key === 'index' || key === 'stocks';
}

/** NISAで持っている額(時価) */
export function nisaValue(state: GameState, key: InvestKey): number {
  if (!isNisaKey(key) || !state.nisa) return 0;
  return roundYen(state.assets[key] * state.nisa.frac[key]);
}

/** 元本(つぎ込んだ額)のうち、特定口座の分 */
function taxablePrincipal(state: GameState, key: InvestKey): number | undefined {
  if (!state.invested) return undefined;
  const nisa = isNisaKey(key) && state.nisa ? state.nisa.principal[key] : 0;
  return Math.max(0, state.invested[key] - nisa);
}

/** 今年と生涯の、NISAで買える残り */
export function nisaRoom(state: GameState, data: GameData = defaultData): Record<NisaKey, number> & { lifetime: number } {
  const cfg = data.balance.nisa;
  const n = state.nisa ?? emptyNisa();
  const lifetime = Math.max(0, cfg.lifetimeTotal - n.principal.index - n.principal.stocks);
  const growth = Math.max(0, Math.min(cfg.growthAnnual - n.year.growth, cfg.lifetimeGrowth - n.principal.stocks));
  const tsumitate = Math.max(0, cfg.tsumitateAnnual - n.year.tsumitate);
  return { index: Math.min(lifetime, tsumitate + growth), stocks: Math.min(lifetime, growth), lifetime };
}

/** 割合を、NISAの時価と口座の合計から決め直す */
function setFrac(state: GameState, key: NisaKey, nisaVal: number): void {
  const total = state.assets[key];
  nisaOf(state).frac[key] = total > 0 ? Math.min(1, Math.max(0, nisaVal / total)) : 0;
}

/**
 * 買う(預金からの積立・まとめ買い)。NISAの枠から先に使い、超えた分は特定口座。
 * 預金は呼び出し側で減らす。NISAに入った額を返す
 */
export function buyInvestment(state: GameState, key: InvestKey, amount: number, data: GameData = defaultData): number {
  if (amount <= 0) return 0;
  const before = nisaValue(state, key);
  state.assets[key] += amount;
  if (state.invested) state.invested[key] += amount;
  if (!isNisaKey(key)) return 0;
  const n = nisaOf(state);
  const toNisa = Math.min(amount, nisaRoom(state, data)[key]);
  if (key === 'index') {
    const tsumitate = Math.min(toNisa, Math.max(0, data.balance.nisa.tsumitateAnnual - n.year.tsumitate));
    n.year.tsumitate += tsumitate;
    n.year.growth += toNisa - tsumitate;
  } else {
    n.year.growth += toNisa;
  }
  n.principal[key] += toNisa;
  setFrac(state, key, before + toNisa);
  return toNisa;
}

export interface SaleResult {
  gross: number; // 売った額
  tax: number; // 特定口座の利益にかかった税金
  gain: number; // 損益(売った額 − 元本。元本がわからない古いセーブは0)
  fromNisa: number; // うちNISAから売った額
}

/** 特定口座から売る(利益に税金)。売った額は口座の時価まで */
function sellTaxable(state: GameState, key: InvestKey, gross: number, data: GameData): SaleResult {
  const nisaVal = nisaValue(state, key);
  const value = state.assets[key] - nisaVal;
  const sell = Math.min(Math.max(0, gross), value);
  if (sell <= 0) return { gross: 0, tax: 0, gain: 0, fromNisa: 0 };
  const principal = taxablePrincipal(state, key);
  const soldPrincipal = principal === undefined ? sell : roundYen((principal * sell) / value);
  const gain = sell - soldPrincipal;
  const tax = roundYen(Math.max(0, gain) * data.balance.nisa.taxRate);
  state.assets[key] -= sell;
  if (state.invested) state.invested[key] -= soldPrincipal;
  if (isNisaKey(key)) setFrac(state, key, nisaVal);
  return { gross: sell, tax, gain: principal === undefined ? 0 : gain, fromNisa: 0 };
}

/** NISAから売る(非課税)。売った元本の分だけ生涯の枠が空く */
function sellNisa(state: GameState, key: InvestKey, gross: number): SaleResult {
  if (!isNisaKey(key)) return { gross: 0, tax: 0, gain: 0, fromNisa: 0 };
  const value = nisaValue(state, key);
  const sell = Math.min(Math.max(0, gross), value);
  if (sell <= 0) return { gross: 0, tax: 0, gain: 0, fromNisa: 0 };
  const n = nisaOf(state);
  const soldPrincipal = roundYen((n.principal[key] * sell) / value);
  n.principal[key] -= soldPrincipal;
  state.assets[key] -= sell;
  if (state.invested) state.invested[key] -= soldPrincipal;
  setFrac(state, key, value - sell);
  return { gross: sell, tax: 0, gain: sell - soldPrincipal, fromNisa: sell };
}

function add(a: SaleResult, b: SaleResult): SaleResult {
  return { gross: a.gross + b.gross, tax: a.tax + b.tax, gain: a.gain + b.gain, fromNisa: a.fromNisa + b.fromNisa };
}

/**
 * 額を決めて売る。from: 'taxable' 特定口座だけ / 'nisa' NISAだけ / 'auto' 特定口座から先に。
 * 預金は呼び出し側で増やす(gross − tax)
 */
export function sellInvestment(
  state: GameState,
  key: InvestKey,
  gross: number,
  from: 'taxable' | 'nisa' | 'auto',
  data: GameData = defaultData,
): SaleResult {
  if (from === 'nisa') return sellNisa(state, key, gross);
  const taxable = sellTaxable(state, key, gross, data);
  if (from === 'taxable') return taxable;
  return add(taxable, sellNisa(state, key, gross - taxable.gross));
}

/** 手取りで need 円になるまで売る(資金ショート用)。特定口座から先に、税金のぶん多めに売る */
export function sellForCash(state: GameState, key: InvestKey, need: number, data: GameData = defaultData): SaleResult {
  const value = state.assets[key] - nisaValue(state, key);
  const principal = taxablePrincipal(state, key);
  const gainShare = principal === undefined || value <= 0 ? 0 : Math.max(0, 1 - principal / value);
  const netPerYen = 1 - data.balance.nisa.taxRate * gainShare;
  const taxable = sellTaxable(state, key, Math.ceil(need / netPerYen), data);
  const still = need - (taxable.gross - taxable.tax);
  return still > 0 ? add(taxable, sellNisa(state, key, still)) : taxable;
}

/** 年が明けたら(暦の1月)、今年の枠を戻す */
export function resetNisaYear(state: GameState): void {
  if (state.nisa) state.nisa.year = { tsumitate: 0, growth: 0 };
}

/** 財産分与などで元本を同じ割合で減らす(割合 frac は変わらない) */
export function scaleNisaPrincipal(state: GameState, key: InvestKey, mul: number): void {
  if (isNisaKey(key) && state.nisa) state.nisa.principal[key] = roundYen(state.nisa.principal[key] * mul);
}
