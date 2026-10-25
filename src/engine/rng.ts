// シード付き乱数。ゲーム内の乱数はすべてここを通す(Math.random は使わない)。
// mulberry32 の内部状態は 32bit 整数1つなので、GameState.rngState に保存して再開できる。

export interface Rng {
  /** [0, 1) の一様乱数 */
  next(): number;
  /** 正規分布(Box-Muller。状態を1つに保つため余りはキャッシュしない) */
  normal(mean: number, sd: number): number;
  /** 0 以上 maxExclusive 未満の整数 */
  int(maxExclusive: number): number;
  /** 確率 p で true */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly { item: T; weight: number }[]): T;
  /** 現在の内部状態(保存用) */
  readonly state: number;
}

class Mulberry32 implements Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  get state(): number {
    return this.s;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  normal(mean: number, sd: number): number {
    const u1 = 1 - this.next(); // (0, 1] にして log(0) を避ける
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + sd * z;
  }

  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RangeError(`int: maxExclusive must be a positive integer, got ${maxExclusive}`);
    }
    return Math.floor(this.next() * maxExclusive);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('pick: empty array');
    return items[this.int(items.length)] as T;
  }

  weighted<T>(items: readonly { item: T; weight: number }[]): T {
    let total = 0;
    for (const { weight } of items) {
      if (weight < 0 || !Number.isFinite(weight)) throw new RangeError(`weighted: invalid weight ${weight}`);
      total += weight;
    }
    if (total <= 0) throw new RangeError('weighted: total weight must be positive');
    let r = this.next() * total;
    for (const { item, weight } of items) {
      if (r < weight) return item;
      r -= weight;
    }
    // 浮動小数点の誤差で抜けたときは、重みが正の最後の要素
    for (let i = items.length - 1; i >= 0; i--) {
      const entry = items[i] as { item: T; weight: number };
      if (entry.weight > 0) return entry.item;
    }
    throw new Error('unreachable');
  }
}

export function createRng(seed: number): Rng {
  return new Mulberry32(seed);
}

/**
 * seed とラベルから別の乱数列のシードを作る(ガチャ用と人生用で乱数列を分けるため)。
 * FNV-1a でラベルを混ぜ、murmur3 の fmix32 で拡散する。
 */
export function deriveSeed(seed: number, label: string): number {
  let h = (0x811c9dc5 ^ (seed >>> 0)) >>> 0;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
