import { describe, expect, it } from 'vitest';
import {
  annualGross,
  applyMonthlyMoney,
  applyReturns,
  basicPension,
  calcExpenses,
  calcIncome,
  changeJob,
  debtLimit,
  employeePension,
  pensionMonthly,
  retire,
  severancePay,
  takeHomeRate,
} from '../src/engine/money';
import { defaultData } from '../src/data/index';
import { createRng } from '../src/engine/rng';
import { flatRng, makeState, setAge } from './helpers';

describe('額面年収(昇給カーブ)', () => {
  // 大卒エンジニア・地方都市・定時・スキル10: スキル係数 0.92
  it('開始時は初年度年収、50歳でピーク、それ以降は横ばい', () => {
    expect(annualGross(setAge(makeState(), 22))).toBe(3_220_000);
    expect(annualGross(setAge(makeState(), 36))).toBe(5_060_000);
    expect(annualGross(setAge(makeState(), 50))).toBe(6_900_000);
    expect(annualGross(setAge(makeState(), 60))).toBe(6_900_000);
  });

  it('学歴の初任給係数・昇給係数を使い、カーブは開始年齢から50歳まで', () => {
    const s = makeState({ education: 'high', job: 'factory' });
    expect(s.startAge).toBe(18);
    expect(annualGross(setAge(s, 18))).toBe(Math.round(3_000_000 * 0.88 * 0.92));
    expect(annualGross(setAge(s, 50))).toBe(Math.round(4_800_000 * 0.9 * 0.92));
  });

  it('働き方・スキル・payMul・地域の給与係数を掛ける', () => {
    const s = makeState({ region: 'metro' }, { work: 'grind' });
    s.stats.skill = 100;
    s.flags.payMul = 1.1;
    expect(annualGross(s)).toBe(Math.round(3_500_000 * 1.35 * 1.1 * 1.1 * 1.1));
  });

  it('無職と退職後は0', () => {
    const s = makeState();
    s.character.job = 'none';
    expect(annualGross(s)).toBe(0);
    const r = makeState();
    r.character.retired = true;
    expect(annualGross(r)).toBe(0);
  });
});

describe('手取り率の帯', () => {
  it.each([
    [2_999_999, 0.8],
    [3_000_000, 0.77],
    [5_999_999, 0.77],
    [6_000_000, 0.73],
    [9_999_999, 0.73],
    [10_000_000, 0.68],
    [50_000_000, 0.68],
  ])('額面 %i 円 → %f', (annual, rate) => {
    expect(takeHomeRate(annual)).toBe(rate);
  });

  it('給与の手取り = 額面月給 × 手取り率', () => {
    expect(calcIncome(makeState()).salary).toBe(Math.round((3_220_000 / 12) * 0.77));
  });
});

describe('年金と退職金', () => {
  it('基礎年金: 加入40年で満額、短ければ按分', () => {
    expect(basicPension(makeState())).toBe(66_000);
    const s = makeState();
    s.startAge = 30;
    expect(basicPension(s)).toBe(Math.round(66_000 * (35 / 40)));
  });

  it('厚生年金 = 平均月収 × 0.005481 × 加入月数 / 12', () => {
    const s = makeState();
    s.character.avgMonthlyPay = 300_000;
    s.character.pensionMonths = 516;
    expect(employeePension(s)).toBe(Math.round((300_000 * 0.005481 * 516) / 12));
  });

  it('既婚なら基礎年金2倍、共働きの配偶者は厚生年金6万円を足す', () => {
    const s = makeState();
    s.character.avgMonthlyPay = 300_000;
    s.character.pensionMonths = 516;
    const own = employeePension(s);
    expect(pensionMonthly(s)).toBe(66_000 + own);
    s.character.married = true;
    s.character.spouse = 'homemaker';
    expect(pensionMonthly(s)).toBe(132_000 + own);
    s.character.spouse = 'fulltime';
    expect(pensionMonthly(s)).toBe(132_000 + own + 60_000);
  });

  it('退職後の収入は年金 × 0.90', () => {
    const s = setAge(makeState(), 65);
    s.character.retired = true;
    const income = calcIncome(s);
    expect(income.salary).toBe(0);
    expect(income.pension).toBe(Math.round(66_000 * 0.9));
  });

  it('退職金は勤続年数/38年で按分、上限は満額、バイトは0', () => {
    const s = makeState({ job: 'sales' });
    s.character.jobYears = 19;
    expect(severancePay(s)).toBe(7_500_000);
    s.character.jobYears = 50;
    expect(severancePay(s)).toBe(15_000_000);
    const p = makeState({ job: 'parttime' });
    p.character.jobYears = 30;
    expect(severancePay(p)).toBe(0);
  });

  it('retire で退職金を受け取り、退職扱いになる', () => {
    const s = makeState({ job: 'office' });
    s.character.jobYears = 38;
    retire(s);
    expect(s.assets.cash).toBe(10_000_000);
    expect(s.character.retired).toBe(true);
  });
});

