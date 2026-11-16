/**
 * A tape's mix: mono renders placed on a stereo timeline, each at its voice's pan and its own
 * gain, then a soft limiter and a fixed peak. Pure arrays in, arrays out; `tools/lib/wav.ts`
 * writes the file.
 */

/** one render on the timeline */
export interface MixSeg {
  /** where the render's sample 0 sits on the timeline (s); may be before 0 */
  at: number;
  wav: Float32Array;
  /** applied to every sample */
  gain: number;
  /** −1 left … 1 right */
  pan: number;
}

/** equal-power pan gains, unity in the centre: pan −1 is all left, 0 both at 1, 1 all right */
export function panGains(pan: number): [number, number] {
  const a = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  return [Math.cos(a) * Math.SQRT2, Math.sin(a) * Math.SQRT2];
}

/** the largest |sample| */
export function peakOf(x: ArrayLike<number>): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > p) p = a;
  }
  return p;
}

export interface MixOpts {
  /** drive into the tanh limiter (1.1: sums of two voices bend, a single voice barely does) */
  drive?: number;
  /** the mix's peak after the limiter (0.89 = −1 dBFS) */
  ceiling?: number;
}

/**
 * Sum the segments into `seconds` of stereo at `fs`. Samples before 0 or past the end are
 * dropped. The sum goes through tanh (a soft ceiling: loud moments round off, they don't clip),
 * then the whole mix is scaled so its peak is `ceiling`. A silent mix stays silent.
 */
export function mixdown(segs: MixSeg[], seconds: number, fs: number, o: MixOpts = {}): [Float32Array, Float32Array] {
  const n = Math.round(seconds * fs);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (const s of segs) {
    const [gl, gr] = panGains(s.pan);
    const o0 = Math.round(s.at * fs);
    const from = Math.max(0, -o0), to = Math.min(s.wav.length, n - o0);
    for (let i = from; i < to; i++) {
      const v = s.wav[i] * s.gain;
      L[o0 + i] += v * gl;
      R[o0 + i] += v * gr;
    }
  }
  const drive = o.drive ?? 1.1;
  for (let i = 0; i < n; i++) {
    L[i] = Math.tanh(L[i] * drive);
    R[i] = Math.tanh(R[i] * drive);
  }
  const pk = Math.max(peakOf(L), peakOf(R));
  if (pk > 0) {
    const k = (o.ceiling ?? 0.89) / pk;
    for (let i = 0; i < n; i++) {
      L[i] *= k;
      R[i] *= k;
    }
  }
  return [L, R];
}
