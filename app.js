// --- Global state ---

let players = [];
let teams = [];
let matches = [];          // R1 matches list
let winnersBracket = [];   // [round][match]
let mysteryOutEntries = [];
let specialShots = [];     // Big Hits

let teamLosses = {};       // teamId -> 0,1,2
let losersMatches = [];    // flat list
let losersWaitingQueue = [];

let finalsState = {
  match1Winner: null,
  match2Winner: null,
  champion: null,
  runnerUp: null
};

// Teams are pushed here in the order they are fully eliminated from the tournament.
// First eliminated is at index 0; the most recent elimination is at the end.
let eliminationOrder = [];

let tournamentLocked = false;

// Track the last losers bracket layout for SVG lines
let lastLoserRoundsForLines = [];

// View mode: "classic" or "knockout"
let bracketViewMode = "classic";

// Player DB key
const PLAYER_DB_KEY = "dartPlayerDatabase";
let playerDatabase = [];

// Tournament state key for cross-tab sync
const TOURNAMENT_STATE_KEY = "dartTournamentState";

// 1..180 -> possible Master Out or not
let possibleOutMap = {};

// Tournament meta (date/time/location)
let tournamentMeta = {
  date: "",
  time: "",
  location: ""
};

// Mystery Out display options
let showCourtsInMysteryDisplay = false;
let mysteryTargetNumber = null;
let showMysteryOthers = true; // new flag for "Others" column

// Weekly series state (Hot Dog Shop)
const WEEKLY_SERIES_KEY = "hotDogShopWeeklySeriesState";
const SERIES_POINTS = { 1: 10, 2: 7, 3: 5, 4: 3, other: 1 };
let weeklySeriesState = {
  weeks: {},
  wildcardDraw: [],
  qualifierBracket: null
};

// Firebase cloud sync
const FIREBASE_CONFIG_KEY = "dartFirebaseConfig";
let firebaseDb = null;
let firebaseReady = false;
let firebaseArchiveList = [];
let firebaseTournamentWeekList = [];

// Stable player identity support
const PLAYER_STABLE_ID_PREFIX = "plr_";
let seriesPlayerDirectory = {};

function generatePersistentPlayerId() {
  return PLAYER_STABLE_ID_PREFIX + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}

function ensurePersistentIdForPlayerObject(player) {
  if (!player || typeof player !== "object") return "";
  if (!player.persistentId) {
    player.persistentId = generatePersistentPlayerId();
  }
  return player.persistentId;
}

function getPlayerStableId(player) {
  if (!player || typeof player !== "object") return "";
  return String(player.persistentId || player.id || "");
}

function resolvePlayerByStableId(id) {
  const key = String(id || "");
  if (!key) return null;

  let found = players.find(p => String(p.persistentId || p.id) === key);
  if (found) return found;

  found = playerDatabase.find(p => String(p.persistentId || "") === key);
  if (found) return found;

  if (seriesPlayerDirectory[key]) return seriesPlayerDirectory[key];

  return null;
}

function findOrCreateDbPlayerFromIdentity(obj) {
  if (!obj || typeof obj !== "object") return null;

  let existing = null;
  if (obj.persistentId) {
    existing = playerDatabase.find(p => String(p.persistentId || "") === String(obj.persistentId)) || null;
  }
  if (!existing) {
    existing = playerDatabase.find(p => playersMatchKey(p, obj)) || null;
  }

  if (!existing) {
    existing = {
      persistentId: obj.persistentId || generatePersistentPlayerId(),
      firstName: obj.firstName || "",
      lastName: obj.lastName || "",
      nickname: obj.nickname || "",
      gender: obj.gender || "",
      paid: false,
      stats: createEmptyStats()
    };
    playerDatabase.push(existing);
    savePlayerDatabase();
  } else {
    if (!existing.persistentId) {
      existing.persistentId = obj.persistentId || generatePersistentPlayerId();
      savePlayerDatabase();
    }
    if (!existing.stats) {
      existing.stats = createEmptyStats();
      savePlayerDatabase();
    }
  }
  return existing;
}

function buildSeriesPlayerDirectoryFromTournamentDocs(tournamentDocs) {
  seriesPlayerDirectory = {};
  (tournamentDocs || []).forEach(decoded => {
    const sourcePlayers = decoded?.tournamentState?.players || [];
    sourcePlayers.forEach(pl => {
      if (!pl) return;
      const db = findOrCreateDbPlayerFromIdentity(pl);
      const stableId = String(db?.persistentId || pl.persistentId || "");
      const legacyId = String(pl.id || "");
      const entry = {
        persistentId: stableId,
        firstName: pl.firstName || "",
        lastName: pl.lastName || "",
        nickname: pl.nickname || "",
        gender: pl.gender || ""
      };
      if (stableId) seriesPlayerDirectory[stableId] = entry;
      if (legacyId) seriesPlayerDirectory[legacyId] = entry;
    });
  });
}

function canonicalizeWeeklySeriesStatePlayerIds(state) {
  if (!state || !state.weeks) return state;
  Object.values(state.weeks).forEach(week => {
    if (!week || !week.placements) return;
    [1,2,3,4].forEach(place => {
      const rawVal = week.placements[place];
      const ids = (Array.isArray(rawVal) ? rawVal : (rawVal ? [rawVal] : []))
        .map(v => String(v))
        .filter(Boolean)
        .map(id => {
          const ref = seriesPlayerDirectory[id] || resolvePlayerByStableId(id);
          return String(ref?.persistentId || id);
        });
      week.placements[place] = Array.from(new Set(ids));
    });
    const others = (week.others || [])
      .map(v => String(v))
      .filter(Boolean)
      .map(id => {
        const ref = seriesPlayerDirectory[id] || resolvePlayerByStableId(id);
        return String(ref?.persistentId || id);
      });
    week.others = Array.from(new Set(others));
  });
  return state;
}



// --- DOM READY ---

document.addEventListener("DOMContentLoaded", () => {
  const playerForm = document.getElementById("player-form");
  const generateTeamsBtn = document.getElementById("generate-teams-btn");
  const generateMatchesBtn = document.getElementById("generate-matches-btn");
  const reseedBracketBtn = document.getElementById("reseed-bracket-btn");
  const manualTeamForm = document.getElementById("manual-team-form");
  const mysteryOutForm = document.getElementById("mystery-out-form");
  const featsForm = document.getElementById("feats-form");
  const calculatePayoutsBtn = document.getElementById("calculate-payouts-btn");
  const suggestPayoutsBtn = document.getElementById("suggest-payouts-btn");
  const finalsMatch1Btn = document.getElementById("finals-match1-btn");
  const finalsMatch2Btn = document.getElementById("finals-match2-btn");
  const saveBtn = document.getElementById("save-tournament-btn");
  const loadBtn = document.getElementById("load-tournament-btn");
  const displayModeBtn = document.getElementById("toggle-display-mode-btn");
  const loadSavedPlayersBtn = document.getElementById("load-saved-players-btn");
  const clearSavedPlayersBtn = document.getElementById("clear-saved-players-btn");
  const refreshPlayerDbFirebaseBtn = document.getElementById("refresh-player-db-firebase-btn");
  const playerDbSelect = document.getElementById("player-db-select");
  const addSelectedPlayerDbBtn = document.getElementById("add-selected-player-db-btn");
  const mysteryFullscreenBtn = document.getElementById("mystery-fullscreen-btn");
  const mysteryOpenTabBtn = document.getElementById("mystery-open-tab-btn");
  const bracketViewModeSelect = document.getElementById("bracket-view-mode");
  const mysteryShowCourtsToggle = document.getElementById("mystery-show-courts-toggle");
  const mysteryTargetInput = document.getElementById("mystery-target-number");
  const mysteryShowOthersToggle = document.getElementById("mystery-show-others-toggle");

  const tDate = document.getElementById("tournament-date");
  const tTime = document.getElementById("tournament-time");
  const tLocation = document.getElementById("tournament-location");
  const tNowBtn = document.getElementById("tournament-datetime-now-btn");

  const statsPlayerSelect = document.getElementById("statsPlayerSelect");
  const refreshStatsBtn = document.getElementById("refresh-stats-btn");
  const editStatsBtn = document.getElementById("edit-player-stats-btn");
  const clearStatsBtn = document.getElementById("clear-player-stats-btn");

  const seriesWeekSelect = document.getElementById("series-week-select");
  const seriesLoadWeekBtn = document.getElementById("series-load-week-btn");
  const seriesSaveWeekBtn = document.getElementById("series-save-week-btn");
  const seriesAutoFillBtn = document.getElementById("series-auto-fill-btn");
  const seriesClearWeekBtn = document.getElementById("series-clear-week-btn");
  const seriesDrawWildcardsBtn = document.getElementById("series-draw-wildcards-btn");
  const seriesGenerateQualifierBtn = document.getElementById("series-generate-qualifier-btn");
  const seriesExportCsvBtn = document.getElementById("series-export-csv-btn");
  const seriesExportExcelBtn = document.getElementById("series-export-excel-btn");
  const exportFullPdfBtn = document.getElementById("export-full-pdf-btn");
  const exportFullExcelBtn = document.getElementById("export-full-excel-btn");
  const seriesCurrentWeekPdfBtn = document.getElementById("series-current-week-pdf-btn");
  const seriesCurrentWeekExcelBtn = document.getElementById("series-current-week-excel-btn");
  const firebaseConfigInput = document.getElementById("firebase-config-input");
  const firebaseSaveConfigBtn = document.getElementById("firebase-save-config-btn");
  const firebaseConnectBtn = document.getElementById("firebase-connect-btn");
  const firebaseClearConfigBtn = document.getElementById("firebase-clear-config-btn");
  const firebaseSaveTournamentBtn = document.getElementById("firebase-save-tournament-btn");
  const firebaseLoadTournamentBtn = document.getElementById("firebase-load-tournament-btn");
  const firebaseArchiveTournamentBtn = document.getElementById("firebase-archive-tournament-btn");
  const firebaseSaveSeriesBtn = document.getElementById("firebase-save-series-btn");
  const firebaseLoadSeriesBtn = document.getElementById("firebase-load-series-btn");
  const firebaseRefreshArchivesBtn = document.getElementById("firebase-refresh-archives-btn");
  const emailTournamentBtn = document.getElementById("email-tournament-btn");

  initPlayerDatabase();
  populatePlayerDbSelect();
  buildPossibleOutMap();
  setTimeout(() => { if (typeof syncPlayerDatabaseFromFirebase === 'function') { syncPlayerDatabaseFromFirebase().catch(() => {}); } }, 1200);
  loadWeeklySeriesState();
  initWeeklySeriesWeekSelect();
  preloadFirebaseConfigIntoUI();

  // Event bindings
  playerForm.addEventListener("submit", handleAddPlayer);
  generateTeamsBtn.addEventListener("click", handleGenerateTeams);
  generateMatchesBtn.addEventListener("click", handleGenerateBracket);
  reseedBracketBtn.addEventListener("click", handleReseedBracket);
  manualTeamForm.addEventListener("submit", handleManualTeamAdd);
  mysteryOutForm.addEventListener("submit", handleMysteryOutAdd);
  if (featsForm) featsForm.addEventListener("submit", handleAddSpecialShot);
  calculatePayoutsBtn.addEventListener("click", handleCalculatePayouts);
  if (suggestPayoutsBtn) suggestPayoutsBtn.addEventListener("click", handleSuggestedPayouts);
  finalsMatch1Btn.addEventListener("click", () => handleFinalMatch(1));
  finalsMatch2Btn.addEventListener("click", () => handleFinalMatch(2));
  saveBtn.addEventListener("click", saveTournamentState);
  loadBtn.addEventListener("click", loadTournamentState);
  displayModeBtn.addEventListener("click", toggleDisplayMode);
  loadSavedPlayersBtn.addEventListener("click", handleLoadSavedPlayers);
  clearSavedPlayersBtn.addEventListener("click", handleClearSavedPlayers);
  if (refreshPlayerDbFirebaseBtn) refreshPlayerDbFirebaseBtn.addEventListener("click", handleRefreshPlayerDbFromFirebase);
  if (addSelectedPlayerDbBtn) addSelectedPlayerDbBtn.addEventListener("click", handleAddSelectedPlayerDbToTournament);
  if (mysteryFullscreenBtn) mysteryFullscreenBtn.addEventListener("click", fullscreenMysteryOut);
  if (mysteryOpenTabBtn) mysteryOpenTabBtn.addEventListener("click", openMysteryOutDisplayTab);

  if (bracketViewModeSelect) {
    bracketViewModeSelect.addEventListener("change", () => {
      bracketViewMode = bracketViewModeSelect.value === "knockout" ? "knockout" : "classic";
      applyBracketViewMode();
      renderWinnersBracket();
      renderLosersBracket();
      renderFinalsSection();
    });
  }

  if (mysteryShowCourtsToggle) {
    mysteryShowCourtsToggle.addEventListener("change", () => {
      showCourtsInMysteryDisplay = mysteryShowCourtsToggle.checked;
      updateMysteryCourtsVisibility();
      persistTournamentStateSilent();
    });
  }

  if (mysteryShowOthersToggle) {
    mysteryShowOthersToggle.addEventListener("change", () => {
      showMysteryOthers = mysteryShowOthersToggle.checked;
      applyMysteryOthersVisibility();
      renderMysteryOutBoard();
      persistTournamentStateSilent();
    });
  }

  if (mysteryTargetInput) {
    mysteryTargetInput.addEventListener("change", () => {
      const val = parseInt(mysteryTargetInput.value, 10);
      if (!val || val < 1 || val > 180) {
        mysteryTargetNumber = null;
      } else {
        mysteryTargetNumber = val;
      }
      renderMysteryOutBoard();
      renderMysteryTargetDisplay();
      persistTournamentStateSilent();
    });
  }

  if (tDate) {
    tDate.addEventListener("change", () => {
      tournamentMeta.date = tDate.value || "";
      persistTournamentStateSilent();
    });
  }
  if (tTime) {
    tTime.addEventListener("change", () => {
      tournamentMeta.time = tTime.value || "";
      persistTournamentStateSilent();
    });
  }
  if (tLocation) {
    tLocation.addEventListener("change", () => {
      tournamentMeta.location = tLocation.value || "";
      persistTournamentStateSilent();
    });
  }
  if (tNowBtn) {
    tNowBtn.addEventListener("click", () => {
      const now = new Date();
      if (tDate) {
        tDate.value = now.toISOString().slice(0, 10);
        tournamentMeta.date = tDate.value;
      }
      if (tTime) {
        const hh = String(now.getHours()).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");
        tTime.value = `${hh}:${mm}`;
        tournamentMeta.time = tTime.value;
      }
      persistTournamentStateSilent();
    });
  }

  if (statsPlayerSelect) {
    statsPlayerSelect.addEventListener("change", renderPlayerStats);
  }
  if (refreshStatsBtn) {
    refreshStatsBtn.addEventListener("click", renderPlayerStats);
  }
  const buyInInput = document.getElementById("buy-in");
  if (buyInInput) buyInInput.addEventListener("input", renderSummary);
  if (editStatsBtn) {
    editStatsBtn.addEventListener("click", editSelectedPlayerStats);
  }
  if (clearStatsBtn) {
    clearStatsBtn.addEventListener("click", clearSelectedPlayerStats);
  }

  if (seriesWeekSelect) {
    seriesWeekSelect.addEventListener("change", () => loadSelectedSeriesWeekIntoForm());
  }
  if (seriesLoadWeekBtn) {
    seriesLoadWeekBtn.addEventListener("click", loadSelectedSeriesWeekIntoForm);
  }
  if (seriesSaveWeekBtn) {
    seriesSaveWeekBtn.addEventListener("click", saveSelectedSeriesWeekFromForm);
  }
  if (seriesAutoFillBtn) {
    seriesAutoFillBtn.addEventListener("click", autoFillSeriesWeekFromTournament);
  }
  if (seriesClearWeekBtn) {
    seriesClearWeekBtn.addEventListener("click", clearSelectedSeriesWeek);
  }
  if (seriesDrawWildcardsBtn) {
    seriesDrawWildcardsBtn.addEventListener("click", drawSeriesWildcards);
  }
  if (seriesGenerateQualifierBtn) {
    seriesGenerateQualifierBtn.addEventListener("click", generateSeriesQualifierBracket);
  }
  if (seriesExportCsvBtn) {
    seriesExportCsvBtn.addEventListener("click", exportSeriesLeaderboardCsv);
  }
  if (seriesExportExcelBtn) {
    seriesExportExcelBtn.addEventListener("click", exportSeriesLeaderboardExcel);
  }
  if (exportFullPdfBtn) {
    exportFullPdfBtn.addEventListener("click", exportFullTournamentPdf);
  }
  if (exportFullExcelBtn) {
    exportFullExcelBtn.addEventListener("click", exportFullTournamentExcel);
  }
  if (seriesCurrentWeekPdfBtn) {
    seriesCurrentWeekPdfBtn.addEventListener("click", exportCurrentWeekPdf);
  }
  if (seriesCurrentWeekExcelBtn) {
    seriesCurrentWeekExcelBtn.addEventListener("click", exportCurrentWeekExcel);
  }

  if (firebaseSaveConfigBtn) firebaseSaveConfigBtn.addEventListener("click", handleSaveFirebaseConfig);
  if (firebaseConnectBtn) firebaseConnectBtn.addEventListener("click", handleConnectFirebase);
  if (firebaseClearConfigBtn) firebaseClearConfigBtn.addEventListener("click", handleClearFirebaseConfig);
  if (firebaseSaveTournamentBtn) firebaseSaveTournamentBtn.addEventListener("click", saveTournamentToFirebase);
  if (firebaseLoadTournamentBtn) firebaseLoadTournamentBtn.addEventListener("click", loadTournamentFromFirebase);
  if (firebaseArchiveTournamentBtn) firebaseArchiveTournamentBtn.addEventListener("click", archiveTournamentToFirebase);
  if (firebaseSaveSeriesBtn) firebaseSaveSeriesBtn.addEventListener("click", saveWeeklySeriesToFirebase);
  if (firebaseLoadSeriesBtn) firebaseLoadSeriesBtn.addEventListener("click", loadWeeklySeriesFromFirebase);
  if (firebaseRefreshArchivesBtn) firebaseRefreshArchivesBtn.addEventListener("click", refreshFirebaseArchives);
  const firebaseLoadSelectedBtn = document.getElementById("firebase-load-selected-btn");
  if (firebaseLoadSelectedBtn) firebaseLoadSelectedBtn.addEventListener("click", loadSelectedFirebaseTournamentWeek);
  if (emailTournamentBtn) emailTournamentBtn.addEventListener("click", openTournamentEmailDraft);

  attemptFirebaseAutoConnect();

  // Initial render (blank state)
  rerenderAll();

  // If this tab is opened as a pure Mystery-Out display tab, load state from storage
  if (window.location.hash === "#mystery-display") {
    enterMysteryDisplayOnlyMode();
    autoSyncFromStorageOnce();
  }

  // Listen for cross-tab updates (other tab changing state)
  window.addEventListener("storage", (e) => {
    if (e.key === TOURNAMENT_STATE_KEY && e.newValue) {
      try {
        const state = JSON.parse(e.newValue);
        applyTournamentState(state);
        rerenderAll();
      } catch (err) {
        console.error("Failed to apply tournament state from storage event", err);
      }
    }
  });

  // Redraw SVG lines on resize
  window.addEventListener("resize", () => {
    requestAnimationFrame(() => drawBracketLines("winners-bracket", winnersBracket));
    drawBracketLines("losers-bracket", lastLoserRoundsForLines);
  });
});

// --- Player DB & Stats ---

function createEmptyStats() {
  return {
    tournaments: 0,
    games: 0,
    wins: 0,
    losses: 0,
    locations: {},   // location -> count
    partners: {},    // partnerName -> count
    mysteryOuts: {}  // outNumber -> count
  };
}

function initPlayerDatabase() {
  const data = localStorage.getItem(PLAYER_DB_KEY);
  if (!data) {
    playerDatabase = [];
    return;
  }
  let changed = false;
  try {
    playerDatabase = JSON.parse(data) || [];
    if (!Array.isArray(playerDatabase)) playerDatabase = [];
  } catch {
    playerDatabase = [];
  }
  playerDatabase.forEach(p => {
    if (!p.persistentId) {
      p.persistentId = generatePersistentPlayerId();
      changed = true;
    }
    if (!p.stats) {
      p.stats = createEmptyStats();
      changed = true;
    }
  });
  if (changed) savePlayerDatabase();
}

function savePlayerDatabase() {
  try {
    localStorage.setItem(PLAYER_DB_KEY, JSON.stringify(playerDatabase));
  } catch (e) {
    console.error("Failed to save player database", e);
  }
}

function playersMatchKey(a, b) {
  if (a?.persistentId && b?.persistentId) {
    return String(a.persistentId) === String(b.persistentId);
  }
  return (
    a.firstName === b.firstName &&
    a.lastName === b.lastName &&
    a.nickname === b.nickname &&
    a.gender === b.gender
  );
}

function getDbEntryForPlayer(player) {
  if (player?.persistentId) {
    const byPid = playerDatabase.find(p => String(p.persistentId || "") === String(player.persistentId));
    if (byPid) return byPid;
  }
  return playerDatabase.find(p => playersMatchKey(p, player)) || null;
}

function addPlayerToDatabase(player) {
  ensurePersistentIdForPlayerObject(player);
  let existing = getDbEntryForPlayer(player);
  if (!existing) {
    existing = {
      persistentId: player.persistentId,
      firstName: player.firstName,
      lastName: player.lastName,
      nickname: player.nickname,
      gender: player.gender,
      paid: false,
      stats: createEmptyStats()
    };
    playerDatabase.push(existing);
    savePlayerDatabase();
  } else {
    let changed = false;
    if (!existing.persistentId) {
      existing.persistentId = player.persistentId || generatePersistentPlayerId();
      changed = true
    }
    if (!existing.stats) {
      existing.stats = createEmptyStats();
      changed = true;
    }
    player.persistentId = existing.persistentId;
    if (changed) savePlayerDatabase();
  }
}


function normalizeFirebasePlayerDatabasePayload(decodedValue) {
  const pdb = decodedValue?.playerDatabase;

  if (Array.isArray(pdb?.items?.items)) return pdb.items.items;
  if (Array.isArray(pdb?.items?.players)) return pdb.items.players;
  if (Array.isArray(pdb?.items)) return pdb.items;
  if (Array.isArray(pdb?.players)) return pdb.players;
  if (Array.isArray(pdb)) return pdb;

  if (Array.isArray(decodedValue?.playerDatabase?.items?.items)) return decodedValue.playerDatabase.items.items;
  if (Array.isArray(decodedValue?.playerDatabase?.items)) return decodedValue.playerDatabase.items;
  if (Array.isArray(decodedValue?.items?.items)) return decodedValue.items.items;
  if (Array.isArray(decodedValue?.items)) return decodedValue.items;
  if (Array.isArray(decodedValue?.players)) return decodedValue.players;

  if (decodedValue?.playerDatabase?.byId && typeof decodedValue.playerDatabase.byId === "object") {
    return Object.values(decodedValue.playerDatabase.byId).filter(v => v && typeof v === "object");
  }
  if (decodedValue?.byId && typeof decodedValue.byId === "object") {
    return Object.values(decodedValue.byId).filter(v => v && typeof v === "object");
  }

  return [];
}

function populatePlayerDbSelect() {
  const sel = document.getElementById("player-db-select");
  if (!sel) return;
  const currentValue = String(sel.value || "");
  sel.innerHTML = "";

  const emptyOpt = document.createElement("option");
  emptyOpt.value = "";
  emptyOpt.textContent = "-- select player --";
  sel.appendChild(emptyOpt);

  const sorted = [...playerDatabase].sort((a, b) =>
    formatDisplayName(a).localeCompare(formatDisplayName(b))
  );

  sorted.forEach(player => {
    const opt = document.createElement("option");
    opt.value = String(player.persistentId || "");
    const already = players.some(p => String(p.persistentId || "") === String(player.persistentId || ""));
    opt.textContent = formatDisplayName(player) + (already ? " (Added)" : "");
    sel.appendChild(opt);
  });

  if (currentValue && Array.from(sel.options).some(opt => String(opt.value) === currentValue)) {
    sel.value = currentValue;
  }
}

async function syncPlayerDatabaseFromFirebase() {
  const db = requireFirebaseDb();

  let raw = null;

  const currentTournamentDoc = await db.collection("appState").doc("currentTournament").get();
  if (currentTournamentDoc.exists) {
    raw = currentTournamentDoc.data() || {};
  }

  if (!raw || !normalizeFirebasePlayerDatabasePayload(raw).length) {
    const playerDbDoc = await db.collection("appState").doc("playerDatabase").get();
    if (playerDbDoc.exists) {
      raw = playerDbDoc.data() || raw || {};
    }
  }

  const incoming = normalizeFirebasePlayerDatabasePayload(raw || {});
  let touched = 0;

  incoming.forEach(p => {
    if (!p || typeof p !== "object") return;

    let existing = null;
    if (p.persistentId) {
      existing = playerDatabase.find(x => String(x.persistentId || "") === String(p.persistentId)) || null;
    }
    if (!existing) {
      existing = playerDatabase.find(x => playersMatchKey(x, p)) || null;
    }

    if (!existing) {
      playerDatabase.push({
        persistentId: p.persistentId || generatePersistentPlayerId(),
        firstName: p.firstName || "",
        lastName: p.lastName || "",
        nickname: p.nickname || "",
        gender: p.gender || "",
        paid: false,
        stats: p.stats || createEmptyStats()
      });
      touched += 1;
    } else {
      let changed = false;
      if (!existing.persistentId) {
        existing.persistentId = p.persistentId || generatePersistentPlayerId();
        changed = true;
      }
      if (p.stats) {
        existing.stats = p.stats;
        changed = true;
      }
      if (changed) touched += 1;
    }
  });

  savePlayerDatabase();
  if (typeof populatePlayerDbSelect === "function") populatePlayerDbSelect();
  if (typeof populatePlayerStatsSelect === "function") populatePlayerStatsSelect();
  if (typeof renderPlayerStats === "function") renderPlayerStats();
  return touched;
}

async function handleRefreshPlayerDbFromFirebase() {
  try {
    updateFirebaseStatus("working", "Refreshing player database from Firebase...");
    const count = await syncPlayerDatabaseFromFirebase();
    updateFirebaseStatus("connected", `Firebase connected: ${getStoredFirebaseConfig().projectId}`);
    alert(`Player DB refresh complete. Loaded/updated ${count} players. ${playerDatabase.length} total players currently in DB.`);
  } catch (err) {
    console.error(err);
    updateFirebaseStatus("missing", err.message || "Firebase player DB refresh failed");
    alert(err.message || "Failed to refresh player database from Firebase.");
  }
}

function handleAddSelectedPlayerDbToTournament() {
  const sel = document.getElementById("player-db-select");
  if (!sel || !sel.value) {
    alert("Select a player from the Player DB first.");
    return;
  }

  const dbPlayer = playerDatabase.find(p => String(p.persistentId || "") === String(sel.value));
  if (!dbPlayer) {
    alert("Selected player not found in the Player DB.");
    return;
  }

  const exists = players.some(p =>
    String(p.persistentId || "") === String(dbPlayer.persistentId || "")
  );
  if (exists) {
    alert("That player is already in tonight's tournament.");
    populatePlayerDbSelect();
    return;
  }

  players.push({
    id: Date.now() + Math.floor(Math.random() * 1e6),
    persistentId: dbPlayer.persistentId || generatePersistentPlayerId(),
    firstName: dbPlayer.firstName,
    lastName: dbPlayer.lastName,
    nickname: dbPlayer.nickname,
    gender: dbPlayer.gender,
    paid: false
  });

  rerenderAll();
  populatePlayerDbSelect();
  persistTournamentStateSilent();
}


function handleLoadSavedPlayers() {
  if (!playerDatabase.length) {
    alert("No saved players in the database.");
    return;
  }

  let added = 0;
  playerDatabase.forEach(dbPlayer => {
    const exists = players.some(p =>
      String(p.persistentId || "") === String(dbPlayer.persistentId || "")
      || playersMatchKey(p, dbPlayer)
    );
    if (!exists) {
      players.push({
        id: Date.now() + Math.floor(Math.random() * 1e6),
        persistentId: dbPlayer.persistentId || generatePersistentPlayerId(),
        firstName: dbPlayer.firstName,
        lastName: dbPlayer.lastName,
        nickname: dbPlayer.nickname,
        gender: dbPlayer.gender,
        paid: false
      });
      added++;
    }
  });

  alert(
    added
      ? `Loaded ${added} player(s) from Saved Player DB.`
      : "All saved players are already in this tournament."
  );

  rerenderAll();
  persistTournamentStateSilent();
}

