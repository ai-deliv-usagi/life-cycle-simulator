// イベントの条件判定・確率・抽選・効果適用(SPEC.md「イベント」、DESIGN.md §7)
// stepMonth / resolveChoice が複製した state を直接更新する。
import { defaultData } from '../data/index';
import { addChild, afterGivingBirth, childAgeMonths, childrenOf } from './children';
import { baseAnnualMortality, genderFactor } from './death';
import { scaleNisaPrincipal } from './nisa';
import { businessValue, hasBusiness, startBusiness } from './business';
import { buyHome, homePrice, mortgageRejection, ownsHome } from './housing';
import { recordEventCash, recordInvestTax } from './ledger';
import { annualGross, changeEmployer, changeJob, coverWithInvestments, coverWithLoan, loanRejection, retire, isEmployed, monthlyGrossPay, takeLoan } from './money';
import type { Rng } from './rng';
import type {
  Choice,
  CostSpread,
  Effects,
  LuxuryItem,
  EventConditions,
  EventDef,
  Flags,
  GameData,
  GameState,
  JobId,
  ProbMod,
  SpouseType,
  Stats,
  Values,
} from './types';
import { addLog, ageYears, clamp, clampStat, clampValue, financialAssets, findById, netWorth, roundYen } from './util';

// ---- フラグ(married は character.married に読み替える) ----

function getFlag(state: GameState, key: string): boolean | number | undefined {
  if (key === 'married') return state.character.married;
  return state.flags[key];
}

function setMarried(state: GameState, married: boolean, rng: Rng, data: GameData): void {
  const c = state.character;
  if (married && !c.married) {
    const types = data.balance.spouse.types;
    const byGender = c.gender ? data.balance.spouse.probByGender[c.gender] : undefined;
    c.spouse = rng.weighted(
      (Object.keys(types) as SpouseType[]).map((t) => ({ item: t, weight: byGender ? byGender[t] : types[t].prob })),
    );
    // 配偶者の職業・学歴・稼ぎの個人差を裏で引く(職業は初期ガチャと同じく等確率。共働きは会社員の仕事から)
    const s = data.balance.spouse;
    const jobs = data.jobs.filter((j) => j.id !== 'parttime');
    c.spouseProfile = {
      job: c.spouse === 'parttime' ? 'parttime' : rng.pick(jobs).id,
      education: rng.weighted(data.education.map((e) => ({ item: e.id, weight: e.prob }))),
      payMul: clamp(rng.normal(s.payMulMean, s.payMulSd), s.payMulMin, s.payMulMax),
    };
    state.flags.marriedSince = state.month;
  }
  if (!married) {
    c.spouse = null;
    delete c.spouseProfile;
  }
  c.married = married;
}

// ---- 条件 ----

function inRange(x: number, above?: number, below?: number): boolean {
  return (above === undefined || x > above) && (below === undefined || x < below);
}

