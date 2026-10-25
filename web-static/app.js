import { daysBetween, depositDeadline, objectionDeadline, repairDeadline, fmtDate, todayIso, matchCharge, buildNotice, buildLetter } from './rules.js';
import { analyzePhoto, identifyIssue } from './gemma.js';
import { demoState, SAMPLE_SCAN_URL } from './sample.js';

const KEY = 'homelens.v1';
const blank = () => ({
  demo: false, moveInDate: '', rooms: [],
  person: { tenant: '', landlord: '', address: '' },
  problem: { issue: 'Leak', desc: '', date: todayIso(), photo: null, text: '', edited: false },
  moveOut: { date: '', charges: [], letterImg: null, letter: '', edited: false },
});
const load = () => { try { return { ...blank(), ...JSON.parse(localStorage.getItem(KEY)) }; } catch { return blank(); } };
let S = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { say('Could not save: browser storage is full. Remove some photos.'); } };

const ui = { roomId: null, mode: 'photos', photoId: null, selTag: null, cam: null, focus3d: null };
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const uid = () => Math.random().toString(36).slice(2, 9);
const fmtTime = (iso) => new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
const say = (m) => { $('#live').textContent = ''; setTimeout(() => ($('#live').textContent = m), 30); };
const chip = (cls, t) => `<span class="chip ${cls}">${t}</span>`;

// ---------- state helpers ----------
const room = () => S.rooms.find((r) => r.id === ui.roomId);
const liveTags = (r) => r.photos.flatMap((p) => p.tags.filter((t) => t.status !== 'removed'));
const numOf = (r) => Object.fromEntries(liveTags(r).map((t, i) => [t.id, i + 1]));
const curPhoto = (r) => r.photos.find((p) => p.id === ui.photoId) || r.photos[0];
const findTag = (id) => { for (const r of S.rooms) for (const p of r.photos) { const t = p.tags.find((x) => x.id === id); if (t) return { r, p, t }; } };
const hasPin = (r, tagId) => !!r.scan?.tags?.some((t) => t.tagId === tagId);
const allTags = () => S.rooms.flatMap((r) => liveTags(r).map((t) => ({ ...t, roomName: r.name })));
const setPath = (path, v) => { const k = path.split('.'); const last = k.pop(); k.reduce((o, x) => o[x], S)[last] = v; };

async function shrink(file, max = 1000) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}
function download(name, text) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/plain' })), download: name });
  a.click(); URL.revokeObjectURL(a.href);
}

// ---------- 3D viewer mount ----------
let viewer = null, viewerMod = null;
function teardown() { if (viewer) { ui.cam = viewer.getState(); viewer.dispose(); viewer = null; } }
async function mountViewer(el, r, sel, onSelect) {
  if (!el) return;
  try {
    viewerMod ??= await import('./viewer.js');
    if (!el.isConnected) return;
    viewer = viewerMod.createViewer(el, r.scan, { numbers: numOf(r), selected: sel, state: ui.cam, onSelect });
  } catch (e) {
    el.innerHTML = `<p class="note" style="margin:16px">The 3D view could not start (${esc(e.message)}). Use the List tab instead.</p>`;
  }
}

