"""Home Lens move-in room tags: scan keyframes -> Gemma damage tags -> room-tags.json (the shared schema).

Output is shared/room-tags.schema.json (on feat/documents), the file the document matcher reads:
  data/<scan>/room-tags.json   photos live in data/<scan>/room-tags/photos/ (paths are relative to the json)
Extra fields beyond the schema: `frame` (keyframe stem) and `position` ([x, y, z] metres, the tag's 3D spot in
the scan world from a ray cast through the box centre; null when there is no box or the ray hits nothing).
`pose` is the camera that took the photo: [x, y, z, qx, qy, qz, qw], OpenCV axes (x right, y down, z forward),
scan world (arbitrary up).

Gemma only perceives: it names damage and boxes it on ONE photo. Code adds the pose and the 3D spot. A tag is
`confirmed: false` until the renter confirms it in `review`. Gemma may miss small damage or tag a shadow, so
never call the list complete.

Usage: python scan/room_tags.py tag data/<scan> [--room "living room"] [--captured-at ISO8601] [--frames 12]
                                    [--address "..."] [--avoid frame_00043 ...]
       python scan/room_tags.py review data/<scan>
"""
import argparse
import base64
import json
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

from compare import cast, load_cloud
from pipeline import gemma_call, load_frames

ROOMS = ["bedroom", "bathroom", "kitchen", "living room", "hallway", "closet", "other"]
OBJECTS = ["carpet", "wall", "door", "window", "blinds", "counter", "floor", "ceiling", "appliance", "fixture", "other"]


def tag_prompt(room):
    where = f" The room is: {room}." if room else ""
    return (
        "You are helping a renter document the condition of a room at move-in. You see ONE photo." + where + "\n"
        "List only damage that is clearly visible: scuffs, scratches, stains, dents, holes, cracks, chips, burns, "
        "bent or broken parts. Do not list furniture, belongings, shadows, reflections, glare, or marks you are "
        "unsure about. If there is no clear damage, reply with an empty list. Never judge cost, cause, or whether "
        "something is normal wear and tear.\n"
        f"For each one give: room (one of {json.dumps(ROOMS)}), object (one of {json.dumps(OBJECTS)}), note (one "
        "short sentence: what you see and where in the photo), box [x, y, w, h] as fractions between 0 and 1 of the "
        "photo's width and height, x and y being the top-left corner.\n"
        'Reply with JSON only: {"tags": [{"room": "...", "object": "...", "note": "...", "box": [x, y, w, h]}]}')


def parse_tags(text, room=None):
    """Gemma's reply -> tag dicts. Anything unusable is dropped or downgraded, never trusted."""
    try:
        r = json.loads(text[text.index("{"):text.rindex("}") + 1])
    except ValueError:
        return []
    tags = r.get("tags") if isinstance(r, dict) else None
    out = []
    for t in tags if isinstance(tags, list) else []:
        if not isinstance(t, dict) or not str(t.get("note", "")).strip():
            continue
        box = t.get("box")
        if isinstance(box, list) and len(box) == 4 and all(isinstance(v, (int, float)) for v in box) \
                and 0 <= box[0] < 1 and 0 <= box[1] < 1 and box[2] > 0 and box[3] > 0:
            box = [float(box[0]), float(box[1]), float(min(box[2], 1 - box[0])), float(min(box[3], 1 - box[1]))]
        else:
            box = None
        obj = str(t.get("object", "")).lower()
        out.append(dict(room=room or (t["room"] if t.get("room") in ROOMS else "other"),
                        object=obj if obj in OBJECTS else "other", note=str(t["note"]).strip()[:200], box=box))
    return out