export function conditionsMet(cond: EventConditions | undefined, state: GameState): boolean {
  if (!cond) return true;
  const age = ageYears(state);
  if (cond.ageMin !== undefined && age < cond.ageMin) return false;
  if (cond.ageMax !== undefined && age >= cond.ageMax + 1) return false; // ageMax 歳のうちは対象
  if (cond.ageWindows && !cond.ageWindows.some(([min, max]) => age >= min && age < max + 1)) return false;
  for (const [key, value] of Object.entries(cond.flags ?? {})) {
    const v = getFlag(state, key);
    // 未設定の真偽フラグは false、数値フラグは 0 とみなす
    const actual = v ?? (typeof value === 'boolean' ? false : 0);
    if (actual !== value) return false;
  }
  if (cond.employed !== undefined && isEmployed(state) !== cond.employed) return false;
  if (cond.retired !== undefined && state.character.retired !== cond.retired) return false;
  if (cond.minInvested !== undefined) {
    const a = state.assets;
    if (a.index + a.stocks + a.speculative < cond.minInvested) return false;
  }
  if (cond.minFinancial !== undefined && financialAssets(state.assets) < cond.minFinancial) return false;
  if (cond.maxFinancial !== undefined && financialAssets(state.assets) >= cond.maxFinancial) return false;
  if (cond.anniversary) {
    const since = state.flags.marriedSince;
    const months = typeof since === 'number' ? state.month - since : 0;
    if (!state.character.married || months < 12 || months % 12 !== 0) return false;
  }
  if (cond.region && !cond.region.includes(state.character.region)) return false;
  if (cond.jobNotIn?.includes(state.character.job)) return false;
  if (cond.jobIn && !cond.jobIn.includes(state.character.job)) return false;
  const c = state.character;
  if (cond.gender && c.gender !== cond.gender) return false;
  if (cond.hasHome !== undefined && ownsHome(state) !== cond.hasHome) return false;
  if (cond.homeYears !== undefined && (!state.home || state.month - state.home.boughtMonth < cond.homeYears * 12)) return false;
  if (cond.hasBusiness !== undefined && hasBusiness(state) !== cond.hasBusiness) return false;
  if (cond.minBusinessLevel !== undefined && (state.business?.level ?? 0) < cond.minBusinessLevel) return false;
  if (cond.spouseType && !(c.married && c.spouse && cond.spouseType.includes(c.spouse))) return false;
  if (cond.childrenBelow !== undefined && childrenOf(state).length >= cond.childrenBelow) return false;
  if (cond.childAge) {
    const [min, max] = cond.childAge;
    if (!childrenOf(state).some((ch) => inRange(childAgeMonths(state, ch) / 12, min - 1e-9, max + 1))) return false;
  }
  return true;
}

function modApplies(mod: ProbMod, state: GameState): boolean {
  if ('stat' in mod) return inRange(state.stats[mod.stat], mod.above, mod.below);
  if ('value' in mod) return inRange(state.values[mod.value], mod.above, mod.below);
  if ('flag' in mod) {
    const v = getFlag(state, mod.flag);
    if (mod.equals !== undefined) return (v ?? false) === mod.equals;
    return typeof v === 'number' && inRange(v, mod.above, mod.below);
  }
  if ('age' in mod) return inRange(ageYears(state), mod.above, mod.below);
  if ('work' in mod) return isEmployed(state) && mod.work.includes(state.policy.work);
  if ('healthCare' in mod) return mod.healthCare.includes(state.policy.health);
  if ('spending' in mod) return mod.spending.includes(state.policy.spending);
  if ('financial' in mod) return inRange(financialAssets(state.assets), mod.above, mod.below);
  if ('children' in mod) return inRange(childrenOf(state).length, mod.above, mod.below);
  if ('partnerYears' in mod) {
    const since = state.flags.partnerSince;
    return state.flags.partner === true && typeof since === 'number' && inRange((state.month - since) / 12, mod.above, mod.below);
  }
  return mod.region.includes(state.character.region);
}

/** 起きうるか(条件・once・クールダウン) */
export function isEligible(ev: EventDef, state: GameState): boolean {
  const hist = state.eventHistory[ev.id];
  if (hist) {
    if (ev.once && hist.count > 0) return false;
    if (ev.cooldownMonths !== undefined && state.month - hist.lastMonth < ev.cooldownMonths) return false;
  }
  return conditionsMet(ev.conditions, state);
}

