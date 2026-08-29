const POINTS = { 1: 10, 2: 7, 3: 5, 4: 3, other: 1 };

const state = {
  db: null,
  raw: {
    currentTournament: null,
    playerDatabase: null,
    seriesSeason: null,
    tournamentByWeek: [],
    tournaments: []
  },
  loadErrors: [],
  identityRecords: [],
  directory: null,
  events: [],
  results: [],
  standingsMode: "all"
};

function $(id) {
  return document.getElementById(id);
}

function setStatus(mode, text, detail = "") {
  const dot = $("status-dot");
  dot.className = `dot ${mode}`;
  $("status-text").textContent = text;
  $("status-detail").textContent = detail;
}

function decodeFromFirestore(value) {
  if (value && typeof value === "object" && value.__encodedArray && Array.isArray(value.items)) {
    return value.items.map(decodeFromFirestore);
  }
  if (Array.isArray(value)) return value.map(decodeFromFirestore);
  if (value && typeof value === "object") {
    const out = {};
    Object.entries(value).forEach(([key, child]) => {
      if (key !== "__encodedArray") out[key] = decodeFromFirestore(child);
    });
    return out;
  }
  return value;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function simpleHash(input) {
  let hash = 2166136261;
  const text = String(input || "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function displayName(player) {
  if (!player) return "Unknown player";
  const first = String(player.firstName || player.name || "").trim();
  const last = String(player.lastName || "").trim();
  const nick = String(player.nickname || "").trim();
  if (nick && last) return `${first} “${nick}” ${last}`.trim();
  if (nick) return `${first} “${nick}”`.trim();
  return `${first} ${last}`.trim() || "Unknown player";
}

function teamLabel(team) {
  if (!team) return "—";
  const names = [team.player1, team.player2].filter(Boolean).map(displayName);
  return names.length ? names.join(" & ") : "—";
}

function exactIdentityKey(player) {
  const first = normalizeText(player?.firstName || player?.name);
  const last = normalizeText(player?.lastName);
  const nick = normalizeText(player?.nickname);
  const gender = normalizeText(player?.gender);
  if (!first) return "";
  return `${first}|${last}|${nick}|${gender}`;
}

function weakIdentityKey(player) {
  const first = normalizeText(player?.firstName || player?.name);
  const last = normalizeText(player?.lastName);
  if (!first || !last) return "";
  return `${first}|${last}`;
}

function sourceIdForPlayer(player, contextId = "global") {
  if (!player || typeof player !== "object") return "";
  if (player.persistentId) return `pid:${String(player.persistentId)}`;
  if (player.id !== undefined && player.id !== null && String(player.id) !== "") {
    return `legacy:${contextId}:${String(player.id)}`;
  }
  const signature = exactIdentityKey(player);
  return signature ? `signature:${simpleHash(signature)}` : "";
}

function bestRepresentative(records) {
  if (!records.length) return {};
  return records.slice().sort((a, b) => {
    const score = item => {
      const p = item.player || {};
      const completeness = [p.firstName, p.lastName, p.nickname, p.gender].filter(v => String(v || "").trim()).length * 100;
      const length = displayName(p).length;
      const dbBonus = item.source === "playerDatabase" ? 20 : 0;
      return completeness + length + dbBonus;
    };
    return score(b) - score(a);
  })[0].player || {};
}

function addIdentityRecord(player, source, contextId = "global") {
  if (!player || typeof player !== "object") return;
  const sourceId = sourceIdForPlayer(player, contextId);
  const exactKey = exactIdentityKey(player);
  if (!sourceId && !exactKey) return;
  state.identityRecords.push({
    sourceId: sourceId || `anonymous:${simpleHash(JSON.stringify(player))}`,
    exactKey,
    weakKey: weakIdentityKey(player),
    player,
    source,
    contextId
  });
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
  if (decodedValue?.playerDatabase?.byId && typeof decodedValue.playerDatabase.byId === "object") {
    return Object.values(decodedValue.playerDatabase.byId).filter(Boolean);
  }
  if (decodedValue?.byId && typeof decodedValue.byId === "object") {
    return Object.values(decodedValue.byId).filter(Boolean);
  }
  return [];
}

async function loadDoc(collectionName, docId) {
  const snap = await state.db.collection(collectionName).doc(docId).get();
  return snap.exists ? decodeFromFirestore(snap.data() || {}) : null;
}

async function loadCollection(collectionName) {
  const snap = await state.db.collection(collectionName).get();
  return snap.docs.map(doc => ({
    id: doc.id,
    data: decodeFromFirestore(doc.data() || {})
  }));
}

function settledValue(result, label, fallback) {
  if (result.status === "fulfilled") return result.value;
  state.loadErrors.push(`${label}: ${result.reason?.message || result.reason || "failed"}`);
  return fallback;
}

function getTournamentState(bundle) {
  if (!bundle || typeof bundle !== "object") return null;
  if (bundle.tournamentState && typeof bundle.tournamentState === "object") return bundle.tournamentState;
  if (bundle.currentTournament?.tournamentState) return bundle.currentTournament.tournamentState;
  if (bundle.players && bundle.teams) return bundle;
  return null;
}

function findTeamById(teams, id) {
  return (teams || []).find(team => String(team?.id) === String(id)) || null;
}

function deriveTeamRanking(tournamentState) {
  const teams = Array.isArray(tournamentState?.teams) ? tournamentState.teams : [];
  if (!teams.length) return [];

  const ranked = [];
  const seen = new Set();
  const pushTeam = team => {
    if (!team) return;
    const key = String(team.id ?? teamLabel(team));
    if (seen.has(key)) return;
    seen.add(key);
    ranked.push(team);
  };

  pushTeam(tournamentState?.finalsState?.champion || null);
  pushTeam(tournamentState?.finalsState?.runnerUp || null);

  const eliminationOrder = Array.isArray(tournamentState?.eliminationOrder)
    ? tournamentState.eliminationOrder
    : [];
  eliminationOrder.slice().reverse().forEach(id => pushTeam(findTeamById(teams, id)));

  const losses = tournamentState?.teamLosses || {};
  teams
    .filter(team => !seen.has(String(team.id ?? teamLabel(team))))
    .sort((a, b) => {
      const lossDiff = Number(losses[a.id] || 0) - Number(losses[b.id] || 0);
      if (lossDiff) return lossDiff;
      return Number(a.id || 0) - Number(b.id || 0);
    })
    .forEach(pushTeam);

  return ranked;
}

function getMatchingWeekRecord(bundle, date) {
  const sources = [
    bundle?.weeklySeriesState?.weeks,
    bundle?.tournamentState?.weeklySeriesState?.weeks,
    state.raw.seriesSeason?.weeks
  ];
  for (const weeks of sources) {
    if (weeks && date && weeks[date]) return weeks[date];
  }
  return null;
}

function lookupHistoricalPlayer(storedId) {
  const raw = String(storedId || "");
  if (!raw) return null;
  for (const record of state.identityRecords) {
    const p = record.player || {};
    if (String(p.persistentId || "") === raw || String(p.id || "") === raw) return p;
  }
  return null;
}

function buildEvent(doc) {
  const bundle = doc.data || {};
  const ts = getTournamentState(bundle);
  if (!ts) return null;

  const meta = ts.tournamentMeta || {};
  const dateMatch = String(doc.id || "").match(/^\d{4}-\d{2}-\d{2}/);
  const date = String(meta.date || dateMatch?.[0] || bundle.savedAt || "").slice(0, 10);
  const location = String(meta.location || "Hot Dog Shop").trim() || "Hot Dog Shop";
  const players = Array.isArray(ts.players) ? ts.players : [];
  const teams = Array.isArray(ts.teams) ? ts.teams : [];

  players.forEach(p => addIdentityRecord(p, "event", doc.id));
  teams.forEach(team => {
    if (team?.player1) addIdentityRecord(team.player1, "eventTeam", doc.id);
    if (team?.player2) addIdentityRecord(team.player2, "eventTeam", doc.id);
  });

  const rankedTeams = deriveTeamRanking(ts);
  const weekRecord = getMatchingWeekRecord(bundle, date);
  const completed = Boolean(ts?.finalsState?.champion) || Boolean(weekRecord);

  return {
    eventId: `hotdogshop:${doc.id}`,
    sourceDocumentId: doc.id,
    sourceCollection: "tournamentByWeek",
    date,
    location,
    savedAt: bundle.savedAt || "",
    tournamentState: ts,
    players,
    teams,
    rankedTeams,
    weekRecord,
    completed,
    champion: rankedTeams[0] || ts?.finalsState?.champion || null,
    runnerUp: rankedTeams[1] || ts?.finalsState?.runnerUp || null
  };
}

function buildFallbackArchiveEvents() {
  return state.raw.tournaments.map(doc => {
    const event = buildEvent({ id: doc.id, data: doc.data });
    if (event) {
      event.eventId = `hotdogshop:archive:${doc.id}`;
      event.sourceCollection = "tournaments";
    }
    return event;
  }).filter(Boolean);
}

function buildCanonicalDirectory() {
  const sourceMap = new Map();
  state.identityRecords.forEach(record => {
    if (!sourceMap.has(record.sourceId)) sourceMap.set(record.sourceId, []);
    sourceMap.get(record.sourceId).push(record);
  });

  const sourceEntities = Array.from(sourceMap.entries()).map(([sourceId, records]) => ({
    sourceId,
    records,
    player: bestRepresentative(records),
    exactKey: records.map(r => r.exactKey).find(Boolean) || "",
    weakKey: records.map(r => r.weakKey).find(Boolean) || "",
    eventIds: Array.from(new Set(records.filter(r => r.source.startsWith("event")).map(r => r.contextId)))
  }));

  const exactGroups = new Map();
  sourceEntities.forEach(entity => {
    const groupKey = entity.exactKey || `source:${entity.sourceId}`;
    if (!exactGroups.has(groupKey)) exactGroups.set(groupKey, []);
    exactGroups.get(groupKey).push(entity);
  });

  const canonicalPlayers = [];
  const sourceToCanonical = new Map();
  const exactKeyToCanonical = new Map();
  const exactDuplicateGroups = [];

  exactGroups.forEach((entities, groupKey) => {
    const records = entities.flatMap(e => e.records);
    const representative = bestRepresentative(records);
    const sourceIds = Array.from(new Set(entities.map(e => e.sourceId)));
    const canonicalId = `hds_${simpleHash(groupKey)}`;
    const eventIds = Array.from(new Set(entities.flatMap(e => e.eventIds)));
    const canonical = {
      canonicalPlayerId: canonicalId,
      firstName: representative.firstName || representative.name || "",
      lastName: representative.lastName || "",
      nickname: representative.nickname || "",
      gender: representative.gender || "",
      displayName: displayName(representative),
      sourcePlayerIds: sourceIds,
      eventIds,
      exactKey: entities[0]?.exactKey || "",
      weakKey: entities[0]?.weakKey || "",
      nexusPlayerId: null
    };
    canonicalPlayers.push(canonical);
    sourceIds.forEach(sourceId => sourceToCanonical.set(sourceId, canonicalId));
    if (canonical.exactKey) exactKeyToCanonical.set(canonical.exactKey, canonicalId);

    if (sourceIds.length > 1 && canonical.exactKey) {
      exactDuplicateGroups.push({
        confidence: "Exact",
        name: canonical.displayName,
        sourceIds,
        eventCount: eventIds.length,
        reason: "Same normalized first name, last name, nickname, and gender across multiple source IDs. Preview-only collapse."
      });
    }
  });

  const weakGroups = new Map();
  canonicalPlayers.forEach(player => {
    if (!player.weakKey) return;
    if (!weakGroups.has(player.weakKey)) weakGroups.set(player.weakKey, []);
    weakGroups.get(player.weakKey).push(player);
  });

  const possibleDuplicateGroups = [];
  weakGroups.forEach(players => {
    if (players.length < 2) return;
    const ids = Array.from(new Set(players.flatMap(p => p.sourcePlayerIds)));
    const eventIds = Array.from(new Set(players.flatMap(p => p.eventIds)));
    possibleDuplicateGroups.push({
      confidence: "Possible",
      name: players.map(p => p.displayName).join(" / "),
      sourceIds: ids,
      eventCount: eventIds.length,
      reason: "Same normalized first + last name, but nickname and/or gender differs. Never auto-merged."
    });
  });

  return {
    canonicalPlayers: canonicalPlayers.sort((a, b) => a.displayName.localeCompare(b.displayName)),
    sourceToCanonical,
    exactKeyToCanonical,
    duplicateGroups: exactDuplicateGroups.concat(possibleDuplicateGroups)
  };
}

function resolveCanonicalId(player, eventId) {
  if (!player) return "";
  const sourceId = sourceIdForPlayer(player, eventId);
  if (sourceId && state.directory.sourceToCanonical.has(sourceId)) {
    return state.directory.sourceToCanonical.get(sourceId);
  }
  const exactKey = exactIdentityKey(player);
  if (exactKey && state.directory.exactKeyToCanonical.has(exactKey)) {
    return state.directory.exactKeyToCanonical.get(exactKey);
  }
  return sourceId ? `hds_${simpleHash(sourceId)}` : "";
}

function buildResultsFromEvent(event) {
  const perPlayer = new Map();

  const add = (player, placement, points, source) => {
    if (!player) return;
    const canonicalPlayerId = resolveCanonicalId(player, event.sourceDocumentId);
    if (!canonicalPlayerId) return;
    const existing = perPlayer.get(canonicalPlayerId);
    const candidate = {
      eventId: event.eventId,
      canonicalPlayerId,
      placement: placement || null,
      points: Number(points || 0),
      source,
      date: event.date,
      location: event.location
    };
    if (!existing || candidate.points > existing.points || (candidate.placement && (!existing.placement || candidate.placement < existing.placement))) {
      perPlayer.set(canonicalPlayerId, candidate);
    }
  };

  event.players.forEach(player => add(player, null, POINTS.other, "tournament-participant"));

  event.rankedTeams.slice(0, 4).forEach((team, index) => {
    const place = index + 1;
    [team?.player1, team?.player2].filter(Boolean).forEach(player => add(player, place, POINTS[place], "derived-tournament-placement"));
  });

  if (!event.rankedTeams.length && event.weekRecord) {
    [1, 2, 3, 4].forEach(place => {
      const raw = event.weekRecord?.placements?.[place] ?? event.weekRecord?.placements?.[String(place)];
      const ids = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      ids.forEach(id => {
        const player = lookupHistoricalPlayer(id);
        if (player) add(player, place, POINTS[place], "saved-week-placement");
      });
    });
    const others = Array.isArray(event.weekRecord?.others) ? event.weekRecord.others : [];
    others.forEach(id => {
      const player = lookupHistoricalPlayer(id);
      if (player) add(player, null, POINTS.other, "saved-week-participant");
    });
  }

  return Array.from(perPlayer.values());
}

function buildAllResults() {
  return state.events
    .filter(event => event.completed || event.rankedTeams.length > 1)
    .flatMap(buildResultsFromEvent);
}

function canonicalPlayerById(id) {
  return state.directory?.canonicalPlayers.find(p => p.canonicalPlayerId === id) || null;
}

function selectedEventIds(mode) {
  const events = state.events.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (mode === "year") {
    const year = String(new Date().getFullYear());
    return new Set(events.filter(e => String(e.date).startsWith(`${year}-`)).map(e => e.eventId));
  }
  if (mode === "rolling12") {
    return new Set(events.slice(0, 12).map(e => e.eventId));
  }
  return new Set(events.map(e => e.eventId));
}

function computeStandings(mode = "all") {
  const allowed = selectedEventIds(mode);
  const rows = new Map();
  state.results.filter(result => allowed.has(result.eventId)).forEach(result => {
    if (!rows.has(result.canonicalPlayerId)) {
      rows.set(result.canonicalPlayerId, {
        canonicalPlayerId: result.canonicalPlayerId,
        player: canonicalPlayerById(result.canonicalPlayerId),
        points: 0,
        played: 0,
        wins: 0,
        podiums: 0,
        lastPlayed: ""
      });
    }
    const row = rows.get(result.canonicalPlayerId);
    row.points += Number(result.points || 0);
    row.played += 1;
    if (result.placement === 1) row.wins += 1;
    if (result.placement && result.placement <= 3) row.podiums += 1;
    if (String(result.date) > String(row.lastPlayed)) row.lastPlayed = result.date;
  });

  return Array.from(rows.values())
    .map(row => ({ ...row, pointsPerEntry: row.played ? row.points / row.played : 0 }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.podiums !== a.podiums) return b.podiums - a.podiums;
      if (b.played !== a.played) return b.played - a.played;
      return String(a.player?.displayName || "").localeCompare(String(b.player?.displayName || ""));
    });
}

function renderStandings() {
  const tbody = $("standings-table").querySelector("tbody");
  const rows = computeStandings(state.standingsMode);
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">No standings data found for this window.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((row, index) => `
    <tr>
      <td class="num">${index + 1}</td>
      <td><span class="player-name">${escapeHtml(row.player?.displayName || row.canonicalPlayerId)}</span></td>
      <td class="num"><strong>${row.points}</strong></td>
      <td class="num">${row.played}</td>
      <td class="num">${row.wins}</td>
      <td class="num">${row.podiums}</td>
      <td class="num">${row.pointsPerEntry.toFixed(2)}</td>
      <td>${escapeHtml(row.lastPlayed || "—")}</td>
    </tr>
  `).join("");
}

function renderDuplicates() {
  const tbody = $("duplicate-table").querySelector("tbody");
  const groups = state.directory?.duplicateGroups || [];
  if (!groups.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No duplicate candidates detected by the current conservative rules.</td></tr>';
    return;
  }
  tbody.innerHTML = groups
    .sort((a, b) => a.confidence.localeCompare(b.confidence) || a.name.localeCompare(b.name))
    .map(group => `
      <tr>
        <td><span class="badge ${group.confidence.toLowerCase()}">${escapeHtml(group.confidence)}</span></td>
        <td class="player-name">${escapeHtml(group.name)}</td>
        <td class="id-list">${group.sourceIds.map(escapeHtml).join("<br>")}</td>
        <td class="num">${group.eventCount}</td>
        <td>${escapeHtml(group.reason)}</td>
      </tr>
    `).join("");
}

function renderEvents() {
  const tbody = $("events-table").querySelector("tbody");
  const rows = state.events.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">No weekly tournament documents found.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(event => `
    <tr>
      <td>${escapeHtml(event.date || "—")}</td>
      <td>${escapeHtml(event.location || "—")}</td>
      <td class="num">${event.players.length}</td>
      <td class="num">${event.teams.length}</td>
      <td>${escapeHtml(teamLabel(event.champion))}</td>
      <td>${escapeHtml(teamLabel(event.runnerUp))}</td>
      <td class="id-list">${escapeHtml(`${event.sourceCollection}/${event.sourceDocumentId}`)}</td>
    </tr>
  `).join("");
}

function renderMetrics() {
  const events = state.events.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const latest = events[events.length - 1] || null;
  const rawSourceIds = new Set(state.identityRecords.map(r => r.sourceId));
  const exactCount = state.directory?.duplicateGroups.filter(g => g.confidence === "Exact").length || 0;
  const possibleCount = state.directory?.duplicateGroups.filter(g => g.confidence === "Possible").length || 0;

  $("metric-events").textContent = String(events.length);
  $("metric-event-range").textContent = events.length ? `${events[0].date || "?"} → ${latest?.date || "?"}` : "No event history found";
  $("metric-raw-players").textContent = String(rawSourceIds.size);
  $("metric-clean-players").textContent = String(state.directory?.canonicalPlayers.length || 0);
  $("metric-duplicates").textContent = String(exactCount + possibleCount);
  $("metric-duplicates").title = `${exactCount} exact preview groups · ${possibleCount} possible groups`;
  $("metric-latest").textContent = latest?.date || "—";
  $("metric-latest-location").textContent = latest?.location || "—";
}

function renderAll() {
  renderMetrics();
  renderStandings();
  renderDuplicates();
  renderEvents();
  $("export-raw-btn").disabled = false;
  $("export-clean-btn").disabled = false;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function timestampForFilename() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function exportRawBackup() {
  downloadJson(`hotdogshop-firebase-raw-backup_${timestampForFilename()}.json`, {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    projectId: window.DARTS_FIREBASE_CONFIG?.projectId || null,
    source: "HotDogShopV29",
    readOnly: true,
    loadErrors: state.loadErrors,
    data: state.raw
  });
}

function exportCleanPreview() {
  const cleanEvents = state.events.map(event => ({
    eventId: event.eventId,
    date: event.date,
    location: event.location,
    sourceCollection: event.sourceCollection,
    sourceDocumentId: event.sourceDocumentId,
    playerCount: event.players.length,
    teamCount: event.teams.length,
    completed: event.completed,
    champion: teamLabel(event.champion),
    runnerUp: teamLabel(event.runnerUp)
  }));
  const cleanResults = state.results.map(result => ({
    eventId: result.eventId,
    canonicalPlayerId: result.canonicalPlayerId,
    placement: result.placement,
    points: result.points,
    date: result.date,
    location: result.location,
    derivation: result.source
  }));

  downloadJson(`hotdogshop-nexus-migration-preview_${timestampForFilename()}.json`, {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: "hotdogshop-v29",
    readOnlyPreview: true,
    scoring: { first: 10, second: 7, third: 5, fourth: 3, otherParticipant: 1 },
    migrationNotes: [
      "Canonical player IDs are preview identities only; no Firestore records were changed.",
      "Exact normalized identity groups may still require human review before a permanent merge.",
      "nexusPlayerId is intentionally null until Nexus becomes the authoritative identity layer.",
      "Standings are recomputed from event history rather than legacy accumulated player stats."
    ],
    players: state.directory.canonicalPlayers.map(player => ({
      canonicalPlayerId: player.canonicalPlayerId,
      firstName: player.firstName,
      lastName: player.lastName,
      nickname: player.nickname,
      gender: player.gender,
      displayName: player.displayName,
      sourcePlayerIds: player.sourcePlayerIds,
      nexusPlayerId: null
    })),
    events: cleanEvents,
    results: cleanResults,
    standings: {
      allTime: computeStandings("all").map((row, index) => ({
        rank: index + 1,
        canonicalPlayerId: row.canonicalPlayerId,
        points: row.points,
        played: row.played,
        wins: row.wins,
        podiums: row.podiums,
        pointsPerEntry: Number(row.pointsPerEntry.toFixed(3)),
        lastPlayed: row.lastPlayed
      })),
      rolling12: computeStandings("rolling12").map((row, index) => ({
        rank: index + 1,
        canonicalPlayerId: row.canonicalPlayerId,
        points: row.points,
        played: row.played,
        wins: row.wins,
        podiums: row.podiums
      }))
    },
    duplicateReview: state.directory.duplicateGroups
  });
}

async function loadFirebaseData() {
  setStatus("pending", "Connecting to Firebase…", "Read-only queries only.");
  state.loadErrors = [];
  state.identityRecords = [];

  const config = window.DARTS_FIREBASE_CONFIG;
  if (!config || !config.projectId) throw new Error("firebase-config.js did not provide a valid Firebase project configuration.");
  if (!window.firebase?.firestore) throw new Error("Firebase SDK failed to load.");

  let app;
  if (window.firebase.apps?.length) app = window.firebase.apps[0];
  else app = window.firebase.initializeApp(config);
  state.db = window.firebase.firestore(app);

  const [playerDbResult, currentResult, seriesResult, weeklyResult, archiveResult] = await Promise.allSettled([
    loadDoc("appState", "playerDatabase"),
    loadDoc("appState", "currentTournament"),
    loadDoc("seriesSeasons", "hotdogshop-2026"),
    loadCollection("tournamentByWeek"),
    loadCollection("tournaments")
  ]);

  state.raw.playerDatabase = settledValue(playerDbResult, "appState/playerDatabase", null);
  state.raw.currentTournament = settledValue(currentResult, "appState/currentTournament", null);
  state.raw.seriesSeason = settledValue(seriesResult, "seriesSeasons/hotdogshop-2026", null);
  state.raw.tournamentByWeek = settledValue(weeklyResult, "tournamentByWeek", []);
  state.raw.tournaments = settledValue(archiveResult, "tournaments", []);

  const playerDb = normalizePlayerDatabasePayload(state.raw.playerDatabase || {});
  playerDb.forEach(player => addIdentityRecord(player, "playerDatabase", "playerDatabase"));

  const currentDb = normalizePlayerDatabasePayload(state.raw.currentTournament || {});
  currentDb.forEach(player => addIdentityRecord(player, "currentTournamentPlayerDatabase", "currentTournament"));

  state.events = state.raw.tournamentByWeek.map(buildEvent).filter(Boolean);
  if (!state.events.length && state.raw.tournaments.length) {
    state.events = buildFallbackArchiveEvents();
  }

  state.directory = buildCanonicalDirectory();
  state.results = buildAllResults();

  const currentYearButton = document.querySelector('.standings-mode[data-mode="year"]');
  if (currentYearButton) currentYearButton.textContent = String(new Date().getFullYear());

  renderAll();

  if (state.loadErrors.length) {
    setStatus(
      "pending",
      "Firebase loaded with partial access",
      `${state.events.length} event(s) available. ${state.loadErrors.join(" · ")}`
    );
  } else {
    setStatus(
      "good",
      "Firebase history loaded",
      `${state.events.length} weekly event(s) · ${state.directory.canonicalPlayers.length} clean player identities · no writes performed.`
    );
  }
}

async function refresh() {
  try {
    $("refresh-btn").disabled = true;
    await loadFirebaseData();
  } catch (error) {
    console.error(error);
    setStatus("bad", "Could not load Firebase data", error.message || String(error));
    $("standings-table").querySelector("tbody").innerHTML = `<tr><td colspan="8" class="empty">${escapeHtml(error.message || error)}</td></tr>`;
  } finally {
    $("refresh-btn").disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  $("refresh-btn").addEventListener("click", refresh);
  $("export-raw-btn").addEventListener("click", exportRawBackup);
  $("export-clean-btn").addEventListener("click", exportCleanPreview);

  document.querySelectorAll(".standings-mode").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".standings-mode").forEach(btn => btn.classList.remove("active"));
      button.classList.add("active");
      state.standingsMode = button.dataset.mode || "all";
      renderStandings();
    });
  });

  refresh();
});
