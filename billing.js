/* ================================================================
   billing.js  v2  –  Professional POS Billing System
   Fixes: field-name mismatch, cart persistence, duplicate rows,
          unsafe onclick, double-submit, correct GST calculation
   ================================================================ */
'use strict';

/* ════════════════════════════════════════════════════════════════
   CART STATE  (persisted to sessionStorage so nav doesn't wipe it)
════════════════════════════════════════════════════════════════ */
const CART_KEY = 'pharmacare_cart_v2';
let cart = loadCartFromSession();
let billMedicines = [];   // loaded from DB
let _isSaving = false;    // double-submit guard

/* ── Session persistence ── */
function saveCartToSession() {
  try { sessionStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch(_) {}
}
function loadCartFromSession() {
  try {
    const raw = sessionStorage.getItem(CART_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch(_) { return []; }
}
function clearCartSession() {
  sessionStorage.removeItem(CART_KEY);
}

/* ════════════════════════════════════════════════════════════════
   LOAD MEDICINES (called when billing page opens)
════════════════════════════════════════════════════════════════ */
async function loadBillingMedicines() {
  try {
    billMedicines = await DB.getMedicines();
  } catch(err) {
    APP.toast('Could not load medicines: ' + err.message, 'error');
  }
}

/* ════════════════════════════════════════════════════════════════
   MEDICINE SEARCH BAR
════════════════════════════════════════════════════════════════ */
const billSearchInput   = document.getElementById('billSearch');
const billSearchResults = document.getElementById('billSearchResults');

billSearchInput.addEventListener('input', debounce(doSearch, 180));
billSearchInput.addEventListener('focus', () => { if (billSearchInput.value.trim()) doSearch(); });

function doSearch() {
  const q = billSearchInput.value.toLowerCase().trim();
  if (!q) { closeDropdown(); return; }

  const now = new Date(); now.setHours(0,0,0,0);
  const matches = billMedicines.filter(m =>
    m.name.toLowerCase().includes(q) ||
    (m.generic_name || '').toLowerCase().includes(q) ||
    (m.brand || '').toLowerCase().includes(q) ||
    (m.barcode || '').toLowerCase().includes(q)
  ).slice(0, 15);

  if (!matches.length) {
    billSearchResults.innerHTML =
      '<div class="sd-empty">No medicines found for "' + APP.esc(q) + '"</div>';
    openDropdown();
    return;
  }

  billSearchResults.innerHTML = matches.map(m => {
    const validBatches = (m.medicine_batches || []).filter(b =>
      b.quantity > 0 && new Date(b.expiry_date) > now
    );
    const totalQty = validBatches.reduce((s, b) => s + b.quantity, 0);
    const noStock  = validBatches.length === 0;

    const stockBadge = noStock
      ? '<span class="sd-badge out">Out of Stock</span>'
      : '<span class="sd-badge in">Stock: ' + totalQty + '</span>';

    const priceTag = validBatches.length
      ? '<span class="sd-price">\u20b9' + Number(validBatches[0].selling_price).toFixed(2) + '</span>'
      : '';

    return '<div class="sd-item' + (noStock ? ' sd-disabled' : '') + '"' +
           (noStock ? '' : ' data-medid="' + m.id + '"') +
           ' role="option" tabindex="0">' +
      '<div class="sd-item-main">' +
        '<span class="sd-name">' + APP.esc(m.name) +
          (m.brand ? ' <small class="sd-brand">(' + APP.esc(m.brand) + ')</small>' : '') +
        '</span>' +
        (m.generic_name ? '<span class="sd-generic">' + APP.esc(m.generic_name) + '</span>' : '') +
      '</div>' +
      '<div class="sd-item-meta">' +
        (m.category ? '<span>' + APP.esc(m.category) + '</span>' : '') +
        '<span>GST ' + (m.gst_percent || 0) + '%</span>' +
        priceTag +
        stockBadge +
      '</div>' +
    '</div>';
  }).join('');

  openDropdown();
}

/* Delegated click handler (no unsafe onclick in innerHTML) */
billSearchResults.addEventListener('click', e => {
  const item = e.target.closest('[data-medid]');
  if (item) selectMedicine(item.dataset.medid);
});
billSearchResults.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const item = e.target.closest('[data-medid]');
    if (item) selectMedicine(item.dataset.medid);
  }
});

