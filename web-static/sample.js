// Demo data: two illustrated "photos", their tags, a sample deduction letter. Illustrations, not real photos.
export const SAMPLE_SCAN_URL = 'scans/sample-scan.json';

const svg = (inner) =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">${inner}</svg>`);

const WALL = svg(`<rect width="400" height="300" fill="#e6e1d6"/><rect y="215" width="400" height="85" fill="#8a7f72"/>
<rect x="290" y="40" width="80" height="175" fill="#b9a98f"/><circle cx="302" cy="130" r="4" fill="#5f5e5a"/>
<path d="M62 105 q18 -14 40 -4 q16 10 -4 26 q-22 12 -38 -4 z" fill="#b5ada0"/>`);
const CARPET = svg(`<rect width="400" height="300" fill="#a39a8e"/><rect width="400" height="70" fill="#e6e1d6"/>
<rect x="60" y="8" width="110" height="62" fill="#cfe3f2"/><rect x="60" y="8" width="110" height="62" fill="none" stroke="#8a7f72" stroke-width="4"/>
<path d="M232 190 q30 -24 62 -8 q24 20 -6 40 q-40 14 -58 -8 z" fill="#5c4a3a"/>`);

export function demoState() {
  const tag = (o) => ({ status: 'pending', check: false, keywords: [], ...o });
  return {
    demo: true,
    moveInDate: '2025-08-15',
    person: { tenant: 'Sample Tenant', landlord: 'Sample Properties LLC', address: '100 Example St, Apt 4, Blacksburg, VA' },
    rooms: [
      {
        id: 'bedroom', name: 'Bedroom', video: { name: 'bedroom-walkthrough (sample)' }, scan: null,
        photos: [
          { id: 'p-wall', src: WALL, demoKind: 'wall', time: '2025-08-15T14:14:00', tags: [tag({ id: 't-scuff', label: 'Scuff on wall', detail: 'Near the door, about 6 in', box: [0.12, 0.3, 0.22, 0.16], keywords: ['wall', 'scuff', 'mark'], status: 'confirmed' })] },
          { id: 'p-carpet', src: CARPET, demoKind: 'carpet', time: '2025-08-15T14:16:00', tags: [tag({ id: 't-stain', label: 'Carpet stain', detail: 'Dark patch near the window', box: [0.55, 0.55, 0.25, 0.18], keywords: ['carpet', 'stain', 'floor', 'rug'], check: true })] },
        ],
      },
      { id: 'kitchen', name: 'Kitchen', video: null, scan: null, photos: [] },
    ],
    moveOut: {
      date: '2026-10-17', letterImg: null, letter: '', edited: false,
      charges: [{ id: 'c1', label: 'Carpet replacement', amount: 480 }, { id: 'c2', label: 'Painting', amount: 120 }],
    },
  };
}
