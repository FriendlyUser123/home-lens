import { useEffect, useMemo, useState } from "react";
import { RoomViewer } from "../components/RoomViewer.tsx";
import { ScanPicker } from "../components/ScanPicker.tsx";
import { TagPhoto } from "../components/TagPhoto.tsx";
import { decisionKey, photoDate, type Candidate, type Decisions } from "../lib/match.ts";
import { money, type Charge } from "../lib/rules.ts";
import { buildPins, type LoadedScan } from "../lib/scan3d.ts";
import type { HeadRef } from "../types.ts";

export function Photos(p: {
  headRef: HeadRef; loaded: LoadedScan | null; setLoaded: (l: LoadedScan | null) => void; charges: Charge[];
  candidates: Candidate[]; decisions: Decisions; decide: (c: Candidate, d: "yes" | "no" | null) => void;
  onMoveIn: () => void; onNext: () => void;
}) {
  const [live, setLive] = useState("");
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const scan = p.loaded?.scan ?? null;
  const pins = useMemo(() => buildPins(scan?.tags ?? [], p.loaded?.bundle ?? null), [scan?.tags, p.loaded?.bundle]);
  const has3d = !!(p.loaded?.cloud || p.loaded?.bundle) && pins.length > 0;

  /** A charge matched to a tag: the 3D view flies to that tag's pin. */
  function flyTo(tagId: number) {
    const id = String(tagId);
    if (pins.some((x) => x.id === id)) setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }));
  }
  const first = p.candidates[0]?.tagId;
  useEffect(() => {
    if (first !== undefined && has3d) flyTo(first);
  }, [first, has3d, p.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmedN = p.candidates.filter((c) => p.decisions[decisionKey(c)] === "yes").length;
  const withCands = p.charges.filter((c) => p.candidates.some((x) => x.chargeId === c.id));
  const without = p.charges.filter((c) => !withCands.includes(c));

  if (!scan) {
    return (
      <section className="screen photos">
        <div>
          <h1 ref={p.headRef} tabIndex={-1}>Add your move-in scan</h1>
          <p className="sub">We match each charge to your photos.</p>
        </div>
        <ScanPicker onLoaded={p.setLoaded} />
        <button type="button" className="btn ghost" onClick={p.onNext}>Skip, go to my letter</button>
      </section>
    );
  }

  const unconfirmed = scan.tags.filter((t) => !t.confirmed).length;
  const focusTag = focus ? scan.tags.find((t) => String(t.id) === focus.id) : undefined;

  return (
    <section className={`screen photos ${has3d ? "has3d" : ""}`}>
      <div className="ph-head">
        <h1 ref={p.headRef} tabIndex={-1}>Do these photos match?</h1>
        <p className="sub">{scan.address}: {scan.tags.length} photo{scan.tags.length === 1 ? "" : "s"}. You decide each one.</p>
      </div>
      {has3d && p.loaded && (
        <div className="ph-view">
          <RoomViewer
            cloud={p.loaded.cloud} bundle={p.loaded.bundle} pins={pins} up={p.loaded.up} selected={focus?.id ?? null} fly={focus}
            onSelect={(id) => setFocus((f) => ({ id, n: (f?.n ?? 0) + 1 }))}
            label="3D map of your room. The view flies to the pin of the photo you are checking."
          />
          <p className="note" aria-live="polite">{focusTag ? `Showing photo #${focusTag.id}: ${focusTag.room}, ${focusTag.object}.` : "Drag to turn the room."}</p>
        </div>
      )}
      <div className="ph-list">
      {unconfirmed > 0 && (
        <p className="warn">{unconfirmed} tag{unconfirmed === 1 ? " is" : "s are"} not confirmed, so {unconfirmed === 1 ? "it is" : "they are"} not matched. <button type="button" className="link" onClick={p.onMoveIn}>Review in Move in</button></p>
      )}
      <p className="sr" aria-live="polite">{live}</p>
      {withCands.length === 0 && <p className="warn">No charge looks like a tagged spot.</p>}
      <ul className="matches">
        {withCands.map((c) => (
          <li key={c.id} className="paper match">
            <div className="cl"><span className="d">{c.description}</span><span className="a">{money(c.amount)}</span></div>
            <ul>
              {p.candidates.filter((x) => x.chargeId === c.id).map((x) => {
                const tag = scan.tags.find((t) => t.id === x.tagId);
                if (!tag) return null;
                const d = p.decisions[decisionKey(x)];
                const date = photoDate(tag.takenAt);
                return (
                  <li key={x.tagId} className={`cand ${d ?? ""}`}>
                    <TagPhoto tag={tag} alt={`Move-in photo ${tag.id}, ${tag.room} ${tag.object}`} />
                    <div className="ct">
                      <p className="mk">{d === "yes" ? "Confirmed" : d === "no" ? "Not this one" : "Possible match"} · photo #{tag.id}, {date}{d === undefined ? " · confirm" : ""}</p>
                      <p className="nt">{tag.room}, {tag.object}: {tag.note}</p>
                      <details className="why sm"><summary>Why?</summary>
                        <p>Both mention {x.shared.join(", ")}. A match is only a guess until you confirm it.</p>
                      </details>
                      <div className="btns">
                        {has3d && pins.some((x) => x.id === String(tag.id)) && (
                          <button type="button" className="btn ghost" onClick={() => flyTo(tag.id)}>Show in room<span className="sr"> photo {tag.id}</span></button>
                        )}
                        {d === undefined ? (
                          <>
                            <button type="button" className="btn" onClick={() => { p.decide(x, "yes"); flyTo(tag.id); setLive(`Confirmed photo ${tag.id} for ${c.description}`); }}>
                              Confirm<span className="sr"> photo {tag.id} for {c.description}</span>
                            </button>
                            <button type="button" className="btn ghost" onClick={() => { p.decide(x, "no"); setLive(`Rejected photo ${tag.id}`); }}>
                              Not this one<span className="sr"> photo {tag.id}</span>
                            </button>
                          </>
                        ) : (
                          <button type="button" className="link" onClick={() => p.decide(x, null)}>Undo<span className="sr"> photo {tag.id}</span></button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
      {without.length > 0 && (
        <p className="nomatch">No photo for: {without.map((c) => c.description.split(/[,(]/)[0]?.trim()).join(", ")}.</p>
      )}
      <div className="go">
        <button type="button" className="btn big" onClick={p.onNext}>Get my letter{confirmedN > 0 ? ` with ${confirmedN} photo${confirmedN === 1 ? "" : "s"}` : ""}</button>
        <button type="button" className="link" onClick={() => p.setLoaded(null)}>Use a different scan</button>
      </div>
      </div>
    </section>
  );
}
