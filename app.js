/* ================================================================
   app.js  -  Main application controller  (v3)
   Dark mode | Charts | Collapsible sidebar | User menu | Delete account
   ================================================================ */
'use strict';

/* ── Dark mode: apply before DOM so there is no flash ── */
(function initTheme() {
  var saved = localStorage.getItem('pharma_theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
})();

let _currentMedId = null;

/* ════════════════════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {

  /* Dark mode toggle button */
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const dmBtn  = document.getElementById('darkModeBtn');
  if (dmBtn) {
    dmBtn.textContent = isDark ? '☀️' : '🌙';
    dmBtn.addEventListener('click', () => {
      const cur  = document.documentElement.getAttribute('data-theme');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('pharma_theme', next);
      dmBtn.textContent = next === 'dark' ? '☀️' : '🌙';
    });
  }

  /* User menu toggle (the ⏻ button opens a mini dropdown) */
  const menuBtn  = document.getElementById('userMenuBtn');
  const menuDrop = document.getElementById('userMenuDropdown');
  if (menuBtn && menuDrop) {
    menuBtn.addEventListener('click', e => {
      e.stopPropagation();
      menuDrop.classList.toggle('open');
    });
    document.addEventListener('click', () => menuDrop.classList.remove('open'));
  }

  /* Sidebar collapse toggle (desktop) */
  const collapseBtn = document.getElementById('collapseBtn');
  const sidebar     = document.getElementById('sidebar');
  if (collapseBtn && sidebar) {
    const isC = localStorage.getItem('pharma_sidebar_collapsed') === 'true';
    if (isC) sidebar.classList.add('collapsed');
    collapseBtn.textContent = isC ? '▶' : '◀';
    collapseBtn.addEventListener('click', () => {
      sidebar.classList.toggle('collapsed');
      const c = sidebar.classList.contains('collapsed');
      localStorage.setItem('pharma_sidebar_collapsed', String(c));
      collapseBtn.textContent = c ? '▶' : '◀';
    });
  }

  /* Initialise DB, fill sidebar, render dashboard */
  try {
    const { user, pharmacy } = await DB.init();
    const phName = pharmacy.name || 'My Pharmacy';

    document.getElementById('sidebarPhName').textContent    = phName;
    document.getElementById('sidebarUserEmail').textContent = user.email;
    const logoEl = document.getElementById('sidebarLogoText');
    if (logoEl) logoEl.textContent = phName;

    document.getElementById('todayDate').textContent =
      new Date().toLocaleDateString('en-IN',
        { weekday:'short', day:'2-digit', month:'short', year:'numeric' });

    document.title = phName + ' – Pharmacy Management';
    const greet = document.getElementById('dashGreet');
    if (greet) greet.textContent =
      'Welcome to ' + phName + '. Here is your pharmacy at a glance.';

    await loadSupplierDropdown();
    await renderDashboard();
  } catch(err) {
    console.error('Boot error', err);
    toast('Failed to connect to database. Check your Supabase config.', 'error');
  }
});

/* ════════════════════════════════════════════════════════════════
   USER MENU
════════════════════════════════════════════════════════════════ */
function closeUserMenu() {
  document.getElementById('userMenuDropdown')?.classList.remove('open');
}

/** Logout — clears session and replaces history so Back does not return here. */
async function doLogout() {
  closeUserMenu();
  try { await window.signOut(); } catch(_) {}
  history.replaceState(null, '', 'auth.html');
  window.location.href = 'auth.html';
}

/** Open the delete-account confirmation modal. */
function openDeleteAccountModal() {
  closeUserMenu();
  document.getElementById('deleteConfirmEmail').value = '';
  const msg = document.getElementById('deleteAccMsg');
  msg.className = 'auth-msg'; msg.textContent = '';
  document.getElementById('deleteAccModal').classList.add('open');
  setTimeout(() => document.getElementById('deleteConfirmEmail').focus(), 120);
}

function closeDeleteAccountModal() {
  document.getElementById('deleteAccModal').classList.remove('open');
}

/**
 * Delete ALL data belonging to this user, then sign out.
 * Deletion order: invoices → medicine_batches → medicines →
 *   suppliers → purchase_orders → pharmacies → sign out.
 * Only that user's data is touched (pharmacy_id scoped).
 */
