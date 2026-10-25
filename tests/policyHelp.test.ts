import { describe, expect, it } from 'vitest';
import { healthHelp, investHelp, spendingHelp, workHelp } from '../src/ui/policyHelp';

describe('方針の説明', () => {
  it('すべての選択肢に、数字を使わない説明がある', () => {
    const texts = [
      ...(['regular', 'normal', 'overtime', 'grind'] as const).map(workHelp),
      ...(['frugal', 'normal', 'comfort', 'lavish'] as const).map(spendingHelp),
      ...(['ignore', 'normal', 'active'] as const).map(healthHelp),
      ...(['deposit', 'index', 'stocks', 'speculative'] as const).map(investHelp),
    ];
    for (const t of texts) {
      expect(t.length).toBeGreaterThan(5);
      expect(t).not.toMatch(/[0-9]/);
    }
  });
});
