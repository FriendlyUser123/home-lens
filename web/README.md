# Home Lens web app

Static HTML/CSS/JS. No build step, no framework. Photos and letters stay in this browser (`localStorage`).

```bash
python -m http.server 5173 -d web     # from the repo root, then open http://localhost:5173
node web/rules.test.js                # date, matching and letter tests
```

ES modules need a server, so opening `index.html` from disk will not work. three.js loads from a pinned jsDelivr URL (see the import map in `index.html`); vendor it into `web/vendor/` for an offline demo.

## Files
| File | Job |
|---|---|
| `index.html`, `style.css` | shell, nav, light/dark styles |
| `app.js` | the four pages (home, move in, report a problem, move out), state, events |
| `rules.js` | **code, not AI**: 5/14/45-day deadlines, charge-to-tag matching, notice and letter text |
| `gemma.js` | the one provider switch. `PROVIDER = 'mock'` returns sample results; wire `gemini` or `ollama` here |
| `viewer.js` | three.js 3D map viewer (displays a scan bundle, runs no SLAM) |
| `sample.js`, `scans/sample-scan.json` | demo rooms, illustrated "photos", and a hand-made placeholder scan |

## Scan bundle format (the interface to the VSLAM pipeline)
JSON, metres, y up, room centred on the origin. Load it with "Load scan bundle" on the 3D map tab.
```json
{
  "version": 1,
  "scaleVerified": false,
  "room": { "width": 5, "depth": 4, "height": 2.6 },
  "objects": [{ "name": "Bed", "center": [x, y, z], "size": [w, h, d] }],
  "trajectory": [[x, y, z]],
  "tags": [{ "tagId": "t-stain", "position": [x, y, z] }]
}
```
`tagId` must equal the id of a tag in the web app. Code casts a ray from the camera pose through Gemma's box into the mesh to get `position`; the model never produces coordinates. A real mesh (GLB/PLY) is not loaded yet: `room` and `objects` draw a rough box model.

## Known limits
- Demo mode: Gemma is not connected, so "Read this photo" and "Scan letter" return sample results.
- Demo photos are illustrations; the sample scan is a placeholder, not a real room.
- Pins cannot be dragged yet. The video upload only records the file name; processing happens outside the browser.
- Deadlines use the team brief's statute cites for § 55.1-1214 and § 55.1-1226; re-verify before the demo.