async function doDeleteAccount() {
  const input = document.getElementById('deleteConfirmEmail').value.trim().toLowerCase();
  const btn   = document.getElementById('deleteAccBtn');
  const msg   = document.getElementById('deleteAccMsg');
  msg.className = 'auth-msg'; msg.textContent = '';

  const { data: { user } } = await SUPA.auth.getUser();
  if (!user) { window.location.href = 'auth.html'; return; }

  if (input !== (user.email || '').toLowerCase()) {
    msg.className = 'auth-msg error';
    msg.textContent = 'Email does not match. Type your registered email exactly.';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span> Deleting…';

  try {
    const ph   = DB.pharmacy();
    const phId = ph && ph.id;

    if (phId) {
      // Delete children before parents to avoid FK violations
      await SUPA.from('invoices')         .delete().eq('pharmacy_id', phId);
      await SUPA.from('medicine_batches') .delete().eq('pharmacy_id', phId);
      await SUPA.from('medicines')        .delete().eq('pharmacy_id', phId);
      await SUPA.from('suppliers')        .delete().eq('pharmacy_id', phId);
      await SUPA.from('purchase_orders')  .delete().eq('pharmacy_id', phId);
      await SUPA.from('pharmacies')       .delete().eq('id', phId);
    }

    await SUPA.auth.signOut();
    history.replaceState(null, '', 'auth.html?deleted=1');
    window.location.href = 'auth.html?deleted=1';
  } catch(err) {
    btn.disabled = false;
    btn.textContent = '🗑 Delete My Account';
    msg.className = 'auth-msg error';
    msg.textContent = 'Error: ' + err.message;
  }
}

/* ════════════════════════════════════════════════════════════════
   NAVIGATION
════════════════════════════════════════════════════════════════ */
const PAGE_TITLES = {
  dashboard:'Dashboard', add:'Add Medicine', stock:'Stock List',
  billing:'New Bill', invoices:'Invoices', suppliers:'Suppliers',
  reports:'Reports', alerts:'Alerts', settings:'Settings'
};

function navigateTo(pageKey) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pg  = document.getElementById('page-' + pageKey);
  const nav = document.querySelector('.nav-item[data-page="' + pageKey + '"]');
  if (!pg) return;
  pg.classList.add('active');
  if (nav) nav.classList.add('active');
  document.getElementById('topbarTitle').textContent = PAGE_TITLES[pageKey] || pageKey;

  if (pageKey === 'dashboard') renderDashboard();
  if (pageKey === 'stock')     renderStock();
  if (pageKey === 'alerts')    renderAlerts();
  if (pageKey === 'invoices')  loadInvoices();
  if (pageKey === 'suppliers') loadSuppliers();
  if (pageKey === 'reports')   loadReports();
  if (pageKey === 'settings')  loadSettings();
}

/* Wire nav links */
document.querySelectorAll('[data-page]').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(el.dataset.page);
    if (window.innerWidth <= 768)
      document.getElementById('sidebar').classList.remove('open');
  });
});

document.getElementById('hamburger').addEventListener('click', () =>
  document.getElementById('sidebar').classList.toggle('open'));

document.getElementById('notifBtn').addEventListener('click', () =>
  navigateTo('alerts'));

/* Close sidebar on outside click on mobile */
document.addEventListener('click', e => {
  const sb = document.getElementById('sidebar');
  const hb = document.getElementById('hamburger');
  if (window.innerWidth <= 768 &&
      sb.classList.contains('open') &&
      !sb.contains(e.target) &&
      !hb.contains(e.target)) {
    sb.classList.remove('open');
  }
});

/* ════════════════════════════════════════════════════════════════
   COUNT-UP ANIMATION  (for dashboard stat cards)
════════════════════════════════════════════════════════════════ */
function countUp(el, target, isRupee, duration) {
  if (!el) return;
  isRupee  = isRupee  || false;
  duration = duration || 900;
  el.classList.remove('loading');
  var startTime = null;
  var numTarget = Number(target) || 0;
  function step(ts) {
    if (!startTime) startTime = ts;
    var progress = Math.min((ts - startTime) / duration, 1);
    var ease     = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    var val      = Math.floor(numTarget * ease);
    el.textContent = isRupee
      ? val.toLocaleString('en-IN')
      : val.toLocaleString();
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      el.textContent = isRupee
        ? numTarget.toLocaleString('en-IN',
            { minimumFractionDigits:2, maximumFractionDigits:2 })
        : numTarget.toLocaleString();
    }
  }
  requestAnimationFrame(step);
}

