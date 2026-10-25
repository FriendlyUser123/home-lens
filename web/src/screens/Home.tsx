import { useEffect, useMemo, useState } from "react";
import { RoomViewer } from "../components/RoomViewer.tsx";
import { loadDemoScan } from "../lib/demo.ts";
import { buildPins, type LoadedScan } from "../lib/scan3d.ts";
import type { HeadRef } from "../types.ts";

const PATHS = [
  { id: "movein", title: "Move in", line: "Scan the room. Log old damage." },
  { id: "report", title: "Report a problem", line: "Photo in, repair notice out." },
  { id: "moveout", title: "Move out", line: "Check deposit charges against your photos." },
] as const;

export type Path = (typeof PATHS)[number]["id"];

export function Home(p: { headRef: HeadRef; privacy: string; onPick: (p: Path) => void }) {
  const [demo, setDemo] = useState<LoadedScan | null>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const l = await loadDemoScan();
        if (live) setDemo(l);
      } catch { /* hero stays a blank sheet */ }
    })();
    return () => { live = false; };
  }, []);
  const tags = demo?.scan?.tags ?? [];
  const pins = useMemo(() => buildPins(tags, demo?.bundle ?? null), [tags, demo?.bundle]);

  return (
    <section className="screen home bp">
      <div className="bp-sheet">
        <header className="bp-head">
          <h1 ref={p.headRef} tabIndex={-1}>Home Lens</h1>
          <p className="sub">Survey your rental. Keep your deposit.</p>
        </header>
        <figure className="bp-room">
          <div className="bp-canvas">
            {demo && (
              <RoomViewer cloud={demo.cloud} bundle={demo.bundle} pins={pins} up={demo.up} selected={null} fly={null}
                onSelect={() => {}} label={`Sample room scan with ${pins.length} damage markers`} autoRotate dropPins bare />
            )}
            <span className="dim dim-x" aria-hidden="true"><b>W</b></span>
            <span className="dim dim-y" aria-hidden="true"><b>H</b></span>
          </div>
          <figcaption>
            <ol className="callouts">
              {tags.slice(0, 4).map((t, i) => (
                <li key={t.id} style={{ ["--i" as string]: i }}>
                  <span className="pin-n">{t.id}</span>
                  <span>{t.object}</span>
                </li>
              ))}
            </ol>
          </figcaption>
        </figure>
        <dl className="titleblock" aria-hidden="true">
          <div><dt>Sheet</dt><dd>A-101</dd></div>
          <div><dt>Markers</dt><dd>{tags.length || "–"}</dd></div>
          <div><dt>Survey</dt><dd>Move-in</dd></div>
        </dl>
      </div>
      <nav aria-label="Choose a task">
        <ul className="paths">
          {PATHS.map((x, i) => (
            <li key={x.id}>
              <button type="button" onClick={() => p.onPick(x.id)}>
                <span className="n" aria-hidden="true">0{i + 1}</span>
                <span className="t">{x.title}</span>
                <span className="l">{x.line}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="priv">{p.privacy}</p>
      </nav>
    </section>
  );
}
