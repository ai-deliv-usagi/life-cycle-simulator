import { describe, expect, it } from 'vitest';
import { defaultData } from '../src/data/index';
import {
  selectableChoices,
  changePolicy,
  computeResult,
  createGame,
  createRng,
  getMonthlyView,
  resolveChoice,
  rollCharacter,
  stepMonth,
  type GameState,
} from '../src/engine/index';
import { defaultPolicy, neutralValues } from './helpers';

function newGame(seed: number): GameState {
  return createGame(rollCharacter(seed), neutralValues, { ...defaultPolicy, invest: 'index' }, 'テスト');
}

/** 1ヶ月進め、選択待ちなら最初の選択肢を選ぶ */
function advance(state: GameState): GameState {
  let s = stepMonth(state, createRng(state.rngState));
  if (s.pendingEvent) {
    const ev = defaultData.events.find((e) => e.id === s.pendingEvent!.eventId)!;
    s = resolveChoice(s, selectableChoices(ev, s)[0]!.index, createRng(s.rngState));
  }
  return s;
}

function playToDeath(state: GameState, onMonth: (s: GameState) => void = () => {}): GameState {
  let s = state;
  while (!s.dead) {
    s = advance(s);
    onMonth(s);
  }
  return s;
}

describe('stepMonth', () => {
  it('同じシード・同じ選択なら同じ人生(死亡月・最終資産)', () => {
    const a = playToDeath(newGame(7));
    const b = playToDeath(newGame(7));
    expect(a.dead).toEqual(b.dead);
    expect(a.assets).toEqual(b.assets);
    expect(a.log).toEqual(b.log);
  });

  it('セーブ(JSON往復)から再開しても同じ人生になる', () => {
    const straight = playToDeath(newGame(11));
    let s = newGame(11);
    for (let i = 0; i < 240; i++) s = advance(s);
    const loaded = JSON.parse(JSON.stringify(s)) as GameState;
    const resumed = playToDeath(loaded);
    expect(resumed.dead).toEqual(straight.dead);
    expect(resumed.assets).toEqual(straight.assets);
  });

  it('引数の state を書き換えない', () => {
    const s = newGame(3);
    const snapshot = JSON.stringify(s);
    stepMonth(s, createRng(s.rngState));
    expect(JSON.stringify(s)).toBe(snapshot);
  });

  it('選択待ち・死亡後は進まない', () => {
    let s = newGame(5);
    while (!s.pendingEvent) s = stepMonth(s, createRng(s.rngState));
    expect(stepMonth(s, createRng(s.rngState))).toBe(s);
    const dead = playToDeath(newGame(5));
    expect(stepMonth(dead, createRng(dead.rngState))).toBe(dead);
  });

  it('12ヶ月ごとに年間サマリー、65歳で定年退職、最後に死亡のログ', () => {
    const s = playToDeath(newGame(13));
    const summaries = s.log.filter((e) => e.type === 'year_summary');
    expect(summaries.length).toBe(Math.floor(s.month / 12) - (s.month % 12 === 0 ? 1 : 0));
    for (const e of summaries) expect(e.month % 12).toBe(0);
    if (s.ageMonths >= 65 * 12) expect(s.log.some((e) => e.id === 'retirement')).toBe(true);
    expect(s.log.at(-1)!.type).toBe('death');
  });

  it('ステータスは0〜100、価値観は−2〜+2、金額は整数のまま', () => {
    playToDeath(newGame(17), (s) => {
      for (const v of Object.values(s.stats)) expect(v >= 0 && v <= 100).toBe(true);
      for (const v of Object.values(s.values)) expect(v >= -2 && v <= 2).toBe(true);
      for (const v of Object.values(s.assets)) expect(Number.isInteger(v)).toBe(true);
    });
  });

  it('ログは JSON としてそのまま使える', () => {
    const s = playToDeath(newGame(19));
    expect(JSON.parse(JSON.stringify(s.log))).toEqual(s.log);
  });

  it('死亡まで進めるとリザルトが出る', () => {
    const r = computeResult(playToDeath(newGame(23)));
    expect(r.ageAtDeath).toBeGreaterThan(15);
    expect(r.yearly.length).toBeGreaterThan(0);
  });
});

describe('changePolicy', () => {
  it('次の月から反映され、ログに残る', () => {
    const s = newGame(29);
    const changed = changePolicy(s, { ...s.policy, work: 'grind' });
    expect(s.policy.work).toBe('regular');
    expect(changed.log.at(-1)).toMatchObject({ type: 'policy' });
    expect(changed.log.at(-1)!.text).toContain('激務');
    const a = stepMonth(s, createRng(s.rngState));
    const b = stepMonth(changed, createRng(changed.rngState));
    expect(b.stats.stress).toBeGreaterThan(a.stats.stress);
  });
});

describe('getMonthlyView', () => {
  it('表示用の値を返す', () => {
    const v = getMonthlyView(newGame(31));
    expect(v.age).toBeGreaterThanOrEqual(15);
    expect(v.householdNet).toBeGreaterThan(0);
    expect(typeof v.jobLabel).toBe('string');
  });
});