/** その月に起きる確率 = 基本確率 × probMods × 運補正 */
export function eventProb(ev: EventDef, state: GameState, data: GameData = defaultData): number {
  let p = ev.baseProb;
  if (ev.probFrom === 'layoffRate') {
    const job = state.character.job;
    p = job === 'none' || job === 'owner' ? 0 : findById(data.jobs, job, 'job').layoffRate;
  }
  if (ev.probFrom === 'spouseMortality') {
    // 配偶者は本人と同い年の異性とみなす(性別のない古いセーブは男女の平均)
    const g = state.character.gender;
    const spouseGender = g === 'male' ? 'female' : g === 'female' ? 'male' : undefined;
    p = (baseAnnualMortality(ageYears(state), data) / 12) * genderFactor(spouseGender, data);
  }
  for (const mod of ev.probMods ?? []) if (modApplies(mod, state)) p *= mod.mul;
  const e = data.balance.events;
  const luck = state.character.luck / 100;
  if (ev.good === true) p *= e.luckGoodBase + e.luckGoodScale * luck;
  if (ev.good === false) p *= e.luckBadBase + e.luckBadScale * luck;
  return clamp(p, 0, 1);
}

/**
 * 今月のイベントを抽選する。起きうるイベントをそれぞれ独立に判定し、
 * 当たったものが複数なら確率で重み付けして1件選ぶ。何も起きなければ null。
 */
export function drawEvent(state: GameState, rng: Rng, data: GameData = defaultData): EventDef | null {
  const hits: { item: EventDef; weight: number }[] = [];
  for (const ev of data.events) {
    if (!isEligible(ev, state)) continue;
    const p = eventProb(ev, state, data);
    if (rng.chance(p)) hits.push({ item: ev, weight: p });
  }
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0]!.item;
  // 確率1のイベント(出産・再雇用の話など)は、ほかのイベントに埋もれないよう先に起こす
  const forced = hits.filter((h) => h.weight >= 1);
  if (forced.length > 0) return rng.weighted(forced);
  return rng.weighted(hits);
}

/** 高級品の値段。金融資産が多いほど、支出の方針がゆとり・浪費ほど高いものを選ぶ */
export function luxuryPrice(item: LuxuryItem, state: GameState, data: GameData = defaultData): number {
  const cfg = data.balance.luxury;
  const c = cfg[item];
  const want = Math.max(0, financialAssets(state.assets)) * c.share * data.balance.events.spendingCostMul[state.policy.spending];
  return Math.round(clamp(want, c.min, c.max) / cfg.priceStep) * cfg.priceStep;
}

/** 高級品(luxury)を、現金・ローン・リボの出費に置き換える */
function resolveLuxury(effects: Effects, state: GameState, data: GameData): Effects {
  if (!effects.luxury) return effects;
  const { item, pay } = effects.luxury;
  const price = luxuryPrice(item, state, data);
  const rest: Effects = { ...effects };
  delete rest.luxury;
  if (pay === 'loan') return { ...rest, loan: { amount: price, months: data.balance.luxury[item].loanMonths } };
  if (pay === 'revolving') return { ...rest, debt: (rest.debt ?? 0) + price };
  return { ...rest, cash: (rest.cash ?? 0) - price };
}

/** 高級品の値段を決め、scaleBySpending のイベントは出費(cash・debt)を支出の方針で増減する */
function scaled(ev: EventDef, raw: Effects, state: GameState, data: GameData): Effects {
  const effects = resolveLuxury(raw, state, data);
  if (!ev.scaleBySpending) return effects;
  const mul = data.balance.events.spendingCostMul[state.policy.spending];
  return {
    ...effects,
    ...(effects.cash !== undefined && effects.cash < 0 ? { cash: roundYen(effects.cash * mul) } : {}),
    ...(effects.debt !== undefined && effects.debt > 0 ? { debt: roundYen(effects.debt * mul) } : {}),
  };
}

// ---- 金額の揺れ ----

/** イベントの金額の揺れ方。ラベルや本文に金額が書いてあるもの(「50万円貸して」など)は揺らさない */
export function costSpread(ev: EventDef, data: GameData = defaultData, label = ''): CostSpread {
  if (ev.text.includes('円') || label.includes('円')) return 'none';
  return ev.spread ?? data.balance.events.spreadByCategory[ev.category];
}

