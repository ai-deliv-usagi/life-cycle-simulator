// イベント・選択結果・年間サマリー・方針変更のモーダル
import { availableChoices, choiceCost, gameData, businessValue, getMonthlyView, HAPPINESS_PARTS, happinessParts, happinessWeights, ledgerTotals, nisaRoom, nisaValue, type ChoiceCost, type GameState, type InvestKey, type LogEntry, type Policy, type YearLedger } from '../../engine/index';
import { assetMixChart, assetMixPoints } from '../charts';
import { append, clear, h, openModal } from '../dom';
import { ageMonthLabel, calendarMonth, HAPPINESS_PART_LABELS, healthWord, manYen, signedManYen, signedPercent } from '../format';
import { balanceSheet, ledgerTable, liabilitiesAndNet, monthIncomeTable, yearIncomeTable } from '../finance';
import { policyForm, type PolicyFormOptions } from '../policyForm';

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
        'p',
        { class: 'event-wallet muted small' },
        `いまの預金 ${manYen(state.assets.cash)}(金融資産 ${manYen(financialTotal(state))})`,
      ),
      h(
        'div',
        { class: 'choices' },
        ...availableChoices(ev, state).map(({ choice, index }) => {
          const hint = costHint(choiceCost(ev, choice, state), choice.label);
          return h(
            'button',
            {
              class: 'btn choice',
              onclick: () => {
                close();
                resolve(index);
              },
            },
            h('span', {}, choice.label),
            hint ? h('span', { class: 'choice-hint small' }, hint) : null,
          );
        }),
      ),
    );
    close = openModal(content);
  });
}

function financialTotal(state: GameState): number {
  const a = state.assets;
  return a.cash + a.index + a.stocks + a.speculative;
}

