import { describe, expect, it } from 'vitest';
import { createRng, deriveSeed } from '../src/engine/rng';

function take(seed: number, n: number): number[] {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng.next());
}

describe('createRng', () => {
  it('同じシードなら同じ列を返す', () => {
    expect(take(42, 100)).toEqual(take(42, 100));
  });

  it('違うシードなら違う列を返す', () => {
    expect(take(1, 10)).not.toEqual(take(2, 10));
  });

  it('next は [0, 1) に収まる', () => {
    for (const x of take(7, 10_000)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('state から作り直すと続きの列が出る(セーブからの再開)', () => {
    const a = createRng(123);
    for (let i = 0; i < 50; i++) a.next();
    const saved = JSON.parse(JSON.stringify({ s: a.state })) as { s: number };
    const b = createRng(saved.s);
    const restA = Array.from({ length: 20 }, () => a.normal(0, 1));
    const restB = Array.from({ length: 20 }, () => b.normal(0, 1));
    expect(restB).toEqual(restA);
  });

  it('state は32bit符号なし整数', () => {
    const rng = createRng(-1);
    for (let i = 0; i < 100; i++) {
      rng.next();
      expect(Number.isInteger(rng.state)).toBe(true);
      expect(rng.state).toBeGreaterThanOrEqual(0);
      expect(rng.state).toBeLessThan(2 ** 32);
    }
  });

  it('normal の平均と標準偏差がおおむね正しい', () => {
    const rng = createRng(99);
    const n = 50_000;
    const xs = Array.from({ length: n }, () => rng.normal(5, 2));
    const mean = xs.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    expect(mean).toBeCloseTo(5, 1);
    expect(sd).toBeCloseTo(2, 1);
  });

  it('int は範囲内で一様に近い', () => {
    const rng = createRng(5);
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < 50_000; i++) counts[rng.int(5)]!++;
    for (const c of counts) expect(c / 50_000).toBeCloseTo(0.2, 1);
    expect(() => rng.int(0)).toThrow(RangeError);
    expect(() => rng.int(1.5)).toThrow(RangeError);
  });

  it('chance は確率どおりに true になる', () => {
    const rng = createRng(11);
    let hits = 0;
    for (let i = 0; i < 50_000; i++) if (rng.chance(0.3)) hits++;
    expect(hits / 50_000).toBeCloseTo(0.3, 1);
    expect(createRng(1).chance(0)).toBe(false);
    expect(createRng(1).chance(1)).toBe(true);
  });

  it('pick は配列の要素を返し、空配列はエラー', () => {
    const rng = createRng(3);
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 100; i++) expect(items).toContain(rng.pick(items));
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('weighted は重みに比例し、重み0は選ばれない', () => {
    const rng = createRng(8);
    const counts: Record<string, number> = { a: 0, b: 0, z: 0 };
    const items = [
      { item: 'a', weight: 1 },
      { item: 'z', weight: 0 },
      { item: 'b', weight: 3 },
    ];
    for (let i = 0; i < 40_000; i++) counts[rng.weighted(items)]!++;
    expect(counts.z).toBe(0);
    expect(counts.a! / 40_000).toBeCloseTo(0.25, 1);
    expect(counts.b! / 40_000).toBeCloseTo(0.75, 1);
    expect(() => rng.weighted([{ item: 'a', weight: 0 }])).toThrow(RangeError);
    expect(() => rng.weighted([{ item: 'a', weight: -1 }])).toThrow(RangeError);
  });
});

describe('deriveSeed', () => {
  it('同じ入力なら同じ値', () => {
    expect(deriveSeed(42, 'life')).toBe(deriveSeed(42, 'life'));
  });

  it('ラベルやシードが違えば違う値', () => {
    expect(deriveSeed(42, 'life')).not.toBe(deriveSeed(42, 'gacha'));
    expect(deriveSeed(42, 'life')).not.toBe(deriveSeed(43, 'life'));
  });

  it('32bit符号なし整数を返す', () => {
    for (const seed of [0, 1, -1, 2 ** 31, 2 ** 32 - 1]) {
      const v = deriveSeed(seed, 'life');
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 32);
    }
  });
});
