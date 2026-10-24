"""Home Lens room scan: phone walkthrough -> metric measurements -> report.

Capture (on the phone, no code): Spectacular Rec, slow closed-loop walk, good light, no spinning
in place, texture in view, tilt up to the ceiling once, end where you started. Copy the recording
to data/<scan>/rec/.

Stages read and write files in one scan folder, so each can be rerun alone:
  poses    rec/ -> sai/transforms.json + images      (sai-cli, visual-inertial = metric scale)
  depth    sai/ -> depth/*.npy, depth/scale.json     (Depth Anything V2, rescaled to SLAM map points)
  fuse     depth + poses -> mesh.ply, cloud.ply      (TSDF)
  measure  cloud.ply -> measurements.json            (RANSAC planes: floor, ceiling, walls)
  pick     cloud.ply -> picks.json                   (two human-picked points per door/hallway width)
  report   measurements + picks + rules.json -> report.json, report.html

Usage: python scan/pipeline.py <stage|all> data/<scan> [--occupants N] [--rel-error 0.03]
"""
import argparse
import html
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np
import open3d as o3d

RULES = Path(__file__).with_name("rules.json")
DEPTH_MODEL = "depth-anything/Depth-Anything-V2-Metric-Indoor-Small-hf"  # licence of this card not checked yet
GL_TO_CV = np.diag([1.0, -1, -1, 1])  # nerfstudio poses use OpenGL camera axes; Open3D/OpenCV want y down, z forward
UNIT_M = {"ft2": 0.09290304, "ft": 0.3048, "in": 0.0254}
UNIT_LABEL = {"ft2": "sq ft", "ft": "ft", "in": "in"}


def poses(scan):
    # ponytail: sai-cli is proprietary (licence audit pending); any tool that writes a metric
    # nerfstudio transforms.json into sai/ can replace this one call.
    subprocess.run(["sai-cli", "process", "--format", "nerfstudio", "--key_frame_distance=0.15",
                    str(scan / "rec"), str(scan / "sai")], check=True)


def load_frames(scan):
    """Keyframes from sai/transforms.json (nerfstudio format) plus the sparse map points, if exported."""
    d = scan / "sai"
    meta = json.loads((d / "transforms.json").read_text())
    frames = []
    for f in meta["frames"]:
        g = lambda k: f.get(k, meta.get(k))  # intrinsics can be per frame or shared
        K = np.array([[g("fl_x"), 0, g("cx")], [0, g("fl_y"), g("cy")], [0, 0, 1]], float)
        frames.append(dict(image=d / f["file_path"], K=K, c2w=np.array(f["transform_matrix"], float) @ GL_TO_CV))
    ply = meta.get("ply_file_path")
    points = np.asarray(o3d.io.read_point_cloud(str(d / ply)).points) if ply else None
    return frames, points


def fit_scale(depth, points, f):
    """Median ratio of SLAM depth to predicted depth at the map points that land in this frame."""
    w2c = np.linalg.inv(f["c2w"])
    p = points @ w2c[:3, :3].T + w2c[:3, 3]
    p = p[p[:, 2] > 0.1]
    uv = p @ f["K"].T
    uv = (uv[:, :2] / uv[:, 2:]).round().astype(int)
    h, w = depth.shape
    ok = (uv[:, 0] >= 0) & (uv[:, 0] < w) & (uv[:, 1] >= 0) & (uv[:, 1] < h)
    # ponytail: occluded map points are not filtered, the median absorbs a few; z-buffer them if scale looks noisy
    if ok.sum() < 20:
        return None
    return float(np.median(p[ok, 2] / depth[uv[ok, 1], uv[ok, 0]]))


def depth(scan):
    import torch
    from PIL import Image
    from transformers import pipeline

    frames, points = load_frames(scan)
    est = pipeline("depth-estimation", model=DEPTH_MODEL, device=0 if torch.cuda.is_available() else -1)
    out = scan / "depth"
    out.mkdir(exist_ok=True)
    scales = {}
    for f in frames:
        img = Image.open(f["image"]).convert("RGB")
        d = est(img)["predicted_depth"].squeeze().cpu().numpy().astype(np.float32)
        d = cv2.resize(d, img.size)  # no-op when the pipeline already returns full size
        np.save(out / f"{f['image'].stem}.npy", d)
        scales[f["image"].stem] = None if points is None else fit_scale(d, points, f)
    (out / "scale.json").write_text(json.dumps(scales, indent=1))


