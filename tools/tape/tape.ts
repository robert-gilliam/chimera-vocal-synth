/**
 * Builds a tape's show: spoken lines, sung phrases and beat sounds rendered by the `chimera` CLI
 * (sound and telemetry), placed on one timeline, mixed, and written with the cue sheet the tape
 * page draws from to public/shows/<id>/ (gitignored). A tape's own script (tapes/<id>/script.ts)
 * says what happens when:
 *
 *   const tape = new Tape({ id: "sample", bpm: 100, voices: [{ id: "lead", name: "ADA", body: "female" }] });
 *   let t = 0.5;
 *   t += tape.say("lead", t, "Good morning.") + 0.3;
 *   tape.sing("lead", t, "la la la", [[64, 1], [67, 1], [72, 2]]);
 *   tape.write({ title: "Sample", duration: 10, extra: {} });
 *
 * Needs the CLI built: cargo build --release -p chimera-cli
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readWav, writeWav } from "../lib/wav.ts";
import { barHits, hitRows, type Hit } from "./beat.ts";
import { mixdown, peakOf, type MixOpts } from "./mix.ts";
import { parseTele, soundingSpan, stitch, type Tele } from "./tele.ts";
import type { TapePhase, TapeShow, TapeSub, TapeWord } from "../../src/tape/show.ts";

export { barHits, type Hit };

/** the CLI's output rate */
export const FS = 48000;
/** `render text` starts speaking 50 ms in and adds 300 ms of tail (crates/chimera-cli render.rs `say`) */
const SAY_LEAD = 0.05, SAY_TAIL = 0.3;
/** where `render notes` puts the first note (its `t0`; written into every melody file) */
const SING_LEAD = 0.3;
/** room before a drum render's first hit and after its last (the slowest sound sets up in 174 ms) */
const DRUM_PAD = 0.6;

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

export type Body = "male" | "female" | "child";

export interface VoiceDef {
  id: string;
  /** shown on screen */
  name: string;
  body: Body;
  /** −1 left … 1 right (0) */
  pan?: number;
}

export interface TapeOpts {
  /** the show's folder name under public/shows/, and `?tape=<id>` */
  id: string;
  voices: VoiceDef[];
  /** tempo for `sing` and `bar` */
  bpm?: number;
  /** the `chimera` binary (target/release/chimera) */
  cli?: string;
  /** where the show is written (public/shows/<id>/) and where the renders are kept (out/tape/<id>/) */
  outDir?: string;
  workDir?: string;
}

/** [midi, beats]; midi 0 is a rest */
export type Note = [number, number];

interface Seg {
  voice: string;
  label: string;
  /** where the render's sample 0 sits on the timeline (s) */
  at: number;
  wav: Float32Array;
  tele: Tele;
  gain: number;
}

/** what a beat sound is called at the drummer's mouth */
export const HIT_NAMES: Record<string, string> = { B: "B", t: "T", tss: "TSS", Pf: "PF", K: "K", "^K": "!K", "!": "TOK", "P!": "POP", kch: "KSHH", m: "MMM" };

export class Tape {
  readonly id: string;
  readonly voices: VoiceDef[];
  readonly bpm: number;
  private readonly cliPath: string;
  private readonly work: string;
  private readonly out: string;
  private readonly segs: Seg[] = [];
  private readonly words: Record<string, TapeWord[]> = {};
  private readonly subs: TapeSub[] = [];
  private readonly phases: TapePhase[] = [];
  private n = 0;

  constructor(o: TapeOpts) {
    if (!/^[\w-]+$/.test(o.id)) throw new Error(`tape id ${JSON.stringify(o.id)}: letters, digits, - and _ only (it is a folder and a URL parameter)`);
    this.id = o.id;
    this.voices = o.voices;
    this.bpm = o.bpm ?? 100;
    this.cliPath = o.cli ?? ROOT + "target/release/chimera";
    if (!existsSync(this.cliPath)) throw new Error(`${this.cliPath} is missing: cargo build --release -p chimera-cli`);
    this.work = o.workDir ?? `${ROOT}out/tape/${o.id}/`;
    this.out = o.outDir ?? `${ROOT}public/shows/${o.id}/`;
    mkdirSync(this.work, { recursive: true });
    for (const v of o.voices) this.words[v.id] = [];
  }

