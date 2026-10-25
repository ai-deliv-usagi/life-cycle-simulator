import { describe, expect, it } from 'vitest';
import {
  computeHappiness,
  HAPPINESS_PARTS,
  happinessParts,
  happinessWeights,
  livingSatisfaction,
  updateAdaptation,
} from '../src/engine/happiness';
import { calcExpenses } from '../src/engine/money';
import { makeState, neutralValues } from './helpers';

describe('重み', () => {
  it('価値観が中立なら全部1', () => {
    for (const w of Object.values(happinessWeights(neutralValues))) expect(w).toBe(1);
  });

  it('家族重視は人間関係が重く自由時間が軽い', () => {
    const w = happinessWeights({ ...neutralValues, relation: -2 });
    expect(w.relations).toBeCloseTo(1.5);
    expect(w.freeTime).toBeCloseTo(0.5);
  });

  it('使う派は生活水準が重い', () => {
    expect(happinessWeights({ ...neutralValues, spending: 2 }).living).toBeCloseTo(1.5);
  });

  it('重みは最小0.2', () => {
    const w = happinessWeights({ risk: 2, relation: 0, spending: 2, work: 0 });
    expect(w.security).toBeCloseTo(0.2);
    const v = happinessWeights({ risk: -2, relation: 0, spending: 0, work: -2 });
    expect(v.achievement).toBeCloseTo(0.2);
  });
});

describe('生活水準(頭打ちと慣れ)', () => {
  it('慣れた水準と同じなら 絶対額の項 + 20', () => {
    expect(livingSatisfaction(130_000, 130_000)).toBeCloseTo(60 * (1 - Math.exp(-0.65)) + 20);
  });

  it('頭打ち: 同じだけ増やしても、高いほど上がり方が小さい', () => {
    const low = livingSatisfaction(200_000, 200_000) - livingSatisfaction(130_000, 130_000);
    const high = livingSatisfaction(800_000, 800_000) - livingSatisfaction(400_000, 400_000);
    expect(high).toBeLessThan(low);
  });

  it('上げた直後は上がり、2年ほどで慣れて戻る。下げたときは大きく下がる', () => {
    const s = makeState({}, { spending: 'normal' });
    const before = happinessParts(s).living;
    s.policy.spending = 'lavish';
    const justAfter = happinessParts(s).living;
    expect(justAfter - before).toBeGreaterThan(15);
    for (let i = 0; i < 72; i++) updateAdaptation(s);
    const adapted = happinessParts(s).living;
    expect(adapted).toBeLessThan(justAfter - 10);
    expect(adapted).toBeGreaterThan(before); // 絶対額の分は残る
    s.policy.spending = 'normal';
    expect(happinessParts(s).living).toBeLessThan(before - 5);
  });
});

describe('各要素', () => {
  it('安心: 金融資産が生活費24ヶ月分で100、借金で−30、生活保護中は0', () => {
    const s = makeState();
    const months24 = calcExpenses(s).total * 24;
    s.assets.cash = months24;
    expect(happinessParts(s).security).toBeCloseTo(100);
    s.assets.cash = months24 / 2;
    expect(happinessParts(s).security).toBeCloseTo(50);
    s.assets.debt = 1;
    expect(happinessParts(s).security).toBeCloseTo(20);
    s.assets.debt = 0;
    s.flags.welfare = true;
    expect(happinessParts(s).security).toBe(0);
  });

  it('人間関係は結婚中+15(上限100)', () => {
    const s = makeState();
    expect(happinessParts(s).relations).toBe(50);
    s.character.married = true;
    expect(happinessParts(s).relations).toBe(65);
    s.stats.relations = 95;
    expect(happinessParts(s).relations).toBe(100);
  });

  it('自由時間: 働き方で決まり、退職後90、田舎で車がないと−15', () => {
    expect(happinessParts(makeState({}, { work: 'grind' })).freeTime).toBe(15);
    const r = makeState({}, { work: 'grind' });
    r.character.retired = true;
    expect(happinessParts(r).freeTime).toBe(90);
    expect(happinessParts(makeState({ region: 'rural', hasCar: false })).freeTime).toBe(65);
    expect(happinessParts(makeState({ region: 'rural', hasCar: true })).freeTime).toBe(80);
  });

  it('達成感 = 0.5×スキル + achievement', () => {
    const s = makeState();
    s.achievement = 20;
    expect(happinessParts(s).achievement).toBe(25);
  });
});

describe('computeHappiness', () => {
  it('重み付き平均で、中立なら要素の単純平均', () => {
    const s = makeState();
    const parts = happinessParts(s);
    const avg = HAPPINESS_PARTS.reduce((a, p) => a + parts[p], 0) / HAPPINESS_PARTS.length;
    expect(computeHappiness(s)).toBeCloseTo(avg);
  });

  it('同じ状態でも価値観で幸福度が変わる(正解の人生はない)', () => {
    const busy = makeState({}, { work: 'grind' });
    busy.stats.skill = 90;
    busy.achievement = 40;
    busy.values = { risk: 2, relation: 0, spending: 0, work: 2 };
    const climber = computeHappiness(busy);
    busy.values = { risk: 0, relation: 2, spending: 0, work: -2 };
    const freeSpirit = computeHappiness(busy);
    expect(climber).toBeGreaterThan(freeSpirit + 5);
  });

  it('0〜100に収まる', () => {
    const s = makeState();
    s.stats = { health: 100, stress: 0, skill: 100, credit: 100, relations: 100 };
    s.achievement = 100;
    s.assets.cash = 1e10;
    expect(computeHappiness(s)).toBeLessThanOrEqual(100);
    s.stats = { health: 0, stress: 100, skill: 0, credit: 0, relations: 0 };
    s.achievement = 0;
    s.assets.cash = 0;
    expect(computeHappiness(s)).toBeGreaterThanOrEqual(0);
  });
});
