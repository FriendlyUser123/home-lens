import type { HeadRef, Sample } from "../types.ts";

export const SAMPLES: Sample[] = [
  { id: "photo", label: "Photo on a desk", file: "/samples/letter-photo.png", moveOut: "2026-10-20", leaseEnd: "", tags: "/samples/room-tags.sample.json" },
  { id: "letter", label: "Letter, on time", file: "/samples/letter.png", moveOut: "2026-10-17", leaseEnd: "2026-10-15" },
  { id: "statement", label: "Statement, late", file: "/samples/statement.png", moveOut: "2026-10-25", leaseEnd: "2026-10-25" },
];

export function Start(p: {
  headRef: HeadRef; error: string; privacy: string;
  onCamera: () => void; onFile: (f: File | undefined) => void; onSample: (s: Sample) => void;
}) {
  return (
    <section className="screen start">
      <div className="intro">
        <h1 ref={p.headRef} tabIndex={-1}>Scan your deposit letter</h1>
        <p className="sub">We find your deadline and check each charge.</p>
        <div className="actions">
          <button type="button" className="btn big" onClick={p.onCamera}>Open camera</button>
          <label className="btn ghost big filebtn">
            Choose a photo
            <input type="file" accept="image/*" onChange={(e) => p.onFile(e.target.files?.[0])} />
          </label>
        </div>
        {p.error && <p className="err" role="alert">{p.error}</p>}
        <div className="samples">
          <span id="try">No letter handy? Try a sample.</span>
          <div role="group" aria-labelledby="try">
            {SAMPLES.map((s) => (
              <button key={s.id} type="button" className="btn ghost" onClick={() => p.onSample(s)}>{s.label}</button>
            ))}
          </div>
        </div>
        <p className="priv">{p.privacy}</p>
      </div>
      <figure className="lens" aria-hidden="true">
        <img src="/samples/letter-photo.png" alt="" />
        <i /><i /><i /><i />
      </figure>
    </section>
  );
}
