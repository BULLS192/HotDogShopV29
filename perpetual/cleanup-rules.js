// Conservative read-only cleanup rules discovered from the live Firebase audit.
// Raw Firebase exports still retain every source record; these exclusions only
// affect the clean/perpetual view and Nexus migration preview.

function isAdministrativePlayerPlaceholder(player) {
  const key = normalizeText(player?.firstName || player?.name || "");
  return ["buy back", "bye", "open spot", "vacant"].includes(key);
}

const originalAddIdentityRecordForCleanup = addIdentityRecord;
addIdentityRecord = function addIdentityRecordWithCleanup(player, source, contextId = "global") {
  if (isAdministrativePlayerPlaceholder(player)) return;
  return originalAddIdentityRecordForCleanup(player, source, contextId);
};

const originalBuildEventForCleanup = buildEvent;
buildEvent = function buildEventWithCleanup(doc) {
  const event = originalBuildEventForCleanup(doc);
  if (!event) return null;

  // The Hot Dog Shop Firebase project currently contains only Hot Dog Shop
  // tournamentByWeek documents, but keep the perpetual view venue-specific.
  if (!normalizeText(event.location).includes("hot dog")) return null;

  event.players = event.players.filter(player => !isAdministrativePlayerPlaceholder(player));

  // Ignore empty duplicate/save-shell documents in the clean event ledger.
  // Example found in the 2026-08-29 audit: 2026-04-29_location (0 players, 0 teams).
  if (!event.players.length && !event.teams.length && !event.champion && !event.runnerUp) return null;

  return event;
};

const originalRenderMetricsForCleanup = renderMetrics;
renderMetrics = function renderMetricsWithCleanup() {
  originalRenderMetricsForCleanup();
  const rawCount = state.raw.tournamentByWeek.length;
  const cleanCount = state.events.length;
  if (rawCount > cleanCount) {
    $("metric-event-range").textContent += ` · ${rawCount - cleanCount} raw snapshot(s) excluded`;
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const table = document.getElementById("duplicate-table");
  const section = table?.closest("section");
  if (!section || document.getElementById("cleanup-audit-note")) return;
  const note = document.createElement("p");
  note.id = "cleanup-audit-note";
  note.className = "muted";
  note.innerHTML = "Live audit cleanup rules also exclude empty save-shell tournament documents and administrative placeholders such as <code>BUY BACK</code> from clean standings. Raw exports remain untouched.";
  table.parentElement?.insertAdjacentElement("afterend", note);
});
