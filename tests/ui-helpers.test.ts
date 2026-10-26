import { describe, expect, it } from 'vitest';
import { defaultData } from '../src/data/index';
import { applyChoice, choiceCost } from '../src/engine/events';
import { homePrice } from '../src/engine/housing';
import { annualGross } from '../src/engine/money';
import { monthsToRepay, upcoming } from '../src/engine/upcoming';
import type { EventDef } from '../src/engine/types';
import { annuityPayment } from '../src/engine/util';
import { flatRng, makeState, setAge } from './helpers';

const byId = (id: string): EventDef => defaultData.events.find((e) => e.id === id)!;
const choice = (id: string, i: number) => byId(id).choices![i]!;

describe('選択肢の金額の目安', () => {
  it('現金の出費(支出の方針で増減する分も)、ローン、起業の元手', () => {
    const lavish = setAge(makeState({}, { spending: 'lavish' }), 30);
    expect(choiceCost(byId('travel'), choice('travel', 0), lavish)).toEqual({ spend: 720_000, borrow: 0 });
    expect(choiceCost(byId('car_purchase'), choice('car_purchase', 1), lavish)).toEqual({ spend: 0, borrow: 2_500_000, borrowRate: 0.03 });
    expect(choiceCost(byId('revolving'), choice('revolving', 0), lavish)).toEqual({ spend: 0, borrow: 720_000, borrowRate: 0.15 });
    expect(choiceCost(byId('startup_chance'), choice('startup_chance', 0), lavish).spend).toBe(3_000_000);
    expect(choiceCost(byId('travel'), choice('travel', 2), lavish)).toEqual({ spend: 0, borrow: 0 });
  });

  it('家を買う選択肢は、家の値段と頭金・諸費用・住宅ローンの額。実際に買った額と同じ', () => {
    const s = setAge(makeState({ job: 'engineer' }), 35);
    s.assets.cash = 10_000_000;
    const cost = choiceCost(byId('home_purchase'), choice('home_purchase', 0), s);
    const price = homePrice(s, annualGross(s));
    expect(cost).toEqual({ spend: Math.round(price * 0.17), borrow: Math.round(price * 0.9), borrowRate: 0.01, homePrice: price });
    applyChoice(s, byId('home_purchase'), 0, flatRng);
    expect(s.assets.cash).toBe(10_000_000 - cost.spend);
    expect(s.assets.mortgage).toBe(cost.borrow);
  });
});

describe('これから', () => {
  it('返し終わるまでの月数(元利均等)', () => {
    const pay = annuityPayment(30_000_000, 0.01, 420);
    expect(monthsToRepay(30_000_000, pay, 0.01)).toBe(420);
    expect(monthsToRepay(1_200_000, 100_000, 0)).toBe(12);
    expect(monthsToRepay(1_000_000, 100, 0.15)).toBe(Infinity);
  });

  it('定年・子どもの独立・住宅ローンの完済などを近い順に', () => {
    const s = setAge(makeState({ job: 'engineer' }), 40);
    s.month = 300;
    s.assets.cash = 10_000_000;
    s.character.married = true;
    s.character.children = [{ birthMonth: 300 - 15 * 12, university: true }];
    applyChoice(s, byId('home_purchase'), 0, flatRng);
    const list = upcoming(s);
    expect(list.map((u) => u.label)).toEqual(['1人目の子どもの独立', '定年退職(65歳)', '住宅ローンの完済']);
    expect(list[0]!.months).toBe(7 * 12);
    expect(list[1]!.months).toBe(25 * 12);
    expect(list[2]!.months).toBe(35 * 12);
  });

  it('バイトは「年金の受け取り開始」、社長は「事業承継」', () => {
    expect(upcoming(setAge(makeState({ job: 'parttime' }), 30))[0]!.label).toBe('年金の受け取り開始');
    const owner = setAge(makeState({ job: 'sales' }), 35);
    owner.assets.cash = 5_000_000;
    applyChoice(owner, byId('startup_chance'), 0, flatRng);
    expect(upcoming(owner)[0]!.label).toBe('引退を考え始める(65歳)');
  });
});
