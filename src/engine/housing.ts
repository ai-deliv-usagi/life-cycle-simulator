// マイホームと住宅ローン(第2弾。DESIGN.md §19)
// 家の時価は assets.home、住宅ローンの残高は assets.mortgage(どちらも純資産に入る)。
// 買った時の情報は state.home。stepMonth / applyEffects が複製した state を直接更新する。
import { defaultData } from '../data/index';
import { recordEventCash } from './ledger';
import type { GameData, GameState } from './types';
import { addLog, ageYears, annuityPayment, roundYen } from './util';

function manYen(yen: number): string {
  return `${Math.round(yen / 10_000).toLocaleString('ja-JP')}万円`;
}

export function ownsHome(state: GameState): boolean {
  return state.home !== undefined;
}

/** 買う家の値段。地域の相場を上限に、年収の priceIncomeMultiple 倍まで(収入に見合った家を選ぶ。最低 minPrice) */
export function homePrice(state: GameState, annualGross: number, data: GameData = defaultData): number {
  const h = data.balance.housing;
  const affordable = Math.max(h.minPrice, Math.floor((annualGross * h.priceIncomeMultiple) / 1_000_000) * 1_000_000);
  return Math.min(h.price[state.character.region], affordable);
}

/** 家賃(最低限の生活費のうち家賃の分)。持ち家なら払わない */
export function rentPart(floor: number, data: GameData = defaultData): number {
  return floor * data.balance.housing.rentShare;
}

/** 住宅ローンの審査。通らなければ理由を返す */
export function mortgageRejection(state: GameState, principal: number, annualGross: number, data: GameData = defaultData): string | null {
  const m = data.balance.housing.mortgage;
  if (state.stats.credit < m.minCredit || (typeof state.flags.blacklist === 'number' && state.flags.blacklist > 0)) {
    return '信用が足りない';
  }
  if (principal > annualGross * m.maxIncomeMultiple) return '年収に対して借りる額が大きすぎる';
  if (mortgageMonths(state, data) < 12 * m.minYears) return '年齢的に返し終わらない';
  return null;
}

/** 返済の回数。最長 years 年で、maxAge 歳までに返し終わる */
export function mortgageMonths(state: GameState, data: GameData = defaultData): number {
  const m = data.balance.housing.mortgage;
  return Math.min(m.years * 12, Math.floor((m.maxAge - ageYears(state)) * 12));
}

/**
 * 家を買う。頭金(down: 価格に対する割合)と諸費用は現金で払い、残りを住宅ローンにする。
 * 審査に落ちたら買わずに false
 */
export function buyHome(state: GameState, down: number, annualGross: number, data: GameData = defaultData): boolean {
  const h = data.balance.housing;
  const price = homePrice(state, annualGross, data);
  const principal = roundYen(price * (1 - down));
  const rejected = mortgageRejection(state, principal, annualGross, data);
  if (rejected) {
    addLog(state, 'event', `住宅ローンの審査に落ちた: ${rejected}ため、家は買えなかった`, 'mortgage_rejected');
    return false;
  }
  const cash = roundYen(price * down + price * h.closingCost);
  state.assets.cash -= cash; // 収支への記録は呼び出し側(applyEffects)でまとめて行う
  const months = mortgageMonths(state, data);
  state.assets.home = price;
  state.assets.mortgage = principal;
  state.home = {
    boughtMonth: state.month,
    price,
    payment: annuityPayment(principal, h.mortgage.annualRate, months),
  };
  addLog(
    state,
    'event',
    `マイホーム: ${manYen(price)}の家を買った(頭金と諸費用 ${manYen(cash)}、住宅ローン ${manYen(principal)}・${Math.round(months / 12)}年)`,
    'home_bought',
  );
  return true;
}

/** 今月の住宅ローンの返済額(利息込み)と、そのうち元本に充てる額 */
export function mortgagePayment(state: GameState, data: GameData = defaultData): { payment: number; principal: number } {
  const balance = state.assets.mortgage ?? 0;
  const monthly = state.home?.payment ?? 0;
  if (balance <= 0 || monthly <= 0) return { payment: 0, principal: 0 };
  const interest = roundYen((balance * data.balance.housing.mortgage.annualRate) / 12);
  if (balance + interest - monthly < monthly * 0.01) return { payment: balance + interest, principal: balance };
  return { payment: monthly, principal: monthly - interest };
}

/** 固定資産税・修繕など、持ち家にかかる毎月の費用 */
export function homeOwnershipCost(state: GameState, data: GameData = defaultData): number {
  return state.home ? roundYen((state.home.price * data.balance.housing.ownershipCostRate) / 12) : 0;
}

/** 住宅ローン控除(手取りが増える分・月額)。買ってから years 年、残高 × rate */
export function housingDeduction(state: GameState, data: GameData = defaultData): number {
  const d = data.balance.housing.deduction;
  const h = state.home;
  if (!h || state.month - h.boughtMonth >= d.years * 12) return 0;
  return roundYen((Math.min(state.assets.mortgage ?? 0, d.maxBalance) * d.rate) / 12);
}

/** 家の時価を1ヶ月ぶん動かす(地域ごとの年率) */
export function updateHomeValue(state: GameState, data: GameData = defaultData): void {
  if (!state.home || state.assets.home === undefined) return;
  const change = data.balance.housing.valueChange[state.character.region];
  state.assets.home = roundYen(state.assets.home * (1 + change / 12));
}

/** 家を売る。売った額(手数料を引く)でローンを返し、残りを現金にする。手取りを返す */
export function sellHome(state: GameState, reason: string, data: GameData = defaultData): number {
  if (!state.home) return 0;
  const value = state.assets.home ?? 0;
  const proceeds = roundYen(value * (1 - data.balance.housing.sellCost)) - (state.assets.mortgage ?? 0);
  state.assets.cash += proceeds;
  recordEventCash(state, proceeds);
  delete state.home;
  state.assets.home = 0;
  state.assets.mortgage = 0;
  addLog(state, 'event', `家を売った: ${reason}(ローンを返したあとの手取り ${manYen(proceeds)})`, 'home_sold');
  return proceeds;
}

/** 自己破産で家を失う(競売。ローンも消える) */
export function loseHome(state: GameState): void {
  if (!state.home) return;
  delete state.home;
  state.assets.home = 0;
  state.assets.mortgage = 0;
}
