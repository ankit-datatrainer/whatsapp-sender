const socket = io();

// ---------- State ----------
let uploaded = null;        // { filePath, sheetNames, columns, ... }
let templates = [];

// ---------- Helpers ----------
const $ = id => document.getElementById(id);
function fillSelect(sel, items, { keep = false } = {}) {
  const prev = sel.value;
  sel.innerHTML = '';
  items.forEach(v => {
    const o = document.createElement('option');
    o.value = v; o.textContent = v; sel.appendChild(o);
  });
  if (keep && items.includes(prev)) sel.value = prev;
}

// =================================================================
// STEP 1 — Upload data file
// =================================================================
$('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append('datafile', file);
  $('fileInfo').classList.remove('hidden');
  $('fileInfo').textContent = 'Uploading & parsing...';
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    uploaded = data;
    renderFileInfo();
  } catch (err) {
    $('fileInfo').textContent = 'Error: ' + err.message;
  }
});

function renderFileInfo() {
  $('fileInfo').innerHTML =
    `<b>${uploaded.fileName}</b> — ${uploaded.rowCount} rows, ${uploaded.columns.length} columns`;
  // sheets
  if (uploaded.sheetNames.length > 1) {
    $('sheetWrap').classList.remove('hidden');
    fillSelect($('sheetSelect'), uploaded.sheetNames);
  }
  applyColumns(uploaded.columns, uploaded.preview);
  guessMapping();
  updateStartState();
}

function applyColumns(columns, preview) {
  $('mapWrap').classList.remove('hidden');
  $('previewWrap').classList.remove('hidden');
  fillSelect($('nameCol'), columns, { keep: true });
  fillSelect($('phoneCol'), columns, { keep: true });
  renderPreview(columns, preview);
}

function guessMapping() {
  const cols = uploaded.columns;
  const find = (re) => cols.find(c => re.test(c));
  const nameC = find(/name/i); if (nameC) $('nameCol').value = nameC;
  const phoneC = find(/phone|number|whatsapp|mobile|contact/i); if (phoneC) $('phoneCol').value = phoneC;
}

function renderPreview(columns, rows) {
  const t = $('previewTable');
  t.innerHTML = '';
  const thead = document.createElement('tr');
  columns.forEach(c => { const th = document.createElement('th'); th.textContent = c; thead.appendChild(th); });
  t.appendChild(thead);
  rows.forEach(r => {
    const tr = document.createElement('tr');
    columns.forEach(c => { const td = document.createElement('td'); td.textContent = r[c]; tr.appendChild(td); });
    t.appendChild(tr);
  });
}

$('sheetSelect').addEventListener('change', async () => {
  const res = await fetch('/api/sheet', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath: uploaded.filePath, sheetName: $('sheetSelect').value }),
  });
  const data = await res.json();
  if (data.error) return alert(data.error);
  uploaded.columns = data.columns;
  uploaded.rowCount = data.rowCount;
  uploaded.preview = data.preview;
  applyColumns(data.columns, data.preview);
  guessMapping();
});

// =================================================================
// STEP 2 — Templates
// =================================================================
async function loadTemplates() {
  templates = await (await fetch('/api/templates')).json();
  renderTemplateSelect();
}
function renderTemplateSelect() {
  const sel = $('templateSelect');
  sel.innerHTML = '<option value="">— New template —</option>';
  templates.forEach(t => {
    const o = document.createElement('option');
    o.value = t.id; o.textContent = t.name; sel.appendChild(o);
  });
  refreshStepTemplateDropdowns();
}
$('templateSelect').addEventListener('change', () => {
  const t = templates.find(x => x.id === $('templateSelect').value);
  $('tplName').value = t ? t.name : '';
  $('tplBody').value = t ? t.body : '';
});
$('saveTplBtn').addEventListener('click', async () => {
  const name = $('tplName').value.trim();
  const body = $('tplBody').value.trim();
  if (!name || !body) return alert('Template name and body are required.');
  const id = $('templateSelect').value || undefined;
  templates = await (await fetch('/api/templates', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name, body }),
  })).json();
  renderTemplateSelect();
  alert('Template saved.');
});
$('deleteTplBtn').addEventListener('click', async () => {
  const id = $('templateSelect').value;
  if (!id) return;
  if (!confirm('Delete this template?')) return;
  templates = await (await fetch('/api/templates/' + id, { method: 'DELETE' })).json();
  $('tplName').value = ''; $('tplBody').value = '';
  renderTemplateSelect();
});

