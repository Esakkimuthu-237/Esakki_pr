/* ================================================================
   reports.js  –  Reports & Analytics page
   ================================================================ */

'use strict';

/* ──────────────────────────────────────────────────────────────
   LOAD REPORTS (called when Reports nav is clicked)
────────────────────────────────────────────────────────────── */
async function loadReports() {
  const from = document.getElementById('repFrom').value || null;
  const to   = document.getElementById('repTo').value   || null;

  // Run all report sections in parallel
  await Promise.all([
    renderSalesSummary(from, to),
    renderTopMedicines(),
    renderStockValue()
  ]);
}

/* ──────────────────────────────────────────────────────────────
   1. SALES SUMMARY
────────────────────────────────────────────────────────────── */
async function renderSalesSummary(from, to) {
  const el = document.getElementById('salesSummary');
  el.innerHTML = '<div style="padding:16px;color:var(--muted)"><span class="spinner-sm"></span> Loading…</div>';
  try {
    const invs = await DB.getSalesReport(from, to);

    if (!invs.length) {
      el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted)">No sales data for selected period.</div>';
      return;
    }

    let totalSales = 0, totalGst = 0, totalDisc = 0;
    const byMethod = {};
    const byDay    = {};

    invs.forEach(inv => {
      const gt = Number(inv.grand_total);
      const gst = Number(inv.total_gst);
      const disc = Number(inv.total_discount);
      totalSales += gt;
      totalGst   += gst;
      totalDisc  += disc;

      const m = inv.payment_method || 'cash';
      byMethod[m] = (byMethod[m] || 0) + gt;

      const day = inv.created_at.slice(0, 10);
      byDay[day] = (byDay[day] || 0) + gt;
    });

    const maxDay = Math.max(...Object.values(byDay), 1);

    el.innerHTML = `
      <div style="padding:16px 20px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px">
          <div class="value-box"><div class="value-box-num">${invs.length}</div><div class="value-box-label">Total Bills</div></div>
          <div class="value-box"><div class="value-box-num">₹${APP.fmtRupees(totalSales)}</div><div class="value-box-label">Total Sales</div></div>
          <div class="value-box"><div class="value-box-num">₹${APP.fmtRupees(totalGst)}</div><div class="value-box-label">Total GST Collected</div></div>
          <div class="value-box"><div class="value-box-num">₹${APP.fmtRupees(totalDisc)}</div><div class="value-box-label">Total Discounts Given</div></div>
        </div>

        <div style="font-size:.8rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">By Payment Method</div>
        ${Object.entries(byMethod).map(([m, v]) => `
          <div class="report-row">
            <div class="report-row-label" style="text-transform:capitalize">${m}</div>
            <div class="report-row-bar-wrap"><div class="report-row-bar" style="width:${(v/totalSales*100).toFixed(1)}%"></div></div>
            <div class="report-row-count">₹${APP.fmtRupees(v)}</div>
          </div>`).join('')}

        <div style="font-size:.8rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin:16px 0 10px">Daily Sales</div>
        ${Object.entries(byDay).sort((a,b)=>a[0]<b[0]?1:-1).slice(0,10).map(([d,v]) => `
          <div class="report-row">
            <div class="report-row-label">${APP.fmtDate(d)}</div>
            <div class="report-row-bar-wrap"><div class="report-row-bar" style="width:${(v/maxDay*100).toFixed(1)}%"></div></div>
            <div class="report-row-count">₹${APP.fmtRupees(v)}</div>
          </div>`).join('')}
      </div>
    `;
  } catch(err) {
    el.innerHTML = `<div style="padding:16px;color:var(--red)">Error: ${APP.esc(err.message)}</div>`;
  }
}

/* ──────────────────────────────────────────────────────────────
   2. TOP MEDICINES
────────────────────────────────────────────────────────────── */
async function renderTopMedicines() {
  const el = document.getElementById('topMeds');
  el.innerHTML = '<div style="padding:16px;color:var(--muted)"><span class="spinner-sm"></span> Loading…</div>';
  try {
    const data = await DB.getTopMedicines();
    if (!data.length) {
      el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted)">No sales data yet.</div>';
      return;
    }
    const maxQty = data[0][1] || 1;
    el.innerHTML = '<div style="padding:14px 20px">' + data.map(([name, qty]) => `
      <div class="report-row">
        <div class="report-row-label">${APP.esc(name)}</div>
        <div class="report-row-bar-wrap"><div class="report-row-bar" style="width:${(qty/maxQty*100).toFixed(1)}%;background:linear-gradient(90deg,#22c55e,#16a34a)"></div></div>
        <div class="report-row-count">${qty} units</div>
      </div>`).join('') + '</div>';
  } catch(err) {
    el.innerHTML = `<div style="padding:16px;color:var(--red)">Error: ${APP.esc(err.message)}</div>`;
  }
}

/* ──────────────────────────────────────────────────────────────
   3. STOCK VALUE SUMMARY
────────────────────────────────────────────────────────────── */
async function renderStockValue() {
  const el = document.getElementById('stockValue');
  try {
    const meds = await DB.getMedicines();
    let totalProducts = meds.length;
    let totalUnits = 0, purchaseValue = 0, sellingValue = 0;
    let expiredUnits = 0, lowStockCount = 0;

    const now  = new Date(); now.setHours(0,0,0,0);
    const week = new Date(now); week.setDate(week.getDate() + 7);

    meds.forEach(m => {
      const stockByMed = (m.medicine_batches||[]).reduce((s,b) => s+b.quantity, 0);
      if (stockByMed <= (m.min_stock_level||10)) lowStockCount++;

      (m.medicine_batches||[]).forEach(b => {
        const exp = new Date(b.expiry_date);
        totalUnits     += b.quantity;
        purchaseValue  += b.quantity * Number(b.purchase_price||0);
        sellingValue   += b.quantity * Number(b.selling_price||0);
        if (exp < now) expiredUnits += b.quantity;
      });
    });

    el.innerHTML = `
      <div class="value-box"><div class="value-box-num">${totalProducts}</div><div class="value-box-label">Total Products</div></div>
      <div class="value-box"><div class="value-box-num">${totalUnits.toLocaleString()}</div><div class="value-box-label">Total Units in Stock</div></div>
      <div class="value-box"><div class="value-box-num" style="color:var(--orange)">₹${APP.fmtRupees(purchaseValue)}</div><div class="value-box-label">Purchase Value</div></div>
      <div class="value-box"><div class="value-box-num" style="color:var(--green)">₹${APP.fmtRupees(sellingValue)}</div><div class="value-box-label">MRP Stock Value</div></div>
      <div class="value-box"><div class="value-box-num" style="color:var(--red)">${expiredUnits}</div><div class="value-box-label">Expired Units</div></div>
      <div class="value-box"><div class="value-box-num" style="color:#ca8a04">${lowStockCount}</div><div class="value-box-label">Low Stock Items</div></div>
    `;
  } catch(err) {
    el.innerHTML = `<div style="padding:16px;color:var(--red);grid-column:span 3">Error: ${APP.esc(err.message)}</div>`;
  }
}

/* ── expose ── */
window.loadReports = loadReports;