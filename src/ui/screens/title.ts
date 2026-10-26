// タイトル画面
import { gameData, LIFE_TYPE_LABELS } from '../../engine/index';
import { h, mount } from '../dom';
import { bigYen, LIFE_TYPE_ICONS } from '../format';
import { freshSeed, type Nav } from '../nav';
import { clearSave, earnedSoFar, loadGame, loadHistory } from '../storage';

const HISTORY_SHOWN = 10;
const HISTORY_FIRST = 3; // はじめに見せる件数。残りは「もっと見る」

function continueSection(nav: Nav): HTMLElement | null {
  const save = loadGame();
  if (save.status === 'none') return null;
  if (save.status === 'broken') {
    return h(
      'section',
      { class: 'card notice' },
      h('p', {}, 'セーブデータを読み込めませんでした。'),
      h('button', { class: 'btn', onclick: (e: Event) => { clearSave(); (e.target as HTMLElement).closest('section')?.remove(); } }, 'セーブデータを消す'),
    );
  }
  const s = save.state;
  return h(
    'button',
    { class: 'btn big', onclick: () => nav.main(s) },
    `続きから(${s.character.name}・${Math.floor(s.ageMonths / 12)}歳)`,
  );
}

function historySection(): HTMLElement | null {
  const all = loadHistory();
  if (all.length === 0) return null;
  const history = all.slice(0, HISTORY_SHOWN);
  const item = (r: (typeof history)[number]) =>
    h(
      'li',
      { class: 'history-item' },
      h('span', { class: 'history-icon', 'aria-hidden': 'true' }, LIFE_TYPE_ICONS[r.lifeType] ?? ''),
      h(
        'span',
        { class: 'history-main' },
        h('span', { class: 'history-type' }, `${r.name}・${LIFE_TYPE_LABELS[r.lifeType]}`),
        h('span', { class: 'muted small' }, `享年${r.ageAtDeath}歳 · ${bigYen(r.finalNetWorth)} · シード ${r.seed}`),
      ),
    );
  // これまでの記録(いちばん長生き・いちばんの資産)
  const longest = Math.max(...all.map((r) => r.ageAtDeath));
  const richest = Math.max(...all.map((r) => r.finalNetWorth));
  const rest = history.slice(HISTORY_FIRST);
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, '📜 過去の人生'),
    h('p', { class: 'muted small' }, `${all.length}回の人生 · 最長 ${longest}歳 · 最高 ${bigYen(richest)}`),
    h('ol', { class: 'history-list' }, ...history.slice(0, HISTORY_FIRST).map(item)),
    rest.length > 0
      ? h('details', { class: 'fine-tune' }, h('summary', {}, `もっと見る(${rest.length}件)`), h('ol', { class: 'history-list' }, ...rest.map(item)))
      : null,
  );
}

/** 実績: 取ったものと、まだのもの(条件は見せる。目標になるように) */
function achievementsSection(): HTMLElement | null {
  const history = loadHistory();
  if (history.length === 0) return null;
  const earned = earnedSoFar(history);
  const defs = gameData.achievements;
  return h(
    'details',
    { class: 'card seed-card' },
    h('summary', {}, `🏅 実績 ${earned.size}/${defs.length}`),
    h(
      'ul',
      { class: 'achievement-list' },
      ...defs.map((d) =>
        h(
          'li',
          { class: `achievement${earned.has(d.id) ? '' : ' locked'}` },
          h('span', { class: 'achievement-icon', 'aria-hidden': 'true' }, earned.has(d.id) ? d.icon : '🔒'),
          h('span', {}, h('strong', {}, d.title), h('span', { class: 'muted small achievement-desc' }, d.description)),
        ),
      ),
    ),
  );
}

export function titleScreen(root: HTMLElement, nav: Nav): void {
  const seedInput = h('input', {
    type: 'number',
    inputmode: 'numeric',
    min: 0,
    placeholder: '例: 12345',
    'aria-label': 'シード値',
  });
  const startWithSeed = () => {
    const seed = Number(seedInput.value);
    if (seedInput.value === '' || !Number.isFinite(seed) || seed < 0) {
      seedInput.focus();
      return;
    }
    nav.setup(Math.floor(seed));
  };

  mount(
    root,
    h(
      'main',
      { class: 'screen title-screen' },
      h('h1', { class: 'logo' }, '人生シミュレーター'),
      h('p', { class: 'lead' }, '生まれ・職業・価値観の違う一生を、お金と幸福度でたどる。正解の人生はない。'),
      continueSection(nav),
      h('button', { class: 'btn primary big', onclick: () => nav.setup(freshSeed()) }, '🎲 新しい人生'),
      h(
        'details',
        { class: 'card seed-card' },
        h('summary', {}, '🔢 シードを指定して始める'),
        h('p', { class: 'muted small' }, '同じシードなら同じ生まれ・同じ運命。視聴者と同じ条件で遊べる。'),
        h(
          'form',
          {
            class: 'row',
            onsubmit: (e: Event) => {
              e.preventDefault();
              startWithSeed();
            },
          },
          seedInput,
          h('button', { class: 'btn', type: 'submit' }, 'このシードで始める'),
        ),
      ),
      achievementsSection(),
      historySection(),
    ),
  );
}
