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
  it('開始時は初年度年収、50歳でピーク、55歳までは横ばい、そこから役職定年で年2%ずつ下がる', () => {
    expect(annualGross(setAge(makeState(), 22))).toBe(3_220_000);
    expect(annualGross(setAge(makeState(), 36))).toBe(4_600_000);
    expect(annualGross(setAge(makeState(), 50))).toBe(5_980_000);
    expect(annualGross(setAge(makeState(), 55))).toBe(5_980_000);
    expect(annualGross(setAge(makeState(), 60))).toBe(Math.round(5_980_000 * 0.9));
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

  it('給与の手取り = 額面月給 × 手取り率(月給 = 年収 ÷ (12 + ボーナスの月数))', () => {
    expect(calcIncome(makeState()).salary).toBe(Math.round(Math.round(3_220_000 / 16) * 0.77));
    expect(calcIncome(makeState({ job: 'parttime', education: 'university' })).bonus).toBe(0);
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
  // 大卒エンジニア22歳・地方都市・4月(ボーナスなしの月): 月給 = 年収/16、手取り 154,963円
  const net = Math.round(Math.round(3_220_000 / 16) * 0.77);
  const { incomeShare: share, single: floor, married: marriedFloor } = defaultData.balance.living;
  /** 生活費 = (最低限×地域係数 + (自由に使える手取り − 最低限×地域係数) × 割合 × 支出係数) × 物価 */
  const living = (disposable: number, mul = 1, opts: { region?: number; price?: number; base?: number } = {}) => {
    const base = opts.base ?? floor;
    const floorR = base * (opts.region ?? 1);
    return Math.round((floorR + share * Math.max(0, disposable - floorR) * mul) * (opts.price ?? 1));
  };

  it('生活費 = 最低限の生活費 + 残りの手取り × 割合 × 支出方針(地域係数は最低限の分だけ、物価は全体)', () => {
    expect(calcExpenses(makeState()).living).toBe(living(net));
    expect(calcExpenses(makeState({}, { spending: 'lavish' })).living).toBe(living(net, 1.12));
    const metro = makeState({ region: 'metro' });
    expect(calcExpenses(metro).living).toBe(living(calcIncome(metro).total, 1, { region: 1.15 }));
    const married = makeState();
    married.character.married = true;
    married.character.spouse = 'homemaker';
    expect(calcExpenses(married).living).toBe(living(net + 5_000, 1, { base: marriedFloor }));
    const inflated = makeState();
    inflated.flags.priceLevel = 1.05;
    expect(calcExpenses(inflated).living).toBe(living(net, 1, { price: 1.05 }));
  });

  it('普通の支出なら、月々の生活費は手取りを超えない(最低限の生活費を払えるかぎり)', () => {
    for (const job of ['parttime', 'factory', 'engineer'] as const) {
      for (const region of ['metro', 'city', 'rural'] as const) {
        const s = makeState({ job, region, education: 'high' });
        expect(calcExpenses(s).total).toBeLessThanOrEqual(calcIncome(s).total);
      }
    }
  });

  it('収入がなければ生活費は最低限の分だけ', () => {
    const s = makeState();
    s.character.job = 'none';
    expect(calcExpenses(s).living).toBe(floor);
  });

  it('車の維持費・健康費・実家への送金・親への仕送りは別に払い、そのぶん生活費を抑える', () => {
    const s = makeState({ hasCar: true, familyTier: 1 }, { health: 'active' });
    s.flags.parentSupport = 10;
    const e = calcExpenses(s);
    expect(e).toMatchObject({ car: 25_000, health: 15_000, remittance: 20_000, parentSupport: 30_000 });
    expect(e.living).toBe(living(net - 90_000));
    expect(e.total).toBe(e.living + 90_000);
    s.flags.parentAlive = false;
    expect(calcExpenses(s).remittance).toBe(0);
    expect(calcExpenses(makeState({ hasCar: true, region: 'metro' })).car).toBe(40_000);
  });

  it('ボーナス月はボーナスの一部を使い、残りは貯まる', () => {
    const s = makeState();
    s.month = 2; // 6月
    const inc = calcIncome(s);
    expect(inc.bonus).toBe(Math.round(Math.round(3_220_000 / 16) * 2 * 0.77));
    const spendShare = defaultData.balance.living.bonusSpendShare;
    expect(calcExpenses(s).living - (living(net) + spendShare * inc.bonus)).toBeLessThanOrEqual(1); // 円の丸め
  });

  it('自己破産後のブラックリスト期間は支出方針に関係なく節約', () => {
    const s = makeState({}, { spending: 'lavish' });
    s.flags.blacklist = 10;
    expect(calcExpenses(s).living).toBe(living(net, 0.8));
  });

  it('生活保護中は支出方針に関係なく節約', () => {
    const s = makeState({}, { spending: 'lavish' });
    s.flags.welfare = true;
    expect(calcExpenses(s).living).toBe(living(net, 0.8));
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
    s.assets.debt = 5_000;
    const { income, expenses } = applyMonthlyMoney(s, flatRng);
    const interest = Math.round((5_000 * 0.15) / 12);
    const surplus = income.total - expenses.total - (5_000 + interest);
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

  /** 浪費と物価高(1.1倍)で毎月赤字になる人(手取りはあるので生活保護にはならない) */
  function overspender() {
    const s = makeState({}, { spending: 'lavish' });
    s.flags.priceLevel = 1.1;
    return s;
  }

  it('資金ショートは index → stocks → speculative の順に売り、足りなければ借金', () => {
    const s = overspender();
    const deficit = calcExpenses(s).total - calcIncome(s).total;
    expect(deficit).toBeGreaterThan(0);
    s.assets.index = 1_000;
    s.assets.stocks = 1_000_000;
    s.invested = { index: 1_000, stocks: 1_000_000, speculative: 0 }; // 損益なし(税金がかからない)
    applyMonthlyMoney(s, flatRng);
    expect(s.assets).toMatchObject({ cash: 0, index: 0, stocks: 1_000_000 - (deficit - 1_000), debt: 0 });

    const t = overspender();
    t.assets.speculative = 1_000;
    t.invested = { index: 0, stocks: 0, speculative: 1_000 };
    applyMonthlyMoney(t, flatRng);
    expect(t.assets).toMatchObject({ cash: 0, speculative: 0, debt: deficit - 1_000 });
    expect(t.flags.welfare).toBe(false);
  });

  it('借入上限を超えた状態が6ヶ月続いたら自己破産: 借金0・信用0・ストレス+30・ログ。7年間は再び破産できない', () => {
    const s = overspender();
    const limit = debtLimit(s);
    expect(limit).toBe(2_000_000);
    s.assets.debt = 1_999_000;
    for (let i = 0; i < 5; i++) applyMonthlyMoney(s, flatRng);
    expect(s.log.filter((e) => e.id === 'debt_warning')).toHaveLength(1); // 超えた月に1回だけ警告
    expect(s.flags.bankrupt).toBeFalsy();
    s.stats.stress = 20;
    applyMonthlyMoney(s, flatRng);
    expect(s.assets.debt).toBe(0);
    expect(s.stats.credit).toBe(0);
    expect(s.stats.stress).toBe(50);
    expect(s.flags.bankrupt).toBe(true);
    expect(s.log.at(-1)).toMatchObject({ type: 'event', id: 'bankruptcy' });
    expect(s.flags.blacklist).toBe(84);
    s.assets.debt = 3_000_000;
    applyMonthlyMoney(s, flatRng);
    // ブラックリスト中は上限を超えても破産しない(延滞として残る)
    expect(s.log.filter((e) => e.id === 'bankruptcy')).toHaveLength(1);
    expect(s.assets.debt).toBeGreaterThan(debtLimit(s));
    s.flags.blacklist = 0;
    for (let i = 0; i < 6; i++) applyMonthlyMoney(s, flatRng);
    expect(s.log.filter((e) => e.id === 'bankruptcy')).toHaveLength(2);
  });

  it('猶予の間に上限より下まで減らせば破産しない', () => {
    const s = overspender();
    s.assets.debt = 2_100_000;
    applyMonthlyMoney(s, flatRng);
    expect(s.flags.overLimit).toBe(1);
    s.assets.debt = 1_000_000;
    applyMonthlyMoney(s, flatRng);
    expect(s.flags.overLimit).toBe(0);
    expect(s.flags.bankrupt).toBeFalsy();
  });

  it('借入上限は額面年収の半分(最低200万円)', () => {
    const s = setAge(makeState(), 50);
    expect(debtLimit(s)).toBe(Math.round(5_980_000 * 0.5));
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

describe('元本(運用成績の表示用)', () => {
  it('積立で元本が増え、値動きでは変わらない', () => {
    const s = makeState({}, { invest: 'index' });
    applyMonthlyMoney(s, flatRng);
    expect(s.invested!.index).toBe(s.assets.index);
    expect(s.invested!.index).toBeGreaterThan(0);
    const principal = s.invested!.index;
    applyReturns(s, createRng(3));
    expect(s.invested!.index).toBe(principal);
  });

  it('資金ショートで売ると、売った割合だけ元本も減る。特定口座の利益には税金がかかるので、そのぶん多めに売る', () => {
    const s = makeState({}, { spending: 'lavish' });
    s.flags.priceLevel = 1.1; // 赤字にする
    s.assets.stocks = 1_000_000;
    s.invested!.stocks = 800_000;
    const deficit = calcExpenses(s).total - calcIncome(s).total;
    applyMonthlyMoney(s, flatRng);
    const gross = Math.ceil(deficit / (1 - 0.20315 * 0.2)); // 利益は時価の2割
    expect(s.assets.stocks).toBe(1_000_000 - gross);
    expect(s.invested!.stocks).toBe(800_000 - Math.round((800_000 * gross) / 1_000_000));
    expect(s.assets.cash).toBeGreaterThanOrEqual(0);
    expect(s.assets.cash).toBeLessThan(5);
    expect(s.ledger!.investTax ?? 0).toBe(0); // ledger への記録は stepMonth の recordMonth で行う
  });
});
