// 方針の選択フォーム(キャラ作成と方針変更で共通)
import {
  allocationLabel,
  INVEST_KEYS,
  normalizePolicy,
  POLICY_LABELS,
  type EducationPolicy,
  type Invest,
  type InvestAllocation,
  type HealthCare,
  type Policy,
  type PolicyInput,
  type Spending,
  type WorkStyle,
} from '../engine/index';
import { append, clear, h } from './dom';
import { POLICY_PRESETS, presetIdOfPolicy } from './presets';
import { educationHelp, healthHelp, investHelp, spendingHelp, workHelp } from './policyHelp';

type ChoiceKey = 'work' | 'spending' | 'health' | 'education';

const GROUPS: { key: ChoiceKey; label: string }[] = [
  { key: 'work', label: '働き方' },
  { key: 'spending', label: '支出' },
  { key: 'health', label: '健康' },
];

/** よく使う配分 */
const PRESETS: { label: string; alloc: InvestAllocation }[] = [
  { label: '預金だけ', alloc: { deposit: 100, index: 0, stocks: 0, speculative: 0 } },
  { label: '積立中心', alloc: { deposit: 30, index: 70, stocks: 0, speculative: 0 } },
  { label: 'バランス', alloc: { deposit: 20, index: 50, stocks: 30, speculative: 0 } },
  { label: '攻め', alloc: { deposit: 0, index: 20, stocks: 50, speculative: 30 } },
];

const STEP = 10;

let formId = 0;

const HELP: Record<ChoiceKey, (v: string) => string> = {
  work: (v) => workHelp(v as WorkStyle),
  spending: (v) => spendingHelp(v as Spending),
  health: (v) => healthHelp(v as HealthCare),
  education: (v) => educationHelp(v as EducationPolicy),
};

function radioGroup<K extends ChoiceKey>(id: string, key: K, label: string, current: Policy, onChange: () => void): HTMLElement {
  const options = POLICY_LABELS[key] as Record<string, string>;
  const help = h('p', { class: 'policy-help muted small' }, HELP[key](current[key]));
  return h(
    'fieldset',
    { class: 'choice-group' },
    h('legend', {}, label),
    h(
      'div',
      { class: 'segmented' },
      ...Object.entries(options).map(([value, text]) =>
        h(
          'label',
          { class: 'segment' },
          h('input', {
            type: 'radio',
            name: `${id}-${key}`,
            value,
            checked: current[key] === value,
            onchange: () => {
              (current as Record<ChoiceKey, string>)[key] = value;
              help.textContent = HELP[key](value);
              onChange();
            },
          }),
          h('span', {}, text),
        ),
      ),
    ),
    help,
  );
}

/** 投資の配分。積立・個別株・信用/仮想通貨を10%刻みで決め、残りが預金になる */
function allocationEditor(current: Policy, onChange: () => void): HTMLElement {
  const values: Record<Invest, HTMLElement> = {
    deposit: h('span', { class: 'alloc-value' }),
    index: h('span', { class: 'alloc-value' }),
    stocks: h('span', { class: 'alloc-value' }),
    speculative: h('span', { class: 'alloc-value' }),
  };
  const buttons: HTMLButtonElement[] = [];

  const refresh = () => {
    for (const k of INVEST_KEYS) values[k].textContent = `${current.invest[k]}%`;
    onChange();
  };
  const change = (key: Exclude<Invest, 'deposit'>, delta: number) => {
    const a = current.invest;
    const next = a[key] + delta;
    if (next < 0 || next > 100) return;
    if (delta > 0 && a.deposit < delta) return; // 預金の分からしか増やせない
    a[key] = next;
    a.deposit -= delta;
    refresh();
  };

  const row = (key: Invest) => {
    const label = POLICY_LABELS.invest[key];
    const name = h('span', { class: 'alloc-label' }, key === 'deposit' ? `${label}(残り)` : label, h('span', { class: 'alloc-help muted' }, investHelp(key)));
    if (key === 'deposit') return h('div', { class: 'alloc-row' }, name, values[key]);
    const minus = h('button', { type: 'button', class: 'btn stepper', 'aria-label': `${label}を減らす`, onclick: () => change(key, -STEP) }, '−');
    const plus = h('button', { type: 'button', class: 'btn stepper', 'aria-label': `${label}を増やす`, onclick: () => change(key, STEP) }, '+');
    buttons.push(minus, plus);
    return h('div', { class: 'alloc-row' }, name, minus, values[key], plus);
  };

  const el = h(
    'fieldset',
    { class: 'choice-group' },
    h('legend', {}, '投資の配分(どこに回すか)'),
    h(
      'div',
      { class: 'segmented' },
      ...PRESETS.map((p) =>
        h(
          'button',
          {
            type: 'button',
            class: 'btn preset',
            onclick: () => {
              current.invest = { ...p.alloc };
              refresh();
            },
          },
          p.label,
        ),
      ),
    ),
    h('div', { class: 'alloc' }, ...INVEST_KEYS.filter((k) => k !== 'deposit').map(row), row('deposit')),
    monthlyEditor(current, onChange),
  );
  refresh();
  return el;
}

