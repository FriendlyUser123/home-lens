# Home Lens — team plan and rules for agents

Read this first. It is the shared plan for every chat/agent working in this repo. Update it when a decision changes; keep it short and true.

Sources: the team brief (`Home-Lens-Brief.pdf`, Sat 2026-10-24) and the organizers' deck. Written ~18:10 Sat. Where a fact was not verified it says so. This file replaces an earlier draft that made a room-measurement tool the headline; the team brief supersedes it.

## Product (team brief)
**One camera for your home and your papers.** Built at GDG Build with AI x Hacktoberfest 2026 (Virginia Tech, theme AI for Housing). Information, not legal advice.

Gemma 4 reads rooms and papers; the renter confirms everything; then plain, tested code (not the AI) applies Virginia law, matches move-out charges to move-in evidence, and produces the deadline, the letter and the proof.

| Moment | What happens | Law the code applies |
|---|---|---|
| 1 · Move-in | Walk room to room with photos or a short video. Gemma 4 tags visible existing damage with timestamps; the user confirms or removes every tag | Object to the landlord's move-in report within 5 days, § 55.1-1214 |
| 2 · Something breaks | Photo of a leak, mold or no heat. Identify the issue, draft the written repair notice, start the clock | Landlord has 14 days after written notice, then the repair remedy, § 55.1-1244.1 |
| 3 · Move-out | Scan the deduction letter. Each charge is read and matched to move-in photos; deadline, a flag per charge, and a letter with the proof | Itemized list or refund within 45 days, § 55.1-1226; maintenance fees limited, § 55.1-1208(C) |

### How it works (brief)
1. **Capture:** live camera with upload fallback. Papers: OpenCV.js finds page edges and flattens. Rooms: photos stamped with time and room.
2. **Gemma 4 reads:** `gemma-4-26b-a4b-it` via the Gemini API. Room photo → damage tags with description and box. Paper → paper type and each field with a verbatim quote.
3. **Evidence on screen:** room tags drawn as boxes on the photo; paper values tied to words using Tesseract.js word positions, so a highlight is never invented.
4. **Person confirms:** every tag and value editable; anything unclear flagged "check this."
5. **Code applies the law and matches:** tested TypeScript rules for dates and Virginia Code sections. Charges matched to tagged photos by room, object and wording, always shown as "possible match, confirm." **The AI never decides a deadline or whether something is "normal wear and tear."**
6. **Output:** the key date, a flag on each charge, a short letter with photos attached, and a verified local contact (VT Student Legal Services, Southwest Virginia Legal Aid).

### Status (from brief, 18:00 Sat)
| Piece | Status |
|---|---|
| Deduction-letter reading + Virginia deposit rules, deadline, charge flags, request letter | working "day-45" prototype, Gemma 4 via Gemini API |
| Notices/summonses reader, eviction rules, NRV contacts | working "court-day" prototype (reusable for later) |
| Room photo damage tagging | to build tonight |
| Live camera + highlight overlay on paper | to build tonight |
| Matching charges to photos | to build tonight |
| Repair-notice flow (photo → notice → 14-day clock) | to build tonight |

Teammates own the flows above. Ownership of the VSLAM extension is below. **Do not build or edit another person's flow from this chat**; coordinate through shared data shapes recorded in this file.

## Hard constraints (organizers' deck)
- **Hard submission deadline Sun 2026-10-25 12:30 PM, no late submissions.** Window opens 11:00; aim to finish by 12:00. Demos 12:30-1:30; closing 2:00.
- **Two separate submissions, both required:** (1) MLH via OrganizerHQ: public repo with an open-source license file, name, description, tech used, link, 2-minute video; **select only ONE MLH track**. (2) GDG Housing track on the VT chapter entry at codingjam.dev: codebase, demo video, short description. One does not count for the other.
- **Tracks entered:** GDG Best Overall + MLH **Best Use of Gemma 4** (Gemma reads every photo and paper; name the model in the README and show it in the demo).
- **Rules:** build during the weekend; public libraries, APIs and open-source tools allowed; **all submitted code public**; no plagiarism. The brief adds: do not reuse other hackathon projects. **The repo is private now and must be made public (MIT LICENSE already in place) before submitting.**
- One demo, scored for every track entered. Max team size and communication channel were not stated in the deck.

