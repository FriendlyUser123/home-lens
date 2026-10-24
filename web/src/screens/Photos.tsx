import { useRef, useState } from "react";
import { TagPhoto } from "../components/TagPhoto.tsx";
import { decisionKey, parseRoomScan, photoDate, type Candidate, type Decisions, type RoomScan } from "../lib/match.ts";
import { money, type Charge } from "../lib/rules.ts";
import type { HeadRef } from "../types.ts";

export function Photos(p: {
  headRef: HeadRef; scan: RoomScan | null; setScan: (s: RoomScan | null) => void; charges: Charge[];
  candidates: Candidate[]; decisions: Decisions; decide: (c: Candidate, d: "yes" | "no" | null) => void;
  onSampleScan: () => Promise<void>; onNext: () => void;
}) {
  const [err, setErr] = useState("");
  const [live, setLive] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function load(f: File | undefined) {
    if (!f) return;
    setErr("");
    try {
      p.setScan(parseRoomScan(JSON.parse(await f.text())));
    } catch (e) {
      setErr(e instanceof SyntaxError ? "That file is not JSON." : e instanceof Error ? e.message : "Could not read that file.");
    }
  }

  const confirmedN = p.candidates.filter((c) => p.decisions[decisionKey(c)] === "yes").length;
  const withCands = p.charges.filter((c) => p.candidates.some((x) => x.chargeId === c.id));
  const without = p.charges.filter((c) => !withCands.includes(c));

  if (!p.scan) {
    return (
      <section className="screen photos">
        <div>
          <h1 ref={p.headRef} tabIndex={-1}>Add your move-in scan</h1>
          <p className="sub">We match each charge to your photos.</p>
        </div>
        <div className="paper loader">
          <label className="btn big filebtn">
            Choose room-tags.json
            <input ref={input} type="file" accept="application/json,.json" onChange={(e) => void load(e.target.files?.[0])} />
          </label>
          <button type="button" className="btn ghost big" onClick={() => void p.onSampleScan()}>Use the sample scan</button>
          {err && <p className="err" role="alert">{err}</p>}
          <p className="priv">The file stays in your browser.</p>
        </div>
        <button type="button" className="btn ghost" onClick={p.onNext}>Skip, go to my letter</button>
      </section>
    );
  }

  return (
    <section className="screen photos">
      <div>
        <h1 ref={p.headRef} tabIndex={-1}>Do these photos match?</h1>
        <p className="sub">{p.scan.address}: {p.scan.tags.length} photo{p.scan.tags.length === 1 ? "" : "s"}. You decide each one.</p>
      </div>
      <p className="sr" aria-live="polite">{live}</p>
      {withCands.length === 0 && <p className="warn">No charge looks like a tagged spot.</p>}
      <ul className="matches">
        {withCands.map((c) => (
          <li key={c.id} className="paper match">
            <div className="cl"><span className="d">{c.description}</span><span className="a">{money(c.amount)}</span></div>
            <ul>
              {p.candidates.filter((x) => x.chargeId === c.id).map((x) => {
                const tag = p.scan?.tags.find((t) => t.id === x.tagId);
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
                        {d === undefined ? (
                          <>
                            <button type="button" className="btn" onClick={() => { p.decide(x, "yes"); setLive(`Confirmed photo ${tag.id} for ${c.description}`); }}>
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
        <button type="button" className="link" onClick={() => p.setScan(null)}>Use a different scan</button>
      </div>
    </section>
  );
}
