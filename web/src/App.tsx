import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { health, readLetter, type Health } from "./api.ts";
import { Camera } from "./components/Camera.tsx";
import { buildFields, type Reading as ReadingData } from "./lib/fields.ts";
import { loadImage, sleep } from "./lib/hooks.ts";
import { recognizeWords } from "./lib/ocr.ts";
import type { Quad } from "./lib/quad.ts";
import { scanPhoto } from "./lib/scan.ts";
import {
  confirmedMatches, decisionKey, matchCharges, parseRoomScan, toEvidence,
  type Candidate, type Decisions, type RoomScan,
} from "./lib/match.ts";
import { computeClock, parseISO, todayLocal, type Charge } from "./lib/rules.ts";
import { Confirm } from "./screens/Confirm.tsx";
import { Evidence } from "./screens/Evidence.tsx";
import { LetterScreen } from "./screens/LetterScreen.tsx";
import { Photos } from "./screens/Photos.tsx";
import { Reading } from "./screens/Reading.tsx";
import { Result } from "./screens/Result.tsx";
import { Start } from "./screens/Start.tsx";
import type { Job, Sample, Step } from "./types.ts";

const TODAY_OVERRIDE = new URLSearchParams(window.location.search).get("today");
const EMPTY_JOB: Job = { phase: "flatten", rawUrl: "", rawW: 1, rawH: 1, quad: null, pageUrl: "", pageW: 1, pageH: 1, fields: [], words: [], ocrOk: true };