// ---------- home ----------
function home() {
  const nTags = S.rooms.reduce((n, r) => n + liveTags(r).length, 0);
  const nCharges = S.moveOut.charges.length;
  const card = (n, title, text, href, cta, status) => `<div class="card"><p class="muted small">${n}</p><h2 class="h2">${title}</h2><p>${text}</p>${status ? `<p>${chip('ac', status)}</p>` : ''}<a class="btn primary" href="${href}">${cta}</a></div>`;
  return `<section class="hero"><h1>One camera for your home and your papers</h1>
<p class="lede">Document your rental, send a repair notice, and check your deposit deductions. No account needed. You confirm everything; plain code applies the law.</p></section>
<div class="cards3">
${card('1 · Move in', 'Photograph each room', 'Add photos, or a walkthrough for an optional 3D map. You confirm every damage tag.', '#/move-in', 'Start a walkthrough', nTags ? `${nTags} tags saved` : '')}
${card('2 · Something breaks', 'Send a repair notice', 'Describe the problem, get a written notice and the 14-day clock.', '#/problem', 'Report a problem', '')}
${card('3 · Move out', 'Check your deductions', 'Match each charge to your move-in photos and get the 45-day deadline and a letter.', '#/move-out', 'Check a letter', nCharges ? `${nCharges} charges loaded` : '')}
</div>
<div class="row"><button data-act="loadDemo" class="primary">Load demo data</button><button data-act="clearAll">Clear all data</button></div>
<p class="note" style="margin-top:16px">Demo mode: photo and letter reading returns sample results. Wire a Gemma 4 provider in <code>gemma.js</code> to read real photos. The demo photos are illustrations, and the sample 3D scan is a hand-made placeholder.</p>`;
}

// ---------- move in ----------
const moveInDateCard = () => `<div class="card" style="margin-top:16px"><label for="mid" style="margin-top:0">Move-in date</label>
<input type="date" id="mid" data-bind="moveInDate" value="${esc(S.moveInDate)}">
<p class="small muted" style="margin:8px 0 0">${S.moveInDate ? `Object to the landlord's move-in report by <b>${fmtDate(objectionDeadline(S.moveInDate))}</b> (5 days, § 55.1-1214).` : 'Enter it to see your 5-day deadline.'}</p></div>`;

function tagCard(r, t, n, withPhotoBtn) {
  const sel = ui.selTag === t.id;
  return `<li class="card tag ${sel ? 'sel' : ''}"><button class="plain" data-act="selTag" data-id="${t.id}" data-k="sel-${t.id}" aria-pressed="${sel}">${n} · ${esc(t.label)}</button>
<div class="small muted">${esc(t.detail)}</div>
<div class="row" style="margin-top:4px">${t.status === 'confirmed' ? chip('ok', 'Confirmed') : chip('', 'Not confirmed')}${t.check ? chip('warn', 'Check this') : ''}${hasPin(r, t.id) ? chip('ac', 'Pinned in 3D') : ''}</div>
<div class="row">${t.status !== 'confirmed' ? `<button class="sm" data-act="tagConfirm" data-id="${t.id}" data-k="c-${t.id}">Confirm</button>` : ''}
<button class="sm" data-act="tagEdit" data-id="${t.id}" data-k="e-${t.id}">Edit</button><button class="sm" data-act="tagRemove" data-id="${t.id}" data-k="r-${t.id}">Remove</button>
${withPhotoBtn ? `<button class="sm" data-act="showPhoto" data-id="${t.id}" data-k="p-${t.id}">Show photo</button>` : ''}</div></li>`;
}

function sideHtml(r) {
  const nums = numOf(r), photo = curPhoto(r), inPhotos = ui.mode === 'photos';
  const tags = inPhotos ? (photo?.tags.filter((t) => t.status !== 'removed') || []) : liveTags(r);
  return `<h2 class="h3">${inPhotos ? 'Tags on this photo' : 'Tags in this room'} (${tags.length})</h2>
${tags.length ? `<ul class="plain-list">${tags.map((t) => tagCard(r, t, nums[t.id], !inPhotos)).join('')}</ul>` : '<p class="muted">No tags yet. Add a photo, then read it with the demo reader.</p>'}
${ui.mode === '3d' ? '<p class="note" style="margin-top:12px">Pin positions are estimates. Check each against its photo.</p>' : ''}`;
}

