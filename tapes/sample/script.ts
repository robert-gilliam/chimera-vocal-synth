/**
 * The sample tape: ten seconds that use each part of the toolkit once. A spoken line, a sung
 * phrase, and a bar of beatbox under it. Its picture is layout.ts.
 *
 *   cargo build --release -p chimera-cli && bun tapes/sample/script.ts
 *   bun run dev, then http://127.0.0.1:5317/?tape=sample
 */
import { Tape, type Hit, type Note } from "../../tools/tape/tape.ts";

const tape = new Tape({
  id: "sample",
  bpm: 100,
  voices: [
    { id: "lead", name: "ADA", body: "female", pan: 0.25 },
    { id: "drums", name: "MORT", body: "male", pan: -0.25 },
  ],
});

// Mort checks the microphone, then Ada says what this is
tape.phase("title", 0);
tape.drum("drums", [{ t: 0.5, id: "!" }, { t: 0.95, id: "P!" }], { level: 0.5 });
let t = 1.6;
tape.phase("line", t, "lead");
t += tape.say("lead", t, "This is a test of the tape machine.") + 0.35;

// a count of four on the hi-hat, then one bar: the beat, and a phrase sung over it
tape.phase("song", t);
const count = t, downbeat = count + 4 * tape.beat;
const hits: Hit[] = [0, 1, 2, 3].map((i) => ({ t: count + i * tape.beat, id: "t", accent: i === 3 ? 1.3 : undefined }));
hits.push(...tape.bar(downbeat, "B m:36 . t | Pf . m:36 . | B B m:43 . | Pf . t tss"));
hits.push({ t: downbeat + tape.barLen, id: "B", len: 0.2 });
tape.drum("drums", hits);
const tune: Note[] = [[64, 0.5], [67, 0.5], [69, 0.5], [67, 0.5], [64, 0.5], [62, 0.5], [62, 0.25], [60, 0.75]];
tape.sing("lead", downbeat, "seven small moons over the lake", tune);

const end = downbeat + tape.barLen;
tape.phase("end", end + 0.6);
tape.write({ title: "Sample tape", duration: 10, downbeat, extra: { songEnd: end } });
