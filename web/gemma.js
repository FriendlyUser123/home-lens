// The one provider switch. 'mock' returns canned results so the whole UI works with no key or network.
// Real providers must return the same shapes:
//   analyzePhoto(photo) -> [{ id?, label, detail, box: [x, y, w, h] (0..1 of the image), check: bool, keywords: [str] }]
//   identifyIssue(photo) -> { issue, desc }
// 'gemini' = gemma-4-26b-a4b-it via the Gemini API; 'ollama' = gemma4:e4b. Neither is wired yet.
export const PROVIDER = 'mock';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const DEMO = {
  wall: [{ id: 't-scuff', label: 'Scuff on wall', detail: 'Near the door, about 6 in', box: [0.12, 0.3, 0.22, 0.16], check: false, keywords: ['wall', 'scuff', 'mark'] }],
  carpet: [{ id: 't-stain', label: 'Carpet stain', detail: 'Dark patch near the window', box: [0.55, 0.55, 0.25, 0.18], check: true, keywords: ['carpet', 'stain', 'floor', 'rug'] }],
};

export async function analyzePhoto(photo) {
  if (PROVIDER !== 'mock') throw new Error(`Provider "${PROVIDER}" is not wired up yet`);
  await wait(500);
  return DEMO[photo.demoKind] || [{ label: 'Possible mark (demo result)', detail: 'The demo reader found nothing real. Edit or remove this.', box: [0.35, 0.35, 0.3, 0.2], check: true, keywords: [] }];
}

export async function identifyIssue() {
  if (PROVIDER !== 'mock') throw new Error(`Provider "${PROVIDER}" is not wired up yet`);
  await wait(500);
  return { issue: 'Leak', desc: 'Water stain spreading on the ceiling (demo suggestion).' };
}
