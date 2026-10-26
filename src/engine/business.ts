// 起業(第2弾。DESIGN.md §18)
// 社長の職業は 'owner'。収入(役員報酬)は会社の業績 level で決まり、1年ごとの決算で level が上下する。
// stepMonth / applyEffects が複製した state を直接更新する。
import { defaultData } from '../data/index';
import type { Rng } from './rng';
import type { BusinessScale, GameData, GameState, JobDef } from './types';
import { addLog, clamp, roundYen } from './util';

/** 社長の職業定義(jobs.json には置かない。ガチャで社長は引かない) */
export function ownerJob(data: GameData = defaultData): JobDef {
  return { id: 'owner', label: data.balance.business.label, startPay: 0, peakPay: 0, employeePension: true, severance: 0, layoffRate: 0, bonusMonths: 0 };
}

export function hasBusiness(state: GameState): boolean {
  return state.business !== undefined && state.character.job === 'owner';
}

/** 役員報酬(額面・月額) */
export function ownerSalary(state: GameState, data: GameData = defaultData): number {
  const b = state.business;
  if (!b) return 0;
  const cfg = data.balance.business;
  return roundYen(clamp(cfg.salaryBase[b.scale] * b.level, cfg.salaryMin, cfg.salaryMax));
}

/** 会社の価値(売るといくらになるか)。役員報酬 × level をもとにした利益の数年分 */
export function businessValue(state: GameState, data: GameData = defaultData): number {
  const b = state.business;
  if (!b) return 0;
  const cfg = data.balance.business;
  const profit = Math.max(0, cfg.salaryBase[b.scale] * (b.level - cfg.breakEvenLevel));
  return roundYen(profit * cfg.valuationMonths);
}

/** 起業する(元手は呼び出し側で現金から引く)。職業は呼び出し側で 'owner' にする */
export function startBusiness(state: GameState, scale: BusinessScale, data: GameData = defaultData): void {
  state.business = { since: state.month, scale, level: data.balance.business.startLevel };
}

/** 会社を閉じる・売る。職業は無職に戻り、自営業なので失業給付はない */
export function endBusiness(state: GameState): void {
  delete state.business;
}

/** 決算での業績の伸び(年率)の平均。スキル・運・働き方・不況で変わる */
export function reviewMean(state: GameState, data: GameData = defaultData): number {
  const r = data.balance.business.review;
  let mu = r.mu;
  mu += r.skillMul * (state.stats.skill - 50);
  mu += r.luckMul * (state.character.luck - 50);
  mu += r.work[state.policy.work];
  if (typeof state.flags.recession === 'number' && state.flags.recession > 0) mu += r.recession;
  return mu;
}

/**
 * 1年ごとの決算。起業した月から12ヶ月ごとに、業績 level を掛け算で動かす。
 * level が failLevel を下回ったら廃業(整理費用がかかる)。廃業したら true を返す
 */
export function reviewBusiness(state: GameState, rng: Rng, data: GameData = defaultData): boolean {
  const b = state.business;
  if (!b || state.month === b.since || (state.month - b.since) % 12 !== 0) return false;
  const cfg = data.balance.business;
  const change = rng.normal(reviewMean(state, data), cfg.review.sigma);
  b.level = clamp(b.level * Math.exp(change), 0, cfg.maxLevel);
  const years = (state.month - b.since) / 12;
  if (b.level < cfg.failLevel) {
    const cost = cfg.closeCost[b.scale];
    state.assets.cash -= cost;
    endBusiness(state);
    addLog(state, 'event', `廃業: ${years}年目の決算で立て直せず、会社をたたんだ(整理の費用 ${manYen(cost)})`, 'business_closed');
    return true;
  }
  const word = change >= 0.15 ? '大きく伸びた' : change >= 0 ? '少し伸びた' : change > -0.15 ? '少し落ちた' : '大きく落ちた';
  addLog(state, 'event', `決算: ${years}年目、業績が${word}(役員報酬 月${manYen(ownerSalary(state, data))})`, 'business_review');
  return false;
}

function manYen(yen: number): string {
  return `${Math.round(yen / 10_000).toLocaleString('ja-JP')}万円`;
}
