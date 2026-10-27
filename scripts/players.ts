// バランス確認の自動プレイヤー(DESIGN.md §33)
//   typed: 「あなたのタイプ」(価値観)とそれに合う方針のプリセットで一生を通し、選択肢は価値観とお金で選ぶ
//   random: 価値観・方針・選択肢をでたらめに選ぶ(方針は10年ごとに引き直す)。全イベントが起きるかの確認用
import { defaultData } from '../src/data/index';
import {
  choiceCost,
  getMonthlyView,
  selectableChoices,
  type EventDef,
  type GameState,
  type Policy,
  type Rng,
  type Values,
} from '../src/engine/index';
import { POLICY_PRESETS, VALUE_PRESETS } from '../src/ui/presets';

export interface Player {
  id: string;
  label: string;
  values(rng: Rng): Values;
  /** month は経過月。最初(0)と、方針を見直すとき(120ヶ月ごと)に呼ぶ。同じ方針を返せばそのまま */
  policy(rng: Rng, month: number, current?: Policy): Policy;
  choose(state: GameState, ev: EventDef, rng: Rng): number;
}

// ---- タイプ別 ----

/** 価値観1段あたりの重み、金額の重み、迷い(乱数)の大きさ */
const VALUE_WEIGHT = 0.3;
const COST_WEIGHT = 0.25;
const COST_SPENDING_SLOPE = 0.1; // 「使う派」ほど金額を気にしない
const NOISE = 0.7;

/** 結婚・出産・子どもを考える・大病の治療などの選択は、金額では避けない(人生の節目や命はお金だけで決めない) */
function isLifeChoice(effects: EventDef['effects']): boolean {
  const flags = effects?.setFlags ?? {};
  return ['married', 'trying', 'parentalLeave', 'spouseLeave', 'postpartum', 'illnessTreated'].some((k) => k in flags);
}

/** 価値観に合う選択(valueShift の向き)を好み、収入に比べて高い出費を避ける。少しだけ乱数で迷う */
export function typedChoice(state: GameState, ev: EventDef, rng: Rng): number {
  const options = selectableChoices(ev, state);
  const income = Math.max(100_000, getMonthlyView(state).householdNet);
  let best = options[0]!;
  let bestScore = -Infinity;
  for (const o of options) {
    let score = 0;
    for (const [axis, shift] of Object.entries(o.choice.valueShift ?? {}) as [keyof Values, number][]) {
      score += Math.sign(shift) * state.values[axis] * VALUE_WEIGHT;
    }
    if (!isLifeChoice(o.choice.effects)) {
      const c = choiceCost(ev, o.choice, state);
      score -= ((c.spend + c.borrow * 1.5) / income) * Math.max(0.05, COST_WEIGHT - COST_SPENDING_SLOPE * state.values.spending);
    }
    score += rng.normal(0, NOISE);
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best.index;
}

function typedPlayer(id: string, label: string, values: Values, policyId: string): Player {
  const preset = POLICY_PRESETS.find((p) => p.id === policyId)!;
  return {
    id,
    label,
    values: () => ({ ...values }),
    policy: (_rng, _month, current) => current ?? { ...preset.policy, invest: { ...preset.policy.invest }, prepay: false, education: 'public', investMonthly: 0 },
    choose: typedChoice,
  };
}

export const TYPED_PLAYERS: Player[] = VALUE_PRESETS.map((t) => typedPlayer(t.id, t.label, t.values, t.policy));

/** 出世派の価値観で「モーレツ」(激務・健康は気にしない)を一生続ける。激務の寿命の目安を見る */
export const HUSTLE_PLAYER: Player = typedPlayer('hustle', 'モーレツ', VALUE_PRESETS.find((t) => t.id === 'climber')!.values, 'hustle');

// ---- でたらめ ----

const WORKS = ['regular', 'normal', 'overtime', 'grind'] as const;
const SPENDINGS = ['frugal', 'normal', 'comfort', 'lavish'] as const;
const ALLOCATIONS = [
  { deposit: 100, index: 0, stocks: 0, speculative: 0 },
  { deposit: 0, index: 100, stocks: 0, speculative: 0 },
  { deposit: 0, index: 0, stocks: 100, speculative: 0 },
  { deposit: 0, index: 0, stocks: 0, speculative: 100 },
  { deposit: 30, index: 70, stocks: 0, speculative: 0 },
  { deposit: 20, index: 50, stocks: 30, speculative: 0 },
  { deposit: 0, index: 20, stocks: 50, speculative: 30 },
] as const;
const CARES = ['ignore', 'normal', 'active'] as const;

export function randomPolicy(rng: Rng, work?: Policy['work']): Policy {
  return {
    work: work ?? rng.pick(WORKS),
    spending: rng.pick(SPENDINGS),
    invest: { ...rng.pick(ALLOCATIONS) },
    prepay: rng.chance(0.3),
    health: rng.pick(CARES),
    education: rng.chance(0.25) ? 'private' : 'public',
    investMonthly: 0,
  };
}

export const RANDOM_PLAYER: Player = {
  id: 'random',
  label: 'でたらめ',
  values: (rng) => {
    const v = () => Math.round((rng.next() * 4 - 2) * 2) / 2; // -2〜+2 の0.5刻み
    return { risk: v(), relation: v(), spending: v(), work: v() };
  },
  policy: (rng, month, current) => (current && month % 120 !== 0 ? current : randomPolicy(rng)),
  choose: (state, ev, rng) => rng.pick(selectableChoices(ev, state)).index,
};

/** 激務を続ける(でたらめな方針の働き方だけ激務に固定) */
export const GRIND_PLAYER: Player = {
  ...RANDOM_PLAYER,
  id: 'grind',
  label: '激務',
  policy: (rng, month, current) => (current && month % 120 !== 0 ? current : randomPolicy(rng, 'grind')),
};

export const SYSTEM_EVENTS = new Set(defaultData.events.filter((e) => e.category === 'system').map((e) => e.id));
