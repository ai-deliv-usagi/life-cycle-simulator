import { describe, expect, it } from 'vitest';
import { defaultData } from '../src/data/index';
import { applyChoice, choiceCost, costSpread, fireEvent, spreadRange } from '../src/engine/events';
import { createRng } from '../src/engine/rng';
import type { EventDef } from '../src/engine/types';
import { flatRng, makeState, setAge } from './helpers';

const byId = (id: string): EventDef => defaultData.events.find((e) => e.id === id)!;

describe('イベントの金額の揺れ', () => {
  it('種類ごとの揺れ方。本文やラベルに金額が書いてあれば揺らさない', () => {
    expect(costSpread(byId('hospital'))).toBe('large');
    expect(costSpread(byId('travel'))).toBe('medium');
    expect(costSpread(byId('reunion'))).toBe('small');
    expect(costSpread(byId('lottery'))).toBe('none');
    expect(costSpread(byId('friend_loan'))).toBe('none'); // 「50万円貸してほしい」
    expect(costSpread(byId('child_wedding'), defaultData, '結婚資金を援助する(100万円)')).toBe('none');
  });

  it('入院の費用は0.5〜3倍で揺れ、平均はおよそ元の額(30万円)', () => {
    const costs: number[] = [];
    for (let i = 0; i < 400; i++) {
      const s = setAge(makeState({ initialCash: 10_000_000 }), 40);
      fireEvent(s, byId('hospital'), createRng(i + 1));
      costs.push(10_000_000 - s.assets.cash);
    }
    expect(Math.min(...costs)).toBeGreaterThanOrEqual(150_000);
    expect(Math.max(...costs)).toBeLessThanOrEqual(900_000);
    expect(new Set(costs).size).toBeGreaterThan(50);
    const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
    expect(mean).toBeGreaterThan(270_000);
    expect(mean).toBeLessThan(330_000);
    expect(costs.every((c) => c % 1000 === 0)).toBe(true); // 千円単位
  });

  it('揺れないイベント(宝くじの賞金など)と、揺れなしの乱数ではそのまま', () => {
    const s = setAge(makeState({ initialCash: 1_000_000 }), 30);
    applyChoice(s, byId('travel'), 0, flatRng);
    expect(s.assets.cash).toBe(600_000);
  });

  it('選択肢の目安には80%の場合に収まる幅が付く', () => {
    const s = setAge(makeState(), 30);
    const cost = choiceCost(byId('travel'), byId('travel').choices![0]!, s);
    expect(cost.range).toEqual(spreadRange(byId('travel')));
    const [lo, hi] = cost.range!;
    expect(lo).toBeGreaterThanOrEqual(0.7);
    expect(lo).toBeLessThan(0.8);
    expect(hi).toBeGreaterThan(1.25);
    expect(hi).toBeLessThanOrEqual(1.5);
    expect(choiceCost(byId('lottery'), byId('lottery').choices![0]!, s).range).toBeUndefined();
  });
});