describe('転職・リストラ・失業給付', () => {
  it('転職で按分した退職金を受け取り、勤続年数と payMul をリセットする', () => {
    const s = makeState({ job: 'sales' });
    s.character.jobYears = 3.8;
    s.flags.payMul = 1.2;
    changeJob(s, 'office');
    expect(s.assets.cash).toBe(1_500_000);
    expect(s.character).toMatchObject({ job: 'office', jobYears: 0, previousJob: 'sales' });
    expect(s.flags.payMul).toBe(1);
  });

  it('リストラ(無職)で失業給付6ヶ月、額は直前の額面月給の60%(バイトも)', () => {
    const s = makeState({ job: 'parttime' });
    applyMonthlyMoney(s, flatRng);
    const lastPay = s.character.lastMonthlyPay;
    changeJob(s, 'none');
    expect(s.flags.unemploymentBenefit).toBe(6);
    expect(calcIncome(s).unemployment).toBe(Math.round(lastPay * 0.6));
    expect(calcIncome(s).salary).toBe(0);
  });

  it('再就職すると失業給付は打ち切り', () => {
    const s = makeState();
    changeJob(s, 'none');
    changeJob(s, 'engineer');
    expect(s.flags.unemploymentBenefit).toBe(0);
    expect(calcIncome(s).unemployment).toBe(0);
  });
});

describe('配偶者の収入', () => {
  it('共働き18万円、扶養内パート8万円+控除5千円、専業0+控除5千円', () => {
    const s = makeState();
    s.character.married = true;
    s.character.spouse = 'fulltime';
    expect(calcIncome(s).spouse).toBe(180_000);
    s.character.spouse = 'parttime';
    expect(calcIncome(s).spouse).toBe(85_000);
    s.character.spouse = 'homemaker';
    expect(calcIncome(s).spouse).toBe(5_000);
  });

  it('本人に給与がなければ配偶者控除はなし、65歳以降は配偶者の収入もなし', () => {
    const s = makeState();
    s.character.married = true;
    s.character.spouse = 'parttime';
    s.character.job = 'none';
    expect(calcIncome(s).spouse).toBe(80_000);
    setAge(s, 65);
    expect(calcIncome(s).spouse).toBe(0);
  });
});

