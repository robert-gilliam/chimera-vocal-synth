/**
 * Records a tape: opens its page in Chrome, plays it once while the page's MediaRecorder captures
 * the stage and the mix, and saves the clip. The capture is in real time: the script reports how
 * many frames the page drew a second and warns when that is under the recording's frame rate.
 *
 *   bun tools/tape/record.ts <id> [--port 5317] [--url http://…/?tape=<id>] [--out out/tape/<id>/tape] [--headed]
 *
 * `--out` is a path without an extension (the browser picks mp4 or webm) or with the right one.
 * The dev server must be running (`bun run dev`) and the show built (`bun tapes/<id>/script.ts`).
 * Exits 0 with a clip, 1 without one; a slow capture is a warning, the clip is still written.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SETTLE_MS, frameReport, openTape, parseArgs, tapeName, tapeUrl } from "./capture.ts";

const args = parseArgs(process.argv.slice(2));
const id = args.rest[0];
const url = tapeUrl(args, id);
const { browser, page } = await openTape(url, args.headed);
try {
  await page.waitForTimeout(SETTLE_MS);
  const duration = await page.evaluate(() => (window as any).__tape.duration as number);
  console.log(`recording ${url}  (${duration} s, in real time)`);
  await page.evaluate(() => (window as any).__tape.start(true));
  await page.waitForFunction(() => (window as any).__tape.done || (window as any).__tape.error, null, { timeout: (duration + 60) * 1000, polling: 250 });
  const info = await page.evaluate(() => {
    const t = (window as any).__tape;
    return { type: t.type as string, fps: t.fps as number, drawnFps: t.drawnFps as number, error: t.error as string | null, size: (t.blob?.size ?? 0) as number };
  });
  if (info.error || !info.size) throw new Error(info.error ?? "the recording is empty");
  const b64 = await page.evaluate(async () => {
    const buf = new Uint8Array(await (window as any).__tape.blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  const ext = info.type.includes("mp4") ? "mp4" : "webm";
  const stem = (args.out ?? `out/tape/${tapeName(args, id)}/tape`).replace(/\.(mp4|webm)$/, "");
  const file = `${stem}.${ext}`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, Buffer.from(b64, "base64"));
  console.log(`wrote ${file}  ${info.type}  ${info.size} bytes`);
  const report = frameReport(info.drawnFps, info.fps);
  (report.warn ? console.warn : console.log)(report.text);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
