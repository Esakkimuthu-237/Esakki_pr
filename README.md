# 💊 PharmaCare – Pharmacy Management System

A complete, cloud-backed pharmacy management web app built with  
**HTML + CSS + JavaScript + Supabase (PostgreSQL)**.  
Hosted on **GitHub Pages** — no server required!

---

## ✨ Features

| Module | What it does |
|--------|-------------|
| 🔐 Auth | Sign up / login / email verification / password reset |
| 🏠 Dashboard | 8 live stats from real DB — sales, stock, alerts |
| 💊 Inventory | Add, view, edit, delete medicines + batch tracking |
| 🧾 Billing | Search medicines → cart → GST → invoice → print |
| 📋 Invoices | View history, reprint receipts, cancel invoices |
| 🚚 Suppliers | Add/edit suppliers linked to medicine batches |
| 📊 Reports | Sales summary, top medicines, stock valuation |
| 🔔 Alerts | Expired + expiring-soon + low-stock notifications |
| ⚙️ Settings | Pharmacy profile (name, address, GSTIN, license) |

---

## 🚀 Setup Instructions (Step by Step)

### STEP 1 — Create Supabase Account

1. Go to **https://supabase.com** → Sign Up (free)
2. Click **New Project**
3. Give it a name: `pharmacare`
4. Set a strong database password (save it!)
5. Choose region: **Southeast Asia (Singapore)** — best speed in India
6. Wait ~2 minutes for project to be ready

---

### STEP 2 — Run the Database Schema

1. In your Supabase project, click **SQL Editor** in the left sidebar
2. Click **New query**
3. Open the file `schema.sql` from this project
4. Copy everything and paste into Supabase SQL editor
5. Click **Run** (green button)
6. You should see "Success. No rows returned" — that means all tables were created

---

### STEP 3 — Get Your API Keys

1. In Supabase, go to **Settings → API**
2. Copy **Project URL** (like `https://abcxyz.supabase.co`)
3. Copy **anon / public** key (long `eyJ...` string)

---

### STEP 4 — Add Keys to the Project

Open `supabase-config.js` in your code editor and replace:

```js
const SUPABASE_URL      = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

With your actual values:

```js
const SUPABASE_URL      = 'https://abcxyz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGci...your_actual_key...';
```

> ✅ The **anon key** is safe to put here. It only works with Row Level Security.  
> ❌ NEVER put your **service_role key** in frontend code.

---

### STEP 5 — Enable Email Auth in Supabase

1. Go to **Authentication → Providers**
2. Make sure **Email** is enabled (it is by default)
3. Go to **Authentication → Settings**
4. Set **Site URL** to: `https://YOUR-GITHUB-USERNAME.github.io/Esakki_pr`
5. Under **Redirect URLs**, add: `https://YOUR-GITHUB-USERNAME.github.io/Esakki_pr/auth.html`

---

### STEP 6 — Push to GitHub Pages

```bash
git add .
git commit -m "Upgrade: Add Supabase cloud database, billing, invoices, reports"
git push origin main
```

Then:
1. Go to your GitHub repo → **Settings → Pages**
2. Set source to: **Deploy from branch → main → / (root)**
3. Click Save
4. Visit: `https://YOUR-USERNAME.github.io/Esakki_pr/auth.html`

---

## 📁 File Structure

```
Esakki_pr/
├── index.html          ← Main app (all pages)
├── auth.html           ← Login / Sign-up page
├── style.css           ← Complete styling
├── supabase-config.js  ← ⚙️ PUT YOUR KEYS HERE
├── db.js               ← All database operations
├── app.js              ← Main UI controller
├── billing.js          ← Billing & invoices
├── suppliers.js        ← Supplier management
├── reports.js          ← Reports & analytics
├── schema.sql          ← Run once in Supabase SQL Editor
└── README.md           ← This file
```

---

## 🔄 Migration from Old localStorage Data

When you log in for the **first time**, the app automatically detects any old medicines saved in localStorage (from your original project) and migrates them to the Supabase database. You will see a green message:

> *"Migration complete! X medicines moved to cloud database."*

This happens only once. After that, all data is stored permanently in the cloud.

---

## 🔒 Security Features

- **Row Level Security (RLS)**: Every table has policies that ensure users can ONLY see and modify their own pharmacy's data
- **Auth guard**: All pages redirect to `auth.html` if not logged in
- **Stock validation**: Server-side function prevents selling more stock than available
- **No service-role key in frontend**: Only the safe `anon` key is used
- **Email verification**: Users must verify email before logging in

---

## 💡 How GST Works in This System

Each medicine has a **GST %** field (0%, 5%, 12%, 18%, or 28%).  
During billing, the system calculates:
- `Line Total = (Qty × Price) × (1 - Discount%) × (1 + GST%)`
- Per-item GST is shown separately for proper tax records
- Invoice shows Subtotal, Discount, GST, and Grand Total separately

---

## 🖨️ Printing Invoices

Click **"Save & Print Bill"** after creating a bill.  
The browser print dialog opens automatically.  
- Choose **"Save as PDF"** to get a PDF copy
- The invoice is formatted for both A4 and receipt printers

---

## 🐛 Troubleshooting

| Problem | Solution |
|---------|---------|
| Data not saving | Check Supabase URL and anon key in `supabase-config.js` |
| Login not working | Run the schema.sql again; check Supabase email auth is enabled |
| "Infinite redirect loop" | Your session expired — clear browser cache and log in again |
| "Insufficient stock" error | The batch has less stock than you are trying to sell |
| Email verification not arriving | Check spam folder; verify your email server in Supabase settings |
| CORS error | Make sure your GitHub Pages URL is added to Supabase allowed origins |

---

## 🎓 For College Demonstration

### Key talking points:
1. **Why Supabase?** — Free PostgreSQL cloud database, built-in auth, Row Level Security
2. **Why not localStorage?** — localStorage is per-browser, per-device; data is lost on different devices
3. **Security** — RLS ensures pharmacy A can never see pharmacy B's data
4. **GST calculation** — Proper Indian GST slab system per medicine
5. **Batch tracking** — Each purchase of a medicine has its own batch, expiry, and stock

### Demo flow:
1. Open `auth.html` → Sign up → Verify email → Login
2. Go to **Add Medicine** → Add 3-4 sample medicines
3. Open **Billing** → Search medicine → Add to cart → Save bill
4. Open **Invoices** → Show the generated invoice → Click reprint
5. Open **Reports** → Show sales summary and top medicines
6. Open **Alerts** → Show expired/expiring medicines
7. **Open on phone** → Show responsive design

---

## 📞 Tech Stack

| Technology | Purpose |
|-----------|---------|
| HTML5 + CSS3 | Frontend structure and styling |
| JavaScript (ES6+) | App logic (no frameworks) |
| Supabase | PostgreSQL database + Auth + RLS |
| GitHub Pages | Free static hosting |
| Supabase JS SDK v2 | Browser database client |
| Inter font (Google Fonts) | Typography |

---

*Built as a student project. For learning purposes only.*