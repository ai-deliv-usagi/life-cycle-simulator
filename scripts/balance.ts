// N人生を自動プレイしてバランス統計を出す(SPEC.md「バランス確認」、DESIGN.md §11.2・§33)
//   npx tsx scripts/balance.ts [--n 1000] [--seed 1] [--json]
// タイプ別プレイヤー(6タイプを同じ数ずつ)で全体とタイプごとの目安を見て、
// でたらめなプレイヤーで「全イベントが1回は起きる」を確かめる
import { defaultData } from '../src/data/index';
import {
  computeResult,
  createGame,
  createRng,
  deriveSeed,
  resolveChoice,
  rollCharacter,
  stepMonth,
  type GameState,
  type LifeResult,
} from '../src/engine/index';
import { HUSTLE_PLAYER, RANDOM_PLAYER, SYSTEM_EVENTS, TYPED_PLAYERS, type Player } from './players';

interface Options {
  n: number;
  seed: number;
  json: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { n: 1000, seed: 1, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--n') opts.n = Number(argv[++i]);
    else if (a === '--seed') opts.seed = Number(argv[++i]);
    else if (a === '--json') opts.json = true;
  }
  return opts;
}

export interface LifeStats {
  player: string;
  result: LifeResult;
  eventIds: string[];
  job: string;
  education: string;
  bankrupt: boolean;
  married: boolean; // 一度でも結婚したか
  choices: number; // 選択肢で止まった回数
  notices: number; // 選択肢のない出来事(スナックバー)の回数。システムの記録は数えない
  years: number; // 社会人になってからの年数
}

const CHOICE_EVENTS = new Set(defaultData.events.filter((e) => e.choices?.length).map((e) => e.id));

