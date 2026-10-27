// キャラ作成画面: 初期ガチャ・価値観・初期方針
import {
  createGame,
  createRng,
  deriveSeed,
  HAPPINESS_PARTS,
  happinessWeights,
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
  HAPPINESS_PART_LABELS,
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

/** 見通しで自動プレイする人生の数(1人生 約0.15秒。待たせすぎない数に) */
const PREVIEW_LIVES = 12;

const DEFAULT_POLICY: PolicyInput = {
  work: 'normal',
  spending: 'normal',
  invest: { deposit: 30, index: 70, stocks: 0, speculative: 0 },
  health: 'normal',
};

/** 価値観は5段階(-2〜+2)。数字ではなく「やや安定志向」のように言葉で出す */
function valueSlider(axis: (typeof VALUE_AXES)[number], values: Values, onChange: () => void): HTMLElement {
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
      onChange();
    },
  });
  return h(
    'div',
    { class: 'slider' },
    h('div', { class: 'slider-labels' }, h('span', {}, axis.left), output, h('span', {}, axis.right)),
    input,
  );
}

/** 入力するカード(色の付いた枠)。見出しの下に、何を決めるのかを1行で */
function inputCard(title: string, lead: string, ...children: (HTMLElement | string | null)[]): HTMLElement {
  return h(
    'section',
    { class: 'card input-card' },
    h('div', { class: 'card-head' }, h('h2', {}, title)),
    lead ? h('p', { class: 'muted small card-lead' }, lead) : null,
    ...children,
  );
}

/** 価値観から「幸せを感じやすいもの」(重みが大きい幸福度の要素)を言葉で */
function happyFrom(values: Values): string {
  const w = happinessWeights(values);
  const strong = HAPPINESS_PARTS.filter((p) => w[p] >= STRONG_WEIGHT).map((p) => HAPPINESS_PART_LABELS[p]);
  return strong.length > 0 ? `${strong.join('・')}を大事にする` : 'どれも同じくらい大事にする';
}

/** これ以上の重みの要素を「大事にする」と出す */
const STRONG_WEIGHT = 1.2;

/** キャラ作成は2ステップ: ①生まれ(ガチャの結果を見るだけ)→ ②あなたが決めること(名前・価値観・方針) */
export function setupScreen(root: HTMLElement, nav: Nav, seed: number): void {
  const roll = rollCharacter(seed);
  const values: Values = { risk: 0, relation: 0, spending: 0, work: 0 };
  // 最初は独身で子どももいないので、子どもの教育は出さない。繰上げ返済は奨学金があるときだけ
  const policy = policyForm(DEFAULT_POLICY, { showPrepay: roll.studentLoan !== null, showEducation: false });
  const nameInput = h('input', { type: 'text', value: '名無しさん', maxlength: 20, 'aria-label': '名前' });
  const sliderBox = h('div', { class: 'value-sliders' });
  // 幸福度の感じ方(価値観が変わるたびに更新)
  const happyLine = h('p', { class: 'happy-from small' });
  const updateHappyLine = () => {
    happyLine.textContent = `幸福度: ${happyFrom(values)}`;
  };
  const rebuildSliders = () => {
    clear(sliderBox);
    append(sliderBox, VALUE_AXES.map((axis) => valueSlider(axis, values, updateHappyLine)));
    updateHappyLine();
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
      typeHelp.textContent = 'おまかせで決めた。下の方針は「バランス」にした。';
      policy.set(POLICY_PRESETS.find((p) => p.id === 'balance')!.policy);
    } else {
      const t = VALUE_PRESETS[index]!;
      Object.assign(values, t.values);
      const p = POLICY_PRESETS.find((x) => x.id === t.policy)!;
      typeHelp.textContent = `${t.description}。下の方針は、このタイプに合う「${p.label}」にした。`;
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
        inputCard('名前', '', nameInput),
        inputCard(
          '① あなたのタイプ',
          '何に幸せを感じる人か。幸福度の感じ方が変わる(お金の多さだけでは決まらない)。',
          h('div', { class: 'segmented presets' }, ...typeButtons),
          typeHelp,
          happyLine,
          h(
            'details',
            { class: 'fine-tune' },
            h('summary', {}, '価値観を細かく決める'),
            h('p', { class: 'muted small' }, '人生の中の選択で、少しずつ変わっていく。'),
            sliderBox,
          ),
        ),
        inputCard('② 暮らし方の方針', '働き方・お金の使い方・貯金と投資・健康。途中でいつでも変えられる。', policy.el),
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
          `この生まれと方針で${PREVIEW_LIVES}回、試しに生きてみたざっくりの見通し。本番は運と選択しだい。`,
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

/** 見通しの中身: ざっくり4行(細かい数字は出さない) */
function outlookContent(s: PreviewSummary): HTMLElement[] {
  const row = (icon: string, label: string, value: string) =>
    h('div', { class: 'outlook-row' }, h('span', { class: 'outlook-label' }, h('span', { 'aria-hidden': 'true' }, icon), label), h('span', {}, value));
  const married = s.married >= 0.7 ? '結婚することが多い' : s.married >= 0.4 ? '結婚するかは半々' : '独身のことが多い';
  const types = s.lifeTypes.slice(0, 2).map((t) => `${LIFE_TYPE_ICONS[t.type] ?? ''} ${LIFE_TYPE_LABELS[t.type]}`);
  return [
    row('⏳', '寿命', `だいたい${Math.round(s.deathAge.mean)}歳`),
    row('🏦', '65歳の資産', s.netWorthAt65 ? `${manYen(s.netWorthAt65.median)}くらい` : '65歳まで生きないことが多い'),
    row('💍', '結婚', married),
    row('🧭', 'なりやすい人生', types.join(' / ')),
  ];
}
