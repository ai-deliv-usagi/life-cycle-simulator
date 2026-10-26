// 収支表とバランスシート(年間サマリーと資産の画面で共通)
import { ledgerTotals, type ExpenseKey, type GameState, type IncomeKey, type MonthlyIncome, type YearLedger } from '../engine/index';
import { h } from './dom';
import { manYen, signedManYen, yen } from './format';

const INCOME_LABELS: Record<IncomeKey, string> = {
  salary: '給料(手取り)',
  bonus: 'ボーナス(手取り)',
  pension: '年金(手取り)',
  unemployment: '失業給付',
  spouse: '配偶者の収入',
  family: '実家からの仕送り',
  severance: '退職金',
};

const EXPENSE_LABELS: Record<ExpenseKey, string> = {
  living: '生活費(家賃込み)',
  car: '車の維持費',
  health: '健康のための出費',
  remittance: '実家への送金',
  parentSupport: '親への仕送り',
  studentLoan: '奨学金の返済',
  loan: 'ローンの返済',
};

function row(label: string, value: string, cls = ''): HTMLElement {
  return h('tr', { class: cls }, h('th', {}, label), h('td', {}, value));
}

/** 年間の収入と支出の内訳(0円の行は出さない) */
export function ledgerTable(l: YearLedger): HTMLElement {
  const t = ledgerTotals(l);
  const incomeRows = (Object.keys(INCOME_LABELS) as IncomeKey[])
    .filter((k) => l.income[k] > 0)
    .map((k) => row(INCOME_LABELS[k], manYen(l.income[k])));
  if (l.eventIn > 0) incomeRows.push(row('臨時収入(イベント)', manYen(l.eventIn)));
  if ((l.welfare ?? 0) > 0) incomeRows.push(row('生活保護', manYen(l.welfare ?? 0)));
  const expenseRows = (Object.keys(EXPENSE_LABELS) as ExpenseKey[])
    .filter((k) => l.expenses[k] > 0)
    .map((k) => row(EXPENSE_LABELS[k], manYen(l.expenses[k])));
  if (l.debtInterest > 0) expenseRows.push(row('カードローンの利息', manYen(l.debtInterest)));
  if (l.eventOut > 0) expenseRows.push(row('臨時の出費(イベント)', manYen(l.eventOut)));
  const net = t.income - t.expenses;

  return h(
    'div',
    { class: 'finance' },
    h('h3', {}, '収入'),
    h('table', { class: 'fin-table' }, h('tbody', {}, ...incomeRows, row('合計', manYen(t.income), 'total'))),
    h('h3', {}, '支出'),
    h('table', { class: 'fin-table' }, h('tbody', {}, ...expenseRows, row('合計', manYen(t.expenses), 'total'))),
    h(
      'table',
      { class: 'fin-table' },
      h(
        'tbody',
        {},
        h('tr', { class: 'total' }, h('th', {}, '収支'), h('td', { class: net >= 0 ? 'up' : 'down' }, signedManYen(net))),
        l.invested > 0 ? row('うち投資に回した額', manYen(l.invested)) : null,
        l.prepaid > 0 ? row('うち繰上げ返済した額', manYen(l.prepaid)) : null,
        l.returns !== undefined
          ? h('tr', {}, h('th', {}, '運用損益(値動き・利息)'), h('td', { class: l.returns >= 0 ? 'up' : 'down' }, signedManYen(l.returns)))
          : null,
      ),
    ),
    l.returns !== undefined
      ? h('p', { class: 'muted small' }, '収支がマイナスでも、運用益がそれを上回れば金融資産は増える。')
      : null,
  );
}

/** 今月の収入の内訳(0円の行は出さない) */
export function monthIncomeTable(income: MonthlyIncome): HTMLElement {
  const rows = (Object.keys(INCOME_LABELS) as IncomeKey[])
    .flatMap((k) => (k !== 'severance' && income[k] > 0 ? [row(INCOME_LABELS[k], yen(income[k]))] : []));
  return h(
    'table',
    { class: 'fin-table' },
    h('tbody', {}, ...(rows.length > 0 ? rows : [row('収入', 'なし')]), row('合計', yen(income.total), 'total')),
  );
}

