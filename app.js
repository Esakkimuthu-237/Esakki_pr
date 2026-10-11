/* ===================================================
   PharmaCare – app.js  (localStorage backend)
   =================================================== */

'use strict';

/* ─── DATA LAYER ──────────────────────────────────── */
const DB_KEY = 'pharmacare_medicines';

function loadMedicines() {
  try { return JSON.parse(localStorage.getItem(DB_KEY)) || []; }
  catch { return []; }
}

function saveMedicines(list) {
  localStorage.setItem(DB_KEY, JSON.stringify(list));
}

function addMedicine(med) {
  const list = loadMedicines();
  med.id = Date.now().toString(36) + Math.random().toString(36).slice(2);
  med.createdAt = new Date().toISOString();
  list.unshift(med);
  saveMedicines(list);
  return med;
}

function deleteMedicine(id) {
  const list = loadMedicines().filter(m => m.id !== id);
  saveMedicines(list);
}

/* ─── STATUS HELPERS ─────────────────────────────── */
function today() {
  const d = new Date();
  d.setHours(0,0,0,0);
  return d;
}

function getStatus(expiryStr) {
  const exp = new Date(expiryStr);
  exp.setHours(0,0,0,0);
  const now = today();
  const diff = Math.ceil((exp - now) / 86400000); // days
  if (diff < 0)  return { label: 'Expired',       cls: 'expired',  icon: '⚠️',  days: diff };
  if (diff <= 7) return { label: 'Expiring Soon',  cls: 'expiring', icon: '⏳',  days: diff };
  return             { label: 'Safe',             cls: 'safe',     icon: '✅',  days: diff };
}

function fmtDate(str) {
  if (!str) return '—';
  const d = new Date(str);
  return d.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
}

/* ─── NAVIGATION ──────────────────────────────────── */
const pages = {
  dashboard: { el: document.getElementById('page-dashboard'), title: 'Dashboard' },
  add:       { el: document.getElementById('page-add'),       title: 'Add Medicine' },
  stock:     { el: document.getElementById('page-stock'),     title: 'Stock List' },
  alerts:    { el: document.getElementById('page-alerts'),    title: 'Alerts' },
  reports:   { el: document.getElementById('page-reports'),   title: 'Reports' },
};

function navigateTo(pageKey) {
  Object.values(pages).forEach(p => p.el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pg = pages[pageKey];
  if (!pg) return;
  pg.el.classList.add('active');
  document.querySelector(`.nav-item[data-page="${pageKey}"]`)?.classList.add('active');
  document.getElementById('topbarTitle').textContent = pg.title;

  // refresh content
  if (pageKey === 'dashboard') renderDashboard();
  if (pageKey === 'stock')     renderStock();
  if (pageKey === 'alerts')    renderAlerts();
  if (pageKey === 'reports')   renderReports();
}

document.querySelectorAll('[data-page]').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(el.dataset.page);
    if (window.innerWidth <= 768) sidebar.classList.remove('open');
  });
});

/* ─── HAMBURGER ──────────────────────────────────── */
const sidebar = document.getElementById('sidebar');
document.getElementById('hamburger').addEventListener('click', () => sidebar.classList.toggle('open'));
document.getElementById('notifBtn').addEventListener('click', () => navigateTo('alerts'));

/* ─── TODAY DATE ──────────────────────────────────── */
document.getElementById('todayDate').textContent =
  new Date().toLocaleDateString('en-IN', { weekday:'short', day:'2-digit', month:'short', year:'numeric' });

/* ─── FORM HANDLING ──────────────────────────────── */
const form = document.getElementById('medicineForm');

