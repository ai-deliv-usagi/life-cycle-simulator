// 1ヶ月を進める(SPEC.md「月次処理の順序」、DESIGN.md §4)。計算は各モジュールに任せ、ここは順番だけを持つ。
import { defaultData } from '../data/index';
import { reviewBusiness } from './business';
import { logIndependence } from './children';
import { rollDeath } from './death';
import { applyChoice, drawEvent, fireEvent } from './events';
import { cloneLedger, closeYear, recordInvestTax, recordMonth } from './ledger';
import { buyInvestment, sellInvestment } from './nisa';
import { computeHappiness, updateAdaptation } from './happiness';
import { annualGross, applyMonthlyMoney, calcIncome, changeJob, isRehired, retire, type MonthlyIncome } from './money';
import { DEATH_CAUSE_LABELS } from './result';
import type { Rng } from './rng';
import { updateStats } from './stats';
import { INVEST_KEYS, normalizePolicy } from './policy';
import type { GameData, GameState, Policy, PolicyInput } from './types';
import { addLog, financialAssets, findById, netWorth } from './util';

export const POLICY_LABELS = {
  work: { regular: '定時', normal: '普通', overtime: '残業多め', grind: '激務' },
  spending: { frugal: '節約', normal: '普通', comfort: 'ゆとり', lavish: '浪費' },
  invest: { deposit: '預金', index: '積立', stocks: '個別株', speculative: '信用・仮想通貨' },
  health: { ignore: '気にしない', normal: '普通', active: '意識高め' },
  education: { public: '公立中心', private: '私立中心' },
} as const;

/**
 * 新しい state を作る。小さいオブジェクトは複製し、配列は追記の前に複製する。
 * (structuredClone は1,000人生の自動プレイで遅すぎるため)
 */
function cloneState(s: GameState): GameState {
  return {
    ...s,
    eventHistory: { ...s.eventHistory },
    character: { ...s.character },
    values: { ...s.values },
    policy: { ...s.policy, invest: { ...s.policy.invest } },
    stats: { ...s.stats },
    assets: { ...s.assets },
    ...(s.invested ? { invested: { ...s.invested } } : {}),
    ...(s.nisa
      ? { nisa: { frac: { ...s.nisa.frac }, principal: { ...s.nisa.principal }, year: { ...s.nisa.year } } }
      : {}),
    ...(s.ledger ? { ledger: cloneLedger(s.ledger) } : {}),
    ...(s.business ? { business: { ...s.business } } : {}),
    ...(s.home ? { home: { ...s.home } } : {}),
    flags: { ...s.flags },
    happinessHistory: s.happinessHistory.slice(),
    log: s.log.slice(),
    ...(s.pendingEvent ? { pendingEvent: { ...s.pendingEvent } } : {}),
    ...(s.dead ? { dead: { ...s.dead } } : {}),
  };
}

function manYen(yen: number): string {
  return `${Math.round(yen / 10_000).toLocaleString('ja-JP')}万円`;
}

/** 年間サマリーのタイミング(開始から12ヶ月ごと)か */
export function isYearEnd(state: GameState): boolean {
  return state.month > 0 && state.month % 12 === 0;
}

/**
 * 1ヶ月進めて新しい state を返す。死亡後・選択待ちの間は何もしない。
 * rng は呼び出し側が createRng(state.rngState) で作って渡す。使い終わった位置は戻り値の rngState に入る。
 */
