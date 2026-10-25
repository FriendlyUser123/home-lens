import type { HeadRef } from "../types.ts";

const PATHS = [
  { id: "movein", title: "Move in", line: "Scan your room. Log damage that was already there." },
  { id: "report", title: "Report a problem", line: "Photo in, written repair notice out." },
  { id: "moveout", title: "Move out", line: "Scan your deposit letter. Match charges to your photos." },
] as const;

export type Path = (typeof PATHS)[number]["id"];

export function Home(p: { headRef: HeadRef; privacy: string; onPick: (p: Path) => void }) {
  return (
    <section className="screen start home">
      <div className="intro">
        <h1 ref={p.headRef} tabIndex={-1}>Home Lens</h1>
        <p className="sub">One camera for your home and your papers.</p>
        <ul className="paths">
          {PATHS.map((x, i) => (
            <li key={x.id}>
              <button type="button" onClick={() => p.onPick(x.id)}>
                <span className="n" aria-hidden="true">{i + 1}</span>
                <span className="t">{x.title}</span>
                <span className="l">{x.line}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="priv">{p.privacy}</p>
      </div>
      <figure className="lens" aria-hidden="true">
        <img src="/samples/letter-photo.png" alt="" />
        <i /><i /><i /><i />
      </figure>
    </section>
  );
}
