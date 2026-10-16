#!/usr/bin/env node
/**
 * Regenerates zones.js from the IANA database shipped with the OS
 * (/usr/share/zoneinfo/zone.tab), so every country on earth is covered without
 * anyone hand-maintaining a list.
 *
 *   node tools-genzones.js            # writes zones.js
 *
 * Curated entries from the previous zones.js win on city/region/tags, because
 * "Mumbai" beats "Kolkata" as the label for Asia/Kolkata and the hand-written
 * search tags are better than anything derivable. Everything else is generated.
 *
 * Re-run it after a macOS tzdata update; nothing else needs touching.
 */
const fs = require('fs');
const path = require('path');

const TAB = '/usr/share/zoneinfo/zone.tab';

// Countries whose main zone isn't the first one listed in zone.tab. The first
// entry for a country is the widget's default, i.e. what a country-only
// profile like "Australia" resolves to.
const PREFERRED = {
  AU: 'Australia/Sydney',   CA: 'America/Toronto',   US: 'America/New_York',
  BR: 'America/Sao_Paulo',  RU: 'Europe/Moscow',     MX: 'America/Mexico_City',
  ID: 'Asia/Jakarta',       CN: 'Asia/Shanghai',     ES: 'Europe/Madrid',
  PT: 'Europe/Lisbon',      CL: 'America/Santiago',  AR: 'America/Argentina/Buenos_Aires',
  KZ: 'Asia/Almaty',        NZ: 'Pacific/Auckland',  EC: 'America/Guayaquil',
  MY: 'Asia/Kuala_Lumpur',  IN: 'Asia/Kolkata',      GL: 'America/Nuuk',
  UA: 'Europe/Kyiv',        PF: 'Pacific/Tahiti',    CD: 'Africa/Kinshasa',
  MN: 'Asia/Ulaanbaatar',   PG: 'Pacific/Port_Moresby', FM: 'Pacific/Pohnpei',
  PS: 'Asia/Gaza',          UZ: 'Asia/Tashkent',     CY: 'Asia/Nicosia',
  AQ: 'Antarctica/McMurdo'
};

// Not in zone.tab, but people live and work there.
const EXTRAS = [{ cc: 'XK', zone: 'Europe/Belgrade', comment: '', name: 'Kosovo' }];
const OUT = path.join(__dirname, 'zones.js');

// --- keep the curated entries --------------------------------------------
let curated = [];
try {
  global.window = {};
  require('./zones.js');
  curated = window.ZONES || [];
} catch { /* first run */ }
const curatedBy = new Map(curated.map(z => [z.zone, z]));
const curatedOrder = new Map(curated.map((z, i) => [z.zone, i]));

// --- country names and flags, straight from the platform ------------------
const regionName = new Intl.DisplayNames(['en'], { type: 'region' });

function flagOf(cc) {
  if (!/^[A-Z]{2}$/.test(cc)) return '🌍';
  const f = String.fromCodePoint(...[...cc].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
  return f;
}

function countryOf(cc) {
  try {
    const n = regionName.of(cc);
    return n && n !== cc ? n : cc;
  } catch { return cc; }
}

function cityOf(zone) {
  return zone.split('/').pop().replace(/_/g, ' ');
}

// --- parse ----------------------------------------------------------------
const rows = fs.readFileSync(TAB, 'utf8')
  .split('\n')
  .filter(l => l && !l.startsWith('#'))
  .map(l => l.split('\t'))
  .filter(p => p.length >= 3)
  .map(p => ({ cc: p[0].trim(), zone: p[2].trim(), comment: (p[3] || '').trim() }));

for (const x of EXTRAS) {
  if (!rows.some(r => r.cc === x.cc)) rows.push(x);
}

const entries = rows.map(r => {
  // An EXTRAS row shares a zone with another country, so it must not inherit
  // that country's curated entry.
  const c = r.name ? null : curatedBy.get(r.zone);
  const country = r.name || countryOf(r.cc);
  const generatedTags = [r.comment, r.zone.replace(/[_/]/g, ' '), r.cc]
    .join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
  return {
    city:    c ? c.city   : cityOf(r.zone),
    region:  c ? c.region : r.comment,
    country: c ? c.country : country,
    flag:    c ? c.flag   : flagOf(r.cc),
    zone:    r.zone,
    cc:      r.cc,
    // Curated tags first so hand-picked search terms still rank, plus the
    // generated ones so every zone is findable by its own name.
    tags: [...new Set(((c && c.tags ? c.tags + ' ' : '') + generatedTags).split(' ').filter(Boolean))].join(' ')
  };
});

// Curated entries keep their original order (which sets each country's default
// zone — the first entry wins); everything else follows, grouped by country.
// Order: group the zones by country, put each country's main zone first, and
// keep the groups themselves in the order the curated list established. A
// single comparator can't express "preferred first, but only within a country"
// without becoming intransitive, so group explicitly instead.
const rank = (z) => (curatedOrder.has(z.zone) ? curatedOrder.get(z.zone) : Infinity);

const groups = new Map();
for (const e of entries) {
  if (!groups.has(e.cc)) groups.set(e.cc, []);
  groups.get(e.cc).push(e);
}

for (const list of groups.values()) {
  list.sort((a, b) => {
    const ap = PREFERRED[a.cc] === a.zone ? 0 : 1;
    const bp = PREFERRED[b.cc] === b.zone ? 0 : 1;
    if (ap !== bp) return ap - bp;
    const ar = rank(a), br = rank(b);
    if (ar !== br) return ar - br;
    return a.city.localeCompare(b.city);
  });
}

const ordered = [...groups.values()]
  .sort((A, B) => {
    const ar = Math.min(...A.map(rank)), br = Math.min(...B.map(rank));
    if (ar !== br) return ar - br;
    return A[0].country.localeCompare(B[0].country);
  })
  .flat();

entries.length = 0;
entries.push(...ordered);

// --- sanity ---------------------------------------------------------------
const bad = entries.filter(e => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: e.zone }); return false; }
  catch { return true; }
});
if (bad.length) {
  console.error('invalid zones:', bad.map(b => b.zone));
  process.exit(1);
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const body = entries.map(e =>
  `  { city: '${esc(e.city)}', region: '${esc(e.region)}', country: '${esc(e.country)}', ` +
  `flag: '${e.flag}', zone: '${e.zone}', cc: '${e.cc}', tags: '${esc(e.tags)}' }`
).join(',\n');

fs.writeFileSync(OUT, `// GENERATED by tools-genzones.js from ${TAB} — do not edit by hand.
// Every country and territory in the IANA database: ${new Set(entries.map(e => e.cc)).size} countries,
// ${entries.length} zones. Re-run \`node tools-genzones.js\` after a tzdata update.
window.ZONES = [
${body}
];
`);

console.log(`wrote ${entries.length} zones across ${new Set(entries.map(e => e.cc)).size} countries`);
console.log(`curated kept: ${entries.filter(e => curatedBy.has(e.zone)).length}`);
