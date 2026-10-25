// イベント・選択結果・年間サマリー・方針変更のモーダル
import { availableChoices, gameData, type GameState, type LogEntry, type Policy } from '../../engine/index';
import { h, openModal } from '../dom';
import { healthWord, manYen, signedManYen } from '../format';
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
      h('p', { class: 'event-age muted' }, `${Math.floor(state.ageMonths / 12)}歳`),
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
      ),
      info.events.length > 0
        ? h('ul', { class: 'summary-events' }, ...info.events.map((e) => h('li', {}, e.text.split(':')[0] ?? e.text)))
        : h('p', { class: 'muted' }, '大きな出来事のない1年だった。'),
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
