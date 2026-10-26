import { describe, expect, it } from 'vitest';
import { defaultData } from '../src/data/index';
import { businessValue, ownerSalary, reviewBusiness, reviewMean } from '../src/engine/business';
import { applyChoice, eventProb, isEligible } from '../src/engine/events';
import { annualGross, calcIncome, retire } from '../src/engine/money';
import type { Rng } from '../src/engine/rng';
import { getMonthlyView } from '../src/engine/step';
import type { EventDef, GameState } from '../src/engine/types';
import { flatRng, makeState, setAge } from './helpers';

const byId = (id: string): EventDef => defaultData.events.find((e) => e.id === id)!;
const cfg = defaultData.balance.business;

/** 決算の伸び(対数)を決めた乱数 */
const growth = (g: number): Rng => ({ ...flatRng, normal: () => g });

function startup(scale: 'small' | 'large' = 'small', cash = 5_000_000): GameState {
  const s = setAge(makeState({ job: 'sales' }), 35);
  s.month = 120;
  s.assets.cash = cash;
  applyChoice(s, byId('startup_chance'), scale === 'small' ? 0 : 1, flatRng);
  return s;
}

describe('起業', () => {
  it('元手を払って社長になる。前の会社の退職金は受け取り、役員報酬は業績で決まる', () => {
    const s = startup('small');
    expect(s.character.job).toBe('owner');
    expect(s.character.previousJob).toBe('sales');
    expect(s.business).toEqual({ since: 120, scale: 'small', level: cfg.startLevel });
    expect(s.assets.cash).toBeGreaterThanOrEqual(5_000_000 - 3_000_000);
    expect(ownerSalary(s)).toBe(Math.round(300_000 * cfg.startLevel));
    expect(annualGross(s)).toBe(ownerSalary(s) * 12);
    expect(calcIncome(s).bonus).toBe(0);
    expect(getMonthlyView(s).jobLabel).toBe('社長(1年目)');
  });

  it('元手が足りなければ、足りない分はローンになる', () => {
    const s = startup('large', 2_000_000);
    expect(s.assets.loan).toBe(8_000_000);
  });

  it('社長には会社員向けのイベント(昇進・ボーナスカット・リストラ・再雇用など)が起きない', () => {
    const s = startup();
    for (const id of ['promotion', 'raise_skipped', 'job_offer', 'bonus_cut', 'boss_trouble', 'windfall_bonus', 'layoff']) {
      expect(isEligible(byId(id), s)).toBe(false);
    }
    expect(eventProb(byId('layoff'), s)).toBe(0);
    expect(isEligible(byId('startup_chance'), s)).toBe(false);
    expect(isEligible(byId('big_client'), s)).toBe(true);
  });
});

describe('決算', () => {
  it('起業から12ヶ月ごとに業績が動き、ログに残る', () => {
    const s = startup();
    s.month = 125;
    expect(reviewBusiness(s, growth(0.5))).toBe(false);
    expect(s.business!.level).toBe(cfg.startLevel);
    s.month = 132;
    reviewBusiness(s, growth(0.5));
    expect(s.business!.level).toBeCloseTo(cfg.startLevel * Math.exp(0.5));
    expect(s.log.at(-1)).toMatchObject({ id: 'business_review' });
    expect(s.log.at(-1)!.text).toContain('1年目、業績が大きく伸びた');
  });

  it('業績が下がりきると廃業し、整理の費用がかかる', () => {
    const s = startup();
    const cash = s.assets.cash;
    s.month = 132;
    expect(reviewBusiness(s, growth(-1))).toBe(true);
    expect(s.business).toBeUndefined();
    expect(s.assets.cash).toBe(cash - cfg.closeCost.small);
    expect(s.log.at(-1)).toMatchObject({ id: 'business_closed' });
  });

  it('伸びの平均は、スキル・運が高いほど、働くほど上がり、不況で下がる', () => {
    const s = startup();
    const base = reviewMean(s);
    s.stats.skill = 90;
    expect(reviewMean(s)).toBeGreaterThan(base);
    s.policy.work = 'grind';
    const grind = reviewMean(s);
    s.flags.recession = 6;
    expect(reviewMean(s)).toBeLessThan(grind);
  });
});

describe('会社を手放す', () => {
  it('買収の打診は業績が高いときだけ。売ると会社の価値を受け取り、無職になる(失業給付なし)', () => {
    const s = startup();
    expect(isEligible(byId('acquisition_offer'), s)).toBe(false);
    s.business!.level = 3;
    expect(isEligible(byId('acquisition_offer'), s)).toBe(true);
    const value = businessValue(s);
    expect(value).toBe(Math.round(300_000 * (3 - cfg.breakEvenLevel) * cfg.valuationMonths));
    const cash = s.assets.cash;
    applyChoice(s, byId('acquisition_offer'), 0, flatRng);
    expect(s.assets.cash).toBe(cash + value);
    expect(s.character.job).toBe('none');
    expect(s.business).toBeUndefined();
    expect(s.flags.unemploymentBenefit).toBe(0);
  });

  it('65歳の定年では事業承継して、会社の価値の半分を受け取る', () => {
    const s = startup();
    s.business!.level = 2;
    const value = businessValue(s);
    const cash = s.assets.cash;
    retire(s);
    expect(s.assets.cash).toBe(cash + Math.round(value * cfg.successionShare));
    expect(s.business).toBeUndefined();
    expect(s.log.at(-1)).toMatchObject({ id: 'business_succession' });
  });

  it('燃え尽きて仕事を辞めると会社もたたむ。再就職で戻るのは会社員の前の仕事', () => {
    const s = startup();
    applyChoice(s, byId('burnout'), 1, flatRng);
    expect(s.character.job).toBe('none');
    expect(s.business).toBeUndefined();
    expect(s.character.previousJob).toBe('sales');
  });
});