  /** seconds per beat, per sixteenth and per 4/4 bar */
  get beat(): number {
    return 60 / this.bpm;
  }
  get step(): number {
    return this.beat / 4;
  }
  get barLen(): number {
    return 4 * this.beat;
  }

  private voice(id: string): VoiceDef {
    const v = this.voices.find((v) => v.id === id);
    if (!v) throw new Error(`no voice ${JSON.stringify(id)}; have ${this.voices.map((v) => v.id).join(", ")}`);
    return v;
  }

  private cli(args: string[]): string {
    const r = spawnSync(this.cliPath, [...args, "--float"], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`chimera ${args.join(" ")}\n${r.stderr || r.error?.message || ""}`);
    return r.stdout;
  }

  /** a render's WAV and telemetry onto the timeline, its peak brought to `level` */
  private add(voice: string, label: string, at: number, stem: string, level: number): Seg {
    const wav = readWav(stem + ".wav").channels[0];
    const pk = peakOf(wav);
    if (!Number.isFinite(pk) || pk === 0 || wav.some((x) => !Number.isFinite(x))) throw new Error(`${label}: a silent or broken render`);
    const s: Seg = { voice, label, at, wav, tele: parseTele(readFileSync(stem + ".tele"), stem + ".tele"), gain: level / pk };
    this.segs.push(s);
    return s;
  }

  /**
   * A spoken line (English; the CLI's `render text`) that starts sounding at `at`. Returns how
   * long the speech lasts (s), so `t += tape.say(…) + pause` places the next line. `shown` is the
   * caption when the text is spelled for the dictionary.
   */
  say(voice: string, at: number, text: string, o: { shown?: string; level?: number } = {}): number {
    const v = this.voice(voice);
    const stem = `${this.work}say${this.n++}`;
    this.cli(["render", "text", stem, text, v.body, "--tele", stem + ".tele"]);
    const s = this.add(voice, `say ${this.n - 1}: ${text}`, at - SAY_LEAD, stem, o.level ?? 0.62);
    const dur = s.wav.length / FS - SAY_LEAD - SAY_TAIL;
    this.subs.push({ t0: at, t1: at + dur + 0.2, voice, text: o.shown ?? text });
    return dur;
  }

  /**
   * A sung phrase whose first beat lands at `at`: one lyric syllable per sounding note. Each
   * note's syllable is written at the mouth while it sounds. Returns the phrase's length (s).
   */
  sing(voice: string, at: number, lyrics: string, notes: Note[], o: { level?: number; vibrato?: number; bpm?: number } = {}): number {
    const v = this.voice(voice);
    const bpm = o.bpm ?? this.bpm, beat = 60 / bpm;
    const stem = `${this.work}sing${this.n++}`;
    writeFileSync(stem + ".json", JSON.stringify({ bpm, t0: SING_LEAD, lyrics, notes, vibrato: o.vibrato ?? 35 }));
    this.cli(["render", "notes", stem + ".json", stem, v.body, "--tele", stem + ".tele"]);
    this.add(voice, `sing ${this.n - 1}: ${lyrics}`, at - SING_LEAD, stem, o.level ?? 0.5);
    const syl = JSON.parse(this.cli(["syllables", lyrics]).trim()) as { text: string; wordEnd?: boolean }[];
    let t = at, k = 0;
    for (const [midi, beats] of notes) {
      if (midi > 0) {
        const s = syl[k++];
        if (s) this.words[voice].push({ t0: t, t1: t + beats * beat, text: s.text + (s.wordEnd ? "" : "-") });
      }
      t += beats * beat;
    }
    return t - at;
  }

