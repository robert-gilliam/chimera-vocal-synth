/**
 * Stitching one voice's renders onto a tape's timeline (tools/tape/tele.ts). The first version
 * showed whichever render had started most recently, so a render starting under another's last
 * word hid it, and nothing said so. Now a render keeps the head until it has stopped sounding,
 * and two renders sounding at once on one voice are refused.
 */
import { describe, expect, test } from "bun:test";
import { handovers, parseTele, soundingSpan, stitch, type TeleSeg } from "../tools/tape/tele.ts";
import { TeleTrack } from "../src/show/tele.ts";

const [nArtic, nPh, nOr, nScope] = [17, 3, 2, 32];
const LEN = 11 + nArtic + 3 * (nPh + nOr) + 2 * nScope;
const [FS, HOP] = [48000, 768];
const frameAt = (t: number) => Math.round((t * FS) / HOP);
/** a render's last frame (a last partial hop gets none) */
const lastFrame = (seconds: number) => Math.floor((seconds * FS) / HOP);
/** times here are right to a hop (16 ms) */
const near = (got: number, want: number) => expect(Math.abs(got - want)).toBeLessThan(HOP / FS + 1e-9);

/**
 * A render `seconds` long that sounds from `on` to `off` (s): f0 is `tag` + the frame's index, so
 * a stitched frame says which render and which of its frames it came from.
 */
function render(tag: number, seconds: number, on: number, off: number, o: { nPh?: number } = {}): Uint8Array {
  const ph = o.nPh ?? nPh;
  const len = 11 + nArtic + 3 * (ph + nOr) + 2 * nScope;
  const frames = Math.floor((seconds * FS) / HOP) + 1;
  const buf = new ArrayBuffer(48 + 4 * frames * len);
  const d = new DataView(buf);
  new Uint8Array(buf).set(new TextEncoder().encode("CHTL"));
  [1, FS, HOP, frames, len, nArtic, ph, nOr, nScope].forEach((x, i) => d.setUint32(4 + 4 * i, x, true));
  const f = new Float32Array(buf, 48);
  for (let i = 0; i < frames; i++) {
    const t = (i * HOP) / FS;
    f[i * len + 3] = tag + i;
    // a frame's level covers the hop before it
    f[i * len + 6] = t > on && t <= off + 1e-9 ? 0.1 : 1e-5;
    f[i * len + 10] = t;
  }
  return new Uint8Array(buf);
}
const seg = (label: string, at: number, bytes: Uint8Array): TeleSeg => ({ label, at, tele: parseTele(bytes, label) });
/** which render (its tag) and which of its frames the stitched track shows at time t */
function shown(track: TeleTrack, t: number): [number, number] {
  const f0 = track.message(track.indexAt(t)).t.f0;
  return [Math.floor(f0 / 1000) * 1000, f0 % 1000];
}

