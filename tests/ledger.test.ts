import { describe, expect, it } from 'vitest';
import { defaultData } from '../src/data/index';
import { applyChoice, fireEvent } from '../src/engine/events';
import { ledgerTotals } from '../src/engine/ledger';
import { changeJob } from '../src/engine/money';
import { createRng } from '../src/engine/rng';
import { stepMonth } from '../src/engine/step';
import type { EventDef, GameState } from '../src/engine/types';
import { flatRng, makeState } from './helpers';

const byId = (id: string): EventDef => defaultData.events.find((e) => e.id === id)!;

/** イベントを起こさずに n ヶ月進める(イベントは選択待ちになったら外す) */
function advance(s: GameState, n: number): GameState {
  for (let i = 0; i < n; i++) {
    s = stepMonth(s, createRng(s.rngState));
    delete s.pendingEvent;
  }
  return s;
}

describe('年間の収支', () => {
  it('12ヶ月ごとに今年の分を前の年(lastLedger)に移し、新しい年を0から始める', () => {
    const s = advance(makeState({}, { invest: 'index' }), 12);
    expect(s.lastLedger).toBeDefined();
    expect(s.lastLedger!.income.salary).toBeGreaterThan(12 * 150_000);
    expect(s.lastLedger!.expenses.living).toBeGreaterThan(0);
    expect(s.lastLedger!.invested).toBeGreaterThan(0);
    expect(Object.values(s.ledger!.income).every((v) => v === 0)).toBe(true);
  });

  it('イベントのお金の出入りを記録する(出費・臨時収入)', () => {
    const s = makeState();
    fireEvent(s, byId('traffic_accident'), flatRng);
    fireEvent(s, byId('windfall_bonus'), flatRng);
    expect(s.ledger!.eventOut).toBe(100_000); // 高額療養費で10万円まで
    expect(s.ledger!.eventIn).toBe(Math.round(3_220_000 / 16));
  });

  it('退職金は収入の「退職金」に入る', () => {
    const s = makeState({ job: 'sales' });
    s.character.jobYears = 19;
    changeJob(s, 'office');
    expect(s.ledger!.income.severance).toBe(7_500_000);
    expect(s.ledger!.eventIn).toBe(0);
  });

  it('転職イベントでも、退職金はイベントの臨時収入に数えない', () => {
    const s = makeState({ job: 'sales' });
    s.character.jobYears = 19;
    applyChoice(s, byId('job_offer'), 0, createRng(1));
    expect(s.ledger!.income.severance).toBe(7_500_000);
    expect(s.ledger!.eventIn).toBe(0);
  });

  it('合計 = 内訳の合計 + イベント', () => {
    const s = advance(makeState(), 12);
    const l = s.lastLedger!;
    const t = ledgerTotals(l);
    expect(t.income).toBe(Object.values(l.income).reduce((a, b) => a + b, 0) + l.eventIn);
    expect(t.expenses).toBe(Object.values(l.expenses).reduce((a, b) => a + b, 0) + l.debtInterest + l.eventOut);
  });
});
