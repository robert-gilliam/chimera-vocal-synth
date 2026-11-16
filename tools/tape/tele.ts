/**
 * Telemetry files on the build side (`chimera render … --tele`; the layout is in
 * crates/chimera-cli/src/render.rs `TeleRecorder`, the page's reader in src/show/tele.ts), and
 * stitching one voice's renders onto a single track for the whole tape.
 *
 * One voice is one throat, so one render at a time is shown. Each render is shown from its start
 * until the next takes over. Renders may overlap where the earlier one has gone quiet (a spoken
 * line's 0.3 s tail under the next line's first frames): the track hands over once the earlier
 * one has stopped sounding. Two renders sounding at once on one voice is an error: the mix would
 * play both and the head could only show one.
 */

const HEADER_BYTES = 48;
/** a frame's scalars before its arrays; outRms is the 7th, the clock the 11th */
const OUT_RMS = 6, CLOCK = 10;

export interface Tele {
  /** the 48 header bytes as read (version, rates, the airway's sizes, the body mix) */
  header: Uint8Array;
  sampleRate: number;
  hop: number;
  frames: number;
  /** f32s per frame */
  len: number;
  data: Float32Array;
}

export function parseTele(bytes: Uint8Array, name = "telemetry"): Tele {
  if (bytes.byteLength < HEADER_BYTES || new TextDecoder().decode(bytes.subarray(0, 4)) !== "CHTL") throw new Error(`${name}: not a CHIMERA telemetry file`);
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u = (i: number) => d.getUint32(4 + 4 * i, true);
  const [sampleRate, hop, frames, len] = [u(1), u(2), u(3), u(4)];
  if (frames < 1 || hop < 1 || sampleRate < 1 || len <= CLOCK) throw new Error(`${name}: telemetry header is inconsistent`);
  if (bytes.byteLength !== HEADER_BYTES + 4 * frames * len) throw new Error(`${name}: ${bytes.byteLength} bytes; its header says ${HEADER_BYTES + 4 * frames * len}`);
  // a copy: the file's f32s need not be aligned in the buffer they were read into
  const data = new Float32Array(bytes.slice(HEADER_BYTES).buffer);
  return { header: bytes.slice(0, HEADER_BYTES), sampleRate, hop, frames, len, data };
}

/**
 * When a render sounds, as [start, end] seconds on its own clock: the hops whose output level is
 * above `floor` × the render's loudest hop (a frame's level covers the hop before it). Null for a
 * render that never sounds.
 */
export function soundingSpan(t: Tele, floor = 0.02): [number, number] | null {
  let max = 0;
  for (let i = 0; i < t.frames; i++) max = Math.max(max, t.data[i * t.len + OUT_RMS]);
  if (!(max > 0)) return null;
  let first = -1, last = -1;
  for (let i = 0; i < t.frames; i++) {
    if (t.data[i * t.len + OUT_RMS] > floor * max) {
      if (first < 0) first = i;
      last = i;
    }
  }
  return [(Math.max(0, first - 1) * t.hop) / t.sampleRate, (last * t.hop) / t.sampleRate];
}

/** one render of a voice on the tape's timeline */
export interface TeleSeg {
  /** where the render's sample 0 sits on the timeline (s) */
  at: number;
  tele: Tele;
  /** names the render in an error ("say 3: Good morning.") */
  label: string;
}

/** when each segment takes over the track, in the order they start */
export interface Handover {
  seg: TeleSeg;
  /** shown from here until the next handover (the first: from the start of the tape) */
  from: number;
}

const same = (a: Uint8Array, b: Uint8Array, from: number, to: number) => {
  for (let i = from; i < to; i++) if (a[i] !== b[i]) return false;
  return true;
};

/**
 * The order of play for one voice's renders. Throws when two of them sound at once, or when they
 * are not recordings of the same airway (another body, rate or file version).
 */
export function handovers(segs: TeleSeg[]): Handover[] {
  const sorted = [...segs].sort((a, b) => a.at - b.at);
  const out: Handover[] = [];
  // the latest moment any earlier render still sounds, and which render that is
  let quietAt = -Infinity, loudest: TeleSeg | null = null;
  for (const s of sorted) {
    const h0 = sorted[0].tele.header, h = s.tele.header;
    // all of the header but the frame count (bytes 16–19)
    if (!same(h0, h, 0, 16) || !same(h0, h, 20, HEADER_BYTES)) throw new Error(`${s.label}: not a recording of the same voice as ${sorted[0].label} (another body, rate or version)`);
    const span = soundingSpan(s.tele);
    if (span && loudest && s.at + span[0] < quietAt)
      throw new Error(
        `two renders sound at once on one voice: "${loudest.label}" sounds until ${quietAt.toFixed(2)} s and "${s.label}" from ${(s.at + span[0]).toFixed(2)} s. ` +
          `One head can show only one of them: move one, or give it to another voice.`,
      );
    out.push({ seg: s, from: out.length ? Math.max(s.at, quietAt) : -Infinity });
    if (span && s.at + span[1] > quietAt) {
      quietAt = s.at + span[1];
      loudest = s;
    }
  }
  return out;
}

/**
 * One telemetry file for the whole tape from one voice's renders: `seconds` long at the renders'
 * frame rate, frame i the state at sample i·hop of the timeline (as the CLI writes one: 1 +
 * samples / hop frames). Before the first render its first frame is held (the voice at rest);
 * after a render ends its last frame is held until the next takes over. Each frame's clock is
 * the timeline's.
 */
export function stitch(segs: TeleSeg[], seconds: number): Uint8Array {
  if (!segs.length) throw new Error("a voice with no renders has no telemetry to show");
  const order = handovers(segs);
  const { sampleRate, hop, len, header } = order[0].seg.tele;
  const frames = Math.floor(Math.round(seconds * sampleRate) / hop) + 1;
  const data = new Float32Array(frames * len);
  let k = 0;
  for (let i = 0; i < frames; i++) {
    const t = (i * hop) / sampleRate;
    while (k + 1 < order.length && order[k + 1].from <= t) k++;
    const s = order[k].seg;
    const li = Math.min(s.tele.frames - 1, Math.max(0, Math.round(((t - s.at) * sampleRate) / hop)));
    data.set(s.tele.data.subarray(li * len, (li + 1) * len), i * len);
    data[i * len + CLOCK] = t;
  }
  const out = new Uint8Array(HEADER_BYTES + 4 * data.length);
  out.set(header);
  new DataView(out.buffer).setUint32(16, frames, true);
  out.set(new Uint8Array(data.buffer), HEADER_BYTES);
  return out;
}
