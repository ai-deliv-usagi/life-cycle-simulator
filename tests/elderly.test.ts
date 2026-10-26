import { describe, expect, it } from 'vitest';
import { defaultData } from '../src/data/index';
import { applyChoice, availableChoices, eventProb, fireEvent, isEligible } from '../src/engine/events';
import type { EventDef } from '../src/engine/types';
import { flatRng, makeState, setAge } from './helpers';

const byId = (id: string): EventDef => defaultData.events.find((e) => e.id === id)!;
const labels = (id: string, age: number) => availableChoices(byId(id), setAge(makeState(), age)).map((c) => c.choice.label);

describe('年齢に合わない出来事の上限', () => {
  it('ブランド品・高級家具は70歳まで、衝動買い・友人の借金は75歳まで', () => {
    const at = (id: string, age: number) => isEligible(byId(id), setAge(makeState(), age));
    expect(at('luxury_brand', 70)).toBe(true);
    expect(at('luxury_brand', 71)).toBe(false);
    expect(at('luxury_furniture', 71)).toBe(false);
    expect(at('impulse_buy', 76)).toBe(false);
    expect(at('friend_loan', 75)).toBe(true);
    expect(at('friend_loan', 76)).toBe(false);
  });
});

describe('腰痛', () => {
  it('65歳からは整体ではなく、保険のきく整形外科でリハビリ。起きやすさは1.5倍', () => {
    expect(labels('back_pain', 64)).toEqual(['整体に通う', '我慢する']);
    expect(labels('back_pain', 65)).toEqual(['整形外科でリハビリ(保険がきく)', '我慢する']);
    const p = (age: number) => eventProb(byId('back_pain'), setAge(makeState(), age));
    expect(p(70)).toBeCloseTo(p(60) * 1.5);
  });
});

describe('後期高齢者の出来事', () => {
  it('転倒して骨折すると、介護が必要になりやすい', () => {
    const s = setAge(makeState({ initialCash: 1_000_000 }), 80);
    s.stats.health = 80; // 骨折で健康が40を切ると、それでも起きやすくなるので高めに
    const before = eventProb(byId('care_needed'), s);
    fireEvent(s, byId('fall_fracture'), flatRng);
    expect(s.flags.fracture).toBe(true);
    expect(eventProb(byId('care_needed'), s)).toBeCloseTo(before * 2);
  });

  it('孫にお小遣いは孫が生まれてから。持病の通院・老人会は70歳から、住み替えは80歳からでお金がある人だけ', () => {
    const s = setAge(makeState(), 65);
    expect(isEligible(byId('grandchild_gift'), s)).toBe(false);
    fireEvent(s, byId('grandchild'), flatRng);
    expect(isEligible(byId('grandchild_gift'), s)).toBe(true);
    expect(isEligible(byId('chronic_clinic'), setAge(makeState(), 69))).toBe(false);
    expect(isEligible(byId('senior_club'), setAge(makeState(), 70))).toBe(true);
    expect(isEligible(byId('senior_housing'), setAge(makeState({ initialCash: 5_000_000 }), 80))).toBe(true);
    expect(isEligible(byId('senior_housing'), setAge(makeState(), 80))).toBe(false);
    const rich = setAge(makeState({ initialCash: 5_000_000 }), 82);
    applyChoice(rich, byId('senior_housing'), 0, flatRng);
    expect(rich.assets.cash).toBe(2_000_000);
  });
});
