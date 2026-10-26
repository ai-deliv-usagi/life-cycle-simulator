// キャラ作成画面: 初期ガチャ・価値観・初期方針
import {
  createGame,
  createRng,
  deriveSeed,
  gameData,
  LIFE_TYPE_LABELS,
  previewLife,
  rollCharacter,
  summarizePreview,
  type CharacterRoll,
  type PolicyInput,
  type PreviewLife,
  type PreviewSummary,
  type Values,
} from '../../engine/index';
import { append, clear, h, mount } from '../dom';
import { POLICY_PRESETS, VALUE_PRESETS } from '../presets';
import {
  EDUCATION_ICONS,
  educationLabel,
  familyLabel,
  genderIcon,
  JOB_ICONS,
  jobLabel,
  LIFE_TYPE_ICONS,
  manYen,
  REGION_ICONS,
  regionLabel,
  stars,
  VALUE_AXES,
  valueStepLabel,
} from '../format';
import type { Nav } from '../nav';
import { policyForm } from '../policyForm';

/** 見通しで自動プレイする人生の数 */
const PREVIEW_LIVES = 30;

/** 見通しに出す「大きな出来事」(風邪・同窓会のような、だれにでも起きるものは出さない) */
const PREVIEW_EVENTS = [
  'layoff',
  'promotion',
  'job_offer',
  'regular_job_offer',
  'startup_chance',
  'home_bought',
  'divorce_crisis',
  'serious_illness',
  'overwork_collapse',
  'luxury_car',
  'bankruptcy',
];

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

  const birth = () =>
    mount(
      root,
      h(
        'main',
        { class: 'screen setup-screen' },
        h('p', { class: 'step muted small' }, 'キャラ作成 1/3'),
        h('h1', {}, '生まれ'),
        h('p', { class: 'muted small' }, 'ここは選べない。気に入らなければ引き直せる。'),
        birthCard(roll, seed, () => nav.setup(seed + 1)),
        h(
          'div',
          { class: 'sticky-actions' },
          h('button', { class: 'btn', onclick: () => nav.title() }, '戻る'),
          h('button', { class: 'btn primary', onclick: () => decide() }, 'この生まれで決める'),
        ),
      ),
    );

  const start = () => {
    const name = nameInput.value.trim() || '名無しさん';
    nav.main(createGame(roll, { ...values }, policy.get(), name));
  };

  const decide = () =>
    mount(
      root,
      h(
        'main',
        { class: 'screen setup-screen' },
        h('p', { class: 'step muted small' }, 'キャラ作成 2/3'),
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
          h('button', { class: 'btn primary', onclick: () => outlook() }, '見通しを見る'),
        ),
      ),
    );

  // この人生の見通し: 同じ生まれと方針で PREVIEW_LIVES 回だけ自動プレイ(少しずつ計算して画面を固めない)
  let token = 0;
  const outlook = () => {
    const my = ++token;
    const body = h('div', { class: 'outlook-body' }, h('p', { class: 'muted' }, '見通しを計算しています…'));
    const progress = h('progress', { max: PREVIEW_LIVES, value: 0 });
    body.appendChild(progress);
    mount(
      root,
      h(
        'main',
        { class: 'screen setup-screen' },
        h('p', { class: 'step muted small' }, 'キャラ作成 3/3'),
        h('h1', {}, 'この人生の見通し'),
        h(
          'p',
          { class: 'muted small' },
          `この生まれと方針で${PREVIEW_LIVES}回、人生を試しに送ってみた結果。選択はでたらめに選んでいる。本番の人生とは運の流れが違う。`,
        ),
        h('section', { class: 'card info-card' }, body),
        h(
          'div',
          { class: 'sticky-actions' },
          h('button', { class: 'btn', onclick: () => decide() }, '方針を変える'),
          h('button', { class: 'btn primary', onclick: start }, 'この人生を始める'),
        ),
      ),
    );
    const lives: PreviewLife[] = [];
    const input = { values: { ...values }, policy: policy.get() };
    const next = () => {
      if (my !== token || !body.isConnected) return; // 画面を離れたら止める
      lives.push(previewLife(roll, input.values, input.policy, lives.length));
      progress.value = lives.length;
      if (lives.length < PREVIEW_LIVES) {
        setTimeout(next, 0);
        return;
      }
      clear(body);
      append(body, outlookContent(summarizePreview(lives)));
    };
    setTimeout(next, 0);
  };

  birth();
}

