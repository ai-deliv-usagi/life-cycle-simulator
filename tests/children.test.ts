import { describe, expect, it } from 'vitest';
import { defaultData } from '../src/data/index';
import { childAllowance, childCost, childCostScale, childEffects, dependents, independentAge } from '../src/engine/children';
import { applyChoice, availableChoices, isEligible } from '../src/engine/events';
import { calcExpenses, calcIncome, monthlyGrossPay } from '../src/engine/money';
import { normalizePolicy } from '../src/engine/policy';
import { createRng } from '../src/engine/rng';
import { getMonthlyView, stepMonth } from '../src/engine/step';
import { effectiveWork } from '../src/engine/stats';
import type { EventDef, GameState } from '../src/engine/types';
import { flatRng, makeState, setAge } from './helpers';

const byId = (id: string): EventDef => defaultData.events.find((e) => e.id === id)!;

/** 30歳・既婚(共働き)で、指定の年齢の子どもがいる状態 */
function family(childAges: number[], policy: Parameters<typeof makeState>[1] = {}): GameState {
  const s = setAge(makeState({ job: 'office' }, policy), 30);
  s.month = 600;
  s.character.married = true;
  s.character.spouse = 'fulltime';
  s.character.children = childAges.map((age) => ({ birthMonth: s.month - age * 12, university: true }));
  return s;
}

describe('子どもの費用', () => {
  it('年齢の段階ごとに生活費と教育費がかかる。私立中心は中学から高くなる', () => {
    const { stages } = defaultData.balance.children;
    const k = childCostScale(family([3]));
    expect(childCost(family([3]))).toBe(Math.round((stages[0]!.living + stages[0]!.education.public) * k));
    expect(childCost(family([13]))).toBe(Math.round((stages[2]!.living + stages[2]!.education.public) * k));
    expect(childCost(family([13], { education: 'private' }))).toBe(Math.round(stages[2]!.living * k + stages[2]!.education.private));
    expect(childCost(family([8], { education: 'private' }))).toBe(childCost(family([8]))); // 小学校は公立
    expect(Math.abs(childCost(family([3, 13])) - childCost(family([3])) - childCost(family([13])))).toBeLessThanOrEqual(1);
  });

  it('世帯の収入に合わせて増減する(基準は手取り月30万円、収入の比の平方根で0.6〜1.3倍)', () => {
    const low = family([5]);
    low.character.job = 'parttime';
    low.character.spouse = 'homemaker';
    const high = family([5]);
    high.stats.skill = 100;
    high.policy.work = 'grind';
    expect(childCostScale(low)).toBeLessThan(1);
    expect(childCostScale(low)).toBeGreaterThanOrEqual(0.6);
    expect(childCost(low)).toBeLessThan(childCost(high));
    const s = family([5]);
    s.character.job = 'none';
    s.character.married = false;
    expect(childCostScale(s)).toBe(0.6);
  });

  it('大学に進めば22歳、進まなければ18歳で独立し、費用がかからなくなる', () => {
    const s = family([21.9]);
    expect(dependents(s)).toHaveLength(1);
    s.character.children![0]!.university = false;
    expect(independentAge(s.character.children![0]!)).toBe(18);
    expect(dependents(s)).toHaveLength(0);
    expect(childCost(s)).toBe(0);
  });

  it('子どもの費用は決まった支出に入り、そのぶん生活費が抑えられる', () => {
    const none = family([]);
    const one = family([5]);
    const e = calcExpenses(one);
    expect(e.children).toBe(childCost(one));
    expect(e.living).toBeLessThan(calcExpenses(none).living);
  });
});

describe('児童手当', () => {
  it('3歳未満は1.5万円、高校生まで1万円、3人目からは3万円', () => {
    expect(childAllowance(family([1]))).toBe(15_000);
    expect(childAllowance(family([10]))).toBe(10_000);
    expect(childAllowance(family([10, 7, 1]))).toBe(10_000 + 10_000 + 30_000);
    expect(childAllowance(family([18]))).toBe(0);
    expect(calcIncome(family([1])).childAllowance).toBe(15_000);
  });
});

