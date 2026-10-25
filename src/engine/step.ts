// 1ヶ月を進める(SPEC.md「月次処理の順序」、DESIGN.md §4)。計算は各モジュールに任せ、ここは順番だけを持つ。
import { defaultData } from '../data/index';
import { rollDeath } from './death';
import { applyChoice, drawEvent, fireEvent } from './events';
import { computeHappiness, updateAdaptation } from './happiness';
import { annualGross, applyMonthlyMoney, calcIncome, retire } from './money';
import { DEATH_CAUSE_LABELS } from './result';
import type { Rng } from './rng';
import { updateStats } from './stats';
import type { GameData, GameState, Policy } from './types';
import { addLog, financialAssets, findById, netWorth } from './util';

export const POLICY_LABELS = {
  work: { regular: '定時', normal: '普通', overtime: '残業多め', grind: '激務' },
  spending: { frugal: '節約', normal: '普通', comfort: 'ゆとり', lavish: '浪費' },
  invest: { deposit: '預金のみ', index: '積立(インデックス)', stocks: '個別株', speculative: '信用取引・仮想通貨' },
  health: { ignore: '気にしない', normal: '普通', active: '意識高め' },
} as const;

/**
 * 新しい state を作る。小さいオブジェクトは複製し、配列は追記の前に複製する。
 * (structuredClone は1,000人生の自動プレイで遅すぎるため)
 */
function cloneState(s: GameState): GameState {
  return {
    ...s,
    eventHistory: { ...s.eventHistory },
    character: { ...s.character },
    values: { ...s.values },
    policy: { ...s.policy },
    stats: { ...s.stats },
    assets: { ...s.assets },
    ...(s.invested ? { invested: { ...s.invested } } : {}),
    flags: { ...s.flags },
    happinessHistory: s.happinessHistory.slice(),
    log: s.log.slice(),
    ...(s.pendingEvent ? { pendingEvent: { ...s.pendingEvent } } : {}),
    ...(s.dead ? { dead: { ...s.dead } } : {}),
  };
}

function manYen(yen: number): string {
  return `${Math.round(yen / 10_000).toLocaleString('ja-JP')}万円`;
}

/** 年間サマリーのタイミング(開始から12ヶ月ごと)か */
export function isYearEnd(state: GameState): boolean {
  return state.month > 0 && state.month % 12 === 0;
}

/**
 * 1ヶ月進めて新しい state を返す。死亡後・選択待ちの間は何もしない。
 * rng は呼び出し側が createRng(state.rngState) で作って渡す。使い終わった位置は戻り値の rngState に入る。
 */
export function stepMonth(state: GameState, rng: Rng, data: GameData = defaultData): GameState {
  if (state.dead || state.pendingEvent) return state;
  const s = cloneState(state);
  const { balance } = data;

  // 1. 時間。65歳で退職
  s.month += 1;
  s.ageMonths += 1;
  if (!s.character.retired && s.ageMonths >= balance.pension.retireAge * 12) {
    retire(s, data);
    addLog(s, 'event', `定年退職: ${balance.pension.retireAge}歳で退職した`, 'retirement');
  }

  // 2〜5. お金。そのあとタイマーを1ヶ月進める(DESIGN.md §3)
  applyMonthlyMoney(s, rng, data);
  for (const key of Object.keys(balance.timers)) {
    const v = s.flags[key];
    if (typeof v === 'number' && v > 0) s.flags[key] = v - 1;
  }

  // 6. ステータス
  updateStats(s, data);

  // 7. イベント(選択肢があれば pendingEvent がセットされる)
  const ev = drawEvent(s, rng, data);
  if (ev) fireEvent(s, ev, rng, data);

  // 8. 幸福度と慣れ
  s.happinessHistory.push(computeHappiness(s, data));
  updateAdaptation(s, data);

  // 9. 死亡判定
  const cause = rollDeath(s, rng, data);
  if (cause) {
    s.dead = { cause, ageMonths: s.ageMonths };
    delete s.pendingEvent;
    addLog(s, 'death', `${Math.floor(s.ageMonths / 12)}歳、${DEATH_CAUSE_LABELS[cause]}で亡くなった`);
    s.rngState = rng.state;
    return s;
  }

  // 10. 年間サマリー
  if (isYearEnd(s)) {
    const age = Math.floor(s.ageMonths / 12);
    addLog(s, 'year_summary', `${age}歳(${s.month / 12}年目) 金融資産 ${manYen(financialAssets(s.assets))}`);
  }

  s.rngState = rng.state;
  return s;
}

/** 選択待ちのイベントで選択肢を選ぶ */
export function resolveChoice(
  state: GameState,
  choiceIndex: number,
  rng: Rng,
  data: GameData = defaultData,
): GameState {
  if (!state.pendingEvent) throw new Error('resolveChoice: 選択待ちのイベントがない');
  const s = cloneState(state);
  const ev = findById(data.events, s.pendingEvent!.eventId, 'event');
  applyChoice(s, ev, choiceIndex, rng, data);
  delete s.pendingEvent;
  s.rngState = rng.state;
  return s;
}

/** 方針を変える。次の月から反映される */
export function changePolicy(state: GameState, policy: Policy): GameState {
  const s = cloneState(state);
  s.policy = { ...policy };
  const l = POLICY_LABELS;
  addLog(
    s,
    'policy',
    `方針変更: 働き方「${l.work[policy.work]}」支出「${l.spending[policy.spending]}」投資「${l.invest[policy.invest]}」健康「${l.health[policy.health]}」`,
  );
  return s;
}

export interface MonthlyView {
  age: number;
  jobLabel: string;
  regionLabel: string;
  annualGross: number;
  householdNet: number; // 世帯の手取り(月)
  financialAssets: number;
  debt: number;
  studentLoan: number;
  netWorth: number;
  happiness: number;
}

/** UI 表示用の値(state から導出するだけ) */
export function getMonthlyView(state: GameState, data: GameData = defaultData): MonthlyView {
  const c = state.character;
  const jobLabel = c.retired ? '退職' : c.job === 'none' ? '無職' : findById(data.jobs, c.job, 'job').label;
  return {
    age: Math.floor(state.ageMonths / 12),
    jobLabel,
    regionLabel: findById(data.regions, c.region, 'region').label,
    annualGross: annualGross(state, data),
    householdNet: calcIncome(state, data).total,
    financialAssets: financialAssets(state.assets),
    debt: state.assets.debt,
    studentLoan: state.assets.studentLoan,
    netWorth: netWorth(state.assets),
    happiness: state.happinessHistory.at(-1) ?? 0,
  };
}
