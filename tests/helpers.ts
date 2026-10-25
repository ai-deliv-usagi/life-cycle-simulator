import type { Rng } from '../src/engine/rng';
import { createGame } from '../src/engine/setup';
import type { CharacterRoll, GameState, Policy, Values } from '../src/engine/types';

export const neutralValues: Values = { risk: 0, relation: 0, spending: 0, work: 0 };
export const defaultPolicy: Policy = { work: 'regular', spending: 'normal', invest: 'deposit', health: 'ignore' };

/** テスト用に条件を固定したキャラを作る */
export function makeState(roll: Partial<CharacterRoll> = {}, policy: Partial<Policy> = {}): GameState {
  const base: CharacterRoll = {
    seed: 1,
    education: 'university',
    job: 'engineer',
    familyTier: 3,
    region: 'city',
    hasCar: false,
    constitution: 50,
    luck: 50,
    initialCash: 0,
    studentLoan: null,
  };
  return createGame({ ...base, ...roll }, neutralValues, { ...defaultPolicy, ...policy }, 'テスト');
}

/** 運用リターン0・暴落なしの乱数(お金の計算を決定的に確かめる用) */
export const flatRng: Rng = {
  next: () => 0.5,
  normal: (mean: number) => mean * 0,
  int: () => 0,
  chance: () => false,
  pick: <T>(items: readonly T[]) => items[0] as T,
  weighted: <T>(items: readonly { item: T; weight: number }[]) => (items[0] as { item: T }).item,
  state: 0,
};

export function setAge(state: GameState, years: number): GameState {
  state.ageMonths = Math.round(years * 12);
  return state;
}
