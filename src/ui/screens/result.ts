// リザルト画面: 人生タイプ・数字のタイル・グラフ・人生のハイライト。すべての出来事は年代ごとに折りたたむ
import { computeResult, DEATH_CAUSE_LABELS, earnedAchievements, gameData, LIFE_TYPE_LABELS, type GameState, type LogEntry } from '../../engine/index';
import { resultChart } from '../charts';
import { download, h, mount } from '../dom';
import {
  ageMonthLabel,
  bigYen,
  byDecade,
  collapseLog,
  EDUCATION_ICONS,
  educationLabel,
  eventIcon,
  familyLabel,
  genderIcon,
  JOB_ICONS,
  jobLabel,
  LIFE_TYPE_ICONS,
  lifeHighlights,
  moneyLabel,
  REGION_ICONS,
  regionLabel,
} from '../format';
import type { Nav } from '../nav';
import { earnedSoFar, loadHistory } from '../storage';

const CAUSE_ICONS: Record<string, string> = { illness: '🏥', overwork: '💼', accident: '🚑', old_age: '🕊️' };

/** 年表の1行(アイコン・年齢・文・お金の増減) */
function logRow(e: LogEntry): HTMLElement {
  const icon = e.type === 'death' ? '🕊️' : eventIcon(e.id);
  const money = moneyLabel(e.money);
  return h(
    'li',
    { class: `log log-${e.type}` },
    h('span', { class: 'log-age' }, ageMonthLabel(e.ageMonths, e.month)),
    h('span', { class: 'log-text' }, icon ? `${icon} ${e.text}` : e.text),
    money ? h('span', { class: `log-money ${e.money! > 0 ? 'up' : 'down'}` }, money) : '',
  );
}

export function resultScreen(root: HTMLElement, nav: Nav, state: GameState): void {
  const r = computeResult(state);
  const c = state.character;
  const canvas = h('canvas', { 'aria-label': '資産と幸福度の推移' });
  const timeline = collapseLog(r.timeline);
  const highlights = lifeHighlights(timeline);

  const exportLog = () => {
    const payload = {
      seed: state.seed,
      name: c.name,
      result: { ...r, timeline: undefined, yearly: undefined },
      log: state.log,
    };
    download(`life-${state.seed}.json`, JSON.stringify(payload, null, 2));
  };

  // 実績: この人生で取ったもの。前の人生までに取っていなければ NEW(リザルトの前に今回の記録は保存済み)
  const earned = earnedAchievements(state);
  const before = earnedSoFar(loadHistory().slice(1));
  const total = earnedSoFar(loadHistory());
  const achievementsCard = h(
    'section',
    { class: 'card' },
    h('h2', {}, `🏅 実績(これまでに ${total.size}/${gameData.achievements.length})`),
    earned.length > 0
      ? h(
          'ul',
          { class: 'achievement-list' },
          ...gameData.achievements
            .filter((d) => earned.includes(d.id))
            .map((d) =>
              h(
                'li',
                { class: 'achievement' },
                h('span', { class: 'achievement-icon', 'aria-hidden': 'true' }, d.icon),
                h(
                  'span',
                  {},
                  h('span', {}, h('strong', {}, d.title), before.has(d.id) ? '' : h('span', { class: 'new-badge' }, 'NEW')),
                  h('span', { class: 'muted small achievement-desc' }, d.description),
                ),
              ),
            ),
        )
      : h('p', { class: 'muted small' }, 'この人生で取った実績はない。'),
  );

  const tile = (icon: string, label: string, value: string, cls = '') =>
    h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, `${icon} ${label}`), h('span', { class: `tile-value ${cls}` }, value));

  mount(
    root,
    h(
      'main',
      { class: 'screen result-screen' },
      h('p', { class: 'muted' }, `${genderIcon(c.gender)} ${c.name}の一生`),
      h(
        'h1',
        { class: `life-type type-${r.lifeType}` },
        h('span', { class: 'life-type-icon', 'aria-hidden': 'true' }, LIFE_TYPE_ICONS[r.lifeType] ?? ''),
        LIFE_TYPE_LABELS[r.lifeType],
      ),
      h(
        'section',
        { class: 'tiles' },
        tile('⏳', '享年', `${r.ageAtDeath}歳`),
        tile(CAUSE_ICONS[r.cause] ?? '', '死因', DEATH_CAUSE_LABELS[r.cause]),
        tile('🏦', '最終資産', bigYen(r.finalNetWorth), r.finalNetWorth < 0 ? 'down' : ''),
        tile('🙂', '生涯幸福スコア', r.lifetimeHappiness.toFixed(1)),
      ),
      h(
        'p',
        { class: 'muted small result-profile' },
        `${EDUCATION_ICONS[c.education]} ${educationLabel(c.education)} · 🏠 実家${familyLabel(c.familyTier)} · ${REGION_ICONS[c.region]} ${regionLabel(c.region)} · ${JOB_ICONS[c.job]} 最後は${jobLabel(c.job)} · シード ${state.seed}`,
      ),
      achievementsCard,
      h('section', { class: 'card chart-card' }, h('h2', {}, '📈 資産と幸福度の推移'), h('div', { class: 'chart-box tall' }, canvas)),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, '✨ 人生のハイライト'),
        h('ol', { class: 'timeline' }, ...highlights.map(logRow)),
        h(
          'details',
          { class: 'all-events' },
          h('summary', {}, `すべての出来事(${timeline.length}件)`),
          ...byDecade(timeline).map(({ decade, entries }) =>
            h('details', { class: 'decade' }, h('summary', {}, `${decade}代(${entries.length}件)`), h('ol', { class: 'timeline' }, ...entries.map(logRow))),
          ),
        ),
      ),
      h(
        'div',
        { class: 'actions wrap' },
        h('button', { class: 'btn primary', onclick: () => nav.setup(state.seed + 1) }, '🎲 もう一度'),
        h('button', { class: 'btn', onclick: () => nav.setup(state.seed) }, '🔁 同じシードで'),
        h('button', { class: 'btn', onclick: () => nav.title() }, '🏠 タイトルへ'),
      ),
      h('button', { class: 'btn link-btn small', onclick: exportLog }, 'ログをJSONで保存'),
    ),
  );
  resultChart(canvas, r.yearly);
}
