import fs from 'node:fs';
import vm from 'node:vm';

function loadConfig() {
  const source = fs.readFileSync('firebase-config.js', 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: 'firebase-config.js' });
  return sandbox.window.DARTS_FIREBASE_CONFIG;
}

const config = loadConfig();
const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/databases/(default)/documents`;
const headers = { Referer: 'https://bulls192.github.io/HotDogShopV29/' };

function decodeValue(value) {
  if (!value || typeof value !== 'object') return value;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('referenceValue' in value) return value.referenceValue;
  if ('geoPointValue' in value) return value.geoPointValue;
  if ('bytesValue' in value) return value.bytesValue;
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue?.fields || {});
  return value;
}
function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = decodeValue(v);
  return out;
}
function decodeCustom(value) {
  if (value && typeof value === 'object' && value.__encodedArray && Array.isArray(value.items)) return value.items.map(decodeCustom);
  if (Array.isArray(value)) return value.map(decodeCustom);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (k !== '__encodedArray') out[k] = decodeCustom(v);
    return out;
  }
  return value;
}
async function requestJson(url, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(url, { headers, signal: controller.signal });
    const text = await r.text();
    if (!r.ok) throw new Error(`${label}: HTTP ${r.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  } finally { clearTimeout(timer); }
}
async function getDoc(path) {
  const json = await requestJson(`${base}/${path}?key=${encodeURIComponent(config.apiKey)}`, path);
  return decodeCustom(decodeFields(json.fields || {}));
}
async function listCollection(name) {
  const rows = [];
  let pageToken = '';
  do {
    const p = new URLSearchParams({ key: config.apiKey, pageSize: '300' });
    if (pageToken) p.set('pageToken', pageToken);
    const json = await requestJson(`${base}/${name}?${p}`, name);
    for (const doc of json.documents || []) rows.push({ id: String(doc.name).split('/').pop(), data: decodeCustom(decodeFields(doc.fields || {})) });
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return rows;
}

function arr(v) { return Array.isArray(v) ? v : []; }
function norm(v) { return String(v || '').trim(); }
function playerName(p) {
  if (!p) return '';
  const first = norm(p.firstName || p.name);
  const last = norm(p.lastName);
  const nick = norm(p.nickname);
  return [first, nick ? `“${nick}”` : '', last].filter(Boolean).join(' ');
}
function teamName(t) { return [t?.player1, t?.player2].filter(Boolean).map(playerName).filter(Boolean).join(' & '); }
function tournamentState(bundle) {
  if (bundle?.tournamentState && typeof bundle.tournamentState === 'object') return bundle.tournamentState;
  if (bundle?.currentTournament?.tournamentState) return bundle.currentTournament.tournamentState;
  if (bundle?.players && bundle?.teams) return bundle;
  return null;
}
function docDate(id, bundle, ts) {
  const fromId = String(id || '').match(/\d{4}-\d{2}-\d{2}/)?.[0];
  return String(ts?.tournamentMeta?.date || bundle?.date || fromId || bundle?.savedAt || '').slice(0, 10);
}
function findTeam(ts, teamId) { return arr(ts?.teams).find(t => String(t?.id) === String(teamId)); }
function rankTeams(ts) {
  const out = [], seen = new Set();
  const add = t => { if (!t) return; const k = String(t.id ?? teamName(t)); if (!seen.has(k)) { seen.add(k); out.push(t); } };
  add(ts?.finalsState?.champion);
  add(ts?.finalsState?.runnerUp);
  arr(ts?.eliminationOrder).slice().reverse().forEach(id => add(findTeam(ts, id)));
  return out;
}
function getWeeks(obj) {
  const candidates = [obj?.weeks, obj?.weeklySeriesState?.weeks, obj?.tournamentState?.weeklySeriesState?.weeks, obj?.seriesState?.weeks];
  return candidates.find(v => v && typeof v === 'object' && !Array.isArray(v)) || {};
}
function summarizeWeek(date, w, source) {
  const placements = w?.placements || w?.places || {};
  const otherIds = arr(w?.others || w?.otherPlayers || w?.participants);
  const ids = new Set();
  for (const value of Object.values(placements || {})) {
    if (Array.isArray(value)) value.forEach(x => ids.add(typeof x === 'object' ? (x.persistentId || x.id || playerName(x)) : x));
    else if (value && typeof value === 'object') Object.values(value).forEach(x => ids.add(typeof x === 'object' ? (x.persistentId || x.id || playerName(x)) : x));
  }
  otherIds.forEach(x => ids.add(typeof x === 'object' ? (x.persistentId || x.id || playerName(x)) : x));
  return { date, source, keys: Object.keys(w || {}), inferredParticipantRefs: [...ids].filter(Boolean).length, raw: w };
}
function summarizeTournament(row, source) {
  const ts = tournamentState(row.data);
  if (!ts) return { source, id: row.id, hasTournamentState: false, topLevelKeys: Object.keys(row.data || {}) };
  const ranking = rankTeams(ts);
  const date = docDate(row.id, row.data, ts);
  const players = arr(ts.players);
  const teams = arr(ts.teams);
  const weeks = getWeeks(row.data);
  return {
    source, id: row.id, date,
    savedAt: row.data?.savedAt || row.data?.updatedAt || '',
    location: ts?.tournamentMeta?.location || '',
    players: players.length,
    teams: teams.length,
    champion: teamName(ranking[0] || ts?.finalsState?.champion),
    runnerUp: teamName(ranking[1] || ts?.finalsState?.runnerUp),
    eliminationOrder: arr(ts?.eliminationOrder).length,
    winnerMatches: arr(ts?.winnerMatches || ts?.winnerBracketMatches || ts?.matches).length,
    loserMatches: arr(ts?.loserMatches || ts?.loserBracketMatches).length,
    completed: Boolean(ts?.finalsState?.champion),
    weeklySeriesDatesEmbedded: Object.keys(weeks),
    topLevelKeys: Object.keys(row.data || {}),
    tournamentKeys: Object.keys(ts || {})
  };
}
function dateDiffDays(a, b) { return Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000); }