function openDropdown()  { billSearchResults.classList.add('open'); }
function closeDropdown() { billSearchResults.classList.remove('open'); }

/* Close on outside click */
document.addEventListener('click', e => {
  if (!billSearchInput.contains(e.target) && !billSearchResults.contains(e.target)) {
    closeDropdown();
  }
});

/* ════════════════════════════════════════════════════════════════
   SELECT MEDICINE → Show add-to-cart mini-form
════════════════════════════════════════════════════════════════ */
let _selectedMed = null;

function selectMedicine(medId) {
  _selectedMed = billMedicines.find(m => m.id === medId);
  if (!_selectedMed) { APP.toast('Medicine not found. Try refreshing.', 'error'); return; }

  closeDropdown();
  billSearchInput.value = '';

  const now = new Date(); now.setHours(0,0,0,0);
  const validBatches = (_selectedMed.medicine_batches || []).filter(b =>
    b.quantity > 0 && new Date(b.expiry_date) > now
  );

  /* Name */
  document.getElementById('selMedName').textContent =
    _selectedMed.name + (_selectedMed.brand ? ' (' + _selectedMed.brand + ')' : '') +
    (_selectedMed.generic_name ? '  |  ' + _selectedMed.generic_name : '');

  /* Batch dropdown */
  const batchSel = document.getElementById('selBatch');
  if (!validBatches.length) {
    batchSel.innerHTML = '<option value="">No valid batches available</option>';
    document.getElementById('selPrice').value = '';
  } else {
    batchSel.innerHTML = validBatches.map(b =>
      '<option value="' + b.id + '"' +
        ' data-price="' + b.selling_price + '"' +
        ' data-qty="' + b.quantity + '"' +
        ' data-expiry="' + b.expiry_date + '">' +
        APP.esc(b.batch_number) + '  |  Exp: ' + APP.fmtDate(b.expiry_date) +
        '  |  Stock: ' + b.quantity +
      '</option>'
    ).join('');
    updateSelPrice();
  }

  document.getElementById('selQty').value  = 1;
  document.getElementById('selDisc').value = 0;
  document.getElementById('addItemForm').style.display = 'block';
  document.getElementById('selQty').focus();
  updateAddPreview();
}

/* Auto-fill price when batch changes */
document.getElementById('selBatch').addEventListener('change', () => {
  updateSelPrice();
  updateAddPreview();
});
document.getElementById('selQty').addEventListener('input',  updateAddPreview);
document.getElementById('selDisc').addEventListener('input', updateAddPreview);

function updateSelPrice() {
  const opt = document.getElementById('selBatch').options[
    document.getElementById('selBatch').selectedIndex
  ];
  if (opt && opt.dataset.price) {
    document.getElementById('selPrice').value = Number(opt.dataset.price).toFixed(2);
  }
}

/* Live preview of line total in the add-form */
function updateAddPreview() {
  const qty   = parseInt(document.getElementById('selQty').value)  || 0;
  const price = parseFloat(document.getElementById('selPrice').value) || 0;
  const disc  = parseFloat(document.getElementById('selDisc').value)  || 0;
  const gst   = _selectedMed ? Number(_selectedMed.gst_percent) || 0 : 0;

  // MRP-inclusive mode: selling_price already includes GST
  // taxable = price / (1 + gst/100)  →  then discount applied on taxable
  const lineGross  = qty * price;
  const discAmt    = lineGross * disc / 100;
  const lineNet    = lineGross - discAmt;
  const taxable    = gst > 0 ? lineNet / (1 + gst / 100) : lineNet;
  const gstAmt     = lineNet - taxable;

  const prev = document.getElementById('addPreviewTotal');
  if (prev) prev.textContent = 'Total: \u20b9' + lineNet.toFixed(2) +
    (gst > 0 ? '  (incl. GST \u20b9' + gstAmt.toFixed(2) + ')' : '');
}

