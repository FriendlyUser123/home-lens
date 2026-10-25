import { useState } from "react";
import type { Reading } from "../lib/fields.ts";
import { CATEGORIES, chipFor, money, parseISO, quoteHasAmount, type Category, type Charge } from "../lib/rules.ts";
import type { HeadRef } from "../types.ts";

export const CAT_LABEL: Record<Category, string> = {
  cleaning: "Cleaning",
  carpet_flooring: "Carpet or floors",
  paint_walls: "Paint or walls",
  damage_repair: "Other damage",
  unpaid_rent: "Unpaid rent",
  late_fee: "Late fee",
  utilities: "Utilities",
  maintenance_fee: "Maintenance fee",
  other_fee: "Other fee",
  other: "Other",
};

export function Confirm(p: {
  headRef: HeadRef; reading: Reading; flagged: Set<string>;
  letterDate: string; setLetterDate: (v: string) => void;
  deposit: string; setDeposit: (v: string) => void;
  moveOut: string; setMoveOut: (v: string) => void;
  leaseEnd: string; setLeaseEnd: (v: string) => void;
  charges: Charge[]; setCharges: (c: Charge[]) => void;
  onOk: () => void; readBy: string;
}) {
  const needMove = parseISO(p.moveOut) === null;
  const [open, setOpen] = useState<string | null>(needMove ? "moveOut" : null);
  const toggle = (id: string) => setOpen(open === id ? null : id);
  const upd = (id: string, patch: Partial<Charge>) =>
    p.setCharges(p.charges.map((c) => {
      if (c.id !== id) return c;
      const n = { ...c, ...patch };
      if (patch.category) n.chip = chipFor(patch.category);
      n.check = !quoteHasAmount(n.quote, n.amount);
      return n;
    }));

  return (
    <section className="screen confirm">
      <div>
        <h1 ref={p.headRef} tabIndex={-1}>Does this match your paper?</h1>
        <p className="sub">Tap a row to fix it.</p>
      </div>
      <div className="paper">
        <ul className="rows">
          <Row id="letterDate" open={open} toggle={toggle} label="Letter date" value={p.letterDate || "Not found"} check={p.flagged.has("letterDate")}>
            <label><span>Letter date</span><input type="date" value={p.letterDate} onChange={(e) => p.setLetterDate(e.target.value)} /></label>
          </Row>
          <Row id="deposit" open={open} toggle={toggle} label="Deposit held" value={p.deposit ? money(Number(p.deposit)) : "Not found"} check={p.flagged.has("deposit")}>
            <label><span>Deposit held ($)</span><input inputMode="decimal" value={p.deposit} onChange={(e) => p.setDeposit(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
          </Row>
          <Row id="moveOut" open={open} toggle={toggle} label="Move-out date" value={p.moveOut || "Needed"} check={needMove || p.flagged.has("moveOut")}>
            <label><span>Move-out date</span><input type="date" required value={p.moveOut} onChange={(e) => p.setMoveOut(e.target.value)} /></label>
          </Row>
          <Row id="leaseEnd" open={open} toggle={toggle} label="Lease ended" value={p.leaseEnd || "Same day"} check={false}>
            <label><span>Lease end date <em>(only if later)</em></span><input type="date" value={p.leaseEnd} onChange={(e) => p.setLeaseEnd(e.target.value)} /></label>
          </Row>
        </ul>
        <h2 className="rows-h">{p.charges.length} charge{p.charges.length === 1 ? "" : "s"}</h2>
        <ul className="rows">
          {p.charges.map((c) => (
            <Row key={c.id} id={c.id} open={open} toggle={toggle} label={c.description} value={money(c.amount)} sub={CAT_LABEL[c.category]} check={c.check || p.flagged.has(c.id)}>
              <label><span>Charge</span>
                <textarea rows={2} value={c.description} onChange={(e) => upd(c.id, { description: e.target.value })} />
              </label>
              <div className="r1">
                <label className="amt"><span>Amount ($)</span>
                  <input inputMode="decimal" value={c.amount} onChange={(e) => upd(c.id, { amount: Number(e.target.value.replace(/[^0-9.]/g, "")) || 0 })} />
                </label>
                <label className="grow"><span>Kind of charge</span>
                  <select value={c.category} onChange={(e) => upd(c.id, { category: e.target.value as Category })}>
                    {CATEGORIES.map((k) => <option key={k} value={k}>{CAT_LABEL[k]}</option>)}
                  </select>
                </label>
              </div>
              {c.quote && <p className="onpaper">On your paper: <q>{c.quote}</q></p>}
              <button type="button" className="link" onClick={() => { p.setCharges(p.charges.filter((x) => x.id !== c.id)); setOpen(null); }}>
                Remove this charge
              </button>
            </Row>
          ))}
        </ul>
        {p.charges.length === 0 && <p className="warn">No charges found. You can still continue.</p>}
        <button type="button" className="btn big" onClick={p.onOk} disabled={needMove}>Looks right</button>
        <p className="readby">{p.readBy}</p>
      </div>
    </section>
  );
}

function Row(p: { id: string; open: string | null; toggle: (id: string) => void; label: string; value: string; sub?: string; check: boolean; children: React.ReactNode }) {
  const isOpen = p.open === p.id;
  return (
    <li className={`row ${p.check ? "check" : ""} ${isOpen ? "open" : ""}`}>
      <button type="button" className="rowhead" aria-expanded={isOpen} aria-controls={`edit-${p.id}`} onClick={() => p.toggle(p.id)}>
        <span className="rl">
          <span className="rt">{p.label}</span>
          {p.sub && <span className="rs">{p.sub}</span>}
        </span>
        <span className="rv">{p.value}</span>
        {p.check && <span className="flag">Check this</span>}
        <span className="edit" aria-hidden="true">{isOpen ? "Done" : "Edit"}</span>
      </button>
      {isOpen && <div className="edit-box" id={`edit-${p.id}`}>{p.children}</div>}
    </li>
  );
}
