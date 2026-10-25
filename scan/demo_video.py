"""Home Lens scan demo video (H.264 mp4, 1280x720, about 22 s) rendered from a real scan, nothing mocked.

The walk draws itself over the fused cloud, the confirmed tag appears, the move-out camera slides in, and the
move-out vs move-in crop comes up with compare's verdict. Needs a scan folder with cloud.ply, room-tags.json and a
finished compare run (compare/<photo stem>/compare.json + spot0.jpg). Needs ffmpeg on PATH.

Usage: python scan/demo_video.py data/<scan> --photo out.jpg [--out video.mp4] [--still 5.0 ...]
       --still T writes a PNG of second T instead of the video (to check framing quickly).
The video carries a small line saying the move-out image is a stand-in when you pass --standin.
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
DUR = 22.0
BG = (14, 18, 24)
FONT = lambda size, bold=False: ImageFont.truetype("C:/Windows/Fonts/" + ("segoeuib.ttf" if bold else "segoeui.ttf"), size)


def ease(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def build_scene(scan, photo):
    frames, _ = load_frames(scan)
    path = np.array([f["c2w"][:3, 3] for f in frames])
    pcd = o3d.io.read_point_cloud(str(scan / "cloud.ply"))
    p, c = np.asarray(pcd.points), np.clip(np.asarray(pcd.colors), 0, 1)
    keep = np.all((p >= path.min(0) - 4) & (p <= path.max(0) + 4), axis=1)
    cmp_dir = scan / "compare" / Path(photo).stem
    r = json.loads((cmp_dir / "compare.json").read_text())
    tag = next(t for t in json.loads((scan / "room-tags.json").read_text())["tags"] if t["confirmed"])
    return dict(p=p[keep], c=(c[keep][:, ::-1] * 255).astype(np.uint8), path=path, n_frames=len(frames), n_points=len(pcd.points),
                tag=np.array(tag["position"]), tag_note=tag["note"].rstrip("."), cam=np.array(r["camera"]),
                spot=r["spots"][0], crop=Image.open(cmp_dir / r["spots"][0]["crop"]).convert("RGB"))


def view_at(t, S):
    """(azimuth, elevation, distance, target) at second t: overview orbit, fly to the tag, orbit it from behind the camera."""
    centre, tag = S["path"].mean(0), S["tag"]
    az_cam = np.arctan2(S["cam"][0, 3] - tag[0], S["cam"][1, 3] - tag[1])
    k = [(0.0, np.radians(20), np.radians(48), 12.0, centre), (4.0, np.radians(100), np.radians(40), 9.5, centre),
         (8.0, az_cam, np.radians(26), 4.6, tag), (14.0, az_cam + np.radians(35), np.radians(20), 3.0, tag),
         (DUR, az_cam + np.radians(50), np.radians(18), 2.8, tag)]
    for (t0, *a), (t1, *b) in zip(k, k[1:]):
        if t <= t1:
            e = ease((t - t0) / (t1 - t0)) if t1 - t0 < 5 else (t - t0) / (t1 - t0)
            return tuple(np.asarray(x, float) * (1 - e) + np.asarray(y, float) * e for x, y in zip(a, b))
    return tuple(np.asarray(x, float) for x in k[-1][1:])


def render(S, t):
    az, el, dist, target = view_at(t, S)
    eye = target + dist * np.array([np.cos(el) * np.sin(az), np.cos(el) * np.cos(az), np.sin(el)])
    f = (target - eye) / np.linalg.norm(target - eye)
    r = np.cross(f, [0, 0, 1.0]); r /= np.linalg.norm(r); u = np.cross(r, f)
    F = 760.0
    cx = W * (0.5 - 0.11 * ease((t - 12.8) / 0.8) * ease((19.4 - t) / 0.6))  # slide the scene left while the crop panel is up

    def proj(q):
        d = np.atleast_2d(q) - eye; z = d @ f
        return np.c_[cx + F * (d @ r) / z, H / 2 - F * (d @ u) / z], z

    uv, z = proj(S["p"]); ok = z > 0.3
    order = np.argsort(-z[ok]); uvi = uv[ok][order].round().astype(int); col = S["c"][ok][order]
    img = np.empty((H, W, 3), np.uint8); img[:] = BG[::-1]
    for dx in range(2 if dist > 6 else 3):
        for dy in range(2 if dist > 6 else 3):
            x, y = uvi[:, 0] + dx, uvi[:, 1] + dy; m = (x >= 0) & (x < W) & (y >= 0) & (y < H)
            img[y[m], x[m]] = col[m]
    # the walk draws itself during the first 4 s
    n = max(2, int(len(S["path"]) * ease(t / 4.0))) if t < 4.0 else len(S["path"])
    pu, pz = proj(S["path"][:n]); good = pz > 0.3
    if good.sum() > 1:
        cv2.polylines(img, [pu[good].round().astype(np.int32).reshape(-1, 1, 2)], False, (255, 215, 120), 3, cv2.LINE_AA)
    if t >= 4.0:  # confirmed tag, pulsing
        q, qz = proj(S["tag"]); q = tuple(q[0].round().astype(int)); g = ease((t - 4.0) / 0.5)
        pulse = 14 + 5 * np.sin(2 * np.pi * (t - 4.0) * 0.9)
        cv2.circle(img, q, int((pulse + 14) * g), (0, 0, 0), 5, cv2.LINE_AA); cv2.circle(img, q, int((pulse + 14) * g), (61, 200, 255), 3, cv2.LINE_AA)
        cv2.circle(img, q, int(9 * g), (61, 200, 255), -1, cv2.LINE_AA)
    if t >= 8.0:  # the move-out photo's camera arrives
        s = ease((t - 8.0) / 0.8); c2w = S["cam"]; c = c2w[:3, 3]
        corners = [c + s * (0.5 * c2w[:3, 2] + 0.3 * a * c2w[:3, 0] - 0.22 * b * c2w[:3, 1]) for a, b in [(1, 1), (-1, 1), (-1, -1), (1, -1)]]
        pc, _ = proj(c); pk, _ = proj(np.array(corners)); pc = pc[0]
        for k in range(4):
            cv2.line(img, tuple(pc.round().astype(int)), tuple(pk[k].round().astype(int)), (255, 210, 60), 3, cv2.LINE_AA)
            cv2.line(img, tuple(pk[k].round().astype(int)), tuple(pk[(k + 1) % 4].round().astype(int)), (255, 210, 60), 3, cv2.LINE_AA)
        q, _ = proj(S["tag"]); a, b = pc, q[0]
        for i in range(0, 20, 2):  # dashed ray to the tag
            p0, p1 = a + (b - a) * i / 20, a + (b - a) * (i + 1) / 20
            cv2.line(img, tuple(p0.round().astype(int)), tuple(p1.round().astype(int)), (255, 210, 60), 2, cv2.LINE_AA)
    return img


def text_layer(S, t, standin):
    lay = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    caps = [(0.0, 3.8, "Move-in: one slow walk", f"{S['n_frames']} keyframes · {S['n_points']:,} points"),
            (3.8, 7.8, "The AI finds the damage. You confirm it.", S["tag_note"].capitalize()),
            (7.8, 13.2, "Move-out: a new photo is placed in the same map", "Placed by matching it to the move-in video"),
            (13.2, 19.0, "The same spot, before and after", None)]
    for a, b, head, sub in caps:
        if a <= t < b:
            al = int(255 * min(ease((t - a) / 0.4), ease((b - t) / 0.4)))
            d.rectangle([0, H - 150, W, H], fill=(8, 11, 16, int(al * 0.72)))
            d.text((56, H - 128), head, font=FONT(44, True), fill=(255, 255, 255, al))
            if sub:
                d.text((58, H - 70), sub, font=FONT(28), fill=(190, 205, 225, al))
    if 13.2 <= t < 19.0:
        slide = ease((t - 13.2) / 0.6) * ease((19.0 - t) / 0.4)
        crop = S["crop"]; pw = 520; ph = int(crop.height * pw / crop.width); crop = crop.resize((pw, ph))
        x = int(W - (pw + 48) * slide); y = 48
        d.rounded_rectangle([x - 12, y - 12, x + pw + 12, y + ph + (190 if standin else 128)], radius=14, fill=(8, 11, 16, 240))
        lay.paste(crop, (x, y))
        d.text((x + 4, y + ph + 8), "Move-out", font=FONT(24, True), fill=(255, 255, 255, 255))
        d.text((x + pw // 2 + 8, y + ph + 8), "Move-in", font=FONT(24, True), fill=(255, 255, 255, 255))
        near = S["spot"]["nearby_tags"]
        verdict = "Possible match, confirm" if near else "No move-in tag near this spot"
        d.text((x + 4, y + ph + 44), verdict, font=FONT(30, True), fill=(110, 220, 150, 255) if near else (230, 184, 90, 255))
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


def frame_at(S, t, standin):
    base = Image.fromarray(cv2.cvtColor(render(S, t), cv2.COLOR_BGR2RGB)).convert("RGBA")
    return np.asarray(Image.alpha_composite(base, text_layer(S, t, standin)).convert("RGB"))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("scan", type=Path)
    ap.add_argument("--photo", type=Path, required=True)
    ap.add_argument("--out", type=Path)
    ap.add_argument("--still", type=float, nargs="*")
    ap.add_argument("--standin", action="store_true")
    a = ap.parse_args()
    S = build_scene(a.scan, a.photo)
    if a.still:
        for t in a.still:
            Image.fromarray(frame_at(S, t, a.standin)).save(a.scan / "demo" / f"still_{t:g}.png")
        raise SystemExit
    ffmpeg = shutil.which("ffmpeg") or exit("ffmpeg not found on PATH")
    out = a.out or a.scan / "demo" / "home-lens-vslam.mp4"
    out.parent.mkdir(exist_ok=True)
    proc = subprocess.Popen([ffmpeg, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
                             "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", "-movflags", "+faststart", str(out)],
                            stdin=subprocess.PIPE)
    for i in range(int(DUR * FPS)):
        proc.stdin.write(frame_at(S, i / FPS, a.standin).tobytes())
    proc.stdin.close()
    print(out, "exit", proc.wait())
