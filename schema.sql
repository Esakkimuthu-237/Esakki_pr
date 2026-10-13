-- ============================================================
--  PharmaCare – Supabase PostgreSQL Schema
--  SAFE TO RE-RUN: uses IF NOT EXISTS, DROP POLICY IF EXISTS,
--  and CREATE OR REPLACE throughout. Will NOT drop tables or
--  delete any existing medicine / invoice data.
-- ============================================================

-- 1. Enable UUID support (IF NOT EXISTS = idempotent)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLE: pharmacies
-- Each user account has exactly one pharmacy profile.
-- ============================================================
CREATE TABLE IF NOT EXISTS pharmacies (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  name            TEXT NOT NULL DEFAULT 'My Pharmacy',
  address         TEXT,
  phone           TEXT,
  email           TEXT,
  gst_number      TEXT,
  license_number  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: suppliers
-- Medicine suppliers / distributors
-- ============================================================
CREATE TABLE IF NOT EXISTS suppliers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id     UUID NOT NULL,
  name            TEXT NOT NULL,
  contact_person  TEXT,
  phone           TEXT,
  email           TEXT,
  address         TEXT,
  gst_number      TEXT,
  drug_license    TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: medicines
-- Master product catalogue (one row per medicine type)
-- ============================================================
CREATE TABLE IF NOT EXISTS medicines (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id      UUID NOT NULL,
  name             TEXT NOT NULL,
  generic_name     TEXT,
  brand            TEXT,
  category         TEXT,
  hsn_code         TEXT,
  gst_percent      NUMERIC(5,2) DEFAULT 12,
  barcode          TEXT,
  manufacturer     TEXT,
  storage_condition TEXT,
  min_stock_level  INTEGER DEFAULT 10,
  notes            TEXT,
  is_active        BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: medicine_batches
-- Each purchase of a medicine has its own batch row.
-- Different batches can have different expiry dates and prices.
-- ============================================================
CREATE TABLE IF NOT EXISTS medicine_batches (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  medicine_id      UUID NOT NULL REFERENCES medicines(id) ON DELETE CASCADE,
  pharmacy_id      UUID NOT NULL,
  supplier_id      UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  batch_number     TEXT NOT NULL,
  manufactured_date DATE,
  marketed_date    DATE,
  expiry_date      DATE NOT NULL,
  received_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  quantity         INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  purchase_price   NUMERIC(10,2) NOT NULL DEFAULT 0,
  selling_price    NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active        BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- TABLE: invoices
-- One row per billing transaction (bill header)
-- ============================================================
CREATE TABLE IF NOT EXISTS invoices (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id      UUID NOT NULL,
  invoice_number   TEXT NOT NULL,
  customer_name    TEXT,
  customer_phone   TEXT,
  subtotal         NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_discount   NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_gst        NUMERIC(10,2) NOT NULL DEFAULT 0,
  grand_total      NUMERIC(10,2) NOT NULL DEFAULT 0,
  amount_paid      NUMERIC(10,2) NOT NULL DEFAULT 0,
  payment_method   TEXT DEFAULT 'cash',
  status           TEXT DEFAULT 'paid',
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pharmacy_id, invoice_number)
);

-- ============================================================
-- TABLE: invoice_items
-- One row per medicine line inside a bill
-- ============================================================
CREATE TABLE IF NOT EXISTS invoice_items (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id       UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  batch_id         UUID NOT NULL REFERENCES medicine_batches(id),
  medicine_id      UUID NOT NULL REFERENCES medicines(id),
  medicine_name    TEXT NOT NULL,
  batch_number     TEXT NOT NULL,
  quantity         INTEGER NOT NULL,
  unit_price       NUMERIC(10,2) NOT NULL,
  discount_percent NUMERIC(5,2) DEFAULT 0,
  gst_percent      NUMERIC(5,2) DEFAULT 0,
  gst_amount       NUMERIC(10,2) NOT NULL DEFAULT 0,
  line_total       NUMERIC(10,2) NOT NULL
);

-- ============================================================
-- TABLE: purchase_orders  (Goods Received Notes / GRN)
-- Records inward stock received from suppliers
-- ============================================================
CREATE TABLE IF NOT EXISTS purchase_orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id     UUID NOT NULL,
  supplier_id     UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  po_number       TEXT NOT NULL,
  invoice_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  total_amount    NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- FOREIGN KEY CONSTRAINTS
-- Wrapped in a DO block with IF NOT EXISTS checks so this
-- file can be re-run without "constraint already exists" errors.
-- These link pharmacy_id columns back to the pharmacies table.
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_suppliers_pharmacy' AND table_name = 'suppliers'
  ) THEN
    ALTER TABLE suppliers
      ADD CONSTRAINT fk_suppliers_pharmacy
      FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_medicines_pharmacy' AND table_name = 'medicines'
  ) THEN
    ALTER TABLE medicines
      ADD CONSTRAINT fk_medicines_pharmacy
      FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_batches_pharmacy' AND table_name = 'medicine_batches'
  ) THEN
    ALTER TABLE medicine_batches
      ADD CONSTRAINT fk_batches_pharmacy
      FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_invoices_pharmacy' AND table_name = 'invoices'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT fk_invoices_pharmacy
      FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_po_pharmacy' AND table_name = 'purchase_orders'
  ) THEN
    ALTER TABLE purchase_orders
      ADD CONSTRAINT fk_po_pharmacy
      FOREIGN KEY (pharmacy_id) REFERENCES pharmacies(id) ON DELETE CASCADE;
  END IF;
