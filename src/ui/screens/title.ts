// タイトル画面
import { h, mount } from '../dom';
import { freshSeed, type Nav } from '../nav';

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
    ),
  );
}