function cancelAddItem() {
  document.getElementById('addItemForm').style.display = 'none';
  _selectedMed = null;
}

/* ════════════════════════════════════════════════════════════════
   ADD TO CART
════════════════════════════════════════════════════════════════ */
function addToCart() {
  if (!_selectedMed) return;

  const batchSel  = document.getElementById('selBatch');
  const batchId   = batchSel.value;
  const batchOpt  = batchSel.options[batchSel.selectedIndex];
  const qty       = parseInt(document.getElementById('selQty').value)    || 1;
  const price     = parseFloat(document.getElementById('selPrice').value) || 0;
  const disc      = parseFloat(document.getElementById('selDisc').value)  || 0;

  if (!batchId) { APP.toast('Please select a batch.', 'error'); return; }
  if (qty < 1)  { APP.toast('Quantity must be at least 1.', 'error'); return; }
  if (price <= 0) { APP.toast('Price must be greater than 0.', 'error'); return; }

  /* Stock check (accounting for what's already in cart for this batch) */
  const maxQty    = parseInt(batchOpt.dataset.qty) || 0;
  const inCartQty = cart.filter(c => c.batchId === batchId).reduce((s, c) => s + c.quantity, 0);
  if (qty + inCartQty > maxQty) {
    APP.toast('Only ' + (maxQty - inCartQty) + ' unit(s) left in this batch.', 'error');
    return;
  }

  const gstPct     = Number(_selectedMed.gst_percent) || 0;
  const batchExpiry = batchOpt.dataset.expiry || '';
  const batchNum    = (batchOpt.text.split('|')[0] || '').trim();

  /* ── GST-inclusive calculation ──
     Selling price = MRP (already includes GST)
     lineGross  = qty x price
     discAmt    = lineGross x disc%
     lineNet    = lineGross - discAmt    ← amount customer pays
     taxable    = lineNet / (1 + gst/100)
     gstAmt     = lineNet - taxable
  */
  const lineGross = qty * price;
  const discAmt   = lineGross * disc / 100;
  const lineNet   = lineGross - discAmt;
  const taxable   = gstPct > 0 ? lineNet / (1 + gstPct / 100) : lineNet;
  const gstAmt    = lineNet - taxable;

  /* ── Duplicate check: same medicine + same batch → merge qty ── */
  const existing = cart.find(c => c.batchId === batchId);
  if (existing) {
    existing.quantity  += qty;
    // Recalculate totals for merged row
    const lg2 = existing.quantity * existing.unitPrice;
    const da2 = lg2 * existing.discountPercent / 100;
    const ln2 = lg2 - da2;
    const tx2 = gstPct > 0 ? ln2 / (1 + gstPct / 100) : ln2;
    existing.gstAmount = ln2 - tx2;
    existing.lineTotal = ln2;
    APP.toast(qty + ' more unit(s) added to existing row.', 'success');
  } else {
    cart.push({
      batchId,
      medicineId:      _selectedMed.id,
      medicineName:    _selectedMed.name,
      batchNumber:     batchNum,
      expiryDate:      batchExpiry,
      quantity:        qty,
      unitPrice:       price,
      discountPercent: disc,
      gstPercent:      gstPct,
      gstAmount:       parseFloat(gstAmt.toFixed(4)),
      lineTotal:       parseFloat(lineNet.toFixed(4))
    });
    APP.toast(qty + ' unit(s) added to cart.', 'success');
  }

  saveCartToSession();
  document.getElementById('addItemForm').style.display = 'none';
  _selectedMed = null;
  renderCart();
}

