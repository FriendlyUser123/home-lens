import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Field } from "../lib/fields.ts";
import { useMedia, useReducedMotion } from "../lib/hooks.ts";
import type { HeadRef, Job } from "../types.ts";

interface Pt { x: number; y: number }

/** The paper with marker highlights, and one card per value, joined by lines. */
export function Reading(p: { headRef: HeadRef; job: Job; onNext: () => void; readBy: string }) {
  const { job } = p;
  const reduced = useReducedMotion();
  const wide = useMedia("(min-width: 900px)");
  const [shown, setShown] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLElement>());
  const [geo, setGeo] = useState<{ key: string; stage: DOMRect; grid: DOMRect; cards: Map<string, DOMRect> } | null>(null);
  const done = job.phase === "done";
  const n = job.fields.length;

  // Reveal one value at a time (all at once with reduced motion).
  useEffect(() => {
    if (!done) { setShown(0); return; }
    if (reduced) { setShown(n); return; }
    setShown(0);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setShown(i);
      if (i >= n) clearInterval(id);
    }, 260);
    return () => clearInterval(id);
  }, [done, n, reduced]);

  const measure = () => {
    const g = grid.current, s = stage.current;
    if (!g || !s) return;
    const m = new Map<string, DOMRect>();
    cards.current.forEach((el, id) => m.set(id, el.getBoundingClientRect()));
    const sr = s.getBoundingClientRect(), gr = g.getBoundingClientRect();
    const r = (x: DOMRect) => [x.left, x.top, x.width, x.height].map(Math.round).join(",");
    const key = [r(sr), r(gr), ...[...m].map(([id, c]) => `${id}:${r(c)}`)].join("|");
    // Only update when something moved, otherwise every render would measure again.
    setGeo((prev) => (prev?.key === key ? prev : { key, stage: sr, grid: gr, cards: m }));
  };
  useLayoutEffect(() => {
    measure();
    const g = grid.current;
    if (!g) return;
    const ro = new ResizeObserver(measure);
    ro.observe(g);
    window.addEventListener("resize", measure);
    return () => { ro.disconnect(); window.removeEventListener("resize", measure); };
  });

  const latest = shown > 0 && shown < n ? job.fields[shown - 1]?.id ?? null : null;
  const focusId = active ?? latest;

  const lines = useMemo(() => {
    if (!geo || !done || !wide) return [];
    const scale = geo.stage.width / job.pageW;
    const ox = geo.stage.left - geo.grid.left, oy = geo.stage.top - geo.grid.top;
    return job.fields.slice(0, shown).flatMap((f, i) => {
      const r = f.where?.rects.at(-1);
      const c = geo.cards.get(f.id);
      if (!r || !c) return [];
      const a: Pt = { x: ox + (r.x + r.w) * scale, y: oy + (r.y + r.h) * scale }; // runs along the line like an underline
      const b: Pt = { x: c.left - geo.grid.left, y: c.top - geo.grid.top + 24 };
      const lane = ox + geo.stage.width + 16 + (i % 8) * 8;
      const d = `M${a.x},${a.y} H${lane} V${b.y} H${b.x}`;
      const len = Math.abs(lane - a.x) + Math.abs(b.y - a.y) + Math.abs(b.x - lane);
      return [{ id: f.id, d, a, b, len: Math.ceil(len) + 2, on: f.id === focusId }];
    });
  }, [geo, done, shown, wide, focusId, job.fields, job.pageW]);

  const status = job.phase === "flatten" ? "Finding the page edges" : job.phase === "read" ? (job.words.length ? `Found ${job.words.length} words. Gemma is reading` : "Looking at the words") : `Found ${n} value${n === 1 ? "" : "s"}`;
  const unmatched = job.fields.filter((f) => f.check).length;

  // Phone: numbered pins sit in the left margin, one step right for each earlier value on the same printed line.
  const pinAt = (f: Field, i: number): { left: string; top: string } | null => {
    const r = f.where?.rects.at(-1);
    if (!r) return null;
    const same = job.fields.slice(0, i).filter((o) => { const q = o.where?.rects.at(-1); return q && Math.abs(q.y - r.y) < r.h; }).length;
    return { left: `${6 + same * 22}px`, top: `${((r.y + r.h / 2) / job.pageH) * 100}%` };
  };

  return (
    <section className="screen reading">
      <div className="read-grid" ref={grid} style={{ "--ar": job.phase === "flatten" ? job.rawW / job.rawH : job.pageW / job.pageH } as React.CSSProperties}>
        <div className="read-head">
          <h1 ref={p.headRef} tabIndex={-1}>{done ? "Here is what we found" : "Reading your letter"}</h1>
          <p className="sub" aria-live="polite">{status}{done && unmatched > 0 ? `. ${unmatched} to check.` : ""}</p>
        </div>
        <div className={`stage ${job.phase}`} ref={stage} style={{ aspectRatio: job.phase === "flatten" ? `${job.rawW} / ${job.rawH}` : `${job.pageW} / ${job.pageH}` }}>
          {job.phase === "flatten" ? (
            <>
              {job.rawUrl && <img src={job.rawUrl} alt="Your photo" />}
              {job.quad && (
                <svg viewBox={`0 0 ${job.rawW} ${job.rawH}`} preserveAspectRatio="none" aria-hidden="true">
                  <polygon className="quad" points={job.quad.map((q) => `${q.x},${q.y}`).join(" ")} />
                </svg>
              )}
            </>
          ) : (
            <>
              <img className="page" src={job.pageUrl} alt="Your letter, flattened" />
              <svg viewBox={`0 0 ${job.pageW} ${job.pageH}`} preserveAspectRatio="none" aria-hidden="true">
                {!done && job.words.map((w, i) => (
                  <rect key={i} className="wb" x={w.x0} y={w.y0} width={w.x1 - w.x0} height={w.y1 - w.y0}
                    style={{ animationDelay: `${Math.min(w.line * 40, 1400)}ms` }} />
                ))}
                {job.fields.slice(0, shown).map((f) => f.where?.rects.map((r, i) => (
                  <rect key={`${f.id}-${i}`} className={`hl ${f.id === focusId ? "on" : ""}`} x={r.x} y={r.y} width={r.w} height={r.h} rx={3} />
                )))}
              </svg>
              {job.phase === "read" && <span className="sweep" aria-hidden="true" />}
              {done && job.fields.slice(0, shown).map((f, i) => {
                const at = pinAt(f, i);
                return at ? <b key={f.id} className="pin" style={at} aria-hidden="true">{i + 1}</b> : null;
              })}
            </>
          )}
        </div>

        <div className="cardcol">
          <ol className="cards">
            {job.fields.slice(0, shown).map((f, i) => (
              <Card key={f.id} f={f} n={i + 1} active={f.id === focusId}
                refCb={(el) => { if (el) cards.current.set(f.id, el); else cards.current.delete(f.id); }}
                onPick={() => setActive(f.id)} />
            ))}
          </ol>
          {done && n === 0 && <p className="warn">Nothing readable. Try a clearer photo.</p>}
          {!job.quad && job.phase !== "flatten" && <p className="note">We could not find the page edges, so we used your photo as is.</p>}
          {done && !job.ocrOk && <p className="note">Highlights are off on this device. Check each value on your paper.</p>}
        </div>

        <div className="go">
          {done && <button type="button" className="btn big" onClick={p.onNext} disabled={shown < n}>Check the details</button>}
          {done && <p className="readby">{p.readBy}</p>}
        </div>

        {lines.length > 0 && (
          <svg className="links" width={geo?.grid.width} height={geo?.grid.height} aria-hidden="true">
            {lines.map((l) => (
              <g key={l.id} className={l.on ? "on" : ""}>
                <path d={l.d} style={{ "--len": l.len } as React.CSSProperties} />
                <circle cx={l.a.x} cy={l.a.y} r={4} />
                <circle cx={l.b.x} cy={l.b.y} r={3} />
              </g>
            ))}
          </svg>
        )}
      </div>
    </section>
  );
}

function Card(p: { f: Field; n: number; active: boolean; refCb: (el: HTMLElement | null) => void; onPick: () => void }) {
  const { f } = p;
  return (
    <li ref={p.refCb} className={`card ${f.check ? "check" : ""} ${p.active ? "on" : ""}`}>
      <button type="button" onClick={p.onPick} aria-label={`${f.label}, ${f.value}${f.check ? ". Check this on your paper" : ""}`}>
        <span className="k"><span className="num" aria-hidden="true">{p.n}</span>{f.label}</span>
        <span className="v">{f.value || "Not found"}</span>
        {f.check && <span className="flag">Check this</span>}
      </button>
    </li>
  );
}
