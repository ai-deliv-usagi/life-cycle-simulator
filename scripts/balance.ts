// N人生を自動プレイしてバランス統計を出す(SPEC.md「バランス確認」、DESIGN.md §11.2)
//   npx tsx scripts/balance.ts [--n 1000] [--seed 1] [--policy random|grind] [--json]
import { defaultData } from '../src/data/index';
import {
  availableChoices,
  computeResult,
  createGame,
  createRng,
  deriveSeed,
  resolveChoice,
  rollCharacter,
  stepMonth,
  type GameState,
  type LifeResult,
  type Policy,
  type Rng,
  type Values,
} from '../src/engine/index';

interface Options {
  n: number;
  seed: number;
  policy: 'random' | 'grind';
  json: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { n: 1000, seed: 1, policy: 'random', json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--n') opts.n = Number(argv[++i]);
    else if (a === '--seed') opts.seed = Number(argv[++i]);
    else if (a === '--policy') opts.policy = argv[++i] === 'grind' ? 'grind' : 'random';
    else if (a === '--json') opts.json = true;
  }
  return opts;
}

const WORKS = ['regular', 'normal', 'overtime', 'grind'] as const;
const SPENDINGS = ['frugal', 'normal', 'comfort', 'lavish'] as const;
const INVESTS = ['deposit', 'index', 'stocks', 'speculative'] as const;
const CARES = ['ignore', 'normal', 'active'] as const;

function randomPolicy(rng: Rng, fixed: Options['policy']): Policy {
  return {
    work: fixed === 'grind' ? 'grind' : rng.pick(WORKS),
    spending: rng.pick(SPENDINGS),
    invest: rng.pick(INVESTS),
    health: rng.pick(CARES),
  };
}

function randomValues(rng: Rng): Values {
  const v = () => Math.round((rng.next() * 4 - 2) * 2) / 2; // -2〜+2 の0.5刻み
  return { risk: v(), relation: v(), spending: v(), work: v() };
}

export interface LifeStats {
  result: LifeResult;
  events: number; // システムイベント(再就職・退職・自己破産)を除く
  eventIds: string[];
  job: string;
  education: string;
  bankrupt: boolean;
}

