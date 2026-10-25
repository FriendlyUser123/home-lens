import { TagPhoto } from "../components/TagPhoto.tsx";
import { photoDate, type Candidate, type RoomScan } from "../lib/match.ts";
import { fmtLong, money, type Charge } from "../lib/rules.ts";
import type { HeadRef } from "../types.ts";

export function Evidence(p: { headRef: HeadRef; scan: RoomScan; charges: Charge[]; confirmed: Candidate[]; today: number; onBack: () => void }) {
  return (
    <section className="screen evidence">
      <div className="noprint">
        <h1 ref={p.headRef} tabIndex={-1}>Your evidence sheet</h1>
        <p className="sub">Print it and attach it to your letter.</p>
        <div className="btns">
          <button type="button" className="btn" onClick={() => window.print()}>Print</button>
          <button type="button" className="btn ghost" onClick={p.onBack}>Back</button>
        </div>
      </div>
      <div className="evsheet">
        <header>
          <h2>Move-in evidence</h2>
          <p>{p.scan.address}. Scan taken {photoDate(p.scan.capturedAt, true)}. Printed {fmtLong(p.today)}.</p>
        </header>
        {p.confirmed.map((m) => {
          const tag = p.scan.tags.find((t) => t.id === m.tagId);
          const ch = p.charges.find((c) => c.id === m.chargeId);
          if (!tag || !ch) return null;
          return (
            <figure key={`${m.chargeId}-${m.tagId}`} className="exhibit">
              <TagPhoto tag={tag} alt={`Photo ${tag.id}: ${tag.room} ${tag.object}, ${tag.note}`} />
              <figcaption>
                <b>Photo #{tag.id} · {photoDate(tag.takenAt, true)}</b>
                <span>{tag.room}, {tag.object}: {tag.note}</span>
                <span>Charged: {ch.description} {money(ch.amount)}</span>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </section>
  );
}