END;
$$;

-- ============================================================
-- INDEXES  (speeds up common searches)
-- CREATE INDEX IF NOT EXISTS is idempotent — safe to re-run.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_medicines_pharmacy    ON medicines(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_batches_medicine      ON medicine_batches(medicine_id);
CREATE INDEX IF NOT EXISTS idx_batches_pharmacy      ON medicine_batches(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiry        ON medicine_batches(expiry_date);
CREATE INDEX IF NOT EXISTS idx_invoices_pharmacy     ON invoices(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_invoices_created      ON invoices(created_at);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_pharmacy    ON suppliers(pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_po_pharmacy           ON purchase_orders(pharmacy_id);

-- ============================================================
-- ROW LEVEL SECURITY  (RLS)
-- ALTER TABLE ... ENABLE ROW LEVEL SECURITY is idempotent in
-- PostgreSQL — safe to run even when already enabled.
-- Users can ONLY see data belonging to their own pharmacy.
-- ============================================================
ALTER TABLE pharmacies        ENABLE ROW LEVEL SECURITY;
ALTER TABLE medicines         ENABLE ROW LEVEL SECURITY;
ALTER TABLE medicine_batches  ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices          ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders   ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- HELPER FUNCTION: get_my_pharmacy_id()
-- Returns the pharmacy id for the currently logged-in user.
-- CREATE OR REPLACE is idempotent — safe to re-run.
-- SECURITY DEFINER = runs as the DB owner so it can query
-- the pharmacies table even when RLS is active.
-- ============================================================
CREATE OR REPLACE FUNCTION get_my_pharmacy_id()
RETURNS UUID LANGUAGE SQL SECURITY DEFINER AS $$
  SELECT id FROM pharmacies WHERE user_id = auth.uid() LIMIT 1;
$$;

-- ============================================================
-- RLS POLICIES
-- ROOT CAUSE OF THE ORIGINAL ERROR:
--   CREATE POLICY fails with "policy already exists" if a
--   policy with the same name is already on the table.
--
-- FIX APPLIED:
--   Every policy is preceded by DROP POLICY IF EXISTS.
--   This drops the old policy (if it exists) and recreates
--   it with identical security conditions.
--   No weakening of any access rule — conditions are unchanged.
-- ============================================================

-- pharmacies: user can only read/write their own pharmacy row
DROP POLICY IF EXISTS "own_pharmacy" ON pharmacies;
CREATE POLICY "own_pharmacy" ON pharmacies
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- medicines: user can only see/modify medicines in their pharmacy
DROP POLICY IF EXISTS "own_medicines" ON medicines;
CREATE POLICY "own_medicines" ON medicines
  USING (pharmacy_id = get_my_pharmacy_id())
  WITH CHECK (pharmacy_id = get_my_pharmacy_id());

-- medicine_batches: scoped to the current user's pharmacy
DROP POLICY IF EXISTS "own_batches" ON medicine_batches;
CREATE POLICY "own_batches" ON medicine_batches
  USING (pharmacy_id = get_my_pharmacy_id())
  WITH CHECK (pharmacy_id = get_my_pharmacy_id());

-- suppliers: scoped to the current user's pharmacy
DROP POLICY IF EXISTS "own_suppliers" ON suppliers;
CREATE POLICY "own_suppliers" ON suppliers
  USING (pharmacy_id = get_my_pharmacy_id())
  WITH CHECK (pharmacy_id = get_my_pharmacy_id());

-- invoices: scoped to the current user's pharmacy
DROP POLICY IF EXISTS "own_invoices" ON invoices;
CREATE POLICY "own_invoices" ON invoices
  USING (pharmacy_id = get_my_pharmacy_id())
  WITH CHECK (pharmacy_id = get_my_pharmacy_id());

-- invoice_items: accessible only when the parent invoice belongs to
-- the current user's pharmacy (enforced via a sub-select).
-- No WITH CHECK clause needed — items are always inserted via an invoice.
DROP POLICY IF EXISTS "own_invoice_items" ON invoice_items;
CREATE POLICY "own_invoice_items" ON invoice_items
  USING (
    invoice_id IN (
      SELECT id FROM invoices WHERE pharmacy_id = get_my_pharmacy_id()
    )
  );

-- purchase_orders: scoped to the current user's pharmacy
DROP POLICY IF EXISTS "own_po" ON purchase_orders;
CREATE POLICY "own_po" ON purchase_orders
  USING (pharmacy_id = get_my_pharmacy_id())
  WITH CHECK (pharmacy_id = get_my_pharmacy_id());

-- ============================================================
-- FUNCTION: generate_invoice_number
-- Produces a unique invoice ID like INV-20261013-0001.
-- CREATE OR REPLACE is idempotent — safe to re-run.
-- SECURITY DEFINER allows counting all invoices for the
-- given pharmacy_id without being blocked by RLS.
-- ============================================================
CREATE OR REPLACE FUNCTION generate_invoice_number(p_pharmacy_id UUID)
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  today_str   TEXT := TO_CHAR(NOW(), 'YYYYMMDD');
  count_today INTEGER;
BEGIN
  SELECT COUNT(*) INTO count_today
  FROM invoices
  WHERE pharmacy_id = p_pharmacy_id
    AND DATE(created_at AT TIME ZONE 'Asia/Kolkata') = CURRENT_DATE;
  RETURN 'INV-' || today_str || '-' || LPAD((count_today + 1)::TEXT, 4, '0');
END;
$$;

-- ============================================================
-- FUNCTION: deduct_batch_stock
-- Called when a bill is saved. Reduces batch quantity by p_qty.
-- Raises an exception if stock < p_qty, which causes the
-- entire invoice-save transaction to roll back — preventing
-- overselling even when two bills are saved simultaneously.
-- ============================================================
CREATE OR REPLACE FUNCTION deduct_batch_stock(p_batch_id UUID, p_qty INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE medicine_batches
  SET quantity = quantity - p_qty
  WHERE id = p_batch_id AND quantity >= p_qty;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient stock for batch %', p_batch_id;
  END IF;
END;
$$;

-- ============================================================
-- FUNCTION: restore_batch_stock
-- Called when an invoice is cancelled or returned.
-- Adds the sold quantity back to the batch so stock is correct.
-- ============================================================
CREATE OR REPLACE FUNCTION restore_batch_stock(p_batch_id UUID, p_qty INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE medicine_batches
  SET quantity = quantity + p_qty
  WHERE id = p_batch_id;
END;
$$;

-- ============================================================
-- ALL DONE.
-- Tables, FK constraints, indexes, RLS, and functions are
-- all created or safely updated. No data was modified.
-- ============================================================