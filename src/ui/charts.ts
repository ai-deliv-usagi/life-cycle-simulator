// グラフ(Chart.js)。16倍速でも重くならないようアニメーションは切る
import {
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
import { manYen } from './format';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Legend, Tooltip);

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
