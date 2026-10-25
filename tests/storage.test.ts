import { describe, expect, it } from 'vitest';
import { createGame, createRng, rollCharacter, stepMonth, type GameState } from '../src/engine/index';
import { clearSave, finishLife, HISTORY_KEY, loadGame, loadHistory, SAVE_KEY, saveGame } from '../src/ui/storage';
import { defaultPolicy, neutralValues } from './helpers';

function memoryStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    raw: m,
  };
}

function game(seed = 1): GameState {
  return createGame(rollCharacter(seed), neutralValues, defaultPolicy, 'テスト');
}

function dead(seed = 1): GameState {
  let s = game(seed);
  while (!s.dead) {
    s = stepMonth(s, createRng(s.rngState));
    if (s.pendingEvent) s = { ...s, pendingEvent: undefined };
  }
  return s;
}

describe('セーブ', () => {
  it('保存して読み込むと同じ state が戻る', () => {
    const store = memoryStore();
    let s = game();
    for (let i = 0; i < 30; i++) s = stepMonth(s, createRng(s.rngState));
    expect(saveGame(s, store)).toBe(true);
    const loaded = loadGame(store);
    expect(loaded.status).toBe('ok');
    if (loaded.status === 'ok') expect(loaded.state).toEqual(s);
  });

  it('セーブがなければ none、壊れていれば broken', () => {
    const store = memoryStore();
    expect(loadGame(store).status).toBe('none');
    store.setItem(SAVE_KEY, '{not json');
    expect(loadGame(store).status).toBe('broken');
    store.setItem(SAVE_KEY, JSON.stringify({ version: 999, state: game() }));
    expect(loadGame(store).status).toBe('broken');
    store.setItem(SAVE_KEY, JSON.stringify({ version: 1, state: { seed: 1 } }));
    expect(loadGame(store).status).toBe('broken');
  });

  it('古いセーブ(投資を1つ選ぶ形の方針)は配分に直して読み込む', () => {
    const store = memoryStore();
    const old = game() as unknown as { policy: Record<string, unknown> };
    old.policy = { work: 'normal', spending: 'normal', invest: 'stocks', health: 'normal' };
    store.setItem(SAVE_KEY, JSON.stringify({ version: 1, state: old }));
    const loaded = loadGame(store);
    expect(loaded.status).toBe('ok');
    if (loaded.status === 'ok') {
      expect(loaded.state.policy.invest).toEqual({ deposit: 0, index: 0, stocks: 100, speculative: 0 });
      expect(loaded.state.policy.prepay).toBe(false);
    }
  });

  it('localStorage が使えなくても落ちない', () => {
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(saveGame(game(), throwing)).toBe(false);
    expect(loadGame(throwing).status).toBe('none');
    expect(loadHistory(throwing)).toEqual([]);
    expect(() => clearSave(throwing)).not.toThrow();
    expect(saveGame(game(), null)).toBe(false);
  });
});

describe('過去の人生', () => {
  it('リザルト到達でセーブを消し、記録を新しい順に足す', () => {
    const store = memoryStore();
    saveGame(game(), store);
    const a = finishLife(dead(1), store);
    const b = finishLife(dead(2), store);
    expect(store.raw.has(SAVE_KEY)).toBe(false);
    const history = loadHistory(store);
    expect(history).toEqual([b, a]);
    expect(a).toMatchObject({ seed: 1, name: 'テスト' });
    expect(typeof a.ageAtDeath).toBe('number');
  });

  it('最大50件', () => {
    const store = memoryStore();
    const record = finishLife(dead(3), store);
    store.setItem(HISTORY_KEY, JSON.stringify(Array(60).fill(record)));
    finishLife(dead(4), store);
    expect(loadHistory(store)).toHaveLength(50);
  });
});
