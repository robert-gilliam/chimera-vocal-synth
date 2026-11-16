/**
 * A tape's show file (`public/shows/<id>/show.json`): what `tools/tape/tape.ts` writes and the
 * tape page (`?tape=<id>`) plays. Types only, so the build scripts and the page share them
 * without either loading the other's code.
 *
 * The mix and each voice's `.tele` share sample 0 with the timeline: time t in any list below is
 * t seconds into the mix.
 */

/** something written at a head's mouth while it sounds (a sung syllable, a beat sound's name) */
export interface TapeWord {
  t0: number;
  t1: number;
  text: string;
}

/** a spoken line, for a caption */
export interface TapeSub {
  t0: number;
  t1: number;
  /** the voice's id */
  voice: string;
  text: string;
}

/** a named stretch of the tape, from `t0` to the next phase: the layout draws by it */
export interface TapePhase {
  name: string;
  t0: number;
  /** the voice the phase is about, when it is about one */
  who?: string;
}

export interface TapeVoice {
  id: string;
  /** shown on screen */
  name: string;
  /** its telemetry track's file name (one `.tele` for the whole timeline) */
  tele: string;
}

/** `X`: whatever else one tape's script tells its own layout (times, credits) */
export interface TapeShow<X = Record<string, unknown>> {
  title: string;
  /** the mix's file name */
  audio: string;
  /** seconds; the mix and every telemetry track are this long */
  duration: number;
  /** tempo and a bar's first beat (s), when the tape has a beat */
  bpm?: number;
  downbeat?: number;
  voices: TapeVoice[];
  phases: TapePhase[];
  /** by voice id */
  words: Record<string, TapeWord[]>;
  subs: TapeSub[];
  extra: X;
}

/** the phase at time t (the last one started), or undefined before the first */
export function phaseAt(phases: TapePhase[], t: number): TapePhase | undefined {
  let ph: TapePhase | undefined;
  for (const p of phases) if (p.t0 <= t) ph = p;
  return ph;
}

/** the word sounding at t, keyed by its index (the same text may repeat) */
export function tapeWordAt(words: TapeWord[] | undefined, t: number): { key: number; text: string } | null {
  if (!words) return null;
  for (let i = words.length - 1; i >= 0; i--) if (words[i].t0 <= t) return t < words[i].t1 ? { key: i, text: words[i].text } : null;
  return null;
}
