// 方針の選択フォーム(キャラ作成と方針変更で共通)
import {
  allocationLabel,
  INVEST_KEYS,
  normalizePolicy,
  POLICY_LABELS,
  type Invest,
  type InvestAllocation,
  type Policy,
  type PolicyInput,
} from '../engine/index';
import { h } from './dom';

type ChoiceKey = 'work' | 'spending' | 'health';

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

function radioGroup<K extends ChoiceKey>(id: string, key: K, label: string, current: Policy): HTMLElement {
  const options = POLICY_LABELS[key] as Record<string, string>;
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
            },
          }),
          h('span', {}, text),
        ),
      ),
    ),
  );
}

/** 投資の配分。積立・個別株・信用/仮想通貨を10%刻みで決め、残りが預金になる */
function allocationEditor(current: Policy): HTMLElement {
  const values: Record<Invest, HTMLElement> = {
    deposit: h('span', { class: 'alloc-value' }),
    index: h('span', { class: 'alloc-value' }),
    stocks: h('span', { class: 'alloc-value' }),
    speculative: h('span', { class: 'alloc-value' }),
  };
  const buttons: HTMLButtonElement[] = [];

  const refresh = () => {
    for (const k of INVEST_KEYS) values[k].textContent = `${current.invest[k]}%`;
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
    if (key === 'deposit') {
      return h('div', { class: 'alloc-row' }, h('span', { class: 'alloc-label' }, `${label}(残り)`), values[key]);
    }
    const minus = h('button', { type: 'button', class: 'btn stepper', 'aria-label': `${label}を減らす`, onclick: () => change(key, -STEP) }, '−');
    const plus = h('button', { type: 'button', class: 'btn stepper', 'aria-label': `${label}を増やす`, onclick: () => change(key, STEP) }, '+');
    buttons.push(minus, plus);
    return h('div', { class: 'alloc-row' }, h('span', { class: 'alloc-label' }, label), minus, values[key], plus);
  };

  const el = h(
    'fieldset',
    { class: 'choice-group' },
    h('legend', {}, '投資の配分(余ったお金の半分をこの割合で回す)'),
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
  );
  refresh();
  return el;
}

/** 方針の入力欄。get() で今の選択を返す */
export function policyForm(initial: PolicyInput | Policy): { el: HTMLElement; get: () => Policy } {
  const id = `policy${formId++}`;
  const current: Policy = normalizePolicy(initial);
  current.invest = { ...current.invest };
  const prepay = h('input', {
    type: 'checkbox',
    checked: current.prepay,
    onchange: (e: Event) => {
      current.prepay = (e.target as HTMLInputElement).checked;
    },
  });
  const el = h(
    'div',
    { class: 'policy-form' },
    ...GROUPS.slice(0, 2).map(({ key, label }) => radioGroup(id, key, label, current)),
    allocationEditor(current),
    h('label', { class: 'check small' }, prepay, ' 繰上げ返済する(投資に回す分で、先にローンと奨学金を返す)'),
    radioGroup(id, 'health', '健康', current),
  );
  return { el, get: () => ({ ...current, invest: { ...current.invest } }) };
}

export function policySummary(p: Policy): string {
  const l = POLICY_LABELS;
  return `働き方:${l.work[p.work]} / 支出:${l.spending[p.spending]} / 投資:${allocationLabel(p)}${p.prepay ? '(繰上げ返済)' : ''} / 健康:${l.health[p.health]}`;
}
