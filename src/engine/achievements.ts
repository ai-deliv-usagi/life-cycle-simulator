// 実績(DESIGN.md §34)。亡くなったときの state とログから判定する。名前・説明・条件の数値は achievements.json
import { defaultData } from '../data/index';
import { computeResult } from './result';
import type { AchievementDef, GameData, GameState } from './types';
import { netWorth } from './util';

const has = (state: GameState, id: string) => state.log.some((e) => e.id === id);
const chose = (state: GameState, id: string, label: string) => state.log.some((e) => e.type === 'choice' && e.id === id && e.text.includes(`「${label}`));

type Check = (state: GameState, def: AchievementDef) => boolean;

const CHECKS: Record<string, Check> = {
  debt_free_retire: (s) => s.flags.debtFreeAt65 === true,
  okuribito: (s, d) => {
    const yearly = s.log.filter((e) => e.type === 'year_summary').map((e) => e.snapshot.netWorth);
    return Math.max(netWorth(s.assets), ...yearly) >= d.threshold!;
  },
  centenarian: (s, d) => Math.floor(s.ageMonths / 12) >= d.threshold!,
  big_family: (s, d) => (s.character.children?.length ?? 0) >= d.threshold!,
  grandparent: (s) => has(s, 'grandchild'),
  succession: (s) => has(s, 'business_succession'),
  mortgage_paid: (s) => s.home !== undefined && (s.assets.mortgage ?? 0) <= 0,
  happy_life: (s, d) => computeResult(s).lifetimeHappiness >= d.threshold!,
  comeback: (s, d) => has(s, 'bankruptcy') && netWorth(s.assets) >= d.threshold!,
  job_hopper: (s, d) => s.log.filter((e) => e.type === 'choice' && e.id === 'job_offer' && e.text.includes('転職する')).length >= d.threshold!,
  never_hospital: (s, d) => !has(s, 'hospital') && Math.floor(s.ageMonths / 12) >= d.threshold!,
  regular_path: (s) => chose(s, 'regular_job_offer', '応募して就職する') || chose(s, 'regular_conversion', '正社員になる'),
};

/** 取った実績の id(achievements.json の順) */
export function earnedAchievements(state: GameState, data: GameData = defaultData): string[] {
  return data.achievements.filter((d) => CHECKS[d.id]?.(state, d) === true).map((d) => d.id);
}

/** achievements.json の id に判定がないものがあれば返す(データの検査用) */
export function uncheckedAchievements(data: GameData = defaultData): string[] {
  return data.achievements.filter((d) => !CHECKS[d.id]).map((d) => d.id);
}
