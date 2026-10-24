import { useState } from "react";
import { buildLetter, type Charge, type Clock, type Evidence } from "../lib/rules.ts";
import type { HeadRef } from "../types.ts";

export function LetterScreen(p: {
  headRef: HeadRef; clock: Clock; moveOutDay: number; today: number; charges: Charge[];
  letterDay: number | null; hasLetter: boolean; landlord: string; deposit: number | null; evidence: Evidence[];
  onBack: () => void; onEvidence: (() => void) | null;
}) {
  const [name, setName] = useState("");
  const [addr, setAddr] = useState("");
  const [to, setTo] = useState(p.landlord);
  const [copied, setCopied] = useState(false);
  const text = buildLetter({
    tenantName: name, forwardingAddress: addr, landlordName: to, moveOut: p.moveOutDay, clock: p.clock, today: p.today,
    charges: p.charges, letterDay: p.letterDay, hasLetter: p.hasLetter, depositAmount: p.deposit, evidence: p.evidence,
  });
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <section className="screen letter">
      <div className="lcol noprint">
        <h1 ref={p.headRef} tabIndex={-1}>Your letter is ready</h1>
        <p className="sub">Add your details. They stay in this page.</p>
        <div className="form plain">
          <label><span>Your name</span><input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label><span>Forwarding address</span><input autoComplete="street-address" value={addr} onChange={(e) => setAddr(e.target.value)} /></label>
          <label><span>Landlord</span><input value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <div className="btns">
          <button type="button" className="btn" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
          <button type="button" className="btn ghost" onClick={() => window.print()}>Print</button>
          {p.onEvidence && <button type="button" className="btn ghost" onClick={p.onEvidence}>Evidence sheet</button>}
          <button type="button" className="btn ghost" onClick={p.onBack}>Back</button>
        </div>
        {p.evidence.length > 0 && <p className="priv">{p.evidence.length} photo{p.evidence.length === 1 ? "" : "s"} cited. Print the evidence sheet and attach it.</p>}
        <p className="sr" aria-live="polite">{copied ? "Letter copied" : ""}</p>
      </div>
      <div className="rcol">
        <pre className="paper sheet" aria-label="Letter text">{text}</pre>
        <div className="help noprint">
          <h2>Need help?</h2>
          <div className="helpgrid">
            <div>
              <h3>Virginia Tech students</h3>
              <p>Student Legal Services. Free.</p>
              <p><a href="tel:+15402314720">540-231-4720</a></p>
              <p><a href="https://legal.uss.vt.edu/">legal.uss.vt.edu</a></p>
            </div>
            <div>
              <h3>Everyone else, if low income</h3>
              <p>Southwest Virginia Legal Aid Society. Free. Serves Montgomery County.</p>
              <p><a href="tel:+18882012772">1-888-201-2772</a> (intake)</p>
              <p><a href="https://www.svlas.org/housing/">svlas.org/housing</a></p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
