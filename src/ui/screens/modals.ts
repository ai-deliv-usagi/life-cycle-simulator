// イベント・選択結果・年間サマリー・方針変更のモーダル
import { availableChoices, gameData, ledgerTotals, type GameState, type LogEntry, type Policy, type YearLedger } from '../../engine/index';
import { h, openModal } from '../dom';
import { ageMonthLabel, healthWord, manYen, signedManYen, signedPercent } from '../format';
import { balanceSheet, ledgerTable, liabilitiesAndNet } from '../finance';
import { policyForm } from '../policyForm';

const CHOICE_RESULT_MS = 1200;
const SUMMARY_AUTO_CLOSE_MS = 1500;

/** 選択肢イベント。選んだ選択肢の index(events.json での位置)を返す */
export function eventModal(state: GameState): Promise<number> {
  const ev = gameData.events.find((e) => e.id === state.pendingEvent?.eventId);
  if (!ev) return Promise.reject(new Error('pending event not found'));
  return new Promise((resolve) => {
    let close = () => {};
    const content = h(
      'div',
      { class: 'event' },
      h('p', { class: 'event-age muted' }, ageMonthLabel(state.ageMonths, state.month)),
      h('h2', {}, ev.title),
      h('p', { class: 'event-text' }, ev.text),
      h(
        'div',
        { class: 'choices' },
        ...availableChoices(ev, state).map(({ choice, index }) =>
          h(
            'button',
            {
              class: 'btn choice',
              onclick: () => {
                close();
                resolve(index);
              },
            },
            choice.label,
          ),
        ),
      ),
    );
    close = openModal(content);
  });
}

/** 選んだ結果(ログの最後の choice)を少しだけ見せる */
export function choiceResultModal(state: GameState): Promise<void> {
  const last = [...state.log].reverse().find((e) => e.type === 'choice');
  if (!last) return Promise.resolve();
  const outcome = last.text.includes(' → ') ? last.text.split(' → ').at(-1)! : '';
  if (!outcome) return Promise.resolve(); // 確率分岐がない選択は結果を出さない
  return new Promise((resolve) => {
    const close = openModal(h('div', { class: 'event result-flash' }, h('p', { class: 'event-text big' }, outcome)));
    setTimeout(() => {
      close();
      resolve();
    }, CHOICE_RESULT_MS);
  });
}

/** 年間サマリーに出す「収入・支出・収支」の3行 */
function yearBalanceRows(l: YearLedger): HTMLElement[] {
  const t = ledgerTotals(l);
  const net = t.income - t.expenses;
  return [
    h('dt', {}, '年間の収入'),
    h('dd', {}, manYen(t.income)),
    h('dt', {}, '年間の支出'),
    h('dd', {}, manYen(t.expenses)),
    h('dt', {}, '収支'),
    h('dd', { class: net >= 0 ? 'up' : 'down' }, signedManYen(net)),
  ];
}

export interface YearSummaryInfo {
  financial: number;
  previousFinancial: number;
  events: LogEntry[];
}

export function yearSummaryModal(state: GameState, info: YearSummaryInfo, autoClose: boolean): Promise<void> {
  const age = Math.floor(state.ageMonths / 12);
  const years = state.month / 12;
  const diff = info.financial - info.previousFinancial;
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let close = () => {};
    const done = () => {
      if (timer) clearTimeout(timer);
      close();
      resolve();
    };
    const content = h(
      'div',
      { class: 'year-summary' },
      h('h2', {}, `${age}歳`, h('span', { class: 'muted' }, `(${years}年目)`)),
      h(
        'dl',
        { class: 'summary-list' },
        h('dt', {}, '健康状態'),
        h('dd', {}, healthWord(state.stats.health)),
        h('dt', {}, '金融資産'),
        h('dd', {}, manYen(info.financial), h('span', { class: diff >= 0 ? 'up' : 'down' }, `(${signedManYen(diff)})`)),
        ...(state.lastLedger ? yearBalanceRows(state.lastLedger) : []),
      ),
      info.events.length > 0
        ? h('ul', { class: 'summary-events' }, ...info.events.map((e) => h('li', {}, e.text.split(':')[0] ?? e.text)))
        : h('p', { class: 'muted' }, '大きな出来事のない1年だった。'),
      state.lastLedger
        ? h(
            'details',
            {
              class: 'summary-details',
              ontoggle: (e: Event) => {
                // 開いたら自動で閉じない
                if ((e.target as HTMLDetailsElement).open && timer) clearTimeout(timer);
              },
            },
            h('summary', {}, 'この1年の収支とバランスシート'),
            ledgerTable(state.lastLedger),
            h('h3', {}, 'バランスシート(年末時点)'),
            balanceSheet(state),
          )
        : null,
      h('button', { class: 'btn primary', onclick: done }, '次の年へ'),
    );
    close = openModal(content);
    if (autoClose) timer = setTimeout(done, SUMMARY_AUTO_CLOSE_MS);
  });
}

