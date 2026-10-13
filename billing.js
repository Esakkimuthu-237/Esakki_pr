/* ================================================================
   billing.js  –  Billing, Cart, Invoice generation & history
   ================================================================ */

'use strict';

/* ──────────────────────────────────────────────────────────────
   CART STATE
────────────────────────────────────────────────────────────── */
let cart = [];               // array of cart items
let billMedicines = [];      // all medicines (for search)
let selectedMed   = null;   // medicine selected in search

/* ──────────────────────────────────────────────────────────────
   LOAD MEDICINES FOR BILLING SEARCH
────────────────────────────────────────────────────────────── */
async function loadBillingMedicines() {
  try {
    billMedicines = await DB.getMedicines();
  } catch(err) {
    APP.toast('Could not load medicines: ' + err.message, 'error');
  }
}

/* ──────────────────────────────────────────────────────────────
   SEARCH BOX
────────────────────────────────────────────────────────────── */
const billSearchInput   = document.getElementById('billSearch');
const billSearchResults = document.getElementById('billSearchResults');

billSearchInput.addEventListener('input', () => {
  const q = billSearchInput.value.toLowerCase().trim();
  if (!q) { billSearchResults.classList.remove('open'); return; }

  const matches = billMedicines.filter(m =>
    m.name.toLowerCase().includes(q) ||
    (m.generic_name||'').toLowerCase().includes(q) ||
    (m.brand||'').toLowerCase().includes(q)
  ).slice(0, 12);

  if (!matches.length) { billSearchResults.innerHTML = '<div class="search-dropdown-item"><span class="sd-meta">No medicines found.</span></div>'; billSearchResults.classList.add('open'); return; }

  billSearchResults.innerHTML = matches.map(m => {
    // Only show batches that are not expired and have stock
    const validBatches = (m.medicine_batches||[]).filter(b => b.quantity > 0 && new Date(b.expiry_date) >= new Date());
    if (!validBatches.length) return `<div class="search-dropdown-item" style="opacity:.5"><div class="sd-name">${APP.esc(m.name)}</div><div class="sd-meta">No stock available</div></div>`;
    const totalQty = validBatches.reduce((s,b) => s + b.quantity, 0);
    return `<div class="search-dropdown-item" onclick="selectMedicine('${m.id}')">
      <div>
        <div class="sd-name">${APP.esc(m.name)} ${m.brand?`<small style="font-weight:400;color:var(--muted)">(${APP.esc(m.brand)})</small>`:''}</div>
        <div class="sd-meta">${APP.esc(m.generic_name||'')} • ${APP.esc(m.category||'')} • Stock: ${totalQty} units • GST: ${m.gst_percent}%</div>
      </div>
    </div>`;
  }).join('');
  billSearchResults.classList.add('open');
});

// Close dropdown when clicking outside
document.addEventListener('click', e => {
  if (!billSearchInput.contains(e.target) && !billSearchResults.contains(e.target)) {
    billSearchResults.classList.remove('open');
  }
});

/* ──────────────────────────────────────────────────────────────
   SELECT MEDICINE → show add-to-cart form
────────────────────────────────────────────────────────────── */
function selectMedicine(medId) {
  selectedMed = billMedicines.find(m => m.id === medId);
  if (!selectedMed) return;

  billSearchResults.classList.remove('open');
  billSearchInput.value = '';

  const validBatches = (selectedMed.medicine_batches||[]).filter(b => b.quantity > 0 && new Date(b.expiry_date) >= new Date());

  document.getElementById('selMedName').textContent = selectedMed.name + (selectedMed.brand ? ` (${selectedMed.brand})` : '');

  // Populate batch selector
  const batchSel = document.getElementById('selBatch');
  if (!validBatches.length) {
    batchSel.innerHTML = '<option value="">No valid batches</option>';
  } else {
    batchSel.innerHTML = validBatches.map(b =>
      `<option value="${b.id}" data-price="${b.selling_price}" data-qty="${b.quantity}" data-expiry="${b.expiry_date}">
        ${APP.esc(b.batch_number)} | Exp: ${APP.fmtDate(b.expiry_date)} | Qty: ${b.quantity}
      </option>`
    ).join('');
    // Auto-fill price from first batch
    const first = validBatches[0];
    document.getElementById('selPrice').value = Number(first.selling_price).toFixed(2);
    document.getElementById('selQty').value   = 1;
    document.getElementById('selDisc').value  = 0;
  }

  document.getElementById('addItemForm').style.display = 'block';
}