const errors = [];
async function safe(label, fn, fallback) { try { return await fn(); } catch (e) { errors.push(`${label}: ${e?.message || e}`); return fallback; } }
const [weekly, archives, series, current] = await Promise.all([
  safe('tournamentByWeek', () => listCollection('tournamentByWeek'), []),
  safe('tournaments', () => listCollection('tournaments'), []),
  safe('seriesSeasons/hotdogshop-2026', () => getDoc('seriesSeasons/hotdogshop-2026'), null),
  safe('appState/currentTournament', () => getDoc('appState/currentTournament'), null)
]);

const weeklySummary = weekly.map(r => summarizeTournament(r, 'tournamentByWeek'));
const archiveSummary = archives.map(r => summarizeTournament(r, 'tournaments'));
const currentSummary = current ? summarizeTournament({ id: 'currentTournament', data: current }, 'appState') : null;
const seriesWeeksObj = getWeeks(series || {});
const seriesWeeks = Object.entries(seriesWeeksObj).map(([date, w]) => summarizeWeek(date, w, 'seriesSeasons/hotdogshop-2026'));

const weeklyDates = new Set(weeklySummary.map(x => x.date).filter(Boolean));
const archiveDates = new Set(archiveSummary.map(x => x.date).filter(Boolean));
const seriesDates = new Set(seriesWeeks.map(x => x.date).filter(Boolean));
const recoverableFromArchives = archiveSummary.filter(x => x.date && !weeklyDates.has(x.date) && (x.players || x.teams || x.completed));
const recoverableFromSeries = seriesWeeks.filter(x => x.date && !weeklyDates.has(x.date));
const archiveConflicts = archiveSummary.filter(a => a.date && weeklyDates.has(a.date)).map(a => ({ archive: a, weekly: weeklySummary.filter(w => w.date === a.date) }));
const duplicateWeeklyDates = [...new Set(weeklySummary.map(x => x.date).filter(Boolean).filter((d, i, all) => all.indexOf(d) !== i))].map(date => ({ date, documents: weeklySummary.filter(x => x.date === date) }));
const partialWeekly = weeklySummary.filter(x => x.hasTournamentState === false || x.players === 0 || x.teams === 0 || !x.completed);

const meaningfulDates = [...new Set(weeklySummary.filter(x => x.players > 0 || x.teams > 0 || x.completed).map(x => x.date).filter(Boolean))].sort();
const cadenceGaps = [];
for (let i = 1; i < meaningfulDates.length; i++) {
  const days = dateDiffDays(meaningfulDates[i - 1], meaningfulDates[i]);
  if (days >= 12) cadenceGaps.push({ after: meaningfulDates[i - 1], before: meaningfulDates[i], gapDays: days, likelyMissingWeeklyEvents: Math.max(1, Math.round(days / 7) - 1) });
}

const allEvidenceDates = [...new Set([...weeklyDates, ...archiveDates, ...seriesDates])].filter(Boolean).sort();

const output = {
  generatedAt: new Date().toISOString(), projectId: config.projectId, readOnly: true, errors,
  sourceCounts: { weeklyDocuments: weekly.length, archives: archives.length, seriesWeeks: seriesWeeks.length, hasCurrentTournament: Boolean(current) },
  weeklySummary, archiveSummary,
  series: { topLevelKeys: Object.keys(series || {}), weekDates: [...seriesDates].sort(), weeks: seriesWeeks },
  currentSummary,
  recoverySignals: {
    duplicateWeeklyDates,
    partialWeekly,
    archiveOnlyTournaments: recoverableFromArchives,
    seriesOnlyWeeks: recoverableFromSeries,
    archiveSameDateComparisons: archiveConflicts,
    cadenceGaps,
    allEvidenceDates
  }
};
console.log('HDS_RECOVERY_JSON_BEGIN');
console.log(JSON.stringify(output));
console.log('HDS_RECOVERY_JSON_END');
