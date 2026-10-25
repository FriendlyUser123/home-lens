"""Home Lens scan demo video (H.264 mp4, 1280x720, 30 s) rendered from a real scan, nothing mocked.

Part 1 (12 s): the map is built. Each keyframe adds the depth the camera saw, placed with that keyframe's tracked
pose, then the raw layers dissolve into the fused cloud. Part 2 (18 s): the AI's confirmed tag appears (the photo
with its box), the move-out camera slides in, and the move-out vs move-in crop comes up with compare's verdict.

Needs a scan folder with sai/, depth/ and cloud.ply (pipeline.py: poses, depth, fuse), room-tags.json with a confirmed
tag, and a finished compare run (compare/<photo stem>/compare.json + spot0.jpg). Needs ffmpeg on PATH.

Usage: python scan/demo_video.py data/<scan> --photo out.jpg [--out video.mp4] [--standin] [--part2-only] [--still T ...]
       --still T writes a PNG of second T instead of the video (to check framing quickly).
       --standin adds a small line saying the move-out image is a stand-in for a phone photo.
       --part2-only renders the 22 s clip without the build-up.
"""
import argparse
import json
import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np
import open3d as o3d
from PIL import Image, ImageDraw, ImageFont

from pipeline import load_frames

W, H, FPS = 1280, 720, 30
DUR2, SKIP, BUILD = 22.0, 4.0, 12.0  # part 2 runs 22 s alone; stitched, its first 4 s (a restatement of the build) are dropped
BG = (14, 18, 24)
PATH_BGR, FRUSTUM_BGR, TAG_BGR = (255, 215, 120), (255, 210, 60), (61, 200, 255)
FONT = lambda size, bold=False: ImageFont.truetype("C:/Windows/Fonts/" + ("segoeuib.ttf" if bold else "segoeui.ttf"), size)