function handleClearSavedPlayers() {
  if (!confirm("Clear the Saved Player Database?")) return;
  playerDatabase = [];
  savePlayerDatabase();
  alert("Saved Player DB cleared.");
}

// --- Master Out map (1..180) --------------------

function buildPossibleOutMap() {
  possibleOutMap = {};
  for (let n = 1; n <= 180; n++) {
    possibleOutMap[n] = false;
  }

  const scores = [];
  for (let v = 1; v <= 20; v++) {
    scores.push(v, 2 * v, 3 * v);
  }
  scores.push(25, 50);

  const finishing = [];
  for (let v = 1; v <= 20; v++) {
    finishing.push(2 * v, 3 * v);
  }
  finishing.push(50);

  finishing.forEach(last => {
    if (last >= 1 && last <= 180) possibleOutMap[last] = true;
  });

  scores.forEach(d1 => {
    finishing.forEach(last => {
      const sum = d1 + last;
      if (sum >= 1 && sum <= 180) possibleOutMap[sum] = true;
    });
  });

  scores.forEach(d1 => {
    scores.forEach(d2 => {
      finishing.forEach(last => {
        const sum = d1 + d2 + last;
        if (sum >= 1 && sum <= 180) possibleOutMap[sum] = true;
      });
    });
  });
}

// --- Players ------------------------------------

function handleAddPlayer(e) {
  e.preventDefault();

  const fn = document.getElementById("firstName").value.trim();
  const ln = document.getElementById("lastName").value.trim();
  const nick = document.getElementById("nickname").value.trim();
  const gender = document.getElementById("gender").value;

  if (!fn || !gender) {
    alert("Please enter first name and gender.");
    return;
  }

  const existingDb = playerDatabase.find(p =>
    p.firstName === fn &&
    p.lastName === ln &&
    p.nickname === nick &&
    p.gender === gender
  );

  const p = {
    id: Date.now(),
    persistentId: existingDb?.persistentId || generatePersistentPlayerId(),
    firstName: fn,
    lastName: ln,
    nickname: nick,
    gender,
    paid: false
  };

  players.push(p);
  addPlayerToDatabase(p);

  document.getElementById("firstName").value = "";
  document.getElementById("lastName").value = "";
  document.getElementById("nickname").value = "";
  document.getElementById("gender").value = "";

  rerenderAll();
  persistTournamentStateSilent();
}

function formatDisplayName(player) {
  if (!player) return "";
  const fn = player.firstName || "";
  const ln = player.lastName || "";
  const nick = player.nickname || "";
  if (nick && ln) return `${fn} "${nick}" ${ln}`;
  if (nick && !ln) return `${fn} "${nick}"`;
  if (!nick && ln) return `${fn} ${ln}`;
  return fn;
}

function renderPlayers() {
  const tbody = document.querySelector("#players-table tbody");
  tbody.innerHTML = "";

  players.forEach((p, index) => {
    const tr = document.createElement("tr");

    const tdIdx = document.createElement("td");
    tdIdx.textContent = index + 1;

    const tdName = document.createElement("td");
    tdName.textContent = formatDisplayName(p);

    const tdGender = document.createElement("td");
    tdGender.textContent = p.gender;

    const tdPaid = document.createElement("td");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = p.paid;
    cb.addEventListener("change", () => {
      p.paid = cb.checked;
      renderSummary();
      persistTournamentStateSilent();
    });
    tdPaid.appendChild(cb);

    const tdActions = document.createElement("td");
    const btn = document.createElement("button");
    btn.textContent = "Remove";
    btn.className = "danger";
    btn.addEventListener("click", () => removePlayer(p.id));
    tdActions.appendChild(btn);

    tr.appendChild(tdIdx);
    tr.appendChild(tdName);
    tr.appendChild(tdGender);
    tr.appendChild(tdPaid);
    tr.appendChild(tdActions);
    tbody.appendChild(tr);
  });

  renderSummary();
}

function removePlayer(playerId) {
  if (!confirm("Remove this player?")) return;
  players = players.filter(p => p.id !== playerId);

  teams = teams.filter(
    t =>
      t.player1.id !== playerId &&
      (!t.player2 || t.player2.id !== playerId)
  );

  resetTournamentState();

  rerenderAll();
  persistTournamentStateSilent();
}

function getPlayerById(id) {
  return players.find(p => p.id === id) || null;
}

// --- Summary -------------------------------------

function renderSummary() {
  const totalPlayers = players.length;
  const paidPlayers = players.filter(p => p.paid).length;
  const unpaidPlayers = totalPlayers - paidPlayers;
  const buyIn = parseFloat(document.getElementById("buy-in")?.value || "10") || 10;
  const paidTotal = paidPlayers * buyIn;

  const totalTeams = teams.length;
  const totalMatches = matches.length;

  document.getElementById("summary-players-total").textContent = totalPlayers;
  document.getElementById("summary-players-paid").textContent = paidPlayers;
  document.getElementById("summary-players-unpaid").textContent = unpaidPlayers;
  const summaryPaidEl = document.getElementById("summary-paid-total");
  if (summaryPaidEl) summaryPaidEl.textContent = paidTotal.toFixed(2);
  const runningPaidEl = document.getElementById("players-paid-running-total");
  if (runningPaidEl) runningPaidEl.textContent = `$${paidTotal.toFixed(2)}`;
  document.getElementById("summary-teams-total").textContent = totalTeams;
  document.getElementById("summary-matches-total").textContent = totalMatches;
}

// --- Utility -------------------------------------

