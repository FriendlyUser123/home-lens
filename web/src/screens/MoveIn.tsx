import { useMemo, useRef, useState } from "react";
import { RoomViewer } from "../components/RoomViewer.tsx";
import { ScanPicker } from "../components/ScanPicker.tsx";
import { TagPhoto } from "../components/TagPhoto.tsx";
import { photoDate, type RoomScan } from "../lib/match.ts";
import { buildPins, type LoadedScan } from "../lib/scan3d.ts";
import type { HeadRef } from "../types.ts";

/** The file to save: the shared schema, with the renter's confirmations. */
export function exportTags(scan: RoomScan): string {
  return JSON.stringify({
    scanId: scan.scanId, address: scan.address, capturedAt: scan.capturedAt,
    tags: scan.tags.map(({ photoName, photo, ...t }) => ({ ...t, photo: photoName ?? photo })),
  }, null, 2);
}

export function MoveIn(p: {
  headRef: HeadRef; loaded: LoadedScan | null; setLoaded: (l: LoadedScan | null) => void;
  setScan: (s: RoomScan) => void; onMoveOut: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [fly, setFly] = useState<{ id: string; n: number } | null>(null);
  const [live, setLive] = useState("");
  const rows = useRef(new Map<string, HTMLLIElement>());
  const l = p.loaded;
  const scan = l?.scan ?? null;
  const pins = useMemo(() => buildPins(scan?.tags ?? [], l?.bundle ?? null), [scan?.tags, l?.bundle]);
  const hasPin = (id: number): boolean => pins.some((x) => x.id === String(id));

  if (!l) {
    return (
      <section className="screen movein">
        <div>
          <h1 ref={p.headRef} tabIndex={-1}>Add your room scan</h1>
          <p className="sub">See your room in 3D. Confirm what was already damaged.</p>
        </div>
        <ScanPicker onLoaded={p.setLoaded} house />
      </section>
    );
  }

  function show(id: string) {
    setSelected(id);
    setFly((f) => ({ id, n: (f?.n ?? 0) + 1 }));
  }
  function pinClicked(id: string) {
    setSelected(id);
    rows.current.get(id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function update(fn: (s: RoomScan) => RoomScan) {
    if (scan) p.setScan(fn(scan));
  }
  function confirm(id: number, on: boolean) {
    update((s) => ({ ...s, tags: s.tags.map((t) => (t.id === id ? { ...t, confirmed: on } : t)) }));
    setLive(on ? `Tag ${id} confirmed` : `Tag ${id} set to not confirmed`);
  }
  function remove(id: number) {
    update((s) => ({ ...s, tags: s.tags.filter((t) => t.id !== id) }));
    setLive(`Tag ${id} removed`);
    if (selected === String(id)) setSelected(null);
  }
  function save() {
    if (!scan) return;
    const url = URL.createObjectURL(new Blob([exportTags(scan)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "room-tags.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const confirmedN = scan?.tags.filter((t) => t.confirmed).length ?? 0;
  const extraPins = pins.filter((x) => !scan?.tags.some((t) => String(t.id) === x.id));
  const what = l.cloud ? `${l.cloud.count.toLocaleString("en-US")} points` : l.bundle ? "scan bundle" : "";

  return (
    <section className="screen movein loaded">
      <div className="mi-head">
        <h1 ref={p.headRef} tabIndex={-1}>Was this already damaged?</h1>
        <p className="sub">{scan ? `${scan.address || "Your room"}: ${scan.tags.length} tag${scan.tags.length === 1 ? "" : "s"}. You decide each one.` : "Your room in 3D."}</p>
      </div>
      {(l.cloud || l.bundle) && (
        <div className="mi-view">
          <RoomViewer
            cloud={l.cloud} bundle={l.bundle} pins={pins} up={l.up} selected={selected} fly={fly} onSelect={pinClicked}
            label={`3D map of your room, ${what}, with ${pins.length} numbered pin${pins.length === 1 ? "" : "s"}`}
          />
          <p className="note">
            Drag to turn, scroll to zoom. {what}.
            {l.cloud && <> <button type="button" className="link" onClick={() => p.setLoaded({ ...l, up: l.up === "z" ? "y" : "z" })}>Room upside down? Flip it</button></>}
          </p>
          {l.notes.map((n) => <p key={n} className="note">{n}</p>)}
        </div>
      )}
      <div className="mi-list">
        {scan && scan.tags.length === 0 && <p className="warn">This scan has no tags.</p>}
        <ul className="tags">
          {scan?.tags.map((t) => (
            <li key={t.id} ref={(el) => { if (el) rows.current.set(String(t.id), el); else rows.current.delete(String(t.id)); }}
              className={`paper tagrow ${t.confirmed ? "yes" : ""} ${selected === String(t.id) ? "sel" : ""}`}>
              <TagPhoto tag={t} alt={`Move-in photo ${t.id}, ${t.room} ${t.object}`} />
              <div className="ct">
                <p className="mk">{t.confirmed ? "Confirmed" : "Not confirmed"} · #{t.id}, {photoDate(t.takenAt)}</p>
                <p className="nt">{t.room}, {t.object}: {t.note}</p>
                <div className="btns">
                  {t.confirmed
                    ? <button type="button" className="btn ghost" onClick={() => confirm(t.id, false)}>Undo<span className="sr"> tag {t.id}</span></button>
                    : <button type="button" className="btn" onClick={() => confirm(t.id, true)}>Confirm<span className="sr"> tag {t.id}</span></button>}
                  <button type="button" className="btn ghost" onClick={() => remove(t.id)}>Remove<span className="sr"> tag {t.id}</span></button>
                  {hasPin(t.id) && <button type="button" className="btn ghost" onClick={() => show(String(t.id))}>Show in room<span className="sr"> tag {t.id}</span></button>}
                </div>
              </div>
            </li>
          ))}
          {extraPins.map((x) => (
            <li key={x.id} className="paper tagrow"><div className="ct"><p className="mk">Pin {x.label}</p><p className="nt">From the scan bundle, no photo.</p>
              <div className="btns"><button type="button" className="btn ghost" onClick={() => show(x.id)}>Show in room</button></div></div></li>
          ))}
        </ul>
        <p className="sr" aria-live="polite">{live}</p>
        <div className="go">
          {scan && <button type="button" className="btn big" onClick={p.onMoveOut}>{confirmedN > 0 ? `Done: ${confirmedN} confirmed` : "Done"}</button>}
          {scan && <button type="button" className="btn ghost" onClick={save}>Download room-tags.json</button>}
          <button type="button" className="link" onClick={() => p.setLoaded(null)}>Use different files</button>
        </div>
      </div>
    </section>
  );
}