function hasMoney(e: Effects): boolean {
  return (e.cash ?? 0) !== 0 || (e.debt ?? 0) !== 0 || e.loan !== undefined || e.assetShock !== undefined;
}

/** 今回の金額の倍率を引く。お金の動かない効果では乱数を使わない */
function drawSpread(ev: EventDef, effects: Effects[], rng: Rng, data: GameData, label = ''): number {
  const s = data.balance.events.spread[costSpread(ev, data, label)];
  if (s.sigma === 0 || !effects.some(hasMoney)) return 1;
  return clamp(Math.exp(rng.normal(-(s.sigma ** 2) / 2, s.sigma)), s.min, s.max);
}

/** 80%の場合に収まる倍率の幅(選択肢の目安に出す) */
export function spreadRange(ev: EventDef, data: GameData = defaultData, label = ''): [number, number] | null {
  const s = data.balance.events.spread[costSpread(ev, data, label)];
  if (s.sigma === 0) return null;
  const mu = -(s.sigma ** 2) / 2;
  const z = 1.2816; // 正規分布の上下10%点
  return [clamp(Math.exp(mu - z * s.sigma), s.min, s.max), clamp(Math.exp(mu + z * s.sigma), s.min, s.max)];
}

/** 金額(cash・リボ・ローン・資産の増減)に倍率を掛ける。円は千円単位、ローンは万円単位に丸める */
function applySpread(e: Effects, k: number): Effects {
  if (k === 1) return e;
  const yen = (x: number) => Math.round((x * k) / 1000) * 1000;
  return {
    ...e,
    ...(e.cash ? { cash: yen(e.cash) } : {}),
    ...(e.debt ? { debt: yen(e.debt) } : {}),
    ...(e.loan ? { loan: { ...e.loan, amount: Math.round((e.loan.amount * k) / 10_000) * 10_000 } } : {}),
    ...(e.assetShock ? { assetShock: { ...e.assetShock, pct: Math.max(-0.9, e.assetShock.pct * k) } } : {}),
  };
}

/** 高額療養費: 収入が少ない人・引退後は、医療の出来事の自己負担に上限がある */
function capMedical(ev: EventDef, e: Effects, state: GameState, data: GameData): Effects {
  const cap = data.balance.medicalCap;
  if (!ev.medical || e.cash === undefined || e.cash >= -cap.perEvent) return e;
  if (!state.character.retired && annualGross(state, data) >= cap.incomeBelow) return e;
  return { ...e, cash: -cap.perEvent };
}

export interface ChoiceCost {
  spend: number; // 今払うお金の目安(円)。確率で決まる結果(outcomes)は含めない
  borrow: number; // ローン・リボなどで借りる額
  range?: [number, number]; // 金額が揺れるとき、spend・borrow に掛ける倍率の幅(80%の場合)
  borrowRate?: number; // 借りる額の年利(借りないときはなし)
  homePrice?: number; // 家を買う選択肢なら、買う家の値段
}

/** 選択肢を選ぶといくら出ていくかの目安(UIの表示用。支出の方針による増減も含める) */
export function choiceCost(ev: EventDef, choice: Choice, state: GameState, data: GameData = defaultData): ChoiceCost {
  const raw = scaled(ev, choice.effects ?? {}, state, data);
  const e = capMedical(ev, raw, state, data);
  const capped = e !== raw;
  let spend = Math.max(0, -(e.cash ?? 0));
  if (e.cashMonthsOfPay && e.cashMonthsOfPay < 0) spend += roundYen(-monthlyGrossPay(state, data) * e.cashMonthsOfPay);
  if (e.startBusiness) spend += data.balance.business.capital[e.startBusiness];
  let borrow = (e.loan?.amount ?? 0) + (e.debt ?? 0);
  // リボ(カードローン)のほうが金利が高いので、混ざるときはそちらを出す
  const borrowRate = e.debt ? data.balance.debtAnnualRate : e.loan ? data.balance.loan.annualRate : undefined;
  const range = !capped && (spend > 0 || borrow > 0) ? spreadRange(ev, data, choice.label) : null;
  if (e.buyHome === undefined) {
    return { spend, borrow, ...(borrowRate !== undefined ? { borrowRate } : {}), ...(range ? { range } : {}) };
  }
  const price = homePrice(state, annualGross(state, data), data);
  spend += roundYen(price * (e.buyHome + data.balance.housing.closingCost));
  borrow += roundYen(price * (1 - e.buyHome));
  return { spend, borrow, borrowRate: data.balance.housing.mortgage.annualRate, homePrice: price };
}