function shuffleArray(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function formatTeamLabel(team) {
  if (!team) return "TBD";
  const p1 = formatDisplayName(team.player1);
  const p2 = team.player2 ? formatDisplayName(team.player2) : "(bye)";
  return `Team ${team.id}: ${p1} & ${p2}`;
}

function getTeamLosses(team) {
  if (!team) return 0;
  return teamLosses[team.id] || 0;
}

function formatTeamLabelWithLosses(team) {
  const base = formatTeamLabel(team);
  const losses = getTeamLosses(team);
  return `${base} (L: ${losses})`;
}

function resetTournamentState() {
  matches = [];
  winnersBracket = [];
  losersMatches = [];
  losersWaitingQueue = [];
  teamLosses = {};
  finalsState = {
    match1Winner: null,
    match2Winner: null,
    champion: null,
    runnerUp: null
  };
  eliminationOrder = [];
  tournamentLocked = false;
  lastLoserRoundsForLines = [];
  updateLockedUI();
}

// --- Teams ---------------------------------------

function handleGenerateTeams() {
  if (tournamentLocked) {
    alert("Tournament in progress – cannot regenerate teams.");
    return;
  }
  if (players.length < 2) {
    alert("Need at least 2 players.");
    return;
  }

  const shuffled = shuffleArray(players);
  teams = [];
  let teamId = 1;
  for (let i = 0; i < shuffled.length; i += 2) {
    const p1 = shuffled[i];
    const p2 = shuffled[i + 1] || null;
    teams.push({ id: teamId++, player1: p1, player2: p2 });
  }

  resetTournamentState();
  rerenderAll();
  persistTournamentStateSilent();
}

function renderTeams() {
  const tbody = document.querySelector("#teams-table tbody");
  tbody.innerHTML = "";

  teams.forEach(team => {
    const tr = document.createElement("tr");

    const tdId = document.createElement("td");
    tdId.textContent = team.id;

    const tdP1 = document.createElement("td");
    tdP1.textContent = formatDisplayName(team.player1);

    const tdP2 = document.createElement("td");
    tdP2.textContent = team.player2
      ? formatDisplayName(team.player2)
      : "(waiting / bye)";

    tr.appendChild(tdId);
    tr.appendChild(tdP1);
    tr.appendChild(tdP2);
    tbody.appendChild(tr);
  });

  renderSummary();
}

function populateManualTeamSelects() {
  const s1 = document.getElementById("manualPlayer1");
  const s2 = document.getElementById("manualPlayer2");
  if (!s1 || !s2) return;

  const usedIds = new Set();
  teams.forEach(t => {
    usedIds.add(t.player1.id);
    if (t.player2) usedIds.add(t.player2.id);
  });

  const available = players.filter(p => !usedIds.has(p.id));

  function fillSelect(sel) {
    sel.innerHTML = "";

    if (available.length < 2) {
      sel.disabled = true;
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "Not enough available players";
      sel.appendChild(opt);
      return;
    }

    sel.disabled = false;

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select player…";
    sel.appendChild(placeholder);

    available.forEach(p => {
      const opt = document.createElement("option");
      opt.value = String(p.id);
      opt.textContent = formatDisplayName(p);
      sel.appendChild(opt);
    });
  }

  fillSelect(s1);
  fillSelect(s2);
}

function handleManualTeamAdd(e) {
  e.preventDefault();

  if (tournamentLocked) {
    alert("Tournament in progress – cannot add teams.");
    return;
  }

  const id1 = parseInt(document.getElementById("manualPlayer1").value, 10);
  const id2 = parseInt(document.getElementById("manualPlayer2").value, 10);

  if (!id1 || !id2 || id1 === id2) {
    alert("Select two different players.");
    return;
  }

  const p1 = players.find(p => p.id === id1);
  const p2 = players.find(p => p.id === id2);
  if (!p1 || !p2) {
    alert("Invalid players.");
    return;
  }

  const nextId = teams.length ? Math.max(...teams.map(t => t.id)) + 1 : 1;
  teams.push({ id: nextId, player1: p1, player2: p2 });

  document.getElementById("manualPlayer1").value = "";
  document.getElementById("manualPlayer2").value = "";

  resetTournamentState();
  rerenderAll();
  persistTournamentStateSilent();
}

// --- Bracket generation --------------------------

function getWinnerMatch(roundIndex, matchIndex) {
  return winnersBracket[roundIndex]?.[matchIndex] || null;
}

function getLoserMatch(index) {
  return losersMatches[index] || null;
}


function getTeamPlayersKey(team) {
  if (!team) return "";
  const ids = getPlayersFromTeam(team).map(p => String(getPlayerStableId(p))).sort();
  return ids.join("|");
}

function teamsHavePlayedBefore(teamA, teamB) {
  if (!teamA || !teamB) return false;
  const keyA = getTeamPlayersKey(teamA);
  const keyB = getTeamPlayersKey(teamB);
  if (!keyA || !keyB) return false;

  for (const round of winnersBracket) {
    for (const m of round) {
      if (!m || !m.team1 || !m.team2 || !m.winner) continue;
      const m1 = getTeamPlayersKey(m.team1);
      const m2 = getTeamPlayersKey(m.team2);
      if ((m1 === keyA && m2 === keyB) || (m1 === keyB && m2 === keyA)) return true;
    }
  }

  for (const m of losersMatches) {
    if (!m || !m.team1 || !m.team2 || !m.winner) continue;
    const m1 = getTeamPlayersKey(m.team1);
    const m2 = getTeamPlayersKey(m.team2);
    if ((m1 === keyA && m2 === keyB) || (m1 === keyB && m2 === keyA)) return true;
  }

  return false;
}

function resolveAntiRematchLoserWinner(primaryIndex, alternateIndex, opponentTeam) {
  const primary = getLoserMatch(primaryIndex)?.winner || null;
  const alternate = getLoserMatch(alternateIndex)?.winner || null;

  if (!primary) return alternate || null;
  if (!alternate) return primary;

  if (opponentTeam && teamsHavePlayedBefore(primary, opponentTeam) && !teamsHavePlayedBefore(alternate, opponentTeam)) {
    return alternate;
  }

  return primary;
}


function getBlankRoundTitle(isWinner, roundIndex, fallbackTitle) {
  if (bracketViewMode !== "blank") return fallbackTitle;
  if (isWinner) {
    if (roundIndex === 0) return "Round 1";
    if (roundIndex === winnersBracket.length - 1) return "Final / King Seat";
    return `Round ${roundIndex + 1}`;
  }
  return `Loser Round ${roundIndex + 1}`;
}

function getBlankMatchLabel() {
  return bracketViewMode === "blank" ? "Match _____" : null;
}

function createBlankFillInput(match, side) {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "blank-team-input";
  input.placeholder = side === 1 ? "Team / Player A" : "Team / Player B";
  const key = `blank_${match.id}_${side}`;
  input.value = match[key] || "";
  input.addEventListener("click", ev => ev.stopPropagation());
  input.addEventListener("input", ev => {
    match[key] = ev.target.value;
    persistTournamentStateSilent();
  });
  return input;
}

function resolveSourceTeam(source) {
  if (!source) return null;
  if (source.kind === "routeWinner" || source.kind === "routeLoser") return rtResolveSource(source);
  if (source.kind === 'winnerMatchWinner') {
    return getWinnerMatch(source.roundIndex, source.matchIndex)?.winner || null;
  }
  if (source.kind === 'winnerMatchLoser') {
    const m = getWinnerMatch(source.roundIndex, source.matchIndex);
    if (!m || !m.winner || !m.team1 || !m.team2) return null;
    return m.winner.id === m.team1.id ? m.team2 : m.team1;
  }
  if (source.kind === 'loserMatchWinner') {
    return getLoserMatch(source.matchIndex)?.winner || null;
  }
  return null;
}

function buildFixedLosersTemplate(bracketSize, nextMatchIdStart) {
  return buildReviewStyleLoserTemplate(bracketSize, nextMatchIdStart);
}


function syncWinnerBracketTeams() {
  for (let r = 1; r < winnersBracket.length; r++) {
    winnersBracket[r].forEach(m => {
      const resolved1 = m.team1Source ? resolveSourceTeam(m.team1Source) : m.team1;
      const resolved2 = m.team2Source ? resolveSourceTeam(m.team2Source) : m.team2;
      m.team1 = resolved1 || null;
      m.team2 = resolved2 || null;
      if (m.winner) {
        const validIds = [m.team1?.id, m.team2?.id].filter(Boolean);
        if (!validIds.includes(m.winner.id)) m.winner = null;
      }
    });
  }
}

function syncLosersBracketTeams() {
  losersMatches.forEach(m => {
    const resolved1 = resolveSourceTeam(m.team1Source);
    const resolved2 = resolveSourceTeam(m.team2Source);
    m.team1 = resolved1;
    m.team2 = resolved2;
    if (m.winner) {
      const validIds = [resolved1?.id, resolved2?.id].filter(Boolean);
      if (!validIds.includes(m.winner.id)) {
        m.winner = null;
      }
    }
  });

  const seenByRound = new Map();
  losersMatches.forEach(m => {
    const r = m.round || 1;
    if (!seenByRound.has(r)) seenByRound.set(r, new Set());
    const seen = seenByRound.get(r);

    ["team1", "team2"].forEach(slot => {
      const team = m[slot];
      if (!team) return;
      const key = String(team.id);
      if (seen.has(key)) {
        m[slot] = null;
        if (m.winner && m.winner.id === team.id) m.winner = null;
      } else {
        seen.add(key);
      }
    });
  });
}


function getBracketSizeForTeamCount(teamCount) {
  if (teamCount <= 4) return 4;
  if (teamCount <= 8) return 8;
  if (teamCount <= 16) return 16;
  return 32;
}

function buildSeedOrder(size) {
  let seeds = [1, 2];
  while (seeds.length < size) {
    const nextSize = seeds.length * 2 + 1;
    const next = [];
    seeds.forEach(seed => {
      next.push(seed);
      next.push(nextSize - seed);
    });
    seeds = next;
  }
  return seeds;
}

function assignTeamsToSeededSlots(teamList, bracketSize) {
  const seedOrder = buildSeedOrder(bracketSize);
  const slots = new Array(bracketSize).fill(null);
  for (let i = 0; i < teamList.length; i++) {
    const seed = i + 1;
    const slotIndex = seedOrder.indexOf(seed);
    if (slotIndex >= 0) slots[slotIndex] = teamList[i];
  }
  return slots;
}

function propagateWinnerToNextRound(roundIndex, matchIndex, winnerTeam) {
  if (typeof syncWinnerBracketTeams === "function") syncWinnerBracketTeams();
}

function autoAdvanceBracketByes() {
  // V25.6: Do not auto-select any winners.
  // BYE teams are shown in their Round 1 slot, and the operator can manually place/advance them.
  return;
}

function getFirstRoundLoserPairingOrder(matchCount) {
  const order = [];
  const used = new Set();

  for (let i = 0; i < matchCount; i++) {
    if (used.has(i)) continue;
    const mirror = i + 2 < matchCount ? i + 2 : i + 1;
    if (mirror < matchCount && !used.has(mirror)) {
      order.push([i, mirror]);
      used.add(i);
      used.add(mirror);
    }
  }

  for (let i = 0; i < matchCount; i++) {
    if (used.has(i)) continue;
    for (let j = i + 1; j < matchCount; j++) {
      if (!used.has(j)) {
        order.push([i, j]);
        used.add(i);
        used.add(j);
        break;
      }
    }
  }

  return order;
}

function makeWinnerLoserSource(roundIndex, matchIndex) {
  return { kind: "winnerMatchLoser", roundIndex, matchIndex };
}

function makeLoserWinnerSource(matchIndex) {
  return { kind: "loserMatchWinner", matchIndex };
}

function buildGenericLosersTemplate(bracketSize, nextMatchIdStart) {
  const winnerRounds = Math.log2(bracketSize);
  const entries = [];

  const firstRoundMatchCount = bracketSize / 2;
  const firstPairs = getFirstRoundLoserPairingOrder(firstRoundMatchCount);

  firstPairs.forEach(pair => {
    entries.push({
      round: 1,
      team1Source: makeWinnerLoserSource(0, pair[0]),
      team2Source: makeWinnerLoserSource(0, pair[1])
    });
  });

  let previousLoserRoundStart = 0;
  let previousLoserRoundCount = entries.length;
  let loserRoundNumber = 2;

  for (let winnerRoundIndex = 1; winnerRoundIndex < winnerRounds; winnerRoundIndex++) {
    const winnersRoundMatchCount = bracketSize / Math.pow(2, winnerRoundIndex + 1);

    // Drop-down round: previous loser winners vs losers from this winners round.
    const dropRoundStart = entries.length;
    const dropRoundCount = Math.max(previousLoserRoundCount, winnersRoundMatchCount);
    for (let i = 0; i < dropRoundCount; i++) {
      const previousIdx = previousLoserRoundStart + (i % Math.max(previousLoserRoundCount, 1));
      const dropIdx = winnersRoundMatchCount
        ? ((i + Math.floor(winnersRoundMatchCount / 2)) % winnersRoundMatchCount)
        : 0;

      entries.push({
        round: loserRoundNumber,
        team1Source: previousLoserRoundCount ? makeLoserWinnerSource(previousIdx) : null,
        team2Source: winnersRoundMatchCount ? makeWinnerLoserSource(winnerRoundIndex, dropIdx) : null
      });
    }

    previousLoserRoundStart = dropRoundStart;
    previousLoserRoundCount = dropRoundCount;
    loserRoundNumber++;

    // Consolidation round, if more than one match remains.
    if (previousLoserRoundCount > 1) {
      const consolidationStart = entries.length;
      const consolidationCount = Math.ceil(previousLoserRoundCount / 2);
      for (let i = 0; i < consolidationCount; i++) {
        entries.push({
          round: loserRoundNumber,
          team1Source: makeLoserWinnerSource(previousLoserRoundStart + i * 2),
          team2Source: (i * 2 + 1 < previousLoserRoundCount)
            ? makeLoserWinnerSource(previousLoserRoundStart + i * 2 + 1)
            : null
        });
      }
      previousLoserRoundStart = consolidationStart;
      previousLoserRoundCount = consolidationCount;
      loserRoundNumber++;
    }
  }

  return entries
    .filter(entry => entry.team1Source || entry.team2Source)
    .map((entry, idx) => ({
      id: nextMatchIdStart + idx,
      round: entry.round,
      team1Source: entry.team1Source,
      team2Source: entry.team2Source,
      team1: null,
      team2: null,
      winner: null,
      board: null
    }));
}


function normalizeBracketSize(teamCount) {
  if (teamCount <= 4) return 4;
  if (teamCount <= 8) return 8;
  if (teamCount <= 16) return 16;
  return 32;
}

function seedOrder(size) {
  if (size === 1) return [1];
  const prev = seedOrder(size / 2);
  const out = [];
  for (const s of prev) {
    out.push(s);
    out.push(size + 1 - s);
  }
  return out;
}

function buildSeededTeamSlots(teamList, size) {
  const order = seedOrder(size);
  return order.map(seed => seed <= teamList.length ? teamList[seed - 1] : null);
}

function sourceWinner(roundIndex, matchIndex) {
  return { kind: "winnerMatchWinner", roundIndex, matchIndex };
}

function sourceLoser(roundIndex, matchIndex) {
  return { kind: "winnerMatchLoser", roundIndex, matchIndex };
}

function sourceLWinner(matchIndex) {
  return { kind: "loserMatchWinner", matchIndex };
}

function makeLoserRoundPairingSources(sources, roundNumber) {
  const entries = [];
  for (let i = 0; i < sources.length; i += 2) {
    entries.push({
      round: roundNumber,
      team1Source: sources[i] || null,
      team2Source: sources[i + 1] || null
    });
  }
  return entries;
}

function buildReviewStyleLoserTemplate(bracketSize, nextMatchIdStart) {
  const wbRounds = Math.log2(bracketSize);
  const entries = [];
  let lbRound = 1;
  let carrySources = [];

  for (let wr = 0; wr < wbRounds; wr++) {
    const wbMatchCount = bracketSize / Math.pow(2, wr + 1);
    const losers = [];

    for (let m = 0; m < wbMatchCount; m++) {
      losers.push(sourceLoser(wr, m));
    }

    if (wr === 0) {
      // Anti-rematch-friendly first wave: L W1 vs L W3, L W2 vs L W4, etc.
      const reordered = [];
      for (let i = 0; i < losers.length; i += 4) {
        if (losers[i]) reordered.push(losers[i]);
        if (losers[i + 2]) reordered.push(losers[i + 2]);
        if (losers[i + 1]) reordered.push(losers[i + 1]);
        if (losers[i + 3]) reordered.push(losers[i + 3]);
      }
      if (!reordered.length) reordered.push(...losers);
      const wave = makeLoserRoundPairingSources(reordered, lbRound++);
      const start = entries.length;
      entries.push(...wave);
      carrySources = wave.map((_, idx) => sourceLWinner(start + idx));
    } else if (wr < wbRounds - 1) {
      const pool = carrySources.concat(losers);
      const wave = makeLoserRoundPairingSources(pool, lbRound++);
      const start = entries.length;
      entries.push(...wave);
      carrySources = wave.map((_, idx) => sourceLWinner(start + idx));
    } else {
      // Winner bracket final loser enters at the end of loser bracket.
      const pool = carrySources.concat(losers);
      let current = pool;
      while (current.length > 1) {
        const wave = makeLoserRoundPairingSources(current, lbRound++);
        const start = entries.length;
        entries.push(...wave);
        current = wave.map((_, idx) => sourceLWinner(start + idx));
      }
      carrySources = current;
    }
  }

  return entries
    .filter(entry => entry.team1Source || entry.team2Source)
    .map((entry, idx) => ({
      id: nextMatchIdStart + idx,
      round: entry.round,
      team1Source: entry.team1Source,
      team2Source: entry.team2Source,
      team1: null,
      team2: null,
      winner: null,
      board: null
    }));
}


function buildStrictFiveTeamWinnersTemplate(teamList) {
  return [
    [
      { id: 1, round: 1, team1: teamList[3] || null, team2: teamList[4] || null, winner: null, board: null }
    ],
    [
      { id: 2, round: 2, team1: teamList[1] || null, team2: teamList[2] || null, winner: null, board: null },
      { id: 3, round: 2, team1: teamList[0] || null, team2Source: { kind: "winnerMatchWinner", roundIndex: 0, matchIndex: 0 }, team2: null, winner: null, board: null }
    ],
    [
      { id: 5, round: 3, team1Source: { kind: "winnerMatchWinner", roundIndex: 1, matchIndex: 0 }, team2Source: { kind: "winnerMatchWinner", roundIndex: 1, matchIndex: 1 }, team1: null, team2: null, winner: null, board: null }
    ]
  ];
}

function buildStrictFiveTeamLoserTemplate() {
  return [
    { id: 4, round: 1, team1Source: { kind: "winnerMatchLoser", roundIndex: 0, matchIndex: 0 }, team2Source: { kind: "winnerMatchLoser", roundIndex: 1, matchIndex: 0 }, team1: null, team2: null, winner: null, board: null },
    { id: 6, round: 2, team1Source: { kind: "loserMatchWinner", matchIndex: 0 }, team2Source: { kind: "winnerMatchLoser", roundIndex: 1, matchIndex: 1 }, team1: null, team2: null, winner: null, board: null },
    { id: 7, round: 3, team1Source: { kind: "loserMatchWinner", matchIndex: 1 }, team2Source: { kind: "winnerMatchLoser", roundIndex: 2, matchIndex: 0 }, team1: null, team2: null, winner: null, board: null }
  ];
}

function buildStrictFiveTeamBracket() {
  winnersBracket = buildStrictFiveTeamWinnersTemplate(teams);
  matches = winnersBracket[0].map(m => ({ id: m.id, team1: m.team1, team2: m.team2, winner: null, board: null }));
  losersMatches = buildStrictFiveTeamLoserTemplate();
  syncWinnerBracketTeams();
  syncLosersBracketTeams();
  return true;
}


function buildStrictSixTeamWinnersTemplate(teamList) {
  // Reference-style 6-team winner bracket:
  // W1 = Seed 3 vs Seed 6
  // W2 = Seed 4 vs Seed 5
  // W3 = Seed 2 vs Winner W1
  // W4 = Seed 1 vs Winner W2
  // W7 = Winner W3 vs Winner W4
  return [
    [
      { id: 1, round: 1, team1: teamList[2] || null, team2: teamList[5] || null, winner: null, board: null },
      { id: 2, round: 1, team1: teamList[3] || null, team2: teamList[4] || null, winner: null, board: null }
    ],
    [
      { id: 3, round: 2, team1: teamList[1] || null, team2Source: { kind: "winnerMatchWinner", roundIndex: 0, matchIndex: 0 }, team2: null, winner: null, board: null },
      { id: 4, round: 2, team1: teamList[0] || null, team2Source: { kind: "winnerMatchWinner", roundIndex: 0, matchIndex: 1 }, team2: null, winner: null, board: null }
    ],
    [
      { id: 7, round: 3, team1Source: { kind: "winnerMatchWinner", roundIndex: 1, matchIndex: 0 }, team2Source: { kind: "winnerMatchWinner", roundIndex: 1, matchIndex: 1 }, team1: null, team2: null, winner: null, board: null }
    ]
  ];
}

function buildStrictSixTeamLoserTemplate() {
  // Reference-style 6-team loser bracket:
  // L5 = Loser W3 vs Loser W2
  // L6 = Loser W4 vs Loser W1
  // L8 = Winner L5 vs Winner L6
  // L9 = Winner L8 vs Loser W7
  return [
    { id: 5, round: 1, team1Source: { kind: "winnerMatchLoser", roundIndex: 1, matchIndex: 0 }, team2Source: { kind: "winnerMatchLoser", roundIndex: 0, matchIndex: 1 }, team1: null, team2: null, winner: null, board: null },
    { id: 6, round: 1, team1Source: { kind: "winnerMatchLoser", roundIndex: 1, matchIndex: 1 }, team2Source: { kind: "winnerMatchLoser", roundIndex: 0, matchIndex: 0 }, team1: null, team2: null, winner: null, board: null },
    { id: 8, round: 2, team1Source: { kind: "loserMatchWinner", matchIndex: 0 }, team2Source: { kind: "loserMatchWinner", matchIndex: 1 }, team1: null, team2: null, winner: null, board: null },
    { id: 9, round: 3, team1Source: { kind: "loserMatchWinner", matchIndex: 2 }, team2Source: { kind: "winnerMatchLoser", roundIndex: 2, matchIndex: 0 }, team1: null, team2: null, winner: null, board: null }
  ];
}

function buildStrictSixTeamBracket() {
  winnersBracket = buildStrictSixTeamWinnersTemplate(teams);
  matches = winnersBracket[0].map(m => ({ id: m.id, team1: m.team1, team2: m.team2, winner: null, board: null }));
  losersMatches = buildStrictSixTeamLoserTemplate();
  syncWinnerBracketTeams();
  syncLosersBracketTeams();
  return true;
}


function buildStrictSevenTeamWinnersTemplate(teamList) {
  return [
    [
      { id: 1, round: 1, team1: teamList[2] || null, team2: teamList[5] || null, winner: null, board: null },
      { id: 2, round: 1, team1: teamList[1] || null, team2: teamList[6] || null, winner: null, board: null },
      { id: 3, round: 1, team1: teamList[3] || null, team2: teamList[4] || null, winner: null, board: null }
    ],
    [
      { id: 4, round: 2, team1Source: { kind: "winnerMatchWinner", roundIndex: 0, matchIndex: 0 }, team2Source: { kind: "winnerMatchWinner", roundIndex: 0, matchIndex: 1 }, team1: null, team2: null, winner: null, board: null },
      { id: 5, round: 2, team1: teamList[0] || null, team2Source: { kind: "winnerMatchWinner", roundIndex: 0, matchIndex: 2 }, team2: null, winner: null, board: null }
    ],
    [
      { id: 8, round: 3, team1Source: { kind: "winnerMatchWinner", roundIndex: 1, matchIndex: 0 }, team2Source: { kind: "winnerMatchWinner", roundIndex: 1, matchIndex: 1 }, team1: null, team2: null, winner: null, board: null }
    ]
  ];
}

function buildStrictSevenTeamLoserTemplate() {
  return [
    { id: 6, round: 1, team1Source: { kind: "winnerMatchLoser", roundIndex: 1, matchIndex: 0 }, team2Source: { kind: "winnerMatchLoser", roundIndex: 0, matchIndex: 2 }, team1: null, team2: null, winner: null, board: null },
    { id: 7, round: 1, team1Source: { kind: "winnerMatchLoser", roundIndex: 1, matchIndex: 1 }, team2Source: { kind: "winnerMatchLoser", roundIndex: 0, matchIndex: 0 }, team1: null, team2: null, winner: null, board: null },
    { id: 9, round: 2, team1Source: { kind: "loserMatchWinner", matchIndex: 0 }, team2Source: { kind: "loserMatchWinner", matchIndex: 1 }, team1: null, team2: null, winner: null, board: null },
    { id: 10, round: 3, team1Source: { kind: "loserMatchWinner", matchIndex: 2 }, team2Source: { kind: "winnerMatchLoser", roundIndex: 2, matchIndex: 0 }, team1: null, team2: null, winner: null, board: null }
  ];
}

function buildStrictSevenTeamBracket() {
  winnersBracket = buildStrictSevenTeamWinnersTemplate(teams);
  matches = winnersBracket[0].map(m => ({ id: m.id, team1: m.team1, team2: m.team2, winner: null, board: null }));
  losersMatches = buildStrictSevenTeamLoserTemplate();
  syncWinnerBracketTeams();
  syncLosersBracketTeams();
  return true;
}


function buildStrictEightTeamBracket() {
  winnersBracket = [
    [
      {id:1,round:1,team1:teams[2],team2:teams[5],winner:null},
      {id:2,round:1,team1:teams[1],team2:teams[6],winner:null},
      {id:3,round:1,team1:teams[0],team2:teams[7],winner:null},
      {id:4,round:1,team1:teams[3],team2:teams[4],winner:null}
    ],
    [
      {id:7,round:2,team1Source:{kind:"winnerMatchWinner",roundIndex:0,matchIndex:0},team2Source:{kind:"winnerMatchWinner",roundIndex:0,matchIndex:1}},
      {id:8,round:2,team1Source:{kind:"winnerMatchWinner",roundIndex:0,matchIndex:2},team2Source:{kind:"winnerMatchWinner",roundIndex:0,matchIndex:3}}
    ],
    [
      {id:11,round:3,team1Source:{kind:"winnerMatchWinner",roundIndex:1,matchIndex:0},team2Source:{kind:"winnerMatchWinner",roundIndex:1,matchIndex:1}}
    ]
  ]

  losersMatches = [
    {id:5,round:1,team1Source:{kind:"winnerMatchLoser",roundIndex:0,matchIndex:0},team2Source:{kind:"winnerMatchLoser",roundIndex:0,matchIndex:1}},
    {id:6,round:1,team1Source:{kind:"winnerMatchLoser",roundIndex:0,matchIndex:2},team2Source:{kind:"winnerMatchLoser",roundIndex:0,matchIndex:3}},
    {id:9,round:2,team1Source:{kind:"loserMatchWinner",matchIndex:0},team2Source:{kind:"winnerMatchLoser",roundIndex:1,matchIndex:0}},
    {id:10,round:2,team1Source:{kind:"loserMatchWinner",matchIndex:1},team2Source:{kind:"winnerMatchLoser",roundIndex:1,matchIndex:1}},
    {id:12,round:3,team1Source:{kind:"loserMatchWinner",matchIndex:2},team2Source:{kind:"loserMatchWinner",matchIndex:3}},
    {id:13,round:4,team1Source:{kind:"loserMatchWinner",matchIndex:4},team2Source:{kind:"winnerMatchLoser",roundIndex:2,matchIndex:0}}
  ]

  syncWinnerBracketTeams()
  syncLosersBracketTeams()
}

function buildStrictNineTenPlaceholder() {
  // For now: extend 8-team logic + byes
  buildStrictEightTeamBracket()
}


// --- V28 STRICT ROUTE TABLE ENGINE -----------------------------
// Uses fixed match maps instead of generating routes by approximation.
// 3-10 are encoded from the reference PDF layouts. 11-20 use the
// same route-table structure and are validated before rendering.

function rtSeed(n) {
  return teams[n - 1] || null;
}

function rtW(id) { return { kind: "routeWinner", bracket: "winner", id }; }
function rtL(id) { return { kind: "routeLoser", bracket: "winner", id }; }
function rtLW(id) { return { kind: "routeWinner", bracket: "loser", id }; }
function rtLL(id) { return { kind: "routeLoser", bracket: "loser", id }; }

function rtMakeW(id, round, a, b) {
  const m = { id, round, team1: null, team2: null, winner: null, board: null };
  if (a && a.kind) m.team1Source = a; else m.team1 = a || null;
  if (b && b.kind) m.team2Source = b; else m.team2 = b || null;
  return m;
}

function rtMakeL(id, round, a, b) {
  return { id, round, team1Source: a || null, team2Source: b || null, team1: null, team2: null, winner: null, board: null };
}

function rtFindWinnerMatchById(id) {
  for (const round of winnersBracket) {
    for (const m of round) if (m && m.id === id) return m;
  }
  return null;
}

function rtFindLoserMatchById(id) {
  return losersMatches.find(m => m && m.id === id) || null;
}

function rtResolveSource(source) {
  if (!source) return null;
  if (source.kind !== "routeWinner" && source.kind !== "routeLoser") return null;
  const m = source.bracket === "winner" ? rtFindWinnerMatchById(source.id) : rtFindLoserMatchById(source.id);
  if (!m) return null;
  if (source.kind === "routeWinner") return m.winner || null;
  if (!m.winner || !m.team1 || !m.team2) return null;
  return m.winner.id === m.team1.id ? m.team2 : m.team1;
}

function rtBuildMap(n) {
  const maps = {
    3: {
      wb: [
        [rtMakeW(1,1,rtSeed(2),rtSeed(3))],
        [rtMakeW(3,2,rtSeed(1),rtW(1))]
      ],
      lb: [
        rtMakeL(2,1,rtL(1),null),
        rtMakeL(4,2,rtLW(2),rtL(3))
      ],
      finals: [5]
    },
    4: {
      wb: [
        [rtMakeW(1,1,rtSeed(1),rtSeed(4)), rtMakeW(2,1,rtSeed(2),rtSeed(3))],
        [rtMakeW(3,2,rtW(1),rtW(2))]
      ],
      lb: [
        rtMakeL(4,1,rtL(1),rtL(2)),
        rtMakeL(5,2,rtLW(4),rtL(3))
      ],
      finals: [6,7]
    },
    5: {
      wb: [
        [rtMakeW(1,1,rtSeed(4),rtSeed(5))],
        [rtMakeW(2,2,rtSeed(2),rtSeed(3)), rtMakeW(3,2,rtSeed(1),rtW(1))],
        [rtMakeW(5,3,rtW(2),rtW(3))]
      ],
      lb: [
        rtMakeL(4,1,rtL(1),rtL(2)),
        rtMakeL(6,2,rtLW(4),rtL(3)),
        rtMakeL(7,3,rtLW(6),rtL(5))
      ],
      finals: [8,9]
    },
    6: {
      wb: [
        [rtMakeW(1,1,rtSeed(3),rtSeed(6)), rtMakeW(2,1,rtSeed(4),rtSeed(5))],
        [rtMakeW(3,2,rtSeed(2),rtW(1)), rtMakeW(4,2,rtSeed(1),rtW(2))],
        [rtMakeW(7,3,rtW(3),rtW(4))]
      ],
      lb: [
        rtMakeL(5,1,rtL(3),rtL(2)),
        rtMakeL(6,1,rtL(4),rtL(1)),
        rtMakeL(8,2,rtLW(5),rtLW(6)),
        rtMakeL(9,3,rtLW(8),rtL(7))
      ],
      finals: [10,11]
    },
    7: {
      wb: [
        [rtMakeW(1,1,rtSeed(3),rtSeed(6)), rtMakeW(2,1,rtSeed(2),rtSeed(7)), rtMakeW(3,1,rtSeed(4),rtSeed(5))],
        [rtMakeW(4,2,rtW(1),rtW(2)), rtMakeW(5,2,rtSeed(1),rtW(3))],
        [rtMakeW(8,3,rtW(4),rtW(5))]
      ],
      lb: [
        // PDF sequence: Loser Round 1 has only one match: L2 vs L3
        rtMakeL(6,1,rtL(2),rtL(3)),

        // Loser Round 2 has two matches:
        // L7 = L4 vs W6
        // L9 = L1 vs L5
        rtMakeL(7,2,rtL(4),rtLW(6)),
        rtMakeL(9,2,rtL(1),rtL(5)),

        // Consolidate, then receive King Seat loser.
        rtMakeL(10,3,rtLW(7),rtLW(9)),
        rtMakeL(11,4,rtLW(10),rtL(8))
      ],
      finals: [12,13]
    },
    8: {
      wb: [
        [rtMakeW(1,1,rtSeed(1),rtSeed(8)), rtMakeW(2,1,rtSeed(4),rtSeed(5)), rtMakeW(3,1,rtSeed(3),rtSeed(6)), rtMakeW(4,1,rtSeed(2),rtSeed(7))],
        [rtMakeW(7,2,rtW(1),rtW(2)), rtMakeW(8,2,rtW(3),rtW(4))],
        [rtMakeW(11,3,rtW(7),rtW(8))]
      ],
      lb: [
        rtMakeL(5,1,rtL(1),rtL(2)),
        rtMakeL(6,1,rtL(3),rtL(4)),
        rtMakeL(9,2,rtL(8),rtLW(5)),
        rtMakeL(10,2,rtL(7),rtLW(6)),
        rtMakeL(12,3,rtLW(9),rtLW(10)),
        rtMakeL(13,4,rtL(11),rtLW(12))
      ],
      finals: [14,15]
    },
    9: {
      wb: [
        // Winner Round 1: only the play-in match, Seed 8 vs Seed 9.
        [rtMakeW(1,1,rtSeed(8),rtSeed(9))],

        // Winner Round 2: remaining seeds enter.
        // W2 = Seed 2 vs Seed 7
        // W3 = Seed 3 vs Seed 6
        // W4 = Seed 4 vs Seed 5
        // W5 = Seed 1 vs Winner W1
        [rtMakeW(2,2,rtSeed(2),rtSeed(7)), rtMakeW(3,2,rtSeed(3),rtSeed(6)), rtMakeW(4,2,rtSeed(4),rtSeed(5)), rtMakeW(5,2,rtSeed(1),rtW(1))],

        // Winner Round 3
        // W9 = Winner W2 vs Winner W3
        // W10 = Winner W5 vs Winner W4
        [rtMakeW(9,3,rtW(2),rtW(3)), rtMakeW(10,3,rtW(5),rtW(4))],

        // King Seat
        [rtMakeW(13,4,rtW(9),rtW(10))]
      ],
      lb: [
        // Loser Round 1: only one match, L1 vs L2.
        rtMakeL(6,1,rtL(1),rtL(2)),

        // Loser Round 2: two matches.
        rtMakeL(7,2,rtL(4),rtL(5)),
        rtMakeL(8,2,rtLW(6),rtL(3)),

        // Later loser rounds follow the PDF flow into W9/W10/W13 drops.
        rtMakeL(11,3,rtLW(7),rtL(9)),
        rtMakeL(12,3,rtLW(8),rtL(10)),
        rtMakeL(14,4,rtLW(12),rtLW(11)),
        rtMakeL(15,5,rtL(13),rtLW(14))
      ],
      finals: [16,17]
    },
    10: {
      wb: [
        [
          rtMakeW(1,1,rtSeed(8),rtSeed(9)),
          rtMakeW(2,1,rtSeed(7),rtSeed(10))
        ],
        [
          rtMakeW(3,2,rtSeed(4),rtSeed(5)),
          rtMakeW(4,2,rtSeed(6),rtSeed(3)),
          rtMakeW(5,2,rtW(1),rtSeed(1)),
          rtMakeW(6,2,rtW(2),rtSeed(2))
        ],
        [
          rtMakeW(11,3,rtW(3),rtW(5)),
          rtMakeW(12,3,rtW(6),rtW(4))
        ],
        [
          rtMakeW(16,4,rtW(11),rtW(12))
        ]
      ],
      lb: [
        rtMakeL(7,1,rtL(2),rtL(5)),
        rtMakeL(8,1,rtL(1),rtL(6)),
        rtMakeL(9,2,rtLW(7),rtL(3)),
        rtMakeL(10,2,rtLW(8),rtL(4)),
        rtMakeL(11,3,rtLW(9),rtL(12)),
        rtMakeL(12,3,rtLW(10),rtL(11)),
        rtMakeL(15,4,rtLW(12),rtLW(11)),
        rtMakeL(16,5,rtLW(15),rtL(16))
      ],
      finals: [17,18]
    },
  };
  if (maps[n]) return maps[n];
  return rtBuildGenericFallbackMap(n);
}

function rtSeedOrder(size) {
  if (size === 1) return [1];
  const prev = rtSeedOrder(size / 2);
  const out = [];
  prev.forEach(s => { out.push(s); out.push(size + 1 - s); });
  return out;
}

function rtBracketSize(n) {
  if (n <= 4) return 4;
  if (n <= 8) return 8;
  if (n <= 16) return 16;
  return 32;
}

function rtBuildGenericFallbackMap(n) {
  // Deterministic route-table fallback for 11-20. It is table-built, not runtime-generated
  // during bracket play. This keeps the system stable while maps 11-20 are verified.
  const size = rtBracketSize(n);
  const seeds = rtSeedOrder(size).map(s => s <= n ? rtSeed(s) : null);
  let nextId = 1;
  const wb = [];
  const r1 = [];
  for (let i = 0; i < size; i += 2) r1.push(rtMakeW(nextId++, 1, seeds[i], seeds[i+1]));
  wb.push(r1);
  let prev = r1;
  let round = 2;
  while (prev.length > 1) {
    const cur = [];
    for (let i = 0; i < prev.length; i += 2) cur.push(rtMakeW(nextId++, round, rtW(prev[i].id), rtW(prev[i+1].id)));
    wb.push(cur);
    prev = cur;
    round++;
  }
  const lb = [];
  let carry = [];
  let lbRound = 1;
  for (let wr = 0; wr < wb.length; wr++) {
    let pool = [];
    if (wr === 0) {
      pool = wb[wr].map(m => rtL(m.id));
    } else {
      pool = carry.concat(wb[wr].map(m => rtL(m.id)));
    }
    carry = [];
    for (let i = 0; i < pool.length; i += 2) {
      const m = rtMakeL(nextId++, lbRound, pool[i], pool[i+1] || null);
      lb.push(m);
      carry.push(rtLW(m.id));
    }
    lbRound++;
  }
  return { wb, lb, finals: [nextId, nextId+1] };
}

function rtApplyMap(map) {
  winnersBracket = map.wb.map(round => round.map(m => ({ ...m })));
  losersMatches = map.lb.map(m => ({ ...m }));
  matches = (winnersBracket[0] || []).map(m => ({ id: m.id, team1: m.team1, team2: m.team2, winner: null, board: null }));
  syncWinnerBracketTeams();
  syncLosersBracketTeams();
  const validation = rtValidateCurrentMap();
  if (!validation.ok) {
    console.error("Route-table validation failed:", validation.errors);
    alert("Bracket route-table validation failed. Check console for details.");
  }
}

function rtValidateCurrentMap() {
  const winnerIds = new Set(winnersBracket.flat().map(m => m.id));
  const loserIds = new Set(losersMatches.map(m => m.id));
  const errors = [];
  const check = (src, owner) => {
    if (!src) return;
    if (src.kind !== "routeWinner" && src.kind !== "routeLoser") return;
    const set = src.bracket === "winner" ? winnerIds : loserIds;
    if (!set.has(src.id)) errors.push(`${owner} references missing ${src.bracket} match ${src.id}`);
  };
  winnersBracket.flat().forEach(m => { check(m.team1Source, `W${m.id}.team1`); check(m.team2Source, `W${m.id}.team2`); });
  losersMatches.forEach(m => { check(m.team1Source, `L${m.id}.team1`); check(m.team2Source, `L${m.id}.team2`); });
  return { ok: errors.length === 0, errors };
}

function buildWinnersBracket() {
  winnersBracket = [];
  matches = [];
  losersMatches = [];
  losersWaitingQueue = [];
  teamLosses = {};
  finalsState = { match1Winner: null, match2Winner: null, champion: null, runnerUp: null };
  eliminationOrder = [];
  lastLoserRoundsForLines = [];

  const teamCount = teams.length;
  if (teamCount < 2) return;
  if (teamCount < 3 || teamCount > 20) {
    alert("This deterministic route-table engine supports 3 to 20 teams.");
    return;
  }

  teams.forEach(t => { teamLosses[t.id] = 0; });

  const map = rtBuildMap(teamCount);
  rtApplyMap(map);
}


function handleGenerateBracket() {
  if (!teams.length) {
    alert("Build teams first.");
    return;
  }
  if (tournamentLocked) {
    alert("Tournament in progress – cannot regenerate bracket.");
    return;
  }

  buildWinnersBracket();
  rerenderAll();
  persistTournamentStateSilent();
}

function handleReseedBracket() {
  if (tournamentLocked) {
    alert("Tournament in progress – cannot reseed.");
    return;
  }
  if (teams.length < 2) {
    alert("Need at least 2 teams.");
    return;
  }
  if (!confirm("Reseed will reset all results and randomize the bracket. Continue?")) {
    return;
  }

  teams = shuffleArray(teams);
  buildWinnersBracket();
  rerenderAll();
  persistTournamentStateSilent();
}

// --- Locking -------------------------------------

function ensureTournamentLocked() {
  if (!tournamentLocked) {
    tournamentLocked = true;
    updateLockedUI();
  }
}

function updateLockedUI() {
  const genBtn = document.getElementById("generate-teams-btn");
  const reseedBtn = document.getElementById("reseed-bracket-btn");
  if (genBtn) genBtn.disabled = tournamentLocked;
  if (reseedBtn) reseedBtn.disabled = tournamentLocked;
}

// --- Losses & Loser bracket ----------------------

function markTeamEliminated(team, source) {
  if (!team) return;
  if (!eliminationOrder.includes(team.id)) {
    eliminationOrder.push(team.id);
  }
}

function recordLoss(team, options = {}) {
  if (!team) return;
  const eliminateOnSecondLoss = options.eliminateOnSecondLoss !== false;
  if (teamLosses[team.id] == null) teamLosses[team.id] = 0;
  teamLosses[team.id] += 1;
  if (teamLosses[team.id] >= 2 && eliminateOnSecondLoss) {
    markTeamEliminated(team, options.source || 'match');
  }
}

function addTeamToLosersQueue(team) {
  // queue system replaced by fixed-source losers bracket
}

// --- Winner bracket rendering --------------------

function renderWinnersBracket() {
  const container = document.getElementById("winners-bracket");
  if (!container) return;
  container.innerHTML = "";

  if (!winnersBracket.length) {
    container.textContent = "Generate the winner bracket to view it here.";
    return;
  }

  winnersBracket.forEach((roundMatches, rIndex) => {
    const roundDiv = document.createElement("div");
    roundDiv.className = "bracket-round";
    
    const roundTitle = document.createElement("div");
    roundTitle.className = "bracket-round-title";
    roundTitle.textContent = rIndex === winnersBracket.length - 1 ? "King Seat" : `Winner Round ${rIndex + 1}`;
    roundDiv.appendChild(roundTitle);

    roundMatches.forEach((match, i) => {
      const pairDiv = document.createElement("div");
      pairDiv.className = "match-pair single";
      pairDiv.appendChild(createMatchBoxWithBoard(match, rIndex, i, true));
      roundDiv.appendChild(pairDiv);
    });

    container.appendChild(roundDiv);
  });

  requestAnimationFrame(() => drawBracketLines("winners-bracket", winnersBracket));
  renderCourtAssignments();
}

function renderLosersBracket() {
  const container = document.getElementById("losers-bracket");
  if (!container) return;
  container.innerHTML = "";

  if (!losersMatches.length) {
    container.textContent = "No teams in the loser bracket yet.";
    lastLoserRoundsForLines = [];
    renderCourtAssignments();
    return;
  }

  const roundsMap = new Map();
  losersMatches.forEach(m => {
    const r = m.round || 1;
    if (!roundsMap.has(r)) roundsMap.set(r, []);
    roundsMap.get(r).push(m);
  });

  const roundNumbers = Array.from(roundsMap.keys()).sort((a, b) => a - b);
  const roundsArray = [];

  roundNumbers.forEach((roundNum, idx) => {
    const matchesList = roundsMap.get(roundNum);
    roundsArray[idx] = matchesList;

    const roundDiv = document.createElement("div");
    roundDiv.className = "bracket-round loser-round";
    
    const roundTitle = document.createElement("div");
    roundTitle.className = "bracket-round-title";
    roundTitle.textContent = `Loser Round ${roundNum}`;
    roundDiv.appendChild(roundTitle);

    matchesList.forEach((match, i) => {
      const pairDiv = document.createElement("div");
      pairDiv.className = "match-pair single";
      pairDiv.appendChild(createMatchBoxWithBoard(match, idx, i, false));
      roundDiv.appendChild(pairDiv);
    });

    container.appendChild(roundDiv);
  });

  lastLoserRoundsForLines = roundsArray;
  requestAnimationFrame(() => drawBracketLines("losers-bracket", roundsArray));
  renderCourtAssignments();
}

function createMatchBoxWithBoard(match, roundIndex, matchIndex, isWinner) {
  const box = document.createElement("div");
  box.className = "match-box";
  if (match.winner) box.classList.add("match-complete");
  if (!match.team1 && !match.team2) box.classList.add("match-pending");
  box.dataset.round = String(roundIndex);
  box.dataset.matchIndex = String(matchIndex);

  const label = document.createElement("div");
  label.className = "match-label";
  const sidePrefix = isWinner ? "W" : "L";
  label.textContent = bracketViewMode === "blank" ? getBlankMatchLabel() : `${sidePrefix}${match.id}`;
  box.appendChild(label);

  const t1Div = document.createElement("div");
  t1Div.className = "team-line";

  const t2Div = document.createElement("div");
  t2Div.className = "team-line";

  const sourceText = (source, fallback) => {
    if (!source) return fallback;
    if (source.kind === "routeWinner") return source.bracket === "winner" ? `Winner of W${source.id}` : `Winner of L${source.id}`;
    if (source.kind === "routeLoser") return source.bracket === "winner" ? `Loser of W${source.id}` : `Loser of L${source.id}`;
    if (source.kind === "winnerMatchWinner") {
      const src = getWinnerMatch(source.roundIndex, source.matchIndex);
      return src ? `Winner of W${src.id}` : fallback;
    }
    if (source.kind === "winnerMatchLoser") {
      const src = getWinnerMatch(source.roundIndex, source.matchIndex);
      return src ? `Loser of W${src.id}` : fallback;
    }
    if (source.kind === "loserMatchWinner") {
      const src = getLoserMatch(source.matchIndex);
      return src ? `Winner of L${src.id}` : fallback;
    }
    if (source.kind === "loserMatchWinnerAntiRematch") {
      const src = getLoserMatch(source.primaryMatchIndex);
      return src ? `Winner of L${src.id}` : fallback;
    }
    return fallback;
  };

  const blankMode = bracketViewMode === "blank";
  const t1Text = blankMode
    ? "________________________"
    : match.team1
      ? formatTeamLabelWithLosses(match.team1)
      : isWinner
        ? (roundIndex === 0 ? "BYE / TBD" : sourceText(match.team1Source, "Winner TBD"))
        : sourceText(match.team1Source, "TBD");

  const t2Text = blankMode
    ? "________________________"
    : match.team2
      ? formatTeamLabelWithLosses(match.team2)
      : isWinner
        ? (roundIndex === 0 ? "BYE / TBD" : sourceText(match.team2Source, "Winner TBD"))
        : sourceText(match.team2Source, "TBD");

  if (blankMode) {
    t1Div.innerHTML = "";
    t2Div.innerHTML = "";
    t1Div.appendChild(createBlankFillInput(match, 1));
    t2Div.appendChild(createBlankFillInput(match, 2));
  } else {
    t1Div.textContent = t1Text;
    t2Div.textContent = t2Text;
  }

  if (isWinner && roundIndex <= 1) {
    t1Div.classList.add("team-line-editable");
    t2Div.classList.add("team-line-editable");

    t1Div.addEventListener("click", ev => {
      ev.stopPropagation();
      showTeamSelectInline(match, 1, t1Div);
    });
    t2Div.addEventListener("click", ev => {
      ev.stopPropagation();
      showTeamSelectInline(match, 2, t2Div);
    });
  }

  if (!blankMode && match.winner) {
    if (match.team1 && match.winner.id === match.team1.id) {
      t1Div.classList.add("win");
      t2Div.classList.add("loss");
    } else if (match.team2 && match.winner.id === match.team2.id) {
      t2Div.classList.add("win");
      t1Div.classList.add("loss");
    }
  }

  box.appendChild(t1Div);
  box.appendChild(t2Div);

  if (!blankMode && match.winner) {
    const winnerLabel = document.createElement("div");
    winnerLabel.className = "match-label winner-chip";
    winnerLabel.textContent = `Winner: ${formatTeamLabel(match.winner)}`;
    box.appendChild(winnerLabel);
  }

  if (!blankMode) {
    const boardSelect = document.createElement("select");

    const defOpt = document.createElement("option");
    defOpt.value = "";
    defOpt.textContent = "Board -";
    boardSelect.appendChild(defOpt);

    for (let i = 1; i <= 20; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `Board ${i}`;
      if (match.board === i) opt.selected = true;
      boardSelect.appendChild(opt);
    }

    boardSelect.addEventListener("click", ev => ev.stopPropagation());

    boardSelect.addEventListener("change", () => {
      const val = parseInt(boardSelect.value, 10);
      match.board = isNaN(val) ? null : val;

      if (isWinner && roundIndex === 0) {
        const rowMatch = matches.find(m => m.id === match.id);
        if (rowMatch) {
          rowMatch.board = match.board;
          renderMatches();
          persistTournamentStateSilent();
          return;
        }
      }

      renderCourtAssignments();
      persistTournamentStateSilent();
    });

    box.appendChild(boardSelect);
  }

  box.addEventListener("click", () => {
    if (isWinner) {
      chooseWinnerForMatch(roundIndex, matchIndex);
    } else {
      const index = losersMatches.indexOf(match);
      if (index >= 0) chooseWinnerForLosersMatch(index);
    }
  });

  return box;
}

function showTeamSelectInline(match, slot, containerDiv) {
  if (!teams.length) {
    alert("No teams yet.");
    return;
  }

  containerDiv.innerHTML = "";

  const select = document.createElement("select");
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select team…";
  select.appendChild(placeholder);

  const clearOpt = document.createElement("option");
  clearOpt.value = "clear";
  clearOpt.textContent = "Empty / BYE";
  select.appendChild(clearOpt);

  teams.forEach(team => {
    const opt = document.createElement("option");
    opt.value = String(team.id);
    opt.textContent = formatTeamLabel(team);
    select.appendChild(opt);
  });

  select.addEventListener("click", ev => ev.stopPropagation());

  select.addEventListener("change", () => {
    const val = select.value;
    if (!val) return;

    const oldWinner = match.winner || null;
    const teamId = val === "clear" ? null : parseInt(val, 10);
    const team = teamId ? teams.find(t => t.id === teamId) : null;

    if (slot === 1) {
      match.team1 = team;
      if (!team) match.team1Source = null;
    } else {
      match.team2 = team;
      if (!team) match.team2Source = null;
    }

    if (teamId) {
      for (let r = 0; r <= 1; r++) {
        const round = winnersBracket[r] || [];
        round.forEach(otherMatch => {
          if (otherMatch === match) return;
          if (otherMatch.team1 && otherMatch.team1.id === teamId) otherMatch.team1 = null;
          if (otherMatch.team2 && otherMatch.team2.id === teamId) otherMatch.team2 = null;
          if (otherMatch.winner && otherMatch.winner.id === teamId) otherMatch.winner = null;
        });
      }
    }

    if (match.winner && (!match.team1 || !match.team2 || (match.winner.id !== match.team1.id && match.winner.id !== match.team2.id))) {
      match.winner = null;
      const pos = findWinnerMatchPositionById(match.id);
      if (pos && oldWinner) clearWinnerAdvancementFrom(pos.roundIndex, pos.matchIndex, oldWinner);
    }

    if (match.round === 1) {
      const rowMatch = matches.find(m => m.id === match.id);
      if (rowMatch) {
        rowMatch.team1 = match.team1;
        rowMatch.team2 = match.team2;
        rowMatch.winner = match.winner;
      }
    }

    if (typeof syncWinnerBracketTeams === "function") syncWinnerBracketTeams();
    syncLosersBracketTeams();
    rerenderAll();
    persistTournamentStateSilent();
  });

  containerDiv.appendChild(select);
  select.focus();
}


function findWinnerMatchPositionById(matchId) {
  for (let r = 0; r < winnersBracket.length; r++) {
    for (let m = 0; m < winnersBracket[r].length; m++) {
      if (winnersBracket[r][m]?.id === matchId) return { roundIndex: r, matchIndex: m };
    }
  }
  return null;
}

function clearWinnerAdvancementFrom(roundIndex, matchIndex, oldWinner) {
  if (!oldWinner) return;

  // Clear any downstream winner match whose source depended on this match and contains the old winner.
  winnersBracket.forEach((round, r) => {
    if (r <= roundIndex) return;
    round.forEach(m => {
      const s1 = m.team1Source;
      const s2 = m.team2Source;
      const depends1 = s1 && s1.kind === "winnerMatchWinner" && s1.roundIndex === roundIndex && s1.matchIndex === matchIndex;
      const depends2 = s2 && s2.kind === "winnerMatchWinner" && s2.roundIndex === roundIndex && s2.matchIndex === matchIndex;
      if (depends1 && m.team1 && m.team1.id === oldWinner.id) m.team1 = null;
      if (depends2 && m.team2 && m.team2.id === oldWinner.id) m.team2 = null;
      if (m.winner && (!m.team1 || !m.team2 || (m.winner.id !== m.team1.id && m.winner.id !== m.team2.id))) {
        m.winner = null;
      }
    });
  });

  if (typeof syncWinnerBracketTeams === "function") syncWinnerBracketTeams();
}

function clearDependentLoserResults() {
  // When a winner is corrected, downstream loser-bracket sources may change.
  // Clear loser-bracket winners whose teams no longer match their resolved sources.
  syncLosersBracketTeams();
}

function setMatchWinner(roundIndex, matchIndex, winnerTeam) {
  const match = winnersBracket[roundIndex][matchIndex];
  if (!match || !winnerTeam) return;

  const previousWinner = match.winner || null;
  if (previousWinner && previousWinner.id === winnerTeam.id) {
    alert("This team is already selected as the winner.");
    return;
  }

  if (previousWinner) {
    const ok = confirm(`Change winner for Match ${match.id}? This will clear stale downstream bracket results if needed.`);
    if (!ok) return;
    clearWinnerAdvancementFrom(roundIndex, matchIndex, previousWinner);
  }

  match.winner = winnerTeam;
  ensureTournamentLocked();

  let loser = null;
  if (match.team1 && match.team2) {
    loser = match.team1.id === winnerTeam.id ? match.team2 : match.team1;
  }

  // Losses are recalculated on finalization/export from match results, so do not permanently block corrections here.
  if (loser && !previousWinner) recordLoss(loser, { source: 'winners' });

  if (roundIndex === 0) {
    const rowMatch = matches.find(m => m.id === match.id);
    if (rowMatch) rowMatch.winner = winnerTeam;
  }

  propagateWinnerToNextRound(roundIndex, matchIndex, winnerTeam);
  clearDependentLoserResults();
  rerenderAll();
  persistTournamentStateSilent();
}

function chooseWinnerForMatch(roundIndex, matchIndex) {
  const match = winnersBracket[roundIndex][matchIndex];
  if (!match) return;

  const hasT1 = !!match.team1;
  const hasT2 = !!match.team2;

  if (!hasT1 && !hasT2) {
    alert("No teams assigned for this match.");
    return;
  }

  if (hasT1 && !hasT2) {
    setMatchWinner(roundIndex, matchIndex, match.team1);
    return;
  }
  if (!hasT1 && hasT2) {
    setMatchWinner(roundIndex, matchIndex, match.team2);
    return;
  }

  const opt1 = formatTeamLabelWithLosses(match.team1);
  const opt2 = formatTeamLabelWithLosses(match.team2);

  const choice = prompt(
    `Select winner for Match ${match.id}:\n1) ${opt1}\n2) ${opt2}\n\nEnter 1 or 2.`
  );
  if (choice === "1") {
    setMatchWinner(roundIndex, matchIndex, match.team1);
  } else if (choice === "2") {
    setMatchWinner(roundIndex, matchIndex, match.team2);
  }
}

function setLosersMatchWinner(matchIndex, winnerTeam) {
  const match = losersMatches[matchIndex];
  if (!match || !winnerTeam) return;

  const previousWinner = match.winner || null;
  if (previousWinner && previousWinner.id === winnerTeam.id) {
    alert("This team is already selected as the winner.");
    return;
  }

  if (previousWinner) {
    const ok = confirm(`Change winner for Loser Match ${match.id}? Downstream loser-bracket results may be cleared if stale.`);
    if (!ok) return;
  }

  match.winner = winnerTeam;
  ensureTournamentLocked();

  let loser = null;
  if (match.team1 && match.team2) {
    loser = match.team1.id === winnerTeam.id ? match.team2 : match.team1;
  }
  if (loser && !previousWinner) recordLoss(loser, { source: 'losers' });

  syncLosersBracketTeams();
  rerenderAll();
  persistTournamentStateSilent();
}

function chooseWinnerForLosersMatch(globalIndex) {
  const match = losersMatches[globalIndex];
  if (!match) return;

  const hasT1 = !!match.team1;
  const hasT2 = !!match.team2;

  if (!hasT1 && !hasT2) {
    alert("No teams assigned.");
    return;
  }
  if (hasT1 && !hasT2) {
    setLosersMatchWinner(globalIndex, match.team1);
    return;
  }
  if (!hasT1 && hasT2) {
    setLosersMatchWinner(globalIndex, match.team2);
    return;
  }

  const opt1 = formatTeamLabelWithLosses(match.team1);
  const opt2 = formatTeamLabelWithLosses(match.team2);

  const choice = prompt(
    `Select winner for Loser Match ${match.id} (Round ${match.round || 1}):\n1) ${opt1}\n2) ${opt2}\n\nEnter 1 or 2.`
  );
  if (choice === "1") {
    setLosersMatchWinner(globalIndex, match.team1);
  } else if (choice === "2") {
    setLosersMatchWinner(globalIndex, match.team2);
  }
}

// --- Round 1 match table -------------------------

function renderMatches() {
  const tbody = document.querySelector("#matches-table tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  matches.forEach(m => {
    const tr = document.createElement("tr");

    const tdId = document.createElement("td");
    tdId.textContent = m.id + (m.winner ? " ⭐" : "");

    const tdA = document.createElement("td");
    tdA.textContent = m.team1 ? formatTeamLabelWithLosses(m.team1) : "TBD / BYE";
    if (m.winner && m.team1 && m.winner.id === m.team1.id) {
      tdA.textContent += " (WIN)";
    }

    const tdB = document.createElement("td");
    tdB.textContent = m.team2 ? formatTeamLabelWithLosses(m.team2) : "TBD / BYE";
    if (m.winner && m.team2 && m.winner.id === m.team2.id) {
      tdB.textContent += " (WIN)";
    }

    const tdBoard = document.createElement("td");
    tdBoard.textContent = m.board ? `Board ${m.board}` : "-";

    tr.appendChild(tdId);
    tr.appendChild(tdA);
    tr.appendChild(tdB);
    tr.appendChild(tdBoard);
    tbody.appendChild(tr);
  });

  renderSummary();
  renderCourtAssignments();
}