// When batch changes, update price
document.getElementById('selBatch').addEventListener('change', function() {
  const opt = this.options[this.selectedIndex];
  if (opt && opt.dataset.price) {
    document.getElementById('selPrice').value = Number(opt.dataset.price).toFixed(2);
  }
});

function cancelAddItem() {
  document.getElementById('addItemForm').style.display = 'none';
  selectedMed = null;
}

/* ──────────────────────────────────────────────────────────────
   ADD ITEM TO CART
────────────────────────────────────────────────────────────── */
function addToCart() {
  if (!selectedMed) return;

  const batchSel  = document.getElementById('selBatch');
  const batchId   = batchSel.value;
  const batchOpt  = batchSel.options[batchSel.selectedIndex];
  const qty       = parseInt(document.getElementById('selQty').value) || 1;
  const price     = parseFloat(document.getElementById('selPrice').value) || 0;
  const disc      = parseFloat(document.getElementById('selDisc').value) || 0;

  if (!batchId) { APP.toast('Please select a batch.', 'error'); return; }
  if (qty <= 0)  { APP.toast('Quantity must be at least 1.', 'error'); return; }

  // Check stock availability (including already-in-cart qty)
  const maxQty    = parseInt(batchOpt.dataset.qty) || 0;
  const inCartQty = cart.filter(c => c.batchId === batchId).reduce((s,c) => s+c.quantity, 0);
  if (qty + inCartQty > maxQty) {
    APP.toast(`Only ${maxQty - inCartQty} units available in this batch.`, 'error');
    return;
  }

  const gstPct   = Number(selectedMed.gst_percent) || 0;
  // Calculate: line_total = qty * price * (1 - disc/100)  (GST on top is for display; usually included in MRP)
  const baseAmt  = qty * price;
  const discAmt  = baseAmt * disc / 100;
  const taxableAmt = baseAmt - discAmt;
  const gstAmt   = taxableAmt * gstPct / 100;
  const lineTotal = taxableAmt + gstAmt;

  cart.push({
    batchId,
    medicineId:   selectedMed.id,
    medicineName: selectedMed.name,
    batchNumber:  batchOpt.text.split('|')[0].trim(),
    quantity:     qty,
    unitPrice:    price,
    discountPercent: disc,
    gstPercent:   gstPct,
    gstAmount:    gstAmt,
    lineTotal
  });

  document.getElementById('addItemForm').style.display = 'none';
  selectedMed = null;
  renderCart();
  APP.toast(qty + ' unit(s) added to cart.', 'success');
}

/* ──────────────────────────────────────────────────────────────
   RENDER CART
────────────────────────────────────────────────────────────── */
function renderCart() {
  const tbody = document.getElementById('cartTbody');
  if (!cart.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">Cart is empty. Search a medicine above.</td></tr>';
    updateBillSummary();
    return;
  }

  tbody.innerHTML = cart.map((item, idx) => `
    <tr>
      <td><strong>${APP.esc(item.medicineName)}</strong></td>
      <td><code style="font-size:.78rem">${APP.esc(item.batchNumber)}</code></td>
      <td>
        <input type="number" value="${item.quantity}" min="1" style="width:64px;padding:4px 6px;font-size:.82rem"
          onchange="updateCartQty(${idx}, this.value)"/>
      </td>
      <td>₹${item.unitPrice.toFixed(2)}</td>
      <td>${item.discountPercent}%</td>
      <td>${item.gstPercent}%</td>
      <td><strong>₹${item.lineTotal.toFixed(2)}</strong></td>
      <td><button class="btn-icon" onclick="removeCartItem(${idx})" title="Remove">❌</button></td>
    </tr>
  `).join('');

  updateBillSummary();
}

function updateCartQty(idx, newQty) {
  const qty = parseInt(newQty) || 1;
  if (qty < 1) return;
  const item = cart[idx];
  item.quantity  = qty;
  const base     = qty * item.unitPrice;
  const discAmt  = base * item.discountPercent / 100;
  const taxable  = base - discAmt;
  item.gstAmount = taxable * item.gstPercent / 100;
  item.lineTotal = taxable + item.gstAmount;
  renderCart();
}

function removeCartItem(idx) {
  cart.splice(idx, 1);
  renderCart();
}

function clearCart() {
  cart = [];
  renderCart();
  document.getElementById('bCustName').value  = '';
  document.getElementById('bCustPhone').value = '';
  document.getElementById('bAmountPaid').value = '';
  document.getElementById('bNotes').value = '';
}