/** 方針変更。確定なら新しい方針、キャンセルなら null */
export function policyModal(current: Policy): Promise<Policy | null> {
  return new Promise((resolve) => {
    const form = policyForm(current);
    let close = () => {};
    const content = h(
      'div',
      { class: 'policy-modal' },
      h('h2', {}, '方針を変える'),
      h('p', { class: 'muted small' }, '次の月から反映される。'),
      form.el,
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            class: 'btn',
            onclick: () => {
              close();
              resolve(null);
            },
          },
          'キャンセル',
        ),
        h(
          'button',
          {
            class: 'btn primary',
            onclick: () => {
              close();
              resolve(form.get());
            },
          },
          'この方針にする',
        ),
      ),
    );
    close = openModal(content);
  });
}

/** 金融資産の内訳と運用成績 */
export function assetsModal(state: GameState): Promise<void> {
  const a = state.assets;
  const inv = state.invested;
  const rows: { label: string; value: number; principal?: number }[] = [
    { label: '預金', value: a.cash },
    { label: '積立', value: a.index, principal: inv?.index },
    { label: '個別株', value: a.stocks, principal: inv?.stocks },
    { label: '信用・仮想通貨', value: a.speculative, principal: inv?.speculative },
  ];
  const total = rows.reduce((s, r) => s + r.value, 0);
  const investedTotal = inv ? inv.index + inv.stocks + inv.speculative : undefined;
  const investedValue = a.index + a.stocks + a.speculative;

  const gainCell = (value: number, principal: number | undefined) => {
    if (principal === undefined) return h('td', { class: 'muted' }, '—');
    if (principal === 0 && value === 0) return h('td', { class: 'muted' }, '—');
    const gain = value - principal;
    return h(
      'td',
      { class: gain >= 0 ? 'up' : 'down' },
      signedManYen(gain),
      principal > 0 ? h('span', { class: 'pct small' }, signedPercent(gain / principal)) : '',
    );
  };

  return new Promise((resolve) => {
    let close = () => {};
    const content = h(
      'div',
      { class: 'assets-modal' },
      h('h2', {}, '資産と負債'),
      h('h3', {}, '資産'),
      h(
        'table',
        { class: 'asset-table' },
        h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, '残高'), h('th', {}, '元本'), h('th', {}, '損益'))),
        h(
          'tbody',
          {},
          ...rows.map((r) =>
            h(
              'tr',
              {},
              h('th', {}, r.label),
              h('td', {}, manYen(r.value)),
              h('td', { class: 'muted' }, r.principal === undefined ? '—' : manYen(r.principal)),
              r.principal === undefined ? h('td', { class: 'muted' }, '—') : gainCell(r.value, r.principal),
            ),
          ),
          h(
            'tr',
            { class: 'total' },
            h('th', {}, '合計'),
            h('td', {}, manYen(total)),
            h('td', { class: 'muted' }, investedTotal === undefined ? '—' : manYen(investedTotal + a.cash)),
            gainCell(investedValue, investedTotal),
          ),
        ),
      ),
      liabilitiesAndNet(state),
      state.ledger ? h('details', { class: 'summary-details' }, h('summary', {}, '今年のここまでの収支'), ledgerTable(state.ledger)) : null,
      inv === undefined ? h('p', { class: 'muted small' }, '古いセーブデータのため、元本と損益は表示できない。') : null,
      h('p', { class: 'muted small' }, '元本はつぎ込んだ金額。損益は今の残高との差。'),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: () => {
            close();
            resolve();
          },
        },
        '閉じる',
      ),
    );
    close = openModal(content, { dismissible: true });
  });
}
