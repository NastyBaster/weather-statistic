export type Clock = {
  now: () => number;
  setTimer: (
    callback: () => void,
    milliseconds: number,
  ) => ReturnType<typeof setTimeout>;
  clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
};

export const systemClock: Clock = {
  now: () => performance.now(),
  setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimer: (timer) => clearTimeout(timer),
};

export class Deadline {
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly expiresAt: number;
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(
    private readonly clock: Clock,
    milliseconds: number,
  ) {
    this.signal = this.controller.signal;
    this.expiresAt = clock.now() + milliseconds;
    this.timer = clock.setTimer(() => this.controller.abort(), milliseconds);
  }

  remaining(): number {
    return Math.max(0, this.expiresAt - this.clock.now());
  }

  expired(): boolean {
    return this.signal.aborted || this.remaining() === 0;
  }

  close(): void {
    this.clock.clearTimer(this.timer);
  }
}
