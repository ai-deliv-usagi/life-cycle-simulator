import { describe, expect, it } from 'vitest';
import { defaultData } from '../src/data/index';
import { earnedAchievements, uncheckedAchievements } from '../src/engine/achievements';
import { addLog } from '../src/engine/util';
import { createRng } from '../src/engine/rng';
import { stepMonth } from '../src/engine/step';
import { earnedSoFar, toLifeRecord } from '../src/ui/storage';
import { makeState, setAge } from './helpers';

/** 亡くなった状態(実績はこれを見て判定する) */
function dead(age: number) {
  const s = setAge(makeState(), age);
  s.dead = { cause: 'old_age', ageMonths: s.ageMonths };
  s.happinessHistory = [50];
  return s;
}

describe('実績', () => {
  it('achievements.json の実績にはすべて判定がある', () => {
    expect(uncheckedAchievements()).toEqual([]);
    expect(defaultData.achievements.length).toBe(12);
  });

  it('年齢・家族・お金の実績', () => {
    const s = dead(100);
    s.character.children = [{ birthMonth: 0, university: false }, { birthMonth: 0, university: false }, { birthMonth: 0, university: false }];
    s.assets.cash = 120_000_000;
    addLog(s, 'event', '孫が生まれる: …', 'grandchild');
    expect(earnedAchievements(s)).toEqual(expect.arrayContaining(['okuribito', 'centenarian', 'big_family', 'grandparent', 'never_hospital']));
    addLog(s, 'event', '入院: …', 'hospital');
    expect(earnedAchievements(s)).not.toContain('never_hospital');
  });

  it('選択の実績は選んだときだけ(転職3回、バイトから正社員)', () => {
    const s = dead(60);
    for (let i = 0; i < 2; i++) addLog(s, 'choice', '転職の誘い: 「同業他社に転職する」', 'job_offer');
    addLog(s, 'choice', '転職の誘い: 「断る」', 'job_offer');
    addLog(s, 'choice', '正社員の求人: 「バイトを続ける」', 'regular_job_offer');
    expect(earnedAchievements(s)).not.toContain('job_hopper');
    expect(earnedAchievements(s)).not.toContain('regular_path');
    addLog(s, 'choice', '転職の誘い: 「異業種に転職する」', 'job_offer');
    addLog(s, 'choice', '正社員登用の話: 「正社員になる」', 'regular_conversion');
    expect(earnedAchievements(s)).toEqual(expect.arrayContaining(['job_hopper', 'regular_path']));
  });

  it('自己破産から立ち直る・65歳で無借金', () => {
    const s = dead(80);
    addLog(s, 'event', '自己破産: …', 'bankruptcy');
    s.assets.cash = 9_000_000;
    expect(earnedAchievements(s)).not.toContain('comeback');
    s.assets.cash = 10_000_000;
    expect(earnedAchievements(s)).toContain('comeback');
    let t = setAge(makeState({ initialCash: 5_000_000 }), 65);
    t.ageMonths = 65 * 12 - 1;
    t = stepMonth(t, createRng(1));
    expect(t.flags.debtFreeAt65).toBe(true);
  });

  it('過去の人生の記録に残り、これまでに取った実績をまとめられる', () => {
    const s = dead(100);
    const rec = toLifeRecord(s);
    expect(rec.achievements).toContain('centenarian');
    expect([...earnedSoFar([rec, { ...rec, achievements: ['okuribito'] }, { ...rec, achievements: undefined }])].sort()).toEqual(
      [...new Set([...rec.achievements!, 'okuribito'])].sort(),
    );
  });
});
