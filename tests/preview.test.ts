import { describe, expect, it } from 'vitest';
import { previewLife, summarizePreview } from '../src/engine/preview';
import { createGame, rollCharacter } from '../src/engine/setup';
import type { PolicyInput } from '../src/engine/types';
import { neutralValues } from './helpers';

const policy: PolicyInput = { work: 'normal', spending: 'normal', invest: 'index', health: 'normal' };

describe('この人生の見通し', () => {
  it('同じ生まれ・方針・番号なら同じ結果。番号が違えば運の流れが変わる', () => {
    const roll = rollCharacter(21);
    const a = previewLife(roll, neutralValues, policy, 0);
    expect(previewLife(roll, neutralValues, policy, 0)).toEqual(a);
    const others = [1, 2, 3].map((i) => previewLife(roll, neutralValues, policy, i));
    expect(others.some((o) => o.deathAge !== a.deathAge || o.eventIds.length !== a.eventIds.length)).toBe(true);
  });

  it('本番の人生とは乱数の流れが違う', () => {
    const roll = rollCharacter(21);
    expect(createGame(roll, neutralValues, policy, 'x').rngState).not.toBe(0);
    // 見通しは deriveSeed(seed, 'preview-i')、本番は deriveSeed(seed, 'life')
    const a = previewLife(roll, neutralValues, policy, 0);
    expect(a.deathAge).toBeGreaterThan(22);
  });

  it('まとめ: 寿命の幅、65歳の純資産の幅、人生タイプと出来事の割合', () => {
    const lives = [
      { deathAge: 70, netWorthAt65: 1_000_000, lifeType: 'hardship' as const, married: true, children: 2, eventIds: ['layoff'] },
      { deathAge: 80, netWorthAt65: 5_000_000, lifeType: 'winner' as const, married: false, children: 0, eventIds: ['layoff', 'promotion'] },
      { deathAge: 60, lifeType: 'hardship' as const, married: true, children: 1, eventIds: [] },
    ];
    const s = summarizePreview(lives);
    expect(s.deathAge).toEqual({ mean: 70, low: 60, high: 80 });
    expect(s.netWorthAt65).toEqual({ low: 1_000_000, median: 5_000_000, high: 5_000_000 });
    expect(s.lifeTypes[0]).toEqual({ type: 'hardship', share: 2 / 3 });
    expect(s.married).toBeCloseTo(2 / 3);
    expect(s.children).toBe(1);
    expect(s.events[0]).toEqual({ id: 'layoff', share: 2 / 3 });
  });
});
