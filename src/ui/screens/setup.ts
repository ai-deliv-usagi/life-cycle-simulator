// キャラ作成画面: 初期ガチャ・価値観・初期方針
import { createGame, rollCharacter, type PolicyInput, type Values } from '../../engine/index';
import { h, mount } from '../dom';
import { educationLabel, familyLabel, jobLabel, manYen, regionLabel, stars, VALUE_AXES, valueStepLabel } from '../format';
import type { Nav } from '../nav';
import { policyForm } from '../policyForm';

const DEFAULT_POLICY: PolicyInput = {
  work: 'normal',
  spending: 'normal',
  invest: { deposit: 30, index: 70, stocks: 0, speculative: 0 },
  health: 'normal',
};

/** 価値観は5段階(-2〜+2)。数字ではなく「やや安定志向」のように言葉で出す */
function valueSlider(axis: (typeof VALUE_AXES)[number], values: Values): HTMLElement {
  const output = h('output', { class: 'slider-value' }, valueStepLabel(axis, values[axis.key]));
  const input = h('input', {
    type: 'range',
    min: -2,
    max: 2,
    step: 1,
    value: values[axis.key],
    'aria-label': `${axis.left}〜${axis.right}`,
    oninput: (e: Event) => {
      values[axis.key] = Number((e.target as HTMLInputElement).value);
      output.textContent = valueStepLabel(axis, values[axis.key]);
    },
  });
  return h(
    'div',
    { class: 'slider' },
    h('div', { class: 'slider-labels' }, h('span', {}, axis.left), output, h('span', {}, axis.right)),
    input,
  );
}

export function setupScreen(root: HTMLElement, nav: Nav, seed: number): void {
  const roll = rollCharacter(seed);
  const values: Values = { risk: 0, relation: 0, spending: 0, work: 0 };
  const policy = policyForm(DEFAULT_POLICY);
  const nameInput = h('input', { type: 'text', value: '名無しさん', maxlength: 20, 'aria-label': '名前' });

  const loan = roll.studentLoan
    ? `${manYen(roll.studentLoan.amount)}(${roll.studentLoan.interestFree ? '無利子' : '有利子'})`
    : 'なし';
  const rows: [string, string][] = [
    ['学歴', educationLabel(roll.education)],
    ['職業', jobLabel(roll.job)],
    ['実家の太さ', familyLabel(roll.familyTier)],
    ['出身地', regionLabel(roll.region)],
    ['車', roll.hasCar ? 'あり' : 'なし'],
    ['体質', stars(roll.constitution)],
    ['初期の貯金', manYen(roll.initialCash)],
    ['奨学金', loan],
  ];

  mount(
    root,
    h(
      'main',
      { class: 'screen setup-screen' },
      h('h1', {}, 'キャラ作成'),
      h(
        'section',
        { class: 'card gacha' },
        h('div', { class: 'card-head' }, h('h2', {}, '生まれ'), h('span', { class: 'muted small' }, `シード ${seed}`)),
        h('dl', { class: 'gacha-list' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
        h('button', { class: 'btn', onclick: () => nav.setup(seed + 1) }, '引き直す'),
      ),
      h('section', { class: 'card' }, h('h2', {}, '名前'), nameInput),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, '価値観'),
        h('p', { class: 'muted small' }, '幸福度の感じ方が変わる。人生の中の選択で少しずつ変わっていく。'),
        ...VALUE_AXES.map((axis) => valueSlider(axis, values)),
      ),
      h('section', { class: 'card' }, h('h2', {}, '最初の方針'), h('p', { class: 'muted small' }, 'あとからいつでも変えられる。'), policy.el),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn', onclick: () => nav.title() }, '戻る'),
        h(
          'button',
          {
            class: 'btn primary',
            onclick: () => {
              const name = nameInput.value.trim() || '名無しさん';
              nav.main(createGame(roll, { ...values }, policy.get(), name));
            },
          },
          'この人生を始める',
        ),
      ),
    ),
  );
}
