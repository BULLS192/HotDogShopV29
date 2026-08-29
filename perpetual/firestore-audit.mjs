import fs from 'node:fs';
import vm from 'node:vm';
import { initializeApp } from 'firebase/app';
import { collection, doc, getDoc, getDocs, getFirestore } from 'firebase/firestore';

const POINTS = { 1: 10, 2: 7, 3: 5, 4: 3, other: 1 };

function loadConfig() {
  const source = fs.readFileSync('firebase-config.js', 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: 'firebase-config.js' });
  return sandbox.window.DARTS_FIREBASE_CONFIG;
}

function decode(value) {
  if (value && typeof value === 'object' && value.__encodedArray && Array.isArray(value.items)) {
    return value.items.map(decode);
  }
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (key !== '__encodedArray') out[key] = decode(child);
    }
    return out;
  }
  return value;
}

function norm(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function nameOf(player) {
  if (!player) return 'Unknown';
  const first = String(player.firstName || player.name || '').trim();
  const last = String(player.lastName || '').trim();
  const nick = String(player.nickname || '').trim();
  if (nick && last) return `${first} “${nick}” ${last}`.trim();
  if (nick) return `${first} “${nick}”`.trim();
  return `${first} ${last}`.trim() || 'Unknown';
}

function exactKey(player) {
  const first = norm(player?.firstName || player?.name);
  if (!first) return '';
  return [first, norm(player?.lastName), norm(player?.nickname), norm(player?.gender)].join('|');
}

function weakKey(player) {
  const first = norm(player?.firstName || player?.name);
  const last = norm(player?.lastName);
  return first && last ? `${first}|${last}` : '';
}

function rawId(player, context) {
  if (player?.persistentId) return `pid:${player.persistentId}`;
  if (player?.id !== undefined && player?.id !== null && String(player.id) !== '') return `legacy:${context}:${player.id}`;
  const key = exactKey(player);
  return key ? `name:${key}` : '';
}

function getTournamentState(bundle) {
  if (bundle?.tournamentState && typeof bundle.tournamentState === 'object') return bundle.tournamentState;
  if (bundle?.currentTournament?.tournamentState) return bundle.currentTournament.tournamentState;
  if (bundle?.players && bundle?.teams) return bundle;
  return null;
}

function findTeam(teams, id) {
  return (teams || []).find(team => String(team?.id) === String(id)) || null;
}

function teamName(team) {
  if (!team) return '—';
  return [team.player1, team.player2].filter(Boolean).map(nameOf).join(' & ') || '—';
}

function rankedTeams(ts) {
  const teams = Array.isArray(ts?.teams) ? ts.teams : [];
  const ranked = [];
  const seen = new Set();
  const add = team => {
    if (!team) return;
    const key = String(team.id ?? teamName(team));
    if (seen.has(key)) return;
    seen.add(key);
    ranked.push(team);
  };
  add(ts?.finalsState?.champion);
  add(ts?.finalsState?.runnerUp);
  const order = Array.isArray(ts?.eliminationOrder) ? ts.eliminationOrder : [];
  order.slice().reverse().forEach(id => add(findTeam(teams, id)));
  return ranked;
}

function isHotDogShop(location) {
  const n = norm(location);
  return !n || n.includes('hot dog');
}

function normalizePlayerDatabasePayload(decodedValue) {
  const pdb = decodedValue?.playerDatabase;
  if (Array.isArray(pdb?.items?.items)) return pdb.items.items;
  if (Array.isArray(pdb?.items?.players)) return pdb.items.players;
  if (Array.isArray(pdb?.items)) return pdb.items;
  if (Array.isArray(pdb?.players)) return pdb.players;
  if (Array.isArray(pdb)) return pdb;
  if (Array.isArray(decodedValue?.items?.items)) return decodedValue.items.items;
  if (Array.isArray(decodedValue?.items)) return decodedValue.items;
  if (Array.isArray(decodedValue?.players)) return decodedValue.players;
  if (decodedValue?.playerDatabase?.byId && typeof decodedValue.playerDatabase.byId === 'object') return Object.values(decodedValue.playerDatabase.byId).filter(Boolean);
  if (decodedValue?.byId && typeof decodedValue.byId === 'object') return Object.values(decodedValue.byId).filter(Boolean);
  return [];
}

const config = loadConfig();
const app = initializeApp(config);
const db = getFirestore(app);

async function getDocument(collectionName, id) {
  const snap = await getDoc(doc(db, collectionName, id));
  return snap.exists() ? decode(snap.data()) : null;
}

async function getCollection(collectionName) {
  const snap = await getDocs(collection(db, collectionName));
  return snap.docs.map(d => ({ id: d.id, data: decode(d.data()) }));
}

const errors = [];
async function safe(label, fn, fallback) {
  try {
    return await fn();
  } catch (error) {
    errors.push(`${label}: ${error?.message || error}`);
    return fallback;
  }
}

const [playerDbDoc, currentDoc, seriesDoc, weeklyDocs, archiveDocs] = await Promise.all([
  safe('appState/playerDatabase', () => getDocument('appState', 'playerDatabase'), null),
  safe('appState/currentTournament', () => getDocument('appState', 'currentTournament'), null),
  safe('seriesSeasons/hotdogshop-2026', () => getDocument('seriesSeasons', 'hotdogshop-2026'), null),
  safe('tournamentByWeek', () => getCollection('tournamentByWeek'), []),
  safe('tournaments', () => getCollection('tournaments'), [])
]);

const identityRecords = [];
function remember(player, source, context) {
  if (!player || typeof player !== 'object') return;
  const id = rawId(player, context);
  const exact = exactKey(player);
  if (!id && !exact) return;
  identityRecords.push({ id: id || `anon:${context}:${identityRecords.length}`, exact, weak: weakKey(player), player, source, context });
}

normalizePlayerDatabasePayload(playerDbDoc || {}).forEach(p => remember(p, 'playerDatabase', 'playerDatabase'));
normalizePlayerDatabasePayload(currentDoc || {}).forEach(p => remember(p, 'currentTournamentPlayerDatabase', 'currentTournament'));

const allEvents = [];
for (const row of weeklyDocs) {
  const ts = getTournamentState(row.data);
  if (!ts) continue;
  const meta = ts.tournamentMeta || {};
  const match = row.id.match(/^\d{4}-\d{2}-\d{2}/);
  const date = String(meta.date || match?.[0] || row.data?.savedAt || '').slice(0, 10);
  const location = String(meta.location || '').trim();
  const players = Array.isArray(ts.players) ? ts.players : [];
  const teams = Array.isArray(ts.teams) ? ts.teams : [];
  players.forEach(p => remember(p, 'event', row.id));
  teams.forEach(t => {
    remember(t?.player1, 'eventTeam', row.id);
    remember(t?.player2, 'eventTeam', row.id);
  });
  const ranking = rankedTeams(ts);
  allEvents.push({
    id: row.id,
    date,
    location: location || 'Hot Dog Shop',
    players,
    teams,
    ranking,
    champion: ranking[0] || ts?.finalsState?.champion || null,
    runnerUp: ranking[1] || ts?.finalsState?.runnerUp || null,
    completed: Boolean(ts?.finalsState?.champion)
  });
}

const events = allEvents.filter(e => isHotDogShop(e.location));

const sourceGroups = new Map();
for (const record of identityRecords) {
  if (!sourceGroups.has(record.id)) sourceGroups.set(record.id, []);
  sourceGroups.get(record.id).push(record);
}

const sourceEntities = [...sourceGroups.entries()].map(([id, records]) => ({
  id,
  exact: records.find(r => r.exact)?.exact || '',
  weak: records.find(r => r.weak)?.weak || '',
  records,
  representative: records
    .slice()
    .sort((a, b) => nameOf(b.player).length - nameOf(a.player).length)[0]?.player || {}
}));

const exactGroups = new Map();
for (const entity of sourceEntities) {
  const group = entity.exact || `source:${entity.id}`;
  if (!exactGroups.has(group)) exactGroups.set(group, []);
  exactGroups.get(group).push(entity);
}

const sourceToCanonical = new Map();
const exactToCanonical = new Map();
const canonical = new Map();
const exactDuplicates = [];
let canonCounter = 0;
for (const [groupKey, entities] of exactGroups.entries()) {
  canonCounter += 1;
  const id = `audit-${canonCounter}`;
  const representative = entities[0].representative;
  const sourceIds = [...new Set(entities.map(e => e.id))];
  const exact = entities[0].exact || '';
  const weak = entities[0].weak || '';
  const eventIds = [...new Set(entities.flatMap(e => e.records.filter(r => r.source.startsWith('event')).map(r => r.context)))];
  canonical.set(id, { id, name: nameOf(representative), exact, weak, sourceIds, eventIds });
  sourceIds.forEach(sourceId => sourceToCanonical.set(sourceId, id));
  if (exact) exactToCanonical.set(exact, id);
  if (sourceIds.length > 1 && exact) {
    exactDuplicates.push({ name: nameOf(representative), sourceIds, eventCount: eventIds.length });
  }
}

const possibleDuplicates = [];
const weakGroups = new Map();
for (const player of canonical.values()) {
  if (!player.weak) continue;
  if (!weakGroups.has(player.weak)) weakGroups.set(player.weak, []);
  weakGroups.get(player.weak).push(player);
}
for (const players of weakGroups.values()) {
  if (players.length > 1) {
    possibleDuplicates.push({
      names: players.map(p => p.name),
      sourceIds: [...new Set(players.flatMap(p => p.sourceIds))]
    });
  }
}

function canonicalId(player, eventId) {
  const id = rawId(player, eventId);
  if (id && sourceToCanonical.has(id)) return sourceToCanonical.get(id);
  const exact = exactKey(player);
  return exactToCanonical.get(exact) || null;
}

const resultRows = [];
for (const event of events) {
  if (!event.completed && event.ranking.length < 2) continue;
  const perPlayer = new Map();
  const add = (player, placement, points) => {
    const id = canonicalId(player, event.id);
    if (!id) return;
    const old = perPlayer.get(id);
    const row = { canonicalId: id, placement, points, eventId: event.id, date: event.date };
    if (!old || row.points > old.points || (placement && (!old.placement || placement < old.placement))) perPlayer.set(id, row);
  };
  event.players.forEach(p => add(p, null, POINTS.other));
  event.ranking.slice(0, 4).forEach((team, index) => {
    const place = index + 1;
    [team?.player1, team?.player2].filter(Boolean).forEach(p => add(p, place, POINTS[place]));
  });
  resultRows.push(...perPlayer.values());
}

const standings = new Map();
for (const result of resultRows) {
  if (!standings.has(result.canonicalId)) {
    standings.set(result.canonicalId, { player: canonical.get(result.canonicalId)?.name || result.canonicalId, points: 0, played: 0, wins: 0, podiums: 0, lastPlayed: '' });
  }
  const row = standings.get(result.canonicalId);
  row.points += result.points;
  row.played += 1;
  if (result.placement === 1) row.wins += 1;
  if (result.placement && result.placement <= 3) row.podiums += 1;
  if (result.date > row.lastPlayed) row.lastPlayed = result.date;
}

const standingsRows = [...standings.values()]
  .map(row => ({ ...row, ppe: row.played ? Number((row.points / row.played).toFixed(2)) : 0 }))
  .sort((a, b) => b.points - a.points || b.wins - a.wins || b.podiums - a.podiums || b.played - a.played || a.player.localeCompare(b.player));

const eventTimeline = events
  .slice()
  .sort((a, b) => b.date.localeCompare(a.date))
  .map(e => ({ date: e.date, location: e.location, players: e.players.length, teams: e.teams.length, champion: teamName(e.champion), runnerUp: teamName(e.runnerUp), source: e.id }));

const output = {
  generatedAt: new Date().toISOString(),
  projectId: config.projectId,
  readOnly: true,
  accessErrors: errors,
  collectionCounts: {
    tournamentByWeek: weeklyDocs.length,
    hotDogShopEvents: events.length,
    otherLocationEvents: allEvents.length - events.length,
    archives: archiveDocs.length,
    playerDatabaseRows: normalizePlayerDatabasePayload(playerDbDoc || {}).length
  },
  dateRange: eventTimeline.length ? { earliest: eventTimeline[eventTimeline.length - 1].date, latest: eventTimeline[0].date } : null,
  identity: {
    rawSourceIds: sourceEntities.length,
    canonicalPlayersPreview: canonical.size,
    exactDuplicateGroups: exactDuplicates,
    possibleDuplicateGroups: possibleDuplicates
  },
  standings: standingsRows,
  eventTimeline
};

console.log('HDS_AUDIT_JSON_BEGIN');
console.log(JSON.stringify(output));
console.log('HDS_AUDIT_JSON_END');