/* ════════════════════════════════════════════════════════════════
   RENDER CART
════════════════════════════════════════════════════════════════ */
function renderCart() {
  const tbody = document.getElementById('cartTbody');

  if (!cart.length) {
    tbody.innerHTML =
      '<tr><td colspan="9" class="empty-row">' +
        '<div class="cart-empty-state">\ud83d\uded2 Cart is empty. Search a medicine above.</div>' +
      '</td></tr>';
    updateBillSummary();
    return;
  }

  tbody.innerHTML = cart.map((item, idx) => {
    const cgst = (item.gstAmount / 2).toFixed(2);
    const sgst = (item.gstAmount / 2).toFixed(2);
    return '<tr class="cart-row">' +
      '<td><div class="cart-med-name">' + APP.esc(item.medicineName) + '</div></td>' +
      '<td><code class="batch-code">' + APP.esc(item.batchNumber) + '</code>' +
        '<div class="cart-expiry">Exp: ' + APP.fmtDate(item.expiryDate) + '</div></td>' +
      '<td>' +
        '<div class="qty-ctrl">' +
          '<button class="qty-btn" onclick="changeQty(' + idx + ',-1)">&#8722;</button>' +
          '<input type="number" class="qty-input" value="' + item.quantity +
            '" min="1" onchange="updateCartQty(' + idx + ',this.value)"/>' +
          '<button class="qty-btn" onclick="changeQty(' + idx + ',1)">&#43;</button>' +
        '</div>' +
      '</td>' +
      '<td>\u20b9' + item.unitPrice.toFixed(2) + '</td>' +
      '<td>' + item.discountPercent + '%</td>' +
      '<td><span title="CGST: \u20b9' + cgst + ' | SGST: \u20b9' + sgst + '">' +
           item.gstPercent + '%</span></td>' +
      '<td><strong>\u20b9' + item.lineTotal.toFixed(2) + '</strong></td>' +
      '<td><button class="btn-remove" onclick="removeCartItem(' + idx + ')" title="Remove">\u2715</button></td>' +
    '</tr>';
  }).join('');

  updateBillSummary();
}

/* Change qty with +/- buttons */
function changeQty(idx, delta) {
  const item   = cart[idx];
  const newQty = item.quantity + delta;
  if (newQty < 1) { removeCartItem(idx); return; }

  /* Stock check */
  const med = billMedicines.find(m => m.id === item.medicineId);
  if (med) {
    const batch  = (med.medicine_batches || []).find(b => b.id === item.batchId);
    const maxQty = batch ? batch.quantity : 9999;
    if (newQty > maxQty) {
      APP.toast('Only ' + maxQty + ' units in stock.', 'error');
      return;
    }
  }
  updateCartQty(idx, newQty);
}

function updateCartQty(idx, newQty) {
  const qty = parseInt(newQty) || 1;
  if (qty < 1) { removeCartItem(idx); return; }

  const item    = cart[idx];
  const lg      = qty * item.unitPrice;
  const da      = lg * item.discountPercent / 100;
  const ln      = lg - da;
  const tx      = item.gstPercent > 0 ? ln / (1 + item.gstPercent / 100) : ln;
  item.quantity  = qty;
  item.gstAmount = parseFloat((ln - tx).toFixed(4));
  item.lineTotal  = parseFloat(ln.toFixed(4));

  saveCartToSession();
  renderCart();
}

function removeCartItem(idx) {
  cart.splice(idx, 1);
  saveCartToSession();
  renderCart();
}

