import { describe, expect, it } from 'vitest';
import { defaultData, validateData } from '../src/data/index';
import type { GameData } from '../src/engine/types';

function clone(data: GameData): GameData {
  return structuredClone(data);
}

describe('validateData', () => {
  it('既定のデータは正常', () => {
    expect(validateData(defaultData)).toEqual([]);
  });

  it('出現率の合計が1でないと検出する', () => {
    const data = clone(defaultData);
    data.education[0]!.prob += 0.1;
    expect(validateData(data)).toContain('education: 出現率の合計が1でない');
  });

  it('id の重複と欠けを検出する', () => {
    const data = clone(defaultData);
    data.regions[1] = { ...data.regions[0]! };
    const errors = validateData(data);
    expect(errors).toContain('region: id "metro" が重複している');
    expect(errors).toContain('region: id "city" がない');
  });

  it('手取り率の帯の並びを検出する', () => {
    const data = clone(defaultData);
    data.balance.takeHome.bands.reverse();
    expect(validateData(data).some((e) => e.startsWith('balance.takeHome.bands'))).toBe(true);
  });

  it('イベントの不正を検出する', () => {
    const data = clone(defaultData);
    data.events = [
      {
        id: 'x',
        category: 'life',
        title: 't',
        text: 't',
        conditions: {},
        baseProb: 1.5,
        choices: [
          {
            label: 'a',
            outcomes: [{ prob: 0.5, text: 'o', effects: { stats: { mood: 1 } as never } }],
            valueShift: { money: 0.1 } as never,
          },
        ],
      },
      { id: 'x', category: 'life', title: 't', text: 't', conditions: {}, baseProb: 0.1 },
    ];
    const errors = validateData(data);
    expect(errors).toContain('events: id "x" が重複している');
    expect(errors).toContain('events.x: baseProb が0〜1でない');
    expect(errors).toContain('events.x: 不明なステータス "mood"');
    expect(errors).toContain('events.x: 選択肢「a」の outcomes の確率の合計が1でない');
    expect(errors).toContain('events.x: 不明な価値観 "money"');
  });
});