describe('育休', () => {
  it('本人の育休中は給与とボーナスが止まり、最初の6ヶ月は額面月給の67%、残りは50%', () => {
    const s = family([0]);
    s.month = 602; // 6月(ボーナス月)
    const gross = monthlyGrossPay(s);
    s.flags.parentalLeave = 12;
    let inc = calcIncome(s);
    expect(inc.salary).toBe(0);
    expect(inc.bonus).toBe(0);
    expect(inc.parentalLeave).toBe(Math.round(gross * 0.67));
    s.flags.parentalLeave = 6;
    inc = calcIncome(s);
    expect(inc.parentalLeave).toBe(Math.round(gross * 0.5));
    expect(effectiveWork(s)).toBe('regular');
    expect(getMonthlyView(s).jobLabel).toBe('事務(育休中)');
  });

  it('配偶者の育休中は、配偶者の手取りが減る', () => {
    const s = family([0]);
    const before = calcIncome(s).spouse;
    s.flags.spouseLeave = 12;
    expect(calcIncome(s).spouse).toBe(Math.round(180_000 * 0.84));
    expect(calcIncome(s).spouse).toBeLessThan(before);
  });

  it('出産の選択肢: 会社員なら自分の育休、共働きなら配偶者の育休、いつでも「取らない」', () => {
    const s = family([]);
    s.flags.pregnant = 1;
    const ev = byId('birth');
    expect(isEligible(ev, s)).toBe(true);
    expect(availableChoices(ev, s).map((c) => c.choice.label)).toEqual([
      '自分が育休を取る(1年)',
      '配偶者が育休を取る(1年)',
      '育休は取らない',
    ]);
    s.character.spouse = 'homemaker';
    expect(availableChoices(ev, s).map((c) => c.choice.label)).toEqual(['自分が育休を取る(1年)', '育休は取らない']);
    applyChoice(s, ev, 0, flatRng);
    expect(s.character.children).toHaveLength(1);
    expect(s.flags.parentalLeave).toBe(12);
  });
});

describe('妊娠から出産まで', () => {
  it('妊娠すると10ヶ月後の月に出産のイベントが来る(ほかのイベントより先)', () => {
    let s = family([]);
    s.flags.pregnant = 10;
    const rng = createRng(1);
    let bornAt = -1;
    for (let i = 1; i <= 12 && bornAt < 0; i++) {
      s = stepMonth(s, rng);
      if (s.pendingEvent?.eventId === 'birth') bornAt = i;
      else delete s.pendingEvent;
    }
    expect(bornAt).toBe(9);
  });

  it('子どもは3人まで、子どもを考えるのは結婚していて42歳まで', () => {
    const ev = byId('child_wish');
    expect(isEligible(ev, family([1, 3]))).toBe(true);
    expect(isEligible(ev, family([1, 3, 5]))).toBe(false);
    expect(isEligible(ev, setAge(family([]), 43))).toBe(false);
    const single = family([]);
    single.character.married = false;
    expect(isEligible(ev, single)).toBe(false);
  });

  it('子どもの年齢で起きるイベント: 発熱は小さいうち、結婚は26〜35歳', () => {
    expect(isEligible(byId('child_sick'), family([3]))).toBe(true);
    expect(isEligible(byId('child_sick'), family([12]))).toBe(false);
    expect(isEligible(byId('child_wedding'), family([25]))).toBe(false);
    expect(isEligible(byId('child_wedding'), family([30]))).toBe(true);
  });
});

describe('幸福度と方針', () => {
  it('子どもがいると人間関係が上がり、小さい子がいると自由時間が減りストレスが増える', () => {
    const e = childEffects(family([2, 4]));
    expect(e.relations).toBe(12);
    expect(e.freeTime).toBe(-16);
    expect(e.stress).toBeCloseTo(0.4);
    expect(childEffects(family([20])).freeTime).toBeCloseTo(0);
  });

  it('古いセーブの方針には教育がないので、公立中心にする', () => {
    expect(normalizePolicy({ work: 'normal', spending: 'normal', invest: 'index', health: 'normal' }).education).toBe('public');
  });
});