describe('支出', () => {
  // 大卒エンジニア22歳・地方都市: 手取り 206,617円
  const net = Math.round((3_220_000 / 12) * 0.77);
  const share = defaultData.balance.living.incomeShare;

  it('生活費 = (固定分 + 自由に使える手取り × 割合 × 支出方針) × 地域 × 物価', () => {
    expect(calcExpenses(makeState()).living).toBe(Math.round(40_000 + share * net));
    expect(calcExpenses(makeState({}, { spending: 'lavish' })).living).toBe(Math.round(40_000 + share * net * 1.4));
    const metro = makeState({ region: 'metro' });
    expect(calcExpenses(metro).living).toBe(Math.round((40_000 + share * calcIncome(metro).total) * 1.15));
    const married = makeState();
    married.character.married = true;
    married.character.spouse = 'homemaker';
    expect(calcExpenses(married).living).toBe(Math.round(80_000 + share * (net + 5_000)));
    const inflated = makeState();
    inflated.flags.priceLevel = 1.05;
    expect(calcExpenses(inflated).living).toBe(Math.round((40_000 + share * net) * 1.05));
  });

  it('収入がなければ生活費は固定分だけ', () => {
    const s = makeState();
    s.character.job = 'none';
    expect(calcExpenses(s).living).toBe(40_000);
  });

  it('車の維持費・健康費・実家への送金・親への仕送りは別に払い、そのぶん生活費を抑える', () => {
    const s = makeState({ hasCar: true, familyTier: 1 }, { health: 'active' });
    s.flags.parentSupport = 10;
    const e = calcExpenses(s);
    expect(e).toMatchObject({ car: 25_000, health: 15_000, remittance: 20_000, parentSupport: 30_000 });
    expect(e.living).toBe(Math.round(40_000 + share * (net - 90_000)));
    expect(e.total).toBe(e.living + 90_000);
    s.flags.parentAlive = false;
    expect(calcExpenses(s).remittance).toBe(0);
    expect(calcExpenses(makeState({ hasCar: true, region: 'metro' })).car).toBe(40_000);
  });

  it('自己破産後のブラックリスト期間は支出方針に関係なく節約', () => {
    const s = makeState({}, { spending: 'lavish' });
    s.flags.blacklist = 10;
    expect(calcExpenses(s).living).toBe(Math.round(40_000 + share * net * 0.8));
  });

  it('生活保護中は支出方針に関係なく節約', () => {
    const s = makeState({}, { spending: 'lavish' });
    s.flags.welfare = true;
    expect(calcExpenses(s).living).toBe(Math.round(40_000 + share * net * 0.8));
  });
});

describe('奨学金', () => {
  function repayMonths(interestFree: boolean): { months: number; total: number } {
    const monthlyPayment = interestFree ? 12_500 : 13_797;
    const s = makeState({
      studentLoan: { amount: 3_000_000, interestFree, annualRate: interestFree ? 0 : 0.01, monthlyPayment },
    });
    let months = 0;
    let total = 0;
    while (s.assets.studentLoan > 0 && months < 400) {
      total += calcExpenses(s).studentLoan;
      applyMonthlyMoney(s, flatRng);
      months++;
    }
    return { months, total };
  }

  it('無利子は240回でちょうど完済', () => {
    expect(repayMonths(true)).toEqual({ months: 240, total: 3_000_000 });
  });

  it('有利子(年1%)は240回で完済し、利息は約31万円', () => {
    const { months, total } = repayMonths(false);
    expect(months).toBe(240);
    expect(total - 3_000_000).toBeGreaterThan(300_000);
    expect(total - 3_000_000).toBeLessThan(320_000);
  });
});

