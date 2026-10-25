import { CHIP_LABEL, CHIP_WHY, computeClock, extraInQuote, fmtLong, fmtShort, isLate, money, weekday, type Charge } from "../lib/rules.ts";
import type { Candidate } from "../lib/match.ts";
import type { HeadRef } from "../types.ts";

export function Result(p: {
  headRef: HeadRef; clock: ReturnType<typeof computeClock>; charges: Charge[]; letterDay: number | null;
  hasLetter: boolean; readBy: string; possible: number; confirmed: Candidate[]; hasScan: boolean;
  onPhotos: () => void; onLetter: () => void;
}) {
  const { clock } = p;
  const s = fmtShort(clock.deadline);
  const late = isLate(p.letterDay, clock);
  const lateBy = p.letterDay === null ? 0 : p.letterDay - clock.deadline;
  const status =
    clock.state === "open" ? `${clock.daysLeft} day${clock.daysLeft === 1 ? "" : "s"} left`
    : clock.state === "today" ? "Last day is today"
    : `Passed ${-clock.daysLeft} day${clock.daysLeft === -1 ? "" : "s"} ago`;
  const total = p.charges.reduce((a, c) => a + c.amount, 0);
  const proven = new Set(p.confirmed.map((c) => c.chargeId));

  return (
    <section className="screen result">
      <div className="left">
        <div className="clk">
          <h1 ref={p.headRef} tabIndex={-1}>Your landlord must answer by</h1>
          <div className={`frame ${clock.state === "passed" ? "red" : ""}`} role="img" aria-label={`${weekday(clock.deadline)}, ${fmtLong(clock.deadline)}`}>
            <span className="m">{s.mon}</span>
            <span className="d">{s.d}</span>
            <span className="y">{s.year}</span>
            <i /><i /><i /><i />
          </div>
          <p className="status" aria-live="polite">{status}</p>
          {late && <p className="latenote">Dated {fmtLong(p.letterDay as number)}. That is {lateBy} day{lateBy === 1 ? "" : "s"} late.</p>}
          {!p.hasLetter && clock.state === "passed" && <p className="latenote">Nothing arrived? Ask for it in writing.</p>}
          <details className="why">
            <summary>Why this date?</summary>
            <p>45 days after the later of your lease end or move-out ({fmtLong(clock.start)}). Day 1 is the next day.</p>
            <p className="cite">Va. Code § 55.1-1226(A); § 1-210(A)</p>
            <p>If the damage needs a contractor and the landlord says so in writing within 45 days, they get 15 more days: until {fmtLong(clock.extendedDeadline)}.</p>
            <p className="cite">Va. Code § 55.1-1226(E)</p>
            <p>You can ask to attend the move-out inspection.</p>
            <p className="cite">Va. Code § 55.1-1226(G)</p>
          </details>
        </div>
        <div className="go">
          <button type="button" className="btn big" onClick={p.onLetter}>Get my letter</button>
          <button type="button" className="btn ghost big" onClick={p.onPhotos}>
            {p.confirmed.length > 0 ? `Photos matched: ${p.confirmed.length}` : p.hasScan && p.possible > 0 ? `Check ${p.possible} photo match${p.possible === 1 ? "" : "es"}` : "Match move-in photos"}
          </button>
          <p className="readby">{p.readBy}</p>
        </div>
      </div>
      {p.hasLetter && p.charges.length > 0 && (
        <div className="paper charges">
          <h2>{p.charges.length} charge{p.charges.length === 1 ? "" : "s"}, {money(total)}</h2>
          <ul>
            {p.charges.map((c) => (
              <li key={c.id}>
                <div className="cl">
                  <span className="d">{c.description}</span>
                  <span className="a">{money(c.amount)}</span>
                </div>
                <div className="flagrow">
                  <span className={`chip ${c.chip}`}>{CHIP_LABEL[c.chip]}</span>
                  {proven.has(c.id) && <span className="chip proven">Photo from move-in</span>}
                  {(c.chip !== "none" || extraInQuote(c)) && (
                    <details className="why sm"><summary>Why?</summary>
                      {extraInQuote(c) && <p>On your paper: <q className="quote">{c.quote}</q></p>}
                      {c.chip !== "none" && <><p>{CHIP_WHY[c.chip].text}</p><p className="cite">{CHIP_WHY[c.chip].cite}</p></>}
                    </details>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="tip">A flag is a question to ask, not a ruling.</p>
        </div>
      )}
    </section>
  );
}