// --- Finals / King Seat --------------------------

function getKingSeatTeam() {
  if (!winnersBracket.length) return null;
  const lastRound = winnersBracket[winnersBracket.length - 1];
  if (!lastRound.length) return null;
  const finalMatch = lastRound[lastRound.length - 1];
  return finalMatch.winner || null;
}

function getLosersChampionTeam() {
  const king = getKingSeatTeam();
  const kingId = king ? king.id : null;
  const aliveNonKing = teams.filter(t => t.id !== kingId && (teamLosses[t.id] || 0) < 2);
  if (aliveNonKing.length === 1) return aliveNonKing[0];
  for (let i = losersMatches.length - 1; i >= 0; i--) {
    const m = losersMatches[i];
    if (m && m.winner && (!kingId || m.winner.id !== kingId)) return m.winner;
  }
  return null;
}

function handleFinalMatch(n) {
  const king = getKingSeatTeam();
  const challenger = getLosersChampionTeam();
  if (!king || !challenger) {
    alert("Need winners champion and losers champion first.");
    return;
  }

  ensureTournamentLocked();

  if (n === 2) {
    if (!finalsState.match1Winner) {
      alert("Play Match 1 first.");
      return;
    }
    if (finalsState.match1Winner.id === king.id) {
      alert("King seat already won Match 1 – no Match 2 needed.");
      return;
    }
  }

  if ((n === 1 && finalsState.match1Winner) || (n === 2 && finalsState.match2Winner)) {
    const ok = confirm(`Change Finals Match ${n} winner?`);
    if (!ok) return;
  }

  const kingLabel = formatTeamLabelWithLosses(king);
  const chalLabel = formatTeamLabelWithLosses(challenger);

  const choice = prompt(
    `Select winner for Finals Match ${n}:
1) King seat: ${kingLabel}
2) Challenger: ${chalLabel}

Enter 1 or 2.`
  );
  if (choice !== "1" && choice !== "2") return;

  const winner = choice === "1" ? king : challenger;
  const loser = choice === "1" ? challenger : king;

  if (n === 1) {
    finalsState.match1Winner = winner;
    finalsState.match2Winner = null;

    if (winner.id === king.id) {
      finalsState.champion = king;
      finalsState.runnerUp = challenger;
      recordLoss(challenger, { queueOnFirstLoss: false, source: "finals" });
    } else {
      finalsState.champion = null;
      finalsState.runnerUp = null;
      recordLoss(king, { queueOnFirstLoss: false, eliminateOnSecondLoss: false, source: "finals" });
    }
  } else {
    finalsState.match2Winner = winner;
    finalsState.champion = winner;
    finalsState.runnerUp = loser;
    recordLoss(loser, { queueOnFirstLoss: false, source: "finals" });
  }

  renderFinalsSection();
  renderStandings();
  renderSummary();
  renderCourtAssignments();
  persistTournamentStateSilent();
}


function getFinalsVisualMatches() {
  const king = getKingSeatTeam();
  const challenger = getLosersChampionTeam();

  const match1 = {
    id: "F1",
    label: "Finals Match 1",
    team1: king,
    team2: challenger,
    winner: finalsState?.match1Winner || null
  };

  const match2Needed = !!(finalsState?.match1Winner && king && challenger && finalsState.match1Winner.id === challenger.id);
  const match2 = {
    id: "F2",
    label: "Finals Match 2 / Double Dip",
    team1: match2Needed ? king : null,
    team2: match2Needed ? challenger : null,
    winner: finalsState?.match2Winner || null
  };

  return [match1, match2];
}

function renderFinalsSection() {
  const king = getKingSeatTeam();
  const loserChamp = getLosersChampionTeam();

  document.getElementById("king-seat-team").textContent =
    king ? formatTeamLabel(king) : "TBD";
  document.getElementById("losers-champion-team").textContent =
    loserChamp ? formatTeamLabel(loserChamp) : "TBD";

  document.getElementById("champion-label").textContent =
    finalsState.champion ? formatTeamLabel(finalsState.champion) : "TBD";
  document.getElementById("runnerup-label").textContent =
    finalsState.runnerUp ? formatTeamLabel(finalsState.runnerUp) : "TBD";

  document.getElementById("finals-match1-result").textContent =
    finalsState.match1Winner
      ? `Match 1 Winner: ${formatTeamLabel(finalsState.match1Winner)}`
      : "";

  document.getElementById("finals-match2-result").textContent =
    finalsState.match2Winner
      ? `Match 2 Winner: ${formatTeamLabel(finalsState.match2Winner)}`
      : "";

  const visual = document.getElementById("finals-visual-bracket");
  if (visual) {
    visual.innerHTML = "";
    const matches = getFinalsVisualMatches();
    matches.forEach((fm, idx) => {
      const card = document.createElement("div");
      card.className = "finals-visual-card";
      if (fm.winner) card.classList.add("match-complete");
      if (idx === 1 && !fm.team1 && !fm.team2) card.classList.add("finals-if-needed");

      const title = document.createElement("div");
      title.className = "match-label";
      title.textContent = fm.label;
      card.appendChild(title);

      const t1 = document.createElement("div");
      t1.className = "team-line";
      t1.textContent = fm.team1 ? formatTeamLabelWithLosses(fm.team1) : (idx === 1 ? "Only if challenger wins Match 1" : "King Seat TBD");

      const t2 = document.createElement("div");
      t2.className = "team-line";
      t2.textContent = fm.team2 ? formatTeamLabelWithLosses(fm.team2) : (idx === 1 ? "Double-dip match pending" : "Loser Champion TBD");

      if (fm.winner && fm.team1 && fm.winner.id === fm.team1.id) {
        t1.classList.add("win");
        t2.classList.add("loss");
      } else if (fm.winner && fm.team2 && fm.winner.id === fm.team2.id) {
        t2.classList.add("win");
        t1.classList.add("loss");
      }

      card.appendChild(t1);
      card.appendChild(t2);

      if (fm.winner) {
        const win = document.createElement("div");
        win.className = "match-label winner-chip";
        win.textContent = `Winner: ${formatTeamLabel(fm.winner)}`;
        card.appendChild(win);
      }

      visual.appendChild(card);
    });
  }
}

// --- SVG connector lines -------------------------


function getWinnerMatchDomIndexBySource(source) {
  if (!source) return null;

  if (source.kind === "winnerMatchWinner" || source.kind === "winnerMatchLoser") {
    return { roundIndex: source.roundIndex, matchIndex: source.matchIndex };
  }

  if ((source.kind === "routeWinner" || source.kind === "routeLoser") && source.bracket === "winner") {
    for (let r = 0; r < winnersBracket.length; r++) {
      const idx = (winnersBracket[r] || []).findIndex(m => m && m.id === source.id);
      if (idx >= 0) return { roundIndex: r, matchIndex: idx };
    }
  }

  return null;
}

function getLoserMatchDomIndexBySource(source, roundsArray) {
  if (!source) return null;

  let srcMatch = null;
  if (source.kind === "loserMatchWinner") srcMatch = getLoserMatch(source.matchIndex);

  if ((source.kind === "routeWinner" || source.kind === "routeLoser") && source.bracket === "loser") {
    srcMatch = rtFindLoserMatchById(source.id);
  }

  if (!srcMatch) return null;

  for (let r = 0; r < roundsArray.length; r++) {
    const idx = (roundsArray[r] || []).indexOf(srcMatch);
    if (idx >= 0) return { roundIndex: r, matchIndex: idx };
  }

  return null;
}

function drawConnectorPath(svg, containerRect, srcBox, dstBox, stroke = "#4b5563") {
  if (!srcBox || !dstBox) return;
  const srcRect = srcBox.getBoundingClientRect();
  const dstRect = dstBox.getBoundingClientRect();

  const x1 = srcRect.right - containerRect.left;
  const y1 = srcRect.top + srcRect.height / 2 - containerRect.top;
  const x2 = dstRect.left - containerRect.left;
  const y2 = dstRect.top + dstRect.height / 2 - containerRect.top;
  const midX = x1 + Math.max(20, (x2 - x1) / 2);

  const d = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  path.setAttribute("stroke", stroke);
  path.setAttribute("stroke-width", "2");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);
}

function drawBracketLines(containerId, roundsArray) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const old = container.querySelector("svg.svg-connector-layer");
  if (old) old.remove();

  if (!roundsArray || !roundsArray.length) return;

  const width = container.scrollWidth || container.clientWidth;
  const height = container.scrollHeight || container.clientHeight;
  if (!width || !height) return;

  const containerRect = container.getBoundingClientRect();

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("svg-connector-layer");
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.position = "absolute";
  svg.style.left = "0";
  svg.style.top = "0";
  svg.style.pointerEvents = "none";
  svg.style.overflow = "visible";

  const isWinners = containerId === "winners-bracket";

  for (let dstRoundIndex = 0; dstRoundIndex < roundsArray.length; dstRoundIndex++) {
    const roundMatches = roundsArray[dstRoundIndex] || [];
    for (let dstMatchIndex = 0; dstMatchIndex < roundMatches.length; dstMatchIndex++) {
      const dstMatch = roundMatches[dstMatchIndex];
      if (!dstMatch) continue;

      const dstBox = container.querySelector(
        `.match-box[data-round="${dstRoundIndex}"][data-match-index="${dstMatchIndex}"]`
      );
      if (!dstBox) continue;

      const sources = [dstMatch.team1Source, dstMatch.team2Source].filter(Boolean);

      sources.forEach(source => {
        let srcDom = null;

        if (isWinners) {
          srcDom = getWinnerMatchDomIndexBySource(source);
        } else {
          if (source.kind === "loserMatchWinner" || ((source.kind === "routeWinner" || source.kind === "routeLoser") && source.bracket === "loser")) {
            srcDom = getLoserMatchDomIndexBySource(source, roundsArray);
          } else {
            // Winner-bracket losers feed into loser bracket from outside this container.
            // Do not draw cross-section lines here.
            srcDom = null;
          }
        }

        if (!srcDom) return;

        const srcBox = container.querySelector(
          `.match-box[data-round="${srcDom.roundIndex}"][data-match-index="${srcDom.matchIndex}"]`
        );
        if (!srcBox) return;

        drawConnectorPath(svg, containerRect, srcBox, dstBox);
      });
    }
  }

  container.appendChild(svg);
}

// --- Rankings / standings ------------------------

function getTeamRankings() {
  if (!teams.length) return [];

  const champion = finalsState.champion || null;
  const runnerUp = finalsState.runnerUp || null;
  const championId = champion ? champion.id : null;
  const runnerUpId = runnerUp ? runnerUp.id : null;

  function lossesFor(team) {
    return teamLosses[team.id] || 0;
  }

  const ranked = [];

  if (champion) {
    ranked.push({ team: champion, losses: lossesFor(champion), status: "Champion" });
  }
  if (runnerUp) {
    ranked.push({ team: runnerUp, losses: lossesFor(runnerUp), status: "Runner-up" });
  }

  const eliminatedIds = eliminationOrder.filter(id => id !== championId && id !== runnerUpId);
  const eliminatedSeen = new Set();

  for (let i = eliminatedIds.length - 1; i >= 0; i--) {
    const teamId = eliminatedIds[i];
    if (eliminatedSeen.has(teamId)) continue;
    const team = teams.find(t => t.id === teamId);
    if (!team) continue;
    eliminatedSeen.add(teamId);
    ranked.push({ team, losses: lossesFor(team), status: "Eliminated" });
  }

  const unresolved = teams.filter(t => {
    if (t.id === championId || t.id === runnerUpId) return false;
    if (eliminatedSeen.has(t.id)) return false;
    return true;
  });

  unresolved.sort((a, b) => {
    const la = lossesFor(a);
    const lb = lossesFor(b);
    if (la !== lb) return la - lb;
    return a.id - b.id;
  });

  unresolved.forEach(team => {
    const l = lossesFor(team);
    let status;
    if (l >= 2) status = "Eliminated";
    else if (l === 1) status = "In losers bracket";
    else status = "In winners bracket";
    ranked.push({ team, losses: l, status });
  });

  return ranked.map((e, idx) => ({ ...e, rank: idx + 1 }));
}

function renderStandings() {
  const panel = document.getElementById("standings-panel");
  if (!panel) return;

  if (!teams.length) {
    panel.textContent = "No teams yet.";
    return;
  }

  const champion = finalsState.champion || null;
  const runnerUp = finalsState.runnerUp || null;
  const rankings = getTeamRankings();

  let html = "";
  html += `<p><strong>Champion:</strong> ${champion ? formatTeamLabel(champion) : "TBD"}</p>`;
  html += `<p><strong>Runner-up:</strong> ${runnerUp ? formatTeamLabel(runnerUp) : "TBD"}</p>`;

  html += "<table><thead><tr><th>Rank</th><th>Team</th><th>Losses</th><th>Status</th></tr></thead><tbody>";

  rankings.forEach(e => {
    html += `<tr><td>${e.rank}</td><td>${formatTeamLabel(e.team)}</td><td>${e.losses}</td><td>${e.status}</td></tr>`;
  });

  html += "</tbody></table>";

  panel.innerHTML = html;
}

// --- Court assignments ---------------------------

function renderCourtAssignments() {
  const tbody = document.querySelector("#court-assignment-table tbody");
  const tbodyMystery = document.querySelector("#mystery-courts-table tbody");
  if (tbody) tbody.innerHTML = "";
  if (tbodyMystery) tbodyMystery.innerHTML = "";

  const active = [];

  winnersBracket.forEach((roundMatches, rIndex) => {
    roundMatches.forEach(m => {
      if (!m || !m.board || m.winner || (!m.team1 && !m.team2)) return;
      active.push({
        board: m.board,
        label: `Winners R${rIndex + 1} M${m.id}`,
        team1: m.team1,
        team2: m.team2
      });
    });
  });

  losersMatches.forEach(m => {
    if (!m || !m.board || m.winner || (!m.team1 && !m.team2)) return;
    active.push({
      board: m.board,
      label: `Losers R${m.round || 1} M${m.id}`,
      team1: m.team1,
      team2: m.team2
    });
  });

  active.sort((a, b) => a.board - b.board);

  function appendRow(tbodyTarget, row) {
    const tr = document.createElement("tr");
    const tdB = document.createElement("td");
    tdB.textContent = row.board;
    const tdM = document.createElement("td");
    tdM.textContent = row.label;
    const tdT = document.createElement("td");
    const t1 = row.team1 ? formatTeamLabel(row.team1) : "TBD";
    const t2 = row.team2 ? formatTeamLabel(row.team2) : "TBD";
    tdT.textContent = `${t1} vs ${t2}`;
    tr.appendChild(tdB);
    tr.appendChild(tdM);
    tr.appendChild(tdT);
    tbodyTarget.appendChild(tr);
  }

  active.forEach(row => {
    if (tbody) appendRow(tbody, row);
    if (tbodyMystery && showCourtsInMysteryDisplay) appendRow(tbodyMystery, row);
  });

  updateMysteryCourtsVisibility();
}

// --- Display mode & fullscreen -------------------

function toggleDisplayMode() {
  document.body.classList.toggle("display-mode");
}

function requestFullscreenElement(el) {
  if (!el) return;
  if (el.requestFullscreen) {
    el.requestFullscreen();
  } else if (el.webkitRequestFullscreen) {
    el.webkitRequestFullscreen();
  } else if (el.msRequestFullscreen) {
    el.msRequestFullscreen();
  }
}

function fullscreenMysteryOut() {
  const section = document.getElementById("mystery-out-section");
  requestFullscreenElement(section || document.documentElement);
}

function openMysteryOutDisplayTab() {
  const base = window.location.href.split("#")[0];
  const url = `${base}#mystery-display`;
  window.open(url, "_blank");
}

function enterMysteryDisplayOnlyMode() {
  document.body.classList.add("mystery-display-only");
}

// --- Mystery Out ---

function populateMysteryAndFeatSelects() {
  const mysterySelect = document.getElementById("mysteryPlayerSelect");
  const featSelect = document.getElementById("featPlayerSelect");
  const selects = [mysterySelect, featSelect].filter(Boolean);
  if (!selects.length) return;

  selects.forEach(select => {
    select.innerHTML = "";

    if (!players.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No players yet";
      select.appendChild(opt);
      select.disabled = true;
      return;
    }

    select.disabled = false;

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select player…";
    select.appendChild(placeholder);

    players.forEach(p => {
      const opt = document.createElement("option");
      opt.value = String(p.id);
      opt.textContent = formatDisplayName(p);
      select.appendChild(opt);
    });
  });
}


function openMysteryEntryEditor(outNumber) {
  const existing = mysteryOutEntries.filter(e => e.outNumber === outNumber).sort((a,b) => String(a.timestamp||'').localeCompare(String(b.timestamp||'')));
  const backdrop = document.createElement('div');
  backdrop.className = 'mystery-editor-backdrop open';
  const modal = document.createElement('div');
  modal.className = 'mystery-editor-modal';
  const title = document.createElement('h3');
  title.textContent = `Edit Mystery Out #${outNumber}`;
  modal.appendChild(title);
  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = 'You can correct the player, move an entry to a different number, add another player, or remove a mistaken entry.';
  modal.appendChild(note);
  const rowsWrap = document.createElement('div');
  modal.appendChild(rowsWrap);

  function makeRow(entry) {
    const row = document.createElement('div');
    row.className = 'mystery-editor-row';
    const playerSel = document.createElement('select');
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Select player…';
    playerSel.appendChild(blank);
    players.forEach(p => {
      const opt = document.createElement('option');
      opt.value = String(p.id);
      opt.textContent = formatDisplayName(p);
      if (entry && String(entry.playerId) === String(p.id)) opt.selected = true;
      playerSel.appendChild(opt);
    });
    const outInput = document.createElement('input');
    outInput.type = 'number';
    outInput.min = '1';
    outInput.max = '180';
    outInput.value = String(entry?.outNumber || outNumber);
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'danger';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => row.remove());
    row.appendChild(playerSel);
    row.appendChild(outInput);
    row.appendChild(removeBtn);
    row._entryId = entry?.id || null;
    rowsWrap.appendChild(row);
  }

  if (existing.length) existing.forEach(makeRow); else makeRow(null);

  const actions = document.createElement('div');
  actions.className = 'mystery-editor-actions';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = 'Add Row';
  addBtn.addEventListener('click', () => makeRow(null));
  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save Changes';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => backdrop.remove());
  actions.append(addBtn, saveBtn, cancelBtn);
  modal.appendChild(actions);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  saveBtn.addEventListener('click', () => {
    const otherEntries = mysteryOutEntries.filter(e => e.outNumber !== outNumber);
    const seen = new Set();
    const newEntries = [];
    for (const row of rowsWrap.querySelectorAll('.mystery-editor-row')) {
      const [playerSel, outInput] = row.querySelectorAll('select, input');
      const playerId = parseInt(playerSel.value, 10);
      const newOut = parseInt(outInput.value, 10);
      if (!playerId) continue;
      if (!newOut || newOut < 1 || newOut > 180 || !possibleOutMap[newOut]) {
        alert(`Out number ${outInput.value || '?'} is not a valid Master Out.`);
        return;
      }
      const key = `${playerId}-${newOut}`;
      if (seen.has(key) || otherEntries.some(e => String(e.playerId) === String(playerId) && String(e.outNumber) === String(newOut))) continue;
      seen.add(key);
      newEntries.push({
        id: row._entryId || Date.now() + Math.floor(Math.random()*100000),
        playerId,
        outNumber: newOut,
        timestamp: new Date().toISOString()
      });
    }
    mysteryOutEntries = otherEntries.concat(newEntries).sort((a,b) => a.outNumber - b.outNumber || String(a.timestamp||'').localeCompare(String(b.timestamp||'')));
    renderMysteryOutBoard();
    persistTournamentStateSilent();
    backdrop.remove();
  });
}

