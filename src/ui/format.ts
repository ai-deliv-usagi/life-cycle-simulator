// 表示用の整形とラベル(UIの文言は日本語)
import { gameData, type Education, type FamilyTier, type JobId, type RegionId, type Values } from '../engine/index';

export function manYen(yen: number): string {
  const man = Math.round(yen / 10_000);
  return `${man.toLocaleString('ja-JP')}万円`;
}

/** 1億円以上は「1.2億円」 */
export function bigYen(yen: number): string {
  if (Math.abs(yen) >= 100_000_000) return `${(yen / 100_000_000).toFixed(1)}億円`;
  return manYen(yen);
}

export function yen(yen: number): string {
  return `${Math.round(yen).toLocaleString('ja-JP')}円`;
}

export function signedManYen(yen: number): string {
  return `${yen >= 0 ? '+' : '−'}${manYen(Math.abs(yen))}`;
}

/** 健康状態を言葉で(閾値は UI の定数。DESIGN.md §9.3) */
export function healthWord(health: number): string {
  if (health >= 80) return '絶好調';
  if (health >= 60) return '良好';
  if (health >= 40) return '普通';
  if (health >= 20) return '不調';
  return '危険';
}

export function educationLabel(id: Education): string {
  return gameData.education.find((e) => e.id === id)?.label ?? id;
}

export function jobLabel(id: JobId): string {
  if (id === 'none') return '無職';
  return gameData.jobs.find((j) => j.id === id)?.label ?? id;
}

export function familyLabel(tier: FamilyTier): string {
  return gameData.family.find((f) => f.tier === tier)?.label ?? String(tier);
}

export function regionLabel(id: RegionId): string {
  return gameData.regions.find((r) => r.id === id)?.label ?? id;
}

/** 体質を★5段階で(数値は隠す) */
export function stars(value: number): string {
  const n = Math.max(1, Math.min(5, Math.round(value / 20)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

export const VALUE_AXES: { key: keyof Values; left: string; right: string }[] = [
  { key: 'risk', left: '安定志向', right: '挑戦志向' },
  { key: 'relation', left: '家族重視', right: '自由・独身志向' },
  { key: 'spending', left: '貯める派', right: '使う派' },
  { key: 'work', left: '生活のため', right: 'やりがい・出世' },
];

export const STAT_LABELS = {
  health: '健康',
  stress: 'ストレス',
  skill: 'スキル',
  credit: '信用',
  relations: '人間関係',
} as const;

/** 選択肢つきイベントは「発生」と「選択」の2行になるので、選択の行だけ残す(選択の行にタイトルも入っている) */
export function collapseLog<T extends { type: string; id?: string; month: number }>(entries: readonly T[]): T[] {
  return entries.filter(
    (e, i) =>
      !(e.type === 'event' && entries.slice(i + 1).some((n) => n.type === 'choice' && n.id === e.id && n.month === e.month)),
  );
}
