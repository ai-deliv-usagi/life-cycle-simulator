// 死亡判定(SPEC.md「死亡判定」)
import { defaultData } from '../data/index';
import type { Rng } from './rng';
import { effectiveWork } from './stats';
import type { DeathCause, GameData, GameState } from './types';
import { ageYears } from './util';

/** 年間の基本死亡率 q(年齢) = min(1, a·e^{b(年齢 − offset)}) */
export function baseAnnualMortality(age: number, data: GameData = defaultData): number {
  const d = data.balance.death;
  return Math.min(1, d.a * Math.exp(d.b * (age - d.ageOffset)));
}

/** 健康補正: 健康100で0.25倍、50で1倍、0で4倍 */
export function healthFactor(health: number, data: GameData = defaultData): number {
  const d = data.balance.death;
  return 2 ** ((d.healthPivot - health) / d.healthScale);
}

/** 行動補正: 働き方(残業多め1.15・激務1.5)× ストレス70以上で1.2 */
export function behaviorFactor(state: GameState, data: GameData = defaultData): number {
  const { balance } = data;
  const work = effectiveWork(state);
  const workMul = work ? balance.work[work].death : 1;
  const stressMul = state.stats.stress >= balance.stats.highStress ? balance.death.highStressMul : 1;
  return workMul * stressMul;
}

export function monthlyDeathProb(state: GameState, data: GameData = defaultData): number {
  const age = ageYears(state);
  if (age >= data.balance.death.maxAge) return 1;
  const p =
    (baseAnnualMortality(age, data) / 12) * healthFactor(state.stats.health, data) * behaviorFactor(state, data);
  return Math.min(1, p);
}

export function causeWeights(state: GameState, data: GameData = defaultData): Record<DeathCause, number> {
  const c = data.balance.death.cause;
  const age = ageYears(state);
  const work = effectiveWork(state);
  return {
    illness: (age * (100 - state.stats.health)) / 50,
    overwork: work === 'grind' ? c.overworkGrind : work === 'overtime' ? c.overworkOvertime : 0,
    accident: c.accidentBase * (1.5 - state.character.luck / 100),
    old_age: age >= c.oldAgeFrom ? (age - c.oldAgeOffset) * c.oldAgeMul : 0,
  };
}

export function pickCause(state: GameState, rng: Rng, data: GameData = defaultData): DeathCause {
  if (ageYears(state) >= data.balance.death.maxAge) return 'old_age';
  const w = causeWeights(state, data);
  return rng.weighted((Object.keys(w) as DeathCause[]).map((cause) => ({ item: cause, weight: w[cause] })));
}

/** 今月死ぬかを判定し、死んだら死因を返す。生きていれば null */
export function rollDeath(state: GameState, rng: Rng, data: GameData = defaultData): DeathCause | null {
  if (!rng.chance(monthlyDeathProb(state, data))) return null;
  return pickCause(state, rng, data);
}
