"""Room-tag parsing and pose math, no network. Run: python scan/test_room_tags.py"""
import json

import cv2
import numpy as np

from room_tags import OBJECTS, ROOMS, parse_tags, pose, quat

# a good tag, an out-of-vocabulary one, a bad box, a box running off the photo, junk entries
reply = """Sure! {"tags": [
 {"room": "kitchen", "object": "Wall", "note": "grey scuff low on the wall", "box": [0.2, 0.5, 0.1, 0.05]},
 {"room": "garage", "object": "sofa", "note": "scratch", "box": [0.1, 0.1, 0.1, 0.1]},
 {"room": "hallway", "object": "door", "note": "dent", "box": [0.9, 0.9, 0.5, 0.5]},
 {"room": "hallway", "object": "door", "note": "chip", "box": "none"},
 {"room": "hallway", "object": "door", "note": "  ", "box": [0.1, 0.1, 0.1, 0.1]},
 "junk", {"note": "no room or object"}
]} trailing text"""
t = parse_tags(reply)
assert [x["note"] for x in t] == ["grey scuff low on the wall", "scratch", "dent", "chip", "no room or object"], t
assert t[0]["room"] == "kitchen" and t[0]["object"] == "wall" and t[0]["box"] == [0.2, 0.5, 0.1, 0.05]
assert t[1]["room"] == "other" and t[1]["object"] == "other"  # not in the schema's vocabulary
assert t[2]["box"] == [0.9, 0.9, 0.1, 0.1] or np.allclose(t[2]["box"], [0.9, 0.9, 0.1, 0.1])  # clipped to the photo
assert t[3]["box"] is None and t[4]["room"] == "other"
assert all(x["room"] in ROOMS and x["object"] in OBJECTS for x in t)
assert [x["room"] for x in parse_tags(reply, room="living room")] == ["living room"] * 5  # forced room
thinking = ('Format is {"tags": []} for none. Box {x, y} = top-left.\n```json\n'
            '{"tags": [{"room": "living room", "object": "other", "note": "scuffs on the sofa", "box": [0.4, 0.4, 0.1, 0.1]}]}\n```')
assert [x["note"] for x in parse_tags(thinking)] == ["scuffs on the sofa"]  # reasoning with braces before the answer
assert parse_tags('x {"tags": []} y\n```json\n{"tags": []}\n```') == []
assert parse_tags("no json here") == [] and parse_tags('{"tags": "x"}') == [] and parse_tags('{"tags": []}') == []

# quaternion: rebuild the rotation from it, including 180-degree turns that take the non-trace branch
def rot(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])

rng = np.random.default_rng(0)
for rv in [[0, 0, 0], [np.pi, 0, 0], [0, np.pi, 0], [0, 0, np.pi], *rng.normal(0, 1.5, (20, 3))]:
    R = cv2.Rodrigues(np.array(rv, float))[0]
    q = quat(R)
    assert abs(np.linalg.norm(q) - 1) < 1e-9 and np.allclose(rot(q), R, atol=1e-9), (rv, q)

c2w = np.eye(4)
c2w[:3, :3], c2w[:3, 3] = cv2.Rodrigues(np.array([0, 0.5, 0.0]))[0], [1.0, 2.0, 3.0]
p = pose(c2w)
assert len(p) == 7 and p[:3] == [1.0, 2.0, 3.0] and np.allclose(rot(p[3:]), c2w[:3, :3])
json.dumps(p)  # plain floats, serialisable
print("ok")
