// はじめての人目線の見直し(DESIGN.md §38)
import { describe, expect, it } from 'vitest';
import { defaultData } from '../src/data/index';
import { applyChoice, fireEvent } from '../src/engine/events';
import { getMonthlyView } from '../src/engine/step';
import { createRng } from '../src/engine/rng';
import type { EventDef } from '../src/engine/types';
import { ageMonthLabel, statLevel, STAT_LEVEL_LABELS } from '../src/ui/format';
import { makeState, setAge } from './helpers';

const byId = (id: string): EventDef => defaultData.events.find((e) => e.id === id)!;

describe('お金が動いた理由をログに書く', () => {
  it('転職の選択肢のログに、受け取った退職金を添える', () => {
    const s = makeState({ job: 'sales' });
    s.character.jobYears = 19;
    applyChoice(s, byId('job_offer'), 0, createRng(1));
    const last = s.log.at(-1)!;
    expect(last.text).toContain('退職金 487万円を受け取った');
  });

  it('親が亡くなったら、相続した額(なければ「遺産はなかった」)を添える', () => {
    const s = setAge(makeState(), 50);
    s.character.familyTier = 3;
    fireEvent(s, byId('parent_death'), createRng(1));
    expect(s.log.at(-1)!.text).toContain('遺産 500万円を相続した');
    const poor = setAge(makeState(), 50);
    poor.character.familyTier = 2;
    fireEvent(poor, byId('parent_death'), createRng(1));
    expect(poor.log.at(-1)!.text).toContain('遺産はなかった');
  });
});

describe('始めた月の幸福度', () => {
  it('まだ記録がなくても、今の状態から計算する(0=「とてもつらい」にしない)', () => {
    const s = makeState();
    s.happinessHistory = [];
    expect(getMonthlyView(s).happiness).toBeGreaterThan(30);
  });
});

describe('表示', () => {
  it('年齢と暦の月はかっこで分ける(「32歳(1月)」)', () => {
    expect(ageMonthLabel(32 * 12 + 9, 9)).toBe('32歳(1月)');
  });

  it('若いうちはスキルが低くても警告しない(「伸びしろ」)。年を取るほど普通の基準に近づく', () => {
    expect(STAT_LEVEL_LABELS[statLevel('skill', 10, 22 * 12)]).toBe('伸びしろ');
    expect(statLevel('skill', 10, 28 * 12)).toBe('caution');
    expect(statLevel('skill', 25, 28 * 12)).toBe('growing');
    expect(statLevel('skill', 10, 40 * 12)).toBe('danger');
    expect(statLevel('skill', 50, 22 * 12)).toBe('normal');
    // 年齢を渡さない・スキル以外は今までどおり
    expect(statLevel('skill', 10)).toBe('danger');
    expect(statLevel('health', 10, 22 * 12)).toBe('danger');
  });
});
