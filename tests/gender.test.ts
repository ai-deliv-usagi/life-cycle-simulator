import { describe, expect, it } from 'vitest';
import { defaultData } from '../src/data/index';
import { monthlyDeathProb } from '../src/engine/death';
import { applyChoice, applyEffects, eventProb } from '../src/engine/events';
import { calcIncome, monthlyGrossPay } from '../src/engine/money';
import { createRng } from '../src/engine/rng';
import { createGame, rollCharacter } from '../src/engine/setup';
import { getMonthlyView } from '../src/engine/step';
import type { EventDef, Gender } from '../src/engine/types';
import { defaultPolicy, flatRng, makeState, neutralValues, setAge } from './helpers';

const byId = (id: string): EventDef => defaultData.events.find((e) => e.id === id)!;

function person(gender: Gender | undefined, age = 30) {
  return setAge(makeState({ job: 'office', ...(gender ? { gender } : {}) }), age);
}

describe('性別のガチャ', () => {
  it('男女ほぼ半々。同じシードなら同じ性別で、ほかのガチャ結果は変わらない', () => {
    const rolls = Array.from({ length: 2000 }, (_, i) => rollCharacter(i));
    const female = rolls.filter((r) => r.gender === 'female').length / rolls.length;
    expect(female).toBeGreaterThan(0.45);
    expect(female).toBeLessThan(0.55);
    expect(rollCharacter(42).gender).toBe(rollCharacter(42).gender);
    const g = createGame(rollCharacter(5), neutralValues, defaultPolicy, 'x');
    expect(g.character.gender).toBe(rollCharacter(5).gender);
  });
});

describe('寿命', () => {
  it('男性は死亡率が高く、女性は低い(性別のない古いセーブは平均)', () => {
    const m = monthlyDeathProb(person('male', 70));
    const f = monthlyDeathProb(person('female', 70));
    const none = monthlyDeathProb(person(undefined, 70));
    expect(m / none).toBeCloseTo(1.4);
    expect(f / none).toBeCloseTo(0.7);
  });

  it('配偶者との死別は、配偶者(異性)の死亡率で起きる。女性のほうが死別しやすい', () => {
    const ev = byId('spouse_death');
    const m = person('male', 75);
    const f = person('female', 75);
    for (const s of [m, f]) {
      s.character.married = true;
      s.character.spouse = 'fulltime';
    }
    expect(eventProb(ev, f)).toBeGreaterThan(eventProb(ev, m) * 1.5);
  });
});

describe('配偶者の働き方', () => {
  it('男性の配偶者はパート・専業が多く、女性の配偶者はほとんど正社員', () => {
    const count = (gender: Gender) => {
      const n: Record<string, number> = { fulltime: 0, parttime: 0, homemaker: 0 };
      const rng = createRng(9);
      for (let i = 0; i < 1000; i++) {
        const s = person(gender);
        applyEffects(s, { setFlags: { married: true } }, rng);
        n[s.character.spouse!]!++;
      }
      return n;
    };
    const m = count('male');
    const f = count('female');
    expect(m.fulltime!).toBeLessThan(400);
    expect(f.fulltime!).toBeGreaterThan(880);
  });
});

describe('出産', () => {
  function pregnant(gender: Gender) {
    const s = person(gender);
    s.character.married = true;
    s.character.spouse = gender === 'female' ? 'fulltime' : 'parttime';
    s.flags.pregnant = 1;
    return s;
  }

  it('女性本人は出産で健康が下がり、育休を取らなくても会社員なら2ヶ月の産休(額面月給の67%)', () => {
    const s = pregnant('female');
    const health = s.stats.health;
    const gross = monthlyGrossPay(s);
    const ev = byId('birth');
    applyChoice(s, ev, ev.choices!.length - 1, flatRng); // 育休は取らない
    expect(s.stats.health).toBe(health - 5);
    expect(s.flags.maternityLeave).toBe(2);
    expect(s.log.some((e) => e.id === 'maternity_leave')).toBe(true);
    const inc = calcIncome(s);
    expect(inc.salary).toBe(0);
    expect(inc.parentalLeave).toBe(Math.round(gross * 0.67));
    expect(getMonthlyView(s).jobLabel).toBe('事務(産休中)');
  });

  it('女性本人が育休を取るなら、産休は育休に含める。男性は出産しても健康も産休も変わらない', () => {
    const f = pregnant('female');
    applyChoice(f, byId('birth'), 0, flatRng);
    expect(f.flags.parentalLeave).toBe(12);
    expect(f.flags.maternityLeave ?? 0).toBe(0);

    const m = pregnant('male');
    const health = m.stats.health;
    applyChoice(m, byId('birth'), byId('birth').choices!.length - 1, flatRng);
    expect(m.stats.health).toBe(health);
    expect(m.flags.maternityLeave ?? 0).toBe(0);
  });
});
