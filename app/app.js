import { fetchIncidents, ack } from './api.js';

const REFRESH_MS = 2000; // R4

const board = document.querySelector('[data-testid="board"]');
const list = document.querySelector('[data-testid="incident-list"]');
const loader = document.querySelector('[data-testid="loader"]');
const empty = document.querySelector('[data-testid="empty"]');
const newBar = document.querySelector('[data-testid="new-bar"]');

/** id -> { ackedAt, receipt } for rows acked in this page (survives every refresh). */
const acked = new Map();
/** id -> <li>; rows are kept, never rebuilt, so a refresh does not swap a button under the pointer. */
const rows = new Map();

// R5: viewer's local time zone and the viewer's own date order (dd/mm in EU locales).
const timeFormat = new Intl.DateTimeFormat(navigator.languages?.length ? navigator.languages : undefined, {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function markAcked(row, id) {
  const info = acked.get(id);
  const button = row.querySelector('[data-testid="ack"]');
  if (button) button.remove();
  if (!row.querySelector('[data-testid="acked"]')) {
    row.append(el('span', { 'data-testid': 'acked', class: 'acked', title: info?.ackedAt ?? '' }, 'acked'));
  }
  row.classList.add('is-acked');
}

function buildRow(i) {
  const row = el('li', { 'data-testid': 'incident-row', 'data-id': i.id, class: `row ${i.severity}` });
  row.append(
    el('span', { class: 'id' }, i.id),
    el('span', { class: 'sev' }, i.severity),
    el('span', { class: 'what' }, `${i.service} · ${i.region} · ${i.summary}`),
    el('time', { datetime: i.openedAt, title: i.openedAt }, timeFormat.format(new Date(i.openedAt))),
  );
  if (acked.has(i.id)) {
    markAcked(row, i.id);
  } else {
    const button = el('button', { type: 'button', 'data-testid': 'ack', class: 'ack' }, 'Ack');
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const reply = await ack(i.id); // R2
        acked.set(i.id, reply);
        markAcked(row, i.id);
      } catch (err) {
        console.error(err);
        button.disabled = false;
      }
    });
    row.append(button);
  }
  return row;
}

/** Puts the given incidents on screen, newest first, reusing existing rows. */
function render(incidents) {
  const sorted = [...incidents].sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
  const seen = new Set();
  let anchor = null; // the row the next one goes after
  for (const i of sorted) {
    seen.add(i.id);
    let row = rows.get(i.id);
    if (!row) {
      row = buildRow(i);
      rows.set(i.id, row);
    }
    const want = anchor ? anchor.nextSibling : list.firstChild;
    if (row !== want) list.insertBefore(row, want);
    anchor = row;
  }
  for (const [id, row] of rows) {
    if (!seen.has(id)) {
      row.remove();
      rows.delete(id);
    }
  }
  empty.hidden = sorted.length > 0;
  list.hidden = sorted.length === 0;
}

/** R1 (product decision): the list holds still; new incidents wait behind the "N new" bar until on-call clicks it. */
let latest = [];
function pendingCount() {
  return latest.filter((i) => !rows.has(i.id)).length;
}
function updateBar() {
  const n = pendingCount();
  newBar.hidden = n === 0;
  newBar.textContent = `${n} new`;
  newBar.setAttribute('aria-label', `${n} new incident${n === 1 ? '' : 's'}, show them`);
}
newBar.addEventListener('click', () => {
  render(latest);
  updateBar();
});

let loaded = false;
let busy = false;
async function refresh() {
  if (busy) return;
  busy = true;
  try {
    const page = await fetchIncidents();
    latest = page.incidents;
    board.dataset.updatedAt = page.updatedAt;
    if (!loaded) {
      render(latest); // first load: everything on screen
      loaded = true;
      loader.remove(); // R3: gone once incidents are on screen
    }
    updateBar();
  } catch (err) {
    console.error(err);
  } finally {
    busy = false;
  }
}

await refresh();
setInterval(refresh, REFRESH_MS); // R4