/** 1人生を自動プレイする。方針は10年ごとに引き直し、選択肢はランダム */
export function playLife(seed: number, fixed: Options['policy'] = 'random'): LifeStats {
  const player = createRng(deriveSeed(seed, 'player'));
  const roll = rollCharacter(seed);
  let state: GameState = createGame(roll, randomValues(player), randomPolicy(player, fixed), `自動${seed}`);
  const system = new Set(defaultData.events.filter((e) => e.category === 'system').map((e) => e.id));

  while (!state.dead) {
    if (state.month > 0 && state.month % 120 === 0) state = { ...state, policy: randomPolicy(player, fixed) };
    const rng = createRng(state.rngState);
    state = stepMonth(state, rng);
    if (state.pendingEvent) {
      const ev = defaultData.events.find((e) => e.id === state.pendingEvent!.eventId)!;
      const choice = player.pick(availableChoices(ev, state));
      state = resolveChoice(state, choice.index, createRng(state.rngState));
    }
  }

  const eventIds = state.log.filter((e) => e.type === 'event' && e.id && defaultData.events.some((d) => d.id === e.id)).map((e) => e.id!);
  return {
    result: computeResult(state),
    events: eventIds.filter((id) => !system.has(id)).length,
    eventIds,
    job: roll.job,
    education: roll.education,
    bankrupt: state.flags.bankrupt === true,
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const man = (yen: number) => `${Math.round(yen / 10_000).toLocaleString('ja-JP')}万円`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function runBalance(opts: Options) {
  const started = Date.now();
  const lives = Array.from({ length: opts.n }, (_, i) => playLife(opts.seed * 1_000_003 + i, opts.policy));
  const grind = Array.from({ length: opts.n }, (_, i) => playLife(opts.seed * 1_000_003 + i, 'grind'));
  const elapsed = (Date.now() - started) / 1000;

  const lifespan = mean(lives.map((l) => l.result.ageAtDeath));
  const grindLifespan = mean(grind.map((l) => l.result.ageAtDeath));
  const medianNetWorth = median(lives.map((l) => l.result.finalNetWorth));
  const typeShare = Object.fromEntries(
    (['winner', 'poor_happy', 'rich_unhappy', 'hardship'] as const).map((t) => [
      t,
      lives.filter((l) => l.result.lifeType === t).length / lives.length,
    ]),
  ) as Record<string, number>;
  const eventsPerLife = mean(lives.map((l) => l.events));

  const eventCounts: Record<string, number> = Object.fromEntries(defaultData.events.map((e) => [e.id, 0]));
  for (const l of lives) for (const id of l.eventIds) eventCounts[id] = (eventCounts[id] ?? 0) + 1;
  const neverFired = Object.entries(eventCounts).filter(([, c]) => c === 0).map(([id]) => id);

  const causes: Record<string, number> = {};
  for (const l of lives) causes[l.result.cause] = (causes[l.result.cause] ?? 0) + 1 / lives.length;

  const groupMedian = (key: 'job' | 'education') => {
    const groups: Record<string, number[]> = {};
    for (const l of lives) (groups[l[key]] ??= []).push(l.result.finalNetWorth);
    return Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, median(v)]));
  };

  const checks = [
    { name: '平均寿命(全方針ランダム)', value: `${lifespan.toFixed(1)}歳`, target: '78〜85歳', ok: lifespan >= 78 && lifespan <= 85 },
    {
      name: '激務を続けた場合の平均寿命',
      value: `${grindLifespan.toFixed(1)}歳(差 ${(lifespan - grindLifespan).toFixed(1)}歳)`,
      target: '全体より5歳以上短い',
      ok: lifespan - grindLifespan >= 5,
    },
    { name: '最終資産の中央値', value: man(medianNetWorth), target: '1,000万〜3,000万円', ok: medianNetWorth >= 10_000_000 && medianNetWorth <= 30_000_000 },
    {
      name: '4つの人生タイプの割合',
      value: Object.entries(typeShare).map(([t, s]) => `${t} ${pct(s)}`).join(' / '),
      target: 'どれも10%以上',
      ok: Object.values(typeShare).every((s) => s >= 0.1),
    },
    { name: '1人生あたりのイベント数', value: eventsPerLife.toFixed(1), target: '40〜80回', ok: eventsPerLife >= 40 && eventsPerLife <= 80 },
    { name: '全イベントが1回以上発生', value: neverFired.length === 0 ? 'すべて発生' : `未発生: ${neverFired.join(', ')}`, target: '未発生なし', ok: neverFired.length === 0 },
  ];

  return {
    checks,
    detail: {
      lives: opts.n,
      seconds: elapsed,
      avgHappiness: mean(lives.map((l) => l.result.lifetimeHappiness)),
      bankruptShare: lives.filter((l) => l.bankrupt).length / lives.length,
      causes,
      eventCounts,
      medianByJob: groupMedian('job'),
      medianByEducation: groupMedian('education'),
    },
  };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { checks, detail } = runBalance(opts);
  if (opts.json) {
    console.log(JSON.stringify({ checks, detail }, null, 2));
    return;
  }
  console.log(`\n=== バランス確認(${detail.lives}人生 × 2、${detail.seconds.toFixed(1)}秒)===\n`);
  for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name}: ${c.value}  [目安 ${c.target}]`);
  console.log(`\n生涯幸福スコアの平均: ${detail.avgHappiness.toFixed(1)} / 自己破産: ${pct(detail.bankruptShare)}`);
  console.log(`死因: ${Object.entries(detail.causes).map(([k, v]) => `${k} ${pct(v)}`).join(' / ')}`);
  console.log(`職業別の最終資産中央値: ${Object.entries(detail.medianByJob).map(([k, v]) => `${k} ${man(v)}`).join(' / ')}`);
  console.log(`学歴別の最終資産中央値: ${Object.entries(detail.medianByEducation).map(([k, v]) => `${k} ${man(v)}`).join(' / ')}`);
  console.log('\nイベント別の発生回数:');
  console.log(
    Object.entries(detail.eventCounts)
      .map(([id, c]) => `  ${id.padEnd(18)} ${String(c).padStart(6)}`)
      .join('\n'),
  );
  if (!checks.every((c) => c.ok)) process.exitCode = 1;
}

if (process.argv[1]?.endsWith('balance.ts')) main();
