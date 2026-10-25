"""Damage compare on a synthetic textured wall 3 m away. Run: python scan/test_compare.py

Move-in: 3 keyframes of the wall, a scuff at W1. Move-out: a smaller, darker photo from a new spot with the
same scuff at W1 and a new stain at W2. Expect: the box on W1 is placed within 10 cm and matches the tag,
the box on W2 matches nothing, noise cannot be placed.
"""
import json
import tempfile
from pathlib import Path

import cv2
import numpy as np
import open3d as o3d

from compare import compare, place
from pipeline import GL_TO_CV

rng = np.random.default_rng(0)
WALL_Z, S = 3.0, 200  # wall plane z = 3 m; texture is 200 px per metre, 6.4 x 4.8 m, origin at its centre
W1, W2, W3 = (0.5, -0.3), (-1.3, 0.6), (1.0, 0.5)  # scuff (tagged), new stain, a second tagged mark
K = np.array([[500.0, 0, 320], [0, 500, 240], [0, 0, 1]])


def texture():
    t = np.zeros((960, 1280, 3), np.float32)
    for c in range(3):
        n = rng.normal(0, 1, (960, 1280)).astype(np.float32)
        t[..., c] = cv2.GaussianBlur(n, (0, 0), 3) * 4 + cv2.GaussianBlur(n, (0, 0), 12) * 12
    t = np.clip(128 + 60 * t, 0, 255).astype(np.uint8)
    for _ in range(80):
        cv2.circle(t, tuple(int(v) for v in rng.integers(0, [1280, 960])), int(rng.integers(8, 30)),
                   tuple(int(v) for v in rng.integers(0, 255, 3)), -1)
    return t


def mark(tex, w, r=25):
    out = tex.copy()
    cv2.circle(out, (int(S * w[0] + 640), int(S * w[1] + 480)), r, (20, 30, 60), -1)
    return out


def pose(cx, cy, cz, yaw):
    c2w = np.eye(4)
    c2w[:3, :3] = cv2.Rodrigues(np.array([0, np.radians(yaw), 0.0]))[0]
    c2w[:3, 3] = [cx, cy, cz]
    return c2w


def render(tex, c2w, K, size):
    w2c = np.linalg.inv(c2w)
    M = K @ np.c_[w2c[:3, 0], w2c[:3, 1], w2c[:3, 2] * WALL_Z + w2c[:3, 3]]
    T = np.array([[S, 0, 640], [0, S, 480], [0, 0, 1.0]])
    return cv2.warpPerspective(tex, M @ np.linalg.inv(T), size)


def depth_of(c2w, K, size):
    u, v = np.meshgrid(np.arange(size[0]), np.arange(size[1]))
    d = np.einsum("ij,hwj->hwi", c2w[:3, :3], np.stack([u, v, np.ones_like(u)], -1) @ np.linalg.inv(K).T)
    return ((WALL_Z - c2w[2, 3]) / d[..., 2]).astype(np.float32)


def project(w, c2w, K):
    p = K @ (np.linalg.inv(c2w) @ [w[0], w[1], WALL_Z, 1])[:3]
    return p[:2] / p[2]


def box_at(w, c2w, K, r=30):
    u, v = project(w, c2w, K)
    return [u - r, v - r, u + r, v + r]


base = texture()
move_in = mark(mark(base, W1), W3)
move_out = mark(mark(mark(base, W1), W3), W2)
poses = [pose(0, 0, 0, 0), pose(0.4, 0, 0, 4), pose(-0.4, 0.1, 0, -4)]

with tempfile.TemporaryDirectory() as tmp:
    scan = Path(tmp)
    (scan / "sai" / "images").mkdir(parents=True)
    (scan / "depth").mkdir()
    frames = []
    for i, c2w in enumerate(poses):
        cv2.imwrite(str(scan / "sai" / "images" / f"kf{i}.jpg"), render(move_in, c2w, K, (640, 480)))
        np.save(scan / "depth" / f"kf{i}.npy", depth_of(c2w, K, (640, 480)))
        frames.append(dict(file_path=f"images/kf{i}.jpg", transform_matrix=(c2w @ GL_TO_CV).tolist()))
    (scan / "sai" / "transforms.json").write_text(json.dumps(
        dict(fl_x=500, fl_y=500, cx=320, cy=240, frames=frames)))
    (scan / "depth" / "scale.json").write_text(json.dumps({f"kf{i}": 1.0 for i in range(3)}))
    grid = np.array([(x, y, WALL_Z) for x in np.arange(-3, 3, 0.02) for y in np.arange(-2, 2, 0.02)])
    o3d.io.write_point_cloud(str(scan / "cloud.ply"), o3d.geometry.PointCloud(o3d.utility.Vector3dVector(grid)))
    (scan / "tags.json").write_text(json.dumps([
        dict(id="t1", frame="kf0", box=box_at(W1, poses[0], K), label="scuff on wall"),
        dict(id="t3", frame="kf1", box=box_at(W3, poses[1], K), label="mark by window")]))
    place(scan)
    tags = json.loads((scan / "tags3d.json").read_text())
    for t, w in zip(tags, (W1, W3)):
        assert np.linalg.norm(np.array(t["position"]) - [*w, WALL_Z]) < 0.05, t

    # move-out photo: new spot, 0.75x resolution (so the intrinsics rescale), darker
    Kp = K.copy()
    Kp[:2] *= 0.75
    pc2w = pose(0.15, -0.1, 0.3, 2)
    photo = (render(move_out, pc2w, Kp, (480, 360)) * 0.85).astype(np.uint8)
    cv2.imwrite(str(scan / "out.jpg"), photo)
    r = compare(scan, scan / "out.jpg", [box_at(W1, pc2w, Kp), box_at(W2, pc2w, Kp)])
    print(json.dumps(r, indent=1))
    assert r["status"] == "placed", r
    old, new = r["spots"]
    assert np.linalg.norm(np.array(old["position"]) - [*W1, WALL_Z]) < 0.1, old
    assert [t["id"] for t in old["nearby_tags"]] == ["t1"] and old["status"] == "possible match, confirm", old
    assert np.linalg.norm(np.array(new["position"]) - [*W2, WALL_Z]) < 0.1, new
    assert not new["nearby_tags"] and new["status"] == "no move-in tag near this spot", new
    assert (scan / "compare" / "out" / "spot0.jpg").exists()

    noise = rng.integers(0, 255, (360, 480, 3)).astype(np.uint8)
    cv2.imwrite(str(scan / "noise.jpg"), noise)
    assert compare(scan, scan / "noise.jpg", [[0, 0, 50, 50]])["status"].startswith("cannot place")

print("ok")
