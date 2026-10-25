# Home Lens room scan (move-in map and damage compare)

Part of [Home Lens](../README.md), built at GDG Build with AI × Hacktoberfest 2026 (Virginia Tech, theme: AI for Housing).

The renter walks a room once with a phone at move-in. This folder turns that walk into a 3D map, finds damage that is already there, and later checks a move-out photo against the same spot. It feeds the rest of the app through the shared `room-tags.json` (see `../shared/room-tags.schema.json`).

**Model:** Gemma 4, `gemma-4-26b-a4b-it`, through the Gemini API. Gemma only looks at photos. Code does all the geometry, and the renter confirms every result. Nothing here decides what is damage, what is normal wear and tear, or what a charge should be.

## What it does

1. **Map.** A phone recording (Spectacular Rec app) becomes camera poses with real scale, per-frame depth, and a fused point cloud of the room.
2. **Tag.** Gemma looks at about 12 sharp frames from the walk and lists clearly visible damage with a box. Code adds the camera pose and ray-casts the box into the cloud to get the tag's 3D spot. Every tag starts `confirmed: false`. The renter confirms or removes each one.
3. **Compare.** At move-out, the renter photographs a spot and boxes it. Code finds where that photo was taken in the move-in map, ray-casts the box, and lists confirmed tags within a set distance. It saves the move-in and move-out views side by side. The answer is only "possible match, confirm". It never says the damage is the same, or that it is or is not wear and tear.

```
recording ──poses──▶ keyframes + poses ──depth──▶ depth maps ──fuse──▶ cloud.ply
                                                                          │
keyframes ──Gemma (damage + box)──▶ room_tags.py ──ray cast──▶ room-tags.json ──renter confirms
                                                                          │
move-out photo + box ──compare.py (SIFT + PnP, ray cast)──▶ "possible match, confirm" + side-by-side crop
```

## What is AI and what is code

| Step | Who |
|---|---|
| Name visible damage, draw a box on one photo | Gemma 4 (`room_tags.py`) |
| Camera poses, depth scale, 3D fusion | `sai-cli` + Depth Anything V2 + Open3D |
| 3D position of a tag, placing a photo in the map, nearby-tag check | Plain code (`room_tags.py`, `compare.py`) |
| Is it damage? Is it wear and tear? Who pays? | The renter and the law, never this tool |

Every Gemma reply is saved next to the scan (`room-tags/<frame>.raw.txt`), so each tag traces to a model answer. A box that does not hit the map gets no 3D position instead of a guessed one.

## Setup

Python **3.12** (the pose tool has no wheels for newer versions).

```bash
python -m venv .venv
.venv/Scripts/activate            # Windows; on Linux/macOS: source .venv/bin/activate
pip install -r scan/requirements.txt
pip install "spectacularAI[full]" # provides sai-cli; proprietary, see Licences
```

The depth model downloads from Hugging Face on first run. A GPU helps; we ran it on an 8 GB laptop GPU. Gemma needs a Gemini API key from https://aistudio.google.com/apikey:

```bash
export GEMINI_API_KEY=...         # or put GEMINI_API_KEY=... in a .env at the repo root (gitignored)
```

## Run it

**Capture** (phone, no code): record with the Spectacular Rec iOS app. Walk slowly, tilt up to the ceiling and down to the floor a few times, do not spin in place, keep good light and some texture in view, and end where you started. Copy the recording to `data/<scan>/rec/`.

```bash
python scan/pipeline.py poses data/room1      # rec/ -> sai/ (keyframes, poses, map points)
python scan/pipeline.py depth data/room1      # sai/ -> depth/*.npy, scaled to the SLAM map
python scan/pipeline.py fuse data/room1       # -> cloud.ply, mesh.ply

python scan/room_tags.py tag data/room1 --room "living room" --captured-at 2026-10-24T21:34:47-04:00 \
       --frames 12 --avoid frame_00026 frame_00045     # leave out any frame that shows a person
python scan/room_tags.py review data/room1    # renter confirms or removes each tag (y/n/skip)
python scan/room_tags.py inline data/room1    # confirmed tags only, photos embedded, for the web app

python scan/compare.py data/room1 --photo moveout.jpg --box x0 y0 x1 y1 --radius 0.3
```

Boxes for `compare.py` are pixels on the move-out photo. Output is `data/<scan>/compare/<photo>/compare.json` plus `spot<N>.jpg` (move-out | move-in, side by side).

