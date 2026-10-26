// キャラ作成画面: 初期ガチャ・価値観・初期方針
import { createGame, createRng, deriveSeed, rollCharacter, type PolicyInput, type Values } from '../../engine/index';
import { append, clear, h, mount } from '../dom';
import { POLICY_PRESETS, VALUE_PRESETS } from '../presets';
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

/** 入力するカード(色の付いた枠と「入力」の印)。見るだけのカードと見分けられるようにする */
function inputCard(title: string, ...children: (HTMLElement | string | null)[]): HTMLElement {
  return h(
    'section',
    { class: 'card input-card' },
    h('div', { class: 'card-head' }, h('h2', {}, title), h('span', { class: 'input-badge' }, '入力')),
    ...children,
  );
}

/** キャラ作成は2ステップ: ①生まれ(ガチャの結果を見るだけ)→ ②あなたが決めること(名前・価値観・方針) */
export function setupScreen(root: HTMLElement, nav: Nav, seed: number): void {
  const roll = rollCharacter(seed);
  const values: Values = { risk: 0, relation: 0, spending: 0, work: 0 };
  // 最初は独身で子どももいないので、子どもの教育は出さない。繰上げ返済は奨学金があるときだけ
  const policy = policyForm(DEFAULT_POLICY, { showPrepay: roll.studentLoan !== null, showEducation: false });
  const nameInput = h('input', { type: 'text', value: '名無しさん', maxlength: 20, 'aria-label': '名前' });
  const sliderBox = h('div', { class: 'value-sliders' });
  const rebuildSliders = () => {
    clear(sliderBox);
    append(sliderBox, VALUE_AXES.map((axis) => valueSlider(axis, values)));
  };
  rebuildSliders();

  // タイプのボタン: 押すと価値観4つと、それに合う方針がまとめて決まる
  const typeHelp = h('p', { class: 'policy-help muted small' }, '近いタイプを選ぶと、価値観と方針がまとめて決まる。');
  let randomCount = 0;
  const typeButtons: HTMLButtonElement[] = [];
  const pickType = (index: number | null) => {
    typeButtons.forEach((b, i) => b.setAttribute('aria-pressed', i === index ? 'true' : 'false'));
    if (index === null) {
      // おまかせ: シードから決まる乱数で価値観を引く(同じシードなら同じ並び)
      const rng = createRng(deriveSeed(seed, 'player') + randomCount++);
      for (const axis of VALUE_AXES) values[axis.key] = rng.int(5) - 2;
      typeHelp.textContent = 'おまかせで決めた。方針はバランスにした。';
      policy.set(POLICY_PRESETS.find((p) => p.id === 'balance')!.policy);
    } else {
      const t = VALUE_PRESETS[index]!;
      Object.assign(values, t.values);
      const p = POLICY_PRESETS.find((x) => x.id === t.policy)!;
      typeHelp.textContent = `${t.description}。方針は「${p.label}」にした。`;
      policy.set(p.policy);
    }
    rebuildSliders();
  };
  VALUE_PRESETS.forEach((t, i) => typeButtons.push(h('button', { type: 'button', class: 'btn preset', onclick: () => pickType(i) }, t.label)));
  typeButtons.push(h('button', { type: 'button', class: 'btn preset', onclick: () => pickType(null) }, 'おまかせ'));
  pickType(VALUE_PRESETS.findIndex((t) => t.id === 'neutral')); // 最初は「ふつう」

  const loan = roll.studentLoan
    ? `${manYen(roll.studentLoan.amount)}(${roll.studentLoan.interestFree ? '無利子' : '有利子'})`
    : 'なし';
  const rows: [string, string][] = [
    ['性別', roll.gender === 'female' ? '女性' : '男性'],
    ['学歴', educationLabel(roll.education)],
    ['職業', jobLabel(roll.job)],
    ['実家の太さ', familyLabel(roll.familyTier)],
    ['出身地', regionLabel(roll.region)],
    ['車', roll.hasCar ? 'あり' : 'なし'],
    ['体質', stars(roll.constitution)],
    ['初期の貯金', manYen(roll.initialCash)],
    ['奨学金', loan],
  ];

  const birth = () =>
    mount(
      root,
      h(
        'main',
        { class: 'screen setup-screen' },
        h('p', { class: 'step muted small' }, 'キャラ作成 1/2'),
        h('h1', {}, '生まれ'),
        h('p', { class: 'muted small' }, 'ここは選べない。気に入らなければ引き直せる。'),
        h(
          'section',
          { class: 'card info-card gacha' },
          h('div', { class: 'card-head' }, h('h2', {}, 'あなたの生まれ'), h('span', { class: 'muted small' }, `シード ${seed}`)),
          h('dl', { class: 'gacha-list' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
          h('button', { class: 'btn', onclick: () => nav.setup(seed + 1) }, '引き直す'),
        ),
        h(
          'div',
          { class: 'sticky-actions' },
          h('button', { class: 'btn', onclick: () => nav.title() }, '戻る'),
          h('button', { class: 'btn primary', onclick: () => decide() }, 'この生まれで決める'),
        ),
      ),
    );

  const decide = () =>
    mount(
      root,
      h(
        'main',
        { class: 'screen setup-screen' },
        h('p', { class: 'step muted small' }, 'キャラ作成 2/2'),
        h('h1', {}, 'あなたが決めること'),
        inputCard('名前', nameInput),
        inputCard(
          'あなたのタイプ',
          h('div', { class: 'segmented presets' }, ...typeButtons),
          typeHelp,
          h(
            'details',
            { class: 'fine-tune' },
            h('summary', {}, '価値観を細かく決める'),
            h('p', { class: 'muted small' }, '幸福度の感じ方が変わる。人生の中の選択で少しずつ変わっていく。'),
            sliderBox,
          ),
        ),
        inputCard('最初の方針', h('p', { class: 'muted small' }, 'あとからいつでも変えられる。'), policy.el),
        h(
          'div',
          { class: 'sticky-actions' },
          h('button', { class: 'btn', onclick: () => birth() }, '生まれに戻る'),
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

  birth();
}
