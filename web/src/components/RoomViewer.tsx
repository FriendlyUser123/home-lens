import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../lib/hooks.ts";
import type { Cloud, Pin, ScanBundle, Up } from "../lib/scan3d.ts";
import { createViewer, type Viewer } from "../lib/viewer3d.ts";

/** The 3D room: a point cloud or a bundle, with numbered pins. `fly` animates to a pin whenever its `n` changes. */
export function RoomViewer(p: {
  cloud: Cloud | null; bundle: ScanBundle | null; pins: Pin[]; up: Up;
  selected: string | null; fly: { id: string; n: number } | null; onSelect: (id: string) => void; label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const [failed, setFailed] = useState(false);
  const reduced = useReducedMotion();
  const onSelect = useRef(p.onSelect);
  onSelect.current = p.onSelect;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    try {
      viewer.current = createViewer(el, { onSelect: (id) => onSelect.current(id), reducedMotion: reduced });
    } catch {
      setFailed(true);
      return;
    }
    return () => {
      viewer.current?.dispose();
      viewer.current = null;
    };
  }, [reduced]);

  useEffect(() => {
    viewer.current?.setContent({ cloud: p.cloud, bundle: p.bundle, pins: p.pins, up: p.up });
  }, [p.cloud, p.bundle, p.pins, p.up, reduced]);

  useEffect(() => {
    viewer.current?.select(p.selected);
  }, [p.selected, p.pins, p.cloud, p.bundle, p.up]);

  useEffect(() => {
    if (p.fly) void viewer.current?.flyTo(p.fly.id);
  }, [p.fly?.id, p.fly?.n, p.pins, p.cloud, p.bundle]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return <div className="room3d nogl" role="img" aria-label={p.label}>The 3D view needs WebGL, which this browser does not have. The list still works.</div>;
  return (
    <div className="room3d-wrap">
      <div ref={box} className="room3d" role="img" aria-label={p.label} tabIndex={0} />
      <div className="room3d-bar noprint">
        <button type="button" className="link" onClick={() => viewer.current?.reset()}>Reset view</button>
      </div>
    </div>
  );
}
