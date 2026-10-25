import { useState } from "react";
import type { RoomTag } from "../lib/match.ts";

/** A move-in photo with the tagged spot boxed in amber. */
export function TagPhoto({ tag, alt }: { tag: RoomTag; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) return <div className="tagphoto missing" role="img" aria-label={alt}>Photo not found</div>;
  const [x, y, w, h] = tag.box ?? [];
  return (
    <div className="tagphoto">
      <img src={tag.photo} alt={alt} onError={() => setBroken(true)} />
      {x !== undefined && y !== undefined && w !== undefined && h !== undefined && (
        <i aria-hidden="true" style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }} />
      )}
    </div>
  );
}