def fuse(scan, voxel=0.02):
    frames, _ = load_frames(scan)
    scales = json.loads((scan / "depth" / "scale.json").read_text())
    vol = o3d.pipelines.integration.ScalableTSDFVolume(
        voxel_length=voxel, sdf_trunc=4 * voxel, color_type=o3d.pipelines.integration.TSDFVolumeColorType.RGB8)
    for f in frames:
        stem = f["image"].stem
        d = np.load(scan / "depth" / f"{stem}.npy") * (scales[stem] or 1.0)  # None = keep the model's own metric scale
        h, w = d.shape
        K = f["K"]
        rgbd = o3d.geometry.RGBDImage.create_from_color_and_depth(
            o3d.io.read_image(str(f["image"])), o3d.geometry.Image(d), depth_scale=1.0, depth_trunc=5.0,
            convert_rgb_to_intensity=False)
        vol.integrate(rgbd, o3d.camera.PinholeCameraIntrinsic(w, h, K[0, 0], K[1, 1], K[0, 2], K[1, 2]),
                      np.linalg.inv(f["c2w"]))
    o3d.io.write_triangle_mesh(str(scan / "mesh.ply"), vol.extract_triangle_mesh())
    o3d.io.write_point_cloud(str(scan / "cloud.ply"), vol.extract_point_cloud())


def measure_points(points, up, dist=0.02, min_frac=0.01, max_planes=12):
    """Floor area, smallest plan dimension and ceiling height from a room point cloud.

    `up` only needs to be roughly right (within ~15 deg); the floor normal replaces it.
    """
    pcd = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(points))
    planes = []
    for _ in range(max_planes):
        if len(pcd.points) < 3:
            break
        model, idx = pcd.segment_plane(dist, 3, 1000)
        if len(idx) < min_frac * len(points):
            break
        planes.append((np.array(model[:3]) / np.linalg.norm(model[:3]), np.asarray(pcd.points)[idx]))
        pcd = pcd.select_by_index(idx, invert=True)

    out = dict(floor_area_m2=None, min_dimension_m=None, max_dimension_m=None, ceiling_height_m=None)
    flat = [(n if n @ up > 0 else -n, p) for n, p in planes if abs(n @ up) > 0.95]
    if not flat:
        return out
    # floor = lowest flat plane; its normal replaces the rough up before anything is classified as a wall
    up, floor_pts = min(flat, key=lambda h: np.median(h[1] @ up))
    floor_h = np.median(floor_pts @ up)
    horizontal = [p for n, p in planes if abs(n @ up) > 0.99]
    vertical = [(n, p) for n, p in planes if abs(n @ up) < 0.1]
    out.update(up=up.tolist(), planes=dict(horizontal=len(horizontal), vertical=len(vertical)))
    if len(horizontal) > 1:
        top = max(np.median(p @ up) for p in horizontal)
        out["ceiling_height_m"] = float(top - floor_h)  # ponytail: highest flat surface = ceiling; None if never filmed

    # ponytail: rectangular room = the 4 biggest vertical planes form 2 parallel pairs; each dimension is the
    # distance between a pair's median offsets. L-shaped rooms, or a wall seen through an open door that
    # outranks a room wall, break this. Upgrade: floor polygon from wall-plane intersections.
    walls = sorted(vertical, key=lambda w: len(w[1]), reverse=True)[:4]
    dims = [abs(np.median(p @ n) - np.median(q @ n))
            for i, (n, p) in enumerate(walls) for m, q in walls[i + 1:] if abs(n @ m) > 0.99]
    if len(dims) == 2:
        a, b = sorted(dims)
        out.update(floor_area_m2=float(a * b), min_dimension_m=float(a), max_dimension_m=float(b))
    return out


def up_from_cameras(frames):
    """The phone is held upright while walking, so the mean camera up (-y in OpenCV axes) is world up."""
    u = -np.mean([f["c2w"][:3, 1] for f in frames], axis=0)
    return u / np.linalg.norm(u)


def measure(scan):
    frames, _ = load_frames(scan)
    points = np.asarray(o3d.io.read_point_cloud(str(scan / "cloud.ply")).points)
    (scan / "measurements.json").write_text(json.dumps(measure_points(points, up_from_cameras(frames)), indent=1))


def pick(scan, name, kind):
    pcd = o3d.io.read_point_cloud(str(scan / "cloud.ply"))
    vis = o3d.visualization.VisualizerWithEditing()
    vis.create_window(f"Shift+click both sides of {name}, then press Q")
    vis.add_geometry(pcd)
    vis.run()
    vis.destroy_window()
    idx = vis.get_picked_points()
    if len(idx) != 2:
        sys.exit(f"need exactly 2 points, got {len(idx)}")
    p = np.asarray(pcd.points)[idx]
    path = scan / "picks.json"
    picks = json.loads(path.read_text()) if path.exists() else []
    picks.append(dict(name=name, kind=kind, points=p.tolist(), width_m=float(np.linalg.norm(p[0] - p[1]))))
    path.write_text(json.dumps(picks, indent=1))