/* ──────────────────────────────────────────────────────────────
   BILL SUMMARY
────────────────────────────────────────────────────────────── */
function updateBillSummary() {
  let subtotal = 0, totalDisc = 0, totalGst = 0;
  cart.forEach(item => {
    const base   = item.quantity * item.unitPrice;
    const disc   = base * item.discountPercent / 100;
    subtotal   += base;
    totalDisc  += disc;
    totalGst   += item.gstAmount;
  });
  const grand = subtotal - totalDisc + totalGst;
  document.getElementById('bsSubtotal').textContent  = '₹' + subtotal.toFixed(2);
  document.getElementById('bsDiscount').textContent  = '-₹' + totalDisc.toFixed(2);
  document.getElementById('bsGst').textContent       = '+₹' + totalGst.toFixed(2);
  document.getElementById('bsGrand').textContent     = '₹' + grand.toFixed(2);
  document.getElementById('bAmountPaid').placeholder = grand.toFixed(2);
}

/* ──────────────────────────────────────────────────────────────
   SAVE BILL
────────────────────────────────────────────────────────────── */
async function saveBill() {
  if (!cart.length) { APP.toast('Cart is empty!', 'error'); return; }

  let subtotal = 0, totalDisc = 0, totalGst = 0;
  cart.forEach(item => {
    const base  = item.quantity * item.unitPrice;
    const disc  = base * item.discountPercent / 100;
    subtotal  += base;
    totalDisc += disc;
    totalGst  += item.gstAmount;
  });
  const grand      = subtotal - totalDisc + totalGst;
  const amountPaid = parseFloat(document.getElementById('bAmountPaid').value) || grand;

  const btn = document.querySelector('#page-billing .btn-primary');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span>Saving…';

  try {
    const inv = await DB.saveInvoice({
      customerName:  document.getElementById('bCustName').value.trim(),
      customerPhone: document.getElementById('bCustPhone').value.trim(),
      subtotal, totalDisc, totalGst,
      grandTotal:    grand,
      amountPaid,
      paymentMethod: document.getElementById('bPayment').value,
      notes:         document.getElementById('bNotes').value.trim()
    }, cart.map(item => ({
      batchId:        item.batchId,
      medicineId:     item.medicineId,
      medicineName:   item.medicineName,
      batchNumber:    item.batchNumber,
      quantity:       item.quantity,
      unitPrice:      item.unitPrice,
      discountPercent:item.discountPercent,
      gstPercent:     item.gstPercent,
      gstAmount:      item.gstAmount,
      lineTotal:      item.lineTotal
    })));

    APP.toast('Bill saved! Invoice: ' + inv.invoice_number, 'success');

    // Print the invoice
    printInvoice(inv, cart, { subtotal, totalDisc, totalGst, grand, amountPaid });

    // Clear cart and reload medicines (stock updated)
    cart = [];
    renderCart();
    document.getElementById('bCustName').value  = '';
    document.getElementById('bCustPhone').value = '';
    document.getElementById('bAmountPaid').value = '';
    billMedicines = await DB.getMedicines();

  } catch(err) {
    APP.toast('Error saving bill: ' + err.message, 'error');
  } finally {
    btn.disabled = false; btn.innerHTML = '💾 Save & Print Bill';
  }
}