/* ════════════════════════════════════════════════════════════════
   CHARTS  (requires Chart.js CDN loaded before this file)
════════════════════════════════════════════════════════════════ */
var _chartSales = null, _chartCat = null, _chartExpiry = null;

function destroyCharts() {
  [_chartSales, _chartCat, _chartExpiry].forEach(function(c) { if (c) c.destroy(); });
  _chartSales = _chartCat = _chartExpiry = null;
}

function buildCharts(stats, meds) {
  if (typeof Chart === 'undefined') return; // Chart.js not loaded
  destroyCharts();

  var isDark    = document.documentElement.getAttribute('data-theme') === 'dark';
  var textColor = isDark ? '#94a3b8' : '#64748b';
  var gridColor = isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.05)';
  var axisOpts  = { ticks: { color: textColor }, grid: { color: gridColor } };

  /* ── 1. Sales trend line (last 6 months; current month uses real data) ── */
  var months = [];
  for (var i = 5; i >= 0; i--) {
    var d = new Date(); d.setMonth(d.getMonth() - i);
    months.push(d.toLocaleDateString('en-IN', { month:'short', year:'2-digit' }));
  }
  var salesCtx = document.getElementById('chartSales');
  if (salesCtx) {
    salesCtx = salesCtx.getContext('2d');
    _chartSales = new Chart(salesCtx, {
      type: 'line',
      data: {
        labels: months,
        datasets: [{
          label: 'Sales ₹',
          data:  [0, 0, 0, 0, 0, Math.round(stats.monthlySales || 0)],
          borderColor: '#0ea5e9',
          backgroundColor: 'rgba(14,165,233,.12)',
          tension: 0.4, fill: true,
          pointRadius: 4, pointBackgroundColor: '#0ea5e9'
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales:  { x: axisOpts, y: axisOpts }
      }
    });
  }

  /* ── 2. Stock by category doughnut ── */
  var catMap = {};
  meds.forEach(function(m) {
    var cat = m.category || 'Other';
    catMap[cat] = (catMap[cat] || 0) + 1;
  });
  var catLabels = Object.keys(catMap);
  var catData   = catLabels.map(function(k) { return catMap[k]; });
  var palette   = ['#0ea5e9','#10b981','#f97316','#8b5cf6','#ef4444',
                   '#eab308','#14b8a6','#6366f1','#f43f5e','#84cc16'];
  var catCtx = document.getElementById('chartCategory');
  if (catCtx && catLabels.length) {
    catCtx = catCtx.getContext('2d');
    _chartCat = new Chart(catCtx, {
      type: 'doughnut',
      data: {
        labels: catLabels,
        datasets: [{
          data:            catData,
          backgroundColor: palette.slice(0, catLabels.length),
          borderWidth:     2
        }]
      },
      options: {
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: textColor, boxWidth: 12, font: { size: 11 } }
          }
        }
      }
    });
  }

  /* ── 3. Expiring-soon bar chart (today / 1-3 days / 4-7 days) ── */
  var now = new Date(); now.setHours(0,0,0,0);
  var buckets = { 'Today': 0, '1-3 days': 0, '4-7 days': 0 };
  meds.forEach(function(m) {
    (m.medicine_batches || []).forEach(function(b) {
      var diff = Math.ceil((new Date(b.expiry_date) - now) / 86400000);
      if (diff === 0)              buckets['Today']++;
      else if (diff > 0 && diff <= 3)  buckets['1-3 days']++;
      else if (diff > 3 && diff <= 7)  buckets['4-7 days']++;
    });
  });
  var exCtx = document.getElementById('chartExpiry');
  if (exCtx) {
    exCtx = exCtx.getContext('2d');
    _chartExpiry = new Chart(exCtx, {
      type: 'bar',
      data: {
        labels: Object.keys(buckets),
        datasets: [{
          label:           'Batches expiring',
          data:            Object.values(buckets),
          backgroundColor: ['#ef4444','#f97316','#eab308'],
          borderRadius:    6
        }]
      },
      options: {
        plugins: { legend: { display: false } },
        scales:  {
          x: axisOpts,
          y: Object.assign({}, axisOpts, { beginAtZero: true })
        }
      }
    });
  }
}

