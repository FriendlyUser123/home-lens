"""Measurement math on a synthetic 3.0 x 3.6 x 2.4 m room. Run: python scan/test_measure.py"""
import json
import tempfile
from pathlib import Path

import numpy as np
import open3d as o3d

from pipeline import check, measure_points, report

rng = np.random.default_rng(0)
o3d.utility.random.seed(0)


def box_faces(x0, x1, y0, y1, z0, z1, n):
    """n random points on each face of an axis-aligned box."""
    u = lambda a, b: rng.uniform(a, b, n)
    full = lambda v: np.full(n, v)
    return np.vstack([np.c_[u(x0, x1), u(y0, y1), full(z0)], np.c_[u(x0, x1), u(y0, y1), full(z1)],
                      np.c_[full(x0), u(y0, y1), u(z0, z1)], np.c_[full(x1), u(y0, y1), u(z0, z1)],
                      np.c_[u(x0, x1), full(y0), u(z0, z1)], np.c_[u(x0, x1), full(y1), u(z0, z1)]])


room = box_faces(0, 3.0, 0, 3.6, 0, 2.4, 8000)
bed = box_faces(0.1, 1.1, 0.1, 2.1, 0, 0.5, 1500)  # clutter with a flat top between floor and ceiling
pts = np.vstack([room, bed]) + rng.normal(0, 0.005, (len(room) + len(bed), 3))

# arbitrary world frame: tilt + yaw + offset, and an "up" guess 8 degrees off, like the camera estimate
R = o3d.geometry.get_rotation_matrix_from_xyz([0.3, -0.2, 1.1])
pts = pts @ R.T + [5, -2, 1]
true_up = R @ [0, 0, 1]
guess = true_up + np.tan(np.radians(8)) * np.cross(true_up, [1, 0, 0]) / np.linalg.norm(np.cross(true_up, [1, 0, 0]))

m = measure_points(pts, guess / np.linalg.norm(guess))
print(json.dumps(m, indent=1))
assert abs(m["ceiling_height_m"] - 2.4) < 0.02, m
assert abs(m["min_dimension_m"] - 3.0) < 0.03, m
assert abs(m["max_dimension_m"] - 3.6) < 0.03, m
assert abs(m["floor_area_m2"] - 10.8) < 0.2, m

area = {"id": "a", "unit": "ft2", "min": 70, "min_per_occupant_if_shared": 50, "source": "s", "last_verified": None}
door = {"id": "d", "unit": "in", "min": 32, "source": "s", "last_verified": None}
assert check("x", 10.8, area, 0.03, 1)["status"] == "pass"         # 116 sq ft vs 70
assert check("x", 10.8, area, 0.03, 2)["status"] == "pass"         # vs 100
assert check("x", 10.8, area, 0.03, 3)["status"] == "fail"         # vs 150
assert check("x", 6.6, area, 0.03, 1)["status"] == "cannot tell"   # 71 sq ft, error bar crosses 70
assert check("x", 10.8, area, None, 1)["status"] == "cannot tell"  # uncalibrated
assert check("x", None, area, 0.03, 1)["status"] == "cannot tell"  # not measured
assert check("x", 0.76, door, 0.02, 1)["status"] == "fail"         # 29.9 in
assert check("x", 0.86, door, 0.02, 1)["status"] == "pass"         # 33.9 in

with tempfile.TemporaryDirectory() as d:
    scan = Path(d)
    (scan / "measurements.json").write_text(json.dumps(m))
    (scan / "picks.json").write_text(json.dumps([{"name": "bedroom door", "kind": "door", "width_m": 0.86}]))
    report(scan, occupants=2, rel_error=0.03)
    r = json.loads((scan / "report.json").read_text())
    assert [i["status"] for i in r["items"]] == ["pass", "pass", "pass", "pass"], r["items"]
    assert "bedroom door" in (scan / "report.html").read_text(encoding="utf-8")
print("ok")
