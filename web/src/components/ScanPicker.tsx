import { useState } from "react";
import { loadDemoScan } from "../lib/demo.ts";
import { fromFile, readScanFiles, type LoadedScan } from "../lib/scan3d.ts";

/** Demo button plus a multi-file picker and a folder picker. Real scan output loads with no changes. */
export function ScanPicker(p: { onLoaded: (l: LoadedScan) => void; demoLabel?: string }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(job: () => Promise<LoadedScan>) {
    setErr("");
    setBusy(true);
    try {
      p.onLoaded(await job());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not read those files.");
    } finally {
      setBusy(false);
    }
  }
  async function pick(list: FileList | null) {
    if (!list || list.length === 0) return;
    await run(() => readScanFiles([...list].map(fromFile)));
  }

  return (
    <div className="paper loader">
      <button type="button" className="btn big" disabled={busy} onClick={() => void run(() => loadDemoScan())}>{p.demoLabel ?? "Use demo scan"}</button>
      <label className="btn ghost big filebtn">
        Choose scan files
        <input type="file" multiple accept=".json,.ply,image/*" onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} />
      </label>
      <label className="btn ghost filebtn">
        Choose a scan folder
        <input type="file" multiple {...{ webkitdirectory: "" }} onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} />
      </label>
      <p className="note">Pick <b>room-tags.json</b> and <b>cloud.ply</b> from the room scan. Add the photos if they are separate files, or pick the whole folder. A scan bundle .json works too.</p>
      <button type="button" className="link" disabled={busy} onClick={() => void run(() => loadDemoScan({ bundle: true }))}>Try the demo as a scan bundle (.json)</button>
      {err && <p className="err" role="alert">{err}</p>}
      <p className="priv">The files stay in your browser.</p>
    </div>
  );
}