/* ════════════════════════════════════════════════════════════════
   DASHBOARD
════════════════════════════════════════════════════════════════ */
async function renderDashboard() {
  try {
    const stats = await DB.getDashboardStats();

    countUp(document.getElementById('statTotal'),        stats.totalProducts || 0);
    countUp(document.getElementById('statUnits'),        stats.totalUnits    || 0);
    countUp(document.getElementById('statExpired'),      stats.expired       || 0);
    countUp(document.getElementById('statExpiring'),     stats.expiringSoon  || 0);
    countUp(document.getElementById('statLow'),          stats.lowStock      || 0);
    countUp(document.getElementById('statTodaySales'),   stats.todaySales    || 0, true);
    countUp(document.getElementById('statMonthlySales'), stats.monthlySales  || 0, true);
    countUp(document.getElementById('statTodayCount'),   stats.todayCount    || 0);

    /* Alert banner */
    const alertN = (stats.expired || 0) + (stats.expiringSoon || 0) + (stats.lowStock || 0);
    const banner  = document.getElementById('alertBanner');
    const alertMsg = document.getElementById('alertBannerMsg');
    if (alertN > 0) {
      const parts = [];
      if (stats.expired)      parts.push(stats.expired      + ' expired batch(es)');
      if (stats.expiringSoon) parts.push(stats.expiringSoon + ' expiring within 7 days');
      if (stats.lowStock)     parts.push(stats.lowStock     + ' low-stock item(s)');
      alertMsg.textContent = parts.join(' • ');
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }

    /* Sidebar alert badge + topbar dot */
    const badge = document.getElementById('alertBadge');
    const dot   = document.getElementById('notifDot');
    if (badge) { badge.textContent = alertN; badge.style.display = alertN > 0 ? '' : 'none'; }
    if (dot)   { dot.style.display = alertN > 0 ? '' : 'none'; }

    /* Recent stock table (last 8 batches received) */
    const meds    = await DB.getMedicines();
    const batches = [];
    meds.forEach(m =>
      (m.medicine_batches || []).forEach(b =>
        batches.push(Object.assign({}, b,
          { medName: m.name, category: m.category }))
      )
    );
    batches.sort((a, b) => new Date(b.received_date) - new Date(a.received_date));
    const recent = batches.slice(0, 8);
    const tbody  = document.getElementById('recentTbody');
    if (!recent.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-row">No medicines added yet.</td></tr>';
    } else {
      tbody.innerHTML = recent.map(b => {
        const s = getStatus(b.expiry_date, b.quantity, 10);
        return '<tr>' +
          '<td><strong>' + esc(b.medName) + '</strong>' +
            (b.category ? '<br><small style="color:var(--muted)">' + esc(b.category) + '</small>' : '') +
          '</td>' +
          '<td><code>' + esc(b.batch_number) + '</code></td>' +
          '<td>' + fmtDate(b.expiry_date) + '</td>' +
          '<td>' + b.quantity + '</td>' +
          '<td>₹' + Number(b.selling_price || 0).toFixed(2) + '</td>' +
          '<td><span class="pill ' + s.cls + '">' + s.icon + ' ' + s.label + '</span></td>' +
        '</tr>';
      }).join('');
    }

    /* Build charts */
    buildCharts(stats, meds);

  } catch(err) {
    console.error('Dashboard error', err);
    toast('Error loading dashboard: ' + err.message, 'error');
  }
}

/* ════════════════════════════════════════════════════════════════
   ADD MEDICINE FORM
════════════════════════════════════════════════════════════════ */
const form = document.getElementById('medicineForm');

async function loadSupplierDropdown() {
  try {
    const sups = await DB.getSuppliers();
    const sel  = document.getElementById('fSupplierId');
    sel.innerHTML = '<option value="">None / Unknown</option>' +
      sups.map(s => '<option value="' + s.id + '">' + esc(s.name) + '</option>').join('');
  } catch(_) {}
}

