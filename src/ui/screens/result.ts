// リザルト画面
import { computeResult, DEATH_CAUSE_LABELS, LIFE_TYPE_LABELS, type GameState } from '../../engine/index';
import { resultChart } from '../charts';
import { download, h, mount } from '../dom';
import { ageMonthLabel, bigYen, collapseLog, educationLabel, familyLabel, jobLabel, regionLabel } from '../format';
import type { Nav } from '../nav';

export function resultScreen(root: HTMLElement, nav: Nav, state: GameState): void {
  const r = computeResult(state);
  const c = state.character;
  const canvas = h('canvas', { 'aria-label': '資産と幸福度の推移' });

  const exportLog = () => {
    const payload = {
      seed: state.seed,
      name: c.name,
      result: { ...r, timeline: undefined, yearly: undefined },
      log: state.log,
    };
    download(`life-${state.seed}.json`, JSON.stringify(payload, null, 2));
  };

  mount(
    root,
    h(
      'main',
      { class: 'screen result-screen' },
      h('p', { class: 'muted' }, `${c.name}の一生`),
      h('h1', { class: `life-type type-${r.lifeType}` }, LIFE_TYPE_LABELS[r.lifeType]),
      h(
        'section',
        { class: 'tiles' },
        h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, '享年'), h('span', { class: 'tile-value' }, `${r.ageAtDeath}歳`)),
        h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, '死因'), h('span', { class: 'tile-value' }, DEATH_CAUSE_LABELS[r.cause])),
        h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, '最終資産'), h('span', { class: `tile-value ${r.finalNetWorth < 0 ? 'down' : ''}` }, bigYen(r.finalNetWorth))),
        h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, '生涯幸福スコア'), h('span', { class: 'tile-value' }, r.lifetimeHappiness.toFixed(1))),
      ),
      h(
        'p',
        { class: 'muted small' },
        `${educationLabel(c.education)}・実家${familyLabel(c.familyTier)}・${regionLabel(c.region)}暮らし・最後の職業 ${jobLabel(c.job)}・シード ${state.seed}`,
      ),
      h('section', { class: 'card chart-card' }, h('h2', {}, '資産と幸福度の推移'), h('div', { class: 'chart-box tall' }, canvas)),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, '年表'),
        h(
          'ol',
          { class: 'timeline' },
          ...collapseLog(r.timeline).map((e) => h('li', { class: `log log-${e.type}` }, h('span', { class: 'log-age' }, ageMonthLabel(e.ageMonths, e.month)), e.text)),
        ),
      ),
      h(
        'div',
        { class: 'actions wrap' },
        h('button', { class: 'btn primary', onclick: () => nav.setup(state.seed + 1) }, 'もう一度'),
        h('button', { class: 'btn', onclick: () => nav.setup(state.seed) }, '同じシードで再挑戦'),
        h('button', { class: 'btn', onclick: exportLog }, 'ログをJSONで保存'),
        h('button', { class: 'btn', onclick: () => nav.title() }, 'タイトルへ'),
      ),
    ),
  );
  resultChart(canvas, r.yearly);
}
