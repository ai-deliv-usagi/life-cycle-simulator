// グラフ(Chart.js)。16倍速でも重くならないようアニメーションは切る
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import type { LogEntry } from '../engine/index';
import { manYen } from './format';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  BarController,
  BarElement,
  LinearScale,
  CategoryScale,
  Filler,
  Legend,
  Tooltip,
);

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const yenTick = (v: string | number) => manYen(Number(v));

export interface NetWorthPoint {
  age: number;
  netWorth: number;
}

/** メイン画面の資産推移(年次の純資産) */
export class NetWorthChart {
  private chart: Chart<'line'>;

  constructor(canvas: HTMLCanvasElement) {
    this.chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: '純資産',
            data: [],
            borderColor: cssVar('--accent'),
            backgroundColor: cssVar('--accent-soft'),
            fill: 'origin',
            pointRadius: 0,
            borderWidth: 2,
            tension: 0.2,
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => manYen(Number(c.raw)) } } },
        scales: {
          x: { title: { display: true, text: '年齢' }, ticks: { maxTicksLimit: 8, color: cssVar('--muted') }, grid: { display: false } },
          y: { ticks: { callback: yenTick, maxTicksLimit: 5, color: cssVar('--muted') }, grid: { color: cssVar('--grid') } },
        },
      },
    });
  }

  update(points: NetWorthPoint[]): void {
    this.chart.data.labels = points.map((p) => Math.floor(p.age));
    this.chart.data.datasets[0]!.data = points.map((p) => p.netWorth);
    this.chart.update('none');
  }

  destroy(): void {
    this.chart.destroy();
  }
}

/** リザルトの資産と幸福度の推移(2軸) */
export function resultChart(
  canvas: HTMLCanvasElement,
  yearly: { age: number; netWorth: number; happiness: number }[],
): Chart<'line'> {
  return new Chart(canvas, {
    type: 'line',
    data: {
      labels: yearly.map((y) => Math.floor(y.age)),
      datasets: [
        {
          label: '純資産',
          data: yearly.map((y) => y.netWorth),
          borderColor: cssVar('--accent'),
          backgroundColor: cssVar('--accent-soft'),
          fill: 'origin',
          pointRadius: 0,
          borderWidth: 2,
          yAxisID: 'y',
        },
        {
          label: '幸福度',
          data: yearly.map((y) => Math.round(y.happiness)),
          borderColor: cssVar('--happy'),
          pointRadius: 0,
          borderWidth: 2,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: cssVar('--text') } },
        tooltip: {
          callbacks: { label: (c) => (c.datasetIndex === 0 ? `純資産 ${manYen(Number(c.raw))}` : `幸福度 ${c.raw}`) },
        },
      },
      scales: {
        x: { title: { display: true, text: '年齢' }, ticks: { maxTicksLimit: 8, color: cssVar('--muted') }, grid: { display: false } },
        y: { position: 'left', ticks: { callback: yenTick, maxTicksLimit: 5, color: cssVar('--muted') }, grid: { color: cssVar('--grid') } },
        y1: { position: 'right', min: 0, max: 100, ticks: { color: cssVar('--muted') }, grid: { display: false } },
      },
    },
  });
}

export interface AssetMixPoint {
  age: number;
  assets: NonNullable<LogEntry['assets']>;
}

const ASSET_SERIES = [
  { key: 'cash', label: '預金', color: '--asset-cash' },
  { key: 'index', label: '積立', color: '--asset-index' },
  { key: 'stocks', label: '個別株', color: '--asset-stocks' },
  { key: 'speculative', label: '信用・仮想通貨', color: '--asset-speculative' },
] as const;

/** 年末の金融資産の内訳(積み上げ棒)。預金がマイナスの年は0として描く */
export function assetMixChart(canvas: HTMLCanvasElement, points: AssetMixPoint[]): Chart<'bar'> {
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: points.map((p) => Math.floor(p.age)),
      datasets: ASSET_SERIES.map((s) => ({
        label: s.label,
        data: points.map((p) => Math.max(0, p.assets[s.key])),
        backgroundColor: cssVar(s.color),
        borderWidth: 0,
        barPercentage: 0.9,
        categoryPercentage: 0.9,
      })),
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: cssVar('--text'), boxWidth: 12 } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label} ${manYen(Number(c.raw))}` } },
      },
      scales: {
        x: { stacked: true, title: { display: true, text: '年齢' }, ticks: { maxTicksLimit: 8, color: cssVar('--muted') }, grid: { display: false } },
        y: { stacked: true, ticks: { callback: yenTick, maxTicksLimit: 5, color: cssVar('--muted') }, grid: { color: cssVar('--grid') } },
      },
    },
  });
}

/** log の年間サマリーから、年末の内訳を取り出す(内訳のない古いセーブの年は飛ばす) */
export function assetMixPoints(log: readonly LogEntry[]): AssetMixPoint[] {
  return log.flatMap((e) => (e.type === 'year_summary' && e.assets ? [{ age: e.ageMonths / 12, assets: e.assets }] : []));
}
