"""Home Lens demo page: one self-contained HTML file (no network, no libraries) for the scan side of the demo.

Shows the confirmed move-in tags, the 3D map with each tag and the move-out camera, and what compare says about
each boxed spot on a move-out photo (real outputs of room_tags.py and compare.py, nothing mocked).

Usage: python scan/demo_page.py data/<scan> --photo out.jpg --box x0 y0 x1 y1 [--box ...] [--radius 0.3]
       [--note "text under the preview banner"]   ->  data/<scan>/demo/index.html
The page embeds photos and a 3D cloud of the room: it stays in the gitignored data/ folder; mind who gets it.
"""
import argparse
import base64
import html
import json
from pathlib import Path

import numpy as np
import open3d as o3d

from compare import compare
from pipeline import GEMMA_MODEL, load_frames

TEMPLATE = Path(__file__).with_name("demo_template.html").read_text(encoding="utf-8")


def b64(b):
    return base64.b64encode(b).decode()


def cloud_payload(scan, path_xyz, n=120000):
    """Cloud as int16 centimetres + uint8 colours (base64), trimmed to the camera path +/- 4 m."""
    pcd = o3d.io.read_point_cloud(str(scan / "cloud.ply"))
    p, c = np.asarray(pcd.points), (np.clip(np.asarray(pcd.colors), 0, 1) * 255).astype(np.uint8)
    lo, hi = path_xyz.min(0) - 4, path_xyz.max(0) + 4
    keep = np.all((p >= lo) & (p <= hi), axis=1)
    p, c = p[keep], c[keep]
    pick = np.random.default_rng(0).choice(len(p), min(n, len(p)), replace=False)
    centre = path_xyz.mean(0)
    return dict(n=len(pick), centre=centre.tolist(), xyz=b64(((p[pick] - centre) * 100).astype("<i2").tobytes()),
                rgb=b64(c[pick].tobytes()))


def main(scan, photo, boxes, radius, note):
    scan = Path(scan)
    r = compare(scan, photo, boxes, radius)
    d = json.loads((scan / "room-tags.json").read_text())
    tags = [t for t in d["tags"] if t["confirmed"]]
    frames, _ = load_frames(scan)
    path = np.array([f["c2w"][:3, 3] for f in frames])
    tag_pos = {t["id"]: np.array(t["position"]) for t in tags if t.get("position")}
    data = dict(cloud=cloud_payload(scan, path), path=path.tolist(),
                tags=[dict(id=t["id"], pos=t["position"], label=f"{t['object']}: {t['note']}") for t in tags if t.get("position")],
                camera=None if r["status"] != "placed" else np.array(r["camera"]).tolist())
    tag_cards = "\n".join(
        f'<figure class="shot"><div class="frame"><img alt="Move-in photo with the damage boxed" src="data:image/jpeg;base64,'
        f'{b64((scan / t["photo"]).read_bytes())}">'
        + (f'<div class="box" style="left:{t["box"][0]*100:.1f}%;top:{t["box"][1]*100:.1f}%;width:{t["box"][2]*100:.1f}%;height:{t["box"][3]*100:.1f}%"></div>' if t["box"] else "")
        + f'</div><figcaption><strong>Tag {t["id"]}</strong> · {html.escape(t["room"])} · {html.escape(t["object"])}<br>{html.escape(t["note"])}'
        f'<br><span class="mut">Found by {html.escape(GEMMA_MODEL)}; confirmed by the renter.</span></figcaption></figure>' for t in tags)
    spot_cards = []
    for i, s in enumerate(r.get("spots", [])):
        near = sorted((float(np.linalg.norm(np.array(s["position"]) - p)), tid) for tid, p in tag_pos.items()) if s["position"] else []
        label = {t["id"]: f"{t['object']}: {t['note']}" for t in tags}
        if s["nearby_tags"]:
            verdict = f'Possible match, confirm: {html.escape(s["nearby_tags"][0]["label"])} ({s["nearby_tags"][0]["distance_m"] * 100:.0f} cm away in the map)'
            cls = "match"
        else:
            verdict = "No move-in tag near this spot" + (f' (nearest is {near[0][0] * 100:.0f} cm away, the limit is {radius * 100:.0f} cm)' if near else "")
            cls = "none"
        img = f'<img alt="Left: move-out photo. Right: move-in view of the same spot." src="data:image/jpeg;base64,{b64((scan / "compare" / Path(photo).stem / s["crop"]).read_bytes())}">' if s.get("crop") else ""
        spot_cards.append(f'<article class="spot {cls}" data-i="{i}"><h3>Spot {i + 1}</h3>{img}'
                          f'<p class="verdict">{verdict}</p><div class="row"><button type="button" data-act="yes">Same spot, same damage</button>'
                          f'<button type="button" data-act="no">Not the same</button></div><p class="answer mut" aria-live="polite"></p></article>')
    placed = (f'Placed in the move-in map: {r["pose_inliers"]} matched points, found through keyframe {r["keyframe"][-2:]}.'
              if r["status"] == "placed" else html.escape(r["status"]))
    page = (TEMPLATE.replace("{{TAGS}}", tag_cards).replace("{{SPOTS}}", "\n".join(spot_cards)).replace("{{PLACED}}", placed)
            .replace("{{NOTE}}", html.escape(note)).replace("{{N_KEYFRAMES}}", str(len(frames)))
            .replace("{{MODEL}}", html.escape(GEMMA_MODEL)).replace("{{DATA}}", json.dumps(data)))
    out = scan / "demo"
    out.mkdir(exist_ok=True)
    (out / "index.html").write_text(page, encoding="utf-8")
    print(out / "index.html", f"{len(page) / 1e6:.1f} MB", r["status"])


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("scan", type=Path)
    ap.add_argument("--photo", type=Path, required=True)
    ap.add_argument("--box", nargs=4, type=float, action="append", required=True)
    ap.add_argument("--radius", type=float, default=0.3)
    ap.add_argument("--note", default="")
    a = ap.parse_args()
    main(a.scan, a.photo, a.box, a.radius, a.note)