/** 選択肢の下に出す金額の目安。ラベルにもう金額が書いてあれば出さない */
function costHint(cost: ChoiceCost, label: string): string {
  if (cost.homePrice !== undefined) {
    return `${manYen(cost.homePrice)}の家・頭金と諸費用 約${manYen(cost.spend)}・住宅ローン ${manYen(cost.borrow)}`;
  }
  if (label.includes('円')) return '';
  const parts = [cost.spend > 0 ? `約${manYen(cost.spend)}` : '', cost.borrow > 0 ? `借りる額 ${manYen(cost.borrow)}` : ''];
  return parts.filter(Boolean).join('・');
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
export function policyModal(current: Policy, opts?: PolicyFormOptions): Promise<Policy | null> {
  return new Promise((resolve) => {
    const form = policyForm(current, opts);
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

/** 資産の画面で売り買いする。どちらも操作したあとの state を返す */
export interface Trade {
  sell(key: InvestKey, amount: number, from: SellFrom): GameState;
  buy(key: InvestKey, amount: number): GameState;
}
type SellFrom = 'auto' | 'taxable' | 'nisa';

/** 金融資産の内訳と運用成績。trade があれば投資を売り買いできる */
export function assetsModal(initial: GameState, trade?: Trade): Promise<void> {
  return new Promise((resolve) => {
    let close = () => {};
    let destroyChart = () => {};
    const body = h('div', { class: 'assets-modal' });

    const render = (state: GameState) => {
      destroyChart();
      clear(body);
      const actions = trade
        ? {
            sell: (key: InvestKey, amount: number, from: SellFrom) => render(trade.sell(key, amount, from)),
            buy: (key: InvestKey, amount: number) => render(trade.buy(key, amount)),
          }
        : undefined;
      const mix = assetsContent(state, body, actions, () => close());
      destroyChart = mix.draw();
    };

    close = openModal(body, {
      dismissible: true,
      onClose: () => {
        destroyChart();
        resolve(); // 外側をクリックして閉じたときも再開できるように
      },
    });
    render(initial);
  });
}

const INVEST_ROWS: { key: InvestKey; label: string }[] = [
  { key: 'index', label: '積立' },
  { key: 'stocks', label: '個別株' },
  { key: 'speculative', label: '信用・仮想通貨' },
];

/** 金額(万円)の入力欄と、「全部」「半分」のボタン */
function amountForm(opts: {
  title: string;
  max: number;
  verb: string;
  extra?: HTMLElement | null;
  note?: string;
  submit: (amount: number) => void;
  cancel: () => void;
}): HTMLElement {
  const input = h('input', { type: 'number', min: '1', step: '1', inputmode: 'numeric', 'aria-label': `${opts.title}(万円)` });
  const error = h('p', { class: 'down small' });
  const byInput = () => {
    const man = Number(input.value);
    if (!Number.isFinite(man) || man <= 0) {
      error.textContent = `${opts.verb}額を万円で入れてください`;
      return;
    }
    opts.submit(Math.min(opts.max, man * 10_000));
  };
  return h(
    'div',
    { class: 'sell-form' },
    h('p', { class: 'small' }, opts.title),
    opts.extra ?? null,
    h(
      'div',
      { class: 'sell-buttons' },
      h('button', { class: 'btn', onclick: () => opts.submit(opts.max) }, '全部'),
      h('button', { class: 'btn', onclick: () => opts.submit(Math.round(opts.max / 2)) }, '半分'),
    ),
    h(
      'div',
      { class: 'sell-input' },
      input,
      h('span', {}, '万円'),
      h('button', { class: 'btn primary', onclick: byInput }, opts.verb),
      h('button', { class: 'btn', onclick: opts.cancel }, 'やめる'),
    ),
    opts.note ? h('p', { class: 'muted small' }, opts.note) : null,
    error,
  );
}

/** 売る欄。NISAと特定口座の両方にあるときは、どちらから売るかを選べる */
function sellForm(state: GameState, key: InvestKey, label: string, sell: (amount: number, from: SellFrom) => void, cancel: () => void): HTMLElement {
  const held = state.assets[key];
  const nisa = nisaValue(state, key);
  const taxable = held - nisa;
  let from: SellFrom = 'auto';
  let max = held;
  const name = `sell-from-${key}`;
  const option = (value: SellFrom, text: string, amount: number) =>
    h(
      'label',
      { class: 'segment' },
      h('input', {
        type: 'radio',
        name,
        value,
        checked: value === 'auto',
        onchange: () => {
          from = value;
          max = amount;
        },
      }),
      h('span', {}, text),
    );
  const choose =
    nisa > 0 && taxable > 0
      ? h(
          'div',
          { class: 'segmented' },
          option('auto', '特定口座から先に', held),
          option('taxable', `特定口座だけ(${manYen(taxable)})`, taxable),
          option('nisa', `NISAだけ(${manYen(nisa)})`, nisa),
        )
      : null;
  return amountForm({
    title: `${label}を売って預金にする(持っている額 ${manYen(held)}${nisa > 0 ? `、うちNISA ${manYen(nisa)}` : ''})`,
    max: held,
    verb: '売る',
    extra: choose,
    note: taxable > 0 ? '特定口座の利益には約20%の税金がかかる。NISAは非課税。' : nisa > 0 ? 'NISAなので税金はかからない。' : undefined,
    submit: (amount) => sell(Math.min(amount, max), from),
    cancel,
  });
}

function buyForm(state: GameState, key: InvestKey, label: string, buy: (amount: number) => void, cancel: () => void): HTMLElement {
  const room = key === 'speculative' ? 0 : nisaRoom(state)[key];
  const note =
    key === 'speculative'
      ? '信用・仮想通貨はNISAでは買えない(特定口座)。'
      : room > 0
        ? `今年のNISAの枠はあと${manYen(room)}。超えた分は特定口座になる。`
        : '今年のNISAの枠は使い切った。特定口座で買う。';
  return amountForm({
    title: `預金で${label}を買う(預金 ${manYen(state.assets.cash)})`,
    max: Math.max(0, state.assets.cash),
    verb: '買う',
    note,
    submit: buy,
    cancel,
  });
}

function assetsContent(
  state: GameState,
  body: HTMLElement,
  trade: { sell(key: InvestKey, amount: number, from: SellFrom): void; buy(key: InvestKey, amount: number): void } | undefined,
  close: () => void,
): { draw: () => () => void } {
  const a = state.assets;
  const inv = state.invested;
  const rows: { label: string; value: number; principal?: number; key?: InvestKey }[] = [
    { label: '預金', value: a.cash },
    // 持っていない投資(残高も元本も0)の行は出さない。買うボタンは表の下にある
    ...INVEST_ROWS.filter((r) => a[r.key] !== 0 || (inv?.[r.key] ?? 0) !== 0).map((r) => ({
      label: r.label,
      value: a[r.key],
      principal: inv?.[r.key],
      key: r.key,
    })),
  ];
  const total = rows.reduce((s, r) => s + r.value, 0);
  const investedTotal = inv ? inv.index + inv.stocks + inv.speculative : undefined;
  const investedValue = a.index + a.stocks + a.speculative;
  const mix = assetMixSection(state);
  const formSlot = h('div', {});

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

  const canTrade = trade && !state.dead;
  const show = (form: HTMLElement) => {
    clear(formSlot);
    formSlot.appendChild(form);
    formSlot.querySelector<HTMLInputElement>('input[type=number]')?.focus();
  };
  /** 売り買いのボタン(表の下に、投資ごとに1行) */
  const tradeRow = (key: InvestKey, label: string) =>
    h(
      'div',
      { class: 'trade-row' },
      h('span', { class: 'trade-label' }, label),
      a[key] > 0
        ? h(
            'button',
            {
              class: 'btn small-btn',
              'aria-label': `${label}を売る`,
              onclick: () => show(sellForm(state, key, label, (amount, from) => trade!.sell(key, amount, from), () => clear(formSlot))),
            },
            '売る',
          )
        : null,
      a.cash > 0
        ? h(
            'button',
            {
              class: 'btn small-btn',
              'aria-label': `${label}を買う`,
              onclick: () => show(buyForm(state, key, label, (amount) => trade!.buy(key, amount), () => clear(formSlot))),
            },
            '買う',
          )
        : null,
    );
  const valueCell = (r: (typeof rows)[number]) => {
    const nisa = r.key ? nisaValue(state, r.key) : 0;
    return h('td', {}, manYen(r.value), nisa > 0 ? h('span', { class: 'pct small muted nisa-note' }, `うちNISA ${manYen(nisa)}`) : '');
  };
  const room = nisaRoom(state);

  append(body, [
    h('h2', {}, '資産と負債'),
    h('h3', {}, '資産'),
    h(
      'table',
      { class: 'asset-table' },
      h(
        'thead',
        {},
        h('tr', {}, h('th', {}, ''), h('th', {}, '残高'), h('th', {}, '元本'), h('th', {}, '損益')),
      ),
      h(
        'tbody',
        {},
        ...rows.map((r) =>
          h(
            'tr',
            {},
            h('th', {}, r.label),
            valueCell(r),
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
    canTrade ? h('div', { class: 'trade-rows' }, ...INVEST_ROWS.map((r) => tradeRow(r.key, r.label))) : null,
    formSlot,
    h(
      'p',
      { class: 'muted small' },
      `NISAの枠: 今年は積立あと${manYen(room.index)}・個別株あと${manYen(room.stocks)}、生涯あと${manYen(room.lifetime)}。`,
    ),
    canTrade
      ? h('p', { class: 'muted small' }, '売った分はすぐ預金になる。毎月の積立も、方針の配分どおりNISAの枠から先に使う。')
      : null,
    state.business
      ? h(
          'p',
          { class: 'small' },
          `会社: 起業から${Math.floor((state.month - state.business.since) / 12) + 1}年目。いま売れば約${manYen(businessValue(state))}(純資産には入れていない)`,
        )
      : null,
    liabilitiesAndNet(state),
    mix.el,
    state.ledger ? h('details', { class: 'summary-details' }, h('summary', {}, '今年のここまでの収支'), ledgerTable(state.ledger)) : null,
    inv === undefined ? h('p', { class: 'muted small' }, '古いセーブデータのため、元本と損益は表示できない。') : null,
    h('p', { class: 'muted small' }, '元本はつぎ込んだ金額。損益は今の残高との差。'),
    h('button', { class: 'btn primary', onclick: close }, '閉じる'),
  ]);
  return mix;
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
      v.annualGross > 0
        ? h(
            'p',
            { class: 'muted small' },
            state.character.job === 'owner'
              ? `役員報酬(年・額面) ${manYen(v.annualGross)}。会社の業績で決算ごとに変わる`
              : `本人の額面年収(ボーナス込み) ${manYen(v.annualGross)}`,
          )
        : null,
      h('h3', {}, `今月(${calendarMonth(state.month)}月)の手取り`),
      monthIncomeTable(v.income, state.character.job === 'owner'),
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

/** 幸福度の内訳: 6つの要素の満たされ具合と、価値観による重み */
export function happinessModal(state: GameState): Promise<void> {
  const parts = happinessParts(state);
  const weights = happinessWeights(state.values);
  return new Promise((resolve) => {
    let close = () => {};
    const rows = HAPPINESS_PARTS.map((p) => {
      const w = weights[p];
      const mark = w >= 1.2 ? '重視' : w <= 0.8 ? '軽め' : '';
      return h(
        'div',
        { class: 'bar bar-wide-label' },
        h('span', { class: 'bar-label' }, HAPPINESS_PART_LABELS[p], mark ? h('span', { class: 'weight-tag small' }, mark) : ''),
        h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: `width:${Math.round(parts[p])}%` })),
        h('span', { class: 'bar-word muted small' }, String(Math.round(parts[p]))),
      );
    });
    const content = h(
      'div',
      { class: 'happiness-modal' },
      h('h2', {}, `今月の幸福度 ${Math.round(state.happinessHistory.at(-1) ?? 0)}`),
      h('p', { class: 'muted small' }, '6つの要素の重み付き平均。どれを重視するかは価値観で変わる(「重視」は重みが大きく、「軽め」は小さい要素)。'),
      h('div', { class: 'card bars' }, ...rows),
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

/** 設定(年間サマリーを自動で閉じる など) */
export function settingsModal(settings: { autoCloseSummary: boolean }): Promise<void> {
  return new Promise((resolve) => {
    let close = () => {};
    const autoClose = h('input', {
      type: 'checkbox',
      checked: settings.autoCloseSummary,
      onchange: (e: Event) => {
        settings.autoCloseSummary = (e.target as HTMLInputElement).checked;
      },
    });
    const content = h(
      'div',
      { class: 'settings-modal' },
      h('h2', {}, '設定'),
      h('label', { class: 'check' }, autoClose, ' 年間サマリーを自動で閉じる'),
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