/** 1人生を自動プレイする */
export function playLife(seed: number, player: Player): LifeStats {
  const rng = createRng(deriveSeed(seed, `player-${player.id}`));
  const roll = rollCharacter(seed);
  let state: GameState = createGame(roll, player.values(rng), player.policy(rng, 0), `自動${seed}`);
  let married = false;
  let choices = 0;
  let notices = 0;

  while (!state.dead) {
    if (state.month > 0) {
      const policy = player.policy(rng, state.month, state.policy);
      if (policy !== state.policy) state = { ...state, policy };
    }
    const before = state.log.length;
    state = stepMonth(state, createRng(state.rngState));
    married ||= state.character.married;
    for (const e of state.log.slice(before)) {
      if (e.type === 'event' && e.id && !CHOICE_EVENTS.has(e.id) && !SYSTEM_EVENTS.has(e.id) && defaultData.events.some((d) => d.id === e.id)) notices++;
    }
    if (state.pendingEvent) {
      const ev = defaultData.events.find((e) => e.id === state.pendingEvent!.eventId)!;
      if (!SYSTEM_EVENTS.has(ev.id)) choices++;
      state = resolveChoice(state, player.choose(state, ev, rng), createRng(state.rngState));
    }
  }

  const result = computeResult(state);
  return {
    player: player.id,
    result,
    eventIds: state.log.filter((e) => e.type === 'event' && e.id && defaultData.events.some((d) => d.id === e.id)).map((e) => e.id!),
    job: roll.job,
    education: roll.education,
    bankrupt: state.flags.bankrupt === true,
    married: married || state.character.married,
    choices,
    notices,
    years: result.ageAtDeath - state.startAge,
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const share = <T>(xs: T[], f: (x: T) => boolean) => xs.filter(f).length / xs.length;
const man = (yen: number) => `${Math.round(yen / 10_000).toLocaleString('ja-JP')}万円`;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const LIFE_TYPES = ['winner', 'poor_happy', 'rich_unhappy', 'hardship'] as const;

export function runBalance(opts: Options) {
  const started = Date.now();
  const base = opts.seed * 1_000_003;
  // タイプ別: 同じ生まれの並びを6タイプで順に使う(タイプの差が生まれの差に埋もれないように)
  const lives = Array.from({ length: opts.n }, (_, i) => playLife(base + Math.floor(i / TYPED_PLAYERS.length), TYPED_PLAYERS[i % TYPED_PLAYERS.length]!));
  const random = Array.from({ length: opts.n }, (_, i) => playLife(base + i, RANDOM_PLAYER));
  const hustle = Array.from({ length: Math.ceil(opts.n / TYPED_PLAYERS.length) }, (_, i) => playLife(base + i, HUSTLE_PLAYER));
  const elapsed = (Date.now() - started) / 1000;

  const byType = Object.fromEntries(TYPED_PLAYERS.map((p) => [p.id, lives.filter((l) => l.player === p.id)])) as Record<string, LifeStats[]>;
  const lifespan = mean(lives.map((l) => l.result.ageAtDeath));
  const hustleLifespan = mean(hustle.map((l) => l.result.ageAtDeath));
  const medianNetWorth = median(lives.map((l) => l.result.finalNetWorth));
  const typeShare = Object.fromEntries(LIFE_TYPES.map((t) => [t, share(lives, (l) => l.result.lifeType === t)])) as Record<string, number>;
  const totalYears = lives.reduce((s, l) => s + l.years, 0);
  const choicesPerYear = lives.reduce((s, l) => s + l.choices, 0) / totalYears;
  const noticesPerYear = lives.reduce((s, l) => s + l.notices, 0) / totalYears;

  const eventCounts: Record<string, number> = Object.fromEntries(defaultData.events.map((e) => [e.id, 0]));
  for (const l of [...lives, ...random]) for (const id of l.eventIds) eventCounts[id] = (eventCounts[id] ?? 0) + 1;
  const neverFired = Object.entries(eventCounts).filter(([, c]) => c === 0).map(([id]) => id);

  const typeRows = TYPED_PLAYERS.map((p) => {
    const ls = byType[p.id]!;
    return {
      id: p.id,
      label: p.label,
      lifespan: mean(ls.map((l) => l.result.ageAtDeath)),
      medianNetWorth: median(ls.map((l) => l.result.finalNetWorth)),
      bankrupt: share(ls, (l) => l.bankrupt),
      married: share(ls, (l) => l.married),
      winner: share(ls, (l) => l.result.lifeType === 'winner'),
      happy: share(ls, (l) => l.result.lifeType === 'winner' || l.result.lifeType === 'poor_happy'), // 勝ち組(幸せ)
      lifeTypes: Object.fromEntries(LIFE_TYPES.map((t) => [t, share(ls, (l) => l.result.lifeType === t)])),
    };
  });
  const row = (id: string) => typeRows.find((r) => r.id === id)!;
  const steady = row('steady');
  const maxHappy = typeRows.reduce((m, r) => (r.happy > m.happy ? r : m));
  const minHappy = typeRows.reduce((m, r) => (r.happy < m.happy ? r : m));
  const spender = row('spender');
  const family = row('family');
  const minMarried = Math.min(...typeRows.map((r) => r.married));

  const checks = [
    { name: '平均寿命(タイプ別プレイヤー全体)', value: `${lifespan.toFixed(1)}歳`, target: '78〜85歳', ok: lifespan >= 78 && lifespan <= 85 },
    {
      name: 'モーレツ(激務・健康は気にしない)を続けた平均寿命',
      value: `${hustleLifespan.toFixed(1)}歳(全体との差 ${(lifespan - hustleLifespan).toFixed(1)}歳)`,
      target: '全体より5〜12歳短い',
      ok: lifespan - hustleLifespan >= 5 && lifespan - hustleLifespan <= 12,
    },
    { name: '最終資産の中央値', value: man(medianNetWorth), target: '1,000万〜4,000万円', ok: medianNetWorth >= 10_000_000 && medianNetWorth <= 40_000_000 },
    {
      name: '4つの人生タイプの割合',
      value: Object.entries(typeShare).map(([t, s]) => `${t} ${pct(s)}`).join(' / '),
      target: 'どれも10%以上',
      ok: Object.values(typeShare).every((s) => s >= 0.1),
    },
    { name: '選択で止まる回数', value: `年${choicesPerYear.toFixed(2)}回`, target: '年0.7〜1.5回', ok: choicesPerYear >= 0.7 && choicesPerYear <= 1.5 },
    { name: '選択のない通知', value: `年${noticesPerYear.toFixed(2)}回`, target: '年0.3〜1.5回', ok: noticesPerYear >= 0.3 && noticesPerYear <= 1.5 },
    {
      name: '必ず勝てるタイプはない(勝ち組=幸せな人生)',
      value: `いちばん高い ${maxHappy.label} で ${pct(maxHappy.happy)}`,
      target: '95%以下',
      ok: maxHappy.happy <= 0.95,
    },
    {
      name: 'どのタイプにも勝ち筋がある',
      value: `いちばん低い ${minHappy.label} で ${pct(minHappy.happy)}`,
      target: '25%以上',
      ok: minHappy.happy >= 0.25,
    },
    { name: '堅実派の自己破産', value: pct(steady.bankrupt), target: '5%未満', ok: steady.bankrupt < 0.05 },
    { name: '浪費家の自己破産', value: pct(spender.bankrupt), target: '20〜60%', ok: spender.bankrupt >= 0.2 && spender.bankrupt <= 0.6 },
    { name: '家族思いの結婚', value: pct(family.married), target: '70%以上', ok: family.married >= 0.7 },
    { name: 'どのタイプも結婚する', value: `いちばん低いタイプで ${pct(minMarried)}`, target: '20%以上', ok: minMarried >= 0.2 },
    {
      name: '全イベントが1回以上発生(でたらめなプレイヤーも含む)',
      value: neverFired.length === 0 ? 'すべて発生' : `未発生: ${neverFired.join(', ')}`,
      target: '未発生なし',
      ok: neverFired.length === 0,
    },
  ];

  const groupMedian = (key: 'job' | 'education') => {
    const groups: Record<string, number[]> = {};
    for (const l of lives) (groups[l[key]] ??= []).push(l.result.finalNetWorth);
    return Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, median(v)]));
  };
  const causes: Record<string, number> = {};
  for (const l of lives) causes[l.result.cause] = (causes[l.result.cause] ?? 0) + 1 / lives.length;

  return {
    checks,
    detail: {
      lives: opts.n,
      seconds: elapsed,
      avgHappiness: mean(lives.map((l) => l.result.lifetimeHappiness)),
      bankruptShare: share(lives, (l) => l.bankrupt),
      randomBankruptShare: share(random, (l) => l.bankrupt),
      causes,
      types: typeRows,
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
  console.log(`\n=== バランス確認(タイプ別 ${detail.lives}人生 + でたらめ ${detail.lives}人生、${detail.seconds.toFixed(1)}秒)===\n`);
  for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name}: ${c.value}  [目安 ${c.target}]`);
  console.log('\nタイプ別:');
  for (const t of detail.types) {
    console.log(
      `  ${t.label.padEnd(5)} 寿命 ${t.lifespan.toFixed(1)}歳 / 資産中央値 ${man(t.medianNetWorth)} / 破産 ${pct(t.bankrupt)} / 結婚 ${pct(t.married)} / 勝ち組 ${pct(t.happy)} / ` +
        LIFE_TYPES.map((k) => `${k} ${pct(t.lifeTypes[k]!)}`).join(' '),
    );
  }
  console.log(`\n生涯幸福スコアの平均: ${detail.avgHappiness.toFixed(1)} / 自己破産: ${pct(detail.bankruptShare)}(でたらめ ${pct(detail.randomBankruptShare)})`);
  console.log(`死因: ${Object.entries(detail.causes).map(([k, v]) => `${k} ${pct(v)}`).join(' / ')}`);
  console.log(`職業別の最終資産中央値: ${Object.entries(detail.medianByJob).map(([k, v]) => `${k} ${man(v)}`).join(' / ')}`);
  console.log(`学歴別の最終資産中央値: ${Object.entries(detail.medianByEducation).map(([k, v]) => `${k} ${man(v)}`).join(' / ')}`);
  console.log('\nイベント別の発生回数(両方のプレイヤー):');
  console.log(
    Object.entries(detail.eventCounts)
      .map(([id, c]) => `  ${id.padEnd(18)} ${String(c).padStart(6)}`)
      .join('\n'),
  );
  if (!checks.every((c) => c.ok)) process.exitCode = 1;
}

if (process.argv[1]?.endsWith('balance.ts')) main();
