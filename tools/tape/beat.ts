/**
 * Beat notation to hits on a timeline, for `chimera render hits`. The notation is the app's
 * (crates/chimera/src/phonetics/beatbox.rs `parse_beat`): tokens separated by spaces or "|" (bar
 * lines, ignored); "." or "-" is a rest; a hum may carry a MIDI note ("m:43"); a trailing ">"
 * accents. Ids are passed on as written: the CLI refuses one the kit lacks.
 */

/** one beat sound at a time on the tape's timeline */
export interface Hit {
  /** when the sound is heard (s) */
  t: number;
  /** a beat sound's id ("B", "t", "Pf", "m", …) */
  id: string;
  /** how long it may last (s); sustained sounds (hum, open hat, crash) use it */
  len?: number;
  /** a hum's MIDI note */
  note?: number;
  /** 1 plain; the notation's ">" is 1.3 */
  accent?: number;
}

/** the notation's accent (parse_beat's) */
export const ACCENT = 1.3;

/**
 * The hits of `text`, its first cell at `at`, one cell every `step` seconds. A sound lasts until
 * the next one, as the sequencer plays it; the last lasts to the end of the text (the sequencer
 * would loop round to the first sound, a tape doesn't).
 */
export function barHits(at: number, text: string, step: number): Hit[] {
  const cells = text.split(/[\s|]+/).filter(Boolean);
  const hits: Hit[] = [];
  cells.forEach((cell, i) => {
    if (cell === "." || cell === "-") return;
    let rests = 0;
    while (i + 1 + rests < cells.length && (cells[i + 1 + rests] === "." || cells[i + 1 + rests] === "-")) rests++;
    let tok = cell;
    const hit: Hit = { t: at + i * step, id: "", len: (1 + rests) * step };
    if (tok.endsWith(">")) {
      hit.accent = ACCENT;
      tok = tok.slice(0, -1);
    }
    const note = /^(.+?):(\d+)$/.exec(tok);
    if (note) {
      tok = note[1];
      hit.note = Number(note[2]);
    }
    hit.id = tok;
    hits.push(hit);
  });
  return hits;
}

/** the rows of a `render hits` file: times from `t0`, absent fields as nulls */
export function hitRows(hits: Hit[], t0: number, defaultLen: number): (number | string | null)[][] {
  return hits.map((h) => [h.t - t0, h.id, h.len ?? defaultLen, h.note ?? null, h.accent ?? null]);
}
