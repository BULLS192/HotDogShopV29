const LABELS = {
  confirmed: 'Confirmed',
  'recovered-pending-review': 'Recovered · review',
  'recovered-reviewed': 'Recovered · approved',
  partial: 'Partial · review',
  missing: 'Missing / unknown',
  disputed: 'Disputed',
  'cancelled-unverified': 'Cancelled?'
};

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function winnerOf(event) {
  if (event.recoveredPlacements?.['1']) return event.recoveredPlacements['1'].join(' & ');
  return event.storedChampion || '—';
}

function runnerUpOf(event) {
  if (event.recoveredPlacements?.['2']) return event.recoveredPlacements['2'].join(' & ');
  return event.storedRunnerUp || '—';
}

function issueText(event) {
  if (event.status === 'disputed') {
    return `DISPUTED: ${event.organizerCorrection?.claim || event.notes || ''}`;
  }
  return event.notes || '';
}

async function init() {
  const res = await fetch('reconstruction-ledger.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Ledger HTTP ${res.status}`);
  const ledger = await res.json();
  const events = ledger.events || [];

  const counts = events.reduce((acc, e) => {
    acc[e.status] = (acc[e.status] || 0) + 1;
    return acc;
  }, {});

  const metricItems = [
    ['Total dates', events.length],
    ['Confirmed', counts.confirmed || 0],
    ['Partial', counts.partial || 0],
    ['Missing', counts.missing || 0],
    ['Disputed', counts.disputed || 0],
    ['Recovered to review', counts['recovered-pending-review'] || 0]
  ];
  document.getElementById('metrics').innerHTML = metricItems.map(([label, value]) => `
    <div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>
  `).join('');

  document.getElementById('ledger-body').innerHTML = events
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .map(event => `
      <tr class="status-${esc(event.status)}">
        <td><strong>${esc(event.date)}</strong></td>
        <td><span class="status ${esc(event.status)}">${esc(LABELS[event.status] || event.status)}</span></td>
        <td>${esc(winnerOf(event))}</td>
        <td>${esc(runnerUpOf(event))}</td>
        <td>${esc(issueText(event))}</td>
      </tr>
    `).join('');
}

init().catch(error => {
  document.getElementById('ledger-body').innerHTML = `<tr><td colspan="5">Could not load ledger: ${esc(error.message)}</td></tr>`;
});