## Rubric (100) — how Home Lens earns it (brief)
- **Problem validation and impact (25):** local court data, Reddit quotes, students who sign early. Add 3-5 quotes from people in the room for the empathy points.
- **AI necessity (15):** two kinds of multimodal vision (damage in room photos, messy paper). Rules cannot do either.
- **Architecture (10):** typed code, unit-tested rules, the model behind one provider switch, working end-to-end demo.
- **Safety and grounding (10):** every value tied to its source pixel or photo, user confirms everything, code-only legal logic, never rules on normal wear and tear.
- **Privacy (8):** no accounts, photos stay on the device, Gemini free-tier use disclosed, open-weight local mode (Gemma 4 E4B via Ollama), demo with sample papers only.
- **Inclusive design (7):** large type, WCAG contrast, keyboard flow, results read out to screen readers, plain words.
- **Deployment, cost, docs (25 shown in the brief; deck splits it 10 / 8 / 7):** static web app plus a tiny API on the free Gemma tier, or run locally at Student Legal Services or a library; README with setup and sources.

## Demo video (2 minutes, "one renter's year")
0:00-0:15 hook "Blacksburg landlords sued tenants 399 times. Tenants sued back 20." · 0:15-0:45 move-in: walk the bedroom, tags pop onto the scuff and the stain, confirm · 0:45-1:00 leak photo → repair notice and 14-day clock · 1:00-1:35 move-out: camera reads the deduction letter, fields light up, "Carpet $480: stain already there, photo #12," deadline Dec 1, one tap gives the letter with photos · 1:35-1:50 trust: you confirm, code applies the law, nothing stored · 1:50-2:00 impact (how SLS or legal aid can run it), repo and model name.

## VSLAM extension (optional "wow"; owned by the VSLAM workstream)
**Brief's wording:** the owner's existing VSLAM project could place move-in photos in a 3D map of the apartment, so each damage tag sits where it is in the room. Use only as a **disclosed, pre-existing open-source dependency**, and **confirm with the organizers first**.

**It is optional and last.** Nothing in the three moments depends on it, and the demo video works without it. Start it only when the core flows are demoable; the cut line is a team call.