function validateForm() {
  let ok = true;
  const required = [
    ['fName',     'errName',     'Medicine name is required'],
    ['fBatch',    'errBatch',    'Batch number is required'],
    ['fReceived', 'errReceived', 'Date received is required'],
    ['fExpiry',   'errExpiry',   'Expiry date is required'],
    ['fQty',      'errQty',      'Quantity is required'],
  ];
  required.forEach(([id, errId, msg]) => {
    const el = document.getElementById(id);
    const er = document.getElementById(errId);
    if (!el.value.trim()) {
      el.classList.add('invalid'); er.textContent = msg; ok = false;
    } else {
      el.classList.remove('invalid'); er.textContent = '';
    }
  });
  return ok;
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  if (!validateForm()) return;
  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-sm"></span>Saving…';
  try {
    await DB.addMedicine({
      name:          document.getElementById('fName').value.trim(),
      generic:       document.getElementById('fGeneric').value.trim(),
      brand:         document.getElementById('fBrand').value.trim(),
      category:      document.getElementById('fCategory').value,
      hsn:           document.getElementById('fHsn').value.trim(),
      gst:           document.getElementById('fGst').value,
      barcode:       document.getElementById('fBarcode').value.trim(),
      manufacturer:  document.getElementById('fManufacturer').value.trim(),
      storage:       document.getElementById('fStorage').value,
      minStock:      document.getElementById('fMinStock').value || 10,
      notes:         document.getElementById('fNotes').value.trim(),
      batch:         document.getElementById('fBatch').value.trim(),
      supplierId:    document.getElementById('fSupplierId').value || null,
      manufactured:  document.getElementById('fManufactured').value || null,
      marketed:      document.getElementById('fMarketed').value || null,
      expiry:        document.getElementById('fExpiry').value,
      received:      document.getElementById('fReceived').value,
      qty:           document.getElementById('fQty').value,
      purchasePrice: document.getElementById('fPurchasePrice').value || 0,
      sellingPrice:  document.getElementById('fSellingPrice').value || 0,
    });
    toast('Medicine saved successfully! 💊', 'success');
    form.reset();
    document.getElementById('fGst').value     = '12';
    document.getElementById('fMinStock').value = '10';
  } catch(err) {
    toast('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '💾 Save Medicine';
  }
});

document.getElementById('clearFormBtn').addEventListener('click', () => {
  form.reset();
  document.getElementById('fGst').value      = '12';
  document.getElementById('fMinStock').value = '10';
  document.querySelectorAll('.form-error').forEach(e => e.textContent = '');
  document.querySelectorAll('.invalid').forEach(e => e.classList.remove('invalid'));
});

/* ════════════════════════════════════════════════════════════════
   STOCK LIST
════════════════════════════════════════════════════════════════ */
let _allMedicines = [];
let _activeFilter = 'all';
let _searchQuery  = '';

async function renderStock() {
  const tbody = document.getElementById('stockTbody');
  tbody.innerHTML =
    '<tr><td colspan="12" class="empty-row"><span class="spinner-sm"></span> Loading…</td></tr>';
  try {
    _allMedicines = await DB.getMedicines();
    displayStock();
  } catch(err) {
    tbody.innerHTML =
      '<tr><td colspan="12" class="empty-row">Error: ' + esc(err.message) + '</td></tr>';
  }
}

