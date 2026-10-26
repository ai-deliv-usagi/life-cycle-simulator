// 子どもと育休(第2弾。DESIGN.md §15)
// stepMonth / applyEffects が複製した state を直接更新する。
import { defaultData } from '../data/index';
import type { Rng } from './rng';
import type { Child, GameData, GameState } from './types';
import { calcIncome, isEmployed } from './money';
import { addLog, clamp, clampStat, roundYen } from './util';

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
  const kids = dependents(state, data);
  if (kids.length === 0) return 0;
  const scale = childCostScale(state, data);
  const privateSchool = state.policy.education === 'private';
  let total = 0;
  for (const child of kids) {
    const age = childAgeMonths(state, child) / 12;
    const stage = stages.find((s) => age < s.until);
    if (!stage) continue;
    // 生活費と公立の学校・塾の費用は世帯の収入に合わせて増減する。私立の学費は選んだ学校の額のまま
    // (私立中心でも、公立と同じ額の段階(未就学・小学校)は公立に通う扱い)
    const education = stage.education[state.policy.education];
    const fixedFee = privateSchool && stage.education.private !== stage.education.public;
    total += stage.living * scale + (fixedFee ? education : education * scale);
  }
  return roundYen(total);
}

/**
 * 子どもの費用の倍率 = (世帯の毎月の手取り(ボーナス・児童手当を除く)÷ 基準額) ^ elasticity。min〜max に収める。
 * 表の金額は平均なので、収入が少ない家庭は少なめ、多い家庭は多めにかける(収入ほどには増やさない)
 */
export function childCostScale(state: GameState, data: GameData = defaultData): number {
  const c = data.balance.children.costScale;
  const inc = calcIncome(state, data);
  const household = inc.total - inc.bonus - inc.childAllowance;
  return clamp(Math.max(0, household / c.referenceIncome) ** c.elasticity, c.min, c.max);
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

/**
 * 女性本人が出産したあと: 体力が落ち、会社員なら産休(育休を取らない場合も、産後の数ヶ月は休む)。
 * 育休の効果(setFlags)を適用したあとに呼ぶ
 */
export function afterGivingBirth(state: GameState, data: GameData = defaultData): void {
  const p = data.balance.children.parentalLeave;
  state.stats.health = clampStat(state.stats.health + p.birthHealth);
  const onLeave = typeof state.flags.parentalLeave === 'number' && state.flags.parentalLeave > 0;
  if (isEmployed(state) && !onLeave) {
    state.flags.maternityLeave = p.maternityMonths;
    addLog(state, 'event', `産休: 出産のあと${p.maternityMonths}ヶ月は産休を取る`, 'maternity_leave');
  }
}
