/* ================================================================
   supabase-config.js
   ------------------------------------------------------------------
   HOW TO SET UP:
   1. Go to https://supabase.com → your project → Settings → API
   2. Copy "Project URL" and paste it as SUPABASE_URL below
   3. Copy "anon / public" key and paste it as SUPABASE_ANON_KEY below
   4. Save this file and push to GitHub
   ================================================================ */

const SUPABASE_URL      = 'https://nakgzpvzicsmijowcesw.supabase.co';        // e.g. https://abcxyz.supabase.co
const SUPABASE_ANON_KEY = 'sb_publishable_zg6cwjAoWTBZ4BMxnDwXbw_7gaX3HZ1';   // long eyJ... string

/* ----- Initialise the Supabase client using CDN version --------- */
const { createClient } = supabase;
const _supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,        // keeps user logged in across refreshes
    detectSessionInUrl: true     // handles email-verification redirects
  }
});

/* ----- Auth helpers --------------------------------------------- */

/** Returns the currently signed-in user, or null */
async function getCurrentUser() {
  const { data: { user } } = await _supa.auth.getUser();
  return user;
}

/** Signs out and goes to auth.html */
async function signOut() {
  await _supa.auth.signOut();
  window.location.href = 'auth.html';
}

/**
 * Auth guard: call this at the top of every protected page.
 * If the user is not logged in → redirect to auth.html
 * Returns the user object if logged in.
 */
async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    window.location.href = 'auth.html';
    return null;
  }
  return user;
}

/**
 * Gets (or creates) the pharmacy profile for the current user.
 * Every user gets one pharmacy row automatically.
 */
async function getOrCreatePharmacy(user) {
  // Try to find existing pharmacy
  let { data: ph, error } = await _supa
    .from('pharmacies')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (!ph) {
    // First login — create a default pharmacy profile
    const { data: newPh, error: e2 } = await _supa
      .from('pharmacies')
      .insert({ user_id: user.id, name: 'My Pharmacy', email: user.email })
      .select()
      .single();
    ph = newPh;
  }
  return ph;
}

/* ----- Expose globally ------------------------------------------ */
window.SUPA          = _supa;
window.getCurrentUser        = getCurrentUser;
window.signOut               = signOut;
window.requireAuth           = requireAuth;
window.getOrCreatePharmacy   = getOrCreatePharmacy;
