import { describe, expect, it } from 'vitest';
import { defaultData } from '../src/data/index';
import { applyChoice, applyEffects, eventProb, isEligible } from '../src/engine/events';
import { calcIncome, spouseMonthlyNet } from '../src/engine/money';
import { createRng } from '../src/engine/rng';
import type { EventDef, GameState } from '../src/engine/types';
import { flatRng, makeState, setAge } from './helpers';

const byId = (id: string): EventDef => defaultData.events.find((e) => e.id === id)!;

function marry(seed: number, age = 30): GameState {
  const s = setAge(makeState(), age);
  s.month = 100;
  s.flags.partner = true;
  applyEffects(s, { setFlags: { married: true } }, createRng(seed));
  return s;
}

describe('結婚記念日', () => {
  it('結婚した月を覚え、節目の年(1・5・10…周年)のその月にだけ起きる', () => {
    const s = marry(1);
    expect(s.flags.marriedSince).toBe(100);
    const ev = byId('anniversary');
    for (const [month, ok] of [[100, false], [106, false], [112, true], [113, false], [124, false], [160, true], [220, true], [232, false]] as const) {
      s.month = month;
      expect(isEligible(ev, s)).toBe(ok);
    }
  });
});

describe('配偶者の収入はガチャ', () => {
  it('結婚したときに配偶者の職業・学歴・稼ぎの個人差を引く。人によって手取りが違う', () => {
    const nets = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = marry(seed);
      const p = s.character.spouseProfile!;
      expect(p).toBeDefined();
      const sp = defaultData.balance.spouse;
      expect(p.payMul).toBeGreaterThanOrEqual(sp.payMulMin);
      expect(p.payMul).toBeLessThanOrEqual(sp.payMulMax);
      if (s.character.spouse === 'fulltime') {
        expect(p.job).not.toBe('parttime');
        nets.add(spouseMonthlyNet(s));
      }
      if (s.character.spouse === 'parttime') expect(spouseMonthlyNet(s)).toBeLessThanOrEqual(sp.parttimeMax);
      if (s.character.spouse === 'homemaker') expect(spouseMonthlyNet(s)).toBe(0);
    }
    expect(nets.size).toBeGreaterThan(3);
  });

  it('共働きの配偶者の手取りは、年齢とともに給料カーブで上がる', () => {
    const s = marry(3);
    s.character.spouse = 'fulltime';
    s.character.spouseProfile = { job: 'engineer', education: 'university', payMul: 1 };
    const young = spouseMonthlyNet(s);
    setAge(s, 45);
    expect(spouseMonthlyNet(s)).toBeGreaterThan(young * 1.3);
    expect(calcIncome(s).spouse).toBe(spouseMonthlyNet(s));
  });

  it('配偶者の引きがない古いセーブは、これまでどおり基準額(共働き18万円)', () => {
    const s = setAge(makeState(), 30);
    s.character.married = true;
    s.character.spouse = 'fulltime';
    expect(spouseMonthlyNet(s)).toBe(180_000);
  });

  it('離婚すると配偶者の引きも消える', () => {
    const s = marry(5);
    applyEffects(s, { setFlags: { married: false } }, flatRng);
    expect(s.character.spouseProfile).toBeUndefined();
  });
});

describe('資格・車・大きな出費', () => {
  it('資格に合格すると、資格手当で給料が3%上がる', () => {
    const pass = byId('certification').choices![0]!.outcomes!.find((o) => o.text.startsWith('合格'))!;
    expect(pass.effects.mulFlags).toEqual({ payMul: 1.03 });
    const s = setAge(makeState({ initialCash: 1_000_000 }), 30);
    applyChoice(s, byId('certification'), 0, flatRng); // flatRng は最初の結果(合格)
    expect(s.flags.payMul).toBeCloseTo(1.03);
  });

  it('車がなく子どもがいると、車を買う話が起きやすい(×3)', () => {
    const s = setAge(makeState({ region: 'metro' }), 35);
    const before = eventProb(byId('car_purchase'), s);
    s.character.children = [{ birthMonth: s.month - 24, university: false }];
    expect(eventProb(byId('car_purchase'), s)).toBeCloseTo(before * 3);
  });

  it('預金だけで足りない出費は、その場で投資を取り崩して払う(預金がマイナスのまま残らない)', () => {
    const s = makeState({ initialCash: 1_000_000 });
    s.assets.index = 3_000_000;
    s.invested!.index = 3_000_000;
    applyEffects(s, { cash: -2_000_000 }, flatRng);
    expect(s.assets.cash).toBe(0);
    expect(s.assets.index).toBe(2_000_000);
    expect(s.assets.loan ?? 0).toBe(0);
    expect(s.log.at(-1)).toMatchObject({ id: 'forced_sale' });
  });
});
