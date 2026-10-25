// engine の公開API(DESIGN.md §2)。UI と scripts/balance.ts はここからだけ import する。
// 各ステップで実装したものから足していく。
export { createRng, type Rng } from './rng';
export { createGame, rollCharacter } from './setup';
export type * from './types';