/* ──────────────────────────────────────────────────────────────
   PRINT INVOICE
────────────────────────────────────────────────────────────── */
function printInvoice(inv, items, totals) {
  const ph = DB.pharmacy();
  const printArea = document.getElementById('printArea');

  const rows = (items||inv.invoice_items||[]).map(item => `
    <tr>
      <td>${APP.esc(item.medicineName || item.medicine_name)}</td>
      <td>${APP.esc(item.batchNumber || item.batch_number)}</td>
      <td style="text-align:center">${item.quantity}</td>
      <td style="text-align:right">₹${Number(item.unitPrice||item.unit_price).toFixed(2)}</td>
      <td style="text-align:right">${item.discountPercent||item.discount_percent||0}%</td>
      <td style="text-align:right">${item.gstPercent||item.gst_percent||0}%</td>
      <td style="text-align:right"><strong>₹${Number(item.lineTotal||item.line_total).toFixed(2)}</strong></td>
    </tr>
  `).join('');

  const sub    = totals ? totals.subtotal  : Number(inv.subtotal);
  const disc   = totals ? totals.totalDisc : Number(inv.total_discount);
  const gst    = totals ? totals.totalGst  : Number(inv.total_gst);
  const grand  = totals ? totals.grand     : Number(inv.grand_total);
  const paid   = totals ? totals.amountPaid: Number(inv.amount_paid);
  const change = paid - grand;

  printArea.innerHTML = `
    <div class="invoice-print">
      <div class="inv-header">
        <div>
          <div class="inv-ph-name">💊 ${APP.esc(ph?.name || 'My Pharmacy')}</div>
          <div class="inv-ph-meta">
            ${ph?.address ? APP.esc(ph.address) + '<br>' : ''}
            ${ph?.phone   ? 'Ph: ' + APP.esc(ph.phone) + ' | ' : ''}
            ${ph?.email   ? APP.esc(ph.email) + '<br>' : ''}
            ${ph?.gst_number ? 'GSTIN: ' + APP.esc(ph.gst_number) : ''}
            ${ph?.license_number ? ' | Lic: ' + APP.esc(ph.license_number) : ''}
          </div>
        </div>
        <div class="inv-meta">
          <h3>TAX INVOICE</h3>
          <p><strong>${APP.esc(inv.invoice_number)}</strong></p>
          <p>Date: ${APP.fmtDate(inv.created_at || new Date())}</p>
          <p>Payment: ${(inv.payment_method||'cash').toUpperCase()}</p>
          <span class="inv-tag ${inv.status === 'cancelled' ? 'cancelled' : ''}">${(inv.status||'paid').toUpperCase()}</span>
        </div>
      </div>

      ${(inv.customer_name || inv.customer_phone) ? `
      <div class="inv-customer">
        <span><strong>Customer:</strong> ${APP.esc(inv.customer_name || 'Walk-in')}</span>
        ${inv.customer_phone ? `<span><strong>Phone:</strong> ${APP.esc(inv.customer_phone)}</span>` : ''}
      </div>` : ''}

      <table class="inv-table">
        <thead>
          <tr>
            <th>Medicine</th><th>Batch</th>
            <th style="text-align:center">Qty</th>
            <th style="text-align:right">Unit Price</th>
            <th style="text-align:right">Disc%</th>
            <th style="text-align:right">GST%</th>
            <th style="text-align:right">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="inv-totals">
        <div>Subtotal: ₹${sub.toFixed(2)}</div>
        <div>Discount: -₹${disc.toFixed(2)}</div>
        <div>GST: +₹${gst.toFixed(2)}</div>
        <div class="inv-grand">Grand Total: ₹${grand.toFixed(2)}</div>
        <div>Amount Paid: ₹${paid.toFixed(2)}</div>
        ${change > 0 ? `<div>Change: ₹${change.toFixed(2)}</div>` : ''}
      </div>

      <div class="inv-footer">
        Thank you for your purchase! • All medicines sold as per doctor's prescription.<br>
        Goods once sold will not be taken back. • This is a computer-generated invoice.
      </div>
    </div>
  `;

  printArea.style.display = 'block';
  window.print();
  printArea.style.display = 'none';
}

/* ──────────────────────────────────────────────────────────────
   INVOICE HISTORY PAGE
────────────────────────────────────────────────────────────── */
async function loadInvoices() {
  const tbody = document.getElementById('invTbody');
  tbody.innerHTML = '<tr><td colspan="9" class="empty-row"><span class="spinner-sm"></span> Loading…</td></tr>';
  try {
    const from = document.getElementById('invFrom').value;
    const to   = document.getElementById('invTo').value;
    const invs = await DB.getInvoices(from || null, to || null);

    // Apply search filter
    const q = (document.getElementById('invSearch').value || '').toLowerCase();
    const filtered = q ? invs.filter(i =>
      i.invoice_number.toLowerCase().includes(q) ||
      (i.customer_name||'').toLowerCase().includes(q)
    ) : invs;

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-row">No invoices found.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(inv => {
      const itemCount = (inv.invoice_items||[]).length;
      return `<tr>
        <td><strong style="color:var(--blue)">${APP.esc(inv.invoice_number)}</strong></td>
        <td>${APP.fmtDate(inv.created_at)}</td>
        <td>${APP.esc(inv.customer_name || 'Walk-in')}</td>
        <td style="text-align:center">${itemCount} item(s)</td>
        <td>₹${Number(inv.total_gst).toFixed(2)}</td>
        <td><strong>₹${Number(inv.grand_total).toFixed(2)}</strong></td>
        <td><span style="text-transform:uppercase;font-size:.78rem;font-weight:600">${inv.payment_method||'cash'}</span></td>
        <td><span class="pill ${inv.status==='paid'?'paid':'cancelled'}">${inv.status||'paid'}</span></td>
        <td>
          <div class="action-btns">
            <button class="btn-edit" onclick="viewInvoice('${inv.id}')">👁 View</button>
            <button class="btn-icon" onclick="reprintInvoice('${inv.id}')" title="Reprint">🖨</button>
            ${inv.status === 'paid' ? `<button class="btn-icon" onclick="cancelInv('${inv.id}','${APP.esc(inv.invoice_number)}')" title="Cancel">❌</button>` : ''}
          </div>
        </td>
      </tr>`;
    }).join('');
  } catch(err) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-row">Error: ${APP.esc(err.message)}</td></tr>`;
  }
}

