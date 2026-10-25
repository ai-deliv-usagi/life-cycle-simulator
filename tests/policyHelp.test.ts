import { describe, expect, it } from 'vitest';
import { defaultData } from '../src/data/index';
import { healthHelp, investHelp, spendingHelp, workHelp } from '../src/ui/policyHelp';

describe('方針の説明(balance.json から作る)', () => {
  it('働き方: 収入の増減・自由時間・死亡率が balance.json の値どおり', () => {
    const g = defaultData.balance.work.grind;
    const text = workHelp('grind');
    expect(text).toContain(`収入+${Math.round((g.income - 1) * 100)}%`);
    expect(text).toContain(`自由時間 ${g.freeTime}/100`);
    expect(text).toContain(`死亡率×${g.death}`);
    expect(workHelp('regular')).not.toContain('死亡率');
  });

  it('支出・健康・投資の説明', () => {
    expect(spendingHelp('frugal')).toContain('×0.8');
    expect(spendingHelp('lavish')).toContain('自己破産');
    expect(healthHelp('active')).toContain('月1.5万円');
    expect(healthHelp('ignore')).toContain('出費なし');
    expect(investHelp('index')).toContain('年5%前後・振れ幅15%');
    expect(investHelp('speculative')).toContain('暴落(-60%)');
  });
});
