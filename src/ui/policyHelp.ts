// 方針の各選択肢が何に効くかの説明。数字は balance.json から作るので、調整しても説明がずれない
import { gameData, type HealthCare, type Invest, type Spending, type WorkStyle } from '../engine/index';

function pct(x: number): string {
  const v = Math.round(x * 100);
  return `${v >= 0 ? '+' : '−'}${Math.abs(v)}%`;
}

function level(x: number, words: [string, string, string, string, string]): string {
  // 大きく下がる / 下がる / 変わらない / 上がる / 大きく上がる
  if (x <= -0.5) return words[0];
  if (x < 0) return words[1];
  if (x === 0) return words[2];
  if (x < 1) return words[3];
  return words[4];
}

export function workHelp(w: WorkStyle): string {
  const b = gameData.balance.work[w];
  const parts = [
    `収入${pct(b.income - 1)}`,
    `自由時間 ${b.freeTime}/100`,
    `ストレス${level(b.stress, ['が減る', 'が少し減る', 'は変わらない', 'が少し溜まる', 'が溜まりやすい'])}`,
    `健康${level(b.health, ['が大きく削られる', 'が少しずつ削られる', 'への影響なし', 'が上がる', 'が上がる'])}`,
    `スキル+${b.skill}/月`,
  ];
  if (b.death > 1) parts.push(`死亡率×${b.death}`);
  return parts.join('・');
}

export function spendingHelp(s: Spending): string {
  const b = gameData.balance.spending[s];
  const base = `収入に応じた生活費×${b.living.toFixed(1)}`;
  if (b.living < 1) return `${base}。貯まりやすいが、生活水準の満足は下がる`;
  if (b.living === 1) return `${base}。収入の多くを生活に使い、残りを貯める`;
  const note = b.stress < 0 ? '・ストレスが少し減る' : '';
  if (b.living >= 1.4) return `${base}${note}。生活水準の満足は上がるが、若いうちは赤字になりやすく、借金や自己破産につながる`;
  return `${base}${note}。生活水準の満足は上がるが、貯まりにくい`;
}

export function healthHelp(c: HealthCare): string {
  const b = gameData.balance.healthCare[c];
  const cost = b.cost === 0 ? '出費なし' : `月${(b.cost / 10_000).toLocaleString('ja-JP')}万円`;
  const health = b.health > 0 ? '健康が上がり、長生きしやすい' : b.health < 0 ? '健康が少しずつ削られる' : '健康への影響なし';
  const stress = b.stress < 0 ? '・ストレスが少し減る' : '';
  return `${cost}・${health}${stress}`;
}

/** 投資先ごとの期待リターンと振れ幅 */
export function investHelp(k: Invest): string {
  const a = gameData.balance.assets;
  if (k === 'deposit') return `年${(a.cash.mu * 100).toFixed(1)}%。減らない`;
  const cfg = a[k];
  const base = `年${Math.round(cfg.mu * 100)}%前後・振れ幅${Math.round(cfg.sigma * 100)}%`;
  if (k === 'speculative') {
    const s = a.speculative;
    return `${base}・まれに暴落(${Math.round(s.crashPct * 100)}%)`;
  }
  return base;
}