/** 積み立てる額: 余ったお金の半分(配分どおり)か、毎月決まった額(万円) */
function monthlyEditor(current: Policy, onChange: () => void): HTMLElement {
  const name = `monthly${formId++}`;
  const input = h('input', {
    type: 'number',
    min: '1',
    step: '1',
    inputmode: 'numeric',
    class: 'monthly-input',
    'aria-label': '毎月の積立額(万円)',
    value: current.investMonthly > 0 ? String(current.investMonthly / 10_000) : '3',
  });
  const help = h('p', { class: 'policy-help muted small' });
  const refresh = () => {
    const fixed = current.investMonthly > 0;
    input.disabled = !fixed;
    help.textContent = fixed
      ? '毎月この額を、積立・個別株・信用/仮想通貨の比で買う(配分の「預金」は使わない)。赤字の月も、預金があるうちは続ける'
      : '毎月、余ったお金の半分を上の配分どおりに回す(赤字の月は積み立てない)';
  };
  const fromInput = () => {
    const man = Number(input.value);
    current.investMonthly = Number.isFinite(man) && man > 0 ? Math.round(man) * 10_000 : 10_000;
  };
  const radio = (fixed: boolean, text: string) =>
    h(
      'label',
      { class: 'segment' },
      h('input', {
        type: 'radio',
        name,
        checked: (current.investMonthly > 0) === fixed,
        onchange: () => {
          if (fixed) fromInput();
          else current.investMonthly = 0;
          refresh();
          onChange();
        },
      }),
      h('span', {}, text),
    );
  input.addEventListener('change', () => {
    fromInput();
    input.value = String(current.investMonthly / 10_000);
    onChange();
  });
  refresh();
  return h(
    'div',
    { class: 'monthly' },
    h('p', { class: 'small' }, '積み立てる額'),
    h('div', { class: 'segmented' }, radio(false, '余ったお金の半分'), radio(true, '毎月決まった額')),
    h('div', { class: 'monthly-row' }, h('span', { class: 'small' }, '毎月'), input, h('span', { class: 'small' }, '万円')),
    help,
  );
}

/** 今の状況で意味のない項目は出さない(値は今のまま残す) */
export interface PolicyFormOptions {
  showPrepay?: boolean; // ローンか奨学金があるとき
  showEducation?: boolean; // 結婚しているか子どもがいるとき
}

/**
 * 方針の入力欄。上にボタン1つで選べるプリセット、下の「細かく決める」で1項目ずつ。
 * get() で今の選択を返し、set() で外から(タイプを選んだときなど)まとめて変える
 */
export function policyForm(
  initial: PolicyInput | Policy,
  opts: PolicyFormOptions = { showPrepay: true, showEducation: true },
): { el: HTMLElement; get: () => Policy; set: (p: Omit<Policy, 'prepay' | 'education' | 'investMonthly'>) => void } {
  const id = `policy${formId++}`;
  const current: Policy = normalizePolicy(initial);
  current.invest = { ...current.invest };
  const presetButtons = POLICY_PRESETS.map((p) =>
    h('button', { type: 'button', class: 'btn preset', onclick: () => set(p.policy) }, p.label),
  );
  const presetHelp = h('p', { class: 'policy-help muted small' });
  const detailBody = h('div', { class: 'policy-detail' });

  const refreshPresets = () => {
    const selected = presetIdOfPolicy(current);
    presetButtons.forEach((b, i) => b.setAttribute('aria-pressed', POLICY_PRESETS[i]!.id === selected ? 'true' : 'false'));
    presetHelp.textContent = POLICY_PRESETS.find((p) => p.id === selected)?.description ?? '自分で決めた方針';
  };

  const rebuild = () => {
    clear(detailBody);
    const prepay = h('input', {
      type: 'checkbox',
      checked: current.prepay,
      onchange: (e: Event) => {
        current.prepay = (e.target as HTMLInputElement).checked;
      },
    });
    append(detailBody, [
      ...GROUPS.slice(0, 2).map(({ key, label }) => radioGroup(id, key, label, current, refreshPresets)),
      allocationEditor(current, refreshPresets),
      opts.showPrepay ? h('label', { class: 'check small' }, prepay, ' 繰上げ返済する(余ったお金で、先にローンと奨学金を返す)') : null,
      radioGroup(id, 'health', '健康', current, refreshPresets),
      opts.showEducation ? radioGroup(id, 'education', '子どもの教育', current, refreshPresets) : null,
    ]);
    refreshPresets();
  };

  function set(p: Omit<Policy, 'prepay' | 'education' | 'investMonthly'>): void {
    current.work = p.work;
    current.spending = p.spending;
    current.health = p.health;
    current.invest = { ...p.invest };
    rebuild();
  }

  const el = h(
    'div',
    { class: 'policy-form' },
    h('div', { class: 'segmented presets' }, ...presetButtons),
    presetHelp,
    h('details', { class: 'fine-tune' }, h('summary', {}, '細かく決める'), detailBody),
  );
  rebuild();
  return { el, get: () => ({ ...current, invest: { ...current.invest } }), set };
}

export function policySummary(p: Policy, opts: PolicyFormOptions = { showPrepay: true, showEducation: true }): string {
  const l = POLICY_LABELS;
  const prepay = opts.showPrepay && p.prepay ? '(繰上げ返済)' : '';
  const education = opts.showEducation ? ` / 教育:${l.education[p.education]}` : '';
  return `働き方:${l.work[p.work]} / 支出:${l.spending[p.spending]} / 投資:${allocationLabel(p)}${prepay} / 健康:${l.health[p.health]}${education}`;
}

/** ゲームの状態から、方針の画面に出す項目を決める */
export function policyOptionsFor(state: {
  assets: { loan?: number; studentLoan: number };
  character: { married: boolean; children?: unknown[] };
}): PolicyFormOptions {
  return {
    showPrepay: (state.assets.loan ?? 0) > 0 || state.assets.studentLoan > 0,
    showEducation: state.character.married || (state.character.children?.length ?? 0) > 0,
  };
}
