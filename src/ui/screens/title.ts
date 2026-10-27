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

/** 遊び方。はじめての人には開いて見せ、遊んだことがある人には閉じておく */
function howToSection(): HTMLElement {
  const firstTime = loadHistory().length === 0;
  return h(
    'details',
    { class: 'card seed-card how-to', ...(firstTime ? { open: true } : {}) },
    h('summary', {}, '🕹️ 遊び方'),
    h(
      'ol',
      { class: 'how-to-list' },
      h('li', {}, '生まれ(性別・学歴・仕事・住む場所・実家)はガチャ。気に入らなければ引き直せる'),
      h('li', {}, '「あなたのタイプ」で何に幸せを感じるかを、「方針」で働き方とお金の使い方を決める'),
      h('li', {}, '1ターン=1ヶ月。「次へ」で1ヶ月、▶で自動で進む。人生の分かれ道では選択肢が出る'),
      h('li', {}, '方針は途中でいつでも変えられる。亡くなったら一生をふり返る'),
      h('li', {}, '幸せな一生なら「勝ち組」。お金が多いだけでは勝ち組にならないし、少なくても幸せなら勝ち組'),
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
      howToSection(),
      h(
        'details',
        { class: 'card seed-card' },
        h('summary', {}, '🔢 人生の番号(シード)を指定して始める'),
        h('p', { class: 'muted small' }, '人生には番号(シード)がついていて、同じ番号なら同じ生まれ・同じ運命になる。友だちや視聴者と同じ条件で遊べる。'),
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
