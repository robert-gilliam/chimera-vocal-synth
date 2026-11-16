/**
 * How big to draw a tape's heads. Each head is a 3D view in its own pane; the stage copies part
 * of the pane's canvas into a square of the video frame. The pane must hold at least as many
 * pixels as the largest square it is ever copied into, or the copy is scaled up and goes soft
 * (the first tape drew 680 px panes at 1.5× and showed 816 of their pixels across 1080).
 */

/**
 * the part of a pane the stage shows by default: a square this fraction of its side (see
 * `headSource`). The adult male head, the largest, needs 0.9 to keep its crown.
 */
export const HEAD_CROP = 0.8;
/** a pane's side in CSS px: the size the head's line weights and the words at its mouth are drawn for */
export const PANE_CSS = 680;

/**
 * The pixel ratio a pane needs so that its shown part is `maxDraw` stage pixels across: the
 * canvas is PANE_CSS × this, whatever the device's own ratio.
 */
export function paneDpr(maxDraw: number, crop = HEAD_CROP): number {
  if (!(maxDraw > 0)) throw new Error(`a head's size must be positive, not ${maxDraw}`);
  if (!(crop > 0 && crop <= 1)) throw new Error(`a head's crop is a fraction of its pane (0–1), not ${crop}`);
  return maxDraw / crop / PANE_CSS;
}

/**
 * The square of a pane's canvas (w × h device px) the stage shows: `crop` of its side, taken
 * from the side the face looks to (what is left out is the empty space behind the head; the
 * words at the mouth need the space in front of it) and from the middle of its height.
 */
export function headSource(w: number, h: number, facing: 1 | -1, crop = HEAD_CROP): { sx: number; sy: number; side: number } {
  const side = w * crop;
  return { sx: facing > 0 ? w - side : 0, sy: (h - side) / 2, side };
}