/** イベントを起こす。選択肢があれば pendingEvent をセットして止まる */
export function fireEvent(state: GameState, ev: EventDef, rng: Rng, data: GameData = defaultData): void {
  const hist = state.eventHistory[ev.id] ?? { count: 0, lastMonth: 0 };
  state.eventHistory[ev.id] = { count: hist.count + 1, lastMonth: state.month };
  if (availableChoices(ev, state).length > 0) {
    state.pendingEvent = { eventId: ev.id, month: state.month };
    addLog(state, 'event', `${ev.title}: ${ev.text}`, ev.id);
    return;
  }
  const before = netWorth(state.assets);
  if (ev.effects) {
    const e = scaled(ev, ev.effects, state, data);
    applyEffects(state, capMedical(ev, applySpread(e, drawSpread(ev, [e], rng, data)), state, data), rng, data);
  }
  addLog(state, 'event', `${ev.title}: ${ev.text}`, ev.id);
  withMoney(state, netWorth(state.assets) - before);
}

/** いま足したログに、純資産の増減を付ける(0なら付けない) */
function withMoney(state: GameState, money: number): void {
  if (money !== 0) state.log.at(-1)!.money = roundYen(money);
}

/** 表示する選択肢(条件を満たすもの)。index は events.json での位置 */
export function availableChoices(
  ev: EventDef,
  state: GameState,
  data: GameData = defaultData,
): { choice: Choice; index: number; blocked?: string }[] {
  return (ev.choices ?? []).flatMap((choice, index) => {
    if (!conditionsMet(choice.conditions, state)) return [];
    const blocked = loanBlock(ev, choice, state, data);
    return [blocked ? { choice, index, blocked } : { choice, index }];
  });
}

/** 選べる選択肢(審査に通らないローンの選択肢を除く) */
export function selectableChoices(ev: EventDef, state: GameState, data: GameData = defaultData): { choice: Choice; index: number }[] {
  return availableChoices(ev, state, data).filter((c) => !c.blocked);
}

/** ローン・住宅ローンを組む選択肢が審査に通らないなら、その理由(選択肢は押せない) */
function loanBlock(ev: EventDef, choice: Choice, state: GameState, data: GameData): string | null {
  const e = scaled(ev, choice.effects ?? {}, state, data);
  let reason: string | null = null;
  if (e.loan) reason = loanRejection(state, e.loan.amount, e.loan.months, data);
  if (!reason && e.buyHome !== undefined && !ownsHome(state)) {
    const gross = annualGross(state, data);
    reason = mortgageRejection(state, roundYen(homePrice(state, gross, data) * (1 - e.buyHome)), gross, data);
  }
  return reason ? `審査に通らない(${reason})` : null;
}