def check(item, value_m, rule, rel_error, occupants):
    """pass / fail only when the whole error bar is on one side of the requirement."""
    unit = rule["unit"]
    req = rule["min"]
    if occupants > 1 and "min_per_occupant_if_shared" in rule:
        req = max(req, rule["min_per_occupant_if_shared"] * occupants)
    req_m = req * UNIT_M[unit]
    err_m = None if value_m is None or rel_error is None else value_m * rel_error * (2 if unit == "ft2" else 1)
    if err_m is None:
        status = "cannot tell"
    else:
        status = "pass" if value_m - err_m >= req_m else "fail" if value_m + err_m < req_m else "cannot tell"
    to_unit = lambda v: None if v is None else round(v / UNIT_M[unit], 1)
    return dict(item=item, rule=rule["id"], measured=to_unit(value_m), error=to_unit(err_m), required=req, unit=unit,
                status=status, source=rule["source"], last_verified=rule["last_verified"])


def report(scan, occupants=1, rel_error=None):
    m = json.loads((scan / "measurements.json").read_text())
    path = scan / "picks.json"
    picks = json.loads(path.read_text()) if path.exists() else []
    items = []
    for rule in json.loads(RULES.read_text()):
        if rule["measure"] in ("door", "hallway"):
            targets = [(p["name"], p["width_m"]) for p in picks if p["kind"] == rule["measure"]]
        else:
            targets = [(rule["label"], m.get(rule["measure"]))]
        items += [check(name, v, rule, rel_error, occupants) for name, v in targets]
    scale_path = scan / "depth" / "scale.json"
    scales = json.loads(scale_path.read_text()).values() if scale_path.exists() else []
    r = dict(created=datetime.now(timezone.utc).isoformat(timespec="seconds"), occupants=occupants,
             rel_error=rel_error, frames_scaled_to_slam=f"{sum(s is not None for s in scales)}/{len(scales)}",
             measurements=m, items=items)
    (scan / "report.json").write_text(json.dumps(r, indent=1))
    (scan / "report.html").write_text(render_html(r), encoding="utf-8")


def render_html(r):
    e = html.escape

    def measured(i):
        if i["measured"] is None:
            return "not measured"
        err = "unknown" if i["error"] is None else f"{i['error']:g}"
        return f"{i['measured']:g} ± {err} {UNIT_LABEL[i['unit']]}"

    rows = "\n".join(
        f"<tr><th scope=row>{e(i['item'])}</th><td>{measured(i)}</td>"
        f"<td>at least {i['required']:g} {UNIT_LABEL[i['unit']]}</td><td>{e(i['status'])}</td>"
        f"<td>{e(i['source'])} (checked: {e(i['last_verified'] or 'not yet')})</td></tr>" for i in r["items"])
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Home Lens room report</title>
<style>body{{font:16px/1.5 system-ui,sans-serif;max-width:60rem;margin:auto;padding:1rem;color:#111;background:#fff}}
table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid #555;padding:.4rem;text-align:left;vertical-align:top}}
caption{{text-align:left;font-weight:bold;padding:.4rem 0}}</style></head>
<body><main>
<h1>Room report</h1>
<p><strong>Information, not legal advice. Not a code inspection.</strong></p>
<p>Measured from a phone scan. Each value carries an error bar from a tape-measure calibration.
"cannot tell" means the error bar crosses the requirement, or the scan was not calibrated.</p>
<table><caption>Measurements against the rules table, {r['occupants']} occupant(s)</caption>
<thead><tr><th scope="col">Item</th><th scope="col">Measured</th><th scope="col">Required</th>
<th scope="col">Result</th><th scope="col">Source</th></tr></thead>
<tbody>
{rows}
</tbody></table>
<p>Frames scaled to the SLAM map: {r['frames_scaled_to_slam']}. Generated {e(r['created'])}.</p>
</main></body></html>
"""


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stage", choices=["poses", "depth", "fuse", "measure", "pick", "report", "all"])
    ap.add_argument("scan", type=Path, help="scan folder, e.g. data/bedroom1")
    ap.add_argument("--occupants", type=int, default=1)
    ap.add_argument("--rel-error", type=float,
                    help="relative error from the tape-measure calibration, e.g. 0.03; without it every check is 'cannot tell'")
    ap.add_argument("--name", default="bedroom door", help="pick: what the two points span")
    ap.add_argument("--kind", choices=["door", "hallway"], default="door", help="pick: which rule applies")
    a = ap.parse_args()
    if a.stage == "pick":
        pick(a.scan, a.name, a.kind)
    for name, stage in [("poses", poses), ("depth", depth), ("fuse", fuse), ("measure", measure)]:
        if a.stage in (name, "all"):  # pick is interactive, run it on its own before report
            stage(a.scan)
    if a.stage in ("report", "all"):
        report(a.scan, a.occupants, a.rel_error)
