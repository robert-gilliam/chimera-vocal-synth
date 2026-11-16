/**
 * The tape page (`?tape=<id>`): a video frame of heads replaying a pre-built show
 * (`bun tapes/<id>/script.ts` → public/shows/<id>/). Each head is the duet page's: a 3D head fed
 * its voice's recorded telemetry, in a pane of its own. Every frame the tape's layout
 * (tapes/<id>/layout.ts) copies the heads onto one stage canvas, the size of the video, and
 * draws its text; the stage and the mix are recorded with MediaRecorder.
 *
 * `?tape=<id>&t=12.5` holds the picture at a time (no sound), for checking a layout.
 * `window.__tape.start(true)` plays once and records; the clip is then at `window.__tape.blob`
 * (tools/tape/record.ts does this in headless Chrome; tools/tape/shoot.ts takes stills).
 */
import { useEffect, useRef, useState } from "react";
import { AnatomyView3D, type HeadFeed } from "../ui/components/AnatomyView3D.tsx";
import { TeleTrack } from "../show/tele.ts";
import { getModel } from "../ui/useModel.ts";
import { VoiceModel } from "../ui/analysis.ts";
import { mouthWords } from "../ui/mouthWords.ts";
import { V } from "../ui/colors.ts";
import type { ViewFlags } from "../ui/render/anatomy.ts";
import type { OverlayFn } from "../ui/components/AnatomyView.tsx";
import { TapeClock, heldTime } from "./clock.ts";
import { PANE_CSS, paneDpr } from "./panes.ts";
import { tapeWordAt, type TapeShow } from "./show.ts";
import { drawHead, type HeadSpec, type Stage, type TapeLayout } from "./stage.ts";
import "./tape.css";

/** each tape's layout, loaded when its tape is opened */
const LAYOUTS = import.meta.glob<{ layout: TapeLayout }>("/tapes/*/layout.ts");

/** the heads as the face screen shows them by default, less the measurement labels */
const VIEW: ViewFlags = { pressure: true, particles: true, grid: false, calipers: false };
/** what MediaRecorder is asked for, best first */
const TYPES = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];

interface Loaded {
  show: TapeShow;
  layout: TapeLayout;
  /** by voice id, for the voices the layout shows */
  tracks: Record<string, TeleTrack>;
  audio: ArrayBuffer;
}

/** what the page tells a script driving it (`window.__tape`) */
export interface TapeApi {
  /** the show is loaded and the stage is drawing */
  ready: boolean;
  /** `start` has played the tape to its end (and the clip, if recording, is in `blob`) */
  done: boolean;
  duration: number;
  /** the frame rate the recorder samples the stage at */
  fps: number;
  /** stage frames drawn since the page loaded */
  frames: number;
  /** stage frames drawn per second between `start` and the tape's end (0 until done) */
  drawnFps: number;
  /** the recording's MIME type */
  type: string;
  blob: Blob | null;
  error: string | null;
  /** play the tape once from the top; `record` also captures the stage and the mix */
  start(record: boolean): Promise<void>;
}