/** 選択肢を適用する(resolveChoice から呼ぶ) */
export function applyChoice(
  state: GameState,
  ev: EventDef,
  choiceIndex: number,
  rng: Rng,
  data: GameData = defaultData,
): void {
  const entry = selectableChoices(ev, state, data).find((c) => c.index === choiceIndex);
  if (!entry) throw new Error(`choice ${choiceIndex} is not available for ${ev.id}`);
  const { choice } = entry;
  const worthBefore = netWorth(state.assets); // 使った・得た額はログの money に残す
  // 金額の倍率は選択肢と結果で共通に1回だけ引く
  const effects = scaled(ev, choice.effects ?? {}, state, data);
  const k = drawSpread(ev, [effects, ...(choice.outcomes ?? []).map((o) => o.effects)], rng, data, choice.label);
  if (choice.effects) applyEffects(state, capMedical(ev, applySpread(effects, k), state, data), rng, data);
  let text = `${ev.title}: 「${choice.label}」`;
  if (choice.outcomes && choice.outcomes.length > 0) {
    const outcome = rng.weighted(choice.outcomes.map((o) => ({ item: o, weight: o.prob })));
    applyEffects(state, capMedical(ev, applySpread(scaled(ev, outcome.effects, state, data), k), state, data), rng, data);
    text += ` → ${outcome.text}`;
  }
  const step = data.balance.events.valueShiftStep;
  for (const [axis, shift] of Object.entries(choice.valueShift ?? {}) as [keyof Values, number][]) {
    state.values[axis] = clampValue(state.values[axis] + Math.sign(shift) * step);
  }
  addLog(state, 'choice', text, ev.id);
  withMoney(state, netWorth(state.assets) - worthBefore);
}

function pickJob(state: GameState, target: NonNullable<Effects['job']>, rng: Rng, data: GameData): JobId {
  if (target === 'previous') return state.character.previousJob ?? rng.pick(data.jobs).id;
  if (target === 'random_other') return rng.pick(data.jobs.filter((j) => j.id !== state.character.job)).id;
  if (target === 'other_industry') {
    return rng.pick(data.jobs.filter((j) => j.id !== state.character.job && j.id !== 'parttime')).id;
  }
  return target;
}

/**
 * 効果を適用する。順番: お金 → 職業 → ステータス → フラグ → 地域。
 * 職業の変更は payMul を1に戻すので、転職後の payMul はフラグで上書きできるよう職業を先にする。
 */