For a demo: `python scan/demo_page.py data/room1 --photo moveout.jpg --box ...` writes one self-contained HTML page with a 3D viewer, and `python scan/demo_video.py data/room1` renders a short video of the map being built and a tag being matched (needs `ffmpeg` on PATH and a finished `compare.py` run).

### Output

`data/<scan>/room-tags.json` follows `../shared/room-tags.schema.json` (`id`, `room`, `object`, `note`, `photo`, `box` as fractions of the photo, `takenAt`, `pose`, `confirmed`). `pose` is the camera that took the photo, `[x, y, z, qx, qy, qz, qw]`, in the scan's own world. We add two optional fields, `frame` (keyframe name) and `position` (the tag's 3D spot in metres, or `null`).

### Tests

```bash
python scan/test_room_tags.py    # reply parsing, pose maths
python scan/test_compare.py      # synthetic textured wall: a known photo must land in the right place
python scan/test_measure.py      # synthetic room
```

All three pass on the committed code. They need no network and no API key.

## What it can and cannot do (measured on our own scans)

- **Tested on one room.** A living room, 57 keyframes. Gemma tagged one clear damage spot (wear on a sofa cushion) and the renter confirmed it. Recall is low by design: the prompt asks for clearly visible damage only, so it misses small marks and will miss others. **Never read the tag list as complete.**
- **Placing a photo works about half the time.** Of two close-up move-out photos, one was placed in the map and one was refused (too close and too steep compared with anything in the walk). A refusal says "compare by eye". Plain white walls give too few features and fail.
- **The demo uses a stand-in.** The move-out photo in the demo page and video is a frame from the move-in video, not a separate photo taken later. [TODO: replace with a real move-out photo if there is time, and delete this line.]
- **The map is rough.** Expect stray wall pieces and floating fragments. Scale comes from the pose tool and was **never checked against a tape measure**, so we show no measurements from it. The `measure` and `report` stages in `pipeline.py` are experimental and unvalidated.
- **The side-by-side assumes a flat spot.** It warps the move-in view onto the move-out photo with one homography, so curved or cluttered spots look wrong.
- **The match distance is a guess.** `compare.py` defaults to 0.5 m; the demo uses 0.3 m, because at 0.5 m an unrelated object also counted as a match. It is tuned on one room.
- **Photo assumptions.** A move-out photo must come from the same phone camera at normal zoom (portrait or landscape both work). A cropped, zoomed or different-lens photo breaks the placement.

## Privacy

- A home scan is more identifying than a photo. `data/` is gitignored and no scan, recording or video is in this repo. [TODO: before showing the demo scan publicly, get the agreement of everyone who lives in that room, then say so here.]
- Frames showing a person are left out of tagging (`--avoid`).
- **Frames sent to the Gemini API leave the machine.** The free tier may use submitted data to improve Google products, so tag only rooms you are happy to share. The open-weight local mode (`gemma4:e4b` via Ollama) is the app's route for private data; this folder does not wire it in yet.
- Everything else (poses, depth, fusion, compare) runs locally.

## Licences and credits

| Piece | Licence | Note |
|---|---|---|
| This code | MIT (repo `LICENSE`) | |
| **Spectacular AI SDK** (`sai-cli`, the poses stage) | **Proprietary, "free for non-commercial use"** | **Not open source.** Installed separately, never vendored or committed. A commercial version of Home Lens would need a replacement that writes a metric nerfstudio `transforms.json`, or a licence from Spectacular AI. |
| Depth Anything V2 Metric Indoor **Small** | Apache-2.0 (Small checkpoint; the `-hf` card declares none, see note) | Trained on Hypersim (CC BY-SA 3.0). Do not swap in the Base, Large or Giant models: they are CC-BY-NC-4.0. |
| Gemma 4 | [Gemma terms of use](https://ai.google.dev/gemma/terms) | |
| Open3D 0.20 | MIT | |
| OpenCV, NumPy, Pillow, Transformers, PyTorch | Apache-2.0 / BSD / MIT-style | |

Note: the Hugging Face card for the `-hf` depth checkpoint declares no licence. We treat it as the Apache-2.0 Small model it converts from; that match is not confirmed.

**Prior work.** The idea of mapping a room with visual SLAM comes from an earlier personal prototype by the author, from before the hackathon. None of that code is in this repo: everything in `scan/` was written during the hackathon weekend. [TODO: add the organizers' answer on prior personal prototypes, or delete this sentence if they have not replied.]

Information, not legal advice.
