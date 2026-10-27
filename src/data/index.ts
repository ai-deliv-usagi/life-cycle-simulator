// 調整用データの読み込みと検査。engine の関数は data を省略するとこの defaultData を使う。
import type {
  AchievementDef,
  Balance,
  EducationDef,
  EventDef,
  FamilyDef,
  GameData,
  JobDef,
  RegionDef,
} from '../engine/types';
import achievementsJson from './achievements.json';
import balanceJson from './balance.json';
import educationJson from './education.json';
import eventsJson from './events.json';
import familyJson from './family.json';
import jobsJson from './jobs.json';
import regionJson from './region.json';

// JSON の型は string などに広がるので、ここで型を付けて validateData で中身を検査する
export const defaultData: GameData = {
  achievements: achievementsJson as AchievementDef[],
  education: educationJson as EducationDef[],
  jobs: jobsJson as JobDef[],
  family: familyJson as FamilyDef[],
  regions: regionJson as RegionDef[],
  events: eventsJson as EventDef[],
  balance: balanceJson as Balance,
};

const EDUCATIONS = ['junior_high', 'high', 'vocational', 'university'];
const JOBS = ['sales', 'office', 'engineer', 'parttime', 'factory'];
const REGIONS = ['metro', 'city', 'rural'];
const STATS = ['health', 'stress', 'skill', 'credit', 'relations'];
const VALUES = ['risk', 'relation', 'spending', 'work'];
const EPS = 1e-9;

function isProb(p: unknown): boolean {
  return typeof p === 'number' && p >= 0 && p <= 1;
}

function sumsToOne(probs: number[]): boolean {
  return Math.abs(probs.reduce((a, b) => a + b, 0) - 1) < EPS;
}

function checkIds(errors: string[], label: string, ids: readonly unknown[], expected: readonly unknown[]): void {
  const seen = new Set<unknown>();
  for (const id of ids) {
    if (seen.has(id)) errors.push(`${label}: id "${String(id)}" が重複している`);
    seen.add(id);
    if (!expected.includes(id)) errors.push(`${label}: 不明な id "${String(id)}"`);
  }
  for (const id of expected) {
    if (!seen.has(id)) errors.push(`${label}: id "${String(id)}" がない`);
  }
}

/** データの整合性を検査し、問題の一覧を返す(空なら正常) */
export function validateData(data: GameData): string[] {
  const errors: string[] = [];
  const { education, jobs, family, regions, events, balance } = data;

  checkIds(errors, 'education', education.map((e) => e.id), EDUCATIONS);
  if (!sumsToOne(education.map((e) => e.prob))) errors.push('education: 出現率の合計が1でない');
  for (const e of education) {
    if (e.loan && (!isProb(e.loan.prob) || e.loan.amount <= 0)) errors.push(`education.${e.id}: 奨学金の値が不正`);
  }

  checkIds(errors, 'jobs', jobs.map((j) => j.id), JOBS);
  for (const j of jobs) {
    if (j.startPay > j.peakPay) errors.push(`jobs.${j.id}: 初年度年収がピーク年収より高い`);
    if (!isProb(j.layoffRate)) errors.push(`jobs.${j.id}: リストラ率が0〜1でない`);
  }

  checkIds(errors, 'family', family.map((f) => f.tier), [1, 2, 3, 4, 5]);
  if (!sumsToOne(family.map((f) => f.prob))) errors.push('family: 出現率の合計が1でない');

  checkIds(errors, 'region', regions.map((r) => r.id), REGIONS);
  if (!sumsToOne(regions.map((r) => r.prob))) errors.push('region: 出現率の合計が1でない');
  for (const r of regions) {
    if (!isProb(r.carProb)) errors.push(`region.${r.id}: 車の保有率が0〜1でない`);
  }

  const bands = balance.takeHome.bands;
  for (let i = 1; i < bands.length; i++) {
    const prev = bands[i - 1]?.below;
    const cur = bands[i]?.below;
    if (prev === null || prev === undefined || (cur !== null && cur !== undefined && cur <= prev)) {
      errors.push('balance.takeHome.bands: 境界が昇順でない');
    }
  }
  if (bands.at(-1)?.below !== null) errors.push('balance.takeHome.bands: 最後の帯の below は null');
  if (!sumsToOne(Object.values(balance.spouse.types).map((t) => t.prob))) {
    errors.push('balance.spouse.types: 確率の合計が1でない');
  }
  if (!isProb(balance.studentLoan.interestFreeProb)) errors.push('balance.studentLoan.interestFreeProb が0〜1でない');

  const eventIds = new Set<string>();
  for (const ev of events) {
    if (eventIds.has(ev.id)) errors.push(`events: id "${ev.id}" が重複している`);
    eventIds.add(ev.id);
    if (!isProb(ev.baseProb)) errors.push(`events.${ev.id}: baseProb が0〜1でない`);
    for (const r of ev.conditions.region ?? []) {
      if (!REGIONS.includes(r)) errors.push(`events.${ev.id}: 不明な地域 "${r}"`);
    }
    for (const j of [...(ev.conditions.jobNotIn ?? []), ...(ev.conditions.jobIn ?? [])]) {
      if (![...JOBS, 'owner', 'none'].includes(j)) errors.push(`events.${ev.id}: 不明な職業 "${j}"`);
    }
    const effectsList = [ev.effects, ...(ev.choices ?? []).flatMap((c) => [c.effects, ...(c.outcomes ?? []).map((o) => o.effects)])];
    for (const eff of effectsList) {
      for (const key of Object.keys(eff?.stats ?? {})) {
        if (!STATS.includes(key)) errors.push(`events.${ev.id}: 不明なステータス "${key}"`);
      }
      if (eff?.region && !REGIONS.includes(eff.region)) errors.push(`events.${ev.id}: 不明な地域 "${eff.region}"`);
      if (eff?.loan && (eff.loan.amount <= 0 || !Number.isInteger(eff.loan.months) || eff.loan.months <= 0)) {
        errors.push(`events.${ev.id}: ローンの金額・回数が不正`);
      }
      if (eff?.luxury && (!(eff.luxury.item in balance.luxury) || !['cash', 'loan', 'revolving'].includes(eff.luxury.pay))) {
        errors.push(`events.${ev.id}: 高級品の種類・払い方が不正`);
      }
      if (eff?.job && ![...JOBS, 'none', 'random_other', 'other_industry', 'previous'].includes(eff.job)) {
        errors.push(`events.${ev.id}: 不明な職業 "${eff.job}"`);
      }
    }
    if (ev.choices && ev.choices.length > 0 && ev.choices.every((c) => c.conditions)) {
      errors.push(`events.${ev.id}: 条件なしの選択肢が1つもない(どの選択肢も出ない状態がありうる)`);
    }
    for (const c of ev.choices ?? []) {
      if (c.outcomes && !sumsToOne(c.outcomes.map((o) => o.prob))) {
        errors.push(`events.${ev.id}: 選択肢「${c.label}」の outcomes の確率の合計が1でない`);
      }
      for (const key of Object.keys(c.valueShift ?? {})) {
        if (!VALUES.includes(key)) errors.push(`events.${ev.id}: 不明な価値観 "${key}"`);
      }
    }
  }

  return errors;
}
