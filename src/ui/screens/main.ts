// メイン画面: 状態の表示・資産推移・直近のログ・操作
import { gameData, getMonthlyView, upcoming, type GameState, type LogEntry, type Stats } from '../../engine/index';
import { NetWorthChart } from '../charts';
import { GameController, type Speed } from '../controller';
import { clear, h, mount } from '../dom';
import {
  ageMonthLabel,
  bigYen,
  calendarMonth,
  collapseLog,
  manYen,
  RANK_LABELS,
  regionLabel,
  signedManYen,
  STAT_LABELS,
  STAT_LEVEL_LABELS,
  statLevel,
  yearNumber,
  yen,
} from '../format';
import type { Nav } from '../nav';
import { policyOptionsFor, policySummary } from '../policyForm';
import {
  assetsModal,
  choiceResultModal,
  eventModal,
  happinessModal,
  incomeModal,
  policyModal,
  settingsModal,
  yearSummaryModal,
} from './modals';

const RECENT_LOGS = 5; // 「もっと見る」で LOG_MORE 件まで
const LOG_MORE = 20;
const SPEEDS: Speed[] = [1, 4, 16];

export interface MainScreenHooks {
  /** 年の切れ目ごとに呼ぶ(セーブ用。ステップ9)。セーブできたら true */
  onYearEnd?(state: GameState): boolean | void;
}

const TOAST_MS = 2500;
const UPCOMING_MAX = 5;