def ease(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def keyframe_points(scan, frames, lo, hi, stride=18):
    """What each keyframe contributes: its depth (scaled like fuse does) back-projected with its pose, coloured from its photo."""
    scales = json.loads((scan / "depth" / "scale.json").read_text())
    P, C, I, thumbs = [], [], [], []
    for i, f in enumerate(frames):
        stem = f["image"].stem
        d = np.load(scan / "depth" / f"{stem}.npy")[::stride, ::stride] * (scales[stem] or 1.0)
        img = cv2.imread(str(f["image"]))
        vs, us = np.mgrid[0:d.shape[0], 0:d.shape[1]] * stride
        z, K = d.ravel(), f["K"]
        cam = np.c_[(us.ravel() - K[0, 2]) / K[0, 0] * z, (vs.ravel() - K[1, 2]) / K[1, 1] * z, z]
        pts = cam @ f["c2w"][:3, :3].T + f["c2w"][:3, 3]
        ok = (z > 0.1) & (z < 5.0) & np.all((pts >= lo) & (pts <= hi), axis=1)
        P.append(pts[ok]); C.append(img[::stride, ::stride].reshape(-1, 3)[ok]); I.append(np.full(int(ok.sum()), i))
        thumbs.append(Image.fromarray(cv2.cvtColor(cv2.resize(img, (360, 270)), cv2.COLOR_BGR2RGB)))
    return np.vstack(P), np.vstack(C), np.concatenate(I), thumbs


def build_scene(scan, photo):
    frames, _ = load_frames(scan)
    path = np.array([f["c2w"][:3, 3] for f in frames])
    lo, hi = path.min(0) - 4, path.max(0) + 4
    pcd = o3d.io.read_point_cloud(str(scan / "cloud.ply"))
    p, c = np.asarray(pcd.points), np.clip(np.asarray(pcd.colors), 0, 1)
    keep = np.all((p >= lo) & (p <= hi), axis=1)
    cmp_dir = scan / "compare" / Path(photo).stem
    r = json.loads((cmp_dir / "compare.json").read_text())
    tag = next(t for t in json.loads((scan / "room-tags.json").read_text())["tags"] if t["confirmed"])
    kp, kc, ki, thumbs = keyframe_points(scan, frames, lo, hi)
    return dict(p=p[keep], c=(c[keep][:, ::-1] * 255).astype(np.uint8), path=path, frames=frames, n_frames=len(frames),
                n_points=len(pcd.points), kp=kp, kc=kc, ki=ki, thumbs=thumbs,
                tag=np.array(tag["position"]), tag_note=tag["note"].rstrip("."), tag_id=tag["id"], tag_box=tag["box"],
                tag_img=Image.open(scan / tag["photo"]).convert("RGB"), cam=np.array(r["camera"]),
                spot=r["spots"][0], crop=Image.open(cmp_dir / r["spots"][0]["crop"]).convert("RGB"))


def view_at(t, S):
    """(azimuth, elevation, distance, target) at part-2 second t: overview, fly to the tag, orbit it from behind the camera."""
    centre, tag = S["path"].mean(0), S["tag"]
    az_cam = np.arctan2(S["cam"][0, 3] - tag[0], S["cam"][1, 3] - tag[1])
    k = [(0.0, np.radians(20), np.radians(48), 12.0, centre), (4.0, np.radians(100), np.radians(40), 9.5, centre),
         (8.0, az_cam, np.radians(26), 4.6, tag), (14.0, az_cam + np.radians(35), np.radians(20), 3.0, tag),
         (DUR2, az_cam + np.radians(50), np.radians(18), 2.8, tag)]
    for (t0, *a), (t1, *b) in zip(k, k[1:]):
        if t <= t1:
            e = ease((t - t0) / (t1 - t0)) if t1 - t0 < 5 else (t - t0) / (t1 - t0)
            return tuple(np.asarray(x, float) * (1 - e) + np.asarray(y, float) * e for x, y in zip(a, b))
    return tuple(np.asarray(x, float) for x in k[-1][1:])


def raster(P, C, view, cx=W / 2, hi=None):
    """Splat coloured points far-to-near. Returns the BGR image and a projector (3D -> pixels, depth) for overlays."""
    az, el, dist, target = (float(view[0]), float(view[1]), float(view[2]), np.asarray(view[3], float))
    eye = target + dist * np.array([np.cos(el) * np.sin(az), np.cos(el) * np.cos(az), np.sin(el)])
    f = (target - eye) / np.linalg.norm(target - eye)
    r = np.cross(f, [0, 0, 1.0]); r /= np.linalg.norm(r); u = np.cross(r, f)

    def proj(q):
        d = np.atleast_2d(q) - eye; z = d @ f
        return np.c_[cx + 760.0 * (d @ r) / z, H / 2 - 760.0 * (d @ u) / z], z

    uv, z = proj(P); ok = z > 0.3
    order = np.argsort(-z[ok]); uvi = uv[ok][order].round().astype(int); col = C[ok][order]
    if hi is not None:
        col = np.where(hi[ok][order][:, None], (0.35 * col + 0.65 * np.array(PATH_BGR)).astype(np.uint8), col)
    img = np.empty((H, W, 3), np.uint8); img[:] = BG[::-1]
    n = 2 if dist > 6 else 3
    for dx in range(n):
        for dy in range(n):
            x, y = uvi[:, 0] + dx, uvi[:, 1] + dy; m = (x >= 0) & (x < W) & (y >= 0) & (y < H)
            img[y[m], x[m]] = col[m]
    return img, proj


def polyline(img, proj, pts, color, thick=3):
    pu, pz = proj(pts); good = pz > 0.3
    if good.sum() > 1:
        cv2.polylines(img, [pu[good].round().astype(np.int32).reshape(-1, 1, 2)], False, color, thick, cv2.LINE_AA)


def frustum(img, proj, c2w, size, color):
    c = c2w[:3, 3]
    corners = np.array([c + size * (0.5 * c2w[:3, 2] + 0.3 * a * c2w[:3, 0] - 0.22 * b * c2w[:3, 1]) for a, b in [(1, 1), (-1, 1), (-1, -1), (1, -1)]])
    pc, _ = proj(c); pk, _ = proj(corners); pc = tuple(pc[0].round().astype(int))
    for k in range(4):
        cv2.line(img, pc, tuple(pk[k].round().astype(int)), color, 3, cv2.LINE_AA)
        cv2.line(img, tuple(pk[k].round().astype(int)), tuple(pk[(k + 1) % 4].round().astype(int)), color, 3, cv2.LINE_AA)
    return np.array(pc, float)


def render_part2(S, t):
    cx = W * (0.5 - 0.11 * ease((t - 12.8) / 0.8) * ease((19.4 - t) / 0.6))  # slide the scene left while the crop panel is up
    img, proj = raster(S["p"], S["c"], view_at(t, S), cx)
    polyline(img, proj, S["path"], PATH_BGR)
    if t >= 4.0:  # confirmed tag, pulsing
        q = tuple(proj(S["tag"])[0][0].round().astype(int)); g = ease((t - 4.0) / 0.5)
        pulse = 14 + 5 * np.sin(2 * np.pi * (t - 4.0) * 0.9)
        cv2.circle(img, q, int((pulse + 14) * g), (0, 0, 0), 5, cv2.LINE_AA); cv2.circle(img, q, int((pulse + 14) * g), TAG_BGR, 3, cv2.LINE_AA)
        cv2.circle(img, q, int(9 * g), TAG_BGR, -1, cv2.LINE_AA)
    if t >= 8.0:  # the move-out photo's camera arrives, with a dashed ray to the tag
        a = frustum(img, proj, S["cam"], ease((t - 8.0) / 0.8), FRUSTUM_BGR); b = proj(S["tag"])[0][0]
        for i in range(0, 20, 2):
            p0, p1 = a + (b - a) * i / 20, a + (b - a) * (i + 1) / 20
            cv2.line(img, tuple(p0.round().astype(int)), tuple(p1.round().astype(int)), FRUSTUM_BGR, 2, cv2.LINE_AA)
    return img


def render_build(S, t):
    """Part 1: keyframes arrive one by one; the newest layer glows. From 10.6 s the raw layers dissolve into the fused cloud."""
    n = S["n_frames"]; prog = min(max((t - 0.6) / 9.8, 0.0), 1.0); i = min(n - 1, int(prog * n))
    view = (np.radians(-60 + 160 * ease(t / BUILD)), np.radians(52 - 12 * ease(t / BUILD)), 12.0 - 2.5 * ease(t / BUILD), S["path"].mean(0))
    m = S["ki"] <= i
    img, proj = raster(S["kp"][m], S["kc"][m], view, hi=(S["ki"][m] >= i - 1) if t < 10.6 else None)
    polyline(img, proj, S["path"][:i + 1], PATH_BGR)
    frustum(img, proj, S["frames"][i]["c2w"], 1.0, FRUSTUM_BGR)
    if t >= 10.6:
        fused, fproj = raster(S["p"], S["c"], view_at(SKIP, S))
        polyline(fused, fproj, S["path"], PATH_BGR)
        a = ease((t - 10.6) / 1.2)
        img = cv2.addWeighted(img, 1 - a, fused, a, 0)
    return img, i, prog


def capbar(d, al, head, sub=None):
    d.rectangle([0, H - 150, W, H], fill=(8, 11, 16, int(al * 0.72)))
    d.text((56, H - 128), head, font=FONT(44, True), fill=(255, 255, 255, al))
    if sub:
        d.text((58, H - 70), sub, font=FONT(28), fill=(190, 205, 225, al))


def layer_build(S, t, i, prog):
    lay = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    fade = int(255 * min(ease(t / 0.5), 1.0))
    if t < 10.6:
        capbar(d, fade, "Building the map", f"Keyframe {i + 1} of {S['n_frames']}: depth from a model, placed using the phone's motion tracking")
        d.rectangle([0, H - 156, int(W * prog), H - 150], fill=(*TAG_BGR[::-1], 255))
        th = S["thumbs"][i]; d.rounded_rectangle([34, 34, 34 + th.width + 24, 34 + th.height + 24], radius=12, fill=(8, 11, 16, 235))
        lay.paste(th, (46, 46))
    else:
        capbar(d, int(255 * ease((t - 10.6) / 0.4)), "One map of the room", f"{S['n_points']:,} points fused from {S['n_frames']} keyframes")
    return lay


def layer_part2(S, t, standin):
    lay = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    caps = [(3.8, 7.8, "The AI finds the damage. You confirm it.", S["tag_note"].capitalize()),
            (7.8, 13.2, "Move-out: a new photo is placed in the same map", "Placed by matching it to the move-in video"),
            (13.2, 19.0, "The same spot, before and after", None)]
    for a, b, head, sub in caps:
        if a <= t < b:
            capbar(d, int(255 * min(ease((t - a) / 0.4), ease((b - t) / 0.4))), head, sub)
    if 4.0 <= t < 7.8:  # the move-in photo with the box the AI drew, and the renter's confirmation
        slide = ease((t - 4.0) / 0.5) * ease((7.8 - t) / 0.4)
        im = S["tag_img"]; pw = 440; ph = int(im.height * pw / im.width); im = im.resize((pw, ph))
        x = int(-(pw + 60) + (pw + 82) * slide); y = 40
        d.rounded_rectangle([x - 12, y - 12, x + pw + 12, y + ph + 92], radius=14, fill=(8, 11, 16, 240))
        lay.paste(im, (x, y))
        bx, by, bw, bh = S["tag_box"]; g = ease((t - 4.6) / 0.6)
        if g > 0:
            pad = (1 - g) * 40
            d.rectangle([x + bx * pw - pad, y + by * ph - pad, x + (bx + bw) * pw + pad, y + (by + bh) * ph + pad], outline=(255, 200, 61, int(255 * g)), width=4)
        d.text((x + 4, y + ph + 8), f"Tag {S['tag_id']}", font=FONT(26, True), fill=(255, 255, 255, 255))
        if t >= 6.0:
            d.text((x + 4, y + ph + 44), "Confirmed by the renter", font=FONT(24, True), fill=(110, 220, 150, int(255 * ease((t - 6.0) / 0.4))))
    if 13.2 <= t < 19.0:
        slide = ease((t - 13.2) / 0.6) * ease((19.0 - t) / 0.4)
        crop = S["crop"]; pw = 520; ph = int(crop.height * pw / crop.width); crop = crop.resize((pw, ph))
        x = int(W - (pw + 48) * slide); y = 48
        d.rounded_rectangle([x - 12, y - 12, x + pw + 12, y + ph + (190 if standin else 128)], radius=14, fill=(8, 11, 16, 240))
        lay.paste(crop, (x, y))
        d.text((x + 4, y + ph + 8), "Move-out", font=FONT(24, True), fill=(255, 255, 255, 255))
        d.text((x + pw // 2 + 8, y + ph + 8), "Move-in", font=FONT(24, True), fill=(255, 255, 255, 255))
        near = S["spot"]["nearby_tags"]
        d.text((x + 4, y + ph + 44), "Possible match, confirm" if near else "No move-in tag near this spot", font=FONT(30, True),
               fill=(110, 220, 150, 255) if near else (230, 184, 90, 255))
        if near:
            d.text((x + 4, y + ph + 82), f"{near[0]['distance_m'] * 100:.0f} cm from the move-in tag", font=FONT(24), fill=(190, 205, 225, 255))
        if standin:
            d.text((x + 4, y + ph + 124), "Move-out image: a frame from the walkthrough video,", font=FONT(19), fill=(175, 190, 210, 255))
            d.text((x + 4, y + ph + 150), "standing in for a phone photo.", font=FONT(19), fill=(175, 190, 210, 255))
    if t >= 19.0:
        al = int(255 * ease((t - 19.0) / 0.8))
        d.rectangle([0, 0, W, H], fill=(8, 11, 16, int(al * 0.88)))
        d.text((W // 2, H // 2 - 50), "Home Lens", font=FONT(84, True), fill=(255, 255, 255, al), anchor="mm")
        d.text((W // 2, H // 2 + 36), "The AI proposes. You confirm. Code does the rest.", font=FONT(34), fill=(190, 205, 225, al), anchor="mm")
        d.text((W // 2, H // 2 + 96), "Information, not legal advice.", font=FONT(26), fill=(150, 165, 185, al), anchor="mm")
    return lay


def frame_at(S, t, standin, build):
    """Global second t -> RGB frame. With the build-up, part 2 starts after BUILD seconds, SKIP seconds into its own clock."""
    if build and t < BUILD:
        img, i, prog = render_build(S, t); lay = layer_build(S, t, i, prog)
    else:
        t2 = t - BUILD + SKIP if build else t
        img, lay = render_part2(S, t2), layer_part2(S, t2, standin)
    base = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB)).convert("RGBA")
    return np.asarray(Image.alpha_composite(base, lay).convert("RGB"))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("scan", type=Path)
    ap.add_argument("--photo", type=Path, required=True)
    ap.add_argument("--out", type=Path)
    ap.add_argument("--still", type=float, nargs="*")
    ap.add_argument("--standin", action="store_true")
    ap.add_argument("--part2-only", action="store_true")
    a = ap.parse_args()
    build = not a.part2_only
    S = build_scene(a.scan, a.photo)
    (a.scan / "demo").mkdir(exist_ok=True)
    if a.still:
        for t in a.still:
            Image.fromarray(frame_at(S, t, a.standin, build)).save(a.scan / "demo" / f"still_{t:g}.png")
        raise SystemExit
    ffmpeg = shutil.which("ffmpeg") or exit("ffmpeg not found on PATH")
    out = a.out or a.scan / "demo" / ("home-lens-vslam-full.mp4" if build else "home-lens-vslam.mp4")
    total = BUILD + DUR2 - SKIP if build else DUR2
    proc = subprocess.Popen([ffmpeg, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
                             "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", "-movflags", "+faststart", str(out)],
                            stdin=subprocess.PIPE)
    for k in range(int(total * FPS)):
        proc.stdin.write(frame_at(S, k / FPS, a.standin, build).tobytes())
    proc.stdin.close()
    print(out, "exit", proc.wait())
