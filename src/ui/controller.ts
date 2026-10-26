// ゲームループ(DESIGN.md §9.2)。engine の stepMonth を一定間隔で呼び、止まる条件で UI に知らせる
import {
  changePolicy,
  createRng,
  buyAsset,
  sellAsset,
  type InvestKey,
  isYearEnd,
  resolveChoice,
  stepMonth,
  type GameState,
  type Policy,
} from '../engine/index';

export type Speed = 1 | 4 | 16;
const MS_PER_MONTH_1X = 1000;
/** 「次のイベントまで」で一度に進める上限(無限ループ防止。約100年) */
const SKIP_LIMIT_MONTHS = 1200;

export interface ControllerUI {
  /** 毎月の表示更新。chartChanged は資産推移グラフを描き直すべきとき */
  render(state: GameState, chartChanged: boolean): void;
  /** 選択肢イベント。選んだ選択肢の index を返す */
  chooseEvent(state: GameState): Promise<number>;
  /** 選択の結果を見せる */
  showChoiceResult(state: GameState): Promise<void>;
  /** 年間サマリー */
  yearSummary(state: GameState): Promise<void>;
  /** 年の切れ目(年間サマリーを出したあと。スキップ中はサマリーなしで呼ぶ)。セーブ用 */
  onYearEnd(state: GameState): void;
  onPlayingChange(playing: boolean): void;
  onDeath(state: GameState): void;
  /** log[since] 以降に、止まるべき出来事(大事な出来事)があるか。再生とスキップを止める */
  shouldStop?(state: GameState, since: number): boolean;
}

export class GameController {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busy = false; // モーダルを出している間
  private _playing = false;
  private _speed: Speed = 1;

  constructor(
    public state: GameState,
    private ui: ControllerUI,
  ) {}

  get playing(): boolean {
    return this._playing;
  }

  get speed(): Speed {
    return this._speed;
  }

  play(): void {
    if (this.state.dead) return;
    this.setPlaying(true);
    this.schedule();
  }

  pause(): void {
    this.setPlaying(false);
    this.clearTimer();
  }

  toggle(): void {
    if (this._playing) this.pause();
    else this.play();
  }

  setSpeed(speed: Speed): void {
    this._speed = speed;
    if (this._playing) {
      this.clearTimer();
      this.schedule();
    }
  }

  /** 選択肢つきイベントか死亡まで、待ち時間なしで進める。途中の年間サマリーはログにだけ残す */
  async skipToEvent(): Promise<void> {
    if (this.busy || this.state.dead) return;
    const wasPlaying = this._playing;
    this.clearTimer();
    this.busy = true;
    let stopped = false;
    for (let i = 0; i < SKIP_LIMIT_MONTHS; i++) {
      const since = this.state.log.length;
      this.state = stepMonth(this.state, createRng(this.state.rngState));
      if (isYearEnd(this.state)) this.ui.onYearEnd(this.state);
      if (this.state.dead || this.state.pendingEvent) break;
      if (this.ui.shouldStop?.(this.state, since)) {
        stopped = true;
        break;
      }
    }
    this.busy = false;
    await this.afterStep({ showYearSummary: false });
    if (stopped) this.pause();
    else if (wasPlaying && !this.state.dead) this.play();
  }

  /** 方針変更。次の月から反映される */
  changePolicy(policy: Policy): void {
    this.state = changePolicy(this.state, policy);
    this.ui.render(this.state, false);
  }

  /** 投資を売って預金にする。売ったあとの state を返す */
  sell(key: InvestKey, amount: number, from: 'auto' | 'taxable' | 'nisa' = 'auto'): GameState {
    this.state = sellAsset(this.state, key, amount, from);
    this.ui.render(this.state, false);
    return this.state;
  }

  /** 預金で投資を買う。買ったあとの state を返す */
  buy(key: InvestKey, amount: number): GameState {
    this.state = buyAsset(this.state, key, amount);
    this.ui.render(this.state, false);
    return this.state;
  }

  /** モーダルなど、ループの外で操作している間は止めておく */
  async whilePaused(fn: () => Promise<void>): Promise<void> {
    const wasPlaying = this._playing;
    this.pause();
    this.busy = true;
    try {
      await fn();
    } finally {
      this.busy = false;
      if (wasPlaying) this.play();
    }
  }

  dispose(): void {
    this.clearTimer();
    this._playing = false;
  }

  private setPlaying(playing: boolean): void {
    if (this._playing === playing) return;
    this._playing = playing;
    this.ui.onPlayingChange(playing);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    if (!this._playing || this.busy || this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick();
    }, MS_PER_MONTH_1X / this._speed);
  }

  private async tick(): Promise<void> {
    if (!this._playing || this.busy) return;
    const since = this.state.log.length;
    this.state = stepMonth(this.state, createRng(this.state.rngState));
    await this.afterStep({ showYearSummary: true });
    if (this.ui.shouldStop?.(this.state, since)) this.pause();
    this.schedule();
  }

  private async afterStep(opts: { showYearSummary: boolean }): Promise<void> {
    const yearEnd = isYearEnd(this.state);
    this.ui.render(this.state, yearEnd || !opts.showYearSummary);
    if (this.state.dead) {
      this.setPlaying(false);
      this.ui.onDeath(this.state);
      return;
    }
    this.busy = true;
    try {
      if (this.state.pendingEvent) {
        const index = await this.ui.chooseEvent(this.state);
        this.state = resolveChoice(this.state, index, createRng(this.state.rngState));
        this.ui.render(this.state, false);
        await this.ui.showChoiceResult(this.state);
      }
      if (yearEnd && opts.showYearSummary) {
        await this.ui.yearSummary(this.state);
        this.ui.onYearEnd(this.state);
      }
    } finally {
      this.busy = false;
    }
  }
}