function handleMysteryOutAdd(e) {
  e.preventDefault();

  const playerSelect = document.getElementById("mysteryPlayerSelect");
  const outInput = document.getElementById("mysteryOutNumber");

  const playerId = parseInt(playerSelect.value, 10);
  const outNumber = parseInt(outInput.value, 10);

  if (!playerId) {
    alert("Please select a player.");
    return;
  }
  if (!outNumber || outNumber < 1 || outNumber > 180) {
    alert("Please enter a number between 1 and 180.");
    return;
  }
  if (!possibleOutMap[outNumber]) {
    alert("That number has no possible Master Out.");
    return;
  }

  const existingForNumber = mysteryOutEntries.filter(
    e2 => e2.outNumber === outNumber
  );
  const already = existingForNumber.some(e2 => e2.playerId === playerId);
  if (!already) {
    mysteryOutEntries.push({
      id: Date.now(),
      playerId,
      outNumber,
      timestamp: new Date().toISOString()
    });
  }

  playerSelect.value = "";
  outInput.value = "";

  renderMysteryOutBoard();
  persistTournamentStateSilent();
}

function renderMysteryOutBoard() {
  const bodies = [];
  for (let i = 1; i <= 6; i++) {
    const el = document.getElementById(`mystery-out-table-${i}`);
    if (!el) return;
    el.innerHTML = "";
    bodies.push(el);
  }

  const grouped = new Map();
  mysteryOutEntries.forEach(entry => {
    const key = entry.outNumber;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry);
  });

  for (let n = 1; n <= 180; n++) {
    const entries = grouped.get(n) || [];
    const isPossible = !!possibleOutMap[n];

    const tr = document.createElement("tr");
    if (mysteryTargetNumber === n) {
      tr.classList.add("mystery-target-row");
    }

    const tdNum = document.createElement("td");
    tdNum.textContent = n;

    const tdFirst = document.createElement("td");
    const tdOthers = document.createElement("td");

    if (!isPossible) {
      tdFirst.textContent = "No Out";
      tdOthers.textContent = "-";
      tdFirst.classList.add("no-out");
      tdNum.classList.add("no-out");
    } else if (!entries.length) {
      tdFirst.textContent = "";
      tdOthers.textContent = "-";

      tdFirst.classList.add("clickable");
      tdNum.classList.add("clickable");

      const handler = () => showMysteryPlayerDropdown(n, tdFirst);
      tdNum.addEventListener("click", handler);
      tdFirst.addEventListener("click", handler);
      tdOthers.classList.add("clickable");
      tdOthers.addEventListener("click", handler);
    } else {
      const first = entries[0];
      const firstPlayer = getPlayerById(first.playerId);
      tdFirst.textContent = firstPlayer
        ? formatDisplayName(firstPlayer)
        : "Unknown";

      if (entries.length > 1) {
        const span = document.createElement("span");
        span.textContent = `${entries.length - 1} more`;
        const names = entries
          .slice(1)
          .map(e => {
            const p = getPlayerById(e.playerId);
            return p ? formatDisplayName(p) : "Unknown";
          })
          .join(", ");
        span.title = names;
        span.className = "more-names";
        tdOthers.appendChild(span);
      } else {
        tdOthers.textContent = "-";
      }

      tdFirst.classList.add("clickable");
      tdNum.classList.add("clickable");

      const handler = () => openMysteryEntryEditor(n);
      tdNum.addEventListener("click", handler);
      tdFirst.addEventListener("click", handler);
      tdOthers.classList.add("clickable");
      tdOthers.addEventListener("click", handler);
    }

    tr.appendChild(tdNum);
    tr.appendChild(tdFirst);
    tr.appendChild(tdOthers);

    const colIndex = Math.floor((n - 1) / 30); // 0..5
    const targetBody = bodies[colIndex] || bodies[0];
    targetBody.appendChild(tr);
  }

  renderMysteryTargetDisplay();
}

function renderMysteryTargetDisplay() {
  const span = document.getElementById("mystery-target-display");
  const input = document.getElementById("mystery-target-number");
  if (input) {
    input.value = mysteryTargetNumber || "";
  }
  if (!span) return;
  if (mysteryTargetNumber) {
    span.textContent = `Tonight's number: ${mysteryTargetNumber}`;
  } else {
    span.textContent = "";
  }
}

function showMysteryPlayerDropdown(outNumber, cell) {
  if (!players.length) {
    alert("No players available yet.");
    return;
  }

  const existingSelect = cell.querySelector("select");
  if (existingSelect) return;

  cell.innerHTML = "";

  const select = document.createElement("select");
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select player…";
  select.appendChild(placeholder);

  players.forEach(p => {
    const opt = document.createElement("option");
    opt.value = String(p.id);
    opt.textContent = formatDisplayName(p);
    select.appendChild(opt);
  });

  select.addEventListener("change", () => {
    const playerId = parseInt(select.value, 10);
    if (!playerId) return;

    const player = getPlayerById(playerId);
    if (!player) {
      alert("Player not found.");
      return;
    }

    const existingForNumber = mysteryOutEntries.filter(
      e => e.outNumber === outNumber
    );
    const already = existingForNumber.some(e => e.playerId === playerId);
    if (!already) {
      mysteryOutEntries.push({
        id: Date.now(),
        playerId,
        outNumber,
        timestamp: new Date().toISOString()
      });
    }

    renderMysteryOutBoard();
    persistTournamentStateSilent();
  });

  cell.appendChild(select);
  select.focus();
}

// --- Big Hits (Special Shots) ---

function handleAddSpecialShot(e) {
  e.preventDefault();

  const playerSelect = document.getElementById("featPlayerSelect");
  const typeSelect = document.getElementById("featTypeSelect");

  if (!playerSelect || !typeSelect) return;

  const playerId = parseInt(playerSelect.value, 10);
  const shotType = typeSelect.value;

  if (!playerId) {
    alert("Please select a player.");
    return;
  }
  if (!shotType) {
    alert("Please select a Big Hit type.");
    return;
  }

  specialShots.push({
    id: Date.now(),
    playerId,
    type: shotType,
    timestamp: new Date().toISOString()
  });

  playerSelect.value = "";
  typeSelect.value = "";

  renderSpecialShots();
  persistTournamentStateSilent();
}

function renderSpecialShots() {
  const container = document.getElementById("special-shots-list");
  if (!container) return;

  container.innerHTML = "";

  if (!specialShots.length) {
    container.textContent = "No Big Hits recorded yet.";
    return;
  }

  const ul = document.createElement("ul");
  specialShots.forEach(shot => {
    const p = getPlayerById(shot.playerId);
    const li = document.createElement("li");
    li.textContent = `${shot.type}: ${p ? formatDisplayName(p) : "Unknown"}`;
    ul.appendChild(li);
  });
  container.appendChild(ul);
}

// --- Payouts -------------------------------------

function handleCalculatePayouts() {
  const buyIn = parseFloat(document.getElementById("buy-in").value || "10");
  if (!buyIn || buyIn <= 0) {
    alert("Enter a valid buy-in per player.");
    return;
  }

  const totalPlayers = players.length;
  const playerPot = buyIn * totalPlayers;
  const moPerPlayer = parseFloat(document.getElementById("mo-per-player").value || "2");
  if (moPerPlayer < 0) {
    alert("Mystery Out per player cannot be negative.");
    return;
  }
  if (moPerPlayer > buyIn) {
    alert("Mystery Out per player cannot be greater than the buy-in per player.");
    return;
  }

  const barMatchPot = !!document.getElementById("bar-match-pot")?.checked;
  const moBarMatch = !!document.getElementById("mo-bar-match")?.checked;
  const barPotMatchAmount = barMatchPot ? playerPot : 0;
  const totalPot = playerPot + barPotMatchAmount;

  document.getElementById("player-pot").textContent = `$${playerPot.toFixed(2)}`;
  document.getElementById("bar-pot-match-amount").textContent = `$${barPotMatchAmount.toFixed(2)}`;
  document.getElementById("total-pot").textContent = `$${totalPot.toFixed(2)}`;

  const femaleCount = players.filter(p => p.gender === "F").length;
  const threshold = parseInt(document.getElementById("honey-pot-threshold").value || "3", 10);
  const honeyActive = femaleCount >= threshold;
  const honeyAmount = honeyActive ? 20 : 0;
  document.getElementById("honey-pot-amount").textContent = honeyActive ? `$${honeyAmount.toFixed(2)} (active)` : "$0.00 (inactive)";

  const moOverride = parseFloat(document.getElementById("mo-total-override")?.value || "0");
  const moBaseAmount = moOverride > 0 ? moOverride : (moPerPlayer * totalPlayers);
  const moMatchAmount = moBarMatch ? moBaseAmount : 0;
  const moAmount = moBaseAmount + moMatchAmount;

  document.getElementById("mo-base-amount").textContent = `$${moBaseAmount.toFixed(2)}`;
  document.getElementById("mo-match-amount").textContent = `$${moMatchAmount.toFixed(2)}`;
  document.getElementById("mo-amount").textContent = `$${moAmount.toFixed(2)}`;

  const prizePool = Math.max(0, totalPot - honeyAmount - moAmount);
  document.getElementById("tournament-prize-pool").textContent = `$${prizePool.toFixed(2)}`;

  const firstPercent = parseFloat(document.getElementById("first-percent").value || "50");
  const secondPercent = parseFloat(document.getElementById("second-percent").value || "30");
  const thirdPercent = parseFloat(document.getElementById("third-percent").value || "20");
  const fourthPercent = parseFloat(document.getElementById("fourth-percent").value || "0");
  const fifthPercent = parseFloat(document.getElementById("fifth-percent").value || "0");
  const sixthPercent = parseFloat(document.getElementById("sixth-percent").value || "0");
  const teamOutPercentRaw = parseFloat(document.getElementById("teamout-percent").value || "0");
  const teamOutActive = document.getElementById("teamout-active").checked;
  const teamOutPercent = teamOutActive ? teamOutPercentRaw : 0;

  const firstOverride = parseFloat(document.getElementById("first-amount-input").value || "0");
  const secondOverride = parseFloat(document.getElementById("second-amount-input").value || "0");
  const thirdOverride = parseFloat(document.getElementById("third-amount-input").value || "0");
  const fourthOverride = parseFloat(document.getElementById("fourth-amount-input").value || "0");
  const fifthOverride = parseFloat(document.getElementById("fifth-amount-input").value || "0");
  const sixthOverride = parseFloat(document.getElementById("sixth-amount-input").value || "0");
  const teamOutOverride = parseFloat(document.getElementById("teamout-amount-input").value || "0");

  function pctAmount(pct) { return prizePool * (pct / 100); }
  const amounts = {
    first: firstOverride > 0 ? firstOverride : pctAmount(firstPercent),
    second: secondOverride > 0 ? secondOverride : pctAmount(secondPercent),
    third: thirdOverride > 0 ? thirdOverride : pctAmount(thirdPercent),
    fourth: fourthOverride > 0 ? fourthOverride : pctAmount(fourthPercent),
    fifth: fifthOverride > 0 ? fifthOverride : pctAmount(fifthPercent),
    sixth: sixthOverride > 0 ? sixthOverride : pctAmount(sixthPercent),
    teamout: teamOutActive ? (teamOutOverride > 0 ? teamOutOverride : pctAmount(teamOutPercent)) : 0
  };

  ["first","second","third","fourth","fifth","sixth","teamout"].forEach(key => {
    const el = document.getElementById(`${key}-amount`);
    if (el) el.textContent = `$${amounts[key].toFixed(2)}`;
  });

  const rankings = getTeamRankings();
  const ids = ["champion","second","third","fourth","fifth","sixth"];
  ids.forEach((slot, idx) => {
    const entry = rankings[idx];
    const targetId = idx === 0 ? 'payout-champion' : `payout-${slot}`;
    const el = document.getElementById(targetId);
    if (el) el.textContent = entry ? formatTeamLabel(entry.team) : 'TBD';
  });
  const teamOutEl = document.getElementById('payout-teamout');
  if (teamOutEl) teamOutEl.textContent = teamOutActive ? 'Active' : 'Not active';

  const fixedUsed = [firstOverride, secondOverride, thirdOverride, fourthOverride, fifthOverride, sixthOverride, teamOutOverride, moOverride].some(v => v > 0);
  const info = document.getElementById('payouts-info');
  if (info) info.textContent = fixedUsed ? 'Some payouts use fixed override amounts.' : 'Payouts calculated from the current prize pool and percentage split.';
}

function handleSuggestedPayouts() {
  const buyIn = parseFloat(document.getElementById("buy-in").value || "10");
  const totalPlayers = players.length;
  if (!buyIn || !totalPlayers) {
    alert('Add players and a buy-in first.');
    return;
  }
  handleCalculatePayouts();
  const prizePool = parseFloat((document.getElementById('tournament-prize-pool').textContent || '$0').replace(/[^0-9.]/g,'')) || 0;
  const moTotal = parseFloat((document.getElementById('mo-amount').textContent || '$0').replace(/[^0-9.]/g,'')) || 0;
  const firstPct = parseFloat(document.getElementById('first-percent').value || '50')/100;
  const secondPct = parseFloat(document.getElementById('second-percent').value || '30')/100;
  const thirdPct = parseFloat(document.getElementById('third-percent').value || '20')/100;
  let first = Math.floor((prizePool * firstPct) / 2) * 2;
  let second = Math.floor((prizePool * secondPct) / 2) * 2;
  let third = Math.floor((prizePool * thirdPct) / 2) * 2;
  let used = first + second + third;
  let remainder = Math.max(0, Math.round(prizePool - used));
  while (remainder >= 2) {
    if (first <= second && first <= third) first += 2;
    else if (second <= third) second += 2;
    else third += 2;
    remainder -= 2;
  }
  // If odd dollar remains, push to mystery out override for an easier split.
  if (remainder === 1) {
    const currentMoOverride = parseFloat(document.getElementById('mo-total-override').value || '0') || moTotal;
    document.getElementById('mo-total-override').value = (currentMoOverride + 1).toFixed(2);
  }
  document.getElementById('first-amount-input').value = first.toFixed(2);
  document.getElementById('second-amount-input').value = second.toFixed(2);
  document.getElementById('third-amount-input').value = third.toFixed(2);
  handleCalculatePayouts();
  const info = document.getElementById('payouts-info');
  if (info) info.textContent = 'Suggested Even Payouts applied. Any odd remainder was shifted into the Mystery Out override.';
}


function collectPayoutSettings() {
  return {
    buyIn: document.getElementById("buy-in")?.value || "",
    honeyPotThreshold: document.getElementById("honey-pot-threshold")?.value || "4",
    moPerPlayer: document.getElementById("mo-per-player")?.value || "2",
    moTotalOverride: document.getElementById("mo-total-override")?.value || "",
    barMatchPot: !!document.getElementById("bar-match-pot")?.checked,
    moBarMatch: !!document.getElementById("mo-bar-match")?.checked,
    firstPercent: document.getElementById("first-percent")?.value || "50",
    secondPercent: document.getElementById("second-percent")?.value || "30",
    thirdPercent: document.getElementById("third-percent")?.value || "20",
    fourthPercent: document.getElementById("fourth-percent")?.value || "0",
    fifthPercent: document.getElementById("fifth-percent")?.value || "0",
    sixthPercent: document.getElementById("sixth-percent")?.value || "0",
    teamoutPercent: document.getElementById("teamout-percent")?.value || "0",
    firstAmountInput: document.getElementById("first-amount-input")?.value || "",
    secondAmountInput: document.getElementById("second-amount-input")?.value || "",
    thirdAmountInput: document.getElementById("third-amount-input")?.value || "",
    fourthAmountInput: document.getElementById("fourth-amount-input")?.value || "",
    fifthAmountInput: document.getElementById("fifth-amount-input")?.value || "",
    sixthAmountInput: document.getElementById("sixth-amount-input")?.value || "",
    teamoutAmountInput: document.getElementById("teamout-amount-input")?.value || "",
    teamoutActive: !!document.getElementById("teamout-active")?.checked
  };
}

function applyPayoutSettings(settings) {
  const s = settings || {};
  const setValue = (id, value, fallback = "") => {
    const el = document.getElementById(id);
    if (el) el.value = value != null && value !== "" ? value : fallback;
  };
  const setChecked = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.checked = !!value;
  };

  setValue("buy-in", s.buyIn, "10");
  setValue("honey-pot-threshold", s.honeyPotThreshold, "3");
  setValue("mo-per-player", s.moPerPlayer, "2");
  setValue("mo-total-override", s.moTotalOverride, "");
  setChecked("bar-match-pot", s.barMatchPot);
  setChecked("mo-bar-match", s.moBarMatch);
  setValue("first-percent", s.firstPercent, "50");
  setValue("second-percent", s.secondPercent, "30");
  setValue("third-percent", s.thirdPercent, "20");
  setValue("fourth-percent", s.fourthPercent, "0");
  setValue("fifth-percent", s.fifthPercent, "0");
  setValue("sixth-percent", s.sixthPercent, "0");
  setValue("teamout-percent", s.teamoutPercent, "0");
  setValue("first-amount-input", s.firstAmountInput, "");
  setValue("second-amount-input", s.secondAmountInput, "");
  setValue("third-amount-input", s.thirdAmountInput, "");
  setValue("fourth-amount-input", s.fourthAmountInput, "");
  setValue("fifth-amount-input", s.fifthAmountInput, "");
  setValue("sixth-amount-input", s.sixthAmountInput, "");
  setValue("teamout-amount-input", s.teamoutAmountInput, "");
  setChecked("teamout-active", s.teamoutActive);
}

// --- Save / Load tournament + cross-tab sync -----

function collectTournamentState() {
  return {
    players,
    teams,
    matches,
    winnersBracket,
    losersMatches,
    losersWaitingQueue,
    teamLosses,
    eliminationOrder,
    finalsState,
    mysteryOutEntries,
    specialShots,
    tournamentLocked,
    tournamentMeta,
    showCourtsInMysteryDisplay,
    mysteryTargetNumber,
    showMysteryOthers,
    payoutSettings: collectPayoutSettings()
  };
}

function applyTournamentState(state) {
  players = (state.players || []).map(p => {
    if (!p.persistentId) {
      const db = getDbEntryForPlayer(p);
      p.persistentId = db?.persistentId || generatePersistentPlayerId();
    }
    addPlayerToDatabase(p);
    return p;
  });
  teams = state.teams || [];
  matches = state.matches || [];
  winnersBracket = state.winnersBracket || [];
  losersMatches = state.losersMatches || [];
  losersWaitingQueue = state.losersWaitingQueue || [];
  teamLosses = state.teamLosses || {};
  eliminationOrder = state.eliminationOrder || [];
  finalsState =
    state.finalsState || {
      match1Winner: null,
      match2Winner: null,
      champion: null,
      runnerUp: null
    };
  mysteryOutEntries = state.mysteryOutEntries || [];
  specialShots = state.specialShots || [];
  tournamentLocked = !!state.tournamentLocked;
  tournamentMeta = state.tournamentMeta || { date: "", time: "", location: "" };
  showCourtsInMysteryDisplay = !!state.showCourtsInMysteryDisplay;
  mysteryTargetNumber =
    typeof state.mysteryTargetNumber === "number"
      ? state.mysteryTargetNumber
      : null;
  if (typeof state.showMysteryOthers === "boolean") {
    showMysteryOthers = state.showMysteryOthers;
  } else {
    showMysteryOthers = true;
  }
  applyPayoutSettings(state.payoutSettings || {});
}

