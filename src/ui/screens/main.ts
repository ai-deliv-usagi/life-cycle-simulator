// メイン画面: 状態の表示・資産推移・直近のログ・操作
import { getMonthlyView, type GameState, type Stats } from '../../engine/index';
import { NetWorthChart } from '../charts';
import { GameController, type Speed } from '../controller';
import { clear, h, mount } from '../dom';
import { ageMonthLabel, bigYen, calendarMonth, collapseLog, manYen, RANK_LABELS, regionLabel, STAT_LABELS, yearNumber, yen } from '../format';
import type { Nav } from '../nav';
import { policySummary } from '../policyForm';
import { assetsModal, choiceResultModal, eventModal, incomeModal, policyModal, yearSummaryModal } from './modals';

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
    date: text('date muted small'),
    netLabel: text('tile-label'),
    net: text('tile-value'),
    assets: text('tile-value'),
    debt: text('tile-value'),
    debtSub: text('tile-sub muted small'),
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
        h('div', {}, fields.name, ' ', fields.age, ' ', fields.date),
        h('div', { class: 'muted small' }, fields.job, ' / ', fields.region, ' / ', fields.family),
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
            onclick: () => void controller.whilePaused(() => assetsModal(controller.state, (key, amount) => controller.sell(key, amount))),
          },
          h('span', { class: 'tile-label' }, '金融資産 ›'),
          fields.assets,
        ),
        tile('借金', fields.debt, fields.debtSub),
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
    fields.name.textContent = c.gender ? `${c.name}(${c.gender === 'female' ? '女性' : '男性'})` : c.name;
    fields.age.textContent = `${v.age}歳`;
    fields.date.textContent = `${calendarMonth(state.month)}月(${yearNumber(state.month)}年目)`;
    const rank = RANK_LABELS[Number(state.flags.rank ?? 0)] ?? '';
    fields.job.textContent = rank && !c.retired ? `${v.jobLabel}(${rank})` : v.jobLabel;
    fields.region.textContent = regionLabel(c.region);
    const kids = c.children ?? [];
    const kidsLabel = kids.length > 0 ? `・子ども${kids.length}人(${kids.map((k) => `${Math.floor((state.month - k.birthMonth) / 12)}歳`).join('・')})` : '';
    fields.family.textContent = (c.married ? '既婚' : state.flags.partner === true ? '恋人あり' : '独身') + kidsLabel;
    fields.netLabel.textContent = `${
      c.retired
        ? '年金・世帯の手取り(月)'
        : Number(state.flags.unemploymentBenefit ?? 0) > 0
          ? '失業給付・世帯の手取り(月)'
          : '世帯の手取り(月)'
    } ›`;
    fields.net.textContent = yen(v.householdNet);
    fields.assets.textContent = bigYen(v.financialAssets);
    fields.debt.textContent = v.debt > 0 ? manYen(v.debt) : 'なし';
    fields.debt.classList.toggle('down', v.debt > 0);
    const blacklist = Number(state.flags.blacklist ?? 0);
    const debtNotes = [
      v.loan > 0 ? `ローン 残り${manYen(v.loan)}` : '',
      v.studentLoan > 0 ? `奨学金 残り${manYen(v.studentLoan)}` : '',
      blacklist > 0 ? `ブラックリスト 残り${Math.ceil(blacklist / 12)}年` : '',
    ].filter(Boolean);
    fields.debtSub.textContent = debtNotes.join(' / ');
    fields.happiness.textContent = String(Math.round(v.happiness));
    fields.policy.textContent = policySummary(state.policy);
    for (const k of statKeys) bars[k].style.width = `${state.stats[k]}%`;

    clear(logList);
    const recent = collapseLog(state.log.filter((e) => e.type !== 'year_summary').slice(-RECENT_LOGS * 2))
      .slice(-RECENT_LOGS)
      .reverse();
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
