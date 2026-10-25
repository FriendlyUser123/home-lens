"""Home Lens damage compare: where in the move-in scan is this move-out photo, and was a tag already there?

Needs a finished scan folder (pipeline.py: poses, depth, fuse) and its room-tags.json (room_tags.py; each tag
carries a 3D `position`). Everything here is geometry, no AI: localize the photo in the map, cast a ray through
each box, list the move-in tags nearby, save move-in vs move-out crops side by side
(compare/<photo>/compare.json, spot<N>.jpg). Boxes are pixels [x0, y0, x1, y1] on the move-out photo.

The result is only ever "possible match, confirm": it shows the renter the same spot before and after.
It does not decide whether anything is damage or normal wear and tear.

Usage: python scan/compare.py data/<scan> --photo out.jpg --box x0 y0 x1 y1 [--box ...]
"""
import argparse
import json
from pathlib import Path

import cv2
import numpy as np
import open3d as o3d

from pipeline import load_frames

RADIUS_M = 0.5  # tag counts as nearby inside this; ponytail: guess (ray-hit noise ~0.05-0.1 m + damage size), tune on a real scan
MIN_INLIERS = 30  # PnP inliers needed before a photo counts as placed in the map
SIFT = cv2.SIFT_create()


def features(img, long_side=1280):
    """SIFT points in full-size pixel coordinates (the image is shrunk first so 12 MP phone photos stay fast)."""
    k = min(1.0, long_side / max(img.shape[:2]))
    small = cv2.resize(img, None, fx=k, fy=k, interpolation=cv2.INTER_AREA) if k < 1 else img
    kp, des = SIFT.detectAndCompute(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), None)
    return np.array([p.pt for p in kp], float).reshape(-1, 2) / k, des


def match(des_a, des_b):
    """Ratio-test matches as (index in a, index in b) pairs."""
    pairs = cv2.BFMatcher().knnMatch(des_a, des_b, k=2)
    good = [p[0] for p in pairs if len(p) == 2 and p[0].distance < 0.75 * p[1].distance]
    return np.array([(m.queryIdx, m.trainIdx) for m in good], int).reshape(-1, 2)


def localize(photo, scan, frames, top=3, photo_sides=(1280, 640)):
    """Pose of a still photo in the scan's world: SIFT-match it to the keyframes, lift the matched keyframe
    pixels to 3D with that keyframe's depth, solve PnP. None when no keyframe gives MIN_INLIERS.
    Keyframes are ranked by homography inliers (raw matches are mostly outliers on plain walls), and the photo is
    matched at two sizes so a close-up can still meet a wider keyframe."""
    ph, pw = photo.shape[:2]
    feats = [features(photo, s) for s in photo_sides]
    scales = json.loads((scan / "depth" / "scale.json").read_text())
    cands = []
    for f in frames:  # ponytail: matches every keyframe, fine for a room (~100s); pre-compute features if it gets slow
        kpts, kdes = features(cv2.imread(str(f["image"])), 1920)
        for pts, des in feats:
            if des is None or kdes is None:
                continue
            m = match(des, kdes)
            if len(m) < 8:
                continue
            H, mask = cv2.findHomography(kpts[m[:, 1]], pts[m[:, 0]], cv2.RANSAC, 6.0)
            if H is not None:
                cands.append((int(mask.sum()), m, f, kpts, pts))
    best = None
    for _, m, f, kpts, pts in sorted(cands, key=lambda c: c[0], reverse=True)[:top]:
        stem = f["image"].stem
        depth = np.load(scan / "depth" / f"{stem}.npy") * (scales[stem] or 1.0)  # same rule as fuse
        uv, img_pts = kpts[m[:, 1]], pts[m[:, 0]]
        z = depth[uv[:, 1].round().astype(int).clip(0, depth.shape[0] - 1),
                  uv[:, 0].round().astype(int).clip(0, depth.shape[1] - 1)]
        K = f["K"]
        cam = np.c_[(uv - K[:2, 2]) / np.diag(K)[:2] * z[:, None], z]
        obj = cam @ f["c2w"][:3, :3].T + f["c2w"][:3, 3]
        # ponytail: assumes the photo has the keyframes' field of view (same phone, 4:3 sensor, portrait or landscape,
        # only resized): focal scales with the long side, principal point is the centre. A crop (zoom, 16:9 video
        # mode) or a different lens breaks it; then pass the real intrinsics.
        s = max(ph, pw) / max(depth.shape)
        Kp = np.array([[K[0, 0] * s, 0, pw / 2], [0, K[1, 1] * s, ph / 2], [0, 0, 1]])
        keep = z > 0.1
        ok, rvec, tvec, inl = cv2.solvePnPRansac(obj[keep], img_pts[keep], Kp, None, reprojectionError=4.0 * max(s, 1.0),
                                                 iterationsCount=500, flags=cv2.SOLVEPNP_SQPNP)
        n = len(inl) if ok and inl is not None else 0
        if n >= MIN_INLIERS and (best is None or n > best["inliers"]):
            w2c = np.eye(4)
            w2c[:3, :3], w2c[:3, 3] = cv2.Rodrigues(rvec)[0], tvec.ravel()
            H, _ = cv2.findHomography(uv, img_pts, cv2.RANSAC, 4.0)  # keyframe -> photo, for the side-by-side crop
            best = dict(c2w=np.linalg.inv(w2c), K=Kp, inliers=n, frame=stem, H=H, keyframe=cv2.imread(str(f["image"])))
    return best


