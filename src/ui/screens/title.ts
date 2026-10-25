// タイトル画面
import { LIFE_TYPE_LABELS } from '../../engine/index';
import { h, mount } from '../dom';
import { bigYen } from '../format';
import { freshSeed, type Nav } from '../nav';
import { clearSave, loadGame, loadHistory } from '../storage';

const HISTORY_SHOWN = 10;

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
  const history = loadHistory().slice(0, HISTORY_SHOWN);
  if (history.length === 0) return null;
  return h(
    'section',
    { class: 'card' },
    h('h2', {}, '過去の人生'),
    h(
      'ol',
      { class: 'history-list' },
      ...history.map((r) =>
        h(
          'li',
          {},
          h('span', { class: 'history-type' }, LIFE_TYPE_LABELS[r.lifeType]),
          h('span', { class: 'muted small' }, `${r.name}・享年${r.ageAtDeath}歳・${bigYen(r.finalNetWorth)}・幸福 ${r.lifetimeHappiness.toFixed(1)}・シード ${r.seed}`),
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
      h('button', { class: 'btn primary big', onclick: () => nav.setup(freshSeed()) }, '新しい人生'),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, 'シードで始める'),
        h('p', { class: 'muted' }, '同じシードなら同じ生まれ・同じ運命。視聴者と同じ条件で遊べる。'),
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
      historySection(),
    ),
  );
}
