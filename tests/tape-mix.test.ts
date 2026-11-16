/**
 * The tape toolkit's mix and beat notation (tools/tape): renders land on the timeline at their
 * pan and gain, the limiter keeps the sum under the ceiling, and a bar of notation becomes the
 * hits `chimera render hits` takes.
 */
import { describe, expect, test } from "bun:test";
import { mixdown, panGains, peakOf } from "../tools/tape/mix.ts";
import { barHits, hitRows } from "../tools/tape/beat.ts";

describe("mixdown", () => {
  test("pan is equal-power and unity in the centre", () => {
    expect(panGains(0)[0]).toBeCloseTo(1, 12);
    expect(panGains(0)[1]).toBeCloseTo(1, 12);
    expect(panGains(-1)[1]).toBeCloseTo(0, 12);
    expect(panGains(1)[0]).toBeCloseTo(0, 12);
    for (const p of [-0.7, -0.35, 0.2, 0.9]) {
      const [l, r] = panGains(p);
      expect(l * l + r * r).toBeCloseTo(2, 12);
      expect(l > r).toBe(p < 0);
    }
  });

  test("a render lands at its time, and what falls off either end is dropped", () => {
    const fs = 1000;
    const ramp = Float32Array.from({ length: 100 }, (_, i) => (i + 1) / 1000);
    // one starting 30 ms before the timeline, one running 40 ms past its end
    const [L, R] = mixdown(
      [
        { at: -0.03, wav: ramp, gain: 1, pan: -1 },
        { at: 0.44, wav: ramp, gain: 1, pan: 1 },
      ],
      0.5,
      fs,
      { drive: 1e-6, ceiling: 1 },
    );
    expect(L.length).toBe(500);
    // left: samples 30..99 of the ramp at 0..69, then silence; right: the ramp from 440
    expect(L[0] / L[69]).toBeCloseTo(31 / 100, 4);
    // (a hard pan leaves cos(π/2) of the other side: 1e-17, not 0)
    expect(peakOf(L.subarray(70))).toBeLessThan(1e-12);
    expect(peakOf(R.subarray(0, 440))).toBeLessThan(1e-12);
    expect(R[440] / R[499]).toBeCloseTo(1 / 60, 4);
  });

  test("the limiter rounds a loud sum off and the mix peaks at the ceiling", () => {
    const fs = 1000;
    const loud = new Float32Array(200).fill(0.9), quiet = new Float32Array(100).fill(0.1);
    const segs = [
      { at: 0, wav: loud, gain: 1, pan: 0 },
      { at: 0.1, wav: loud, gain: 1, pan: 0 }, // 1.8 where the two overlap
      { at: 0.4, wav: quiet, gain: 1, pan: 0 },
    ];
    const [L, R] = mixdown(segs, 0.5, fs);
    expect(Math.max(peakOf(L), peakOf(R))).toBeCloseTo(0.89, 6);
    expect(L[150]).toBeCloseTo(0.89, 6);
    // 1.8 against 0.9 is twice the level in, far less out; the quiet part keeps its proportion
    expect(L[150] / L[50]).toBeCloseTo(Math.tanh(1.98) / Math.tanh(0.99), 5);
    expect(L[450] / L[50]).toBeCloseTo(Math.tanh(0.11) / Math.tanh(0.99), 5);
    // gain is per render
    const [G] = mixdown([{ at: 0, wav: quiet, gain: 3, pan: 0 }, { at: 0.2, wav: quiet, gain: 1, pan: 0 }], 0.5, fs, { drive: 1e-6 });
    expect(G[50] / G[250]).toBeCloseTo(3, 4);
    // nothing to mix: silence, not NaN from 0 / 0
    expect(peakOf(mixdown([], 0.1, fs)[0])).toBe(0);
  });
});

describe("barHits", () => {
  const step = 0.15;
  test("reads the app's beat notation: rests, bar lines, a hum's note, an accent", () => {
    const hits = barHits(10, "B m:43 . t | Pf> - . .", step);
    expect(hits.map((h) => h.id)).toEqual(["B", "m", "t", "Pf"]);
    expect(hits.map((h) => +(h.t - 10).toFixed(6))).toEqual([0, 0.15, 0.45, 0.6]);
    // a sound lasts until the next one; the last, to the end of the text ("-" is a rest too)
    expect(hits.map((h) => +(h.len! / step).toFixed(6))).toEqual([1, 2, 1, 4]);
    expect(hits[1].note).toBe(43);
    expect(hits[0].note).toBeUndefined();
    expect(hits[3].accent).toBe(1.3);
    expect(hits[0].accent).toBeUndefined();
  });

  test("ids with punctuation of their own stay whole", () => {
    expect(barHits(0, "^K P! ! kch>", step).map((h) => [h.id, h.accent ?? 1])).toEqual([["^K", 1], ["P!", 1], ["!", 1], ["kch", 1.3]]);
    expect(barHits(0, " . | . ", step)).toEqual([]);
  });

  test("rows for `render hits` count from the render's start", () => {
    const rows = hitRows([{ t: 5.5, id: "B" }, { t: 6, id: "m", len: 0.3, note: 36, accent: 1.3 }], 5, 0.15);
    expect(rows).toEqual([[0.5, "B", 0.15, null, null], [1, "m", 0.3, 36, 1.3]]);
  });
});