export function TapePage(props: { id: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stageRef = useRef<HTMLCanvasElement>(null);
  const panesRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<TapeClock | null>(null);
  if (!clockRef.current) clockRef.current = new TapeClock(heldTime(window.location.search));
  const clock = clockRef.current;

  useEffect(() => {
    let live = true;
    const base = `${import.meta.env.BASE_URL}shows/${props.id}/`;
    (async () => {
      const load = LAYOUTS[`/tapes/${props.id}/layout.ts`];
      if (!load) throw new Error(`no layout at tapes/${props.id}/layout.ts`);
      const get = async (f: string) => {
        const r = await fetch(base + f);
        if (!r.ok) throw new Error(`${f}: ${r.status} ${r.statusText} (build the show first: bun tapes/${props.id}/script.ts)`);
        return r;
      };
      const [{ layout }, show] = await Promise.all([load(), get("show.json").then((r) => r.json() as Promise<TapeShow>)]);
      const seen = show.voices.filter((v) => layout.heads[v.id]);
      const [audio, ...teles] = await Promise.all([get(show.audio).then((r) => r.arrayBuffer()), ...seen.map((v) => get(v.tele).then((r) => r.arrayBuffer()))]);
      // canvas text is drawn at once in whatever font is loaded: have Hershey before the first frame
      await Promise.all([document.fonts.load('300 40px "Hershey"'), document.fonts.load('500 40px "Hershey"')]);
      const tracks: Record<string, TeleTrack> = {};
      seen.forEach((v, i) => (tracks[v.id] = new TeleTrack(teles[i])));
      if (live) setLoaded({ show, layout, tracks, audio });
    })().catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [props.id]);

  useEffect(() => {
    if (!loaded) return;
    const { show, layout } = loaded;
    const stageEl = stageRef.current!;
    const ctx = stageEl.getContext("2d")!;
    const fps = layout.fps ?? 30;
    const api: TapeApi = {
      ready: true,
      done: false,
      duration: show.duration,
      fps,
      frames: 0,
      drawnFps: 0,
      type: "",
      blob: null,
      error: null,
      async start(record: boolean) {
        const ac = new AudioContext({ sampleRate: 48000, latencyHint: "playback" });
        await ac.resume();
        const buffer = await ac.decodeAudioData(loaded.audio.slice(0));
        const src = ac.createBufferSource();
        src.buffer = buffer;
        src.connect(ac.destination);
        let rec: MediaRecorder | null = null;
        if (record) {
          const out = ac.createMediaStreamDestination();
          src.connect(out);
          const type = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
          if (!type) throw new Error("this browser records no video");
          api.type = type;
          const stream = new MediaStream([...stageEl.captureStream(fps).getVideoTracks(), ...out.stream.getAudioTracks()]);
          rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 12_000_000, audioBitsPerSecond: 192_000 });
          const chunks: Blob[] = [];
          rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
          rec.onerror = () => (api.error = "the recorder failed");
          rec.onstop = () => {
            api.blob = new Blob(chunks, { type });
            api.done = true;
          };
          rec.start(1000);
        }
        const at = ac.currentTime + 0.25;
        src.start(at);
        clock.start(ac, at);
        // the frames drawn while the tape plays: the capture is in real time, so a page that
        // draws fewer than `fps` leaves the recording with repeated frames
        let frames0 = -1, wall0 = 0;
        const watch = () => {
          const t = clock.time();
          if (frames0 < 0 && t > 0) {
            frames0 = api.frames;
            wall0 = performance.now();
          }
          if (t < show.duration) return void setTimeout(watch, 20);
          if (frames0 >= 0) api.drawnFps = ((api.frames - frames0) * 1000) / (performance.now() - wall0);
          if (rec) rec.stop();
          else api.done = true;
        };
        watch();
      },
    };
    (window as unknown as { __tape: TapeApi }).__tape = api;

    const panes = new Map<string, HTMLCanvasElement>();
    const tooBig = new Set<string>();
    const stage: Stage = {
      ctx,
      show,
      t: 0,
      width: layout.width,
      height: layout.height,
      head(id, x, y, size) {
        const spec = layout.heads[id];
        if (!spec) throw new Error(`the layout draws a head for ${JSON.stringify(id)} but lists none in heads`);
        if (size > spec.size + 0.5 && !tooBig.has(id)) {
          tooBig.add(id);
          console.error(`tape: head ${id} drawn ${size} px wide but sized for ${spec.size}: it will be soft; raise heads.${id}.size`);
        }
        let pane = panes.get(id);
        if (!pane) {
          pane = panesRef.current?.querySelector<HTMLCanvasElement>(`[data-voice="${id}"] canvas`) ?? undefined;
          if (pane) panes.set(id, pane);
        }
        drawHead(ctx, pane, x, y, size, spec.facing ?? 1, spec.crop);
      },
    };
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, layout.width, layout.height);
      stage.t = clock.time();
      try {
        layout.draw(stage);
      } catch (e) {
        // a layout's mistake stops the picture, and says so to whoever is recording
        cancelAnimationFrame(raf);
        api.error = e instanceof Error ? e.message : String(e);
        setError(api.error);
        return;
      }
      api.frames++;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [loaded, clock]);

  if (error)
    return (
      <div className="tape">
        <p className="tape-msg">This tape could not play: {error}</p>
      </div>
    );
  return (
    <div className="tape">
      <div ref={panesRef} className="tape-panes" aria-hidden="true">
        {loaded &&
          Object.entries(loaded.tracks).map(([id, track]) => (
            <div key={id} className="tape-pane" data-voice={id} style={{ width: PANE_CSS, height: PANE_CSS }}>
              <Head show={loaded.show} layout={loaded.layout} id={id} spec={loaded.layout.heads[id]} track={track} clock={clock} />
            </div>
          ))}
      </div>
      <canvas ref={stageRef} className="tape-stage" width={loaded?.layout.width ?? 16} height={loaded?.layout.height ?? 16} role="img" aria-label={loaded ? loaded.show.title : "Loading the tape"} />
    </div>
  );
}

/** one voice's head in its pane, at the pixel ratio its largest copy on the stage needs */
function Head(props: { show: TapeShow; layout: TapeLayout; id: string; spec: HeadSpec; track: TeleTrack; clock: TapeClock }) {
  const { show, layout, id, spec, track, clock } = props;
  const facing = spec.facing ?? 1;
  const feed = useRef<HeadFeed | null>(null);
  const overlay = useRef<OverlayFn | undefined>(undefined);
  if (!overlay.current) overlay.current = mouthWords(() => tapeWordAt(show.words[id], clock.time()), spec.color ?? V.green, facing);
  if (!feed.current) {
    feed.current = {
      model: getModel(track.body, track.sampleRate),
      view: VIEW,
      dpr: paneDpr(spec.size, spec.crop),
      facing,
      frame: () => {
        const t = clock.time();
        const msg = track.message(track.indexAt(t), layout.beatStep?.(show, t) ?? -1);
        return { tele: msg, artic: VoiceModel.articFromArray(msg.t.artic), epoch: 0 };
      },
    };
  }
  return <AnatomyView3D feed={feed.current} readouts={false} overlay={overlay.current} />;
}