/** 生まれのカード: アイコンつきの2行と、ひとことの説明。細かい数字は「くわしく」の中 */
function birthCard(roll: CharacterRoll, seed: number, reroll: () => void): HTMLElement {
  const gender = roll.gender === 'female' ? '女性' : '男性';
  const loan = roll.studentLoan
    ? `${manYen(roll.studentLoan.amount)}(${roll.studentLoan.interestFree ? '無利子' : '有利子'})`
    : 'なし';
  const chip = (icon: string, text: string) => h('span', { class: 'chip' }, h('span', { 'aria-hidden': 'true' }, icon), text);
  return h(
    'section',
    { class: 'card info-card gacha' },
    h('div', { class: 'card-head' }, h('h2', {}, 'あなたの生まれ'), h('span', { class: 'muted small' }, `シード ${seed}`)),
    h(
      'div',
      { class: 'chips' },
      chip(genderIcon(roll.gender), gender),
      chip(EDUCATION_ICONS[roll.education], educationLabel(roll.education)),
      chip(JOB_ICONS[roll.job], jobLabel(roll.job)),
      chip(REGION_ICONS[roll.region], regionLabel(roll.region)),
      chip('🏠', `実家は${familyLabel(roll.familyTier)}`),
      chip(roll.hasCar ? '🚗' : '🚶', roll.hasCar ? '車あり' : '車なし'),
    ),
    h('p', { class: 'birth-line' }, `${regionLabel(roll.region)}で${jobLabel(roll.job)}の仕事を始める、${educationLabel(roll.education)}の${gender}。`),
    h(
      'details',
      { class: 'fine-tune' },
      h('summary', {}, 'くわしく'),
      h(
        'dl',
        { class: 'gacha-list' },
        ...(
          [
            ['体質', stars(roll.constitution)],
            ['初期の貯金', manYen(roll.initialCash)],
            ['奨学金', loan],
          ] as const
        ).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]),
      ),
    ),
    h('button', { class: 'btn', onclick: reroll }, '🎲 引き直す'),
  );
}

/** 見通しの中身 */
function outlookContent(s: PreviewSummary): HTMLElement[] {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const row = (icon: string, label: string, ...value: (HTMLElement | string)[]) =>
    h('div', { class: 'outlook-row' }, h('span', { class: 'outlook-label' }, h('span', { 'aria-hidden': 'true' }, icon), label), h('span', {}, ...value));
  const events = s.events.filter((e) => PREVIEW_EVENTS.includes(e.id)).slice(0, 5);
  const special: Record<string, string> = { bankruptcy: '自己破産', home_bought: 'マイホームを買う' };
  const title = (id: string) => special[id] ?? gameData.events.find((e) => e.id === id)?.title ?? id;
  return [
    row('⏳', '寿命', `だいたい ${s.deathAge.low}〜${s.deathAge.high}歳(平均 ${Math.round(s.deathAge.mean)}歳)`),
    s.netWorthAt65
      ? row('🏦', '65歳の純資産', `${manYen(s.netWorthAt65.low)} 〜 ${manYen(s.netWorthAt65.median)} 〜 ${manYen(s.netWorthAt65.high)}`)
      : row('🏦', '65歳の純資産', '65歳まで生きる人生がほとんどない'),
    h('p', { class: 'muted small outlook-note' }, '純資産は少なめ(下位25%)〜ふつう(真ん中)〜多め(上位25%)'),
    row('💍', '結婚', `${pct(s.married)}の人生で結婚・子どもは平均${s.children.toFixed(1)}人`),
    row(
      '🧭',
      'なりやすい人生',
      h(
        'span',
        { class: 'outlook-types' },
        ...s.lifeTypes.map((t) => h('span', {}, `${LIFE_TYPE_ICONS[t.type] ?? ''} ${LIFE_TYPE_LABELS[t.type]} ${pct(t.share)}`)),
      ),
    ),
    row('📌', '起きやすい出来事', events.length > 0 ? events.map((e) => `${title(e.id)} ${pct(e.share)}`).join(' / ') : '大きな出来事は少なめ'),
  ];
}

