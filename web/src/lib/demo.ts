// "Use demo scan": fetches the files in public/samples/demo/ and hands them to the SAME reader the file picker uses,
// so a real room-tags.json + cloud.ply loads exactly the same way.
import { readScanFiles, type LoadedScan, type PickedFile } from "./scan3d.ts";

const BASE = "/samples/demo/";

function fromBlob(name: string, path: string, blob: Blob): PickedFile {
  return { name, path, type: blob.type, arrayBuffer: () => blob.arrayBuffer(), text: () => blob.text(), url: () => URL.createObjectURL(blob) };
}

async function get(path: string): Promise<Blob> {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`Could not load the demo file ${path}.`);
  return res.blob();
}

export async function loadDemoScan(opts: { bundle?: boolean } = {}): Promise<LoadedScan> {
  if (opts.bundle) return readScanFiles([fromBlob("scan-bundle.json", "scan-bundle.json", await get("scan-bundle.json"))]);
  const tagsBlob = await get("room-tags.json");
  const tags = JSON.parse(await tagsBlob.text()) as { tags: { photo: string }[] };
  const photos = await Promise.all(tags.tags.map(async (t) => fromBlob(t.photo.split("/").pop() ?? t.photo, t.photo, await get(t.photo))));
  return readScanFiles([
    fromBlob("cloud.ply", "cloud.ply", await get("cloud.ply")),
    fromBlob("room-tags.json", "room-tags.json", tagsBlob),
    ...photos,
  ]);
}

/** The move-out samples pretend the renter already confirmed their tags at move-in. */
export function withAllConfirmed(l: LoadedScan): LoadedScan {
  return l.scan ? { ...l, scan: { ...l.scan, tags: l.scan.tags.map((t) => ({ ...t, confirmed: true })) } } : l;
}
