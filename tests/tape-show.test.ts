/** A tape's show file (src/tape/show.ts): which phase and which word hold at a time. */
import { expect, test } from "bun:test";
import { phaseAt, tapeWordAt, type TapePhase, type TapeWord } from "../src/tape/show.ts";

test("the phase at a time is the last one started", () => {
  const phases: TapePhase[] = [{ name: "title", t0: 0.5 }, { name: "line", t0: 2, who: "lead" }, { name: "end", t0: 9 }];
  expect(phaseAt(phases, 0.2)).toBeUndefined();
  expect(phaseAt(phases, 0.5)?.name).toBe("title");
  expect(phaseAt(phases, 8.99)).toEqual({ name: "line", t0: 2, who: "lead" });
  expect(phaseAt(phases, 60)?.name).toBe("end");
});

test("a word shows only while it sounds, and a repeated word is a new one", () => {
  const words: TapeWord[] = [{ t0: 1, t1: 1.5, text: "la" }, { t0: 1.5, t1: 2, text: "la" }, { t0: 3, t1: 3.2, text: "B" }];
  expect(tapeWordAt(words, 0.9)).toBeNull();
  expect(tapeWordAt(words, 1.2)).toEqual({ key: 0, text: "la" });
  expect(tapeWordAt(words, 1.5)).toEqual({ key: 1, text: "la" });
  expect(tapeWordAt(words, 2.5)).toBeNull(); // between words
  expect(tapeWordAt(words, 3.1)).toEqual({ key: 2, text: "B" });
  expect(tapeWordAt(undefined, 1)).toBeNull();
});