function clearCart() {
  if (cart.length && !confirm('Clear the entire cart?')) return;
  cart = [];
  clearCartSession();
  renderCart();
  ['bCustName','bCustPhone','bAmountPaid','bNotes'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

/* ════════════════════════════════════════════════════════════════
   BILL SUMMARY
════════════════════════════════════════════════════════════════ */
function updateBillSummary() {
  let grossTotal = 0, totalDiscount = 0, totalGst = 0, taxableTotal = 0;

  cart.forEach(item => {
    const gross   = item.quantity * item.unitPrice;
    const discAmt = gross * item.discountPercent / 100;
    const net     = gross - discAmt;
    grossTotal   += gross;
    totalDiscount += discAmt;
    totalGst      += item.gstAmount;
    taxableTotal  += (net - item.gstAmount);
  });

  const grand = grossTotal - totalDiscount;  // lineTotal already includes GST

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('bsSubtotal',  '\u20b9' + grossTotal.toFixed(2));
  set('bsDiscount',  '-\u20b9' + totalDiscount.toFixed(2));
  set('bsTaxable',   '\u20b9' + (grand - totalGst).toFixed(2));
  set('bsGst',       '+\u20b9' + totalGst.toFixed(2));
  set('bsGrand',     '\u20b9' + grand.toFixed(2));

  const paidEl = document.getElementById('bAmountPaid');
  if (paidEl) paidEl.placeholder = grand.toFixed(2);

  /* Change amount */
  const paid   = parseFloat(paidEl?.value) || 0;
  const change = paid > 0 ? paid - grand : 0;
  const changeEl = document.getElementById('bsChange');
  if (changeEl) changeEl.textContent = change >= 0 ? '\u20b9' + change.toFixed(2) : '—';
}

/* Recalculate when amount-paid field changes */
const bAmtEl = document.getElementById('bAmountPaid');
if (bAmtEl) bAmtEl.addEventListener('input', updateBillSummary);

/* ════════════════════════════════════════════════════════════════
   SAVE BILL (generate invoice)
════════════════════════════════════════════════════════════════ */
async function saveBill() {
  if (_isSaving) return;
  if (!cart.length) { APP.toast('Cart is empty!', 'error'); return; }

  /* Final totals */
  let subtotal = 0, totalDiscount = 0, totalGst = 0;
  cart.forEach(item => {
    const gross   = item.quantity * item.unitPrice;
    const discAmt = gross * item.discountPercent / 100;
    subtotal      += gross;
    totalDiscount += discAmt;
    totalGst      += item.gstAmount;
  });
  const grand      = subtotal - totalDiscount;
  const amountPaid = parseFloat(document.getElementById('bAmountPaid').value) || grand;

  _isSaving = true;
  const btn = document.getElementById('saveBillBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-sm"></span>Saving\u2026'; }

  try {
    /* Re-verify stock before saving */
    const freshMeds = await DB.getMedicines();
    for (const item of cart) {
      let batchFound = false;
      for (const m of freshMeds) {
        const b = (m.medicine_batches || []).find(b => b.id === item.batchId);
        if (b) {
          batchFound = true;
          if (item.quantity > b.quantity) {
            throw new Error(item.medicineName + ' (batch ' + item.batchNumber +
              '): only ' + b.quantity + ' units left. Please adjust cart.');
          }
          break;
        }
      }
      if (!batchFound) throw new Error('Batch for ' + item.medicineName + ' not found. It may have been deleted.');
    }

    const inv = await DB.saveInvoice({
      customerName:   document.getElementById('bCustName').value.trim() || null,
      customerPhone:  document.getElementById('bCustPhone').value.trim() || null,
      subtotal,
      totalDiscount,  // ← fixed: was totalDisc (wrong key)
      totalGst,
      grandTotal:     grand,
      amountPaid,
      paymentMethod:  document.getElementById('bPayment').value,
      notes:          document.getElementById('bNotes').value.trim() || null
    }, cart.map(item => ({
      batchId:         item.batchId,
      medicineId:      item.medicineId,
      medicineName:    item.medicineName,
      batchNumber:     item.batchNumber,
      quantity:        item.quantity,
      unitPrice:       item.unitPrice,
      discountPercent: item.discountPercent,
      gstPercent:      item.gstPercent,
      gstAmount:       item.gstAmount,
      lineTotal:       item.lineTotal
    })));

    APP.toast('\u2705 Bill saved! Invoice: ' + inv.invoice_number, 'success');
    printInvoice(inv, cart, { subtotal, totalDiscount, totalGst, grand, amountPaid });

    /* Clear cart & refresh medicine stock */
    cart = [];
    clearCartSession();
    renderCart();
    ['bCustName','bCustPhone','bAmountPaid','bNotes'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    billMedicines = await DB.getMedicines();

  } catch(err) {
    APP.toast('Error saving bill: ' + err.message, 'error');
    console.error('saveBill error', err);
  } finally {
    _isSaving = false;
    if (btn) { btn.disabled = false; btn.innerHTML = '\ud83d\udcbe Generate Bill'; }
  }
}

/* ════════════════════════════════════════════════════════════════
   PRINT INVOICE
════════════════════════════════════════════════════════════════ */
function printInvoice(inv, items, totals) {
  const ph  = DB.pharmacy();
  const printArea = document.getElementById('printArea');

  const sub   = totals ? totals.subtotal       : Number(inv.subtotal);
  const disc  = totals ? totals.totalDiscount  : Number(inv.total_discount);
  const gst   = totals ? totals.totalGst       : Number(inv.total_gst);
  const grand = totals ? totals.grand          : Number(inv.grand_total);
  const paid  = totals ? totals.amountPaid     : Number(inv.amount_paid);
  const change = Math.max(0, paid - grand);

  const rows = (items || inv.invoice_items || []).map((item, i) => {
    const medName   = APP.esc(item.medicineName  || item.medicine_name  || '');
    const batchNum  = APP.esc(item.batchNumber   || item.batch_number   || '');
    const qty       = item.quantity;
    const uprice    = Number(item.unitPrice      || item.unit_price     || 0).toFixed(2);
    const discP     = item.discountPercent       || item.discount_percent || 0;
    const gstP      = item.gstPercent            || item.gst_percent    || 0;
    const total     = Number(item.lineTotal      || item.line_total     || 0).toFixed(2);
    return '<tr>' +
      '<td>' + (i + 1) + '</td>' +
      '<td>' + medName + '</td>' +
      '<td>' + batchNum + '</td>' +
      '<td style="text-align:center">' + qty + '</td>' +
      '<td style="text-align:right">\u20b9' + uprice + '</td>' +
      '<td style="text-align:right">' + discP + '%</td>' +
      '<td style="text-align:right">' + gstP + '%</td>' +
      '<td style="text-align:right"><strong>\u20b9' + total + '</strong></td>' +
    '</tr>';
  }).join('');

  printArea.innerHTML =
    '<div class="invoice-print">' +
      '<div class="inv-header">' +
        '<div>' +
          '<div class="inv-ph-name">\ud83d\udc8a ' + APP.esc(ph ? ph.name : 'My Pharmacy') + '</div>' +
          '<div class="inv-ph-meta">' +
            (ph && ph.address   ? APP.esc(ph.address) + '<br>' : '') +
            (ph && ph.phone     ? 'Ph: ' + APP.esc(ph.phone) + ' | ' : '') +
            (ph && ph.email     ? APP.esc(ph.email) + '<br>' : '') +
            (ph && ph.gst_number    ? 'GSTIN: ' + APP.esc(ph.gst_number) : '') +
            (ph && ph.license_number ? ' | Lic: ' + APP.esc(ph.license_number) : '') +
          '</div>' +
        '</div>' +
        '<div class="inv-meta">' +
          '<h3>TAX INVOICE</h3>' +
          '<p><strong>' + APP.esc(inv.invoice_number) + '</strong></p>' +
          '<p>Date: ' + APP.fmtDate(inv.created_at || new Date()) + '</p>' +
          '<p>Payment: ' + (inv.payment_method || 'cash').toUpperCase() + '</p>' +
        '</div>' +
      '</div>' +

      ((inv.customer_name || inv.customer_phone)
        ? '<div class="inv-customer">' +
            '<span><strong>Customer:</strong> ' + APP.esc(inv.customer_name || 'Walk-in') + '</span>' +
            (inv.customer_phone ? '<span><strong>Phone:</strong> ' + APP.esc(inv.customer_phone) + '</span>' : '') +
          '</div>'
        : '') +

      '<table class="inv-table">' +
        '<thead><tr>' +
          '<th>#</th><th>Medicine</th><th>Batch</th>' +
          '<th style="text-align:center">Qty</th>' +
          '<th style="text-align:right">Unit Price</th>' +
          '<th style="text-align:right">Disc%</th>' +
          '<th style="text-align:right">GST%</th>' +
          '<th style="text-align:right">Total</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +

      '<div class="inv-totals">' +
        '<div>Subtotal (before disc): \u20b9' + sub.toFixed(2) + '</div>' +
        '<div>Discount: -\u20b9' + disc.toFixed(2) + '</div>' +
        '<div>GST (incl. in price): \u20b9' + gst.toFixed(2) + '</div>' +
        '<div class="inv-grand">Grand Total: \u20b9' + grand.toFixed(2) + '</div>' +
        '<div>Amount Paid: \u20b9' + paid.toFixed(2) + '</div>' +
        (change > 0 ? '<div>Change: \u20b9' + change.toFixed(2) + '</div>' : '') +
      '</div>' +

      '<div class="inv-footer">' +
        'Thank you for your purchase! \u2022 All medicines sold as per doctor's prescription.<br>' +
        'Goods once sold will not be taken back. \u2022 This is a computer-generated invoice.' +
      '</div>' +
    '</div>';

  printArea.style.display = 'block';
  window.print();
  printArea.style.display = 'none';
}

/* ════════════════════════════════════════════════════════════════
   INVOICE HISTORY
════════════════════════════════════════════════════════════════ */
async function loadInvoices() {
  const tbody = document.getElementById('invTbody');
  tbody.innerHTML = '<tr><td colspan="9" class="empty-row"><span class="spinner-sm"></span> Loading\u2026</td></tr>';
  try {
    const from = document.getElementById('invFrom').value || null;
    const to   = document.getElementById('invTo').value   || null;
    const invs = await DB.getInvoices(from, to);

    const q        = (document.getElementById('invSearch').value || '').toLowerCase();
    const filtered = q ? invs.filter(i =>
      i.invoice_number.toLowerCase().includes(q) ||
      (i.customer_name || '').toLowerCase().includes(q)
    ) : invs;

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-row">No invoices found.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(inv => {
      const items = (inv.invoice_items || []).length;
      return '<tr>' +
        '<td><strong style="color:var(--primary)">' + APP.esc(inv.invoice_number) + '</strong></td>' +
        '<td>' + APP.fmtDate(inv.created_at) + '</td>' +
        '<td>' + APP.esc(inv.customer_name || 'Walk-in') + '</td>' +
        '<td style="text-align:center">' + items + '</td>' +
        '<td>\u20b9' + Number(inv.total_gst).toFixed(2) + '</td>' +
        '<td><strong>\u20b9' + Number(inv.grand_total).toFixed(2) + '</strong></td>' +
        '<td style="text-transform:uppercase;font-size:.78rem;font-weight:600">' + (inv.payment_method || 'cash') + '</td>' +
        '<td><span class="pill ' + (inv.status === 'paid' ? 'paid' : 'cancelled') + '">' + (inv.status || 'paid') + '</span></td>' +
        '<td><div class="action-btns">' +
          '<button class="btn-edit" onclick="viewInvoice(\'' + inv.id + '\')">\ud83d\udc41 View</button>' +
          '<button class="btn-icon" onclick="reprintInvoice(\'' + inv.id + '\')" title="Reprint">\ud83d\udda8</button>' +
          (inv.status === 'paid'
            ? '<button class="btn-icon" onclick="cancelInv(\'' + inv.id + '\',\'' + APP.esc(inv.invoice_number) + '\')" title="Cancel">\u274c</button>'
            : '') +
        '</div></td>' +
      '</tr>';
    }).join('');
  } catch(err) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-row">Error: ' + APP.esc(err.message) + '</td></tr>';
  }
}

