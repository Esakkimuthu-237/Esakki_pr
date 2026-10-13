/* ================================================================
   suppliers.js  –  Supplier management
   ================================================================ */

'use strict';

let _editingSupId = null;

/* ──────────────────────────────────────────────────────────────
   LOAD & RENDER SUPPLIERS
────────────────────────────────────────────────────────────── */
async function loadSuppliers() {
  const tbody = document.getElementById('supplierTbody');
  tbody.innerHTML = '<tr><td colspan="7" class="empty-row"><span class="spinner-sm"></span> Loading…</td></tr>';
  try {
    const sups = await DB.getSuppliers();
    if (!sups.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No suppliers added yet. Click "Add Supplier" above.</td></tr>';
      return;
    }
    tbody.innerHTML = sups.map((s, i) => `
      <tr>
        <td style="color:var(--muted);font-size:.78rem">${i+1}</td>
        <td><strong>${APP.esc(s.name)}</strong></td>
        <td>${APP.esc(s.contact_person || '—')}</td>
        <td>${APP.esc(s.phone || '—')}</td>
        <td><code style="font-size:.78rem">${APP.esc(s.gst_number || '—')}</code></td>
        <td>${APP.esc(s.drug_license || '—')}</td>
        <td>
          <div class="action-btns">
            <button class="btn-edit" onclick="editSupplier('${s.id}')">✏️ Edit</button>
            <button class="btn-icon" onclick="deleteSupplier('${s.id}','${APP.esc(s.name)}')" title="Delete">🗑</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch(err) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-row">Error: ${APP.esc(err.message)}</td></tr>`;
  }
}

/* ──────────────────────────────────────────────────────────────
   MODAL
────────────────────────────────────────────────────────────── */
function openSupplierModal(supId, data) {
  _editingSupId = supId || null;
  document.getElementById('supModalTitle').textContent = supId ? 'Edit Supplier' : 'Add Supplier';
  document.getElementById('supName').value     = data?.name            || '';
  document.getElementById('supContact').value  = data?.contact_person  || '';
  document.getElementById('supPhone').value    = data?.phone           || '';
  document.getElementById('supEmail').value    = data?.email           || '';
  document.getElementById('supGst').value      = data?.gst_number      || '';
  document.getElementById('supLicense').value  = data?.drug_license    || '';
  document.getElementById('supAddress').value  = data?.address         || '';
  document.getElementById('supModalOverlay').classList.add('open');
}

function closeSupModal() {
  document.getElementById('supModalOverlay').classList.remove('open');
  _editingSupId = null;
}

document.getElementById('supModalOverlay').addEventListener('click', e => {
  if (e.target.id === 'supModalOverlay') closeSupModal();
});

/* ──────────────────────────────────────────────────────────────
   SAVE SUPPLIER
────────────────────────────────────────────────────────────── */
async function saveSupplier() {
  const name = document.getElementById('supName').value.trim();
  if (!name) { APP.toast('Supplier name is required.', 'error'); return; }

  const data = {
    name,
    contact_person: document.getElementById('supContact').value.trim(),
    phone:          document.getElementById('supPhone').value.trim(),
    email:          document.getElementById('supEmail').value.trim(),
    gst_number:     document.getElementById('supGst').value.trim(),
    drug_license:   document.getElementById('supLicense').value.trim(),
    address:        document.getElementById('supAddress').value.trim(),
  };

  try {
    if (_editingSupId) {
      await DB.updateSupplier(_editingSupId, data);
      APP.toast('Supplier updated!', 'success');
    } else {
      await DB.addSupplier(data);
      APP.toast('Supplier added!', 'success');
    }
    closeSupModal();
    loadSuppliers();
    await APP.loadSupplierDropdown(); // refresh dropdown in Add Medicine form
  } catch(err) {
    APP.toast('Error: ' + err.message, 'error');
  }
}

/* ──────────────────────────────────────────────────────────────
   EDIT SUPPLIER (load data then open modal)
────────────────────────────────────────────────────────────── */
async function editSupplier(supId) {
  try {
    const sups = await DB.getSuppliers();
    const s    = sups.find(x => x.id === supId);
    if (s) openSupplierModal(s.id, s);
  } catch(err) { APP.toast('Error: ' + err.message, 'error'); }
}

/* ──────────────────────────────────────────────────────────────
   DELETE SUPPLIER
────────────────────────────────────────────────────────────── */
async function deleteSupplier(supId, supName) {
  if (!confirm(`Remove supplier "${supName}"?`)) return;
  try {
    await DB.deleteSupplier(supId);
    APP.toast('Supplier removed.', 'success');
    loadSuppliers();
    await APP.loadSupplierDropdown();
  } catch(err) { APP.toast('Error: ' + err.message, 'error'); }
}

/* ── expose ── */
window.loadSuppliers   = loadSuppliers;
window.openSupplierModal = openSupplierModal;
window.closeSupModal   = closeSupModal;
window.saveSupplier    = saveSupplier;
window.editSupplier    = editSupplier;
window.deleteSupplier  = deleteSupplier;