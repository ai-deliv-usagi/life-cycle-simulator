// 隠しステータスの月次変化(SPEC.md「毎月のステータス変化」、DESIGN.md §5.3)
// stepMonth が複製した state を直接更新する。
import { defaultData } from '../data/index';
import type { GameData, GameState, WorkStyle } from './types';
import { isRehired } from './money';
import { ageYears, clamp, clampStat } from './util';

/** 健康の平常値。方針の増減はこの値を中心にした揺れになる */
export function healthBaseline(state: GameState, data: GameData = defaultData): number {
  const s = data.balance.stats;
  const age = ageYears(state);
  return (
    s.healthBase +
    s.healthBaseConstitution * (state.character.constitution - 50) -
    s.healthBaseAgeSlope * Math.max(0, age - s.healthBaseAgeFrom)
  );
}

/** 今月効いている働き方。無職と再雇用は定時扱い、退職後は働き方の影響なし(null) */
export function effectiveWork(state: GameState): WorkStyle | null {
  if (state.character.retired) return isRehired(state) ? 'regular' : null;
  if (state.character.job === 'none') return 'regular';
  return state.policy.work;
}

export function updateStats(state: GameState, data: GameData = defaultData): void {
  const { balance } = data;
  const s = balance.stats;
  const st = state.stats;
  const c = state.character;
  const age = ageYears(state);
  const work = effectiveWork(state);
  const care = balance.healthCare[state.policy.health];
  const highStress = st.stress >= s.highStress;

  let dHealth = care.health;
  let dStress = care.stress + balance.spending[state.policy.spending].stress;
  let dSkill = 0;
  if (work) {
    const w = balance.work[work];
    dHealth += w.health;
    dStress += w.stress;
    dSkill += w.skill;
  }
  if (c.retired && !isRehired(state)) dStress += s.retiredStress;
  if (!c.retired && c.job === 'none') dStress += balance.unemployedStress;
  if (highStress) dHealth += s.highStressHealth;
  if (age >= 60) dHealth += s.age60Health;
  else if (age >= 40) dHealth += s.age40Health;
  for (const [key, t] of Object.entries(balance.timers)) {
    const v = state.flags[key];
    if ('health' in t && typeof v === 'number' && v > 0) dHealth += t.health; // 大病を治療しないまま など
  }

  // 体質: 減るときだけ (1.5 − 体質/100) 倍
  if (dHealth < 0) dHealth *= 1.5 - c.constitution / 100;

  // 平常値への回帰
  dHealth += s.healthReversion * (healthBaseline(state, data) - st.health);
  dStress += s.stressReversion * (s.stressBase - st.stress);

  st.health = clampStat(st.health + dHealth);
  st.stress = clampStat(st.stress + dStress);
  st.skill = clampStat(st.skill + dSkill);
  st.relations = clampStat(st.relations + s.relationsDecay);
  st.credit = clampStat(st.credit + (state.assets.debt > 0 ? s.creditWithDebt : s.creditNoDebt));
  state.achievement = clamp(state.achievement - s.achievementDecay, 0, 100);
}