function displayStock() {
  const tbody = document.getElementById('stockTbody');
  let rows = [];
  _allMedicines.forEach(m => {
    (m.medicine_batches || []).forEach(b => {
      rows.push(Object.assign({}, b, {
        medName: m.name, medGeneric: m.generic_name, medId: m.id,
        category: m.category, gstPercent: m.gst_percent,
        minStock: m.min_stock_level
      }));
    });
  });

  /* Search filter */
  if (_searchQuery) {
    const q = _searchQuery.toLowerCase();
    rows = rows.filter(r =>
      r.medName.toLowerCase().includes(q) ||
      (r.medGeneric || '').toLowerCase().includes(q) ||
      r.batch_number.toLowerCase().includes(q)
    );
  }
  /* Status filter */
  if (_activeFilter !== 'all') {
    rows = rows.filter(r =>
      getStatus(r.expiry_date, r.quantity, r.minStock).cls === _activeFilter
    );
  }

  if (!rows.length) {
    tbody.innerHTML =
      '<tr><td colspan="12" class="empty-row">No medicines found.</td></tr>';
    return;
  }

  rows.sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));

  tbody.innerHTML = rows.map((r, i) => {
    const s = getStatus(r.expiry_date, r.quantity, r.minStock);
    const expiryColor = s.cls === 'expired' ? 'var(--red)' :
                        s.cls === 'expiring' ? 'var(--orange)' : 'var(--green-d)';
    return '<tr>' +
      '<td style="color:var(--muted);font-size:.78rem">' + (i + 1) + '</td>' +
      '<td><strong>' + esc(r.medName) + '</strong>' +
        (r.medGeneric ? '<br><small style="color:var(--muted)">' + esc(r.medGeneric) + '</small>' : '') +
      '</td>' +
      '<td><small>' + esc(r.category || '—') + '</small></td>' +
      '<td><code style="font-size:.8rem">' + esc(r.batch_number) + '</code></td>' +
      '<td>' + fmtDate(r.received_date) + '</td>' +
      '<td>' + fmtDate(r.marketed_date) + '</td>' +
      '<td style="font-weight:600;color:' + expiryColor + '">' + fmtDate(r.expiry_date) + '</td>' +
      '<td><strong>' + r.quantity + '</strong></td>' +
      '<td>₹' + Number(r.selling_price || 0).toFixed(2) + '</td>' +
      '<td>' + r.gstPercent + '%</td>' +
      '<td><span class="pill ' + s.cls + '">' + s.icon + ' ' + s.label + '</span></td>' +
      '<td><div class="action-btns">' +
        '<button class="btn-icon" title="View" onclick="openMedModal(' +
          "'" + r.medId + "','" + r.id + "'" +
        ')">👁</button>' +
        '<button class="btn-icon" title="Delete" onclick="deleteMed(' +
          "'" + r.medId + "','" + esc(r.medName) + "'" +
        ')">🗑</button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
}

document.getElementById('searchInput').addEventListener('input', e => {
  _searchQuery = e.target.value; displayStock();
});

document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    _activeFilter = chip.dataset.filter;
    displayStock();
  });
});