function captureCards(r) {
  return `<div class="two"><div class="card"><h3>Photos ${chip('ok', 'Fastest')}</h3><p class="small muted">Take or upload photos. Damage tags appear on each photo.</p>
<div class="row"><label class="btn primary filebtn">Add photos<input type="file" accept="image/*" multiple data-change="addPhoto"></label><label class="btn filebtn">Use camera<input type="file" accept="image/*" capture="environment" data-change="addPhoto"></label></div></div>
<div class="card accent"><h3>Walkthrough video ${chip('ac', 'Adds 3D map')}</h3><p class="small muted">Walk slowly around the room, do not spin in place. The 3D map is built outside the browser and loaded as a scan bundle.</p>
<div class="row"><label class="btn filebtn">Upload video<input type="file" accept="video/*" data-change="videoFile"></label><label class="btn filebtn">Load scan bundle<input type="file" accept=".json,application/json" data-change="bundleFile"></label><button data-act="loadSampleScan">Load sample scan</button></div></div></div>
<p class="note" style="margin-top:12px">3D is optional. Everything works with photos only.</p>`;
}

function statusStrip(r) {
  if (!r.video && !r.scan) return '';
  const pinned = (r.scan?.tags || []).filter((t) => numOf(r)[t.tagId]).length;
  return `<div class="strip" aria-label="3D map status">${r.video ? chip('ok', '1 Video added') : ''}
${r.scan ? chip('ok', '2 Map ready') : chip('warn', '2 Needs processing')}${r.scan ? chip(pinned ? 'ok' : 'warn', `3 ${pinned} tags placed`) : ''}
${!r.scan ? '<span class="small muted">This page does not process video. Run the scan pipeline (about 15 minutes), then load the bundle.</span>' : ''}</div>`;
}

function photoStage(r, photo) {
  const nums = numOf(r);
  const boxes = photo.tags.filter((t) => t.status !== 'removed').map((t) => {
    const [x, y, w, h] = t.box;
    return `<button class="box ${t.status === 'confirmed' ? 'confirmed' : ''} ${ui.selTag === t.id ? 'sel' : ''}" data-act="selTag" data-id="${t.id}" data-k="box-${t.id}" aria-label="Tag ${nums[t.id]}: ${esc(t.label)}" style="left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%"><b>${nums[t.id]}</b></button>`;
  }).join('');
  const thumbs = r.photos.map((p, i) => `<button data-act="selPhoto" data-id="${p.id}" data-k="th-${p.id}" aria-pressed="${p.id === photo.id}" aria-label="Photo ${i + 1}"><img src="${p.src}" alt=""></button>`).join('');
  return `<figure class="stage"><img src="${photo.src}" alt="Photo of the ${esc(r.name)}, taken ${fmtTime(photo.time)}">${boxes}<figcaption>${esc(r.name)} · ${fmtTime(photo.time)}</figcaption></figure>
<div class="thumbs">${thumbs}<label class="btn filebtn">Add photos<input type="file" accept="image/*" multiple data-change="addPhoto"></label><label class="btn filebtn">Use camera<input type="file" accept="image/*" capture="environment" data-change="addPhoto"></label>
</div>
<div class="row" style="margin-top:0"><button data-act="analyze" class="primary" data-k="analyze">Read this photo (demo)</button></div>`;
}