def cast(c2w, K, box, cloud, tol=0.04):
    """First surface the box-centre ray meets in the cloud. None if it hits nothing."""
    u, v = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    d = c2w[:3, :3] @ np.linalg.solve(K, [u, v, 1.0])
    d /= np.linalg.norm(d)
    rel = cloud - c2w[:3, 3]
    t = rel @ d
    hit = t[(t > 0.1) & (np.linalg.norm(rel - np.outer(t, d), axis=1) < tol)]
    if not len(hit):
        return None
    # ponytail: nearest hit cluster, so one floating fragment in front of the wall does not win; no occlusion handling
    near = np.sort(hit)
    return c2w[:3, 3] + d * np.median(near[near < near[0] + 0.1])


def load_cloud(scan):
    return np.asarray(o3d.io.read_point_cloud(str(scan / "cloud.ply")).points)


def crop_pair(photo, warped, box, pad=0.5):
    """Move-out photo | move-in keyframe warped into the same view, around the box with some context."""
    x0, y0, x1, y1 = box
    px, py = (x1 - x0) * pad, (y1 - y0) * pad
    h, w = photo.shape[:2]
    s = (slice(max(int(y0 - py), 0), min(int(y1 + py), h)), slice(max(int(x0 - px), 0), min(int(x1 + px), w)))
    return np.hstack([photo[s], warped[s]])


def compare(scan, photo_path, boxes, radius=RADIUS_M):
    frames, _ = load_frames(scan)
    photo = cv2.imread(str(photo_path))
    out = scan / "compare" / Path(photo_path).stem
    out.mkdir(parents=True, exist_ok=True)
    loc = localize(photo, scan, frames)
    if loc is None:
        r = dict(photo=str(photo_path), status="cannot place this photo in the move-in scan; compare by eye", spots=[])
    else:
        cloud = load_cloud(scan)
        tags = [t for t in json.loads((scan / "room-tags.json").read_text())["tags"] if t.get("position")]
        # ponytail: homography assumes the spot is on a flat wall or floor; curved or cluttered spots warp wrong
        warped = cv2.warpPerspective(loc["keyframe"], loc["H"], photo.shape[1::-1]) if loc["H"] is not None else None
        spots = []
        for i, box in enumerate(boxes):
            p = cast(loc["c2w"], loc["K"], box, cloud)
            near = [] if p is None else sorted(
                ((float(np.linalg.norm(p - t["position"])), t) for t in tags), key=lambda x: x[0])
            near = [dict(id=t["id"], label=f"{t['object']}: {t['note']}", frame=t["frame"], distance_m=round(d, 2))
                    for d, t in near if d <= radius]
            spot = dict(box=box, position=None if p is None else p.tolist(), nearby_tags=near,
                        status="not found in the scan" if p is None else
                        "possible match, confirm" if near else "no move-in tag near this spot")
            if warped is not None:
                spot["crop"] = f"spot{i}.jpg"
                cv2.imwrite(str(out / spot["crop"]), crop_pair(photo, warped, box))
            spots.append(spot)
        r = dict(photo=str(photo_path), status="placed", pose_inliers=loc["inliers"], keyframe=loc["frame"],
                 radius_m=radius, spots=spots)
    (out / "compare.json").write_text(json.dumps(r, indent=1))
    return r


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("scan", type=Path)
    ap.add_argument("--photo", type=Path, required=True)
    ap.add_argument("--box", nargs=4, type=float, action="append", required=True, metavar=("X0", "Y0", "X1", "Y1"))
    ap.add_argument("--radius", type=float, default=RADIUS_M)
    a = ap.parse_args()
    print(json.dumps(compare(a.scan, a.photo, a.box, a.radius), indent=1))
