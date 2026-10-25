// メイン画面: 状態の表示・資産推移・直近のログ・操作
import { getMonthlyView, type GameState, type Stats } from '../../engine/index';
import { NetWorthChart } from '../charts';
import { GameController, type Speed } from '../controller';
import { clear, h, mount } from '../dom';
import { bigYen, collapseLog, manYen, regionLabel, STAT_LABELS, yen } from '../format';
import type { Nav } from '../nav';
import { policySummary } from '../policyForm';
import { choiceResultModal, eventModal, policyModal, yearSummaryModal } from './modals';

const RECENT_LOGS = 10;
const SPEEDS: Speed[] = [1, 4, 16];

export interface MainScreenHooks {
  /** 年の切れ目ごとに呼ぶ(セーブ用。ステップ9) */
  onYearEnd?(state: GameState): void;
}

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
    net: text('tile-value'),
    assets: text('tile-value'),
    debt: text('tile-value'),
    happiness: text('tile-value'),
    policy: h('p', { class: 'policy-line muted small' }),
  };
  const statKeys = Object.keys(STAT_LABELS) as (keyof Stats)[];
  const bars = {} as Record<keyof Stats, HTMLElement>;
  for (const k of statKeys) bars[k] = h('div', { class: `bar-fill stat-${k}` });
  const logList = h('ol', { class: 'log-list' });
  const canvas = h('canvas', { 'aria-label': '資産推移グラフ' });
  const playBtn = h('button', { class: 'btn primary', 'aria-label': '再生' }, '▶ 再生');
  const speedBtns = SPEEDS.map((s) => h('button', { class: 'btn speed', 'aria-pressed': s === 1 ? 'true' : 'false' }, `${s}x`));
  const autoClose = h('input', { type: 'checkbox' });

  const tile = (label: string, value: HTMLElement) => h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, label), value);

  mount(
    root,
    h(
      'main',
      { class: 'screen main-screen' },
      h(
        'header',
        { class: 'status-head' },
        h('div', {}, fields.name, ' ', fields.age),
        h('div', { class: 'muted small' }, fields.job, ' / ', fields.region, ' / ', fields.family),
      ),
      h(
        'section',
        { class: 'tiles' },
        tile('世帯の手取り(月)', fields.net),
        tile('金融資産', fields.assets),
        tile('借金・奨学金', fields.debt),
        tile('今月の幸福度', fields.happiness),
      ),
      h(
        'section',
        { class: 'card bars' },
        ...statKeys.map((k) =>
          h('div', { class: 'bar' }, h('span', { class: 'bar-label' }, STAT_LABELS[k]), h('div', { class: 'bar-track' }, bars[k])),
        ),
      ),
      h('section', { class: 'card chart-card' }, h('h2', {}, '資産の推移'), h('div', { class: 'chart-box' }, canvas)),
      h('section', { class: 'card' }, h('h2', {}, '最近の出来事'), logList),
      fields.policy,
      h('label', { class: 'check muted small' }, autoClose, ' 年間サマリーを自動で閉じる'),
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
                const policy = await policyModal(controller.state.policy);
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
    fields.name.textContent = c.name;
    fields.age.textContent = `${v.age}歳`;
    fields.job.textContent = v.jobLabel;
    fields.region.textContent = regionLabel(c.region);
    fields.family.textContent = c.married ? '既婚' : state.flags.partner === true ? '恋人あり' : '独身';
    fields.net.textContent = yen(v.householdNet);
    fields.assets.textContent = bigYen(v.financialAssets);
    fields.debt.textContent = v.debt + v.studentLoan > 0 ? manYen(v.debt + v.studentLoan) : 'なし';
    fields.debt.classList.toggle('down', v.debt > 0);
    fields.happiness.textContent = String(Math.round(v.happiness));
    fields.policy.textContent = policySummary(state.policy);
    for (const k of statKeys) bars[k].style.width = `${state.stats[k]}%`;

    clear(logList);
    const recent = collapseLog(state.log.filter((e) => e.type !== 'year_summary').slice(-RECENT_LOGS * 2))
      .slice(-RECENT_LOGS)
      .reverse();
    for (const e of recent) {
      logList.appendChild(
        h('li', { class: `log log-${e.type}` }, h('span', { class: 'log-age' }, `${Math.floor(e.ageMonths / 12)}歳`), e.text),
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
      await yearSummaryModal(state, { financial, previousFinancial, events }, autoClose.checked);
    },
    onYearEnd: (state) => {
      // 年間サマリーを出したあと(スキップ中も)に、前年比の基準を進める
      previousFinancial = getMonthlyView(state).financialAssets;
      lastSummaryMonth = state.month;
      hooks.onYearEnd?.(state);
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
  speedBtns.forEach((btn, i) =>
    btn.addEventListener('click', () => {
      controller.setSpeed(SPEEDS[i]!);
      speedBtns.forEach((b, j) => b.setAttribute('aria-pressed', i === j ? 'true' : 'false'));
    }),
  );

  render(initial, true);
}
