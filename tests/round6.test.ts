import { describe, expect, it } from 'vitest';
import { defaultData } from '../src/data/index';
import { applyChoice, availableChoices, eventProb, isEligible } from '../src/engine/events';
import { annualGross, loanRejection } from '../src/engine/money';
import type { EventDef } from '../src/engine/types';
import { flatRng, makeState, setAge } from './helpers';

const byId = (id: string): EventDef => defaultData.events.find((e) => e.id === id)!;
const labels = (id: string, s: ReturnType<typeof makeState>) => availableChoices(byId(id), s).map((c) => c.choice.label);

describe('車を買う年齢', () => {
  it('高級車は60歳まで。車を買うのは69歳まで', () => {
    expect(isEligible(byId('luxury_car'), setAge(makeState(), 60))).toBe(true);
    expect(isEligible(byId('luxury_car'), setAge(makeState(), 61))).toBe(false);
    expect(labels('car_purchase', setAge(makeState(), 60))).toContain('高級車を買う');
    expect(labels('car_purchase', setAge(makeState(), 61))).not.toContain('高級車を買う');
    expect(isEligible(byId('car_purchase'), setAge(makeState(), 69))).toBe(true);
    expect(isEligible(byId('car_purchase'), setAge(makeState(), 70))).toBe(false);
  });

  it('免許を返納したら、もう車を買うイベントは起きない', () => {
    const s = setAge(makeState({ hasCar: true }), 68);
    applyChoice(s, byId('license_return'), 0, flatRng);
    expect(s.flags.hasCar).toBe(false);
    expect(isEligible(byId('car_purchase'), s)).toBe(false);
  });
});

describe('ローンの審査(返済負担率)', () => {
  it('毎月の返済の合計は額面の月収の25%まで、バイトは15%まで。無職は借りられない', () => {
    const part = setAge(makeState({ job: 'parttime' }), 30);
    const monthly = annualGross(part) / 12;
    expect(loanRejection(part, 1_000_000, 60)).toBeNull();
    expect(loanRejection(part, 2_500_000, 60)).toBe('収入に対して返済が大きすぎる');
    expect(monthly * 0.15).toBeLessThan(45_000); // 250万円・60回の返済(約4.5万円)は払えない
    expect(loanRejection(setAge(makeState({ job: 'engineer' }), 30), 2_500_000, 60)).toBeNull();
    const none = setAge(makeState(), 30);
    none.character.job = 'none';
    expect(loanRejection(none, 300_000, 36)).toBe('収入に対して返済が大きすぎる');
  });

  it('バイトは高級車のローンを選べない(理由が出る)。現金なら選べる', () => {
    const part = setAge(makeState({ job: 'parttime' }), 30);
    const choices = availableChoices(byId('luxury_car'), part);
    expect(choices[1]!.blocked).toBe('審査に通らない(収入に対して返済が大きすぎる)');
    expect(choices[0]!.blocked).toBeUndefined();
  });
});

describe('バイトから正社員へ', () => {
  it('バイトには転職の誘いは来ず、正社員の求人・正社員登用の話が来る(45・50歳まで)', () => {
    const part = setAge(makeState({ job: 'parttime' }), 30);
    expect(isEligible(byId('job_offer'), part)).toBe(false);
    expect(isEligible(byId('regular_job_offer'), part)).toBe(true);
    expect(isEligible(byId('regular_conversion'), part)).toBe(true);
    expect(isEligible(byId('regular_job_offer'), setAge(makeState({ job: 'parttime' }), 46))).toBe(false);
    expect(isEligible(byId('regular_job_offer'), setAge(makeState({ job: 'office' }), 30))).toBe(false);
  });

  it('就職すると会社員になり、最初の給料は少し低め', () => {
    const s = setAge(makeState({ job: 'parttime' }), 30);
    applyChoice(s, byId('regular_job_offer'), 0, flatRng);
    expect(['parttime', 'owner', 'none']).not.toContain(s.character.job);
    expect(s.flags.payMul).toBe(0.9);
  });

  it('職業訓練を受けると3年間は正社員の話が来やすい', () => {
    const s = setAge(makeState({ job: 'parttime' }), 30);
    const before = eventProb(byId('regular_conversion'), s);
    const skill = s.stats.skill;
    applyChoice(s, byId('job_training'), 0, flatRng);
    expect(s.stats.skill).toBe(skill + 10);
    expect(s.flags.trained).toBe(36);
    expect(eventProb(byId('regular_conversion'), s)).toBeGreaterThan(before * 1.9);
  });
});

describe('スキルが低いときの手当て', () => {
  it('社内研修はスキル40未満の会社員だけ。社会人スクール・資格はスキルが低いほど起きやすい', () => {
    const s = setAge(makeState({ job: 'office' }), 30);
    s.stats.skill = 30;
    expect(eventProb(byId('company_training'), s)).toBeGreaterThan(0);
    const school = eventProb(byId('evening_class'), s);
    s.stats.skill = 50;
    expect(eventProb(byId('company_training'), s)).toBe(0);
    expect(eventProb(byId('evening_class'), s)).toBeCloseTo(school / 2.5);
    expect(isEligible(byId('job_training'), setAge(makeState({ job: 'office' }), 30))).toBe(false);
  });
});

describe('リボ払いはお金がないときだけ', () => {
  it('金融資産が100万円以上なら、リボ払いの誘いは起きず、ブランド品の「リボ払いで買う」も出ない', () => {
    const poor = setAge(makeState({ initialCash: 500_000 }), 30);
    const rich = setAge(makeState({ initialCash: 1_000_000 }), 30);
    expect(isEligible(byId('revolving'), poor)).toBe(true);
    expect(isEligible(byId('revolving'), rich)).toBe(false);
    expect(labels('luxury_brand', poor)).toContain('リボ払いで買う');
    expect(labels('luxury_brand', rich)).not.toContain('リボ払いで買う');
  });
});
