import { describe, expect, it } from 'vitest';
import { defaultData } from '../src/data/index';
import { applyChoice, applyEffects, eventProb, fireEvent } from '../src/engine/events';
import { applyMonthlyMoney, bonusGross, calcIncome } from '../src/engine/money';
import { createRng } from '../src/engine/rng';
import { stepMonth } from '../src/engine/step';
import type { EventDef, GameState } from '../src/engine/types';
import { flatRng, makeState, setAge } from './helpers';

const byId = (id: string): EventDef => defaultData.events.find((e) => e.id === id)!;

describe('ボーナス', () => {
  it('会社員は6月と12月に、年間のボーナス(月給4ヶ月分)を半分ずつ受け取る', () => {
    const s = makeState({ job: 'engineer' });
    const months: number[] = [];
    for (let m = 0; m < 12; m++) {
      s.month = m;
      if (bonusGross(s) > 0) months.push(m);
    }
    expect(months).toEqual([2, 8]); // 4月始まりの2ヶ月後=6月、8ヶ月後=12月
    s.month = 2;
    expect(bonusGross(s)).toBe(Math.round(3_220_000 / 16) * 2);
  });

  it('1年の給料+ボーナス(額面)は年収と同じ', () => {
    const s = makeState({ job: 'sales' });
    let total = 0;
    for (let m = 0; m < 12; m++) {
      s.month = m;
      total += Math.round(3_300_000 * 0.92 / 16) + bonusGross(s);
    }
    expect(Math.abs(total - Math.round(3_300_000 * 0.92))).toBeLessThan(20);
  });

  it('バイトにはボーナスがなく、ボーナスカットも起きない', () => {
    const s = makeState({ job: 'parttime' });
    s.month = 2;
    expect(calcIncome(s).bonus).toBe(0);
    expect(byId('bonus_cut').conditions.jobNotIn).toContain('parttime');
  });
});

describe('左遷の転勤', () => {
  it('左遷されると住む場所が一段下がる(大都市→地方都市→田舎)', () => {
    const s = makeState({ region: 'metro' });
    applyEffects(s, { relocate: 'down' }, flatRng);
    expect(s.character.region).toBe('city');
    applyEffects(s, { relocate: 'down' }, flatRng);
    expect(s.character.region).toBe('rural');
    applyEffects(s, { relocate: 'down' }, flatRng);
    expect(s.character.region).toBe('rural');
    const demotion = byId('boss_trouble').choices![1]!.outcomes!.find((o) => o.text.includes('左遷'))!;
    expect(demotion.effects.relocate).toBe('down');
  });
});

describe('恋愛', () => {
  it('恋人と別れることがあり、50歳を過ぎると別れやすい', () => {
    const s = setAge(makeState({ luck: 50 }), 30);
    s.flags.partner = true;
    const young = eventProb(byId('breakup'), s);
    expect(young).toBeGreaterThan(0);
    setAge(s, 55);
    expect(eventProb(byId('breakup'), s)).toBeCloseTo(young * 3);
    fireEvent(s, byId('breakup'), flatRng);
    expect(s.flags.partner).toBe(false);
  });

  it('プロポーズで「まだ早い」を選ぶと、恋人が去ることもある', () => {
    const results = new Set<boolean>();
    const rng = createRng(4);
    for (let i = 0; i < 100; i++) {
      const s = makeState();
      s.flags.partner = true;
      const idx = byId('proposal').choices!.findIndex((c) => c.label === 'まだ早い');
      applyChoice(s, byId('proposal'), idx, rng);
      results.add(s.flags.partner === true);
    }
    expect(results).toEqual(new Set([true, false]));
  });
});

describe('宝くじ', () => {
  it('期待値は買った額の半分以下(実際の還元率は約46%)', () => {
    const buy = byId('lottery').choices![0]!;
    const expected = buy.outcomes!.reduce((s, o) => s + o.prob * (o.effects.cash ?? 0), 0);
    expect(expected / -buy.effects!.cash!).toBeLessThan(0.5);
    expect(expected / -buy.effects!.cash!).toBeGreaterThan(0.3);
  });
});

describe('年間の収支に運用損益と生活保護', () => {
  function advance(s: GameState, n: number): GameState {
    for (let i = 0; i < n; i++) {
      s = stepMonth(s, createRng(s.rngState));
      delete s.pendingEvent;
    }
    return s;
  }

  it('運用損益を記録する(収支がマイナスでも資産が増える理由が見える)', () => {
    const s = makeState();
    s.assets.index = 10_000_000;
    const r = applyMonthlyMoney(s, createRng(1));
    expect(r.returns).not.toBe(0);
    const t = advance(makeState(), 12);
    expect(t.lastLedger!.returns).toBeDefined();
  });

  it('生活保護で補った額を記録する', () => {
    const s = makeState();
    s.character.job = 'none';
    s.flags.hasCar = true;
    const r = applyMonthlyMoney(s, flatRng);
    expect(r.welfare).toBeGreaterThan(0);
  });
});