def quat(R):
    """[qx, qy, qz, qw] of a rotation matrix."""
    t = np.trace(R)
    if t > 0:
        s = 2 * np.sqrt(t + 1)
        return [(R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s, s / 4]
    i = int(np.argmax(np.diag(R)))
    j, k = (i + 1) % 3, (i + 2) % 3
    s = 2 * np.sqrt(1 + R[i, i] - R[j, j] - R[k, k])
    q = [0.0] * 4
    q[i], q[j], q[k], q[3] = s / 4, (R[j, i] + R[i, j]) / s, (R[k, i] + R[i, k]) / s, (R[k, j] - R[j, k]) / s
    return q


def pose(c2w):
    return [float(v) for v in [*c2w[:3, 3], *quat(c2w[:3, :3])]]


def pick_frames(frames, n, avoid=()):
    """The sharpest keyframe in each of n equal slices of the walk, never one named in `avoid` (file stems)."""
    sharp = lambda f: cv2.Laplacian(cv2.imread(str(f["image"]), cv2.IMREAD_GRAYSCALE), cv2.CV_64F).var()
    ok = [f for f in frames if f["image"].stem not in avoid]
    slices = [ok[i * len(ok) // n:(i + 1) * len(ok) // n] for i in range(n)]
    return [max(s, key=sharp) for s in slices if s]


def tag(scan, room=None, captured_at=None, address="", n=12, avoid=()):
    frames, _ = load_frames(scan)
    cloud = load_cloud(scan)
    photos = scan / "room-tags" / "photos"
    photos.mkdir(parents=True, exist_ok=True)
    captured_at = captured_at or datetime.now(timezone.utc).isoformat(timespec="seconds")
    tags = []
    for f in pick_frames(frames, n, avoid):
        stem = f["image"].stem
        img = cv2.imread(str(f["image"]))
        h, w = img.shape[:2]
        small = cv2.resize(img, None, fx=1024 / max(h, w), fy=1024 / max(h, w), interpolation=cv2.INTER_AREA)
        # ponytail: fixed 1024 px downscale keeps the request small; raise it if small damage is missed
        jpg = base64.b64encode(cv2.imencode(".jpg", small, [cv2.IMWRITE_JPEG_QUALITY, 85])[1]).decode()
        text = gemma_call([{"text": tag_prompt(room)}, {"inline_data": {"mime_type": "image/jpeg", "data": jpg}}])
        (scan / "room-tags" / f"{stem}.raw.txt").write_text(text, encoding="utf-8")  # every tag traces to a reply
        found = parse_tags(text, room)
        if found:
            cv2.imwrite(str(photos / f"{stem}.jpg"), small)
        for t in found:
            b = t["box"]
            p = None if b is None else cast(f["c2w"], f["K"], [b[0] * w, b[1] * h, (b[0] + b[2]) * w, (b[1] + b[3]) * h], cloud)
            tags.append(dict(id=len(tags) + 1, room=t["room"], object=t["object"], note=t["note"],
                             photo=f"room-tags/photos/{stem}.jpg", box=b, takenAt=captured_at, pose=pose(f["c2w"]),
                             confirmed=False, frame=stem, position=None if p is None else p.tolist()))
    # ponytail: takenAt is the recording start for every tag (Spectacular gives no per-frame clock); interpolate if it matters
    (scan / "room-tags.json").write_text(json.dumps(
        dict(scanId=scan.name, address=address or "Sample room (not an address)", capturedAt=captured_at, tags=tags),
        indent=1))


def review(scan):
    """Renter confirms or removes each tag in the terminal; only confirmed tags count."""
    path = scan / "room-tags.json"
    d = json.loads(path.read_text())
    keep = []
    for t in d["tags"]:
        a = input(f"#{t['id']} {t['room']} / {t['object']}: {t['note']} ({t['frame']}). Real existing damage? [y/n/skip] ")
        t["confirmed"] = t["confirmed"] or a.strip().lower() == "y"
        if a.strip().lower() != "n":
            keep.append(t)
    d["tags"] = keep
    path.write_text(json.dumps(d, indent=1))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stage", choices=["tag", "review"])
    ap.add_argument("scan", type=Path)
    ap.add_argument("--room", choices=ROOMS, help="force this room on every tag (you know it; Gemma would guess)")
    ap.add_argument("--captured-at", help="ISO 8601 time of the move-in recording, e.g. 2026-10-24T21:34:47-04:00")
    ap.add_argument("--address", default="")
    ap.add_argument("--frames", type=int, default=12)
    ap.add_argument("--avoid", nargs="*", default=[], help="keyframe stems to leave out (e.g. one showing a person)")
    a = ap.parse_args()
    if a.stage == "review":
        review(a.scan)
    else:
        tag(a.scan, a.room, a.captured_at, a.address, a.frames, a.avoid)
