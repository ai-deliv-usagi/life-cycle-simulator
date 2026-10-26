import { describe, expect, it } from 'vitest';
import { defaultData } from '../src/data/index';
import { baseAnnualMortality } from '../src/engine/death';
import { fireEvent, eventProb, isEligible } from '../src/engine/events';
import { pensionMonthly } from '../src/engine/money';
import type { EventDef } from '../src/engine/types';
import { flatRng, makeState, setAge } from './helpers';

const byId = (id: string): EventDef => defaultData.events.find((e) => e.id === id)!;

function married(age: number, spouse: 'fulltime' | 'parttime' | 'homemaker' = 'fulltime') {
  const s = setAge(makeState(), age);
  s.character.married = true;
  s.character.spouse = spouse;
  return s;
}

describe('離婚の年齢', () => {
  it('離婚の危機は50歳まで、熟年離婚は60〜69歳。70歳以上では離婚しない', () => {
    expect(isEligible(byId('divorce_crisis'), married(50))).toBe(true);
    expect(isEligible(byId('divorce_crisis'), married(51))).toBe(false);
    expect(isEligible(byId('jukunen_divorce'), married(65))).toBe(true);
    expect(isEligible(byId('jukunen_divorce'), married(70))).toBe(false);
    expect(isEligible(byId('jukunen_divorce'), married(88))).toBe(false);
  });
});

describe('配偶者との死別', () => {
  it('配偶者を本人と同い年として、基本死亡率で起きる(年を取るほど起きやすい)', () => {
    const ev = byId('spouse_death');
    expect(isEligible(ev, married(45))).toBe(false);
    expect(eventProb(ev, married(70))).toBeCloseTo(baseAnnualMortality(70) / 12);
    expect(eventProb(ev, married(85))).toBeGreaterThan(eventProb(ev, married(70)) * 3);
  });

  it('独身に戻り、配偶者の基礎年金はなくなるが、共働きだった配偶者の厚生年金の3/4が遺族年金で残る', () => {
    const s = married(75, 'fulltime');
    s.character.retired = true;
    s.character.pensionMonths = 0; // 本人の厚生年金なし
    const before = pensionMonthly(s);
    fireEvent(s, byId('spouse_death'), flatRng);
    expect(s.character.married).toBe(false);
    expect(s.character.spouse).toBeNull();
    expect(s.flags.widowed).toBe(true);
    expect(s.flags.survivorPension).toBe(45_000);
    expect(pensionMonthly(s)).toBeLessThan(before);
    expect(pensionMonthly(s)).toBe(before - 60_000 - (before - 60_000) / 2 + 45_000);
  });

  it('自分の厚生年金のほうが多ければ、遺族年金ではなく自分の分を受け取る', () => {
    const s = married(75, 'parttime');
    s.character.retired = true;
    s.character.pensionMonths = 480;
    s.character.avgMonthlyPay = 400_000;
    fireEvent(s, byId('spouse_death'), flatRng);
    expect(s.flags.survivorPension).toBe(0);
  });
});
