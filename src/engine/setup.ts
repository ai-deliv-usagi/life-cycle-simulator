// 初期ガチャとキャラ生成(SPEC.md「初期値データ」、DESIGN.md §3・§5.2.1・§5.7・§8)
import { defaultData } from '../data/index';
import { createRng, deriveSeed, type Rng } from './rng';
import type { CharacterRoll, Flags, GameData, GameState, Policy, Values } from './types';
import { annuityPayment, clampStat, clampValue } from './util';

function gaussianStat(rng: Rng, mean: number, sd: number): number {
  return clampStat(Math.round(rng.normal(mean, sd)));
}

/**
 * 初期ガチャ。同じ seed なら同じ結果。「引き直し」は seed を変えて呼ぶ。
 * 抽選の順番を変えると過去のシードの結果が変わるので、足すときは末尾に足す。
 */
export function rollCharacter(seed: number, data: GameData = defaultData): CharacterRoll {
  const rng = createRng(deriveSeed(seed, 'gacha'));
  const { balance } = data;

  const education = rng.weighted(data.education.map((e) => ({ item: e, weight: e.prob })));
  const job = rng.pick(data.jobs); // 職業は学歴に関係なく等確率
  const family = rng.weighted(data.family.map((f) => ({ item: f, weight: f.prob })));
  const region = rng.weighted(data.regions.map((r) => ({ item: r, weight: r.prob })));
  const hasCar = rng.chance(region.carProb);
  const constitution = gaussianStat(rng, balance.gacha.constitution.mean, balance.gacha.constitution.sd);
  const luck = gaussianStat(rng, balance.gacha.luck.mean, balance.gacha.luck.sd);

  let studentLoan: CharacterRoll['studentLoan'] = null;
  if (education.loan && rng.chance(education.loan.prob)) {
    const interestFree = rng.chance(balance.studentLoan.interestFreeProb);
    const annualRate = interestFree ? 0 : balance.studentLoan.annualRate;
    const amount = education.loan.amount;
    studentLoan = {
      amount,
      interestFree,
      annualRate,
      monthlyPayment: annuityPayment(amount, annualRate, balance.studentLoan.months),
    };
  }

  return {
    seed,
    education: education.id,
    job: job.id,
    familyTier: family.tier,
    region: region.id,
    hasCar,
    constitution,
    luck,
    initialCash: family.initialCash,
    studentLoan,
  };
}

/** ガチャ結果と、プレイヤーが決めた価値観・方針・名前からゲームを始める */
export function createGame(
  roll: CharacterRoll,
  values: Values,
  policy: Policy,
  name: string,
  data: GameData = defaultData,
): GameState {
  const { balance } = data;
  const education = data.education.find((e) => e.id === roll.education);
  if (!education) throw new Error(`unknown education: ${roll.education}`);

  // 予約フラグの初期値(DESIGN.md §3)
  const flags: Flags = {
    partner: false,
    parentAlive: true,
    parentIll: false,
    payMul: 1,
    priceLevel: 1,
    recession: 0,
    parentSupport: 0,
    unemploymentBenefit: 0,
    hasCar: roll.hasCar,
    welfare: false,
    bankrupt: false,
  };

  const loan = roll.studentLoan;

  return {
    seed: roll.seed,
    rngState: deriveSeed(roll.seed, 'life'), // ガチャと乱数列を分ける
    startAge: education.startAge,
    eventHistory: {},
    month: 0,
    ageMonths: education.startAge * 12,
    character: {
      name,
      education: roll.education,
      job: roll.job,
      jobYears: 0,
      familyTier: roll.familyTier,
      constitution: roll.constitution,
      luck: roll.luck,
      married: false,
      retired: false,
      pensionMonths: 0,
      avgMonthlyPay: 0,
      studentLoan: loan
        ? { interestFree: loan.interestFree, annualRate: loan.annualRate, monthlyPayment: loan.monthlyPayment }
        : null,
      lastMonthlyPay: 0,
      region: roll.region,
      spouse: null,
    },
    values: {
      risk: clampValue(values.risk),
      relation: clampValue(values.relation),
      spending: clampValue(values.spending),
      work: clampValue(values.work),
    },
    policy: { ...policy },
    stats: {
      health: roll.constitution,
      stress: balance.startStats.stress,
      skill: balance.startStats.skill,
      credit: balance.startStats.credit,
      relations: balance.startStats.relations,
    },
    assets: {
      cash: roll.initialCash,
      index: 0,
      stocks: 0,
      speculative: 0,
      debt: 0,
      studentLoan: loan?.amount ?? 0,
    },
    // 慣れの初期値は開始時の生活の中身(実質額。地域差・健康費・送金を除く。DESIGN.md §5.4)
    adaptedSpending: Math.round(balance.living.single * balance.spending[policy.spending].living),
    achievement: 0,
    happinessHistory: [],
    flags,
    log: [],
  };
}