  /**
   * Beat sounds at their times on the timeline (the CLI's `render hits`), as one render: hits
   * that belong together (a groove) go in one call. Each sound's name is written at the mouth.
   */
  drum(voice: string, hits: Hit[], o: { level?: number; names?: Record<string, string> } = {}): void {
    if (!hits.length) return;
    const v = this.voice(voice);
    const sorted = [...hits].sort((a, b) => a.t - b.t);
    const last = sorted[sorted.length - 1];
    const t0 = Math.max(0, sorted[0].t - DRUM_PAD), end = last.t + (last.len ?? this.step) + DRUM_PAD;
    const stem = `${this.work}hits${this.n++}`;
    writeFileSync(stem + ".json", JSON.stringify({ end: end - t0, hits: hitRows(sorted, t0, this.step) }));
    this.cli(["render", "hits", stem + ".json", stem, v.body, "--tele", stem + ".tele"]);
    this.add(voice, `drum ${this.n - 1}: ${sorted.length} hits from ${sorted[0].t.toFixed(2)} s`, t0, stem, o.level ?? 0.8);
    const names = o.names ?? HIT_NAMES;
    for (const h of sorted) this.words[voice].push({ t0: h.t - 0.02, t1: h.t + Math.max(0.09, Math.min(h.len ?? this.step, 0.5)), text: names[h.id] ?? h.id });
  }

  /** the hits of a bar of sixteenths in beat notation ("B . t m:36 | …") starting at `at` */
  bar(at: number, text: string): Hit[] {
    return barHits(at, text, this.step);
  }

  /** a named stretch of the tape from `t0`, for the layout */
  phase(name: string, t0: number, who?: string): void {
    if (who !== undefined) this.voice(who);
    this.phases.push({ name, t0, who });
  }

  /**
   * Mix, stitch each voice's telemetry and write the show. Throws when a render still sounds
   * past `duration`, when a voice has no renders (its head would have nothing to show), and
   * when two renders sound at once on one voice (see tele.ts).
   */
  write<X>(o: { title: string; duration: number; downbeat?: number; extra: X; mix?: MixOpts }): TapeShow<X> {
    for (const s of this.segs) {
      const span = soundingSpan(s.tele);
      if (span && s.at + span[1] > o.duration) throw new Error(`"${s.label}" still sounds at ${(s.at + span[1]).toFixed(2)} s; the tape is ${o.duration} s long`);
    }
    mkdirSync(this.out, { recursive: true });
    const [L, R] = mixdown(
      this.segs.map((s) => ({ at: s.at, wav: s.wav, gain: s.gain, pan: this.voice(s.voice).pan ?? 0 })),
      o.duration,
      FS,
      o.mix,
    );
    writeWav(this.out + "mix.wav", [L, R], FS);
    for (const v of this.voices) {
      const mine = this.segs.filter((s) => s.voice === v.id);
      if (!mine.length) throw new Error(`voice ${v.id} has no renders: its head would have nothing to show`);
      writeFileSync(this.out + v.id + ".tele", stitch(mine, o.duration));
    }
    const byTime = <T extends { t0: number }>(xs: T[]) => [...xs].sort((a, b) => a.t0 - b.t0);
    const words: Record<string, TapeWord[]> = {};
    for (const v of this.voices) words[v.id] = byTime(this.words[v.id]);
    const show: TapeShow<X> = {
      title: o.title,
      audio: "mix.wav",
      duration: o.duration,
      bpm: this.bpm,
      downbeat: o.downbeat,
      voices: this.voices.map((v) => ({ id: v.id, name: v.name, tele: v.id + ".tele" })),
      phases: byTime(this.phases),
      words,
      subs: byTime(this.subs),
      extra: o.extra,
    };
    writeFileSync(this.out + "show.json", JSON.stringify(show));
    console.log(show.phases.map((p) => `${p.t0.toFixed(2).padStart(6)}  ${p.name}${p.who ? " " + p.who : ""}`).join("\n"));
    for (const s of [...this.segs].sort((a, b) => a.at - b.at)) console.log(`${s.voice.padEnd(8)} at ${s.at.toFixed(2).padStart(6)}  ${(s.wav.length / FS).toFixed(2).padStart(6)} s  gain ${s.gain.toFixed(2).padStart(5)}  ${s.label}`);
    console.log(`wrote ${this.out}  (${o.duration} s; play it at ?tape=${this.id})`);
    return show;
  }
}
