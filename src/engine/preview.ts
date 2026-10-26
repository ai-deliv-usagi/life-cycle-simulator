// この人生の見通し: 同じ生まれと方針で人生を何回か自動プレイして、傾向をまとめる(キャラ作成の最後に出す)。
// 本番の人生とは乱数の流れを分ける(deriveSeed の名前を変える)ので、本番のネタバレにはならない。
import { defaultData } from '../data/index';
import { selectableChoices } from './events';
import { computeResult } from './result';
import { createRng, deriveSeed } from './rng';
import { createGame } from './setup';
import { resolveChoice, stepMonth } from './step';
import type { CharacterRoll, GameData, LifeType, PolicyInput, Values } from './types';

export interface PreviewLife {
  deathAge: number;
  netWorthAt65?: number; // 65歳の年末の純資産(65歳まで生きなければなし)
  lifeType: LifeType;
  married: boolean; // 一度でも結婚したか
  children: number;
  eventIds: string[]; // 起きた出来事(重複なし)
}

/**
 * 見通し用に1人生を自動プレイする。index ごとに乱数の流れを変える。
 * 選択肢は選べるものから乱数で選ぶ(プレイヤーがどう選ぶかはわからないので)
 */
export function previewLife(
  roll: CharacterRoll,
  values: Values,
  policy: PolicyInput,
  index: number,
  data: GameData = defaultData,
): PreviewLife {
  const player = createRng(deriveSeed(roll.seed, `preview-player-${index}`));
  let state = createGame(roll, values, policy, '見通し', data);
  state.rngState = deriveSeed(roll.seed, `preview-${index}`);
  let married = false;
  while (!state.dead) {
    state = stepMonth(state, createRng(state.rngState), data);
    married ||= state.character.married;
    if (state.pendingEvent) {
      const ev = data.events.find((e) => e.id === state.pendingEvent!.eventId)!;
      const choice = player.pick(selectableChoices(ev, state, data));
      state = resolveChoice(state, choice.index, createRng(state.rngState), data);
    }
  }
  const at65 = state.log.find((e) => e.type === 'year_summary' && e.ageMonths >= 65 * 12);
  const ids = new Set(state.log.filter((e) => e.type === 'event' && e.id).map((e) => e.id!));
  return {
    deathAge: Math.floor(state.ageMonths / 12),
    ...(at65 ? { netWorthAt65: at65.snapshot.netWorth } : {}),
    lifeType: computeResult(state, data).lifeType,
    married: married || state.character.married,
    children: state.character.children?.length ?? 0,
    eventIds: [...ids],
  };
}

export interface PreviewSummary {
  lives: number;
  deathAge: { mean: number; low: number; high: number }; // low/high は下位・上位10%
  netWorthAt65?: { low: number; median: number; high: number }; // 下位・上位25%
  lifeTypes: { type: LifeType; share: number }[]; // 多い順
  married: number; // 結婚する人生の割合
  children: number; // 子どもの数の平均
  events: { id: string; share: number }[]; // その出来事が起きた人生の割合(多い順)
}

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!;
}

export function summarizePreview(lives: PreviewLife[]): PreviewSummary {
  const ages = lives.map((l) => l.deathAge).sort((a, b) => a - b);
  const worth = lives.flatMap((l) => (l.netWorthAt65 === undefined ? [] : [l.netWorthAt65])).sort((a, b) => a - b);
  const count = <K extends string>(keys: K[]) => {
    const m = new Map<K, number>();
    for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].map(([k, n]) => ({ k, share: n / lives.length })).sort((a, b) => b.share - a.share);
  };
  return {
    lives: lives.length,
    deathAge: { mean: ages.reduce((s, a) => s + a, 0) / ages.length, low: quantile(ages, 0.1), high: quantile(ages, 0.9) },
    ...(worth.length > 0 ? { netWorthAt65: { low: quantile(worth, 0.25), median: quantile(worth, 0.5), high: quantile(worth, 0.75) } } : {}),
    lifeTypes: count(lives.map((l) => l.lifeType)).map(({ k, share }) => ({ type: k, share })),
    married: lives.filter((l) => l.married).length / lives.length,
    children: lives.reduce((s, l) => s + l.children, 0) / lives.length,
    events: count(lives.flatMap((l) => l.eventIds)).map(({ k, share }) => ({ id: k, share })),
  };
}