export function App() {
  const [step, setStep] = useState<Step>("start");
  const [moveOut, setMoveOut] = useState("");
  const [leaseEnd, setLeaseEnd] = useState("");
  const [reading, setReading] = useState<ReadingData | null>(null);
  const [job, setJob] = useState<Job>(EMPTY_JOB);
  const [letterDate, setLetterDate] = useState("");
  const [deposit, setDeposit] = useState("");
  const [landlord, setLandlord] = useState("");
  const [charges, setCharges] = useState<Charge[]>([]);
  const [error, setError] = useState("");
  const [info, setInfo] = useState<Health | null>(null);
  const [scan, setScan] = useState<RoomScan | null>(null);
  const [decisions, setDecisions] = useState<Decisions>({});
  const headRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    void (async () => setInfo(await health()))();
  }, []);
  useEffect(() => {
    headRef.current?.focus();
    window.scrollTo(0, 0);
  }, [step]);

  const today = todayLocal(TODAY_OVERRIDE);
  const moveOutDay = parseISO(moveOut);
  const leaseDay = parseISO(leaseEnd);
  const clock = useMemo(
    () => (moveOutDay === null ? null : computeClock(moveOutDay, leaseDay, today)),
    [moveOutDay, leaseDay, today],
  );

  const candidates: Candidate[] = useMemo(
    () => (scan ? matchCharges(charges.map((c) => ({ id: c.id, description: c.description, quote: c.quote, category: c.category })), scan.tags) : []),
    [scan, charges],
  );
  const confirmed = useMemo(() => confirmedMatches(candidates, decisions), [candidates, decisions]);
  const evidence = useMemo(() => (scan ? toEvidence(confirmed, scan.tags) : []), [confirmed, scan]);

  const privacy = !info
    ? "Nothing is saved."
    : info.provider === "ollama"
      ? "Your photo is read on this device. Nothing is saved."
      : info.provider === "gemini"
        ? "Your photo goes to Google's Gemma API. Nothing is saved here."
        : "Demo mode: no photo is read. Nothing is saved.";
  const readBy = reading?.mocked ? "Demo data. The model was not run." : reading ? `Read by Gemma 4 (${reading.model}).` : "";

  const process = useCallback(async (source: HTMLCanvasElement | HTMLImageElement, hint: Quad | null, mo: string) => {
    setError("");
    setStep("reading");
    setJob(EMPTY_JOB);
    try {
      const s = await scanPhoto(source, hint);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const jpeg = s.page.toDataURL("image/jpeg", 0.9);
      setJob({ ...EMPTY_JOB, phase: "flatten", rawUrl: s.raw.toDataURL("image/jpeg", 0.7), rawW: s.raw.width, rawH: s.raw.height, quad: s.quad, pageUrl: jpeg, pageW: s.page.width, pageH: s.page.height });
      const apiP = readLetter(jpeg, "image/jpeg");
      const ocrP = recognizeWords(s.page);
      // Show word boxes as soon as OCR is done, while the model is still reading.
      void ocrP.then((words) => setJob((j) => ({ ...j, words }))).catch(() => undefined);
      await sleep(s.quad && !reduced ? 1300 : 250);
      setJob((j) => ({ ...j, phase: "read" }));
      const [api, ocr] = await Promise.allSettled([apiP, ocrP]);
      if (api.status === "rejected") throw api.reason;
      const r = api.value;
      const words = ocr.status === "fulfilled" ? ocr.value : [];
      setReading(r);
      setLetterDate(r.letterDate);
      setDeposit(r.depositAmount);
      setLandlord(r.landlordName);
      setCharges(r.charges);
      if (!parseISO(mo) && parseISO(r.moveOutDate)) setMoveOut(r.moveOutDate);
      setJob((j) => ({ ...j, phase: "done", fields: buildFields(r, words), ocrOk: ocr.status === "fulfilled" && words.length > 0 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the photo.");
      setStep("start");
    }
  }, []);

  async function onFile(f: File | undefined) {
    if (!f) return;
    try {
      await process(await loadImage(f), null, moveOut);
    } catch {
      setError("That file is not a photo we can open.");
      setStep("start");
    }
  }

  async function loadSampleScan(url = "/samples/room-tags.sample.json") {
    try {
      setScan(parseRoomScan(await (await fetch(url)).json()));
      setDecisions({});
    } catch {
      setScan(null);
    }
  }

  async function useSample(s: Sample) {
    setMoveOut(s.moveOut);
    setLeaseEnd(s.leaseEnd);
    if (s.tags) await loadSampleScan(s.tags);
    await process(await loadImage(s.file), null, s.moveOut);
  }

  function decide(c: Candidate, d: "yes" | "no" | null) {
    setDecisions((prev) => {
      const next = { ...prev };
      if (d === null) delete next[decisionKey(c)];
      else next[decisionKey(c)] = d;
      return next;
    });
  }

  function reset() {
    setStep("start");
    setMoveOut("");
    setLeaseEnd("");
    setLetterDate("");
    setDeposit("");
    setLandlord("");
    setReading(null);
    setJob(EMPTY_JOB);
    setCharges([]);
    setScan(null);
    setDecisions({});
    setError("");
  }

  const flagged = useMemo(() => new Set(job.fields.filter((f) => f.check).map((f) => f.id)), [job.fields]);

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="top noprint">
        <button type="button" className="brand" onClick={reset} aria-label="Home Lens, start over">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>Home Lens</span>
        </button>
      </header>
      <main id="main" className={`step-${step}`}>
        {step === "start" && (
          <Start headRef={headRef} error={error} privacy={privacy} onCamera={() => setStep("camera")} onFile={(f) => void onFile(f)} onSample={(s) => void useSample(s)} />
        )}
        {step === "camera" && (
          <Camera
            onCapture={(frame, hint) => void process(frame, hint, moveOut)}
            onFile={(f) => void onFile(f)}
            onClose={() => setStep("start")}
          />
        )}
        {step === "reading" && (
          <Reading headRef={headRef} job={job} onNext={() => setStep("confirm")} readBy={readBy} />
        )}
        {step === "confirm" && reading && (
          <Confirm
            headRef={headRef} reading={reading} flagged={flagged} readBy="Nothing is saved. Edit anything that is wrong."
            letterDate={letterDate} setLetterDate={setLetterDate} deposit={deposit} setDeposit={setDeposit}
            moveOut={moveOut} setMoveOut={setMoveOut} leaseEnd={leaseEnd} setLeaseEnd={setLeaseEnd}
            charges={charges} setCharges={setCharges} onOk={() => setStep("result")}
          />
        )}
        {step === "result" && clock && (
          <Result
            headRef={headRef} clock={clock} charges={charges} letterDay={parseISO(letterDate)} hasLetter={reading !== null}
            readBy={`${readBy} You confirmed the numbers.`} possible={candidates.length} confirmed={confirmed} hasScan={scan !== null}
            onPhotos={() => setStep("photos")} onLetter={() => setStep("letter")}
          />
        )}
        {step === "photos" && (
          <Photos
            headRef={headRef} scan={scan} setScan={(s) => { setScan(s); setDecisions({}); }} charges={charges}
            candidates={candidates} decisions={decisions} decide={decide} onSampleScan={() => loadSampleScan()}
            onNext={() => setStep("letter")}
          />
        )}
        {step === "letter" && clock && moveOutDay !== null && (
          <LetterScreen
            headRef={headRef} clock={clock} moveOutDay={moveOutDay} today={today} charges={charges}
            letterDay={parseISO(letterDate)} hasLetter={reading !== null} landlord={landlord}
            deposit={deposit === "" ? null : Number(deposit)} evidence={evidence}
            onBack={() => setStep("result")} onEvidence={scan && confirmed.length > 0 ? () => setStep("evidence") : null}
          />
        )}
        {step === "evidence" && scan && (
          <Evidence headRef={headRef} scan={scan} charges={charges} confirmed={confirmed} today={today} onBack={() => setStep("letter")} />
        )}
        {(step === "result" || step === "letter") && !clock && (
          <section className="screen">
            <h1 ref={headRef} tabIndex={-1}>We need your move-out date</h1>
            <button type="button" className="btn" onClick={() => setStep("confirm")}>Back</button>
          </section>
        )}
      </main>
      <footer className="foot noprint">
        <span>Information, not legal advice.</span>
      </footer>
    </>
  );
}
