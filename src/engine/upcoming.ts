// 「これから」: 定年・ローンの完済・子どもの独立など、先の予定までの年数(UI の表示用。state を読むだけ)
import { defaultData } from '../data/index';
import { childAgeMonths, dependents, independentAge } from './children';
import { isEmployed, isRehired } from './money';
import type { GameData, GameState } from './types';
import { ageYears } from './util';

export interface Upcoming {
  label: string;
  months: number; // あと何ヶ月か
}

/** 元利均等で、残高を返し終わるまでの月数(返済額が利息に届かなければ Infinity) */
export function monthsToRepay(balance: number, payment: number, annualRate: number): number {
  if (balance <= 0) return 0;
  if (payment <= 0) return Infinity;
  const r = annualRate / 12;
  if (r === 0) return Math.ceil(balance / payment);
  const x = 1 - (r * balance) / payment;
  return x <= 0 ? Infinity : Math.ceil(-Math.log(x) / Math.log(1 + r));
}

/** 近い順に並べた先の予定 */
export function upcoming(state: GameState, data: GameData = defaultData): Upcoming[] {
  const { balance } = data;
  const c = state.character;
  const f = state.flags;
  const out: Upcoming[] = [];
  const toAge = (age: number) => Math.round((age - ageYears(state)) * 12);
  const timer = (key: string) => (typeof f[key] === 'number' ? (f[key] as number) : 0);

  if (!c.retired && isEmployed(state)) {
    const label = c.job === 'parttime' ? '年金の受け取り開始' : c.job === 'owner' ? '事業承継(65歳)' : '定年退職(65歳)';
    out.push({ label, months: toAge(balance.pension.retireAge) });
  }
  if (isRehired(state)) out.push({ label: '仕事を辞める', months: timer('rehire') });
  if (timer('maternityLeave') > 0) out.push({ label: '産休が終わる', months: timer('maternityLeave') });
  else if (timer('parentalLeave') > 0) out.push({ label: '育休が終わる', months: timer('parentalLeave') });
  if (timer('pregnant') > 0) out.push({ label: '出産', months: timer('pregnant') - 1 });
  dependents(state, data).forEach((child) => {
    const order = (c.children ?? []).indexOf(child) + 1;
    out.push({ label: `${order}人目の子どもの独立`, months: independentAge(child, data) * 12 - childAgeMonths(state, child) });
  });
  const a = state.assets;
  if ((a.mortgage ?? 0) > 0 && state.home) {
    out.push({ label: '住宅ローンの完済', months: monthsToRepay(a.mortgage!, state.home.payment, balance.housing.mortgage.annualRate) });
  }
  if ((a.loan ?? 0) > 0) {
    out.push({ label: 'ローンの完済', months: monthsToRepay(a.loan!, c.loanPayment ?? 0, balance.loan.annualRate) });
  }
  if (a.studentLoan > 0 && c.studentLoan) {
    out.push({ label: '奨学金の完済', months: monthsToRepay(a.studentLoan, c.studentLoan.monthlyPayment, c.studentLoan.annualRate) });
  }
  if (timer('blacklist') > 0) out.push({ label: 'ブラックリストが消える', months: timer('blacklist') });
  return out.filter((u) => Number.isFinite(u.months) && u.months >= 0).sort((x, y) => x.months - y.months);
}