/** 今年の収入の内訳(イベントの臨時収入と生活保護も含む) */
export function yearIncomeTable(l: YearLedger): HTMLElement {
  const rows = (Object.keys(INCOME_LABELS) as IncomeKey[])
    .filter((k) => l.income[k] > 0)
    .map((k) => row(INCOME_LABELS[k], manYen(l.income[k])));
  if (l.eventIn > 0) rows.push(row('臨時収入(イベント)', manYen(l.eventIn)));
  if ((l.welfare ?? 0) > 0) rows.push(row('生活保護', manYen(l.welfare ?? 0)));
  return h(
    'table',
    { class: 'fin-table' },
    h('tbody', {}, ...(rows.length > 0 ? rows : [row('収入', 'なし')]), row('合計', manYen(ledgerTotals(l).income), 'total')),
  );
}

/** バランスシート: 資産・負債・純資産 */
export function balanceSheet(state: GameState): HTMLElement {
  const a = state.assets;
  const loan = a.loan ?? 0;
  const assetRows: [string, number][] = [
    ['預金', a.cash],
    ['積立', a.index],
    ['個別株', a.stocks],
    ['信用・仮想通貨', a.speculative],
  ];
  const debtRows: [string, number][] = [
    ['カードローン', a.debt],
    ['ローン', loan],
    ['奨学金', a.studentLoan],
  ];
  const totalAssets = assetRows.reduce((s, [, v]) => s + v, 0);
  const totalDebts = debtRows.reduce((s, [, v]) => s + v, 0);
  const net = totalAssets - totalDebts;

  const side = (title: string, rows: [string, number][], total: number) =>
    h(
      'div',
      { class: 'bs-side' },
      h('h3', {}, title),
      h(
        'table',
        { class: 'fin-table' },
        h('tbody', {}, ...rows.filter(([, v]) => v !== 0).map(([k, v]) => row(k, manYen(v))), row('合計', manYen(total), 'total')),
      ),
    );

  return h(
    'div',
    { class: 'balance-sheet' },
    h('div', { class: 'bs-grid' }, side('資産', assetRows, totalAssets), side('負債', debtRows, totalDebts)),
    h(
      'table',
      { class: 'fin-table' },
      h('tbody', {}, h('tr', { class: 'total' }, h('th', {}, '純資産(資産 − 負債)'), h('td', { class: net >= 0 ? '' : 'down' }, manYen(net)))),
    ),
  );
}

/** 負債と純資産(資産の内訳と並べて出す用) */
export function liabilitiesAndNet(state: GameState): HTMLElement {
  const a = state.assets;
  const loan = a.loan ?? 0;
  const rows: [string, number, string][] = [
    ['カードローン', a.debt, ''],
    ['ローン', loan, loan > 0 ? `毎月${manYen(state.character.loanPayment ?? 0)}` : ''],
    ['奨学金', a.studentLoan, ''],
  ];
  const totalDebts = a.debt + loan + a.studentLoan;
  const net = a.cash + a.index + a.stocks + a.speculative - totalDebts;
  return h(
    'div',
    { class: 'finance' },
    h('h3', {}, '負債'),
    h(
      'table',
      { class: 'fin-table' },
      h(
        'tbody',
        {},
        ...rows.map(([k, v, note]) => row(note ? `${k}(${note})` : k, v > 0 ? manYen(v) : 'なし')),
        row('合計', manYen(totalDebts), 'total'),
      ),
    ),
    h(
      'table',
      { class: 'fin-table' },
      h('tbody', {}, h('tr', { class: 'total' }, h('th', {}, '純資産(資産 − 負債)'), h('td', { class: net >= 0 ? '' : 'down' }, manYen(net)))),
    ),
  );
}
