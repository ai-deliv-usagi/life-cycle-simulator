import { describe, expect, it } from 'vitest';
import { byDecade, lifeHighlights } from '../src/ui/format';

const e = (type: string, id: string | undefined, text: string, ageMonths = 300, money?: number) => ({
  type,
  ...(id ? { id } : {}),
  text,
  ageMonths,
  month: 0,
  ...(money !== undefined ? { money } : {}),
});

describe('人生のハイライト', () => {
  it('結婚・昇進・転職などは選んだときだけ。大事な出来事・大きなお金の動き・亡くなったときは必ず', () => {
    const log = [
      e('choice', 'proposal', 'プロポーズのチャンス: 「結婚する」'),
      e('choice', 'proposal', 'プロポーズのチャンス: 「まだ早い」'),
      e('choice', 'promotion', '昇進: 「受ける」'),
      e('choice', 'promotion', '昇進: 「断る」'),
      e('choice', 'birth', '出産: 「育休は取らない」'),
      e('event', 'cold', '風邪で休む: …'),
      e('event', 'layoff', 'リストラ: …'),
      e('event', 'home_bought', 'マイホーム: …'),
      e('choice', 'travel', '旅行のチャンス: 「海外旅行に行く」', 300, -400_000),
      e('choice', 'luxury_car', '高級車の誘惑: 「高級車を買う」', 300, -6_000_000),
      e('policy', undefined, '方針変更: …'),
      e('death', undefined, '80歳、老衰で亡くなった'),
    ];
    expect(lifeHighlights(log).map((x) => x.text)).toEqual([
      'プロポーズのチャンス: 「結婚する」',
      '昇進: 「受ける」',
      '出産: 「育休は取らない」',
      'リストラ: …',
      'マイホーム: …',
      '高級車の誘惑: 「高級車を買う」',
      '80歳、老衰で亡くなった',
    ]);
  });

  it('年代ごとに分ける', () => {
    const groups = byDecade([e('event', 'a', 'x', 22 * 12), e('event', 'b', 'y', 29 * 12 + 11), e('event', 'c', 'z', 41 * 12)]);
    expect(groups.map((g) => [g.decade, g.entries.length])).toEqual([
      [20, 2],
      [40, 1],
    ]);
  });
});