function validateForm() {
  let ok = true;
  const required = [
    ['fName','errName','Medicine name is required'],
    ['fBatch','errBatch','Batch number is required'],
    ['fReceived','errReceived','Date received is required'],
    ['fMarketed','errMarketed','Marketed date is required'],
    ['fExpiry','errExpiry','Expiry date is required'],
    ['fQty','errQty','Quantity is required'],
  ];
  required.forEach(([id, errId, msg]) => {
    const el = document.getElementById(id);
    const er = document.getElementById(errId);
    if (!el.value.trim()) {
      el.classList.add('invalid');
      er.textContent = msg;
      ok = false;
    } else {
      el.classList.remove('invalid');
      er.textContent = '';
    }
  });
  return ok;
}

form.addEventListener('submit', e => {
  e.preventDefault();
  if (!validateForm()) return;

  const med = {
    name:     document.getElementById('fName').value.trim(),
    generic:  document.getElementById('fGeneric').value.trim(),
    category: document.getElementById('fCategory').value,
    batch:    document.getElementById('fBatch').value.trim(),
    supplier: document.getElementById('fSupplier').value.trim(),
    received: document.getElementById('fReceived').value,
    marketed: document.getElementById('fMarketed').value,
    expiry:   document.getElementById('fExpiry').value,
    qty:      parseInt(document.getElementById('fQty').value),
    price:    parseFloat(document.getElementById('fPrice').value) || 0,
    storage:  document.getElementById('fStorage').value,
    notes:    document.getElementById('fNotes').value.trim(),
  };

  addMedicine(med);
  toast('Medicine saved successfully! 💊', 'success');
  form.reset();
  updateGlobalBadges();

  // ask browser notification
  if (Notification.permission === 'default') {
    Notification.requestPermission().then(checkBrowserNotifications);
  } else {
    checkBrowserNotifications();
  }
});

document.getElementById('clearFormBtn').addEventListener('click', () => form.reset());

/* ─── RENDER DASHBOARD ────────────────────────────── */
function renderDashboard() {
  const list = loadMedicines();
  let expired = 0, expiring = 0, safe = 0;
  list.forEach(m => {
    const s = getStatus(m.expiry);
    if (s.cls === 'expired')  expired++;
    else if (s.cls === 'expiring') expiring++;
    else safe++;
  });

  document.getElementById('statTotal').textContent   = list.length;
  document.getElementById('statExpired').textContent  = expired;
  document.getElementById('statExpiring').textContent = expiring;
  document.getElementById('statSafe').textContent     = safe;

  // banner
  const banner = document.getElementById('alertBanner');
  const msg    = document.getElementById('alertBannerMsg');
  if (expired + expiring > 0) {
    banner.style.display = 'flex';
    msg.textContent = `${expired} expired medicine(s) and ${expiring} medicine(s) expiring within 7 days need attention.`;
  } else {
    banner.style.display = 'none';
  }

  // recent 5
  const tbody = document.getElementById('recentTbody');
  const recent = list.slice(0, 5);
  if (!recent.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No medicines added yet.</td></tr>';
    return;
  }
  tbody.innerHTML = recent.map(m => {
    const s = getStatus(m.expiry);
    return `<tr>
      <td><strong>${esc(m.name)}</strong>${m.generic ? `<br><small style="color:var(--muted)">${esc(m.generic)}</small>` : ''}</td>
      <td><code>${esc(m.batch)}</code></td>
      <td>${fmtDate(m.received)}</td>
      <td>${fmtDate(m.marketed)}</td>
      <td>${fmtDate(m.expiry)}</td>
      <td>${m.qty}</td>
      <td><span class="pill ${s.cls}">${s.icon} ${s.label}</span></td>
    </tr>`;
  }).join('');
}

/* ─── RENDER STOCK ────────────────────────────────── */
let activeFilter = 'all';
let searchQuery  = '';