export function applyEffects(state: GameState, effects: Effects, rng: Rng, data: GameData = defaultData): void {
  const a = state.assets;
  const cashBefore = a.cash;
  if (effects.cash) a.cash += effects.cash;
  if (effects.cashMonthsOfPay) a.cash += roundYen(monthlyGrossPay(state, data) * effects.cashMonthsOfPay);
  if (effects.assetShock) {
    const targets = effects.assetShock.targets ?? (['index', 'stocks', 'speculative'] as const);
    for (const key of targets) {
      a[key] = roundYen(a[key] * (1 + effects.assetShock.pct));
      if (effects.assetShock.split && state.invested && key !== 'cash') {
        state.invested[key] = roundYen(state.invested[key] * (1 + effects.assetShock.pct));
        scaleNisaPrincipal(state, key, 1 + effects.assetShock.pct);
      }
    }
  }
  if (effects.startBusiness) a.cash -= data.balance.business.capital[effects.startBusiness];
  if (effects.sellBusiness && state.business) a.cash += businessValue(state, data);
  if (effects.inheritance) {
    const family = data.family.find((f) => f.tier === state.character.familyTier);
    a.cash += family?.inheritance ?? 0;
  }
  // 家の頭金と諸費用(現金で払う分)も、足りなければ下のローンでまかなう
  if (effects.buyHome !== undefined && !ownsHome(state)) buyHome(state, effects.buyHome, annualGross(state, data), data);
  // 貯金で払えない大きな出費はローンにする(起業の元手は収入の基準を見ない創業融資)
  coverWithLoan(state, cashBefore - a.cash, data, { incomeCheck: !effects.startBusiness });
  // 職業の変更(退職金)より前の、イベント自体のお金の出入り。ローンにした分は、毎月の返済として支出に入る
  recordEventCash(state, a.cash - cashBefore);
  // 家の頭金のように預金だけでは足りない出費は、その場で投資を取り崩して払う(月末まで預金がマイナスにならないように)
  recordInvestTax(state, coverWithInvestments(state, data));
  if (effects.debt) a.debt += effects.debt;
  if (effects.addChild) addChild(state, rng, data);
  if (effects.job) changeJob(state, pickJob(state, effects.job, rng, data), data);
  if (effects.changeEmployer) changeEmployer(state, data);
  if (effects.startBusiness) {
    changeJob(state, 'owner', data); // 前の会社の退職金を受け取る
    startBusiness(state, effects.startBusiness, data);
  }
  if (effects.sellBusiness && state.business) changeJob(state, 'none', data); // 会社を売ったら無職(失業給付なし)
  if (effects.retireOwner && state.business) retire(state, data); // 事業承継して引退(会社の価値の一部を受け取る)
  if (effects.businessLevel && state.business) state.business.level *= effects.businessLevel;
  if (effects.homeValue && state.assets.home) state.assets.home = roundYen(state.assets.home * effects.homeValue);
  for (const [key, delta] of Object.entries(effects.stats ?? {}) as [keyof Stats, number][]) {
    state.stats[key] = clampStat(state.stats[key] + delta);
  }
  if (effects.achievement) state.achievement = clamp(state.achievement + effects.achievement, 0, 100);
  const spouse = state.character.spouse;
  if (effects.setFlags?.widowed === true && state.character.married && spouse) {
    // 死別: 配偶者の厚生年金の一部が遺族年金として残る(配偶者がいなくなる前に計算する)
    const p = data.balance.spouse.types[spouse].employeePension * data.balance.pension.survivorRate;
    state.flags.survivorPension = roundYen(p);
  }
  applyFlags(state, effects.setFlags, (_, v) => v, rng, data);
  applyFlags(state, effects.addFlags, (old, v) => (typeof old === 'number' ? old : 0) + v, rng, data);
  applyFlags(state, effects.mulFlags, (old, v) => (typeof old === 'number' ? old : 1) * v, rng, data);
  if (effects.addChild && state.character.gender === 'female') afterGivingBirth(state, data);
  if (effects.region) state.character.region = effects.region;
  if (effects.relocate === 'down' && ownsHome(state)) {
    // 持ち家があるので、家族を残して単身赴任(住む場所は変わらない)
    state.stats.stress = clampStat(state.stats.stress + data.balance.housing.soloTransfer.stress);
    state.stats.relations = clampStat(state.stats.relations + data.balance.housing.soloTransfer.relations);
    addLog(state, 'event', '単身赴任: 持ち家があるので、ひとりで転勤先に移った', 'solo_transfer');
  } else if (effects.relocate === 'down') {
    const order = ['metro', 'city', 'rural'] as const;
    const i = order.indexOf(state.character.region);
    state.character.region = order[Math.min(order.length - 1, i + 1)]!;
  }
  if (effects.loan) {
    const ok = takeLoan(state, effects.loan.amount, effects.loan.months, data);
    if (!ok) {
      a.cash -= effects.loan.amount;
      recordEventCash(state, -effects.loan.amount);
      addLog(state, 'event', 'ローン審査に落ちた: 信用が足りず、現金で払うことになった', 'loan_rejected');
    }
  }
}

function applyFlags<V extends boolean | number>(
  state: GameState,
  flags: Record<string, V> | undefined,
  combine: (old: Flags[string] | undefined, v: V) => boolean | number,
  rng: Rng,
  data: GameData,
): void {
  for (const [key, v] of Object.entries(flags ?? {})) {
    const next = combine(getFlag(state, key), v);
    if (key === 'married') setMarried(state, next === true, rng, data);
    else {
      if (key === 'partner' && next === true && state.flags.partner !== true) state.flags.partnerSince = state.month;
      state.flags[key] = next;
    }
  }
}
