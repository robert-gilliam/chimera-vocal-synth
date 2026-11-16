/**
 * What a tape's layout draws with: the stage (one canvas the size of the video frame), the heads
 * copied onto it, and glowing Hershey text. A layout (tapes/<id>/layout.ts) exports one
 * `TapeLayout`; the tape page calls its `draw` every frame.
 */
import { label, labelWidth, wrapLabel } from "../ui/render/vector.ts";
import { headSource } from "./panes.ts";
import type { TapeShow } from "./show.ts";

export interface HeadSpec {
  /** the largest square (stage px) the layout ever draws this head in: its pane is sized for it */
  size: number;
  /** which way it turns to show its face (−1: to the left) */
  facing?: 1 | -1;
  /** the colour of the words at its mouth */
  color?: string;
  /** how much of its pane is shown, 0–1 (HEAD_CROP: 0.8); more shows more room round the head */
  crop?: number;
}

export interface Stage<X = Record<string, unknown>> {
  ctx: CanvasRenderingContext2D;
  show: TapeShow<X>;
  /** seconds into the tape */
  t: number;
  width: number;
  height: number;
  /** voice `id`'s head into the square at (x, y), `size` wide; no more than its `HeadSpec.size` */
  head(id: string, x: number, y: number, size: number): void;
}

export interface TapeLayout<X = Record<string, unknown>> {
  /** the video frame (px) */
  width: number;
  height: number;
  /** frames per second recorded (30) */
  fps?: number;
  /** the heads shown, by voice id; a voice not listed is heard and not seen */
  heads: Record<string, HeadSpec>;
  /** the sixteenth the heads nod on at t (0–15), −1 for none; default: no nodding */
  beatStep?(show: TapeShow<X>, t: number): number;
  /** draw the frame at `s.t` on a cleared (black) stage */
  draw(s: Stage<X>): void;
}

export interface TextOpts {
  size: number;
  color: string;
  weight?: "l" | "m";
  alpha?: number;
  /** shrink the text to fit this width */
  maxW?: number;
  /** letter spacing as a fraction of the size (0.08) */
  ls?: number;
}

type Ctx = CanvasRenderingContext2D;

/** glowing Hershey text centred on x, its baseline at y, shrunk to fit `maxW` */
export function glowText(ctx: Ctx, s: string, x: number, y: number, o: TextOpts): void {
  let size = o.size;
  const ls = o.ls ?? 0.08;
  const wide = labelWidth(ctx, s, { size, weight: o.weight, ls });
  if (o.maxW && wide > o.maxW) size *= o.maxW / wide;
  ctx.save();
  ctx.shadowColor = o.color;
  ctx.shadowBlur = size * 0.35;
  label(ctx, s, x, y, { size, color: o.color, weight: o.weight ?? "l", align: "center", ls, alpha: o.alpha });
  ctx.restore();
}

/** `s` wrapped to lines no wider than `maxW`, the first line's baseline at y; returns the line count */
export function glowLines(ctx: Ctx, s: string, x: number, y: number, maxW: number, o: TextOpts): number {
  const lines = wrapLabel(ctx, s, maxW, { size: o.size, weight: o.weight, ls: o.ls ?? 0.08 });
  lines.forEach((l, i) => glowText(ctx, l, x, y + i * o.size * 1.35, o));
  return lines.length;
}

/** a head's pane canvas into the square at (x, y): added to what is there, as light on a screen */
export function drawHead(ctx: Ctx, pane: HTMLCanvasElement | undefined, x: number, y: number, size: number, facing: 1 | -1 = 1, crop?: number): void {
  if (!pane || !pane.width) return;
  const { sx, sy, side } = headSource(pane.width, pane.height, facing, crop);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(pane, sx, sy, side, side, x, y, size, size);
  ctx.restore();
}
