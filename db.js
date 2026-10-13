/* ================================================================
   db.js  –  Database layer
   All Supabase calls are here. app.js calls these functions.
   This keeps the code organized: UI logic in app.js, DB in db.js
   ================================================================ */

'use strict';

/* ---- current pharmacy (set after login) ---- */
let _pharmacy = null;
let _user     = null;

async function initDB() {
  _user     = await requireAuth();
  _pharmacy = await getOrCreatePharmacy(_user);

  // One-time migration: move localStorage data to Supabase
  await migrateLocalStorage();
  return { user: _user, pharmacy: _pharmacy };
}

/* ================================================================
   MEDICINES
   ================================================================ */

async function dbGetMedicines() {
  const { data, error } = await SUPA
    .from('medicines')
    .select(`
      *,
      medicine_batches (
        id, batch_number, expiry_date, received_date, marketed_date,
        manufactured_date, quantity, purchase_price, selling_price,
        supplier_id, is_active
      )
    `)
    .eq('pharmacy_id', _pharmacy.id)
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data || [];
}

async function dbAddMedicine(med) {
  // 1. Insert medicine master record
  const { data: medRow, error: e1 } = await SUPA
    .from('medicines')
    .insert({
      pharmacy_id:      _pharmacy.id,
      name:             med.name,
      generic_name:     med.generic,
      brand:            med.brand,
      category:         med.category,
      hsn_code:         med.hsn,
      gst_percent:      parseFloat(med.gst) || 12,
      barcode:          med.barcode,
      manufacturer:     med.manufacturer,
      storage_condition: med.storage,
      min_stock_level:  parseInt(med.minStock) || 10,
      notes:            med.notes
    })
    .select()
    .single();
  if (e1) throw e1;

  // 2. Insert first batch
  const { data: batchRow, error: e2 } = await SUPA
    .from('medicine_batches')
    .insert({
      medicine_id:       medRow.id,
      pharmacy_id:       _pharmacy.id,
      batch_number:      med.batch,
      supplier_id:       med.supplierId || null,
      manufactured_date: med.manufactured || null,
      marketed_date:     med.marketed || null,
      expiry_date:       med.expiry,
      received_date:     med.received,
      quantity:          parseInt(med.qty),
      purchase_price:    parseFloat(med.purchasePrice) || 0,
      selling_price:     parseFloat(med.sellingPrice) || 0
    })
    .select()
    .single();
  if (e2) throw e2;

  return { medicine: medRow, batch: batchRow };
}

async function dbUpdateMedicine(medicineId, updates) {
  const { error } = await SUPA
    .from('medicines')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', medicineId)
    .eq('pharmacy_id', _pharmacy.id);
  if (error) throw error;
}

async function dbDeleteMedicine(medicineId) {
  // Soft-delete: mark is_active = false, keep records for invoice history
  const { error } = await SUPA
    .from('medicines')
    .update({ is_active: false })
    .eq('id', medicineId)
    .eq('pharmacy_id', _pharmacy.id);
  if (error) throw error;
}