document.getElementById('invSearch').addEventListener('input', () => loadInvoices());

async function viewInvoice(invId) {
  try {
    const invs = await DB.getInvoices();
    const inv  = invs.find(i => i.id === invId);
    if (!inv) { APP.toast('Invoice not found.', 'error'); return; }

    const items = inv.invoice_items || [];
    document.getElementById('modalTitle').textContent = 'Invoice: ' + inv.invoice_number;
    document.getElementById('modalBody').innerHTML =
      '<div style="margin-bottom:12px">' +
        '<span class="pill ' + (inv.status === 'paid' ? 'paid' : 'cancelled') + '">' + (inv.status || 'paid') + '</span>' +
        '<span style="margin-left:10px;color:var(--muted);font-size:.82rem">' + APP.fmtDate(inv.created_at) + '</span>' +
      '</div>' +
      '<div class="detail-grid" style="margin-bottom:16px">' +
        '<div class="detail-item"><label>Customer</label><div class="val">' + APP.esc(inv.customer_name || 'Walk-in') + '</div></div>' +
        '<div class="detail-item"><label>Phone</label><div class="val">' + APP.esc(inv.customer_phone || '\u2014') + '</div></div>' +
        '<div class="detail-item"><label>Payment</label><div class="val">' + (inv.payment_method || 'cash') + '</div></div>' +
        '<div class="detail-item"><label>Grand Total</label><div class="val" style="color:var(--primary);font-weight:800">\u20b9' + Number(inv.grand_total).toFixed(2) + '</div></div>' +
      '</div>' +
      '<div class="table-wrapper">' +
        '<table class="data-table">' +
          '<thead><tr><th>Medicine</th><th>Batch</th><th>Qty</th><th>Price</th><th>Disc%</th><th>GST%</th><th>Total</th></tr></thead>' +
          '<tbody>' + items.map(it =>
            '<tr>' +
              '<td>' + APP.esc(it.medicine_name) + '</td>' +
              '<td><code>' + APP.esc(it.batch_number) + '</code></td>' +
              '<td>' + it.quantity + '</td>' +
              '<td>\u20b9' + Number(it.unit_price).toFixed(2) + '</td>' +
              '<td>' + (it.discount_percent || 0) + '%</td>' +
              '<td>' + (it.gst_percent || 0) + '%</td>' +
              '<td>\u20b9' + Number(it.line_total).toFixed(2) + '</td>' +
            '</tr>'
          ).join('') + '</tbody>' +
        '</table>' +
      '</div>' +
      '<div style="text-align:right;margin-top:14px;font-size:.88rem;line-height:2.2">' +
        'Subtotal: \u20b9' + Number(inv.subtotal).toFixed(2) + '<br>' +
        'Discount: -\u20b9' + Number(inv.total_discount).toFixed(2) + '<br>' +
        'GST: +\u20b9' + Number(inv.total_gst).toFixed(2) + '<br>' +
        '<strong style="font-size:1.05rem">Grand Total: \u20b9' + Number(inv.grand_total).toFixed(2) + '</strong>' +
      '</div>';

    document.getElementById('modalDeleteBtn').textContent = '\ud83d\udda8 Reprint';
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
  if (!confirm('Cancel invoice ' + invNum + '? This will restore stock quantities.')) return;
  try {
    await DB.cancelInvoice(invId);
    APP.toast('Invoice cancelled and stock restored.', 'success');
    loadInvoices();
    billMedicines = await DB.getMedicines();
  } catch(err) { APP.toast('Error: ' + err.message, 'error'); }
}

/* ════════════════════════════════════════════════════════════════
   UTILITY
════════════════════════════════════════════════════════════════ */
function debounce(fn, delay) {
  let t;
  return function() {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, arguments), delay);
  };
}

/* ════════════════════════════════════════════════════════════════
   INIT: load medicines + render cart from session
════════════════════════════════════════════════════════════════ */
(async () => {
  await loadBillingMedicines();
  renderCart();  // restore cart from sessionStorage on first load
})();

/* ── Expose to global scope ── */
window.selectMedicine   = selectMedicine;
window.cancelAddItem    = cancelAddItem;
window.addToCart        = addToCart;
window.changeQty        = changeQty;
window.updateCartQty    = updateCartQty;
window.removeCartItem   = removeCartItem;
window.clearCart        = clearCart;
window.saveBill         = saveBill;
window.loadInvoices     = loadInvoices;
window.viewInvoice      = viewInvoice;
window.reprintInvoice   = reprintInvoice;
window.cancelInv        = cancelInv;
window.loadBillingMedicines = loadBillingMedicines;