describe('月次の適用', () => {
  it('余剰はまず借金を返し、残りの50%を積み立てる', () => {
    const s = makeState({}, { invest: 'index' });
    s.assets.debt = 20_000;
    const { income, expenses } = applyMonthlyMoney(s, flatRng);
    const interest = Math.round((20_000 * 0.15) / 12);
    const surplus = income.total - expenses.total - (20_000 + interest);
    expect(s.assets.debt).toBe(0);
    expect(s.assets.index).toBe(Math.round(surplus * 0.5));
    const cash = surplus - Math.round(surplus * 0.5);
    expect(s.assets.cash).toBe(cash + Math.round((cash * 0.001) / 12)); // 預金金利の分
  });

  it('預金のみなら積み立てない', () => {
    const s = makeState();
    applyMonthlyMoney(s, flatRng);
    expect(s.assets.index + s.assets.stocks + s.assets.speculative).toBe(0);
    expect(s.assets.cash).toBeGreaterThan(0);
  });

  it('年金の加入月数と平均月収、勤続年数を更新する', () => {
    const s = makeState();
    applyMonthlyMoney(s, flatRng);
    applyMonthlyMoney(s, flatRng);
    expect(s.character.pensionMonths).toBe(2);
    expect(s.character.avgMonthlyPay).toBeCloseTo(3_220_000 / 12, 0);
    expect(s.character.jobYears).toBeCloseTo(2 / 12);
    const p = makeState({ job: 'parttime' });
    applyMonthlyMoney(p, flatRng);
    expect(p.character.pensionMonths).toBe(0);
  });

  /** 浪費で毎月赤字になる人(手取りはあるので生活保護にはならない) */
  function overspender() {
    return makeState({}, { spending: 'lavish' });
  }

  it('資金ショートは index → stocks → speculative の順に売り、足りなければ借金', () => {
    const s = overspender();
    const deficit = calcExpenses(s).total - calcIncome(s).total;
    expect(deficit).toBeGreaterThan(0);
    s.assets.index = 1_000;
    s.assets.stocks = 1_000_000;
    applyMonthlyMoney(s, flatRng);
    expect(s.assets).toMatchObject({ cash: 0, index: 0, stocks: 1_000_000 - (deficit - 1_000), debt: 0 });

    const t = overspender();
    t.assets.speculative = 1_000;
    applyMonthlyMoney(t, flatRng);
    expect(t.assets).toMatchObject({ cash: 0, speculative: 0, debt: deficit - 1_000 });
    expect(t.flags.welfare).toBe(false);
  });

  it('借入上限を超えたら自己破産: 借金0・信用0・ストレス+30・ログ。7年間は再び破産できない', () => {
    const s = overspender();
    const limit = debtLimit(s);
    expect(limit).toBe(2_000_000);
    s.assets.debt = 1_999_000;
    applyMonthlyMoney(s, flatRng);
    expect(s.assets.debt).toBe(0);
    expect(s.stats.credit).toBe(0);
    expect(s.stats.stress).toBe(50);
    expect(s.flags.bankrupt).toBe(true);
    expect(s.log.at(-1)).toMatchObject({ type: 'event', id: 'bankruptcy' });
    expect(s.flags.blacklist).toBe(84);
    s.assets.debt = 3_000_000;
    applyMonthlyMoney(s, flatRng);
    // ブラックリスト中は破産せず、強制的な節約で返していく
    expect(s.log.filter((e) => e.id === 'bankruptcy')).toHaveLength(1);
    expect(s.assets.debt).toBeGreaterThan(0);
    expect(s.assets.debt).toBeLessThan(3_000_000);
    s.flags.blacklist = 0;
    applyMonthlyMoney(s, flatRng);
    expect(s.log.filter((e) => e.id === 'bankruptcy')).toHaveLength(2);
  });

  it('借入上限は額面年収の半分(最低200万円)', () => {
    const s = setAge(makeState(), 50);
    expect(debtLimit(s)).toBe(Math.round(6_900_000 * 0.5));
  });

  it('節約しても暮らせない(収入が最低限の生活費に届かない)ときは生活保護。借金にしない', () => {
    const s = makeState();
    s.character.job = 'none';
    applyMonthlyMoney(s, flatRng);
    expect(s.assets).toMatchObject({ cash: 0, debt: 0 });
    expect(s.flags.welfare).toBe(true);
    s.character.job = 'engineer';
    applyMonthlyMoney(s, flatRng);
    expect(s.flags.welfare).toBe(false);
  });
});

describe('運用リターン', () => {
  it('同じ乱数なら同じ結果になり、保有額によらず乱数の消費は同じ', () => {
    const a = makeState();
    const b = makeState();
    a.assets.index = 1_000_000;
    a.assets.speculative = 500_000;
    const ra = createRng(7);
    const rb = createRng(7);
    applyReturns(a, ra);
    applyReturns(b, rb);
    expect(ra.state).toBe(rb.state);
    const c = makeState();
    c.assets.index = 1_000_000;
    c.assets.speculative = 500_000;
    applyReturns(c, createRng(7));
    expect(c.assets).toEqual(a.assets);
  });

  it('インデックスの年リターンはおおむね期待値5%', () => {
    const s = makeState();
    const rng = createRng(1);
    let logSum = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) {
      s.assets.index = 100_000_000;
      applyReturns(s, rng);
      logSum += s.assets.index / 100_000_000 - 1;
    }
    expect((logSum / n) * 12).toBeCloseTo(0.05, 1);
  });

  it('預金には年0.1%の金利がつく', () => {
    const s = makeState();
    s.assets.cash = 12_000_000;
    applyReturns(s, flatRng);
    expect(s.assets.cash).toBe(12_001_000);
  });
});