// silent persistence, no alerts (used on every change)
function persistTournamentStateSilent() {
  try {
    const state = collectTournamentState();
    localStorage.setItem(TOURNAMENT_STATE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Failed to persist tournament state", e);
  }
}

// helper for display tab to auto-load once from storage
function autoSyncFromStorageOnce() {
  const data = localStorage.getItem(TOURNAMENT_STATE_KEY);
  if (!data) return;
  try {
    const state = JSON.parse(data);
    applyTournamentState(state);
    rerenderAll();
  } catch (e) {
    console.error("Failed to auto-load tournament state for display tab", e);
  }
}

function saveTournamentState() {
  try {
    persistTournamentStateSilent();
    // Also update player stats DB from this tournament
    updatePlayerStatsFromCurrentTournament();
    alert("Tournament saved and stats updated in this browser.");
  } catch (e) {
    console.error(e);
    alert("Failed to save tournament.");
  }
}

function loadTournamentState() {
  const data = localStorage.getItem(TOURNAMENT_STATE_KEY);
  if (!data) {
    alert("No saved tournament found.");
    return;
  }
  try {
    const state = JSON.parse(data);
    applyTournamentState(state);
    rerenderAll();
    alert("Tournament loaded.");
  } catch (e) {
    console.error(e);
    alert("Failed to load tournament.");
  }
}

// --- Player Stats (accumulation) -----------------

function updatePlayerStatsFromCurrentTournament() {
  if (!players.length) return;

  const loc = tournamentMeta.location || "Unknown";

  players.forEach(pl => {
    let db = getDbEntryForPlayer(pl);
    if (!db) {
      db = {
        persistentId: pl.persistentId || generatePersistentPlayerId(),
        firstName: pl.firstName,
        lastName: pl.lastName,
        nickname: pl.nickname,
        gender: pl.gender,
        paid: false,
        stats: createEmptyStats()
      };
      playerDatabase.push(db);
    } else if (!db.stats) {
      db.stats = createEmptyStats();
    }
  });

  const touched = new Set();
  players.forEach(pl => {
    const key = getPlayerStableId(pl);
    if (!touched.has(key)) {
      const db = getDbEntryForPlayer(pl);
      if (db && db.stats) {
        db.stats.tournaments += 1;
        if (!db.stats.locations) db.stats.locations = {};
        db.stats.locations[loc] = (db.stats.locations[loc] || 0) + 1;
      }
      touched.add(key);
    }
  });

  const record = (team1, team2, winner) => {
    if (!team1 || !team2 || !winner) return;
    const loser = winner.id === team1.id ? team2 : team1;
    const all = getPlayersFromTeam(team1).concat(getPlayersFromTeam(team2));
    const winners = getPlayersFromTeam(winner);
    const losers = getPlayersFromTeam(loser);

    all.forEach(pl => {
      const db = getDbEntryForPlayer(pl);
      if (!db || !db.stats) return;
      db.stats.games += 1;
    });
    winners.forEach(pl => {
      const db = getDbEntryForPlayer(pl);
      if (!db || !db.stats) return;
      db.stats.wins += 1;
    });
    losers.forEach(pl => {
      const db = getDbEntryForPlayer(pl);
      if (!db || !db.stats) return;
      db.stats.losses += 1;
    });
  };

  winnersBracket.forEach(round => round.forEach(m => record(m.team1, m.team2, m.winner)));
  losersMatches.forEach(m => record(m.team1, m.team2, m.winner));

  const king = getKingSeatTeam();
  const challenger = getLosersChampionTeam();
  if (king && challenger && finalsState.match1Winner) {
    record(king, challenger, finalsState.match1Winner);
  }
  if (king && challenger && finalsState.match2Winner) {
    record(king, challenger, finalsState.match2Winner);
  }

  // Partners count once per tournament, not once per game.
  teams.forEach(team => {
    const pair = getPlayersFromTeam(team);
    if (pair.length < 2) return;
    const [a, b] = pair;
    const dbA = getDbEntryForPlayer(a);
    const dbB = getDbEntryForPlayer(b);
    if (dbA && dbA.stats) {
      if (!dbA.stats.partners) dbA.stats.partners = {};
      dbA.stats.partners[formatDisplayName(b)] = (dbA.stats.partners[formatDisplayName(b)] || 0) + 1;
    }
    if (dbB && dbB.stats) {
      if (!dbB.stats.partners) dbB.stats.partners = {};
      dbB.stats.partners[formatDisplayName(a)] = (dbB.stats.partners[formatDisplayName(a)] || 0) + 1;
    }
  });

  mysteryOutEntries.forEach(entry => {
    const pl = players.find(p => p.id === entry.playerId || getPlayerStableId(p) === String(entry.playerId));
    if (!pl) return;
    const db = getDbEntryForPlayer(pl);
    if (!db || !db.stats) return;
    if (!db.stats.mysteryOuts) db.stats.mysteryOuts = {};
    const key = String(entry.outNumber || entry.number);
    db.stats.mysteryOuts[key] = (db.stats.mysteryOuts[key] || 0) + 1;
  });

  savePlayerDatabase();
  if (typeof populateStatsPlayerSelect === "function") populateStatsPlayerSelect();
  if (typeof populatePlayerStatsSelect === "function") populatePlayerStatsSelect();
  if (typeof renderPlayerStats === "function") renderPlayerStats();
}

// --- Player Stats UI -----------------------------

function populateStatsPlayerSelect() {
  const sel = document.getElementById("statsPlayerSelect");
  const panel = document.getElementById("player-stats-display");
  if (!sel) return;

  sel.innerHTML = "";
  if (!playerDatabase.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No saved players yet";
    sel.appendChild(opt);
    sel.disabled = true;
    if (panel) panel.textContent = "No stats yet.";
    return;
  }

  sel.disabled = false;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a player…";
  sel.appendChild(placeholder);

  playerDatabase.forEach((p, index) => {
    const opt = document.createElement("option");
    opt.value = String(index);
    opt.textContent = formatDisplayName(p);
    sel.appendChild(opt);
  });

  // Optional: auto-select first real player
  if (playerDatabase.length > 0) {
    sel.value = "0";
    renderPlayerStats();
  }
}

function renderPlayerStats() {
  const sel = document.getElementById("statsPlayerSelect");
  const panel = document.getElementById("player-stats-display");
  if (!sel || !panel) return;

  const idx = parseInt(sel.value, 10);
  if (isNaN(idx) || !playerDatabase[idx]) {
    panel.textContent = "No stats yet.";
    return;
  }

  const p = playerDatabase[idx];
  const s = p.stats || createEmptyStats();
  const totalGames = s.games || 0;
  const winPct = totalGames ? ((s.wins / totalGames) * 100).toFixed(1) : "0.0";

  let html = "";
  html += `<h3>${formatDisplayName(p)}</h3>`;
  html += `<p><strong>Tournaments:</strong> ${s.tournaments}</p>`;
  html += `<p><strong>Games:</strong> ${totalGames} (W: ${s.wins}, L: ${s.losses}, Win%: ${winPct}%)</p>`;

  const locKeys = Object.keys(s.locations || {});
  if (locKeys.length) {
    html += "<p><strong>Locations played:</strong></p><ul>";
    locKeys.forEach(loc => {
      html += `<li>${loc}: ${s.locations[loc]} game(s)</li>`;
    });
    html += "</ul>";
  } else {
    html += "<p><strong>Locations played:</strong> None recorded yet.</p>";
  }

  const partnerKeys = Object.keys(s.partners || {});
  if (partnerKeys.length) {
    html += "<p><strong>Partners:</strong></p><ul>";
    partnerKeys.forEach(name => {
      html += `<li>${name}: ${s.partners[name]} time(s)</li>`;
    });
    html += "</ul>";
  } else {
    html += "<p><strong>Partners:</strong> None recorded yet.</p>";
  }

  const moKeys = Object.keys(s.mysteryOuts || {});
  if (moKeys.length) {
    html += "<p><strong>Mystery Out hits (by number):</strong></p><ul>";
    moKeys.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    moKeys.forEach(num => {
      html += `<li>#${num}: ${s.mysteryOuts[num]} time(s)</li>`;
    });
    html += "</ul>";
  } else {
    html += "<p><strong>Mystery Out hits:</strong> None recorded yet.</p>";
  }

  panel.innerHTML = html;
}



function getSelectedPlayerDbEntry() {
  const sel = document.getElementById("statsPlayerSelect");
  if (!sel) return null;
  const idx = parseInt(sel.value, 10);
  if (isNaN(idx) || !playerDatabase[idx]) return null;
  return { entry: playerDatabase[idx], index: idx };
}

function editSelectedPlayerStats() {
  const selected = getSelectedPlayerDbEntry();
  if (!selected) {
    alert("Select a player first.");
    return;
  }
  const p = selected.entry;
  const s = p.stats || createEmptyStats();

  const tournaments = prompt(`Edit tournaments for ${formatDisplayName(p)}:`, String(s.tournaments || 0));
  if (tournaments === null) return;
  const games = prompt(`Edit games for ${formatDisplayName(p)}:`, String(s.games || 0));
  if (games === null) return;
  const wins = prompt(`Edit wins for ${formatDisplayName(p)}:`, String(s.wins || 0));
  if (wins === null) return;
  const losses = prompt(`Edit losses for ${formatDisplayName(p)}:`, String(s.losses || 0));
  if (losses === null) return;

  function toNonNegInt(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  p.stats = {
    tournaments: toNonNegInt(tournaments, s.tournaments || 0),
    games: toNonNegInt(games, s.games || 0),
    wins: toNonNegInt(wins, s.wins || 0),
    losses: toNonNegInt(losses, s.losses || 0),
    locations: s.locations || {},
    partners: s.partners || {},
    mysteryOuts: s.mysteryOuts || {}
  };

  savePlayerDatabase();
  populateStatsPlayerSelect();
  const sel = document.getElementById("statsPlayerSelect");
  if (sel) sel.value = String(selected.index);
  renderPlayerStats();
  alert(`Updated stats for ${formatDisplayName(p)}.`);
}

function clearSelectedPlayerStats() {
  const selected = getSelectedPlayerDbEntry();
  if (!selected) {
    alert("Select a player first.");
    return;
  }
  const p = selected.entry;
  if (!confirm(`Clear all saved stats for ${formatDisplayName(p)}?`)) return;
  p.stats = createEmptyStats();
  savePlayerDatabase();
  populateStatsPlayerSelect();
  const sel = document.getElementById("statsPlayerSelect");
  if (sel) sel.value = String(selected.index);
  renderPlayerStats();
  alert(`Cleared stats for ${formatDisplayName(p)}.`);
}

// --- Weekly series (Hot Dog Shop) ----------------

function getWeeklySeriesDates() {
  const out = [];
  const current = new Date("2026-04-08T00:00:00");
  const end = new Date("2026-07-01T00:00:00");
  let weekNumber = 1;
  while (current <= end) {
    const iso = current.toISOString().slice(0, 10);
    out.push({ key: iso, label: `Week ${weekNumber} – ${iso}` });
    current.setDate(current.getDate() + 7);
    weekNumber += 1;
  }
  return out;
}

function loadWeeklySeriesState() {
  const raw = localStorage.getItem(WEEKLY_SERIES_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    weeklySeriesState = {
      weeks: parsed.weeks || {},
      wildcardDraw: Array.isArray(parsed.wildcardDraw) ? parsed.wildcardDraw : [],
      qualifierBracket: parsed.qualifierBracket || null
    };
  } catch (err) {
    console.error("Failed to load weekly series state", err);
  }
}

function saveWeeklySeriesState() {
  try {
    localStorage.setItem(WEEKLY_SERIES_KEY, JSON.stringify(weeklySeriesState));
  } catch (err) {
    console.error("Failed to save weekly series state", err);
  }
}

function initWeeklySeriesWeekSelect() {
  const sel = document.getElementById("series-week-select");
  if (!sel) return;
  const currentValue = sel.value;
  sel.innerHTML = "";
  const dates = getWeeklySeriesDates();
  dates.forEach((entry, idx) => {
    const opt = document.createElement("option");
    opt.value = entry.key;
    opt.textContent = entry.label;
    sel.appendChild(opt);
    if (idx === 0 && !currentValue) {
      sel.value = entry.key;
    }
  });
  if (currentValue && dates.some(d => d.key === currentValue)) {
    sel.value = currentValue;
  }
}


function normalizeStatsObject(stats) {
  const s = stats || {};
  return {
    tournaments: Math.max(0, parseInt(s.tournaments || 0, 10) || 0),
    games: Math.max(0, parseInt(s.games || 0, 10) || 0),
    wins: Math.max(0, parseInt(s.wins || 0, 10) || 0),
    losses: Math.max(0, parseInt(s.losses || 0, 10) || 0),
    locations: s.locations && typeof s.locations === "object" ? s.locations : {},
    partners: s.partners && typeof s.partners === "object" ? s.partners : {},
    mysteryOuts: s.mysteryOuts && typeof s.mysteryOuts === "object" ? s.mysteryOuts : {}
  };
}

function mergeStatsObjects(targetStats, sourceStats) {
  const a = normalizeStatsObject(targetStats);
  const b = normalizeStatsObject(sourceStats);

  a.tournaments += b.tournaments;
  a.games += b.games;
  a.wins += b.wins;
  a.losses += b.losses;

  function addMap(target, source) {
    Object.entries(source || {}).forEach(([key, value]) => {
      const n = parseInt(value || 0, 10) || 0;
      target[key] = (parseInt(target[key] || 0, 10) || 0) + n;
    });
  }

  addMap(a.locations, b.locations);
  addMap(a.partners, b.partners);
  addMap(a.mysteryOuts, b.mysteryOuts);

  return a;
}

function getManagePlayerSelectedIndex() {
  const sel = document.getElementById("managePlayerSelect");
  if (!sel) return -1;
  const idx = parseInt(sel.value, 10);
  return Number.isFinite(idx) ? idx : -1;
}

function refreshManagePlayerDbSelectors() {
  const selects = [
    document.getElementById("managePlayerSelect"),
    document.getElementById("mergeTargetPlayerSelect"),
    document.getElementById("mergeSourcePlayerSelect")
  ].filter(Boolean);

  const sorted = playerDatabase
    .map((p, index) => ({ p, index }))
    .sort((a, b) => formatDisplayName(a.p).localeCompare(formatDisplayName(b.p)));

  selects.forEach(sel => {
    const oldVal = String(sel.value || "");
    sel.innerHTML = "";

    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "-- select player --";
    sel.appendChild(empty);

    sorted.forEach(({ p, index }) => {
      const opt = document.createElement("option");
      opt.value = String(index);
      opt.textContent = `${formatDisplayName(p)}${p.persistentId ? " • " + String(p.persistentId).slice(-6) : ""}`;
      sel.appendChild(opt);
    });

    if (oldVal && Array.from(sel.options).some(opt => String(opt.value) === oldVal)) {
      sel.value = oldVal;
    }
  });

  populatePlayerDbSelect();
  populateStatsPlayerSelect();
}

function parseJsonMapField(id, fallback) {
  const el = document.getElementById(id);
  const raw = String(el?.value || "").trim();
  if (!raw) return fallback || {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Must be a JSON object");
    return parsed;
  } catch (err) {
    throw new Error(`${id} must be valid JSON object. ${err.message}`);
  }
}

function populateManagePlayerFields() {
  const idx = getManagePlayerSelectedIndex();
  const status = document.getElementById("manage-player-db-status");
  const p = playerDatabase[idx];

  const ids = ["manageFirstName", "manageLastName", "manageNickname", "manageGender", "manageTournaments", "manageGames", "manageWins", "manageLosses", "manageLocations", "managePartners", "manageMysteryOuts"];
  if (!p) {
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    if (status) status.textContent = "Select a player to edit.";
    return;
  }

  const s = normalizeStatsObject(p.stats);
  document.getElementById("manageFirstName").value = p.firstName || "";
  document.getElementById("manageLastName").value = p.lastName || "";
  document.getElementById("manageNickname").value = p.nickname || "";
  document.getElementById("manageGender").value = p.gender || "";
  document.getElementById("manageTournaments").value = s.tournaments;
  document.getElementById("manageGames").value = s.games;
  document.getElementById("manageWins").value = s.wins;
  document.getElementById("manageLosses").value = s.losses;
  document.getElementById("manageLocations").value = JSON.stringify(s.locations || {}, null, 2);
  document.getElementById("managePartners").value = JSON.stringify(s.partners || {}, null, 2);
  document.getElementById("manageMysteryOuts").value = JSON.stringify(s.mysteryOuts || {}, null, 2);

  if (status) {
    status.innerHTML = `
      <strong>${formatDisplayName(p)}</strong><br>
      ID: ${p.persistentId || "(missing)"}<br>
      Tournaments: ${s.tournaments}, Games: ${s.games}, Wins: ${s.wins}, Losses: ${s.losses}
    `;
  }
}

function saveManagePlayerFieldsLocal() {
  const idx = getManagePlayerSelectedIndex();
  const p = playerDatabase[idx];
  if (!p) {
    alert("Select a player first.");
    return false;
  }

  try {
    p.persistentId = p.persistentId || generatePersistentPlayerId();
    p.firstName = String(document.getElementById("manageFirstName").value || "").trim();
    p.lastName = String(document.getElementById("manageLastName").value || "").trim();
    p.nickname = String(document.getElementById("manageNickname").value || "").trim();
    p.gender = String(document.getElementById("manageGender").value || "").trim();
    p.stats = {
      tournaments: Math.max(0, parseInt(document.getElementById("manageTournaments").value || 0, 10) || 0),
      games: Math.max(0, parseInt(document.getElementById("manageGames").value || 0, 10) || 0),
      wins: Math.max(0, parseInt(document.getElementById("manageWins").value || 0, 10) || 0),
      losses: Math.max(0, parseInt(document.getElementById("manageLosses").value || 0, 10) || 0),
      locations: parseJsonMapField("manageLocations", {}),
      partners: parseJsonMapField("managePartners", {}),
      mysteryOuts: parseJsonMapField("manageMysteryOuts", {})
    };

    savePlayerDatabase();
    refreshManagePlayerDbSelectors();

    const sel = document.getElementById("managePlayerSelect");
    if (sel) sel.value = String(idx);
    populateManagePlayerFields();
    renderPlayers();
    renderPlayerStats();

    alert(`Saved local changes for ${formatDisplayName(p)}.`);
    return true;
  } catch (err) {
    alert(err.message || "Failed to save player.");
    return false;
  }
}

async function savePlayerDatabaseToFirebaseManaged() {
  const db = requireFirebaseDb();
  playerDatabase.forEach(p => {
    p.persistentId = p.persistentId || generatePersistentPlayerId();
    p.stats = normalizeStatsObject(p.stats);
  });

  const payload = {
    playerDatabase: { items: playerDatabase },
    players: playerDatabase,
    items: playerDatabase,
    byId: Object.fromEntries(playerDatabase.map(p => [String(p.persistentId), p])),
    savedAt: new Date().toISOString(),
    schemaVersion: 2
  };

  await db.collection("appState").doc("playerDatabase").set(encodeForFirestore(payload), { merge: true });
  await db.collection("appState").doc("currentTournament").set(encodeForFirestore({
    playerDatabase: { items: playerDatabase },
    savedAt: new Date().toISOString()
  }), { merge: true });
}

async function handleManagedSavePlayerDbFirebase() {
  try {
    updateFirebaseStatus("working", "Saving Player DB to Firebase...");
    await savePlayerDatabaseToFirebaseManaged();
    updateFirebaseStatus("connected", `Firebase connected: ${getStoredFirebaseConfig().projectId}`);
    alert(`Saved ${playerDatabase.length} players to Firebase.`);
  } catch (err) {
    console.error(err);
    updateFirebaseStatus("missing", err.message || "Player DB Firebase save failed");
    alert(err.message || "Failed to save Player DB to Firebase.");
  }
}

function deleteManagedPlayer() {
  const idx = getManagePlayerSelectedIndex();
  const p = playerDatabase[idx];
  if (!p) {
    alert("Select a player first.");
    return;
  }

  if (!confirm(`Delete ${formatDisplayName(p)} from the saved Player DB? This does not remove historical weekly-series references.`)) return;

  playerDatabase.splice(idx, 1);
  savePlayerDatabase();
  refreshManagePlayerDbSelectors();
  populateManagePlayerFields();
  renderPlayers();
  renderPlayerStats();
  alert("Player deleted locally. Click Save Player DB to Firebase to persist.");
}

function remapPlayerIdEverywhere(sourceId, targetId) {
  const src = String(sourceId || "");
  const tgt = String(targetId || "");
  if (!src || !tgt || src === tgt) return;

  function mapId(id) {
    return String(id || "") === src ? tgt : String(id || "");
  }

  players.forEach(p => {
    if (String(p.persistentId || p.id) === src) p.persistentId = tgt;
  });

  Object.values(weeklySeriesState?.weeks || {}).forEach(week => {
    if (!week) return;
    [1,2,3,4].forEach(place => {
      const rawVal = week.placements?.[place];
      const arr = Array.isArray(rawVal) ? rawVal : (rawVal ? [rawVal] : []);
      week.placements[place] = Array.from(new Set(arr.map(mapId).filter(Boolean)));
    });
    week.others = Array.from(new Set((week.others || []).map(mapId).filter(Boolean)));
  });

  Object.keys(seriesPlayerDirectory || {}).forEach(key => {
    if (String(key) === src) delete seriesPlayerDirectory[key];
  });
}

function mergeManagedPlayers() {
  const targetIdx = parseInt(document.getElementById("mergeTargetPlayerSelect")?.value || "", 10);
  const sourceIdx = parseInt(document.getElementById("mergeSourcePlayerSelect")?.value || "", 10);
  if (!Number.isFinite(targetIdx) || !Number.isFinite(sourceIdx) || !playerDatabase[targetIdx] || !playerDatabase[sourceIdx]) {
    alert("Select both target and source players.");
    return;
  }
  if (targetIdx === sourceIdx) {
    alert("Target and source cannot be the same player.");
    return;
  }

  const target = playerDatabase[targetIdx];
  const source = playerDatabase[sourceIdx];

  if (!confirm(`Merge ${formatDisplayName(source)} INTO ${formatDisplayName(target)}? Source will be removed.`)) return;

  target.persistentId = target.persistentId || generatePersistentPlayerId();
  source.persistentId = source.persistentId || generatePersistentPlayerId();
  target.stats = mergeStatsObjects(target.stats, source.stats);

  // Preserve missing name/gender fields from source if target is blank.
  ["firstName", "lastName", "nickname", "gender"].forEach(k => {
    if (!target[k] && source[k]) target[k] = source[k];
  });

  remapPlayerIdEverywhere(source.persistentId, target.persistentId);

  playerDatabase.splice(sourceIdx, 1);
  savePlayerDatabase();
  saveWeeklySeriesState();

  refreshManagePlayerDbSelectors();
  populateManagePlayerFields();
  renderPlayers();
  renderPlayerStats();
  renderWeeklySeriesDashboard();

  alert(`Merged ${formatDisplayName(source)} into ${formatDisplayName(target)} locally. Save Player DB and Weekly Series to Firebase to persist.`);
}

function debugPlayerDatabaseSummary() {
  const summary = {
    count: playerDatabase.length,
    missingIds: playerDatabase.filter(p => !p.persistentId).map(formatDisplayName),
    duplicatesByName: {}
  };

  const groups = {};
  playerDatabase.forEach(p => {
    const key = `${String(p.firstName || "").trim().toUpperCase()}|${String(p.lastName || "").trim().toUpperCase()}|${String(p.nickname || "").trim().toUpperCase()}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  });

  Object.entries(groups).forEach(([key, arr]) => {
    if (arr.length > 1) {
      summary.duplicatesByName[key] = arr.map(p => ({
        id: p.persistentId,
        name: formatDisplayName(p),
        stats: normalizeStatsObject(p.stats)
      }));
    }
  });

  console.log("Player DB Summary", summary);
  return summary;
}

function initManagePlayerDbPanel() {
  refreshManagePlayerDbSelectors();
  populateManagePlayerFields();

  document.getElementById("managePlayerSelect")?.addEventListener("change", populateManagePlayerFields);
  document.getElementById("manage-refresh-btn")?.addEventListener("click", () => {
    refreshManagePlayerDbSelectors();
    populateManagePlayerFields();
  });
  document.getElementById("manage-save-local-btn")?.addEventListener("click", saveManagePlayerFieldsLocal);
  document.getElementById("manage-save-firebase-btn")?.addEventListener("click", handleManagedSavePlayerDbFirebase);
  document.getElementById("manage-delete-btn")?.addEventListener("click", deleteManagedPlayer);
  document.getElementById("merge-players-btn")?.addEventListener("click", mergeManagedPlayers);
  document.getElementById("manage-load-firebase-btn")?.addEventListener("click", async () => {
    await handleRefreshPlayerDbFromFirebase();
    refreshManagePlayerDbSelectors();
    populateManagePlayerFields();
  });
}

function getSeriesPlayerSelectIds() {
  return [
    'series-place-1-a', 'series-place-1-b',
    'series-place-2-a', 'series-place-2-b',
    'series-place-3-a', 'series-place-3-b',
    'series-place-4-a', 'series-place-4-b'
  ];
}


function getSeriesSelectablePlayers() {
  const map = new Map();

  function addCandidate(obj) {
    if (!obj || typeof obj !== "object") return;
    const stableId = String(obj.persistentId || obj.id || "");
    if (!stableId) return;
    if (!map.has(stableId)) {
      map.set(stableId, {
        persistentId: stableId,
        id: obj.id || stableId,
        firstName: obj.firstName || obj.name || stableId,
        lastName: obj.lastName || "",
        nickname: obj.nickname || "",
        gender: obj.gender || ""
      });
    }
  }

  (players || []).forEach(addCandidate);
  (playerDatabase || []).forEach(addCandidate);
  Object.values(seriesPlayerDirectory || {}).forEach(addCandidate);

  // Include any player IDs already referenced by saved weekly series data.
  Object.values(weeklySeriesState?.weeks || {}).forEach(week => {
    if (!week) return;
    [1, 2, 3, 4].forEach(place => {
      const rawVal = week.placements?.[place];
      const ids = Array.isArray(rawVal) ? rawVal : (rawVal ? [rawVal] : []);
      ids.forEach(id => {
        const key = String(id || "");
        if (!key) return;
        const resolved = resolvePlayerByStableId(key);
        addCandidate(resolved || { persistentId: key, firstName: key });
      });
    });
    (week.others || []).forEach(id => {
      const key = String(id || "");
      if (!key) return;
      const resolved = resolvePlayerByStableId(key);
      addCandidate(resolved || { persistentId: key, firstName: key });
    });
  });

  return Array.from(map.values()).sort((a, b) =>
    formatDisplayName(a).localeCompare(formatDisplayName(b))
  );
}

function populateSeriesPlayerSelectors() {
  const selectIds = getSeriesPlayerSelectIds();
  const selectablePlayers = getSeriesSelectablePlayers();

  selectIds.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const existingValue = String(sel.value || "");
    sel.innerHTML = "";

    const emptyOpt = document.createElement("option");
    emptyOpt.value = "";
    emptyOpt.textContent = "-- none --";
    sel.appendChild(emptyOpt);

    selectablePlayers.forEach(player => {
      const opt = document.createElement("option");
      opt.value = String(player.persistentId || player.id);
      opt.textContent = formatDisplayName(player);
      sel.appendChild(opt);
    });

    if (existingValue && Array.from(sel.options).some(opt => String(opt.value) === existingValue)) {
      sel.value = existingValue;
    }
  });

  const othersContainer = document.getElementById("series-others-container");
  if (!othersContainer) return;

  const selectedOthers = new Set(
    Array.from(othersContainer.querySelectorAll('input[type="checkbox"]:checked')).map(cb => String(cb.value))
  );
  othersContainer.innerHTML = "";

  selectablePlayers.forEach(player => {
    const stableId = String(player.persistentId || player.id);
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = stableId;
    if (selectedOthers.has(stableId)) checkbox.checked = true;
    label.appendChild(checkbox);

    const span = document.createElement("span");
    span.textContent = formatDisplayName(player);
    label.appendChild(span);
    othersContainer.appendChild(label);
  });
}

function getSelectedSeriesWeekKey() {
  const sel = document.getElementById("series-week-select");
  return sel ? sel.value : "";
}


function remapSeriesPlayerIds(ids) {
  return (Array.isArray(ids) ? ids : (ids ? [ids] : []))
    .map(v => String(v))
    .filter(Boolean)
    .map(id => {
      const resolved =
        (typeof resolvePlayerByStableId === "function" ? resolvePlayerByStableId(id) : null) ||
        (seriesPlayerDirectory ? seriesPlayerDirectory[id] : null) ||
        null;
      return String((resolved && (resolved.persistentId || resolved.id)) || id);
    });
}


function ensureSeriesSelectHasOption(sel, value) {
  if (!sel) return;
  const targetValue = String(value || "");
  if (!targetValue) return;
  const exists = Array.from(sel.options).some(opt => String(opt.value) === targetValue);
  if (exists) return;

  const resolved =
    (typeof resolvePlayerByStableId === "function" ? resolvePlayerByStableId(targetValue) : null) ||
    (seriesPlayerDirectory ? seriesPlayerDirectory[targetValue] : null) ||
    null;

  const opt = document.createElement("option");
  opt.value = targetValue;
  opt.textContent = resolved ? formatDisplayName(resolved) : targetValue;
  sel.appendChild(opt);
}

function setSeriesPlacementValues(place, ids) {
  const normalizedIds = remapSeriesPlayerIds(ids);

  const selectIds = [
    `series-place-${place}-a`,
    `series-place-${place}-b`
  ];

  selectIds.forEach((id, index) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const targetValue = normalizedIds[index] || "";
    if (targetValue) {
      ensureSeriesSelectHasOption(sel, targetValue);
    }
    sel.value = targetValue || "";
  });
}

function getSeriesPlacementValues(place) {
  const vals = [
    document.getElementById(`series-place-${place}-a`)?.value || "",
    document.getElementById(`series-place-${place}-b`)?.value || ""
  ].filter(Boolean);
  return Array.from(new Set(vals));
}

function clearSeriesForm() {
  [1, 2, 3, 4].forEach(place => setSeriesPlacementValues(place, []));
  document.querySelectorAll('#series-others-container input[type="checkbox"]').forEach(cb => {
    cb.checked = false;
  });
}

function loadSelectedSeriesWeekIntoForm() {
  const weekKey = getSelectedSeriesWeekKey();
  if (!weekKey) return;

  populateSeriesPlayerSelectors();
  clearSeriesForm();

  const week = weeklySeriesState.weeks?.[weekKey];
  if (!week) {
    renderWeeklySeriesDashboard();
    return;
  }

  const placementIds = {};
  [1, 2, 3, 4].forEach(place => {
    const rawVal = week.placements?.[place];
    placementIds[place] = remapSeriesPlayerIds(rawVal);
  });

  [1, 2, 3, 4].forEach(place => {
    setSeriesPlacementValues(place, placementIds[place]);
  });

  const placedIds = new Set([
    ...(placementIds[1] || []),
    ...(placementIds[2] || []),
    ...(placementIds[3] || []),
    ...(placementIds[4] || [])
  ].map(v => String(v)));

  const otherIds = new Set(remapSeriesPlayerIds(week.others || []).filter(id => !placedIds.has(String(id))));
  document.querySelectorAll('#series-others-container input[type="checkbox"]').forEach(cb => {
    cb.checked = otherIds.has(String(cb.value));
  });

  renderWeeklySeriesDashboard();
}

function collectWeekFormData() {
  const placements = {
    1: getSeriesPlacementValues(1),
    2: getSeriesPlacementValues(2),
    3: getSeriesPlacementValues(3),
    4: getSeriesPlacementValues(4)
  };

  const placedIds = new Set(Object.values(placements).flat().map(String));

  const others = Array.from(document.querySelectorAll('#series-others-container input[type="checkbox"]:checked'))
    .map(cb => String(cb.value))
    .filter(Boolean)
    .filter(id => !placedIds.has(id));

  return { placements, others: Array.from(new Set(others)) };
}

async function saveSelectedSeriesWeekFromForm() {
  const weekKey = getSelectedSeriesWeekKey();
  if (!weekKey) {
    alert("Select a week first.");
    return;
  }

  const data = collectWeekFormData();
  const normalized = normalizeWeeklySeriesWeekRecord({
    ...data,
    savedAt: new Date().toISOString()
  });

  weeklySeriesState.weeks[weekKey] = normalized || data;
  saveWeeklySeriesState();
  renderWeeklySeriesDashboard();

  try {
    updateFirebaseStatus("working", `Saving weekly series ${weekKey} to Firebase...`);
    await saveWeeklySeriesToFirebaseQuiet();
    updateFirebaseStatus("connected", `Firebase connected: ${getStoredFirebaseConfig().projectId}`);
    alert(`Saved Hot Dog Shop results for ${weekKey} locally and to Firebase.`);
  } catch (err) {
    console.error(err);
    updateFirebaseStatus("missing", err.message || "Firebase weekly series save failed");
    alert(`Saved Hot Dog Shop results for ${weekKey} locally, but Firebase save failed: ${err.message || err}`);
  }
}

function clearSelectedSeriesWeek() {
  const weekKey = getSelectedSeriesWeekKey();
  if (!weekKey) return;
  clearSeriesForm();
  delete weeklySeriesState.weeks[weekKey];
  saveWeeklySeriesState();
  renderWeeklySeriesDashboard();
}

function getPlayersFromTeam(team) {
  if (!team) return [];
  return [team.player1, team.player2].filter(Boolean);
}

function autoFillSeriesWeekFromTournament() {
  if (!teams.length) {
    alert("Add players and teams first.");
    return;
  }
  const rankings = getTeamRankings();
  if (!rankings.length) {
    alert("No tournament standings are available yet.");
    return;
  }

  populateSeriesPlayerSelectors();
  clearSeriesForm();

  const placementMap = {
    1: rankings[0]?.team || null,
    2: rankings[1]?.team || null,
    3: rankings[2]?.team || null,
    4: rankings[3]?.team || null
  };

  const placedPlayerIds = new Set();
  const currentTournamentIds = new Set(players.map(player => String(getPlayerStableId(player))));
  [1, 2, 3, 4].forEach(place => {
    const ids = getPlayersFromTeam(placementMap[place]).map(player => String(getPlayerStableId(player)));
    ids.forEach(id => placedPlayerIds.add(id));
    setSeriesPlacementValues(place, ids);
  });

  document.querySelectorAll('#series-others-container input[type="checkbox"]').forEach(cb => {
    cb.checked = currentTournamentIds.has(String(cb.value)) && !placedPlayerIds.has(String(cb.value));
  });

  weeklySeriesState.qualifierBracket = null;
  saveSelectedSeriesWeekFromForm();
}

function getWeeklySeriesLeaderboardRows() {
  const playerMap = new Map();

  function touchPlayer(id) {
    const key = String(id);
    if (!playerMap.has(key)) {
      playerMap.set(key, {
        playerId: key,
        player: resolvePlayerByStableId(key),
        weeklyScores: [],
        weeksPlayed: 0,
        totalRawPoints: 0,
        best6Points: 0,
        eligible: false
      });
    }
    return playerMap.get(key);
  }

  Object.keys(weeklySeriesState.weeks).sort().forEach(weekKey => {
    const week = weeklySeriesState.weeks[weekKey] || {};
    const participatedThisWeek = new Set();

    [1, 2, 3, 4].forEach(place => {
      const rawVal = week.placements?.[place];
      const ids = (Array.isArray(rawVal) ? rawVal : (rawVal ? [rawVal] : []))
        .map(v => String(v))
        .filter(Boolean);

      ids.forEach(id => {
        const row = touchPlayer(id);
        row.weeklyScores.push({ weekKey, points: SERIES_POINTS[place], source: `Place ${place}` });
        row.totalRawPoints += SERIES_POINTS[place];
        participatedThisWeek.add(id);
      });
    });

    (week.others || []).map(v => String(v)).forEach(id => {
      if (participatedThisWeek.has(id)) return;
      const row = touchPlayer(id);
      row.weeklyScores.push({ weekKey, points: SERIES_POINTS.other, source: "Other" });
      row.totalRawPoints += SERIES_POINTS.other;
      participatedThisWeek.add(id);
    });

    participatedThisWeek.forEach(id => {
      touchPlayer(id).weeksPlayed += 1;
    });
  });

  const rows = Array.from(playerMap.values()).map(row => {
    const best6Points = row.weeklyScores
      .map(entry => entry.points)
      .sort((a, b) => b - a)
      .slice(0, 6)
      .reduce((sum, value) => sum + value, 0);
    row.best6Points = best6Points;
    row.eligible = row.weeksPlayed >= 8;
    if (!row.player) {
      row.player = resolvePlayerByStableId(row.playerId);
    }
    return row;
  });

  rows.sort((a, b) => {
    if (b.best6Points !== a.best6Points) return b.best6Points - a.best6Points;
    if (b.weeksPlayed !== a.weeksPlayed) return b.weeksPlayed - a.weeksPlayed;
    return formatDisplayName(a.player || { firstName: "", lastName: "" }).localeCompare(
      formatDisplayName(b.player || { firstName: "", lastName: "" })
    );
  });

  return rows.map((row, index) => ({ ...row, leaderboardRank: index + 1 }));
}

function getWeeklySeriesViews() {
  const leaderboard = getWeeklySeriesLeaderboardRows();
  const eligible = leaderboard.filter(row => row.eligible);
  const top16 = eligible.slice(0, 16);
  const wildcardPool = eligible.slice(16);
  return { leaderboard, eligible, top16, wildcardPool };
}

function getSeriesStatusBadge(row, top16Ids, wildcardIds) {
  if (!row.eligible) return '<span class="series-badge muted">Not eligible</span>';
  if (top16Ids.has(String(row.playerId))) return '<span class="series-badge good">Top 16</span>';
  if (wildcardIds.has(String(row.playerId))) return '<span class="series-badge warn">Wildcard pool</span>';
  return '<span class="series-badge muted">Eligible</span>';
}

function renderWeeklySeriesDashboard() {
  const overall = document.getElementById("series-dashboard-overall");
  const top16View = document.getElementById("series-top16-view");
  const wildcardView = document.getElementById("series-wildcard-pool-view");
  const qualifierView = document.getElementById("series-qualifier-view");
  if (!overall || !top16View || !wildcardView || !qualifierView) return;

  const { leaderboard, top16, wildcardPool } = getWeeklySeriesViews();
  const top16Ids = new Set(top16.map(row => String(row.playerId)));
  const wildcardIds = new Set(wildcardPool.map(row => String(row.playerId)));

  if (!leaderboard.length) {
    overall.textContent = "No season data yet.";
    top16View.textContent = "No qualified players yet.";
    wildcardView.textContent = "No wildcard pool yet.";
    qualifierView.textContent = weeklySeriesState.qualifierBracket ? qualifierView.innerHTML : "No qualifier bracket generated yet.";
    return;
  }

  let overallHtml = '<table class="series-mini-table"><thead><tr><th>#</th><th>Player</th><th>Best 6</th><th>Weeks</th><th>Raw</th><th>Status</th></tr></thead><tbody>';
  leaderboard.forEach(row => {
    overallHtml += `<tr><td>${row.leaderboardRank}</td><td>${formatDisplayName(row.player)}</td><td>${row.best6Points}</td><td>${row.weeksPlayed}</td><td>${row.totalRawPoints}</td><td>${getSeriesStatusBadge(row, top16Ids, wildcardIds)}</td></tr>`;
  });
  overallHtml += '</tbody></table>';
  overall.innerHTML = overallHtml;

  if (!top16.length) {
    top16View.textContent = "No qualified players yet.";
  } else {
    let html = '<table class="series-mini-table"><thead><tr><th>Seed</th><th>Player</th><th>Best 6</th><th>Weeks</th></tr></thead><tbody>';
    top16.forEach((row, idx) => {
      html += `<tr><td>${idx + 1}</td><td>${formatDisplayName(row.player)}</td><td>${row.best6Points}</td><td>${row.weeksPlayed}</td></tr>`;
    });
    html += '</tbody></table>';
    top16View.innerHTML = html;
  }

  if (!wildcardPool.length) {
    wildcardView.innerHTML = "No wildcard pool yet.";
  } else {
    let html = '<table class="series-mini-table"><thead><tr><th>#</th><th>Player</th><th>Best 6</th><th>Weeks</th></tr></thead><tbody>';
    wildcardPool.forEach((row, idx) => {
      html += `<tr><td>${idx + 1}</td><td>${formatDisplayName(row.player)}</td><td>${row.best6Points}</td><td>${row.weeksPlayed}</td></tr>`;
    });
    html += '</tbody></table>';
    if (weeklySeriesState.wildcardDraw.length) {
      const chosen = weeklySeriesState.wildcardDraw
        .map(id => leaderboard.find(row => String(row.playerId) === String(id)))
        .filter(Boolean);
      if (chosen.length) {
        html += '<p><strong>Drawn Wildcards:</strong></p><ul>';
        chosen.forEach((row, idx) => {
          html += `<li>WC${idx + 1}: ${formatDisplayName(row.player)}</li>`;
        });
        html += '</ul>';
      }
    }
    wildcardView.innerHTML = html;
  }

  if (weeklySeriesState.qualifierBracket) {
    qualifierView.innerHTML = renderSeriesQualifierBracketHtml(weeklySeriesState.qualifierBracket);
  } else {
    qualifierView.textContent = "No qualifier bracket generated yet.";
  }
}

function shuffleCopy(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function drawSeriesWildcards() {
  const { wildcardPool } = getWeeklySeriesViews();
  if (wildcardPool.length < 4) {
    alert("Need at least 4 players in the wildcard pool to draw wildcards.");
    return;
  }
  const shuffled = shuffleCopy(wildcardPool);
  weeklySeriesState.wildcardDraw = shuffled.slice(0, 4).map(row => String(row.playerId));
  weeklySeriesState.qualifierBracket = null;
  saveWeeklySeriesState();
  renderWeeklySeriesDashboard();
}

function generateSeriesQualifierBracket() {
  const { top16, leaderboard } = getWeeklySeriesViews();
  if (top16.length < 16) {
    alert("Need 16 eligible top players before generating the qualifier bracket.");
    return;
  }
  if (weeklySeriesState.wildcardDraw.length < 4) {
    alert("Draw 4 wildcard players first.");
    return;
  }
  const wildcardRows = weeklySeriesState.wildcardDraw
    .map(id => leaderboard.find(row => String(row.playerId) === String(id)))
    .filter(Boolean);
  if (wildcardRows.length < 4) {
    alert("The stored wildcard draw is incomplete. Draw wildcards again.");
    return;
  }

  weeklySeriesState.qualifierBracket = {
    generatedAt: new Date().toISOString(),
    top16: top16.map((row, idx) => ({ seed: idx + 1, playerId: String(row.playerId), name: formatDisplayName(row.player) })),
    wildcards: wildcardRows.map((row, idx) => ({ seed: `WC${idx + 1}`, playerId: String(row.playerId), name: formatDisplayName(row.player) }))
  };
  saveWeeklySeriesState();
  renderWeeklySeriesDashboard();
}

function renderSeriesQualifierBracketHtml(bracket) {
  const top16 = bracket.top16 || [];
  const wildcards = bracket.wildcards || [];
  if (top16.length < 16 || wildcards.length < 4) {
    return "No qualifier bracket generated yet.";
  }
  const playIns = [
    { label: "Play-In A", left: top16[12], right: wildcards[3], winnerTo: "Seed 13 slot in Round of 16" },
    { label: "Play-In B", left: top16[13], right: wildcards[2], winnerTo: "Seed 14 slot in Round of 16" },
    { label: "Play-In C", left: top16[14], right: wildcards[1], winnerTo: "Seed 15 slot in Round of 16" },
    { label: "Play-In D", left: top16[15], right: wildcards[0], winnerTo: "Seed 16 slot in Round of 16" }
  ];

  let html = `<p class="note">Generated ${new Date(bracket.generatedAt).toLocaleString()}.</p>`;
  html += '<h4>Play-In Round</h4>';
  playIns.forEach(match => {
    html += `<div class="series-bracket-match"><strong>${match.label}</strong><br>${match.left.seed}. ${match.left.name}<br>vs<br>${match.right.seed} ${match.right.name}<br><span class="note">Winner advances to ${match.winnerTo}.</span></div>`;
  });

  html += '<h4>Seeds 1–12 (Byes into Round of 16)</h4><ul>';
  top16.slice(0, 12).forEach(seed => {
    html += `<li>Seed ${seed.seed}: ${seed.name}</li>`;
  });
  html += '</ul>';

  html += '<h4>Round of 16 Slots</h4><ol>';
  top16.slice(0, 12).forEach(seed => {
    html += `<li>${seed.name}</li>`;
  });
  html += '<li>Winner Play-In A</li><li>Winner Play-In B</li><li>Winner Play-In C</li><li>Winner Play-In D</li></ol>';
  return html;
}

function downloadTextFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildSeriesLeaderboardExportRows() {
  const { leaderboard, top16, wildcardPool } = getWeeklySeriesViews();
  const top16Ids = new Set(top16.map(row => String(row.playerId)));
  const wildcardIds = new Set(wildcardPool.map(row => String(row.playerId)));
  return leaderboard.map(row => ({
    rank: row.leaderboardRank,
    player: formatDisplayName(row.player),
    best6Points: row.best6Points,
    rawPoints: row.totalRawPoints,
    weeksPlayed: row.weeksPlayed,
    eligible: row.eligible ? "Yes" : "No",
    status: top16Ids.has(String(row.playerId)) ? "Top 16" : wildcardIds.has(String(row.playerId)) ? "Wildcard Pool" : row.eligible ? "Eligible" : "Not Eligible"
  }));
}

function exportSeriesLeaderboardCsv() {
  const rows = buildSeriesLeaderboardExportRows();
  if (!rows.length) {
    alert("No weekly series data to export.");
    return;
  }
  const headers = ["Rank", "Player", "Best6Points", "RawPoints", "WeeksPlayed", "Eligible", "Status"];
  const lines = [headers.join(",")];
  rows.forEach(row => {
    const vals = [row.rank, row.player, row.best6Points, row.rawPoints, row.weeksPlayed, row.eligible, row.status]
      .map(value => `"${String(value).replace(/"/g, '""')}"`);
    lines.push(vals.join(","));
  });
  downloadTextFile("hot_dog_shop_leaderboard.csv", lines.join("\n"), "text/csv;charset=utf-8");
}

