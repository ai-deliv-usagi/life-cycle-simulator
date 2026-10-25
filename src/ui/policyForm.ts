// 方針4項目の選択フォーム(キャラ作成と方針変更で共通)
import { POLICY_LABELS, type Policy } from '../engine/index';
import { h } from './dom';

const GROUPS: { key: keyof Policy; label: string }[] = [
  { key: 'work', label: '働き方' },
  { key: 'spending', label: '支出' },
  { key: 'invest', label: '投資' },
  { key: 'health', label: '健康' },
];

let formId = 0;

/** 方針のラジオボタン。get() で今の選択を返す */
export function policyForm(initial: Policy): { el: HTMLElement; get: () => Policy } {
  const id = `policy${formId++}`;
  const current: Policy = { ...initial };
  const el = h(
    'div',
    { class: 'policy-form' },
    ...GROUPS.map(({ key, label }) => {
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
                  (current as Record<keyof Policy, string>)[key] = value;
                },
              }),
              h('span', {}, text),
            ),
          ),
        ),
      );
    }),
  );
  return { el, get: () => ({ ...current }) };
}

export function policySummary(p: Policy): string {
  const l = POLICY_LABELS;
  return `働き方:${l.work[p.work]} / 支出:${l.spending[p.spending]} / 投資:${l.invest[p.invest]} / 健康:${l.health[p.health]}`;
}
