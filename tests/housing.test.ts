import { describe, expect, it } from 'vitest';
import { defaultData } from '../src/data/index';
import { applyChoice, applyEffects, availableChoices, isEligible } from '../src/engine/events';
import { homePrice, housingDeduction, mortgagePayment } from '../src/engine/housing';
import { annualGross, applyMonthlyMoney, calcExpenses, calcIncome, declareBankruptcy, realLivingSpending } from '../src/engine/money';
import type { EventDef, GameState } from '../src/engine/types';
import { annuityPayment, netWorth } from '../src/engine/util';
import { flatRng, makeState, setAge } from './helpers';

const byId = (id: string): EventDef => defaultData.events.find((e) => e.id === id)!;
const h = defaultData.balance.housing;

/** 35歳・既婚・エンジニア(地方都市)で、預金がある状態 */
function family(cash = 10_000_000): GameState {
  const s = setAge(makeState({ job: 'engineer', region: 'city' }), 35);
  s.character.married = true;
  s.character.spouse = 'parttime';
  s.stats.skill = 50;
  s.assets.cash = cash;
  return s;
}

function buy(s: GameState, choice = 0): GameState {
  applyChoice(s, byId('home_purchase'), choice, flatRng);
  return s;
}

describe('家を買う', () => {
  it('年収の6倍まで(地域の相場が上限)。頭金1割と諸費用7%を現金で払い、残りを35年・年1%の住宅ローンに', () => {
    const s = family();
    const gross = annualGross(s);
    const price = homePrice(s, gross);
    expect(price).toBe(Math.min(h.price.city, Math.floor((gross * 6) / 1_000_000) * 1_000_000));
    buy(s);
    expect(s.home).toMatchObject({ boughtMonth: 0, price });
    expect(s.assets.home).toBe(price);
    expect(s.assets.mortgage).toBe(Math.round(price * 0.9));
    expect(s.home!.payment).toBe(annuityPayment(Math.round(price * 0.9), 0.01, 35 * 12));
    expect(s.assets.cash).toBe(10_000_000 - Math.round(price * 0.1 + price * 0.07));
    expect(s.log.some((e) => e.id === 'home_bought')).toBe(true);
    expect(netWorth(s.assets)).toBe(10_000_000 - Math.round(price * 0.17) + price - Math.round(price * 0.9));
  });

  it('大都市でも相場(5,500万円)より高い家は買わない', () => {
    const s = family();
    s.character.region = 'metro';
    expect(homePrice(s, 20_000_000)).toBe(h.price.metro);
  });

  it('現金が足りなければ、頭金と諸費用はローンになる', () => {
    const s = buy(family(500_000));
    expect(s.home).toBeDefined();
    expect(s.assets.loan).toBeGreaterThan(0);
  });

  it('審査: 信用が低い・80歳までに返し終わらないと買えない', () => {
    const s = family();
    s.stats.credit = 10;
    const blocked = (t: GameState) => availableChoices(byId('home_purchase'), t)[0]!.blocked;
    expect(blocked(s)).toBe('審査に通らない(信用が足りない)');
    expect(blocked(setAge(family(), 72))).toBe('審査に通らない(年齢的に返し終わらない)');
    const part = family();
    part.character.job = 'parttime';
    expect(blocked(part)).toBe('審査に通らない(正社員でない)');
    // 効果として家を買うときも審査する(落ちたら買わずにログ)
    applyEffects(s, { buyHome: 0.1 }, flatRng);
    expect(s.home).toBeUndefined();
    expect(s.log.at(-1)).toMatchObject({ id: 'mortgage_rejected' });
  });

  it('マイホームの検討は、持ち家がない会社員(28〜50歳)だけ。持ち家だと引っ越しイベントは起きない', () => {
    const s = family();
    expect(isEligible(byId('home_purchase'), s)).toBe(true);
    expect(isEligible(byId('moving'), s)).toBe(true);
    buy(s);
    expect(isEligible(byId('home_purchase'), s)).toBe(false);
    expect(isEligible(byId('moving'), s)).toBe(false);
  });
});

describe('毎月のお金', () => {
  it('家賃がなくなり、住宅ローンと固定資産税・修繕がかかる。暮らしの中身(実質の生活費)は家賃の分を足して比べる', () => {
    const renter = family();
    const owner = buy(family());
    const r = calcExpenses(renter);
    const o = calcExpenses(owner);
    expect(o.mortgage).toBe(owner.home!.payment);
    expect(o.homeCost).toBe(Math.round((owner.home!.price * h.ownershipCostRate) / 12));
    expect(o.living).toBeLessThan(r.living);
    expect(Math.abs(realLivingSpending(owner) - realLivingSpending(renter))).toBeLessThan(15_000);
  });

  it('住宅ローン控除: 13年間、残高の0.7%(年)が手取りに戻る', () => {
    const s = buy(family());
    expect(calcIncome(s).housingDeduction).toBe(Math.round((s.assets.mortgage! * 0.007) / 12));
    s.month = 13 * 12;
    expect(housingDeduction(s)).toBe(0);
  });

  it('毎月返すと住宅ローンの残高が減り、家の時価は地域で変わる(地方都市は年1%下がる)', () => {
    const s = buy(family());
    const before = s.assets.mortgage!;
    const principal = mortgagePayment(s).principal;
    const value = s.assets.home!;
    applyMonthlyMoney(s, flatRng);
    expect(s.assets.mortgage).toBe(before - principal);
    expect(s.assets.home).toBe(Math.round(value * (1 - 0.01 / 12)));
  });
});

describe('家を手放す', () => {
  it('借金が借入上限を超えたら、破産する前に家を売って返す', () => {
    const s = buy(family(5_000_000));
    s.assets.cash = 0;
    s.assets.debt = 5_000_000;
    applyMonthlyMoney(s, flatRng);
    expect(s.home).toBeUndefined();
    expect(s.assets.home).toBe(0);
    expect(s.assets.mortgage).toBe(0);
    expect(s.log.some((e) => e.id === 'home_sold')).toBe(true);
    expect(s.flags.bankrupt).toBeFalsy();
  });

  it('自己破産すると家は競売になり、住宅ローンも消える', () => {
    const s = buy(family());
    declareBankruptcy(s);
    expect(s.home).toBeUndefined();
    expect(s.assets.mortgage).toBe(0);
  });

  it('持ち家で左遷の転勤になると、単身赴任(住む場所は変わらない)', () => {
    const s = buy(family());
    applyEffects(s, { relocate: 'down' }, flatRng);
    expect(s.character.region).toBe('city');
    expect(s.log.at(-1)).toMatchObject({ id: 'solo_transfer' });
  });

  it('修繕は買って10年たってから。先送りすると家の価値が下がる', () => {
    const s = buy(family());
    expect(isEligible(byId('home_repair'), s)).toBe(false);
    s.month = 120;
    expect(isEligible(byId('home_repair'), s)).toBe(true);
    const value = s.assets.home!;
    applyChoice(s, byId('home_repair'), 2, flatRng);
    expect(s.assets.home).toBe(Math.round(value * 0.88));
  });
});
