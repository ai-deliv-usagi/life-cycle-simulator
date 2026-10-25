// セーブと過去の人生(DESIGN.md §10)。localStorage を使うのは UI 層だけ
import { computeResult, normalizePolicy, type DeathCause, type Education, type FamilyTier, type GameState, type JobId, type LifeType } from '../engine/index';

export const SAVE_KEY = 'lifesim.save.v1';
export const HISTORY_KEY = 'lifesim.history.v1';
const SAVE_VERSION = 1;
const HISTORY_LIMIT = 50;

export interface LifeRecord {
  seed: number;
  name: string;
  endedAt: string;
  education: Education;
  job: JobId;
  familyTier: FamilyTier;
  ageAtDeath: number;
  cause: DeathCause;
  finalNetWorth: number;
  lifetimeHappiness: number;
  lifeType: LifeType;
}

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** localStorage が使えない環境(プライベートモードなど)でも落ちないようにする */
function defaultStorage(): KV | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(store: KV | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(store: KV | null, key: string, value: string | null): boolean {
  try {
    if (!store) return false;
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** 最低限の形の確認(壊れたセーブで落ちないように) */
function looksLikeState(x: unknown): x is GameState {
  if (typeof x !== 'object' || x === null) return false;
  const s = x as Partial<GameState>;
  return (
    typeof s.seed === 'number' &&
    typeof s.rngState === 'number' &&
    typeof s.month === 'number' &&
    typeof s.ageMonths === 'number' &&
    typeof s.character === 'object' &&
    typeof s.assets === 'object' &&
    typeof s.stats === 'object' &&
    typeof s.policy === 'object' &&
    Array.isArray(s.log) &&
    Array.isArray(s.happinessHistory) &&
    !s.dead
  );
}

export function saveGame(state: GameState, store: KV | null = defaultStorage()): boolean {
  return write(store, SAVE_KEY, JSON.stringify({ version: SAVE_VERSION, savedAt: new Date().toISOString(), state }));
}

export type LoadResult = { status: 'none' } | { status: 'ok'; state: GameState; savedAt: string } | { status: 'broken' };

export function loadGame(store: KV | null = defaultStorage()): LoadResult {
  const raw = read(store, SAVE_KEY);
  if (raw === null) return { status: 'none' };
  try {
    const data = JSON.parse(raw) as { version?: unknown; savedAt?: unknown; state?: unknown };
    if (data.version !== SAVE_VERSION || !looksLikeState(data.state)) return { status: 'broken' };
    // 古いセーブの方針(投資を1つだけ選ぶ形)を配分に直す
    const state = { ...data.state, policy: normalizePolicy(data.state.policy) };
    return { status: 'ok', state, savedAt: typeof data.savedAt === 'string' ? data.savedAt : '' };
  } catch {
    return { status: 'broken' };
  }
}

export function clearSave(store: KV | null = defaultStorage()): void {
  write(store, SAVE_KEY, null);
}

export function loadHistory(store: KV | null = defaultStorage()): LifeRecord[] {
  try {
    const parsed = JSON.parse(read(store, HISTORY_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? (parsed as LifeRecord[]) : [];
  } catch {
    return [];
  }
}

export function toLifeRecord(state: GameState, endedAt = new Date().toISOString()): LifeRecord {
  const r = computeResult(state);
  const c = state.character;
  return {
    seed: state.seed,
    name: c.name,
    endedAt,
    education: c.education,
    job: c.job,
    familyTier: c.familyTier,
    ageAtDeath: r.ageAtDeath,
    cause: r.cause,
    finalNetWorth: r.finalNetWorth,
    lifetimeHappiness: r.lifetimeHappiness,
    lifeType: r.lifeType,
  };
}

/** リザルト到達: セーブを消し、過去の人生の先頭に足す */
export function finishLife(state: GameState, store: KV | null = defaultStorage()): LifeRecord {
  const record = toLifeRecord(state);
  clearSave(store);
  const history = [record, ...loadHistory(store)].slice(0, HISTORY_LIMIT);
  write(store, HISTORY_KEY, JSON.stringify(history));
  return record;
}
