// 子どもと育休(第2弾。DESIGN.md §15)
// stepMonth / applyEffects が複製した state を直接更新する。
import { defaultData } from '../data/index';
import type { Rng } from './rng';
import type { Child, GameData, GameState } from './types';
import { addLog } from './util';

export function childrenOf(state: GameState): readonly Child[] {
  return state.character.children ?? [];
}

/** 子どもの年齢(月単位) */
export function childAgeMonths(state: GameState, child: Child): number {
  return state.month - child.birthMonth;
}

/** 独立する年齢。大学に進むなら最後の段階(大学)の終わり、進まなければ高校卒業 */
export function independentAge(child: Child, data: GameData = defaultData): number {
  const stages = data.balance.children.stages;
  return child.university ? stages.at(-1)!.until : stages[stages.length - 2]!.until;
}

/** まだ親が養っている子ども */
export function dependents(state: GameState, data: GameData = defaultData): Child[] {
  return childrenOf(state).filter((c) => childAgeMonths(state, c) < independentAge(c, data) * 12);
}

/** 子どもにかかる毎月の費用(生活費 + 教育方針ごとの学校・塾などの費用) */
export function childCost(state: GameState, data: GameData = defaultData): number {
  const { stages } = data.balance.children;
  let total = 0;
  for (const child of dependents(state, data)) {
    const age = childAgeMonths(state, child) / 12;
    const stage = stages.find((s) => age < s.until);
    if (stage) total += stage.living + stage.education[state.policy.education];
  }
  return total;
}

/** 児童手当(月額)。3歳未満と、3人目からは多い */
export function childAllowance(state: GameState, data: GameData = defaultData): number {
  const a = data.balance.children.allowance;
  let total = 0;
  childrenOf(state).forEach((child, order) => {
    const age = childAgeMonths(state, child) / 12;
    if (age >= a.until) return;
    if (order >= 2) total += a.third;
    else total += age < 3 ? a.under3 : a.school;
  });
  return total;
}

/** 育休の給付の割合(額面月給に掛ける)。残り月数で最初の半年か後半かを決める。育休中でなければ null */
export function parentalLeaveRate(remaining: number, spouse: boolean, data: GameData = defaultData): number | null {
  if (remaining <= 0) return null;
  const p = data.balance.children.parentalLeave;
  const first = remaining > p.months - p.firstMonths;
  if (spouse) return first ? p.spouseFirstRate : p.spouseLaterRate;
  return first ? p.firstRate : p.laterRate;
}

/** 子どもが生まれる。大学に進むかはここで決める */
export function addChild(state: GameState, rng: Rng, data: GameData = defaultData): void {
  const child: Child = { birthMonth: state.month, university: rng.chance(data.balance.children.universityProb) };
  state.character.children = [...childrenOf(state), child];
}

/** 今月ちょうど独立した子どもがいればログに残す */
export function logIndependence(state: GameState, data: GameData = defaultData): void {
  childrenOf(state).forEach((child, order) => {
    const age = independentAge(child, data);
    if (childAgeMonths(state, child) !== age * 12) return;
    const how = child.university ? '大学を卒業して' : '高校を卒業して就職し';
    addLog(state, 'event', `子どもの独立: ${order + 1}人目の子どもが${how}、独立した`, 'child_independent');
  });
}

/** 幸福度とストレスへの影響 */
export function childEffects(state: GameState, data: GameData = defaultData): { relations: number; freeTime: number; stress: number } {
  const h = data.balance.children.happiness;
  const kids = childrenOf(state);
  const ages = kids.map((c) => childAgeMonths(state, c) / 12);
  return {
    relations: Math.min(h.relationsMax, h.relationsPerChild * kids.length),
    freeTime: h.freeTimePerYoung * ages.filter((a) => a < h.youngUntil).length,
    stress: h.stressPerBaby * ages.filter((a) => a < h.babyUntil).length,
  };
}