document.getElementById('exportBtn').addEventListener('click', () => {
  const rows = [];
  _allMedicines.forEach(m => {
    (m.medicine_batches || []).forEach(b => {
      const s = getStatus(b.expiry_date, b.quantity, m.min_stock_level);
      rows.push([
        m.name, m.generic_name, m.category, b.batch_number,
        b.received_date, b.marketed_date, b.expiry_date,
        b.quantity, b.selling_price, b.purchase_price,
        m.gst_percent + '%', s.label
      ].map(v => '"' + (v || '').toString().replace(/"/g, '""') + '"').join(','));
    });
  });
  if (!rows.length) { toast('No data to export.', 'info'); return; }
  const csv  = [
    'Name,Generic,Category,Batch,Received,Marketed,Expiry,Qty,Sell Price,Buy Price,GST,Status',
    ...rows
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'pharmacare_stock.csv'; a.click();
  URL.revokeObjectURL(url);
  toast('CSV exported!', 'success');
});

/* ════════════════════════════════════════════════════════════════
   ALERTS
════════════════════════════════════════════════════════════════ */
async function renderAlerts() {
  const container = document.getElementById('alertsContainer');
  container.innerHTML =
    '<div class="empty-state">' +
      '<div class="empty-icon"><span class="spinner-sm"></span></div>' +
      '<div class="empty-title">Loading…</div>' +
    '</div>';
  try {
    const meds   = await DB.getMedicines();
    const alerts = [];
    meds.forEach(m => {
      (m.medicine_batches || []).forEach(b => {
        const s = getStatus(b.expiry_date, b.quantity, m.min_stock_level);
        if (s.cls !== 'safe')
          alerts.push(Object.assign({}, b, { medName: m.name, status: s }));
      });
    });

    if (!alerts.length) {
      container.innerHTML =
        '<div class="empty-state">' +
          '<div class="empty-icon">🎉</div>' +
          '<div class="empty-title">All Clear!</div>' +
          '<div class="empty-sub">No expired or soon-to-expire medicines.</div>' +
        '</div>';
      return;
    }

    alerts.sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));
    container.innerHTML = alerts.map(a => {
      const daysText = a.status.days < 0
        ? 'Expired ' + Math.abs(a.status.days) + ' day(s) ago'
        : 'Expires in ' + a.status.days + ' day(s)';
      const color = a.status.cls === 'expired' ? 'var(--red)' : 'var(--orange)';
      return '<div class="alert-card ' + a.status.cls + '">' +
        '<div class="alert-card-icon">' + a.status.icon + '</div>' +
        '<div class="alert-card-info">' +
          '<div class="alert-card-name">' + esc(a.medName) + '</div>' +
          '<div class="alert-card-meta">Batch: <strong>' + esc(a.batch_number) +
            '</strong> | Expiry: <strong>' + fmtDate(a.expiry_date) +
            '</strong> | Qty: ' + a.quantity + '</div>' +
          '<div style="margin-top:5px;font-size:.8rem;font-weight:700;color:' +
            color + '">' + daysText + '</div>' +
        '</div>' +
        '<div class="alert-card-badge">' +
          '<span class="pill ' + a.status.cls + '">' + a.status.label + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  } catch(err) {
    container.innerHTML =
      '<div class="empty-state">' +
        '<div class="empty-title">Error</div>' +
        '<div class="empty-sub">' + esc(err.message) + '</div>' +
      '</div>';
  }
}

/* ════════════════════════════════════════════════════════════════
   MODAL: Medicine Details
════════════════════════════════════════════════════════════════ */
function openMedModal(medId, batchId) {
  const med   = _allMedicines.find(m => m.id === medId);
  if (!med) return;
  const batch = (med.medicine_batches || []).find(b => b.id === batchId) || {};
  _currentMedId = medId;
  const s = getStatus(batch.expiry_date, batch.quantity, med.min_stock_level);
  const exC = s.cls === 'expired' ? 'var(--red)' :
              s.cls === 'expiring' ? 'var(--orange)' : 'var(--green-d)';
  document.getElementById('modalTitle').textContent = med.name;
  document.getElementById('modalBody').innerHTML =
    '<div style="margin-bottom:14px">' +
      '<span class="pill ' + s.cls + '">' + s.icon + ' ' + s.label + '</span>' +
      (med.category
        ? '<span class="pill safe" style="margin-left:8px">🏷 ' + esc(med.category) + '</span>'
        : '') +
    '</div>' +
    '<div class="detail-grid">' +
      '<div class="detail-item"><label>Generic</label><div class="val">' + esc(med.generic_name || '—') + '</div></div>' +
      '<div class="detail-item"><label>Brand</label><div class="val">' + esc(med.brand || '—') + '</div></div>' +
      '<div class="detail-item"><label>Batch No.</label><div class="val"><code>' + esc(batch.batch_number || '—') + '</code></div></div>' +
      '<div class="detail-item"><label>Received</label><div class="val">' + fmtDate(batch.received_date) + '</div></div>' +
      '<div class="detail-item"><label>Marketed</label><div class="val">' + fmtDate(batch.marketed_date) + '</div></div>' +
      '<div class="detail-item"><label>Expiry</label><div class="val" style="font-weight:700;color:' + exC + '">' + fmtDate(batch.expiry_date) + '</div></div>' +
      '<div class="detail-item"><label>Quantity</label><div class="val">' + batch.quantity + ' units</div></div>' +
      '<div class="detail-item"><label>Selling Price</label><div class="val">₹' + Number(batch.selling_price || 0).toFixed(2) + '</div></div>' +
      '<div class="detail-item"><label>Purchase Price</label><div class="val">₹' + Number(batch.purchase_price || 0).toFixed(2) + '</div></div>' +
      '<div class="detail-item"><label>GST %</label><div class="val">' + med.gst_percent + '%</div></div>' +
      '<div class="detail-item"><label>HSN Code</label><div class="val">' + esc(med.hsn_code || '—') + '</div></div>' +
      '<div class="detail-item"><label>Storage</label><div class="val">' + esc(med.storage_condition || '—') + '</div></div>' +
      '<div class="detail-item"><label>Min Stock Level</label><div class="val">' + med.min_stock_level + '</div></div>' +
      '<div class="detail-item"><label>Manufacturer</label><div class="val">' + esc(med.manufacturer || '—') + '</div></div>' +
    '</div>' +
    (med.notes
      ? '<div style="margin-top:16px">' +
          '<label style="font-size:.73rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em">Notes</label>' +
          '<p style="margin-top:5px;font-size:.88rem;line-height:1.6">' + esc(med.notes) + '</p>' +
        '</div>'
      : '');
  document.getElementById('modalDeleteBtn').onclick = () => deleteMed(medId, med.name);
  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open');
  _currentMedId = null;
}

document.getElementById('modalOverlay').addEventListener('click', e => {
  if (e.target.id === 'modalOverlay') closeModal();
});

async function deleteMed(medId, medName) {
  if (!confirm('Delete "' + medName + '"? This will archive the medicine record.')) return;
  try {
    await DB.deleteMedicine(medId);
    closeModal();
    toast('"' + medName + '" removed.', 'error');
    _allMedicines = _allMedicines.filter(m => m.id !== medId);
    displayStock();
  } catch(err) { toast('Error: ' + err.message, 'error'); }
}

/* ════════════════════════════════════════════════════════════════
   SETTINGS
════════════════════════════════════════════════════════════════ */
function loadSettings() {
  const ph = DB.pharmacy();
  if (!ph) return;
  document.getElementById('setPhName').value    = ph.name           || '';
  document.getElementById('setPhAddr').value    = ph.address        || '';
  document.getElementById('setPhPhone').value   = ph.phone          || '';
  document.getElementById('setPhEmail').value   = ph.email          || '';
  document.getElementById('setPhGst').value     = ph.gst_number     || '';
  document.getElementById('setPhLicense').value = ph.license_number || '';
}

async function saveSettings() {
  try {
    const newName = document.getElementById('setPhName').value.trim() || 'My Pharmacy';
    await DB.updatePharmacy({
      name:           newName,
      address:        document.getElementById('setPhAddr').value.trim(),
      phone:          document.getElementById('setPhPhone').value.trim(),
      email:          document.getElementById('setPhEmail').value.trim(),
      gst_number:     document.getElementById('setPhGst').value.trim(),
      license_number: document.getElementById('setPhLicense').value.trim(),
    });
    /* Live-update all name occurrences — no page reload */
    document.getElementById('sidebarPhName').textContent = newName;
    const logoEl = document.getElementById('sidebarLogoText');
    if (logoEl) logoEl.textContent = newName;
    document.title = newName + ' – Pharmacy Management';
    const greet = document.getElementById('dashGreet');
    if (greet) greet.textContent =
      'Welcome to ' + newName + '. Here is your pharmacy at a glance.';
    toast('Profile updated! 🏥', 'success');
  } catch(err) { toast('Error: ' + err.message, 'error'); }
}

/* ════════════════════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════════════════════ */
function getStatus(expiryStr, qty, minStock) {
  const exp  = new Date(expiryStr); exp.setHours(0, 0, 0, 0);
  const now  = new Date();          now.setHours(0, 0, 0, 0);
  const diff = Math.ceil((exp - now) / 86400000);
  if (diff < 0)              return { label:'Expired',      cls:'expired',  icon:'⚠️', days: diff };
  if (diff <= 7)             return { label:'Expiring Soon', cls:'expiring', icon:'⏳', days: diff };
  if (qty <= (minStock||10)) return { label:'Low Stock',    cls:'low',      icon:'📉', days: diff };
  return                            { label:'Safe',         cls:'safe',     icon:'✅', days: diff };
}

function fmtDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('en-IN',
    { day:'2-digit', month:'short', year:'numeric' });
}

function fmtRupees(n) {
  return Number(n || 0).toLocaleString('en-IN',
    { minimumFractionDigits:2, maximumFractionDigits:2 });
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toast(msg, type) {
  type = type || 'info';
  const icons = { success:'✅', error:'❌', info:'ℹ️' };
  const tc = document.getElementById('toastContainer');
  const t  = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = '<span>' + (icons[type] || 'ℹ️') + '</span><span>' + msg + '</span>';
  tc.appendChild(t);
  setTimeout(() => {
    t.classList.add('toast-fade');
    t.addEventListener('animationend', () => t.remove());
  }, 3800);
}

/* ── Expose globals ── */
window.APP = {
  navigateTo, toast, esc, fmtDate, fmtRupees,
  getStatus, renderStock, loadSupplierDropdown
};
window.closeModal              = closeModal;
window.openMedModal            = openMedModal;
window.deleteMed               = deleteMed;
window.saveSettings            = saveSettings;
window.doLogout                = doLogout;
window.openDeleteAccountModal  = openDeleteAccountModal;
window.closeDeleteAccountModal = closeDeleteAccountModal;
window.doDeleteAccount         = doDeleteAccount;
window.closeUserMenu           = closeUserMenu;
window.loadInvoices  = function() {};   // placeholder — overwritten by billing.js
window.loadSuppliers = function() {};   // placeholder — overwritten by suppliers.js
window.loadReports   = function() {};   // placeholder — overwritten by reports.js