function listTable(r) {
  const nums = numOf(r);
  const rows = liveTags(r).map((t) => {
    const p = r.photos.find((x) => x.tags.includes(t));
    return `<tr><td>${nums[t.id]}</td><td><b>${esc(t.label)}</b><br><span class="small muted">${esc(t.detail)}</span></td><td>${fmtTime(p.time)}</td><td>${t.status === 'confirmed' ? 'Confirmed' : 'Not confirmed'}${t.check ? ', check this' : ''}</td><td>${hasPin(r, t.id) ? 'Pinned' : 'No'}</td></tr>`;
  }).join('');
  return rows ? `<table class="tbl"><caption class="sr">Tags in ${esc(r.name)}</caption><thead><tr><th>#</th><th>Tag</th><th>Photo taken</th><th>Status</th><th>3D</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="muted">No tags yet.</p>';
}

function moveIn() {
  if (!room()) ui.roomId = S.rooms[0]?.id ?? null;
  const r = room();
  if (r) ui.photoId = curPhoto(r)?.id ?? null;
  const rooms = S.rooms.map((x) => `<li><button class="roombtn" aria-pressed="${x.id === ui.roomId}" data-act="selRoom" data-id="${x.id}" data-k="room-${x.id}">${esc(x.name)} <span class="muted small">${liveTags(x).length}</span></button></li>`).join('');
  const left = `<aside><h2 class="h3">Rooms</h2><ul class="plain-list">${rooms}</ul>
<form data-submit="addRoom" style="margin-top:12px"><label for="newroom" class="sr">New room name</label><input type="text" id="newroom" placeholder="Bathroom" required><div class="row"><button>Add room</button></div></form>${moveInDateCard()}</aside>`;
  if (!r) return `<div class="ws">${left}<section><h1 class="h2">Move in</h1><p class="muted">Add a room to start, or load the demo data from the home page.</p></section><aside></aside></div>`;

  const seg = [['photos', 'Photos'], ['3d', '3D map'], ['list', 'List']].map(([m, l]) => `<button data-act="mode" data-mode="${m}" data-k="mode-${m}" aria-pressed="${ui.mode === m}">${l}</button>`).join('');
  let body;
  if (ui.mode === 'photos') body = r.photos.length ? photoStage(r, curPhoto(r)) : captureCards(r);
  else if (ui.mode === 'list') body = listTable(r);
  else body = r.scan
    ? `<div id="v3d" class="v3d" tabindex="0" role="application" aria-label="Rough 3D map of the ${esc(r.name)}. Drag to rotate, scroll to zoom, arrow keys to pan. The List tab has the same information as text."></div>
<div class="row"><button data-act="resetView" data-k="reset">Reset view</button><button data-act="clearScan" data-k="clearscan">Remove 3D map</button><span class="small muted">Rough map from your walkthrough. Not to scale.</span></div>`
    : captureCards(r);
  return `<div class="ws">${left}<section><div class="bar"><h1 class="h2" style="margin:0">${esc(r.name)}</h1><div class="seg" role="group" aria-label="View">${seg}</div></div>${statusStrip(r)}${body}</section><aside id="side">${sideHtml(r)}</aside></div>`;
}

// ---------- problem ----------
const noticeText = () => {
  const p = S.problem;
  return p.edited ? p.text : buildNotice({ ...S.person, issue: p.issue, desc: p.desc, room: '', date: p.date });
};
function problem() {
  const p = S.problem, dl = repairDeadline(p.date), day = daysBetween(p.date, todayIso()) + 1;
  const clock = day < 1 ? `Starts on ${fmtDate(p.date)}` : day <= 14 ? `Day ${day} of 14` : '14 days have passed';
  const issues = ['Leak', 'Mold', 'No heat', 'No hot water', 'Pests', 'Other'].map((i) => `<option ${i === p.issue ? 'selected' : ''}>${i}</option>`).join('');
  return `<h1 class="h2">Report a problem</h1>
<div class="split"><section>
<label for="photo" style="margin-top:0">Photo of the problem</label>
<div class="row" style="margin:0 0 8px"><label class="btn filebtn">Add photo<input type="file" accept="image/*" id="photo" data-change="problemPhoto"></label><label class="btn filebtn">Use camera<input type="file" accept="image/*" capture="environment" data-change="problemPhoto"></label>
${p.photo ? '<button data-act="suggestIssue" data-k="suggest">Suggest the issue (demo)</button>' : ''}</div>
${p.photo ? `<img src="${p.photo}" alt="Photo of the problem" style="max-width:100%;max-height:220px;border-radius:8px">` : ''}
<label for="issue">What is it</label><select id="issue" data-bind="problem.issue" data-edit-reset="problem.edited">${issues}</select>
<label for="desc">What you see</label><textarea id="desc" style="min-height:90px" data-bind="problem.desc" placeholder="Water stain spreading on the bedroom ceiling since Monday">${esc(p.desc)}</textarea>
<label for="ndate">Date you give notice</label><input type="date" id="ndate" data-bind="problem.date" value="${p.date}">
<h2 class="h3" style="margin-top:20px">Your details</h2>${personFields()}</section>
<section><div class="card"><p class="muted small" style="margin:0">Landlord has 14 days after written notice (§ 55.1-1244.1)</p><div class="big">${fmtDate(dl)}</div>
<progress max="14" value="${Math.min(Math.max(day, 0), 14)}" aria-label="Days since notice"></progress><p class="small" style="margin:4px 0 0">${clock}</p></div>
<label for="notice">Written notice (edit before you send it)</label><textarea id="notice" data-bind="problem.text" data-edit="problem.edited">${esc(noticeText())}</textarea>
<div class="row"><button class="primary" data-act="copy" data-src="notice">Copy</button><button data-act="dl" data-src="notice" data-name="repair-notice.txt">Download</button><button data-act="resetNotice">Reset to draft</button></div>
<p class="note" style="margin-top:12px">This condition may qualify if it is a material noncompliance with the lease or law, or a fire, health or safety threat. It does not apply if you or a guest caused it or you denied the landlord access. If it is not repaired in 14 days you may have remedies, with limits. Ask Student Legal Services before acting. Information, not legal advice.</p></section></div>`;
}
const personFields = () => ['tenant:Your name', 'landlord:Landlord or property manager', 'address:Unit address'].map((s) => {
  const [k, l] = s.split(':');
  return `<label for="p-${k}">${l}</label><input type="text" id="p-${k}" data-bind="person.${k}" value="${esc(S.person[k])}">`;
}).join('');

// ---------- move out ----------
function chargeInfo(c) {
  const m = c.rejected ? null : matchCharge(c.label, allTags());
  const hit = m && findTag(m.id);
  return { m, hit };
}
const letterText = () => {
  const mo = S.moveOut;
  if (mo.edited) return mo.letter;
  if (!mo.date) return 'Enter your move-out date to draft the letter.';
  const charges = mo.charges.map((c) => {
    const { m, hit } = chargeInfo(c);
    return { ...c, evidence: c.confirmed && hit ? { tag: hit.t.label, room: hit.r.name, time: fmtTime(hit.p.time) } : null };
  });
  return buildLetter({ moveOut: mo.date, ...S.person, charges });
};
function moveOut() {
  const mo = S.moveOut, total = mo.charges.reduce((n, c) => n + Number(c.amount), 0);
  const dl = mo.date ? depositDeadline(mo.date) : null, left = dl ? daysBetween(todayIso(), dl) : 0;
  const paper = mo.letterImg ? `<img src="${mo.letterImg}" alt="Your deduction letter">` : mo.charges.length
    ? `Re: Security deposit<br>${mo.charges.map((c) => `${esc(c.label)} &nbsp; <mark>${money(c.amount)}</mark>`).join('<br>')}<br>Total deductions &nbsp; ${money(total)}`
    : '<span class="muted">No letter yet. Scan one or add charges by hand.</span>';
  const cards = mo.charges.map((c) => {
    const { m, hit } = chargeInfo(c);
    const pin = hit && hasPin(hit.r, hit.t.id);
    const thumb = hit ? `<img src="${hit.p.src}" alt="Move-in photo of ${esc(hit.t.label)}">` : '<div class="none"></div>';
    const state = !m ? chip('warn', 'No photo') : c.confirmed ? chip('ok', 'Match confirmed') : chip('warn', 'Possible match, confirm');
    return `<li class="card charge">${thumb}<div><div class="row" style="margin:0;justify-content:space-between"><b>${esc(c.label)}</b><b>${money(c.amount)}</b></div>
<div class="small muted">${m ? `${esc(hit.t.label)} · ${esc(m.roomName)} · ${fmtTime(hit.p.time)}${hit.t.status !== 'confirmed' ? ' · tag not confirmed at move-in' : ''}` : 'No move-in photo matches this charge.'}</div>
<div class="row">${state}${m && !c.confirmed ? `<button class="sm" data-act="matchOk" data-id="${c.id}" data-k="mo-${c.id}">Confirm match</button><button class="sm" data-act="matchNo" data-id="${c.id}" data-k="mn-${c.id}">Not a match</button>` : ''}
${pin ? `<button class="sm" data-act="show3d" data-id="${hit.t.id}" data-k="s3-${c.id}">Show in 3D</button>` : ''}<button class="sm" data-act="delCharge" data-id="${c.id}" data-k="dc-${c.id}">Remove charge</button></div></div></li>`;
  }).join('');
  const f3 = ui.focus3d && findTag(ui.focus3d);
  return `<h1 class="h2">Move out</h1>
<div class="split"><section><h2 class="h3">Your deduction letter</h2><div class="paper">${paper}</div>
<div class="row"><label class="btn filebtn">Scan letter (photo)<input type="file" accept="image/*" data-change="letterImg"></label></div>
<form data-submit="addCharge" class="card" style="margin-top:12px"><b>Add a charge by hand</b><div class="row"><div style="flex:2;min-width:140px"><label for="cl" class="sr">Charge</label><input type="text" id="cl" placeholder="Cleaning fee" required></div><div style="flex:1;min-width:90px"><label for="ca" class="sr">Amount</label><input type="text" id="ca" inputmode="decimal" placeholder="75.00" required></div><button>Add</button></div></form>
<h2 class="h3" style="margin-top:20px">Your details</h2>${personFields()}</section>
<section><div class="card"><label for="mdate" style="margin-top:0">Move-out date</label><input type="date" id="mdate" data-bind="moveOut.date" data-edit-reset="moveOut.edited" value="${esc(mo.date)}">
${dl ? `<p class="muted small" style="margin:10px 0 0">Landlord must itemize or refund by (45 days, § 55.1-1226)</p><div class="big">${fmtDate(dl)}</div><p class="small" style="margin:0">${left >= 0 ? `${left} days left` : `${-left} days past`}</p>` : '<p class="small muted" style="margin:8px 0 0">Enter it to see the 45-day deadline.</p>'}</div>
<h2 class="h3" style="margin-top:16px">Charges · ${money(total)}</h2>
${cards ? `<ul class="plain-list">${cards}</ul>` : '<p class="muted">No charges yet.</p>'}
<p class="note" style="margin-top:12px">Matches are possible matches that you confirm. Whether a charge is normal wear and tear is not decided here.</p>
${f3 ? `<h2 class="h3" style="margin-top:16px">${esc(f3.t.label)} in 3D</h2><div id="mo3d" class="v3d" style="height:300px" role="img" aria-label="Rough 3D map with the tag highlighted"></div><div class="row"><button data-act="close3d" data-k="close3d">Close 3D</button></div>` : ''}
<label for="letter">Letter (edit before you send it)</label><textarea id="letter" data-bind="moveOut.letter" data-edit="moveOut.edited">${esc(letterText())}</textarea>
<div class="row"><button class="primary" data-act="copy" data-src="letter">Copy</button><button data-act="dl" data-src="letter" data-name="deposit-letter.txt">Download</button><button data-act="resetLetter">Reset to draft</button></div>
<p class="small muted" style="margin-top:12px">Need help? VT Student Legal Services and Southwest Virginia Legal Aid. Contact details still to be verified before submission.</p></section></div>`;
}

// ---------- routing ----------
const views = { '': home, 'move-in': moveIn, problem, 'move-out': moveOut };
const after = {
  'move-in'() { const r = room(); if (r && ui.mode === '3d' && r.scan) mountViewer($('#v3d'), r, ui.selTag, (id) => { ui.selTag = id; $('#side').innerHTML = sideHtml(room()); }); },
  'move-out'() { const f = ui.focus3d && findTag(ui.focus3d); if (f?.r.scan) mountViewer($('#mo3d'), f.r, ui.focus3d, () => {}); },
};
let routeName = null;
function render() {
  const key = document.activeElement?.dataset?.k;
  const name = location.hash.replace(/^#\/?/, '');
  const view = name in views ? name : '';
  teardown();
  $('#view').innerHTML = views[view]();
  document.querySelectorAll('nav a').forEach((a) => (a.dataset.nav === view ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  after[view]?.();
  if (routeName !== view) { routeName = view; ui.cam = null; $('#view').focus({ preventScroll: true }); window.scrollTo(0, 0); }
  else if (key) $(`[data-k="${key}"]`)?.focus();
}
window.addEventListener('hashchange', render);

// ---------- actions ----------
const act = {
  async loadDemo() {
    S = demoState();
    const scan = await fetch(SAMPLE_SCAN_URL).then((r) => r.json());
    S.rooms[0].scan = scan;
    Object.assign(ui, { roomId: 'bedroom', mode: 'photos', photoId: null, selTag: null, cam: null, focus3d: null });
    save(); say('Demo data loaded'); render();
  },
  clearAll() { if (!confirm('Delete all photos, tags and letters from this browser?')) return; S = blank(); Object.assign(ui, { roomId: null, photoId: null, selTag: null, focus3d: null }); save(); say('All data cleared'); render(); },
  selRoom(d) { ui.roomId = d.id; ui.photoId = null; ui.selTag = null; ui.cam = null; render(); },
  selPhoto(d) { ui.photoId = d.id; render(); },
  mode(d) { ui.mode = d.mode; render(); },
  selTag(d) { ui.selTag = d.id; if (viewer) { viewer.select(d.id); $('#side').innerHTML = sideHtml(room()); } else render(); },
  showPhoto(d) { const f = findTag(d.id); ui.mode = 'photos'; ui.photoId = f.p.id; ui.selTag = d.id; render(); },
  tagConfirm(d) { const t = findTag(d.id).t; t.status = 'confirmed'; t.check = false; save(); say('Tag confirmed'); render(); },
  tagRemove(d) { findTag(d.id).t.status = 'removed'; if (ui.selTag === d.id) ui.selTag = null; save(); say('Tag removed'); render(); },
  tagEdit(d) { const t = findTag(d.id).t; const v = prompt('Describe this tag', t.label); if (v?.trim()) { t.label = v.trim(); save(); render(); } },
  async analyze() {
    const photo = curPhoto(room());
    say('Reading the photo');
    try {
      const found = await analyzePhoto(photo);
      photo.tags = [...photo.tags.filter((t) => t.status === 'confirmed'), ...found.filter((f) => !photo.tags.some((t) => t.id === f.id && t.status === 'confirmed')).map((f) => ({ status: 'pending', ...f, id: f.id || uid() }))];
      save(); say(`${found.length} tags found. Confirm or remove each one.`); render();
    } catch (e) { say(e.message); }
  },
  resetView() { viewer?.reset(); },
  clearScan() { room().scan = null; ui.cam = null; save(); render(); },
  async loadSampleScan() { const r = room(); r.scan = await fetch(SAMPLE_SCAN_URL).then((x) => x.json()); ui.mode = '3d'; ui.cam = null; save(); say('Sample scan loaded'); render(); },
  show3d(d) { ui.focus3d = d.id; ui.cam = null; render(); $('#mo3d')?.scrollIntoView({ block: 'nearest' }); },
  close3d() { ui.focus3d = null; render(); },
  matchOk(d) { const c = S.moveOut.charges.find((x) => x.id === d.id); c.confirmed = true; S.moveOut.edited = false; save(); say('Match confirmed'); render(); },
  matchNo(d) { const c = S.moveOut.charges.find((x) => x.id === d.id); c.rejected = true; save(); render(); },
  delCharge(d) { S.moveOut.charges = S.moveOut.charges.filter((x) => x.id !== d.id); save(); render(); },
  async suggestIssue() { const s = await identifyIssue(S.problem.photo); S.problem.issue = s.issue; S.problem.desc = s.desc; S.problem.edited = false; save(); say('Suggestion added. Check it.'); render(); },
  resetNotice() { S.problem.edited = false; save(); render(); },
  resetLetter() { S.moveOut.edited = false; save(); render(); },
  copy(d) { navigator.clipboard?.writeText($('#' + d.src).value).then(() => say('Copied')); },
  dl(d, b) { download(b.dataset.name, $('#' + d.src).value); },
};
const submit = {
  addRoom(f) { const name = $('#newroom', f).value.trim(); if (!name) return; const r = { id: uid(), name, photos: [], scan: null, video: null }; S.rooms.push(r); ui.roomId = r.id; ui.photoId = null; save(); render(); },
  addCharge() { const label = $('#cl').value.trim(), amount = parseFloat($('#ca').value.replace(/[$,]/g, '')); if (!label || !(amount >= 0)) return say('Enter a charge name and a number'); S.moveOut.charges.push({ id: uid(), label, amount }); S.moveOut.edited = false; save(); render(); },
};
const change = {
  async addPhoto(input) {
    const r = room();
    for (const f of input.files) { const p = { id: uid(), src: await shrink(f), time: new Date().toISOString(), tags: [] }; r.photos.push(p); ui.photoId = p.id; }
    ui.mode = 'photos'; save(); say('Photo added. Read it to find tags.'); render();
  },
  videoFile(input) { const f = input.files[0]; if (!f) return; room().video = { name: f.name }; save(); say('Video noted'); render(); },
  async bundleFile(input) {
    try {
      const j = JSON.parse(await input.files[0].text());
      if (!j.room?.width || !Array.isArray(j.tags)) throw new Error('missing room or tags');
      room().scan = j; ui.mode = '3d'; ui.cam = null; save(); say('Scan bundle loaded'); render();
    } catch (e) { say(`That file is not a scan bundle (${e.message})`); }
  },
  async problemPhoto(input) { if (!input.files[0]) return; S.problem.photo = await shrink(input.files[0]); save(); render(); },
  async letterImg(input) {
    if (!input.files[0]) return;
    S.moveOut.letterImg = await shrink(input.files[0], 1400);
    if (!S.moveOut.charges.length) S.moveOut.charges = demoState().moveOut.charges; // demo reader stand-in
    S.moveOut.edited = false; save(); say('Demo mode: sample charges loaded. Check each one against your letter.'); render();
  },
};

const view = $('#view');
view.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) act[b.dataset.act]?.(b.dataset, b); });
view.addEventListener('submit', (e) => { e.preventDefault(); submit[e.target.dataset.submit]?.(e.target); });
view.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.change) { change[el.dataset.change](el); return; }
  if (el.dataset.bind && el.type !== 'text' && el.tagName !== 'TEXTAREA') {
    setPath(el.dataset.bind, el.value);
    if (el.dataset.editReset) setPath(el.dataset.editReset, false);
    save(); render();
  }
});
view.addEventListener('input', (e) => {
  const el = e.target;
  if (!el.dataset.bind || !(el.type === 'text' || el.tagName === 'TEXTAREA')) return;
  setPath(el.dataset.bind, el.value);
  if (el.dataset.edit) setPath(el.dataset.edit, true);
  else { // a source field changed: refresh any drafted text the person has not edited
    if (!S.problem.edited && $('#notice')) $('#notice').value = noticeText();
    if (!S.moveOut.edited && $('#letter')) $('#letter').value = letterText();
  }
  save();
});

render();
