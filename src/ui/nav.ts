// 画面遷移(DESIGN.md §9.1)。各画面は Nav を受け取り、ほかの画面を直接 import しない
import type { GameState } from '../engine/index';

export interface Nav {
  title(): void;
  setup(seed: number): void;
  main(state: GameState): void;
  result(state: GameState): void;
}

/** 新しい人生のシード。再現用の値なので乱数の質は問わない(engine の乱数とは無関係) */
export function freshSeed(): number {
  return (Date.now() * 7919 + Math.floor(performance.now() * 1000)) % 1_000_000_000;
}