describe("telemetry stitching", () => {
  test("a render's sounding span comes from its output level", () => {
    const [on, off] = soundingSpan(parseTele(render(0, 1.5, 0.208, 0.992)))!;
    expect(on).toBeCloseTo(0.208, 2);
    expect(off).toBeCloseTo(0.992, 2);
    expect(soundingSpan(parseTele(render(0, 0.5, 9, 9)))).not.toBeNull(); // quiet throughout: all of it is its loudest
    const silent = parseTele(render(0, 0.5, 9, 9));
    for (let i = 0; i < silent.frames; i++) silent.data[i * silent.len + 6] = 0;
    expect(soundingSpan(silent)).toBeNull();
  });

  test("renders in turn: each is shown from its start, the last frame held in a gap", () => {
    // A is 1 s long from 0.5; B is 1 s long from 2.0; the tape is 4 s
    const a = seg("A", 0.5, render(1000, 1, 0.2, 0.7)), b = seg("B", 2, render(2000, 1, 0.2, 0.7));
    const track = new TeleTrack(stitch([b, a], 4).buffer as ArrayBuffer);
    expect(track.frames).toBe(1 + Math.floor((4 * FS) / HOP));
    expect(track.duration).toBeCloseTo(4, 1);
    expect(shown(track, 0.1)).toEqual([1000, 0]); // before anything: A's first frame, at rest
    expect(shown(track, 1.0)[0]).toBe(1000);
    expect(Math.abs(shown(track, 1.0)[1] - frameAt(0.5))).toBeLessThanOrEqual(1);
    expect(shown(track, 1.8)).toEqual([1000, lastFrame(1)]); // A is over: its last frame
    expect(shown(track, 2.5)[0]).toBe(2000);
    expect(Math.abs(shown(track, 2.5)[1] - frameAt(0.5))).toBeLessThanOrEqual(1);
    expect(shown(track, 3.9)).toEqual([2000, lastFrame(1)]);
    // every frame's clock is the tape's time, not its render's
    for (const t of [0, 1, 2.5, 3.9]) expect(track.message(track.indexAt(t)).t.clock).toBeCloseTo(t, 1);
  });

  test("a render starting under another's quiet tail takes over at once", () => {
    // A sounds until 1.0 and its render runs on to 1.5; B's render starts at 1.2
    const a = seg("A", 0, render(1000, 1.5, 0.2, 1.0)), b = seg("B", 1.2, render(2000, 1, 0.2, 0.7));
    const order = handovers([a, b]);
    expect(order.map((h) => h.seg.label)).toEqual(["A", "B"]);
    expect(order[1].from).toBeCloseTo(1.2, 6);
    const track = new TeleTrack(stitch([a, b], 3).buffer as ArrayBuffer);
    expect(shown(track, 1.1)[0]).toBe(1000);
    expect(shown(track, 1.25)[0]).toBe(2000);
    expect(Math.abs(shown(track, 1.25)[1] - frameAt(0.05))).toBeLessThanOrEqual(1);
  });

  test("a render starting while another still sounds waits for it to finish (it used to hide its end)", () => {
    // A sounds until 1.0; B's render starts at 0.8 but B makes no sound until 1.1
    const a = seg("A", 0, render(1000, 1.5, 0.2, 1.0)), b = seg("B", 0.8, render(2000, 1, 0.3, 0.7));
    const order = handovers([a, b]);
    near(order[1].from, 1.0);
    const track = new TeleTrack(stitch([a, b], 3).buffer as ArrayBuffer);
    // A's last sounding frames are A's; then B, already 0.2 s into its render
    expect(shown(track, 0.9)[0]).toBe(1000);
    expect(Math.abs(shown(track, 0.9)[1] - frameAt(0.9))).toBeLessThanOrEqual(1);
    expect(shown(track, 0.97)[0]).toBe(1000);
    expect(shown(track, 1.05)[0]).toBe(2000);
    expect(Math.abs(shown(track, 1.05)[1] - frameAt(0.25))).toBeLessThanOrEqual(1);
  });

  test("two renders sounding at once on one voice are refused, by name and time", () => {
    // a long render (a groove) and a short one in the middle of it: each used to hide the other
    const groove = seg("drum 1: B . t .", 0, render(1000, 4, 0.2, 3.8)), line = seg("say 2: Hello.", 1.5, render(2000, 1, 0.1, 0.6));
    expect(() => stitch([groove, line], 5)).toThrow(/two renders sound at once.*"drum 1: B \. t \." sounds until 3\.(79|80) s and "say 2: Hello\." from 1\.(59|60) s/);
    // whichever order they are given in
    expect(() => stitch([line, groove], 5)).toThrow(/two renders sound at once/);
    // and a later render is checked against every earlier one, not only the one before it
    const blip = seg("blip", 1.0, render(3000, 0.3, 0.05, 0.1));
    const late = seg("late", 2.0, render(4000, 0.5, 0.1, 0.3));
    expect(() => handovers([seg("long", 0, render(1000, 4, 0.2, 0.9)), blip, late])).not.toThrow();
    expect(() => handovers([seg("long", 0, render(1000, 4, 0.2, 2.5)), late])).toThrow(/"long" sounds until 2\.(49|50) s and "late" from 2\.(09|10) s/);
  });

  test("renders of different airways are not one voice", () => {
    const a = seg("A", 0, render(1000, 1, 0.2, 0.7)), other = seg("B (child)", 2, render(2000, 1, 0.2, 0.7, { nPh: 4 }));
    expect(() => stitch([a, other], 4)).toThrow(/B \(child\): not a recording of the same voice as A/);
    expect(() => stitch([], 4)).toThrow(/no renders/);
    expect(() => parseTele(render(0, 1, 0, 0).subarray(0, 100), "cut.tele")).toThrow(/cut\.tele: 100 bytes/);
    expect(() => parseTele(new Uint8Array(64), "x.tele")).toThrow(/not a CHIMERA telemetry file/);
  });
});
