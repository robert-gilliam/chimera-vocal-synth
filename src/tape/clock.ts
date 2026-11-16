/**
 * A tape's clock: seconds into the mix. Held at a time (`?tape=<id>&t=12.5`: a still, no sound,
 * for checking a layout), or the audio context's time since the mix started.
 */

/** the time to hold from the page's query string: `t=<seconds>`, or null to play */
export function heldTime(search: string): number | null {
  const t = new URLSearchParams(search).get("t");
  if (t === null || t.trim() === "") return null;
  const x = Number(t);
  return Number.isFinite(x) && x >= 0 ? x : null;
}

export class TapeClock {
  private ctx: { readonly currentTime: number } | null = null;
  private startedAt = 0;
  constructor(readonly held: number | null) {}

  /** the mix starts at `at` on the context's clock */
  start(ctx: { readonly currentTime: number }, at: number): void {
    this.ctx = ctx;
    this.startedAt = at;
  }

  get running(): boolean {
    return this.held === null && this.ctx !== null;
  }

  time(): number {
    if (this.held !== null) return this.held;
    return this.ctx ? Math.max(0, this.ctx.currentTime - this.startedAt) : 0;
  }
}
