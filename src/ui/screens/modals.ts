// イベント・選択結果・年間サマリー・方針変更のモーダル
import { availableChoices, gameData, getMonthlyView, ledgerTotals, type GameState, type LogEntry, type Policy, type YearLedger } from '../../engine/index';
import { assetMixChart, assetMixPoints } from '../charts';
import { h, openModal } from '../dom';
import { ageMonthLabel, calendarMonth, healthWord, manYen, signedManYen, signedPercent } from '../format';
import { balanceSheet, ledgerTable, liabilitiesAndNet, monthIncomeTable, yearIncomeTable } from '../finance';
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

/** 年末の金融資産の内訳グラフ。モーダルを開いたあとに描き、戻り値で片づける */
function assetMixSection(state: GameState): { el: HTMLElement | null; draw: () => () => void } {
  const points = assetMixPoints(state.log);
  if (points.length === 0) return { el: null, draw: () => () => {} };
  const canvas = h('canvas', { 'aria-label': '金融資産の内訳の推移グラフ' });
  const el = h('div', { class: 'asset-mix' }, h('h3', {}, '金融資産の内訳(年末)'), h('div', { class: 'chart-box' }, canvas));
  return {
    el,
    draw: () => {
      const chart = assetMixChart(canvas, points);
      return () => chart.destroy();
    },
  };
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
  const mix = assetMixSection(state);
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let close = () => {};
    let destroyChart = () => {};
    const done = () => {
      if (timer) clearTimeout(timer);
      close();
      destroyChart();
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
      mix.el,
      h('button', { class: 'btn primary', onclick: done }, '次の年へ'),
    );
    close = openModal(content);
    destroyChart = mix.draw();
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
  const mix = assetMixSection(state);

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
      mix.el,
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
    let destroyChart = () => {};
    close = openModal(content, {
      dismissible: true,
      onClose: () => {
        destroyChart();
        resolve(); // 外側をクリックして閉じたときも再開できるように
      },
    });
    destroyChart = mix.draw();
  });
}

/** 今年のここまでの収入。年が明けた直後でまだ何もなければ、去年1年間の分を出す */
function yearIncome(state: GameState): HTMLElement[] {
  const current = state.ledger && ledgerTotals(state.ledger).income > 0 ? state.ledger : undefined;
  if (current) return [h('h3', {}, '今年のここまでの収入'), yearIncomeTable(current)];
  if (state.lastLedger) return [h('h3', {}, '去年1年間の収入'), yearIncomeTable(state.lastLedger)];
  return [];
}

/** 収入の内訳: 今月の分と、今年のここまでの分 */
export function incomeModal(state: GameState): Promise<void> {
  const v = getMonthlyView(state);
  return new Promise((resolve) => {
    let close = () => {};
    const content = h(
      'div',
      { class: 'income-modal' },
      h('h2', {}, '収入の内訳'),
      v.annualGross > 0 ? h('p', { class: 'muted small' }, `本人の額面年収(ボーナス込み) ${manYen(v.annualGross)}`) : null,
      h('h3', {}, `今月(${calendarMonth(state.month)}月)の手取り`),
      monthIncomeTable(v.income),
      ...yearIncome(state),
      h('p', { class: 'muted small' }, 'ボーナスは6月と12月に入る。配偶者の収入には、扶養に入れたことによる税金の軽減も含む。'),
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
    close = openModal(content, { dismissible: true, onClose: () => resolve() });
  });
}
