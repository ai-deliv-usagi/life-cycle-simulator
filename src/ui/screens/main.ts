// メイン画面: 状態の表示・資産推移・直近のログ・操作
import { debtRates, gameData, getMonthlyView, upcoming, type GameState, type LogEntry, type Stats } from '../../engine/index';
import { NetWorthChart } from '../charts';
import { GameController, type Speed } from '../controller';
import { clear, h, mount } from '../dom';
import {
  ageMonthLabel,
  annualRateLabel,
  bigYen,
  calendarMonth,
  collapseLog,
  manYen,
  RANK_LABELS,
  regionLabel,
  signedManYen,
  eventIcon,
  genderIcon,
  happinessFace,
  happinessWord,
  JOB_ICONS,
  REGION_ICONS,
  STAT_ICONS,
  IMPORTANT_EVENTS,
  logTitle,
  moneyLabel,
  STAT_EFFECTS,
  STAT_LABELS,
  STAT_LEVEL_LABELS,
  statLevel,
  yearNumber,
  yen,
} from '../format';
import type { Nav } from '../nav';
import { policyOptionsFor } from '../policyForm';
import { POLICY_PRESETS, presetIdOfPolicy } from '../presets';
import {
  assetsModal,
  choiceResultModal,
  eventModal,
  happinessModal,
  incomeModal,
  policyModal,
  settingsModal,
  statModal,
  yearSummaryModal,
} from './modals';

const RECENT_LOGS = 5; // 「もっと見る」で LOG_MORE 件まで
const LOG_MORE = 20;
const SPEEDS: Speed[] = [1, 4, 16];

export interface MainScreenHooks {
  /** 年の切れ目ごとに呼ぶ(セーブ用。ステップ9)。セーブできたら true */
  onYearEnd?(state: GameState): boolean | void;
}

const SNACK_MS = 4000; // 大事な出来事はその倍
const SNACK_MAX = 3;
const LEVEL_ORDER = ['good', 'normal', 'caution', 'danger'] as const;
const UPCOMING_MAX = 5;

/** 選択肢のないイベントは、再生中だと気づきにくいので画面の下にスナックバーで出す */
function eventsWithoutChoice(entries: LogEntry[]): LogEntry[] {
  return entries.filter((e) => {
    if (e.type !== 'event') return false;
    const def = gameData.events.find((d) => d.id === e.id);
    return !def?.choices?.length; // 選択肢つきはモーダルが出るので通知しない
  });
}

/** 「あと3年(45歳)」「あと5ヶ月」 */
function untilLabel(months: number, ageMonths: number): string {
  if (months < 12) return `あと${months}ヶ月`;
  return `あと${Math.round(months / 12)}年(${Math.floor((ageMonths + months) / 12)}歳)`;
}

// スペースキーで再生・一時停止(入力欄とモーダルが出ているときは何もしない)
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || !active) return;
  const target = e.target as HTMLElement | null;
  if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
  if (document.querySelector('.modal-overlay')) return;
  e.preventDefault();
  active.toggle();
});

let active: GameController | undefined;