document.getElementById('invSearch').addEventListener('input', () => loadInvoices());

async function viewInvoice(invId) {
  // Load full invoice data and show in modal
  try {
    const invs  = await DB.getInvoices();
    const inv   = invs.find(i => i.id === invId);
    if (!inv) return;

    document.getElementById('modalTitle').textContent = 'Invoice: ' + inv.invoice_number;
    const items = (inv.invoice_items||[]);
    document.getElementById('modalBody').innerHTML = `
      <div style="margin-bottom:12px">
        <span class="pill ${inv.status==='paid'?'paid':'cancelled'}">${inv.status||'paid'}</span>
        <span style="margin-left:10px;color:var(--muted);font-size:.82rem">${APP.fmtDate(inv.created_at)}</span>
      </div>
      <div class="detail-grid" style="margin-bottom:16px">
        <div class="detail-item"><label>Customer</label><div class="val">${APP.esc(inv.customer_name||'Walk-in')}</div></div>
        <div class="detail-item"><label>Phone</label><div class="val">${APP.esc(inv.customer_phone||'—')}</div></div>
        <div class="detail-item"><label>Payment</label><div class="val">${inv.payment_method||'cash'}</div></div>
        <div class="detail-item"><label>Grand Total</label><div class="val" style="color:var(--blue);font-weight:800">₹${Number(inv.grand_total).toFixed(2)}</div></div>
      </div>
      <div class="table-wrapper">
        <table class="data-table">
          <thead><tr><th>Medicine</th><th>Batch</th><th>Qty</th><th>Price</th><th>Disc%</th><th>GST%</th><th>Total</th></tr></thead>
          <tbody>${items.map(it=>`<tr>
            <td>${APP.esc(it.medicine_name)}</td>
            <td><code>${APP.esc(it.batch_number)}</code></td>
            <td>${it.quantity}</td>
            <td>₹${Number(it.unit_price).toFixed(2)}</td>
            <td>${it.discount_percent}%</td>
            <td>${it.gst_percent}%</td>
            <td>₹${Number(it.line_total).toFixed(2)}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
      <div style="text-align:right;margin-top:14px;font-size:.88rem;line-height:2">
        Subtotal: ₹${Number(inv.subtotal).toFixed(2)}<br>
        Discount: -₹${Number(inv.total_discount).toFixed(2)}<br>
        GST: +₹${Number(inv.total_gst).toFixed(2)}<br>
        <strong style="font-size:1.05rem">Grand Total: ₹${Number(inv.grand_total).toFixed(2)}</strong>
      </div>
    `;
    document.getElementById('modalDeleteBtn').textContent = '🖨 Reprint';
    document.getElementById('modalDeleteBtn').onclick = () => reprintInvoice(invId);
    document.getElementById('modalOverlay').classList.add('open');
  } catch(err) { APP.toast('Error: ' + err.message, 'error'); }
}

async function reprintInvoice(invId) {
  try {
    const invs = await DB.getInvoices();
    const inv  = invs.find(i => i.id === invId);
    if (inv) { closeModal(); printInvoice(inv, inv.invoice_items, null); }
  } catch(err) { APP.toast('Error: ' + err.message, 'error'); }
}

async function cancelInv(invId, invNum) {
  if (!confirm(`Cancel invoice ${invNum}? This will restore stock quantities.`)) return;
  try {
    await DB.cancelInvoice(invId);
    APP.toast('Invoice cancelled and stock restored.', 'success');
    loadInvoices();
    billMedicines = await DB.getMedicines();
  } catch(err) { APP.toast('Error: ' + err.message, 'error'); }
}

/* ──────────────────────────────────────────────────────────────
   INIT: load medicines when billing page is first visited
────────────────────────────────────────────────────────────── */
(async () => {
  await loadBillingMedicines();
})();

/* expose to global scope for inline onclick handlers */
window.selectMedicine  = selectMedicine;
window.cancelAddItem   = cancelAddItem;
window.addToCart       = addToCart;
window.removeCartItem  = removeCartItem;
window.updateCartQty   = updateCartQty;
window.clearCart       = clearCart;
window.saveBill        = saveBill;
window.loadInvoices    = loadInvoices;
window.viewInvoice     = viewInvoice;
window.reprintInvoice  = reprintInvoice;
window.cancelInv       = cancelInv;