function renderStock() {
  let list = loadMedicines();

  // search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.batch.toLowerCase().includes(q) ||
      (m.supplier && m.supplier.toLowerCase().includes(q)) ||
      (m.generic  && m.generic.toLowerCase().includes(q))
    );
  }

  // filter
  if (activeFilter !== 'all') {
    list = list.filter(m => getStatus(m.expiry).cls === activeFilter);
  }

  const tbody = document.getElementById('stockTbody');
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-row">No medicines found.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map((m, i) => {
    const s = getStatus(m.expiry);
    return `<tr>
      <td style="color:var(--muted);font-size:.8rem">${i+1}</td>
      <td>
        <strong>${esc(m.name)}</strong>
        ${m.generic   ? `<br><small style="color:var(--muted)">${esc(m.generic)}</small>` : ''}
        ${m.category  ? `<br><span style="font-size:.72rem;background:#f1f5f9;border-radius:4px;padding:1px 6px">${esc(m.category)}</span>` : ''}
      </td>
      <td><code>${esc(m.batch)}</code></td>
      <td>${fmtDate(m.received)}</td>
      <td>${fmtDate(m.marketed)}</td>
      <td style="font-weight:600;color:${s.cls==='expired'?'var(--red)':s.cls==='expiring'?'var(--orange)':'var(--green-d)'}">${fmtDate(m.expiry)}</td>
      <td>${m.qty}</td>
      <td>${esc(m.supplier || '—')}</td>
      <td><span class="pill ${s.cls}">${s.icon} ${s.label}</span></td>
      <td>
        <div class="action-btns">
          <button class="btn-icon" title="View" onclick="openModal('${m.id}')">👁</button>
          <button class="btn-icon" title="Delete" onclick="confirmDelete('${m.id}','${esc(m.name)}')">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// search
document.getElementById('searchInput').addEventListener('input', e => {
  searchQuery = e.target.value;
  renderStock();
});

// filter chips
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    activeFilter = chip.dataset.filter;
    renderStock();
  });
});

// export CSV
document.getElementById('exportBtn').addEventListener('click', () => {
  const list = loadMedicines();
  if (!list.length) { toast('No medicines to export.', 'info'); return; }
  const headers = ['Name','Generic','Category','Batch','Supplier','Received','Marketed','Expiry','Qty','Price','Storage','Status','Notes'];
  const rows = list.map(m => {
    const s = getStatus(m.expiry);
    return [m.name,m.generic,m.category,m.batch,m.supplier,m.received,m.marketed,m.expiry,m.qty,m.price,m.storage,s.label,m.notes].map(v => `"${(v||'').toString().replace(/"/g,'""')}"`).join(',');
  });
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'pharmacare_stock.csv'; a.click();
  URL.revokeObjectURL(url);
  toast('CSV exported!', 'success');
});