export function stepMonth(state: GameState, rng: Rng, data: GameData = defaultData): GameState {
  if (state.dead || state.pendingEvent) return state;
  const s = cloneState(state);
  const { balance } = data;

  // 1. 時間。65歳で退職
  s.month += 1;
  s.ageMonths += 1;
  // 社長に定年はない(65歳からは毎年引退を考えるイベント。retireAgeMax 歳で必ず事業承継)
  const owner = s.character.job === 'owner' && s.business !== undefined;
  const retireAge = owner ? balance.business.retireAgeMax : balance.pension.retireAge;
  if (!s.character.retired && s.ageMonths >= retireAge * 12) {
    const parttime = s.character.job === 'parttime';
    retire(s, data);
    if (parttime) {
      // バイトに定年はない。年金をもらいながら、そのまま働き続ける
      s.flags.rehire = balance.rehire.parttimeMonths;
      addLog(s, 'event', `年金の受け取り開始: ${balance.pension.retireAge}歳になり年金をもらい始めた。バイトはこのまま続ける`, 'pension_start');
    } else {
      addLog(s, 'event', `定年退職: ${balance.pension.retireAge}歳で退職した`, 'retirement');
    }
  }

  // 2〜5. お金。そのあとタイマーを1ヶ月進める(DESIGN.md §3)
  recordMonth(s, applyMonthlyMoney(s, rng, data));
  logIndependence(s, data);
  if (reviewBusiness(s, rng, data)) changeJob(s, 'none', data); // 廃業したら無職(失業給付なし)
  for (const key of Object.keys(balance.timers)) {
    const v = s.flags[key];
    if (typeof v === 'number' && v > 0) s.flags[key] = v - 1;
  }
  if (state.flags.rehire === 1 && s.flags.rehire === 0) {
    addLog(s, 'event', `引退: ${Math.floor(s.ageMonths / 12)}歳で仕事を辞め、年金で暮らすことにした`, 'work_end');
  }

  // 6. ステータス
  updateStats(s, data);

  // 7. イベント(選択肢があれば pendingEvent がセットされる)
  const ev = drawEvent(s, rng, data);
  if (ev) fireEvent(s, ev, rng, data);

  // 8. 幸福度と慣れ
  s.happinessHistory.push(computeHappiness(s, data));
  updateAdaptation(s, data);

  // 9. 死亡判定
  const cause = rollDeath(s, rng, data);
  if (cause) {
    s.dead = { cause, ageMonths: s.ageMonths };
    delete s.pendingEvent;
    addLog(s, 'death', `${Math.floor(s.ageMonths / 12)}歳、${DEATH_CAUSE_LABELS[cause]}で亡くなった`);
    s.rngState = rng.state;
    return s;
  }

  // 10. 年間サマリー
  if (isYearEnd(s)) {
    closeYear(s);
    const age = Math.floor(s.ageMonths / 12);
    addLog(s, 'year_summary', `${age}歳(${s.month / 12}年目) 金融資産 ${manYen(financialAssets(s.assets))}`);
    const { cash, index, stocks, speculative } = s.assets;
    s.log.at(-1)!.assets = { cash, index, stocks, speculative }; // いま足したエントリなので直接書いてよい
  }

  s.rngState = rng.state;
  return s;
}

/** 選択待ちのイベントで選択肢を選ぶ */
export function resolveChoice(
  state: GameState,
  choiceIndex: number,
  rng: Rng,
  data: GameData = defaultData,
): GameState {
  if (!state.pendingEvent) throw new Error('resolveChoice: 選択待ちのイベントがない');
  const s = cloneState(state);
  const ev = findById(data.events, s.pendingEvent!.eventId, 'event');
  if (isYearEnd(s) && s.pendingEvent!.month === s.month && s.lastLedger) {
    // 年の切れ目の月に起きたイベントは、締めたばかりの年の収支に入れる(年間サマリーの金融資産と合わせる)
    const current = s.ledger;
    s.ledger = cloneLedger(s.lastLedger);
    applyChoice(s, ev, choiceIndex, rng, data);
    s.lastLedger = s.ledger;
    s.ledger = current;
  } else {
    applyChoice(s, ev, choiceIndex, rng, data);
  }
  delete s.pendingEvent;
  s.rngState = rng.state;
  return s;
}

/** 投資の配分を「積立70%・預金30%」のように */
export function allocationLabel(p: Policy): string {
  const parts = INVEST_KEYS.filter((k) => p.invest[k] > 0).map((k) => `${POLICY_LABELS.invest[k]}${p.invest[k]}%`);
  return parts.join('・') || '預金100%';
}

/** 方針を変える。次の月から反映される */
export function changePolicy(state: GameState, input: PolicyInput | Policy): GameState {
  const s = cloneState(state);
  const policy = normalizePolicy(input);
  s.policy = policy;
  const l = POLICY_LABELS;
  addLog(
    s,
    'policy',
    `方針変更: 働き方「${l.work[policy.work]}」支出「${l.spending[policy.spending]}」投資「${allocationLabel(policy)}${policy.prepay ? '・繰上げ返済あり' : ''}」健康「${l.health[policy.health]}」教育「${l.education[policy.education]}」`,
  );
  return s;
}

export type InvestKey = 'index' | 'stocks' | 'speculative';