**Integration design (planner's proposal, untested):**
- A still photo taken separately from the video has no known pose. Simplest honest path: for the 3D view, capture the move-in as a **walkthrough video** and use its frames as the "photos." The SLAM run gives every frame a pose.
- Gemma tags a frame (box). Code casts a ray from that frame's camera pose through the box centre into the reconstructed mesh, giving a 3D position for the tag. Gemma never produces coordinates.
- Pipeline output is a static asset the web app only displays: mesh (GLB/PLY), camera trajectory, tag positions JSON. No SLAM in the browser.
- **The pipeline takes about 15 minutes per clip on the laptop GPU (RTX 3000 Ada, 8 GB, WSL2).** The demo uses a precomputed scan of a room the owner is happy to publish; no live processing.
- Earlier prototype results (private notes): usable room only from a slow walk, not turning in place; the mesh is noisy with holes and floating fragments, so it looks like a rough map, not a clean model. **Scale accuracy was never measured**, so show no measurements.
- Accessibility: a 3D view needs a list equivalent; the tag list already provides it. Privacy: a 3D map of a home is more identifying than a photo; demo room only.

**Constraints before using it at all:**
1. **Disclose and ask.** Publish the VSLAM project as its own public repo with a licence, state in the README that it pre-dates the hackathon, and ask an organizer. The deck does not say how prior personal work is treated. Do **not** copy the old scripts (`vslam_mesh.py`, `vslam_viz.py`, `vslam_video.py`, 2026-10-07) into this repo.
2. **Licences.** Spectacular AI's SDK is proprietary; its README says only the OAK PyPI wrapper is free for non-commercial use, commercial terms by contact, open-source redistribution not addressed. The prototype's depth model, Depth Anything V2 Large, is CC-BY-NC-4.0 per the official repo (the Metric-Indoor-Large card was not checked); Small is Apache 2.0. A non-commercial dependency conflicts with calling it an open-source dependency. Audit first; list every non-commercial dependency in the README or drop the extension.
3. Agree the asset format with the app teammate and record it here.

## Rules for agents
- **Claims:** a number shown in the UI, README or video must be sourced or measured. **Re-verify before recording:** the 399 vs 20 court figure (Montgomery County GDC, OCIS), the 99% pre-leased figure (one RE/MAX broker via WSLS), and the "<1% of eviction cases had a tenant lawyer" figure. None were checked by the planning session.
- **Statutes, checked 2026-10-24 on law.lis.virginia.gov:**
  - § 55.1-1244.1(B): landlord shall take reasonable steps to repair "within 14 days" of the tenant's written notice. (C): if not, the tenant may hire a licensed contractor and recover actual costs "not exceeding the greater of one month's rent or $1,500," and may deduct them from rent after giving an itemized statement with receipts. Scope: material noncompliance with the lease or law, or a condition that is a fire hazard or serious threat to life, health or safety; examples are rodents, no heat, hot/cold water, light, electricity, sewage. **The text does not name mold or leaks**, so word the app as "may qualify." (E) excludes conditions caused by the tenant or guests, and cases where the landlord was denied access.
  - § 55.1-1208(C): a landlord may not require a tenant to pay a fee for maintenance or repair of the unit unless the tenant's violation necessitates it. Matches the brief's "maintenance fees limited."
  - § 55.1-1226 (45-day deduction notice) and § 55.1-1214 (5-day move-in report) were read earlier in the owner's vault, not re-read today.
- **Repo hygiene:** never commit `.env`, API keys, real leases, or footage of someone's home. Demo with sample papers only. Get roommates' agreement before publishing any room scan.
- **Gemini free tier:** API takes 2-60 s per read; pre-warm it and trim the wait in the edit. Gemma may miss small damage or tag shadows: never claim completeness.
- **Model ids** `gemma-4-26b-a4b-it` (Gemini API) and `gemma4:e4b` (Ollama) come from the brief and README; not verified by the planning session. Check that the E4B size fits 8 GB before promising local mode.
- Keep it small: unit tests on the rules, no new dependency that cannot be explained in one README line, no features outside the brief.

## Build plan (brief) and schedule
Tonight → Sunday 11 AM: vision (Gemma room damage-tag prompt + box overlay; OpenCV.js flattening + Tesseract word-box highlights), app shell with three moments (Move in · Report a problem · Move out) on the day-45 rules and reader with tagged photos stored on device, matching, one visual system (fewest words possible), test set (printed sample letters + staged damage in a real room, a few hard cases, measured field accuracy for the README). **Submission:** make the repo public, README naming `gemma-4-26b-a4b-it` and linking the video, then submit on OrganizerHQ and codingjam.dev (VT chapter) between 11:00 and 12:30 Sunday; verify each shows as submitted.

## Open questions
- Is the VSLAM extension in or out, and the time at which it is cut? (team decision)
- Organizer answer on prior personal prototypes and "disclosed pre-existing open-source dependency."
- Licence audit result for the VSLAM dependencies.
- Asset format between the SLAM pipeline and the app.
- Team size (not stated in the deck).
- Whether Gemma reliably gives usable boxes on room photos (a spike for the damage-tag teammate).

## Related
Longer planning notes live in the owner's private Obsidian vault (page "GDG Hackathon 2026 - VSLAM Housing Project"); this file is meant to be self-contained.