async function dbAddBatch(medicineId, batchData) {
  const { data, error } = await SUPA
    .from('medicine_batches')
    .insert({ ...batchData, medicine_id: medicineId, pharmacy_id: _pharmacy.id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/* ================================================================
   SUPPLIERS
   ================================================================ */

async function dbGetSuppliers() {
  const { data, error } = await SUPA
    .from('suppliers')
    .select('*')
    .eq('pharmacy_id', _pharmacy.id)
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data || [];
}

async function dbAddSupplier(sup) {
  const { data, error } = await SUPA
    .from('suppliers')
    .insert({ ...sup, pharmacy_id: _pharmacy.id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function dbUpdateSupplier(id, updates) {
  const { error } = await SUPA
    .from('suppliers')
    .update(updates)
    .eq('id', id)
    .eq('pharmacy_id', _pharmacy.id);
  if (error) throw error;
}

async function dbDeleteSupplier(id) {
  const { error } = await SUPA
    .from('suppliers')
    .update({ is_active: false })
    .eq('id', id)
    .eq('pharmacy_id', _pharmacy.id);
  if (error) throw error;
}

/* ================================================================
   BILLING / INVOICES
   ================================================================ */

/**
 * Saves a complete invoice with all line items.
 * Uses sequential DB calls to ensure stock is deducted correctly.
 */
async function dbSaveInvoice(invoiceData, items) {
  // 1. Generate invoice number server-side
  const { data: numData, error: numErr } = await SUPA
    .rpc('generate_invoice_number', { p_pharmacy_id: _pharmacy.id });
  if (numErr) throw numErr;
  const invoiceNumber = numData;

  // 2. Insert invoice header
  const { data: inv, error: invErr } = await SUPA
    .from('invoices')
    .insert({
      pharmacy_id:    _pharmacy.id,
      invoice_number: invoiceNumber,
      customer_name:  invoiceData.customerName || null,
      customer_phone: invoiceData.customerPhone || null,
      subtotal:       invoiceData.subtotal,
      total_discount: invoiceData.totalDiscount,
      total_gst:      invoiceData.totalGst,
      grand_total:    invoiceData.grandTotal,
      amount_paid:    invoiceData.amountPaid,
      payment_method: invoiceData.paymentMethod || 'cash',
      notes:          invoiceData.notes || null
    })
    .select()
    .single();
  if (invErr) throw invErr;

  // 3. Insert line items
  const lineItems = items.map(item => ({
    invoice_id:       inv.id,
    batch_id:         item.batchId,
    medicine_id:      item.medicineId,
    medicine_name:    item.medicineName,
    batch_number:     item.batchNumber,
    quantity:         item.quantity,
    unit_price:       item.unitPrice,
    discount_percent: item.discountPercent || 0,
    gst_percent:      item.gstPercent || 0,
    gst_amount:       item.gstAmount || 0,
    line_total:       item.lineTotal
  }));
  const { error: itemErr } = await SUPA.from('invoice_items').insert(lineItems);
  if (itemErr) throw itemErr;

  // 4. Deduct stock from each batch
  for (const item of items) {
    const { error: stockErr } = await SUPA
      .rpc('deduct_batch_stock', { p_batch_id: item.batchId, p_qty: item.quantity });
    if (stockErr) throw stockErr;
  }

  return inv;
}

async function dbGetInvoices(fromDate, toDate) {
  let q = SUPA
    .from('invoices')
    .select(`*, invoice_items(*)`)
    .eq('pharmacy_id', _pharmacy.id)
    .order('created_at', { ascending: false });
  if (fromDate) q = q.gte('created_at', fromDate);
  if (toDate)   q = q.lte('created_at', toDate + 'T23:59:59');
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function dbCancelInvoice(invoiceId) {
  // 1. Get the invoice items to restore stock
  const { data: items, error: e1 } = await SUPA
    .from('invoice_items')
    .select('*')
    .eq('invoice_id', invoiceId);
  if (e1) throw e1;

  // 2. Restore stock for each item
  for (const item of items) {
    const { error } = await SUPA
      .rpc('restore_batch_stock', { p_batch_id: item.batch_id, p_qty: item.quantity });
    if (error) throw error;
  }

  // 3. Mark invoice as cancelled
  const { error: e3 } = await SUPA
    .from('invoices')
    .update({ status: 'cancelled' })
    .eq('id', invoiceId)
    .eq('pharmacy_id', _pharmacy.id);
  if (e3) throw e3;
}

/* ================================================================
   DASHBOARD STATS  (calculated from real DB records)
   ================================================================ */

async function dbGetDashboardStats() {
  const today = new Date().toISOString().split('T')[0];
  const todayStart = today + 'T00:00:00';
  const todayEnd   = today + 'T23:59:59';

  // All active batches
  const { data: batches } = await SUPA
    .from('medicine_batches')
    .select('medicine_id, expiry_date, quantity, selling_price, purchase_price')
    .eq('pharmacy_id', _pharmacy.id)
    .eq('is_active', true);

  // All medicines (for min_stock_level)
  const { data: meds } = await SUPA
    .from('medicines')
    .select('id, min_stock_level')
    .eq('pharmacy_id', _pharmacy.id)
    .eq('is_active', true);

  const medMinStock = {};
  (meds || []).forEach(m => { medMinStock[m.id] = m.min_stock_level || 10; });

  let totalProducts = (meds || []).length;
  let totalUnits = 0, expired = 0, expiringSoon = 0, lowStock = 0;
  const now = new Date(); now.setHours(0,0,0,0);
  const week = new Date(now); week.setDate(week.getDate() + 7);

  const stockByMed = {};
  (batches || []).forEach(b => {
    const exp = new Date(b.expiry_date);
    if (exp < now)       expired++;
    else if (exp <= week) expiringSoon++;
    totalUnits += b.quantity;
    stockByMed[b.medicine_id] = (stockByMed[b.medicine_id] || 0) + b.quantity;
  });

  Object.keys(stockByMed).forEach(mid => {
    if (stockByMed[mid] <= (medMinStock[mid] || 10)) lowStock++;
  });

  // Today's sales
  const { data: todayInvs } = await SUPA
    .from('invoices')
    .select('grand_total, status')
    .eq('pharmacy_id', _pharmacy.id)
    .eq('status', 'paid')
    .gte('created_at', todayStart)
    .lte('created_at', todayEnd);

  const todaySales = (todayInvs || []).reduce((s, i) => s + Number(i.grand_total), 0);
  const todayCount = (todayInvs || []).length;

  // This month's sales
  const monthStart = today.slice(0, 7) + '-01T00:00:00';
  const { data: monthInvs } = await SUPA
    .from('invoices')
    .select('grand_total')
    .eq('pharmacy_id', _pharmacy.id)
    .eq('status', 'paid')
    .gte('created_at', monthStart);

  const monthlySales = (monthInvs || []).reduce((s, i) => s + Number(i.grand_total), 0);

  return { totalProducts, totalUnits, expired, expiringSoon, lowStock, todaySales, todayCount, monthlySales };
}

/* ================================================================
   REPORTS
   ================================================================ */

async function dbGetSalesReport(fromDate, toDate) {
  let q = SUPA
    .from('invoices')
    .select(`grand_total, total_gst, total_discount, payment_method, created_at, status`)
    .eq('pharmacy_id', _pharmacy.id)
    .eq('status', 'paid');
  if (fromDate) q = q.gte('created_at', fromDate + 'T00:00:00');
  if (toDate)   q = q.lte('created_at', toDate + 'T23:59:59');
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function dbGetTopMedicines() {
  const { data, error } = await SUPA
    .from('invoice_items')
    .select('medicine_name, quantity')
    .in('invoice_id',
      (await SUPA.from('invoices').select('id').eq('pharmacy_id', _pharmacy.id).eq('status','paid')).data.map(i=>i.id)
    );
  if (error) throw error;
  const totals = {};
  (data || []).forEach(item => {
    totals[item.medicine_name] = (totals[item.medicine_name] || 0) + item.quantity;
  });
  return Object.entries(totals).sort((a,b) => b[1]-a[1]).slice(0, 10);
}

/* ================================================================
   PHARMACY PROFILE
   ================================================================ */

async function dbUpdatePharmacy(updates) {
  const { error } = await SUPA
    .from('pharmacies')
    .update(updates)
    .eq('id', _pharmacy.id);
  if (error) throw error;
  Object.assign(_pharmacy, updates);
}

/* ================================================================
   ONE-TIME MIGRATION: localStorage → Supabase
   Runs automatically on first login if old data exists.
   ================================================================ */

async function migrateLocalStorage() {
  const MIGRATION_KEY = 'pharmacare_migrated_v1';
  if (localStorage.getItem(MIGRATION_KEY)) return; // already done

  const OLD_KEY = 'pharmacare_medicines';
  const oldData = localStorage.getItem(OLD_KEY);
  if (!oldData) { localStorage.setItem(MIGRATION_KEY, '1'); return; }

  let oldMeds = [];
  try { oldMeds = JSON.parse(oldData) || []; } catch { oldMeds = []; }
  if (!oldMeds.length) { localStorage.setItem(MIGRATION_KEY, '1'); return; }

  // Show migration notice
  showGlobalMsg('Migrating your existing medicines to the cloud... please wait.', 'info');

  let migrated = 0;
  for (const m of oldMeds) {
    try {
      await dbAddMedicine({
        name:         m.name || 'Unknown',
        generic:      m.generic || '',
        brand:        '',
        category:     m.category || '',
        hsn:          '',
        gst:          12,
        barcode:      '',
        manufacturer: m.supplier || '',
        storage:      m.storage || '',
        minStock:     10,
        notes:        m.notes || '',
        batch:        m.batch || 'LEGACY-001',
        supplierId:   null,
        manufactured: null,
        marketed:     m.marketed || null,
        expiry:       m.expiry || new Date(Date.now() + 365*86400000).toISOString().split('T')[0],
        received:     m.received || new Date().toISOString().split('T')[0],
        qty:          m.qty || 0,
        purchasePrice: 0,
        sellingPrice:  m.price || 0
      });
      migrated++;
    } catch(e) { console.warn('Migration skip:', m.name, e.message); }
  }

  localStorage.setItem(MIGRATION_KEY, '1');
  if (migrated > 0) {
    showGlobalMsg(`Migration complete! ${migrated} medicines moved to cloud database.`, 'success');
  }
}

/* Helper for migration message */
function showGlobalMsg(text, type) {
  let el = document.getElementById('globalMsg');
  if (!el) {
    el = document.createElement('div');
    el.id = 'globalMsg';
    el.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:9999;padding:12px 24px;border-radius:10px;font-size:.9rem;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.2);transition:opacity .3s';
    document.body.appendChild(el);
  }
  const styles = { info:'background:#dbeafe;color:#1d4ed8', success:'background:#dcfce7;color:#15803d', error:'background:#fee2e2;color:#b91c1c' };
  el.style.cssText += ';' + styles[type];
  el.textContent = text;
  el.style.display = 'block';
  if (type !== 'info') setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4000);
}

/* ---- expose ---- */
window.DB = {
  init: initDB,
  pharmacy: () => _pharmacy,
  user: () => _user,
  getMedicines: dbGetMedicines,
  addMedicine: dbAddMedicine,
  updateMedicine: dbUpdateMedicine,
  deleteMedicine: dbDeleteMedicine,
  addBatch: dbAddBatch,
  getSuppliers: dbGetSuppliers,
  addSupplier: dbAddSupplier,
  updateSupplier: dbUpdateSupplier,
  deleteSupplier: dbDeleteSupplier,
  saveInvoice: dbSaveInvoice,
  getInvoices: dbGetInvoices,
  cancelInvoice: dbCancelInvoice,
  getDashboardStats: dbGetDashboardStats,
  getSalesReport: dbGetSalesReport,
  getTopMedicines: dbGetTopMedicines,
  updatePharmacy: dbUpdatePharmacy,
  showMsg: showGlobalMsg
};