/**
 * 投資を売って預金にする(好きなタイミングで)。amount は円。持っている額を超えたら全部売る。
 * from: 'auto' 特定口座から先に / 'taxable' 特定口座だけ / 'nisa' NISAだけ。特定口座の利益には税金がかかる。
 * 0円以下・持っていない・死亡後は同じ state を返す
 */
export function sellAsset(
  state: GameState,
  key: InvestKey,
  amount: number,
  from: 'auto' | 'taxable' | 'nisa' = 'auto',
  data: GameData = defaultData,
): GameState {
  if (state.dead || Math.round(amount) <= 0 || state.assets[key] <= 0) return state;
  const s = cloneState(state);
  const sale = sellInvestment(s, key, Math.round(amount), from, data);
  if (sale.gross <= 0) return state;
  s.assets.cash += sale.gross - sale.tax;
  recordInvestTax(s, sale.tax);
  const notes = [
    s.invested ? `損益 ${signedManYen(sale.gain)}` : '',
    sale.fromNisa > 0 ? (sale.fromNisa === sale.gross ? 'NISA' : `うちNISA ${yenLabel(sale.fromNisa)}`) : '',
    sale.tax > 0 ? `税金 ${yenLabel(sale.tax)}` : '',
  ].filter(Boolean);
  const note = notes.length > 0 ? `(${notes.join('・')})` : '';
  addLog(s, 'policy', `売却: ${POLICY_LABELS.invest[key]}を${yenLabel(sale.gross)}売って預金にした${note}`, 'sell');
  return s;
}

/** 預金で投資を買う(まとめ買い)。NISAの枠から先に使う。預金より多くは買えない */
export function buyAsset(state: GameState, key: InvestKey, amount: number, data: GameData = defaultData): GameState {
  const buy = Math.min(Math.round(amount), Math.max(0, state.assets.cash));
  if (state.dead || buy <= 0) return state;
  const s = cloneState(state);
  s.assets.cash -= buy;
  const toNisa = buyInvestment(s, key, buy, data);
  const note = toNisa === buy ? '(NISA)' : toNisa > 0 ? `(うちNISA ${yenLabel(toNisa)})` : '(特定口座)';
  addLog(s, 'policy', `購入: 預金で${POLICY_LABELS.invest[key]}を${yenLabel(buy)}買った${note}`, 'buy');
  return s;
}

/** 1万円未満は円で出す */
function yenLabel(yen: number): string {
  return Math.abs(yen) < 10_000 ? `${yen.toLocaleString('ja-JP')}円` : manYen(yen);
}

function signedManYen(yen: number): string {
  return `${yen >= 0 ? '+' : '−'}${yenLabel(Math.abs(yen))}`;
}

export interface MonthlyView {
  age: number;
  jobLabel: string;
  regionLabel: string;
  annualGross: number;
  householdNet: number; // 世帯の手取り(月)
  income: MonthlyIncome; // その内訳
  financialAssets: number;
  debt: number;
  studentLoan: number;
  loan: number;
  netWorth: number;
  happiness: number;
}

/** UI 表示用の値(state から導出するだけ) */
export function getMonthlyView(state: GameState, data: GameData = defaultData): MonthlyView {
  const c = state.character;
  const jobName =
    c.job === 'none'
      ? '無職'
      : c.job === 'owner'
        ? `${data.balance.business.label}(${Math.floor((state.month - (state.business?.since ?? state.month)) / 12) + 1}年目)`
        : findById(data.jobs, c.job, 'job').label;
  const leave = Number(state.flags.maternityLeave ?? 0) > 0 ? '産休中' : Number(state.flags.parentalLeave ?? 0) > 0 ? '育休中' : '';
  const working = leave && c.job !== 'none' ? `${jobName}(${leave})` : jobName;
  const rehiredLabel = c.job === 'parttime' ? `${jobName}(年金あり)` : `再雇用(${jobName})`;
  const jobLabel = c.retired ? (isRehired(state) ? rehiredLabel : '退職') : working;
  const income = calcIncome(state, data);
  return {
    age: Math.floor(state.ageMonths / 12),
    jobLabel,
    regionLabel: findById(data.regions, c.region, 'region').label,
    annualGross: annualGross(state, data),
    householdNet: income.total,
    income,
    financialAssets: financialAssets(state.assets),
    debt: state.assets.debt,
    studentLoan: state.assets.studentLoan,
    loan: state.assets.loan ?? 0,
    netWorth: netWorth(state.assets),
    happiness: state.happinessHistory.at(-1) ?? 0,
  };
}