/* ─── RENDER ALERTS ───────────────────────────────── */
function renderAlerts() {
  const list = loadMedicines();
  const flagged = list.filter(m => getStatus(m.expiry).cls !== 'safe');
  const container = document.getElementById('alertsContainer');

  if (!flagged.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎉</div>
        <div class="empty-title">All Clear!</div>
        <div class="empty-sub">No expired or soon-to-expire medicines.</div>
      </div>`;
    return;
  }

  // sort: expired first
  flagged.sort((a,b) => new Date(a.expiry) - new Date(b.expiry));

  container.innerHTML = flagged.map(m => {
    const s = getStatus(m.expiry);
    const daysText = s.days < 0
      ? `Expired ${Math.abs(s.days)} day(s) ago`
      : `Expires in ${s.days} day(s)`;
    return `
      <div class="alert-card ${s.cls}">
        <div class="alert-card-icon">${s.icon}</div>
        <div class="alert-card-info">
          <div class="alert-card-name">${esc(m.name)} ${m.generic ? `<small style="color:var(--muted);font-weight:400">(${esc(m.generic)})</small>` : ''}</div>
          <div class="alert-card-meta">
            📦 Batch: <strong>${esc(m.batch)}</strong> &nbsp;|&nbsp;
            📅 Expiry: <strong>${fmtDate(m.expiry)}</strong> &nbsp;|&nbsp;
            🏭 Supplier: ${esc(m.supplier || 'N/A')} &nbsp;|&nbsp;
            🧮 Qty: ${m.qty}
          </div>
          <div style="margin-top:6px;font-size:.82rem;font-weight:600;color:${s.cls==='expired'?'var(--red)':'var(--orange)'}">
            ${daysText}
          </div>
        </div>
        <div class="alert-card-badge">
          <span class="pill ${s.cls}">${s.label}</span>
        </div>
      </div>`;
  }).join('');
}

/* ─── RENDER REPORTS ──────────────────────────────── */
function renderReports() {
  const list = loadMedicines();

  // by category
  const catMap = {};
  list.forEach(m => {
    const k = m.category || 'Uncategorized';
    catMap[k] = (catMap[k] || 0) + 1;
  });
  const maxCat = Math.max(...Object.values(catMap), 1);
  document.getElementById('catReport').innerHTML = !list.length
    ? '<p style="color:var(--muted);padding:16px 0">No data yet.</p>'
    : Object.entries(catMap).sort((a,b)=>b[1]-a[1]).map(([k,v]) => `
        <div class="report-row">
          <div class="report-row-label">${k}</div>
          <div class="report-row-bar-wrap">
            <div class="report-row-bar" style="width:${(v/maxCat*100).toFixed(1)}%"></div>
          </div>
          <div class="report-row-count">${v}</div>
        </div>`).join('');

  // timeline (next 10 to expire)
  const upcoming = [...list].sort((a,b) => new Date(a.expiry) - new Date(b.expiry)).slice(0,10);
  document.getElementById('timelineReport').innerHTML = !upcoming.length
    ? '<p style="color:var(--muted);padding:16px 0">No data yet.</p>'
    : upcoming.map(m => {
        const s = getStatus(m.expiry);
        return `
          <div class="timeline-item">
            <div class="tl-dot ${s.cls}">${s.icon}</div>
            <div class="tl-content">
              <div class="tl-name">${esc(m.name)}</div>
              <div class="tl-date">${fmtDate(m.expiry)} — ${s.label}</div>
            </div>
          </div>`;
      }).join('');

  // value summary
  const total   = list.length;
  const totalQty = list.reduce((s,m) => s + (m.qty||0), 0);
  const totalVal = list.reduce((s,m) => s + (m.qty||0) * (m.price||0), 0);
  document.getElementById('valueSummary').innerHTML = `
    <div class="value-box">
      <div class="value-box-num">${total}</div>
      <div class="value-box-label">Total Products</div>
    </div>
    <div class="value-box">
      <div class="value-box-num">${totalQty.toLocaleString()}</div>
      <div class="value-box-label">Total Units</div>
    </div>
    <div class="value-box">
      <div class="value-box-num">₹${totalVal.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
      <div class="value-box-label">Estimated Stock Value</div>
    </div>`;
}

/* ─── MODAL ───────────────────────────────────────── */
const overlay    = document.getElementById('modalOverlay');
const modalBody  = document.getElementById('modalBody');
const modalTitle = document.getElementById('modalTitle');
let currentMedId = null;

function openModal(id) {
  const list = loadMedicines();
  const m    = list.find(x => x.id === id);
  if (!m) return;
  currentMedId = id;
  const s = getStatus(m.expiry);
  modalTitle.textContent = m.name;
  modalBody.innerHTML = `
    <div style="margin-bottom:14px">
      <span class="pill ${s.cls}" style="font-size:.85rem">${s.icon} ${s.label}</span>
      ${m.category ? `<span class="pill safe" style="font-size:.85rem;margin-left:8px">🏷 ${esc(m.category)}</span>` : ''}
    </div>
    <div class="detail-grid">
      <div class="detail-item"><label>Generic Name</label><div class="val">${esc(m.generic||'—')}</div></div>
      <div class="detail-item"><label>Batch Number</label><div class="val"><code>${esc(m.batch)}</code></div></div>
      <div class="detail-item"><label>Supplier / Manufacturer</label><div class="val">${esc(m.supplier||'—')}</div></div>
      <div class="detail-item"><label>Date Received</label><div class="val">${fmtDate(m.received)}</div></div>
      <div class="detail-item"><label>Marketed Date</label><div class="val">${fmtDate(m.marketed)}</div></div>
      <div class="detail-item"><label>Expiry Date</label><div class="val" style="color:${s.cls==='expired'?'var(--red)':s.cls==='expiring'?'var(--orange)':'var(--green-d)'}; font-weight:700">${fmtDate(m.expiry)}</div></div>
      <div class="detail-item"><label>Quantity</label><div class="val">${m.qty} units</div></div>
      <div class="detail-item"><label>Unit Price</label><div class="val">₹${m.price ? m.price.toFixed(2) : '—'}</div></div>
      <div class="detail-item"><label>Storage Condition</label><div class="val">${esc(m.storage||'—')}</div></div>
      <div class="detail-item"><label>Added On</label><div class="val">${fmtDate(m.createdAt)}</div></div>
    </div>
    ${m.notes ? `<div style="margin-top:18px"><label style="font-size:.75rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">Notes</label><p style="margin-top:6px;font-size:.9rem;line-height:1.6;color:var(--text)">${esc(m.notes)}</p></div>` : ''}
  `;
  overlay.classList.add('open');
}

function closeModal() {
  overlay.classList.remove('open');
  currentMedId = null;
}

document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

document.getElementById('modalDeleteBtn').addEventListener('click', () => {
  if (!currentMedId) return;
  deleteMedicine(currentMedId);
  closeModal();
  toast('Medicine deleted.', 'error');
  updateGlobalBadges();
  renderStock();
});

function confirmDelete(id, name) {
  if (confirm(`Delete "${name}"? This cannot be undone.`)) {
    deleteMedicine(id);
    toast(`"${name}" deleted.`, 'error');
    updateGlobalBadges();
    renderStock();
  }
}

/* ─── TOAST ───────────────────────────────────────── */
function toast(msg, type='info') {
  const icons = { success:'✅', error:'🗑', info:'ℹ️' };
  const tc = document.getElementById('toastContainer');
  const t  = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type]||'ℹ️'}</span> ${msg}`;
  tc.appendChild(t);
  setTimeout(() => {
    t.classList.add('toast-fade');
    t.addEventListener('animationend', () => t.remove());
  }, 3500);
}

/* ─── GLOBAL BADGES / NOTIF DOT ──────────────────── */
function updateGlobalBadges() {
  const list = loadMedicines();
  const n = list.filter(m => getStatus(m.expiry).cls !== 'safe').length;
  document.getElementById('alertBadge').textContent = n;
  document.getElementById('alertBadge').style.display = n ? '' : 'none';
  document.getElementById('notifDot').style.display  = n ? '' : 'none';
}

/* ─── BROWSER NOTIFICATIONS ───────────────────────── */
function checkBrowserNotifications() {
  if (Notification.permission !== 'granted') return;
  const list = loadMedicines();
  const expiring = list.filter(m => getStatus(m.expiry).cls === 'expiring');
  const expired  = list.filter(m => getStatus(m.expiry).cls === 'expired');
  if (expired.length) {
    new Notification('PharmaCare Alert 🚨', {
      body: `${expired.length} medicine(s) have EXPIRED. Please remove them.`,
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">💊</text></svg>'
    });
  }
  if (expiring.length) {
    new Notification('PharmaCare Reminder ⏳', {
      body: `${expiring.length} medicine(s) are expiring within 7 days.`,
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">💊</text></svg>'
    });
  }
}

// check on load every time
if (Notification.permission === 'granted') {
  setTimeout(checkBrowserNotifications, 1500);
}

/* ─── AUTO EXPIRY CHECK ON LOAD ──────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  const list = loadMedicines();
  const n = list.filter(m => getStatus(m.expiry).cls !== 'safe').length;
  if (n > 0) {
    toast(`⚠️ ${n} medicine(s) require attention!`, 'info');
  }
});

/* ─── HELPER ─────────────────────────────────────── */
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ─── INIT ────────────────────────────────────────── */
updateGlobalBadges();
renderDashboard();
