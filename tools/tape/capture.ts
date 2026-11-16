/**
 * What the tape capture scripts share: their arguments, the browser, and the page's address.
 *
 *   --url <address>   the tape page, whole (overrides --port and the tape id)
 *   --port <n>        the dev server's port on 127.0.0.1 (5317: `bun run dev`)
 *   --out <path>      where to write (each script says what its default is)
 *   --headed          show the browser window
 */
import { chromium, type Browser, type Page } from "playwright-core";

export interface CaptureArgs {
  /** arguments that are not options: the tape id, then whatever the script takes */
  rest: string[];
  url?: string;
  port: number;
  out?: string;
  headed: boolean;
}

export function parseArgs(argv: string[]): CaptureArgs {
  const a: CaptureArgs = { rest: [], port: 5317, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${x} needs a value`);
      return v;
    };
    if (x === "--url") a.url = value();
    else if (x === "--out") a.out = value();
    else if (x === "--port") {
      a.port = Number(value());
      if (!Number.isInteger(a.port) || a.port < 1 || a.port > 65535) throw new Error(`--port ${argv[i]}: not a port`);
    } else if (x === "--headed") a.headed = true;
    else if (x.startsWith("--")) throw new Error(`unknown option ${x}`);
    else a.rest.push(x);
  }
  return a;
}

/** the tape page's address: `--url` as given, else the dev server's `?tape=<id>`; `t` holds a time */
export function tapeUrl(a: Pick<CaptureArgs, "url" | "port">, id: string | undefined, t?: number): string {
  let u: URL;
  if (a.url) u = new URL(a.url);
  else {
    if (!id || !/^[\w-]+$/.test(id)) throw new Error("which tape? give its id (a folder under tapes/), or --url");
    u = new URL(`http://127.0.0.1:${a.port}/`);
    u.searchParams.set("tape", id);
  }
  if (t !== undefined) u.searchParams.set("t", String(t));
  else u.searchParams.delete("t");
  return u.href;
}

/** the tape's id for file names: the argument, or the address's `tape` parameter */
export function tapeName(a: Pick<CaptureArgs, "url">, id: string | undefined): string {
  const fromUrl = a.url ? new URL(a.url).searchParams.get("tape") : null;
  const name = id ?? fromUrl ?? "tape";
  return /^[\w-]+$/.test(name) ? name : "tape";
}

/** how a recording's drawn frame rate reads against the rate it was recorded at; `warn` when short */
export function frameReport(drawnFps: number, fps: number): { text: string; warn: boolean } {
  // a display refreshing at exactly `fps` draws a hair under it by the clock: allow 3 %
  const warn = !(drawnFps >= fps * 0.97);
  const text = `the page drew ${drawnFps.toFixed(1)} frames a second; the recording runs at ${fps}`;
  return { text: warn ? `WARNING: ${text}. The capture is in real time, so about ${Math.round(100 * Math.max(0, 1 - drawnFps / fps))} % of its frames repeat the one before: close other programs, draw smaller heads, or lower the layout's fps.` : text, warn };
}

/**
 * Installed Google Chrome with the GPU on (the heads are WebGL) and nothing throttled in the
 * background, and a page that reports its errors. The stage is its own size whatever the window's.
 */
export async function openTape(url: string, headed: boolean): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: !headed,
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--mute-audio"],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  page.on("console", (m) => m.type() === "error" && console.log("console:", m.text()));
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    // ready, or the page's own message if the tape could not load
    await page.waitForFunction(() => (window as any).__tape?.ready || document.querySelector(".tape-msg"), null, { timeout: 30000 });
    const failed = await page.evaluate(() => document.querySelector(".tape-msg")?.textContent ?? null);
    if (failed) throw new Error(failed);
  } catch (e) {
    await browser.close();
    throw new Error(`${url}: ${e instanceof Error ? e.message : e}`);
  }
  return { browser, page };
}

/** the heads open on a side view and turn to face the camera: wait that out before a still or a take */
export const SETTLE_MS = 2600;
