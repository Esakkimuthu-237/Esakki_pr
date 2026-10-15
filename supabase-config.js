/* ================================================================
   supabase-config.js
   ------------------------------------------------------------------
   HOW TO SET UP:
   1. Go to https://supabase.com → your project → Settings → API
   2. Copy "Project URL" and paste as SUPABASE_URL below
   3. Copy "anon / public" key and paste as SUPABASE_ANON_KEY below
   4. In Supabase: Authentication → URL Config → set Site URL:
      https://esakkimuthu-237.github.io/Esakki_pr
   5. Add Redirect URL: https://esakkimuthu-237.github.io/Esakki_pr/auth.html
   ================================================================ */

const SUPABASE_URL      = 'https://nakgzpvzicsmijowcesw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_zg6cwjAoWTBZ4BMxnDwXbw_7gaX3HZ1';

/* Production redirect base — update if your repo name changes */
const SITE_BASE = 'https://esakkimuthu-237.github.io/Esakki_pr';

/* ----- Initialise Supabase client -------------------------------- */
const { createClient } = supabase;
const _supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken:  true,
    persistSession:    true,   // keeps user logged in across refreshes
    detectSessionInUrl: true   // handles email-verification & OAuth redirects
  }
});

/* ----- Auth helpers --------------------------------------------- */

/** Returns the currently signed-in user from local cache first (fast),
 *  then verifies with the server. Returns null if not logged in. */
async function getCurrentUser() {
  // getSession() is synchronous from local storage — no network needed
  const { data: { session } } = await _supa.auth.getSession();
  if (!session) return null;
  // Then verify the token is still valid server-side
  const { data: { user } } = await _supa.auth.getUser();
  return user || null;
}

/** Signs out and redirects to auth.html */
async function signOut() {
  await _supa.auth.signOut();
  window.location.href = 'auth.html';
}

/**
 * Auth guard — call at the top of every protected page.
 * Uses cached session first for speed; falls back to server check.
 * Redirects to auth.html if not logged in.
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
 * - For email-signup users: uses the pharmacy_name saved in user metadata.
 * - For OAuth (Google/Facebook) users: returns a profile with
 *   needs_setup=true so the app can prompt for the pharmacy name.
 * - Never overwrites an existing pharmacy name.
 */
async function getOrCreatePharmacy(user) {
  // Try to find existing pharmacy
  let { data: ph } = await _supa
    .from('pharmacies')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (ph) return ph; // Already has a pharmacy profile

  // Determine pharmacy name:
  // 1. From metadata set during email sign-up
  // 2. Never use OAuth provider's display name as pharmacy name
  const metaName = user.user_metadata?.pharmacy_name;
  const isOAuthUser = user.app_metadata?.provider && user.app_metadata.provider !== 'email';

  const pharmacyName = (metaName && metaName !== 'My Pharmacy')
    ? metaName
    : isOAuthUser
      ? null          // OAuth user — needs setup prompt, don't set yet
      : 'My Pharmacy';

  // Create pharmacy profile
  const { data: newPh, error } = await _supa
    .from('pharmacies')
    .insert({
      user_id: user.id,
      name:    pharmacyName || 'My Pharmacy',
      email:   user.email || null
    })
    .select()
    .single();

  if (error) throw error;

  // Mark as needing setup if OAuth user without pharmacy name
  if (isOAuthUser && !metaName) {
    newPh._needs_setup = true;
  }

  return newPh;
}

/* ----- Expose globally ------------------------------------------ */
window.SUPA                = _supa;
window.SITE_BASE           = SITE_BASE;
window.getCurrentUser      = getCurrentUser;
window.signOut             = signOut;
window.requireAuth         = requireAuth;
window.getOrCreatePharmacy = getOrCreatePharmacy;