function exportSeriesLeaderboardExcel() {
  const rows = buildSeriesLeaderboardExportRows();
  if (!rows.length) {
    alert("No weekly series data to export.");
    return;
  }
  let html = '<html><head><meta charset="UTF-8"></head><body><table border="1"><tr><th>Rank</th><th>Player</th><th>Best 6 Points</th><th>Raw Points</th><th>Weeks Played</th><th>Eligible</th><th>Status</th></tr>';
  rows.forEach(row => {
    html += `<tr><td>${row.rank}</td><td>${row.player}</td><td>${row.best6Points}</td><td>${row.rawPoints}</td><td>${row.weeksPlayed}</td><td>${row.eligible}</td><td>${row.status}</td></tr>`;
  });
  html += '</table></body></html>';
  downloadTextFile("hot_dog_shop_leaderboard.xls", html, "application/vnd.ms-excel;charset=utf-8");
}

// --- View mode helpers ---------------------------

function applyBracketViewMode() {
  document.body.classList.toggle("mode-knockout", bracketViewMode === "knockout");
  document.body.classList.remove("mode-blank-template");
}

function updateMysteryCourtsVisibility() {
  const container = document.getElementById("mystery-courts-container");
  const toggle = document.getElementById("mystery-show-courts-toggle");
  if (!container) return;
  if (showCourtsInMysteryDisplay) {
    container.style.display = "";
    if (toggle) toggle.checked = true;
  } else {
    container.style.display = "none";
    if (toggle) toggle.checked = false;
  }
}

function applyMysteryOthersVisibility() {
  if (showMysteryOthers) {
    document.body.classList.remove("hide-mystery-others");
  } else {
    document.body.classList.add("hide-mystery-others");
  }
  const toggle = document.getElementById("mystery-show-others-toggle");
  if (toggle) toggle.checked = !!showMysteryOthers;
}

// Apply tournamentMeta to inputs
function applyTournamentMetaToUI() {
  const tDate = document.getElementById("tournament-date");
  const tTime = document.getElementById("tournament-time");
  const tLocation = document.getElementById("tournament-location");
  if (tDate) tDate.value = tournamentMeta.date || "";
  if (tTime) tTime.value = tournamentMeta.time || "";
  if (tLocation) tLocation.value = tournamentMeta.location || "";
}

// --- Rerender helper -----------------------------

function getStoredFirebaseConfig() {
  const localRaw = localStorage.getItem(FIREBASE_CONFIG_KEY);
  if (localRaw) {
    try {
      return JSON.parse(localRaw);
    } catch (err) {
      console.error("Invalid stored Firebase config", err);
    }
  }
  if (window.DARTS_FIREBASE_CONFIG && typeof window.DARTS_FIREBASE_CONFIG === "object") {
    return window.DARTS_FIREBASE_CONFIG;
  }
  return null;
}

function preloadFirebaseConfigIntoUI() {
  const input = document.getElementById("firebase-config-input");
  if (!input) return;
  const config = getStoredFirebaseConfig();
  if (config) {
    input.value = JSON.stringify(config, null, 2);
  }
  updateFirebaseStatus(firebaseReady ? "connected" : "missing");
}

function updateFirebaseStatus(mode, message = "") {
  const el = document.getElementById("firebase-status");
  if (!el) return;
  el.classList.remove("firebase-status-online", "firebase-status-offline", "firebase-status-working");
  if (mode === "connected") {
    el.classList.add("firebase-status-online");
    el.textContent = message || "Firebase connected";
  } else if (mode === "working") {
    el.classList.add("firebase-status-working");
    el.textContent = message || "Firebase working...";
  } else {
    el.classList.add("firebase-status-offline");
    el.textContent = message || "Firebase not connected";
  }
}

function parseFirebaseConfigFromUI() {
  const input = document.getElementById("firebase-config-input");
  const raw = input ? input.value.trim() : "";
  if (!raw) {
    throw new Error("Firebase config UI is disabled in this production build. Check firebase-config.js instead.");
  }
  let parsed = JSON.parse(raw);
  if (parsed.firebaseConfig && typeof parsed.firebaseConfig === "object") {
    parsed = parsed.firebaseConfig;
  }
  const required = ["apiKey", "authDomain", "projectId", "appId"];
  const missing = required.filter(key => !parsed[key]);
  if (missing.length) {
    throw new Error(`Firebase config is missing: ${missing.join(", ")}`);
  }
  return parsed;
}

function handleSaveFirebaseConfig() {
  try {
    const parsed = parseFirebaseConfigFromUI();
    localStorage.setItem(FIREBASE_CONFIG_KEY, JSON.stringify(parsed));
    updateFirebaseStatus("missing", "Firebase config saved locally. Click Connect Firebase.");
    alert("Firebase config saved in this browser. Now click Connect Firebase.");
  } catch (err) {
    console.error(err);
    alert(err.message || "Could not save Firebase config.");
  }
}

function handleClearFirebaseConfig() {
  if (!confirm("Clear the saved Firebase config from this browser?")) return;
  localStorage.removeItem(FIREBASE_CONFIG_KEY);
  const input = document.getElementById("firebase-config-input");
  if (input) input.value = "";
  firebaseDb = null;
  firebaseReady = false;
  updateFirebaseStatus("missing", "Firebase config cleared.");
}

function ensureFirebaseScriptsAvailable() {
  return typeof window.firebase !== "undefined" && !!window.firebase.firestore;
}

function initializeFirebase(config) {
  if (!ensureFirebaseScriptsAvailable()) {
    throw new Error("Firebase SDK did not load. Check your internet connection or hosting setup.");
  }
  let app;
  if (window.firebase.apps && window.firebase.apps.length) {
    app = window.firebase.apps[0];
  } else {
    app = window.firebase.initializeApp(config);
  }
  firebaseDb = window.firebase.firestore(app);
  firebaseReady = true;
  updateFirebaseStatus("connected", `Firebase connected: ${config.projectId}`);
  return firebaseDb;
}

function attemptFirebaseAutoConnect() {
  const config = getStoredFirebaseConfig();
  if (!config) {
    updateFirebaseStatus("missing", "Firebase not connected");
    return;
  }
  try {
    initializeFirebase(config);
  } catch (err) {
    console.error(err);
    firebaseDb = null;
    firebaseReady = false;
    updateFirebaseStatus("missing", err.message || "Firebase connection failed");
  }
}

function handleConnectFirebase() {
  try {
    const parsed = parseFirebaseConfigFromUI();
    localStorage.setItem(FIREBASE_CONFIG_KEY, JSON.stringify(parsed));
    initializeFirebase(parsed);
    alert(`Firebase connected to ${parsed.projectId}.`);
  } catch (err) {
    console.error(err);
    firebaseDb = null;
    firebaseReady = false;
    updateFirebaseStatus("missing", err.message || "Firebase connection failed");
    alert(err.message || "Could not connect to Firebase.");
  }
}

function requireFirebaseDb() {
  if (firebaseReady && firebaseDb) return firebaseDb;
  const config = getStoredFirebaseConfig();
  if (!config) {
    throw new Error("Firebase is not connected. Check firebase-config.js and make sure your site is allowed in Firebase.");
  }
  return initializeFirebase(config);
}

function encodeForFirestore(value) {
  if (Array.isArray(value)) {
    return { __encodedArray: true, items: value.map(encodeForFirestore) };
  }
  if (value && typeof value === "object") {
    const out = {};
    Object.entries(value).forEach(([k, v]) => { out[k] = encodeForFirestore(v); });
    return out;
  }
  return value;
}

function decodeFromFirestore(value) {
  if (value && typeof value === "object" && value.__encodedArray && Array.isArray(value.items)) {
    return value.items.map(decodeFromFirestore);
  }
  if (Array.isArray(value)) {
    return value.map(decodeFromFirestore);
  }
  if (value && typeof value === "object") {
    const out = {};
    Object.entries(value).forEach(([k, v]) => {
      if (k !== "__encodedArray") out[k] = decodeFromFirestore(v);
    });
    return out;
  }
  return value;
}


function normalizeWeeklySeriesWeekRecord(rawWeek) {
  if (!rawWeek || typeof rawWeek !== "object") return null;
  const placements = rawWeek.placements && typeof rawWeek.placements === "object"
    ? rawWeek.placements
    : {};
  let others = [];
  if (Array.isArray(rawWeek.others)) {
    others = rawWeek.others.map(v => String(v));
  } else if (Array.isArray(rawWeek.otherPlayers)) {
    others = rawWeek.otherPlayers.map(v => String(v));
  }

  function normalizePlacement(val) {
    const arr = Array.isArray(val) ? val : (val ? [val] : []);
    return Array.from(new Set(arr.map(v => String(v)).filter(Boolean)));
  }

  return {
    placements: {
      1: normalizePlacement(placements["1"]),
      2: normalizePlacement(placements["2"]),
      3: normalizePlacement(placements["3"]),
      4: normalizePlacement(placements["4"])
    },
    others: Array.from(new Set(others)),
    savedAt: rawWeek.savedAt || new Date().toISOString()
  };
}

function mergeWeeklySeriesWeeks(targetState, incomingWeeks) {
  if (!targetState.weeks) targetState.weeks = {};
  if (!incomingWeeks || typeof incomingWeeks !== "object") return;
  Object.entries(incomingWeeks).forEach(([weekKey, weekVal]) => {
    const normalized = normalizeWeeklySeriesWeekRecord(weekVal);
    if (normalized) {
      targetState.weeks[String(weekKey)] = normalized;
    }
  });
}

async function rebuildWeeklySeriesFromTournamentHistory(db) {
  const snap = await db.collection("tournamentByWeek").get();
  const rebuilt = {
    weeks: {},
    wildcardDraw: [],
    qualifierBracket: null,
    rebuiltAt: new Date().toISOString(),
    rebuiltFrom: "tournamentByWeek"
  };

  const decodedDocs = [];
  snap.forEach(doc => {
    const decoded = decodeFromFirestore(doc.data() || {});
    decodedDocs.push(decoded);
    if (decoded.weeklySeriesState && decoded.weeklySeriesState.weeks) {
      mergeWeeklySeriesWeeks(rebuilt, decoded.weeklySeriesState.weeks);
    }
    if (
      decoded.tournamentState &&
      decoded.tournamentState.weeklySeriesState &&
      decoded.tournamentState.weeklySeriesState.weeks
    ) {
      mergeWeeklySeriesWeeks(rebuilt, decoded.tournamentState.weeklySeriesState.weeks);
    }
  });

  buildSeriesPlayerDirectoryFromTournamentDocs(decodedDocs);
  canonicalizeWeeklySeriesStatePlayerIds(rebuilt);
  return rebuilt;
}

function buildFirebaseTournamentPayload() {
  canonicalizeWeeklySeriesStatePlayerIds(weeklySeriesState);
  return {
    tournamentState: collectTournamentState(),
    playerDatabase,
    weeklySeriesState,
    savedAt: new Date().toISOString(),
    schemaVersion: 1
  };
}

async function saveTournamentToFirebase() {
  try {
    updateFirebaseStatus("working", "Saving tournament to Firebase...");
    const db = requireFirebaseDb();
    updatePlayerStatsFromCurrentTournament();
    const payload = buildFirebaseTournamentPayload();
    await db.collection("appState").doc("currentTournament").set(encodeForFirestore(payload));
    await db.collection("appState").doc("playerDatabase").set(encodeForFirestore({ playerDatabase: { items: playerDatabase }, players: playerDatabase, items: playerDatabase, byId: Object.fromEntries(playerDatabase.map(p => [String(p.persistentId || generatePersistentPlayerId()), p])), savedAt: new Date().toISOString(), schemaVersion: 1 }));
    const weekKey = tournamentMeta.date || new Date().toISOString().slice(0,10);
    const weekDocId = `${weekKey}_${safeFilenamePart(tournamentMeta.location || 'location', 'location')}`;
    await db.collection("tournamentByWeek").doc(weekDocId).set(encodeForFirestore(payload));
    await saveWeeklySeriesToFirebase();
    await refreshFirebaseTournamentWeekList();
    updateFirebaseStatus("connected", `Firebase connected: ${getStoredFirebaseConfig().projectId}`);
    alert("Current tournament, player database, and weekly series saved to Firebase.");
  } catch (err) {
    console.error(err);
    updateFirebaseStatus("missing", err.message || "Firebase save failed");
    alert(err.message || "Failed to save tournament to Firebase.");
  }
}

async function loadTournamentFromFirebase() {
  try {
    updateFirebaseStatus("working", "Loading tournament from Firebase...");
    const db = requireFirebaseDb();
    const doc = await db.collection("appState").doc("currentTournament").get();
    if (!doc.exists) {
      updateFirebaseStatus("connected", `Firebase connected: ${getStoredFirebaseConfig().projectId}`);
      alert("No current tournament found in Firebase yet.");
      return;
    }
    const data = decodeFromFirestore(doc.data() || {});
    applyDecodedFirebaseBundle(data);
    updateFirebaseStatus("connected", `Firebase connected: ${getStoredFirebaseConfig().projectId}`);
    alert("Tournament data loaded from Firebase.");
  } catch (err) {
    console.error(err);
    updateFirebaseStatus("missing", err.message || "Firebase load failed");
    alert(err.message || "Failed to load tournament from Firebase.");
  }
}

async function archiveTournamentToFirebase() {
  try {
    updateFirebaseStatus("working", "Archiving tournament to Firebase...");
    const db = requireFirebaseDb();
    updatePlayerStatsFromCurrentTournament();
    const now = new Date();
    const stamp = now.toISOString();
    const datePart = safeFilenamePart(tournamentMeta.date || stamp.slice(0, 10), "date");
    const locationPart = safeFilenamePart(tournamentMeta.location || "location", "location");
    const archiveId = `${datePart}_${locationPart}_${now.getTime()}`;
    const payload = buildFirebaseTournamentPayload();
    payload.archiveId = archiveId;
    await db.collection("tournaments").doc(archiveId).set(encodeForFirestore(payload));
    await refreshFirebaseArchives();
    updateFirebaseStatus("connected", `Firebase connected: ${getStoredFirebaseConfig().projectId}`);
    alert(`Tournament archived to Firebase as ${archiveId}.`);
  } catch (err) {
    console.error(err);
    updateFirebaseStatus("missing", err.message || "Firebase archive failed");
    alert(err.message || "Failed to archive tournament to Firebase.");
  }
}




function debugWeeklySeriesSummary() {
  const ids = new Set();
  Object.entries(weeklySeriesState?.weeks || {}).forEach(([weekKey, week]) => {
    [1, 2, 3, 4].forEach(place => {
      const rawVal = week?.placements?.[place];
      const arr = Array.isArray(rawVal) ? rawVal : (rawVal ? [rawVal] : []);
      arr.forEach(id => ids.add(String(id)));
    });
    (week?.others || []).forEach(id => ids.add(String(id)));
  });
  const rows = getWeeklySeriesLeaderboardRows();
  console.log("Weekly series unique player IDs:", ids.size, Array.from(ids));
  console.log("Leaderboard rows:", rows.length, rows);
  return { uniqueIds: ids.size, ids: Array.from(ids), leaderboardRows: rows.length, rows };
}

function debugWeeklySeriesWeek(weekKey) {
  const key = weekKey || getSelectedSeriesWeekKey();
  const week = weeklySeriesState?.weeks?.[key];
  console.log("Weekly Series Debug", key, week);
  return week;
}

async function saveWeeklySeriesToFirebaseQuiet() {
  const db = requireFirebaseDb();
  canonicalizeWeeklySeriesStatePlayerIds(weeklySeriesState);
  await db.collection("seriesSeasons").doc("hotdogshop-2026").set(
    encodeForFirestore({
      ...weeklySeriesState,
      savedAt: new Date().toISOString(),
      schemaVersion: 1
    }),
    { merge: true }
  );
}

async function saveWeeklySeriesToFirebase() {
  try {
    updateFirebaseStatus("working", "Saving weekly series to Firebase...");
    await saveWeeklySeriesToFirebaseQuiet();
    updateFirebaseStatus("connected", `Firebase connected: ${getStoredFirebaseConfig().projectId}`);
    alert("Hot Dog Shop weekly series saved to Firebase.");
  } catch (err) {
    console.error(err);
    updateFirebaseStatus("missing", err.message || "Firebase series save failed");
    alert(err.message || "Failed to save weekly series to Firebase.");
  }
}

async function loadWeeklySeriesFromFirebase() {
  try {
    updateFirebaseStatus("working", "Loading weekly series from Firebase...");
    const db = requireFirebaseDb();
    const seriesRef = db.collection("seriesSeasons").doc("hotdogshop-2026");
    const doc = await seriesRef.get();

    let data = null;
    const decodedDocs = [];

    const historySnap = await db.collection("tournamentByWeek").get();
    historySnap.forEach(d => {
      decodedDocs.push(decodeFromFirestore(d.data() || {}));
    });
    if (typeof buildSeriesPlayerDirectoryFromTournamentDocs === "function") {
      buildSeriesPlayerDirectoryFromTournamentDocs(decodedDocs);
    }

    if (doc.exists) {
      const decoded = decodeFromFirestore(doc.data() || {});
      if (decoded && decoded.weeks && Object.keys(decoded.weeks).length) {
        data = decoded;
      }
    }

    if (!data) {
      data = await rebuildWeeklySeriesFromTournamentHistory(db);
      if (data && data.weeks && Object.keys(data.weeks).length) {
        await seriesRef.set(encodeForFirestore({
          ...data,
          savedAt: new Date().toISOString(),
          schemaVersion: 1
        }));
      }
    }

    if (!data || !data.weeks || !Object.keys(data.weeks).length) {
      updateFirebaseStatus("connected", `Firebase connected: ${getStoredFirebaseConfig().projectId}`);
      alert("No Hot Dog Shop weekly series found in Firebase yet.");
      return;
    }

    if (typeof canonicalizeWeeklySeriesStatePlayerIds === "function") {
      canonicalizeWeeklySeriesStatePlayerIds(data);
    }

    weeklySeriesState = {
      weeks: data.weeks || {},
      wildcardDraw: Array.isArray(data.wildcardDraw) ? data.wildcardDraw : [],
      qualifierBracket: data.qualifierBracket || null
    };

    saveWeeklySeriesState();
    rerenderAll();

    if (typeof populateSeriesPlayerSelectors === "function") populateSeriesPlayerSelectors();
    if (typeof loadSelectedSeriesWeekIntoForm === "function") loadSelectedSeriesWeekIntoForm();

    updateFirebaseStatus("connected", `Firebase connected: ${getStoredFirebaseConfig().projectId}`);
    alert("Hot Dog Shop weekly series loaded from Firebase.");
  } catch (err) {
    console.error(err);
    updateFirebaseStatus("missing", err.message || "Firebase series load failed");
    alert(err.message || "Failed to load weekly series from Firebase.");
  }
}


function rerenderAll() {
  if (typeof syncWinnerBracketTeams === "function") syncWinnerBracketTeams();
  if (Array.isArray(losersMatches) && losersMatches.length) syncLosersBracketTeams();
  renderPlayers();
  renderTeams();
  renderMatches();
  renderWinnersBracket();
  renderLosersBracket();
  renderFinalsSection();
  renderMysteryOutBoard();
  populateManualTeamSelects();
  populateMysteryAndFeatSelects();
  renderSpecialShots();
  renderStandings();
  renderSummary();
  renderCourtAssignments();
  updateLockedUI();
  applyBracketViewMode();
  applyTournamentMetaToUI();
  populateStatsPlayerSelect();
  applyMysteryOthersVisibility();
  initWeeklySeriesWeekSelect();
  populateSeriesPlayerSelectors();
  loadSelectedSeriesWeekIntoForm();
  renderWeeklySeriesDashboard();
}


