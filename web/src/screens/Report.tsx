import { useMemo, useState } from "react";
import { nameIssue } from "../api.ts";
import { loadImage } from "../lib/hooks.ts";
import { buildNotice, REPAIR_CITE, REPAIR_DAYS, repairClock } from "../lib/repair.ts";
import { fmtLong, fmtShort } from "../lib/rules.ts";
import type { HeadRef } from "../types.ts";

const ROOMS = ["", "bedroom", "bathroom", "kitchen", "living room", "hallway", "closet", "other"];
const SAMPLE = "/samples/room-bedroom-blinds.png";

/** Downsizes to 1280 px and returns a JPEG data URL, so uploads stay small. */
async function shrink(img: HTMLImageElement): Promise<string> {
  const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

export function Report(p: { headRef: HeadRef; today: number; readBy: (model?: string) => string }) {
  const [photo, setPhoto] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [by, setBy] = useState("");
  const [issue, setIssue] = useState("");
  const [room, setRoom] = useState("");
  const [desc, setDesc] = useState("");
  const [tenant, setTenant] = useState("");
  const [landlord, setLandlord] = useState("");
  const [address, setAddress] = useState("");
  const [started, setStarted] = useState(false);
  const [copied, setCopied] = useState(false);

  async function take(src: Blob | string) {
    setErr("");
    setBusy(true);
    setStarted(true);
    try {
      const url = await shrink(await loadImage(src));
      setPhoto(url);
      const r = await nameIssue(url);
      setIssue(r.issue);
      setRoom(r.room);
      setDesc(r.description);
      setBy(r.mocked ? "Demo data. The model was not run." : `Named by Gemma 4 (${r.model}). Check it and fix anything wrong.`);
      if (!r.issue) setErr("We could not see a problem in that photo. Describe it below.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not read the photo. Describe the problem below.");
    } finally {
      setBusy(false);
    }
  }

  const notice = useMemo(
    () => buildNotice({ issue, description: desc, room, date: p.today, tenant, landlord, address, photo: photo !== "" }),
    [issue, desc, room, p.today, tenant, landlord, address, photo],
  );
  const clock = repairClock(p.today, p.today);
  const s = fmtShort(clock.deadline);

  async function copy() {
    try {
      await navigator.clipboard.writeText(notice);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  if (!started) {
    return (
      <section className="screen report">
        <div>
          <h1 ref={p.headRef} tabIndex={-1}>What is wrong?</h1>
          <p className="sub">Take a photo. We name the problem and write your notice.</p>
        </div>
        <div className="paper loader">
          <label className="btn big filebtn">
            Take or choose a photo
            <input type="file" accept="image/*" capture="environment" onChange={(e) => { const f = e.target.files?.[0]; if (f) void take(f); }} />
          </label>
          <button type="button" className="btn ghost big" onClick={() => void take(SAMPLE)}>Use a sample photo</button>
          <button type="button" className="link" onClick={() => setStarted(true)}>Skip the photo</button>
          <p className="priv">{p.readBy()}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="screen letter report">
      <div className="lcol noprint">
        <h1 ref={p.headRef} tabIndex={-1}>Your repair notice</h1>
        {photo && <img className="reportphoto" src={photo} alt="The problem you photographed" />}
        {busy && <p className="note" aria-live="polite">Gemma is looking at the photo.</p>}
        {err && <p className="err" role="alert">{err}</p>}
        {by && <p className="readby">{by}</p>}
        <div className="form plain">
          <label><span>What is wrong</span><input value={issue} onChange={(e) => setIssue(e.target.value)} /></label>
          <label><span>Room</span>
            <select value={room} onChange={(e) => setRoom(e.target.value)}>
              {ROOMS.map((r) => <option key={r} value={r}>{r === "" ? "Not sure" : r}</option>)}
            </select>
          </label>
          <label><span>What you see <em>(when it started, where)</em></span><textarea value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
          <label><span>Your name</span><input autoComplete="name" value={tenant} onChange={(e) => setTenant(e.target.value)} /></label>
          <label><span>Landlord</span><input value={landlord} onChange={(e) => setLandlord(e.target.value)} /></label>
          <label><span>Unit address</span><input autoComplete="street-address" value={address} onChange={(e) => setAddress(e.target.value)} /></label>
        </div>
        <div className="btns">
          <button type="button" className="btn" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
          <button type="button" className="btn ghost" onClick={() => window.print()}>Print</button>
        </div>
        <p className="sr" aria-live="polite">{copied ? "Notice copied" : ""}</p>
      </div>
      <div className="rcol">
        <div className="clk">
          <h2>Repair window: {REPAIR_DAYS} days from the day you send it</h2>
          <div className="frame" role="img" aria-label={`If sent today, ${fmtLong(clock.deadline)}`}>
            <span className="m">{s.mon}</span><span className="d">{s.d}</span><span className="y">{s.year}</span>
            <i /><i /><i /><i />
          </div>
          <details className="why">
            <summary>Why 14 days?</summary>
            <p>The notice asks for a repair within {REPAIR_DAYS} days. The clock starts the day it is sent, so send it today.</p>
            <p className="cite">{REPAIR_CITE}</p>
          </details>
        </div>
        <pre className="paper sheet" aria-label="Repair notice text">{notice}</pre>
        {photo && <img className="reportphoto print-only" src={photo} alt="Attached photo" />}
      </div>
    </section>
  );
}