// =================================================================
// STEP 3 — Message sequence
// =================================================================
let stepId = 0;
function addStep(prefill = {}) {
  const id = ++stepId;
  const div = document.createElement('div');
  div.className = 'step';
  div.dataset.id = id;
  div.innerHTML = `
    <div class="step-head">
      <strong>Message #<span class="num"></span></strong>
      <button class="rm" title="Remove">&times;</button>
    </div>
    <div class="delay-row delayWrap">
      Send after <input type="number" class="delay" min="0" value="${prefill.delay ?? 0}"> seconds
    </div>
    <label>Use template
      <select class="stepTpl"><option value="">— custom text —</option></select>
    </label>
    <textarea class="stepBody" rows="3" placeholder="Message text, e.g. Hey {{Name}}!">${prefill.body || ''}</textarea>
  `;
  $('sequence').appendChild(div);
  div.querySelector('.rm').addEventListener('click', () => { div.remove(); renumberSteps(); });
  const tplSel = div.querySelector('.stepTpl');
  tplSel.addEventListener('change', () => {
    const t = templates.find(x => x.id === tplSel.value);
    if (t) div.querySelector('.stepBody').value = t.body;
  });
  refreshStepTemplateDropdowns();
  renumberSteps();
}
function renumberSteps() {
  document.querySelectorAll('#sequence .step').forEach((s, i) => {
    s.querySelector('.num').textContent = i + 1;
    s.querySelector('.delayWrap').style.display = i === 0 ? 'none' : 'flex';
  });
}
function refreshStepTemplateDropdowns() {
  document.querySelectorAll('.stepTpl').forEach(sel => {
    const prev = sel.value;
    sel.innerHTML = '<option value="">— custom text —</option>';
    templates.forEach(t => {
      const o = document.createElement('option');
      o.value = t.id; o.textContent = t.name; sel.appendChild(o);
    });
    sel.value = prev;
  });
}
function collectMessages() {
  return [...document.querySelectorAll('#sequence .step')].map((s, i) => ({
    delay: i === 0 ? 0 : parseInt(s.querySelector('.delay').value) || 0,
    body: s.querySelector('.stepBody').value.trim(),
  })).filter(m => m.body);
}
$('addStepBtn').addEventListener('click', () => addStep());

// =================================================================
// STEP 4 — Connect & launch
// =================================================================
$('connectBtn').addEventListener('click', () => {
  // Disable button to prevent double-clicks while reconnecting
  $('connectBtn').disabled = true;
  $('connectBtn').textContent = 'Connecting...';
  socket.emit('connect-whatsapp');
  $('qrBox').innerHTML = '<p class="hint">Disconnecting previous session & starting fresh... A QR code will appear shortly.</p>';
});

let waReady = false;
function updateStartState() {
  $('startBtn').disabled = !(waReady && uploaded && collectMessages().length > 0);
}
$('sequence').addEventListener('input', updateStartState);

$('startBtn').addEventListener('click', () => {
  const messages = collectMessages();
  if (!messages.length) return alert('Add at least one message step.');
  resetReports();
  socket.emit('start-campaign', {
    filePath: uploaded.filePath,
    sheetName: uploaded.sheetNames.length > 1 ? $('sheetSelect').value : uploaded.sheetNames[0],
    nameColumn: $('nameCol').value,
    phoneColumn: $('phoneCol').value,
    defaultCountryCode: $('countryCode').value.replace(/\D/g, ''),
    messages,
    minDelay: parseInt($('minDelay').value) || 0,
    maxDelay: parseInt($('maxDelay').value) || 0,
    limit: parseInt($('limit').value) || 0,
  });
  $('startBtn').classList.add('hidden');
  $('stopBtn').classList.remove('hidden');
});
$('stopBtn').addEventListener('click', () => socket.emit('stop-campaign'));

// =================================================================
// Reports & progress
// =================================================================
let counts = { success: 0, fail: 0, total: 0 };
function resetReports() {
  counts = { success: 0, fail: 0, total: 0 };
  $('successList').innerHTML = ''; $('failList').innerHTML = '';
  updateCounts(); $('progressFill').style.width = '0%';
}
function updateCounts() {
  $('successCount').textContent = counts.success;
  $('failCount').textContent = counts.fail;
  $('totalCount').textContent = counts.total;
}
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    $('successList').classList.toggle('hidden', tab.dataset.tab !== 'successList');
    $('failList').classList.toggle('hidden', tab.dataset.tab !== 'failList');
  });
});