function safeFilenamePart(value, fallback = "tournament") {
  const cleaned = String(value || "").trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildHtmlTable(headers, rows) {
  let html = '<table><thead><tr>' + headers.map(h => `<th>${escapeHtml(h)}</th>`).join('') + '</tr></thead><tbody>';
  if (!rows.length) {
    html += `<tr><td colspan="${headers.length}">No data recorded.</td></tr>`;
  } else {
    rows.forEach(row => {
      html += '<tr>' + row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('') + '</tr>';
    });
  }
  html += '</tbody></table>';
  return html;
}

function getMatchLogEntries() {
  const entries = [];
  (winnersBracket || []).forEach((roundMatches, idx) => {
    (roundMatches || []).forEach(match => {
      entries.push({
        bracket: 'Winner Bracket',
        round: `Round ${idx + 1}`,
        matchId: match.id,
        board: match.board ? `Board ${match.board}` : '-',
        teamA: match.team1 ? formatTeamLabel(match.team1) : 'TBD / BYE',
        teamB: match.team2 ? formatTeamLabel(match.team2) : 'TBD / BYE',
        winner: match.winner ? formatTeamLabel(match.winner) : '-'
      });
    });
  });
  (losersMatches || []).forEach(match => {
    entries.push({
      bracket: 'Loser Bracket',
      round: `Round ${match.round || 1}`,
      matchId: match.id,
      board: match.board ? `Board ${match.board}` : '-',
      teamA: match.team1 ? formatTeamLabel(match.team1) : 'TBD',
      teamB: match.team2 ? formatTeamLabel(match.team2) : 'TBD',
      winner: match.winner ? formatTeamLabel(match.winner) : '-'
    });
  });
  const king = getKingSeatTeam();
  const challenger = getLosersChampionTeam();
  if (king || challenger || finalsState.match1Winner || finalsState.match2Winner || finalsState.champion) {
    entries.push({
      bracket: 'Finals / King Seat',
      round: 'Match 1',
      matchId: 'F1',
      board: '-',
      teamA: king ? formatTeamLabel(king) : 'TBD',
      teamB: challenger ? formatTeamLabel(challenger) : 'TBD',
      winner: finalsState.match1Winner ? formatTeamLabel(finalsState.match1Winner) : '-'
    });
    entries.push({
      bracket: 'Finals / King Seat',
      round: 'Match 2',
      matchId: 'F2',
      board: '-',
      teamA: king ? formatTeamLabel(king) : 'TBD',
      teamB: challenger ? formatTeamLabel(challenger) : 'TBD',
      winner: finalsState.match2Winner ? formatTeamLabel(finalsState.match2Winner) : (finalsState.champion && finalsState.match1Winner && king && finalsState.match1Winner.id === king.id ? 'Not needed' : '-')
    });
  }
  return entries;
}

function getCourtAssignmentRows() {
  const rows = [];
  getMatchLogEntries().forEach(entry => {
    if (entry.board && entry.board !== '-') {
      rows.push({
        board: entry.board,
        match: `${entry.bracket} ${entry.round} / ${entry.matchId}`,
        teams: `${entry.teamA} vs ${entry.teamB}`,
        status: entry.winner && entry.winner !== '-' ? `Completed (${entry.winner})` : 'Active / Pending'
      });
    }
  });
  return rows.sort((a, b) => a.board.localeCompare(b.board, undefined, {numeric: true}));
}

function getPayoutSummaryRows() {
  const grab = id => document.getElementById(id)?.textContent?.trim() || '-';
  return [
    ['Player Pot', grab('player-pot')],
    ['Bar Pot Match', grab('bar-pot-match-amount')],
    ['Total Pot', grab('total-pot')],
    ['Mystery Out Base', grab('mo-base-amount')],
    ['Mystery Out Match', grab('mo-match-amount')],
    ['Mystery Out', grab('mo-amount')],
    ['Tournament Prize Pool', grab('tournament-prize-pool')],
    ['Champion', grab('payout-champion')],
    ['Second', grab('payout-second')],
    ['Third', grab('payout-third')],
    ['Fourth', grab('payout-fourth')],
    ['Fifth', grab('payout-fifth')],
    ['Sixth', grab('payout-sixth')],
    ['Team Out', grab('payout-teamout')],
    ['Info', document.getElementById('payouts-info')?.textContent?.trim() || '-']
  ];
}

function getSummaryRows() {
  const championText = finalsState.champion ? formatTeamLabel(finalsState.champion) : (document.getElementById('champion-label')?.textContent?.trim() || 'TBD');
  const runnerText = finalsState.runnerUp ? formatTeamLabel(finalsState.runnerUp) : (document.getElementById('runnerup-label')?.textContent?.trim() || 'TBD');
  const currentWeek = document.getElementById('series-week-select')?.value || '-';
  return [
    ['Date', tournamentMeta.date || '-'],
    ['Time', tournamentMeta.time || '-'],
    ['Location', tournamentMeta.location || '-'],
    ['Players', players.length],
    ['Teams', teams.length],
    ['Round 1 Matches', matches.length],
    ['Champion', championText],
    ['Runner-up', runnerText],
    ['Current Hot Dog Shop Week', currentWeek]
  ];
}

function getSelectedSeriesWeekKey() {
  return document.getElementById('series-week-select')?.value || '';
}

function getSelectedSeriesWeekData() {
  const key = getSelectedSeriesWeekKey();
  return key ? (weeklySeriesState.weeks[key] || null) : null;
}

function getSeriesPlacementLabel(ids) {
  return (ids || []).map(id => {
    const p = getPlayerById(parseInt(id, 10));
    return p ? formatDisplayName(p) : '(unknown player)';
  }).filter(Boolean).join(' / ') || '-';
}

function getCurrentWeekRows() {
  const weekKey = getSelectedSeriesWeekKey();
  const week = getSelectedSeriesWeekData();
  if (!weekKey || !week) return { summary: [], others: [] };
  const summary = [
    ['Week', weekKey],
    ['1st Place', getSeriesPlacementLabel(week.placements?.[1] || [])],
    ['2nd Place', getSeriesPlacementLabel(week.placements?.[2] || [])],
    ['3rd Place', getSeriesPlacementLabel(week.placements?.[3] || [])],
    ['4th Place', getSeriesPlacementLabel(week.placements?.[4] || [])]
  ];
  const others = (week.others || []).map((id, idx) => {
    const p = getPlayerById(parseInt(id, 10));
    return [idx + 1, p ? formatDisplayName(p) : '(unknown player)'];
  });
  return { summary, others };
}

function getWeeklySeriesViews() {
  const leaderboard = getWeeklySeriesLeaderboardRows();
  const eligible = leaderboard.filter(row => row.eligible);
  const top16 = eligible.slice(0, 16);
  const top16Ids = new Set(top16.map(row => String(row.playerId)));
  const wildcardPool = eligible.filter(row => !top16Ids.has(String(row.playerId)));
  return { leaderboard, top16, wildcardPool };
}

function getSeriesSnapshotRows() {
  const { leaderboard, top16, wildcardPool } = getWeeklySeriesViews();
  const top16Ids = new Set(top16.map(row => String(row.playerId)));
  const wildcardIds = new Set(wildcardPool.map(row => String(row.playerId)));
  return leaderboard.map((row, idx) => [
    idx + 1,
    row.player ? formatDisplayName(row.player) : '(unknown player)',
    row.best6Points,
    row.weeksPlayed,
    row.totalRawPoints,
    row.eligible ? 'Yes' : 'No',
    top16Ids.has(String(row.playerId)) ? 'Top 16' : wildcardIds.has(String(row.playerId)) ? 'Wildcard Pool' : row.eligible ? 'Eligible' : 'Not Eligible'
  ]);
}

function buildTournamentReportHtml() {
  const playersRows = players.map((p, idx) => [idx + 1, formatDisplayName(p), p.gender || '-', p.paid ? 'Yes' : 'No']);
  const teamRows = teams.map(team => [team.id, formatDisplayName(team.player1), team.player2 ? formatDisplayName(team.player2) : '(bye)']);
  const matchRows = getMatchLogEntries().map(m => [m.bracket, m.round, m.matchId, m.board, m.teamA, m.teamB, m.winner]);
  const standingsRows = getTeamRankings().map(r => [r.rank, formatTeamLabel(r.team), r.losses, r.status]);
  const courtRows = getCourtAssignmentRows().map(r => [r.board, r.match, r.teams, r.status]);
  const mysteryRows = mysteryOutEntries.map((entry, idx) => {
    const p = getPlayerById(entry.playerId);
    return [idx + 1, p ? formatDisplayName(p) : 'Unknown', entry.outNumber, entry.timestamp || '-'];
  });
  const bigHitsRows = specialShots.map((shot, idx) => {
    const p = getPlayerById(shot.playerId);
    return [idx + 1, shot.type || '-', p ? formatDisplayName(p) : 'Unknown', shot.timestamp || '-'];
  });
  const payoutRows = getPayoutSummaryRows();
  const summaryRows = getSummaryRows();
  const currentWeekRows = getCurrentWeekRows();
  const seriesRows = getSeriesSnapshotRows();
  const views = getWeeklySeriesViews();
  const top16Rows = views.top16.map((row, idx) => [idx + 1, row.player ? formatDisplayName(row.player) : '(unknown player)', row.best6Points, row.weeksPlayed]);
  const wildcardRows = views.wildcardPool.map((row, idx) => [idx + 1, row.player ? formatDisplayName(row.player) : '(unknown player)', row.best6Points, row.weeksPlayed]);

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8" />
<title>${escapeHtml((tournamentMeta.location || 'Darts Tournament') + ' Full Export')}</title>
<style>
body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
h1, h2 { margin-bottom: 8px; }
h2 { margin-top: 24px; }
p.meta { margin: 0 0 8px; color: #444; }
table { width: 100%; border-collapse: collapse; margin: 10px 0 18px; }
th, td { border: 1px solid #999; padding: 6px 8px; font-size: 12px; text-align: left; vertical-align: top; }
th { background: #eee; }
.section-break { page-break-before: always; }
.small { color: #555; font-size: 11px; }
</style></head><body>
<h1>Darts Tournament Manager – Full Tournament Export</h1>
<p class="meta"><strong>Event:</strong> ${escapeHtml(tournamentMeta.location || 'Tournament')}</p>
<p class="meta"><strong>Date:</strong> ${escapeHtml(tournamentMeta.date || '-')} &nbsp; <strong>Time:</strong> ${escapeHtml(tournamentMeta.time || '-')}</p>
<p class="meta"><strong>Generated:</strong> ${escapeHtml(new Date().toLocaleString())}</p>
<p class="small">This export includes the full tournament snapshot plus the Hot Dog Shop weekly season section.</p>
<h2>Summary</h2>
${buildHtmlTable(['Field', 'Value'], summaryRows)}
<h2>Players</h2>
${buildHtmlTable(['#', 'Player', 'Gender', 'Paid'], playersRows)}
<h2>Teams</h2>
${buildHtmlTable(['Team #', 'Player 1', 'Player 2'], teamRows)}
<div class="section-break"></div>
<h2>Complete Match Log</h2>
${buildHtmlTable(['Bracket', 'Round', 'Match #', 'Board', 'Team A', 'Team B', 'Winner'], matchRows)}
<h2>Standings</h2>
${buildHtmlTable(['Rank', 'Team', 'Losses', 'Status'], standingsRows)}
<h2>Court Assignments</h2>
${buildHtmlTable(['Board', 'Match', 'Teams', 'Status'], courtRows)}
<div class="section-break"></div>
<h2>Mystery Out</h2>
${buildHtmlTable(['#', 'Player', 'Out #', 'Timestamp'], mysteryRows)}
<h2>Big Hits</h2>
${buildHtmlTable(['#', 'Type', 'Player', 'Timestamp'], bigHitsRows)}
<h2>Payout Summary</h2>
${buildHtmlTable(['Field', 'Value'], payoutRows)}
<div class="section-break"></div>
<h2>Hot Dog Shop Weekly Series – Current Week</h2>
${buildHtmlTable(['Field', 'Value'], currentWeekRows.summary)}
<h2>Other Players (1 point each)</h2>
${buildHtmlTable(['#', 'Player'], currentWeekRows.others)}
<h2>Season Leaderboard Snapshot</h2>
${buildHtmlTable(['Rank', 'Player', 'Best 6', 'Weeks', 'Raw', 'Eligible', 'Status'], seriesRows)}
<h2>Top 16</h2>
${buildHtmlTable(['Seed', 'Player', 'Best 6', 'Weeks'], top16Rows)}
<h2>Wildcard Pool</h2>
${buildHtmlTable(['#', 'Player', 'Best 6', 'Weeks'], wildcardRows)}
</body></html>`;
}

function openHtmlForPrint(html) {
  const printWindow = window.open('', '_blank', 'width=1100,height=850');
  if (!printWindow) {
    alert('Popup blocked. Please allow popups for this site to export the PDF.');
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 300);
}

function exportFullTournamentPdf() {
  openHtmlForPrint(buildTournamentReportHtml());
}

function buildWorksheetXml(sheetName, headers, rows) {
  const makeCell = value => `<Cell><Data ss:Type="String">${xmlEscape(value)}</Data></Cell>`;
  let xml = `<Worksheet ss:Name="${xmlEscape(sheetName).slice(0, 31)}"><Table>`;
  xml += '<Row>' + headers.map(makeCell).join('') + '</Row>';
  if (!rows.length) {
    xml += `<Row>${makeCell('No data recorded.')}</Row>`;
  } else {
    rows.forEach(row => {
      xml += '<Row>' + row.map(makeCell).join('') + '</Row>';
    });
  }
  xml += '</Table></Worksheet>';
  return xml;
}

function downloadExcelWorkbook(filename, sheets) {
  const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Styles><Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Bottom"/><Borders/><Font/><Interior/><NumberFormat/><Protection/></Style></Styles>
 ${sheets.join('\n')}
</Workbook>`;
  downloadTextFile(filename, workbook, 'application/vnd.ms-excel;charset=utf-8');
}

function exportFullTournamentExcel() {
  const currentWeekRows = getCurrentWeekRows();
  const views = getWeeklySeriesViews();
  const sheets = [];
  sheets.push(buildWorksheetXml('Summary', ['Field', 'Value'], getSummaryRows()));
  sheets.push(buildWorksheetXml('Players', ['#', 'Player', 'Gender', 'Paid'], players.map((p, idx) => [idx + 1, formatDisplayName(p), p.gender || '-', p.paid ? 'Yes' : 'No'])));
  sheets.push(buildWorksheetXml('Teams', ['Team #', 'Player 1', 'Player 2'], teams.map(team => [team.id, formatDisplayName(team.player1), team.player2 ? formatDisplayName(team.player2) : '(bye)'])));
  sheets.push(buildWorksheetXml('Match Log', ['Bracket', 'Round', 'Match #', 'Board', 'Team A', 'Team B', 'Winner'], getMatchLogEntries().map(m => [m.bracket, m.round, m.matchId, m.board, m.teamA, m.teamB, m.winner])));
  sheets.push(buildWorksheetXml('Standings', ['Rank', 'Team', 'Losses', 'Status'], getTeamRankings().map(r => [r.rank, formatTeamLabel(r.team), r.losses, r.status])));
  sheets.push(buildWorksheetXml('Court Assignments', ['Board', 'Match', 'Teams', 'Status'], getCourtAssignmentRows().map(r => [r.board, r.match, r.teams, r.status])));
  sheets.push(buildWorksheetXml('Mystery Out', ['#', 'Player', 'Out #', 'Timestamp'], mysteryOutEntries.map((entry, idx) => { const p = getPlayerById(entry.playerId); return [idx + 1, p ? formatDisplayName(p) : 'Unknown', entry.outNumber, entry.timestamp || '-']; })));
  sheets.push(buildWorksheetXml('Big Hits', ['#', 'Type', 'Player', 'Timestamp'], specialShots.map((shot, idx) => { const p = getPlayerById(shot.playerId); return [idx + 1, shot.type || '-', p ? formatDisplayName(p) : 'Unknown', shot.timestamp || '-']; })));
  sheets.push(buildWorksheetXml('Payouts', ['Field', 'Value'], getPayoutSummaryRows()));
  sheets.push(buildWorksheetXml('Weekly Results', ['Field', 'Value'], currentWeekRows.summary));
  sheets.push(buildWorksheetXml('Weekly Others', ['#', 'Player'], currentWeekRows.others));
  sheets.push(buildWorksheetXml('Series Leaderboard', ['Rank', 'Player', 'Best 6', 'Weeks', 'Raw', 'Eligible', 'Status'], getSeriesSnapshotRows()));
  sheets.push(buildWorksheetXml('Top 16', ['Seed', 'Player', 'Best 6', 'Weeks'], views.top16.map((row, idx) => [idx + 1, row.player ? formatDisplayName(row.player) : '(unknown player)', row.best6Points, row.weeksPlayed])));
  sheets.push(buildWorksheetXml('Wildcard Pool', ['#', 'Player', 'Best 6', 'Weeks'], views.wildcardPool.map((row, idx) => [idx + 1, row.player ? formatDisplayName(row.player) : '(unknown player)', row.best6Points, row.weeksPlayed])));
  downloadExcelWorkbook(`${safeFilenamePart(tournamentMeta.location || 'darts-tournament')}_${safeFilenamePart(tournamentMeta.date || 'export')}_full-tournament.xls`, sheets);
}

function buildCurrentWeekReportHtml() {
  const currentWeekRows = getCurrentWeekRows();
  const matchRows = getMatchLogEntries().map(m => [m.bracket, m.round, m.matchId, m.board, m.teamA, m.teamB, m.winner]);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8" /><title>Current Week Export</title><style>
body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
h1, h2 { margin-bottom: 8px; }
table { width: 100%; border-collapse: collapse; margin: 10px 0 18px; }
th, td { border: 1px solid #999; padding: 6px 8px; font-size: 12px; text-align: left; vertical-align: top; }
th { background: #eee; }
</style></head><body>
<h1>Hot Dog Shop Weekly Tournament Export</h1>
<p><strong>Date:</strong> ${escapeHtml(tournamentMeta.date || '-')} &nbsp; <strong>Time:</strong> ${escapeHtml(tournamentMeta.time || '-')} &nbsp; <strong>Location:</strong> ${escapeHtml(tournamentMeta.location || '-')}</p>
<h2>Current Week Results</h2>
${buildHtmlTable(['Field', 'Value'], currentWeekRows.summary)}
<h2>Other Players</h2>
${buildHtmlTable(['#', 'Player'], currentWeekRows.others)}
<h2>Match Log</h2>
${buildHtmlTable(['Bracket', 'Round', 'Match #', 'Board', 'Team A', 'Team B', 'Winner'], matchRows)}
<h2>Standings</h2>
${buildHtmlTable(['Rank', 'Team', 'Losses', 'Status'], getTeamRankings().map(r => [r.rank, formatTeamLabel(r.team), r.losses, r.status]))}
<h2>Court Assignments</h2>
${buildHtmlTable(['Board', 'Match', 'Teams', 'Status'], getCourtAssignmentRows().map(r => [r.board, r.match, r.teams, r.status]))}
<h2>Mystery Out</h2>
${buildHtmlTable(['#', 'Player', 'Out #', 'Timestamp'], mysteryOutEntries.map((entry, idx) => { const p = getPlayerById(entry.playerId); return [idx + 1, p ? formatDisplayName(p) : 'Unknown', entry.outNumber, entry.timestamp || '-']; }))}
<h2>Big Hits</h2>
${buildHtmlTable(['#', 'Type', 'Player', 'Timestamp'], specialShots.map((shot, idx) => { const p = getPlayerById(shot.playerId); return [idx + 1, shot.type || '-', p ? formatDisplayName(p) : 'Unknown', shot.timestamp || '-']; }))}
</body></html>`;
}

function exportCurrentWeekPdf() {
  const week = getSelectedSeriesWeekData();
  if (!week) {
    alert('Please select a saved Hot Dog Shop week first.');
    return;
  }
  openHtmlForPrint(buildCurrentWeekReportHtml());
}

function exportCurrentWeekExcel() {
  const week = getSelectedSeriesWeekData();
  if (!week) {
    alert('Please select a saved Hot Dog Shop week first.');
    return;
  }
  const currentWeekRows = getCurrentWeekRows();
  const sheets = [];
  sheets.push(buildWorksheetXml('Weekly Results', ['Field', 'Value'], currentWeekRows.summary));
  sheets.push(buildWorksheetXml('Other Players', ['#', 'Player'], currentWeekRows.others));
  sheets.push(buildWorksheetXml('Match Log', ['Bracket', 'Round', 'Match #', 'Board', 'Team A', 'Team B', 'Winner'], getMatchLogEntries().map(m => [m.bracket, m.round, m.matchId, m.board, m.teamA, m.teamB, m.winner])));
  sheets.push(buildWorksheetXml('Standings', ['Rank', 'Team', 'Losses', 'Status'], getTeamRankings().map(r => [r.rank, formatTeamLabel(r.team), r.losses, r.status])));
  sheets.push(buildWorksheetXml('Court Assignments', ['Board', 'Match', 'Teams', 'Status'], getCourtAssignmentRows().map(r => [r.board, r.match, r.teams, r.status])));
  sheets.push(buildWorksheetXml('Mystery Out', ['#', 'Player', 'Out #', 'Timestamp'], mysteryOutEntries.map((entry, idx) => { const p = getPlayerById(entry.playerId); return [idx + 1, p ? formatDisplayName(p) : 'Unknown', entry.outNumber, entry.timestamp || '-']; })));
  sheets.push(buildWorksheetXml('Big Hits', ['#', 'Type', 'Player', 'Timestamp'], specialShots.map((shot, idx) => { const p = getPlayerById(shot.playerId); return [idx + 1, shot.type || '-', p ? formatDisplayName(p) : 'Unknown', shot.timestamp || '-']; })));
  const weekKey = getSelectedSeriesWeekKey();
  downloadExcelWorkbook(`hot-dog-shop_${safeFilenamePart(weekKey || tournamentMeta.date || 'week')}_weekly-export.xls`, sheets);
}


function applyDecodedFirebaseBundle(data) {
  if (Array.isArray(data.playerDatabase)) {
    playerDatabase = data.playerDatabase;
    savePlayerDatabase();
  }
  if (data.weeklySeriesState) {
    weeklySeriesState = {
      weeks: data.weeklySeriesState.weeks || {},
      wildcardDraw: Array.isArray(data.weeklySeriesState.wildcardDraw) ? data.weeklySeriesState.wildcardDraw : [],
      qualifierBracket: data.weeklySeriesState.qualifierBracket || null
    };
    saveWeeklySeriesState();
  }
  if (data.tournamentState) {
    applyTournamentState(data.tournamentState);
    persistTournamentStateSilent();
  }
  rerenderAll();
}

function renderFirebaseTournamentWeekSelect() {
  const sel = document.getElementById('firebase-tournament-select');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">Select a saved tournament…</option>';
  firebaseTournamentWeekList.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.id;
    const ts = item.savedAt || item.tournamentState?.tournamentMeta?.date || item.id;
    const loc = item.tournamentState?.tournamentMeta?.location || '-';
    opt.textContent = `${item.id} · ${loc} · ${ts}`;
    sel.appendChild(opt);
  });
  if (current && firebaseTournamentWeekList.some(item => item.id === current)) sel.value = current;
}

async function refreshFirebaseTournamentWeekList() {
  const db = requireFirebaseDb();
  const snap = await db.collection('tournamentByWeek').get();
  firebaseTournamentWeekList = snap.docs.map(doc => ({ id: doc.id, ...(doc.data() || {}) }))
    .sort((a, b) => String(b.id).localeCompare(String(a.id)));
  renderFirebaseTournamentWeekSelect();
}

async function loadSelectedFirebaseTournamentWeek() {
  const sel = document.getElementById('firebase-tournament-select');
  const id = sel ? sel.value : '';
  if (!id) {
    alert('Select a saved tournament first.');
    return;
  }
  try {
    updateFirebaseStatus('working', 'Loading selected tournament from Firebase...');
    const db = requireFirebaseDb();
    const doc = await db.collection('tournamentByWeek').doc(id).get();
    if (!doc.exists) {
      alert('That saved tournament was not found.');
      return;
    }
    const data = decodeFromFirestore(doc.data() || {});
    applyDecodedFirebaseBundle(data);
    updateFirebaseStatus('connected', `Firebase connected: ${getStoredFirebaseConfig().projectId}`);
    alert(`Loaded saved tournament: ${id}`);
  } catch (err) {
    console.error(err);
    updateFirebaseStatus('missing', err.message || 'Load failed');
    alert(err.message || 'Failed to load selected tournament.');
  }
}

async function refreshFirebaseArchives() {
  const target = document.getElementById('firebase-archives-list');
  if (!target) return;
  try {
    updateFirebaseStatus('working', 'Loading tournament history from Firebase...');
    const db = requireFirebaseDb();
    await refreshFirebaseTournamentWeekList();
    const snap = await db.collection('tournaments').orderBy('savedAt', 'desc').limit(20).get();
    firebaseArchiveList = snap.docs.map(doc => ({ id: doc.id, ...(doc.data() || {}) }));
    if (!firebaseArchiveList.length) {
      target.textContent = 'No archived tournaments found yet.';
    } else {
      target.innerHTML = firebaseArchiveList.map(item => {
        const ts = item.savedAt || item.tournamentState?.tournamentMeta?.date || item.id;
        const loc = item.tournamentState?.tournamentMeta?.location || '-';
        return `<div class="archive-row"><button type="button" onclick="loadFirebaseArchiveById('${item.id}')">Load</button> <strong>${item.id}</strong><br><span class="note">${ts} · ${loc}</span></div>`;
      }).join('');
    }
    updateFirebaseStatus('connected', `Firebase connected: ${getStoredFirebaseConfig().projectId}`);
  } catch (err) {
    console.error(err);
    updateFirebaseStatus('missing', err.message || 'History load failed');
    if (target) target.textContent = err.message || 'Failed to load archived tournaments.';
  }
}

async function loadFirebaseArchiveById(archiveId) {
  try {
    const db = requireFirebaseDb();
    const doc = await db.collection('tournaments').doc(archiveId).get();
    if (!doc.exists) { alert('Archive not found.'); return; }
    const data = decodeFromFirestore(doc.data() || {});
    applyDecodedFirebaseBundle(data);
    alert(`Loaded archived tournament: ${archiveId}`);
  } catch (err) {
    console.error(err);
    alert(err.message || 'Failed to load archived tournament.');
  }
}
window.loadFirebaseArchiveById = loadFirebaseArchiveById;

function buildTournamentEmailBody() {
  const rankings = getTeamRankings();
  const lines = [];
  lines.push(`Tournament Date: ${tournamentMeta.date || '-'}`);
  lines.push(`Time: ${tournamentMeta.time || '-'}`);
  lines.push(`Location: ${tournamentMeta.location || '-'}`);
  lines.push('');
  lines.push(`Players: ${players.length}`);
  lines.push(`Teams: ${teams.length}`);
  lines.push(`Champion: ${finalsState.champion ? formatTeamLabel(finalsState.champion) : 'TBD'}`);
  lines.push(`Runner-up: ${finalsState.runnerUp ? formatTeamLabel(finalsState.runnerUp) : 'TBD'}`);
  lines.push('');
  lines.push('Standings:');
  rankings.slice(0, 8).forEach(r => lines.push(`${r.rank}. ${formatTeamLabel(r.team)} (${r.status})`));
  lines.push('');
  lines.push(`Mystery Out total: ${document.getElementById('mo-amount')?.textContent || '$0.00'}`);
  lines.push(`Tournament Prize Pool: ${document.getElementById('tournament-prize-pool')?.textContent || '$0.00'}`);
  return lines.join('\n');
}

function openTournamentEmailDraft() {
  const email = (document.getElementById('email-export-address')?.value || '').trim();
  if (!email) { alert('Enter an email address first.'); return; }
  const subject = encodeURIComponent(`Tournament Summary - ${tournamentMeta.date || 'Camarillo Darts'}`);
  const body = encodeURIComponent(buildTournamentEmailBody());
  window.location.href = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
}

async function finalizeTournament() {
  if (!confirm("Finalize tournament and save everything?")) return;

  try {
    if (typeof autoFillSeriesWeekFromTournament === "function") autoFillSeriesWeekFromTournament();
    if (typeof saveSelectedSeriesWeekFromForm === "function") saveSelectedSeriesWeekFromForm();
    await saveWeeklySeriesToFirebase();
    await saveTournamentToFirebase();
    await archiveTournamentToFirebase();
    if (typeof exportFullTournamentPdf === "function") exportFullTournamentPdf();
    if (typeof exportFullTournamentExcel === "function") exportFullTournamentExcel();
    if (typeof openTournamentEmailDraft === "function") openTournamentEmailDraft();

    alert("Tournament finalized successfully!");
  } catch (err) {
    console.error(err);
    alert("Error during finalize process.");
  }
}

document.getElementById("finalize-tournament-btn")
  .addEventListener("click", finalizeTournament);


(function attachManagePlayerDbInit() {
  const run = () => {
    if (typeof initManagePlayerDbPanel === "function") initManagePlayerDbPanel();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();

