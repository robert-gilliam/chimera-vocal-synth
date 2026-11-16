/**
 * The sample tape's picture, 1080 × 1920: a title while Mort checks the microphone, Ada alone
 * for her line, the two of them for the song, and a closing card. Its sound is script.ts.
 */
import { V } from "../../src/ui/colors.ts";
import { seg } from "../../src/ui/render/vector.ts";
import { phaseAt } from "../../src/tape/show.ts";
import { glowLines, glowText, type TapeLayout } from "../../src/tape/stage.ts";

/** what script.ts passes in `extra` */
interface Extra {
  songEnd: number;
}

const W = 1080, H = 1920;
const COLOR: Record<string, string> = { lead: V.green, drums: V.amber };

export const layout: TapeLayout<Extra> = {
  width: W,
  height: H,
  fps: 30,
  // the largest each head is drawn below: Ada alone, Mort in the song (the male head is the
  // biggest: it needs more of its pane to keep its crown)
  heads: {
    lead: { size: 1000, facing: 1, color: COLOR.lead },
    drums: { size: 680, facing: -1, color: COLOR.drums, crop: 0.92 },
  },
  // the heads nod from the count-in to the last beat
  beatStep(show, t) {
    const t0 = (show.downbeat ?? 0) - 240 / (show.bpm ?? 100);
    if (!show.bpm || t < t0 || t >= show.extra.songEnd) return -1;
    return Math.floor(((t - t0) * show.bpm * 4) / 60) % 16;
  },
  draw({ ctx, show, t, head }) {
    const ph = phaseAt(show.phases, t);
    const name = (id: string) => show.voices.find((v) => v.id === id)?.name ?? id;
    const sub = show.subs.find((s) => s.t0 <= t && t < s.t1);

    if (!ph || ph.name === "title") {
      glowText(ctx, "SAMPLE TAPE", W / 2, 520, { size: 40, color: V.blue, ls: 0.2 });
      seg(ctx, 240, 570, 840, 570, V.blueDim, 1.5);
      glowText(ctx, "CHIMERA", W / 2, 760, { size: 150, color: V.amber, weight: "m", ls: 0.16, maxW: 940 });
      glowText(ctx, "TEN SECONDS. TWO HEADS.", W / 2, 860, { size: 42, color: V.white, ls: 0.2, maxW: 940 });
      head("drums", 200, 1000, 680);
      glowText(ctx, "(MIC CHECK)", W / 2, 1780, { size: 32, color: V.blue, ls: 0.2 });
    } else if (ph.name === "line" && ph.who) {
      head(ph.who, 40, 240, 1000);
      seg(ctx, 120, 1330, 960, 1330, V.blueDim, 1.5);
      glowText(ctx, name(ph.who), W / 2, 1440, { size: 92, color: COLOR[ph.who] ?? V.blue, weight: "m", maxW: 900 });
      if (sub) glowLines(ctx, `"${sub.text.toUpperCase()}"`, W / 2, 1590, 940, { size: 52, color: V.white, weight: "m" });
    } else if (ph.name === "song") {
      head("lead", 140, 130, 800);
      glowText(ctx, name("lead"), W / 2, 985, { size: 36, color: COLOR.lead, weight: "m", ls: 0.2 });
      head("drums", 200, 1010, 680);
      glowText(ctx, name("drums"), W / 2, 1745, { size: 36, color: COLOR.drums, weight: "m", ls: 0.2 });
      seg(ctx, 80, 1790, 1000, 1790, V.blueDim, 1.5);
      glowText(ctx, t < (show.downbeat ?? 0) ? "ONE BAR. COUNT IT IN." : "SPOKEN. SUNG. BEATBOXED.", W / 2, 1860, { size: 34, color: V.blue, ls: 0.2, maxW: 940 });
    } else {
      glowText(ctx, "EVERY SOUND ON THIS TAPE", W / 2, 760, { size: 46, color: V.white, maxW: 940 });
      glowText(ctx, "CAME FROM A SIMULATED AIRWAY.", W / 2, 830, { size: 46, color: V.white, maxW: 940 });
      glowText(ctx, "CHIMERA", W / 2, 1060, { size: 170, color: V.blue, weight: "m", ls: 0.16, maxW: 940 });
      glowText(ctx, "CHIMERA.AUDIO", W / 2, 1160, { size: 46, color: V.white, ls: 0.24 });
    }
  },
};
