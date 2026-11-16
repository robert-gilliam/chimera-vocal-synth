/**
 * The tape page's arithmetic (src/tape): a head's pane holds enough pixels for the largest square
 * it is copied into (the first tape's full-screen heads were scaled up 1.32× and soft), and the
 * clock holds at `?t=` or follows the audio context.
 */
import { describe, expect, test } from "bun:test";
import { HEAD_CROP, PANE_CSS, headSource, paneDpr } from "../src/tape/panes.ts";
import { TapeClock, heldTime } from "../src/tape/clock.ts";

describe("head panes", () => {
  test("the shown part of a pane has a pixel for every stage pixel it covers", () => {
    for (const draw of [320, 540, 800, 1080, 1920]) {
      const px = Math.round(PANE_CSS * paneDpr(draw));
      const { side } = headSource(px, px, 1);
      expect(side).toBeGreaterThanOrEqual(draw - 1);
      // and no more than it needs: a head drawn small costs a small canvas
      expect(side).toBeLessThanOrEqual(draw + 1);
    }
    // a head shown with more room round it needs fewer pane pixels for the same square
    expect(headSource(Math.round(PANE_CSS * paneDpr(680, 0.9)), 1, 1, 0.9).side).toBeCloseTo(680, 0);
    expect(paneDpr(680, 0.9)).toBeLessThan(paneDpr(680));
    expect(() => paneDpr(0)).toThrow(/positive/);
    expect(() => paneDpr(680, 1.2)).toThrow(/crop/);
  });

  test("the first tape's panes were too small for its full-screen heads", () => {
    // 680 px at 1.5×, cropped to 0.8, copied to 1080: 816 pixels across 1080
    const old = headSource(680 * 1.5, 680 * 1.5, 1).side;
    expect(old).toBe(816);
    expect(old).toBeLessThan(1080);
    expect(headSource(Math.round(PANE_CSS * paneDpr(1080)), 1, 1).side).toBeCloseTo(1080, 0);
  });

  test("the crop keeps the side the face looks to", () => {
    expect(HEAD_CROP).toBe(0.8);
    expect(headSource(1000, 1000, 1)).toEqual({ sx: 200, sy: 100, side: 800 });
    expect(headSource(1000, 1000, -1)).toEqual({ sx: 0, sy: 100, side: 800 });
    // more of the pane: still from the face's side, still centred in height
    expect(headSource(1000, 1000, -1, 0.9)).toEqual({ sx: 0, sy: 50, side: 900 });
    expect(headSource(1000, 1000, 1, 1)).toEqual({ sx: 0, sy: 0, side: 1000 });
  });
});

describe("the tape's clock", () => {
  test("?t= holds a time; anything else plays", () => {
    expect(heldTime("?tape=sample&t=12.5")).toBe(12.5);
    expect(heldTime("?tape=sample&t=0")).toBe(0);
    expect(heldTime("?tape=sample")).toBeNull();
    expect(heldTime("?tape=sample&t=")).toBeNull();
    expect(heldTime("?tape=sample&t=soon")).toBeNull();
    expect(heldTime("?tape=sample&t=-3")).toBeNull();
  });

  test("held, it never moves; playing, it is the context's time since the mix started", () => {
    const ctx = { currentTime: 5 };
    const held = new TapeClock(7.25);
    held.start(ctx, 5.25);
    ctx.currentTime = 9;
    expect(held.time()).toBe(7.25);
    expect(held.running).toBe(false);

    const c = new TapeClock(null);
    expect([c.time(), c.running]).toEqual([0, false]);
    ctx.currentTime = 5;
    c.start(ctx, 5.25); // the mix is scheduled a quarter second ahead
    expect(c.time()).toBe(0);
    ctx.currentTime = 6.75;
    expect(c.time()).toBe(1.5);
    expect(c.running).toBe(true);
  });
});