/** 選択肢のないイベントは、再生中だと気づきにくいので画面の上に少しだけ出す */
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
    policy: h('p', { class: 'policy-line muted small' }),
  };
  const statKeys = Object.keys(STAT_LABELS) as (keyof Stats)[];
  const bars = {} as Record<keyof Stats, HTMLElement>;
  const barWords = {} as Record<keyof Stats, HTMLElement>;
  for (const k of statKeys) {
    bars[k] = h('div', { class: 'bar-fill' });
    barWords[k] = h('span', { class: 'bar-word small' });
  }
  const logList = h('ol', { class: 'log-list' });
  const upcomingList = h('ul', { class: 'upcoming-list' });
  const upcomingCard = h('section', { class: 'card' }, h('h2', {}, 'これから'), upcomingList);
  const toast = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite', hidden: true });
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const showToast = (text: string, cls = '') => {
    toast.textContent = text;
    toast.className = `toast ${cls}`;
    toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), TOAST_MS);
  };
  let seenLog = initial.log.length;
  let showAllLogs = false;
  const moreLogs = h('button', { class: 'btn link-btn small' }, 'もっと見る');
  const settings = { autoCloseSummary: false };
  const debtTile = h('div', { class: 'tile tile-wide' }, h('span', { class: 'tile-label' }, '借金・ローン'), fields.debt, fields.debtSub);
  const canvas = h('canvas', { 'aria-label': '資産推移グラフ' });
  const playBtn = h('button', { class: 'btn primary', 'aria-label': '再生' }, '▶ 再生');
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
        h('div', { class: 'muted small' }, fields.job, ' / ', fields.region, ' / ', fields.family),
      ),
      toast,
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
          h('span', { class: 'tile-label' }, '金融資産 ›'),
          fields.assets,
          fields.assetsDiff,
        ),
        tile('純資産(家を含む)', fields.netWorth, fields.netWorthDiff),
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
            'div',
            { class: 'bar' },
            h('span', { class: 'bar-label' }, STAT_LABELS[k]),
            h('div', { class: 'bar-track' }, bars[k]),
            barWords[k],
          ),
        ),
      ),
      upcomingCard,
      h('section', { class: 'card chart-card' }, h('h2', {}, '資産の推移'), h('div', { class: 'chart-box' }, canvas)),
      h('section', { class: 'card' }, h('h2', {}, '最近の出来事'), logList, moreLogs),
      fields.policy,
      h(
        'nav',
        { class: 'controls' },
        playBtn,
        h('div', { class: 'speeds' }, ...speedBtns),
        h('button', { class: 'btn', onclick: () => void controller.skipToEvent() }, '次のイベントまで'),
        h(
          'button',
          {
            class: 'btn',
            onclick: () =>
              void controller.whilePaused(async () => {
                const policy = await policyModal(controller.state.policy, policyOptionsFor(controller.state));
                if (policy) controller.changePolicy(policy);
              }),
          },
          '方針変更',
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
    fields.name.textContent = c.gender ? `${c.name}(${c.gender === 'female' ? '女性' : '男性'})` : c.name;
    fields.age.textContent = `${v.age}歳`;
    fields.date.textContent = `${calendarMonth(state.month)}月(${yearNumber(state.month)}年目)`;
    const rank = RANK_LABELS[Number(state.flags.rank ?? 0)] ?? '';
    fields.job.textContent = rank && !c.retired ? `${v.jobLabel}(${rank})` : v.jobLabel;
    fields.region.textContent = regionLabel(c.region);
    const kids = c.children ?? [];
    const kidsLabel = kids.length > 0 ? `・子ども${kids.length}人(${kids.map((k) => `${Math.floor((state.month - k.birthMonth) / 12)}歳`).join('・')})` : '';
    fields.family.textContent =
      (c.married ? '既婚' : state.flags.partner === true ? '恋人あり' : '独身') + kidsLabel + (state.home ? '・持ち家' : '');
    fields.netLabel.textContent = `${
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
    const debtNotes = [
      v.debt > 0 ? `カードローン ${manYen(v.debt)}` : '',
      v.loan > 0 ? `ローン ${manYen(v.loan)}` : '',
      mortgage > 0 ? `住宅ローン ${manYen(mortgage)}` : '',
      v.studentLoan > 0 ? `奨学金 ${manYen(v.studentLoan)}` : '',
      blacklist > 0 ? `ブラックリスト 残り${Math.ceil(blacklist / 12)}年` : '',
    ].filter(Boolean);
    fields.debtSub.textContent = debtNotes.join(' / ');
    fields.happiness.textContent = String(Math.round(v.happiness));
    const history = state.happinessHistory;
    const yearAgo = history.length > 12 ? history.slice(-24, -12) : [];
    const thisYear = history.slice(-12);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const hDiff = yearAgo.length > 0 ? avg(thisYear) - avg(yearAgo) : null;
    fields.happinessDiff.textContent =
      hDiff === null ? '' : `この1年 ${hDiff >= 0.5 ? '↑' : hDiff <= -0.5 ? '↓' : '→'} (前の年 ${Math.round(avg(yearAgo))})`;
    fields.happinessDiff.className = `tile-sub small ${hDiff !== null && hDiff >= 0.5 ? 'up' : hDiff !== null && hDiff <= -0.5 ? 'down' : 'muted'}`;
    fields.policy.textContent = policySummary(state.policy, policyOptionsFor(state));
    for (const k of statKeys) {
      const level = statLevel(k, state.stats[k]);
      bars[k].style.width = `${state.stats[k]}%`;
      bars[k].className = `bar-fill level-${level}`;
      barWords[k].textContent = STAT_LEVEL_LABELS[level];
      barWords[k].className = `bar-word small level-text-${level}`;
    }

    clear(upcomingList);
    const next = upcoming(state).slice(0, UPCOMING_MAX);
    upcomingCard.hidden = next.length === 0;
    for (const u of next) {
      upcomingList.appendChild(h('li', {}, h('span', {}, u.label), h('span', { class: 'muted' }, untilLabel(u.months, state.ageMonths))));
    }

    // 前回の描画のあとに起きた、選択肢のないイベントを通知する(何件あっても最新の1件)
    const fresh = eventsWithoutChoice(state.log.slice(seenLog));
    seenLog = state.log.length;
    const latest = fresh.at(-1);
    if (latest) showToast(latest.text);

    clear(logList);
    const shown = showAllLogs ? LOG_MORE : RECENT_LOGS;
    const all = collapseLog(state.log.filter((e) => e.type !== 'year_summary').slice(-LOG_MORE * 2));
    const recent = all.slice(-shown).reverse();
    moreLogs.hidden = all.length <= RECENT_LOGS;
    moreLogs.textContent = showAllLogs ? '閉じる' : 'もっと見る';
    for (const e of recent) {
      logList.appendChild(
        h('li', { class: `log log-${e.type}` }, h('span', { class: 'log-age' }, ageMonthLabel(e.ageMonths, e.month)), e.text),
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
      const events = state.log.filter((e) => e.month > lastSummaryMonth && e.type === 'event');
      await yearSummaryModal(state, { financial, previousFinancial, events }, settings.autoCloseSummary);
    },
    onYearEnd: (state) => {
      // 年間サマリーを出したあと(スキップ中も)に、前年比の基準を進める
      previousFinancial = getMonthlyView(state).financialAssets;
      lastSummaryMonth = state.month;
      // セーブできたら小さく知らせる(イベントの通知が出ているときは邪魔しない)
      if (hooks.onYearEnd?.(state) === true && toast.hidden) showToast('セーブしました', 'toast-save');
    },
    onPlayingChange: (playing) => {
      playBtn.textContent = playing ? '⏸ 一時停止' : '▶ 再生';
      playBtn.setAttribute('aria-label', playing ? '一時停止' : '再生');
    },
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