export function mainScreen(root: HTMLElement, nav: Nav, initial: GameState, hooks: MainScreenHooks = {}): void {
  active?.dispose();

  const text = (cls: string) => h('span', { class: cls });
  const fields = {
    name: text('name'),
    age: text('age'),
    job: text('job'),
    region: text('region'),
    family: text('family'),
    date: text('date muted small'),
    netLabel: text('tile-label'),
    net: text('tile-value'),
    assets: text('tile-value'),
    assetsDiff: text('tile-sub small'),
    netWorth: text('tile-value'),
    netWorthDiff: text('tile-sub small'),
    debt: text('tile-value'),
    debtSub: text('tile-sub muted small'),
    happiness: text('tile-value'),
    happinessDiff: text('tile-sub small'),
    policyBtn: h('span', { class: 'policy-btn-label' }),
  };
  const statKeys = Object.keys(STAT_LABELS) as (keyof Stats)[];
  const bars = {} as Record<keyof Stats, HTMLElement>;
  const barWords = {} as Record<keyof Stats, HTMLElement>;
  for (const k of statKeys) {
    bars[k] = h('div', { class: 'bar-fill' });
    barWords[k] = h('span', { class: 'bar-word small' });
  }
  const logList = h('ol', { class: 'log-list' });
  const statWarning = h('p', { class: 'stat-warning small' });
  const upcomingList = h('ul', { class: 'upcoming-list' });
  const upcomingEmpty = h('p', { class: 'muted small' }, '先の予定はまだない。');
  // 選択肢のない出来事のスナックバー(画面の下、操作ボタンの上に積む)
  const snackbars = h('div', { class: 'snackbars', role: 'status', 'aria-live': 'polite' });
  const showSnack = (e: LogEntry, stopped: boolean) => {
    const money = moneyLabel(e.money);
    const important = IMPORTANT_EVENTS.has(e.id ?? '');
    const item = h(
      'div',
      { class: `snack${important ? ' snack-important' : ''}` },
      h('span', { class: 'snack-date' }, `${eventIcon(e.id)} ${ageMonthLabel(e.ageMonths, e.month)}`.trim()),
      h('span', { class: 'snack-text' }, h('strong', {}, logTitle(e.text)), h('span', { class: 'snack-body' }, e.text.slice(logTitle(e.text).length + 1))),
      money ? h('span', { class: `snack-money ${e.money! > 0 ? 'up' : 'down'}` }, money) : '',
      stopped ? h('span', { class: 'snack-note' }, '大事な出来事なので一時停止しました') : '',
    );
    snackbars.appendChild(item);
    while (snackbars.children.length > SNACK_MAX) snackbars.firstElementChild!.remove();
    setTimeout(() => item.remove(), important ? SNACK_MS * 2 : SNACK_MS);
  };
  let seenLog = initial.log.length;
  let showAllLogs = false;
  const moreLogs = h('button', { class: 'btn link-btn small' }, 'もっと見る');
  const settings = { autoCloseSummary: false, pauseOnImportant: true };
  const isStopEvent = (e: LogEntry) => settings.pauseOnImportant && e.type === 'event' && IMPORTANT_EVENTS.has(e.id ?? '');
  const debtTile = h('div', { class: 'tile tile-wide' }, h('span', { class: 'tile-label' }, '💳 借金・ローン'), fields.debt, fields.debtSub);
  const canvas = h('canvas', { 'aria-label': '資産推移グラフ' });
  const playBtn = h('button', { class: 'btn primary play-btn', 'aria-label': '再生' }, '▶');

  // 出来事・これから・資産の推移は1枚のカードのタブにまとめる(縦に長くならないように)
  const panels = {
    log: h('div', { class: 'tab-panel' }, logList, moreLogs),
    upcoming: h('div', { class: 'tab-panel', hidden: true }, upcomingList, upcomingEmpty),
    chart: h('div', { class: 'tab-panel', hidden: true }, h('div', { class: 'chart-box' }, canvas)),
  };
  const TABS: { key: keyof typeof panels; label: string }[] = [
    { key: 'log', label: '📜 出来事' },
    { key: 'upcoming', label: '📅 これから' },
    { key: 'chart', label: '📈 資産の推移' },
  ];
  const tabButtons = TABS.map(({ key, label }) =>
    h(
      'button',
      {
        class: 'tab',
        role: 'tab',
        'aria-selected': key === 'log' ? 'true' : 'false',
        onclick: () => {
          TABS.forEach((t, i) => {
            panels[t.key].hidden = t.key !== key;
            tabButtons[i]!.setAttribute('aria-selected', t.key === key ? 'true' : 'false');
          });
        },
      },
      label,
    ),
  );
  const speedBtns = SPEEDS.map((s) => h('button', { class: 'btn speed', 'aria-pressed': s === 1 ? 'true' : 'false' }, `${s}x`));

  const tile = (label: string | HTMLElement, ...value: HTMLElement[]) =>
    h('div', { class: 'tile' }, typeof label === 'string' ? h('span', { class: 'tile-label' }, label) : label, ...value);

  mount(
    root,
    h(
      'main',
      { class: 'screen main-screen' },
      h(
        'header',
        { class: 'status-head' },
        h(
          'div',
          { class: 'status-top' },
          h('div', {}, fields.name, ' ', fields.age, ' ', fields.date),
          h(
            'button',
            { class: 'btn icon-btn', 'aria-label': '設定', onclick: () => void controller.whilePaused(() => settingsModal(settings)) },
            '⚙',
          ),
        ),
        h('div', { class: 'muted small status-sub' }, fields.job, ' · ', fields.region, ' · ', fields.family),
      ),
      h(
        'section',
        { class: 'tiles' },
        h(
          'button',
          {
            class: 'tile tile-button',
            'aria-label': '収入の内訳を見る',
            onclick: () => void controller.whilePaused(() => incomeModal(controller.state)),
          },
          fields.netLabel,
          fields.net,
        ),
        h(
          'button',
          {
            class: 'tile tile-button',
            'aria-label': '金融資産の内訳を見る',
            onclick: () =>
              void controller.whilePaused(() =>
                assetsModal(controller.state, {
                  sell: (key, amount, from) => controller.sell(key, amount, from),
                  buy: (key, amount) => controller.buy(key, amount),
                }),
              ),
          },
          h('span', { class: 'tile-label' }, '💰 金融資産 ›'),
          fields.assets,
          fields.assetsDiff,
        ),
        tile('🏦 純資産(家を含む)', fields.netWorth, fields.netWorthDiff),
        h(
          'button',
          {
            class: 'tile tile-button',
            'aria-label': '幸福度の内訳を見る',
            onclick: () => void controller.whilePaused(() => happinessModal(controller.state)),
          },
          h('span', { class: 'tile-label' }, '今月の幸福度 ›'),
          fields.happiness,
          fields.happinessDiff,
        ),
        debtTile,
      ),
      h(
        'section',
        { class: 'card bars' },
        ...statKeys.map((k) =>
          h(
            'button',
            {
              class: 'bar bar-button',
              'aria-label': `${STAT_LABELS[k]}の説明を見る`,
              onclick: () => void controller.whilePaused(() => statModal(k, controller.state.stats[k])),
            },
            h('span', { class: 'bar-label' }, h('span', { 'aria-hidden': 'true' }, STAT_ICONS[k]), ' ', STAT_LABELS[k]),
            h('div', { class: 'bar-track' }, bars[k]),
            barWords[k],
          ),
        ),
        statWarning,
      ),
      h('section', { class: 'card tab-card' }, h('div', { class: 'tabs', role: 'tablist' }, ...tabButtons), panels.log, panels.upcoming, panels.chart),
      h(
        'nav',
        { class: 'controls' },
        snackbars,
        playBtn,
        h('div', { class: 'speeds' }, ...speedBtns),
        h('button', { class: 'btn', 'aria-label': '次のイベントまで進める', onclick: () => void controller.skipToEvent() }, '⏭ 次へ'),
        h(
          'button',
          {
            class: 'btn',
            'aria-label': '方針を変える',
            onclick: () =>
              void controller.whilePaused(async () => {
                const policy = await policyModal(controller.state.policy, policyOptionsFor(controller.state));
                if (policy) controller.changePolicy(policy);
              }),
          },
          '🧭 ',
          fields.policyBtn,
        ),
      ),
    ),
  );

  const chart = new NetWorthChart(canvas);
  let previousFinancial = getMonthlyView(initial).financialAssets;
  let lastSummaryMonth = initial.month - (initial.month % 12);

  function chartPoints(state: GameState) {
    const points = state.log
      .filter((e) => e.type === 'year_summary')
      .map((e) => ({ age: e.ageMonths / 12, netWorth: e.snapshot.netWorth }));
    points.unshift({ age: state.startAge, netWorth: 0 });
    return points;
  }

  function render(state: GameState, chartChanged: boolean): void {
    const v = getMonthlyView(state);
    const c = state.character;
    fields.name.textContent = `${genderIcon(c.gender)} ${c.name}`;
    fields.age.textContent = `${v.age}歳`;
    fields.date.textContent = `${calendarMonth(state.month)}月(${yearNumber(state.month)}年目)`;
    const rank = RANK_LABELS[Number(state.flags.rank ?? 0)] ?? '';
    const jobIcon = c.retired ? '🌅' : JOB_ICONS[c.job];
    fields.job.textContent = `${jobIcon} ${rank && !c.retired ? `${v.jobLabel}(${rank})` : v.jobLabel}`;
    fields.region.textContent = `${REGION_ICONS[c.region]} ${regionLabel(c.region)}`;
    const kids = c.children ?? [];
    const kidsLabel = kids.length > 0 ? ` · ${'👶'.repeat(Math.min(kids.length, 3))} ${kids.map((k) => `${Math.floor((state.month - k.birthMonth) / 12)}歳`).join('・')}` : '';
    fields.family.textContent =
      (c.married ? '💍 既婚' : state.flags.partner === true ? '💕 恋人あり' : '独身') + kidsLabel + (state.home ? ' · 🏠 持ち家' : '');
    fields.netLabel.textContent = `💴 ${
      c.retired
        ? '年金・世帯の手取り(月)'
        : Number(state.flags.unemploymentBenefit ?? 0) > 0
          ? '失業給付・世帯の手取り(月)'
          : '世帯の手取り(月)'
    } ›`;
    fields.net.textContent = yen(v.householdNet);
    fields.assets.textContent = bigYen(v.financialAssets);
    fields.netWorth.textContent = bigYen(v.netWorth);
    fields.netWorth.classList.toggle('down', v.netWorth < 0);
    // 前の年末との差(1年目はまだない)
    // 年末の月は今年のサマリーがもうあるので、その前の年末と比べる
    const lastYear = [...state.log].reverse().find((e) => e.type === 'year_summary' && e.month < state.month);
    setDiff(fields.assetsDiff, lastYear?.assets ? v.financialAssets - sumAssets(lastYear.assets) : null, '去年末から');
    setDiff(fields.netWorthDiff, lastYear ? v.netWorth - lastYear.snapshot.netWorth : null, '去年末から');
    // 借金・ローンは、あるときだけ出す
    const mortgage = state.assets.mortgage ?? 0;
    const blacklist = Number(state.flags.blacklist ?? 0);
    const owed = v.debt + v.loan + v.studentLoan + mortgage;
    debtTile.hidden = owed <= 0 && blacklist <= 0;
    fields.debt.textContent = manYen(owed);
    fields.debt.classList.toggle('down', v.debt > 0);
    const rates = debtRates(state);
    const debtNotes = [
      v.debt > 0 ? `カードローン ${manYen(v.debt)}(${annualRateLabel(rates.card)})` : '',
      v.loan > 0 ? `ローン ${manYen(v.loan)}(${annualRateLabel(rates.loan)})` : '',
      mortgage > 0 ? `住宅ローン ${manYen(mortgage)}(${annualRateLabel(rates.mortgage)})` : '',
      v.studentLoan > 0 ? `奨学金 ${manYen(v.studentLoan)}(${annualRateLabel(rates.studentLoan)})` : '',
      blacklist > 0 ? `ブラックリスト 残り${Math.ceil(blacklist / 12)}年` : '',
    ].filter(Boolean);
    fields.debtSub.textContent = debtNotes.join(' / ');
    fields.happiness.textContent = `${happinessFace(v.happiness)} ${happinessWord(v.happiness)}`;
    const history = state.happinessHistory;
    const yearAgo = history.length > 12 ? history.slice(-24, -12) : [];
    const thisYear = history.slice(-12);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const hDiff = yearAgo.length > 0 ? avg(thisYear) - avg(yearAgo) : null;
    fields.happinessDiff.textContent =
      hDiff === null ? '' : `この1年 ${hDiff >= 0.5 ? '↑ 上向き' : hDiff <= -0.5 ? '↓ 下向き' : '→ 変わらず'}`;
    fields.happinessDiff.className = `tile-sub small ${hDiff !== null && hDiff >= 0.5 ? 'up' : hDiff !== null && hDiff <= -0.5 ? 'down' : 'muted'}`;
    const preset = POLICY_PRESETS.find((p) => p.id === presetIdOfPolicy(state.policy));
    fields.policyBtn.textContent = preset ? preset.label : '方針';
    // いちばん悪いステータスが注意・危険なら、何が起きやすいかを1行で
    const worst = statKeys
      .map((k) => ({ k, level: statLevel(k, state.stats[k]) }))
      .sort((x, y) => LEVEL_ORDER.indexOf(y.level) - LEVEL_ORDER.indexOf(x.level))[0]!;
    const warn = worst.level === 'caution' || worst.level === 'danger';
    statWarning.hidden = !warn;
    if (warn) statWarning.textContent = `${STAT_LABELS[worst.k]}が${STAT_LEVEL_LABELS[worst.level]}: ${STAT_EFFECTS[worst.k].bad}`;
    for (const k of statKeys) {
      const level = statLevel(k, state.stats[k]);
      bars[k].style.width = `${state.stats[k]}%`;
      bars[k].className = `bar-fill level-${level}`;
      barWords[k].textContent = STAT_LEVEL_LABELS[level];
      barWords[k].className = `bar-word small level-text-${level}`;
    }

    clear(upcomingList);
    const next = upcoming(state).slice(0, UPCOMING_MAX);
    upcomingEmpty.hidden = next.length > 0;
    for (const u of next) {
      upcomingList.appendChild(h('li', {}, h('span', {}, u.label), h('span', { class: 'muted' }, untilLabel(u.months, state.ageMonths))));
    }

    // 前回の描画のあとに起きた、選択肢のないイベントを通知する(新しい SNACK_MAX 件)
    const fresh = eventsWithoutChoice(state.log.slice(seenLog));
    seenLog = state.log.length;
    for (const e of fresh.slice(-SNACK_MAX)) showSnack(e, isStopEvent(e));

    clear(logList);
    const shown = showAllLogs ? LOG_MORE : RECENT_LOGS;
    const all = collapseLog(state.log.filter((e) => e.type !== 'year_summary').slice(-LOG_MORE * 2));
    const recent = all.slice(-shown).reverse();
    moreLogs.hidden = all.length <= RECENT_LOGS;
    moreLogs.textContent = showAllLogs ? '閉じる' : 'もっと見る';
    for (const e of recent) {
      const money = moneyLabel(e.money);
      logList.appendChild(
        h(
          'li',
          { class: `log log-${e.type}` },
          h('span', { class: 'log-age' }, ageMonthLabel(e.ageMonths, e.month)),
          h('span', { class: 'log-text' }, eventIcon(e.id) ? `${eventIcon(e.id)} ${e.text}` : e.text),
          money ? h('span', { class: `log-money ${e.money! > 0 ? 'up' : 'down'}` }, money) : '',
        ),
      );
    }
    if (chartChanged) chart.update(chartPoints(state));
  }

  const controller = new GameController(initial, {
    render,
    chooseEvent: (state) => eventModal(state),
    showChoiceResult: (state) => choiceResultModal(state),
    yearSummary: async (state) => {
      const financial = getMonthlyView(state).financialAssets;
      const events = collapseLog(state.log.filter((e) => e.month > lastSummaryMonth && (e.type === 'event' || e.type === 'choice')));
      await yearSummaryModal(state, { financial, previousFinancial, events }, settings.autoCloseSummary);
    },
    onYearEnd: (state) => {
      // 年間サマリーを出したあと(スキップ中も)に、前年比の基準を進める
      previousFinancial = getMonthlyView(state).financialAssets;
      lastSummaryMonth = state.month;
      hooks.onYearEnd?.(state);
    },
    onPlayingChange: (playing) => {
      playBtn.textContent = playing ? '⏸' : '▶';
      playBtn.setAttribute('aria-label', playing ? '一時停止' : '再生');
    },
    shouldStop: (state, since) => state.log.slice(since).some(isStopEvent),
    onDeath: (state) => {
      chart.destroy();
      setTimeout(() => nav.result(state), 1500);
    },
  });
  active = controller;

  playBtn.addEventListener('click', () => controller.toggle());
  moreLogs.addEventListener('click', () => {
    showAllLogs = !showAllLogs;
    render(controller.state, false);
  });
  speedBtns.forEach((btn, i) =>
    btn.addEventListener('click', () => {
      controller.setSpeed(SPEEDS[i]!);
      speedBtns.forEach((b, j) => b.setAttribute('aria-pressed', i === j ? 'true' : 'false'));
    }),
  );

  render(initial, true);
}

function sumAssets(a: NonNullable<LogEntry['assets']>): number {
  return a.cash + a.index + a.stocks + a.speculative;
}

/** 「去年末から +27万円」のように差を出す(プラスは緑、マイナスは赤) */
function setDiff(el: HTMLElement, diff: number | null, prefix: string): void {
  el.textContent = diff === null ? '' : `${prefix} ${signedManYen(diff)}`;
  el.className = `tile-sub small ${diff === null ? 'muted' : diff >= 0 ? 'up' : 'down'}`;
}
