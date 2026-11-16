/**
 * Stills of a tape at given times, to check its layout: the stage canvas itself, at the video's
 * size, with the picture held at each time (`?t=`; no sound).
 *
 *   bun tools/tape/shoot.ts <id> 1 4.5 8 … [--port 5317] [--url http://…/?tape=<id>] [--out out/tape/<id>]
 *
 * Writes <out>/still-<t>.jpg. `--out` is a folder. With `--url` every argument is a time.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { SETTLE_MS, openTape, parseArgs, tapeName, tapeUrl } from "./capture.ts";

const args = parseArgs(process.argv.slice(2));
const id = args.url ? undefined : args.rest[0];
const times = (args.url ? args.rest : args.rest.slice(1)).map(Number);
if (!times.length || times.some((t) => !Number.isFinite(t) || t < 0)) {
  console.error("give the times to shoot, in seconds: bun tools/tape/shoot.ts <id> 1 4.5 8");
  process.exit(1);
}
const dir = (args.out ?? `out/tape/${tapeName(args, id)}`).replace(/\/$/, "");
mkdirSync(dir, { recursive: true });
let failed = false;
for (const t of times) {
  try {
    const { browser, page } = await openTape(tapeUrl(args, id, t), args.headed);
    try {
      await page.waitForTimeout(SETTLE_MS);
      const shot = await page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>("canvas.tape-stage")!;
        return { url: c.toDataURL("image/jpeg", 0.9), w: c.width, h: c.height, error: (window as any).__tape.error as string | null };
      });
      if (shot.error) throw new Error(shot.error);
      const file = `${dir}/still-${t}.jpg`;
      writeFileSync(file, Buffer.from(shot.url.split(",")[1], "base64"));
      console.log(`wrote ${file}  ${shot.w}×${shot.h}`);
    } finally {
      await browser.close();
    }
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