// =================================================================
// Socket events
// =================================================================
socket.on('status', (s) => { if (s.waReady) markReady(); });
socket.on('qr', (dataUrl) => { $('qrBox').innerHTML = `<img src="${dataUrl}" alt="QR" />`; });
socket.on('wa-ready', markReady);
function markReady() {
  waReady = true;
  $('waDot').className = 'dot on';
  $('waText').textContent = 'Connected';
  $('qrBox').innerHTML = '<p class="hint" style="color:var(--wa-green)">Connected &amp; authenticated. Session saved. You can start a campaign.</p>';
  $('connectBtn').classList.add('hidden');
  $('connectBtn').disabled = false;
  $('connectBtn').textContent = 'Connect WhatsApp';
  $('disconnectBtn').classList.remove('hidden');
  $('logoutBtn').classList.remove('hidden');
  updateStartState();
}
socket.on('wa-disconnected', () => {
  waReady = false;
  $('waDot').className = 'dot off';
  $('waText').textContent = 'Disconnected';
  $('connectBtn').classList.remove('hidden');
  $('connectBtn').disabled = false;
  $('connectBtn').textContent = 'Connect WhatsApp';
  $('disconnectBtn').classList.add('hidden');
  $('logoutBtn').classList.add('hidden');
  $('qrBox').innerHTML = '<p class="hint">Disconnected. Click "Connect WhatsApp" to start a new session.</p>';
  updateStartState();
});

// Disconnect: keeps the saved session so reconnecting is instant.
$('disconnectBtn').addEventListener('click', () => {
  socket.emit('disconnect-whatsapp', { logout: false });
  $('disconnectBtn').classList.add('hidden');
  $('logoutBtn').classList.add('hidden');
  $('waText').textContent = 'Disconnecting...';
});

// Logout: clears the saved session — next connect will require a fresh QR scan.
$('logoutBtn').addEventListener('click', () => {
  if (!confirm('Log out and clear the saved session?\n\nYou will need to scan a new QR code next time.')) return;
  socket.emit('disconnect-whatsapp', { logout: true });
  document.cookie = "auth=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
  window.location.href = '/';
});

socket.on('wa-loading', ({ percent }) => {
  if (waReady) return;
  $('qrBox').innerHTML = `<div style="width:100%"><p class="hint">Restoring WhatsApp session... ${percent}%</p>
    <div class="progress-bar"><div style="height:100%;width:${percent}%;background:var(--wa-green);border-radius:6px"></div></div></div>`;
});
socket.on('wa-slow', () => {
  if (waReady) return;
  $('qrBox').innerHTML = '<p class="hint" style="color:var(--amber)">Taking longer than usual to finalize. ' +
    'If it does not connect, the saved session may be stale — stop the server, delete the <code>.wwebjs_auth</code> folder, restart, and reconnect to scan a fresh QR.</p>';
});

socket.on('wa-error', (msg) => {
  $('qrBox').innerHTML = `<p class="hint" style="color:var(--red)">Connection failed: ${msg}<br>Check the live log and try again.</p>`;
});
socket.on('wa-auth-failure', () => {
  $('qrBox').innerHTML = '<p class="hint" style="color:var(--red)">Authentication failed. Click Connect to retry.</p>';
});

socket.on('campaign-start', ({ total }) => {
  counts.total = total; updateCounts();
  $('progressText').textContent = `Running... 0 / ${total}`;
});
socket.on('contact-result', (r) => {
  if (r.status === 'success') {
    counts.success++;
    $('successList').insertAdjacentHTML('beforeend',
      `<div class="report-item"><span>${r.name}</span><span>${r.phone}</span></div>`);
  } else {
    counts.fail++;
    $('failList').insertAdjacentHTML('beforeend',
      `<div class="report-item"><span>${r.name} (${r.phone || '—'})</span><span class="reason">${r.reason}</span></div>`);
  }
  updateCounts();
  const done = counts.success + counts.fail;
  $('progressFill').style.width = (counts.total ? (done / counts.total * 100) : 0) + '%';
  $('progressText').textContent = `Running... ${done} / ${counts.total}`;
});
socket.on('campaign-done', ({ success, failed }) => {
  $('progressText').textContent = `Done! ${success} sent, ${failed} failed.`;
  $('startBtn').classList.remove('hidden');
  $('stopBtn').classList.add('hidden');
});

socket.on('log', ({ time, message, level }) => {
  const box = $('logBox');
  const line = document.createElement('div');
  line.className = 'log-line ' + (level || '');
  line.innerHTML = `<span class="t">[${time}]</span> ${message}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
});

// ---------- Init ----------
loadTemplates();
addStep({ body: "Hey {{Name}}! Hope you're doing well." });
