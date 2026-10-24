import { useCallback, useEffect, useRef, useState } from "react";
import { detectQuad, loadCv } from "../lib/scan.ts";
import { lerpQuad, type Quad } from "../lib/quad.ts";
import { useReducedMotion } from "../lib/hooks.ts";

type Status = "starting" | "live" | "unavailable";
type CvT = Awaited<ReturnType<typeof loadCv>>;

const YELLOW = "#FFD21F";

/** Live camera with a page-edge overlay. Four corner brackets glide onto the page when it is found. */
export function Camera(p: {
  onCapture: (frame: HTMLCanvasElement, hint: Quad | null) => void;
  onFile: (f: File | undefined) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const found = useRef<Quad | null>(null);
  const [status, setStatus] = useState<Status>("starting");
  const [seen, setSeen] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    let stream: MediaStream | null = null;
    let dead = false;
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no camera api");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
          audio: false,
        });
        if (dead) { stream.getTracks().forEach((t) => t.stop()); return; }
        const v = video.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();
        setStatus("live");
      } catch {
        if (!dead) setStatus("unavailable");
      }
    })();
    return () => {
      dead = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (status !== "live") return;
    let raf = 0, last = 0, misses = 0, cv: CvT | null = null;
    let shown: Quad | null = null;
    let target: Quad | null = null;
    let lastSeen = false;
    void loadCv().then((c) => { cv = c; });
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const v = video.current, cvs = overlay.current;
      if (!v || !cvs || !v.videoWidth) return;
      if (cv && t - last > 250) {
        last = t;
        const q = detectQuad(cv, v);
        if (q) { target = q; misses = 0; } else if (++misses > 3) target = null;
        found.current = target;
        if ((target !== null) !== lastSeen) { lastSeen = target !== null; setSeen(lastSeen); }
      }
      const dpr = window.devicePixelRatio || 1;
      const cw = cvs.clientWidth, ch = cvs.clientHeight;
      if (cvs.width !== Math.round(cw * dpr)) { cvs.width = Math.round(cw * dpr); cvs.height = Math.round(ch * dpr); }
      const ctx = cvs.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      // video pixels -> overlay pixels (object-fit: cover)
      const s = Math.max(cw / v.videoWidth, ch / v.videoHeight);
      const ox = (cw - v.videoWidth * s) / 2, oy = (ch - v.videoHeight * s) / 2;
      const guide: Quad = [{ x: cw * 0.14, y: ch * 0.12 }, { x: cw * 0.86, y: ch * 0.12 }, { x: cw * 0.86, y: ch * 0.88 }, { x: cw * 0.14, y: ch * 0.88 }];
      const want: Quad = target ? (target.map((pt) => ({ x: pt.x * s + ox, y: pt.y * s + oy })) as Quad) : guide;
      shown = shown && !reduced ? lerpQuad(shown, want, 0.28) : want;
      drawFrame(ctx, shown, target !== null);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status, reduced]);

  const shoot = useCallback(() => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    p.onCapture(c, found.current);
  }, [p]);

  return (
    <section className="cam" aria-label="Camera">
      <h1 className="sr">Point the camera at your letter</h1>
      <video ref={video} playsInline muted aria-hidden="true" />
      <canvas ref={overlay} aria-hidden="true" />
      <p className="cam-hint" aria-live="polite">
        {status === "starting" && "Starting the camera"}
        {status === "live" && (seen ? "Page found. Hold steady." : "Fit the whole page in the frame.")}
        {status === "unavailable" && "No camera here. Choose a photo instead."}
      </p>
      <div className="cam-bar">
        <button type="button" className="cam-side" onClick={p.onClose}>Close</button>
        <button type="button" className="shutter" onClick={shoot} disabled={status !== "live"}>
          <span className="shutter-ring" aria-hidden="true" />
          Take photo
        </button>
        <label className="cam-side">
          Choose photo
          <input type="file" accept="image/*" onChange={(e) => p.onFile(e.target.files?.[0])} />
        </label>
      </div>
    </section>
  );
}

function drawFrame(ctx: CanvasRenderingContext2D, q: Quad, locked: boolean): void {
  const color = locked ? YELLOW : "rgba(255,255,255,.75)";
  if (locked) {
    ctx.beginPath();
    q.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
    ctx.closePath();
    ctx.fillStyle = "rgba(255,210,31,.12)";
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineCap = "square";
  for (let i = 0; i < 4; i++) {
    const a = q[i] as Quad[number], prev = q[(i + 3) % 4] as Quad[number], next = q[(i + 1) % 4] as Quad[number];
    const len = (to: Quad[number]) => {
      const d = Math.hypot(to.x - a.x, to.y - a.y) || 1;
      const k = Math.min(34, d * 0.3) / d;
      return { x: a.x + (to.x - a.x) * k, y: a.y + (to.y - a.y) * k };
    };
    const p1 = len(prev), p2 = len(next);
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(a.x, a.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }
}
