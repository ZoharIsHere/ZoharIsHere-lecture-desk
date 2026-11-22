// supa.js — the Supabase client and sign-in helpers.

import { loadScript } from './util.js';
import { SUPABASE_URL, SUPABASE_KEY, SUPABASE_JS } from './config.js';

let clientP = null;

export function client() {
  if (!clientP) {
    clientP = loadScript(SUPABASE_JS).then(() => window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'lecture-desk-auth' },
    })).catch((e) => { clientP = null; throw e; });
  }
  return clientP;
}

export async function currentUser() {
  const sb = await client();
  const { data } = await sb.auth.getSession();
  return data?.session?.user || null;
}

/** Does the app's single account exist yet? */
export async function accountExists() {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify({ action: 'status' }),
  });
  if (!r.ok) throw new Error(`The server did not answer (${r.status}).`);
  return !!(await r.json()).hasUser;
}

export async function createAccount(email, password) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    body: JSON.stringify({ action: 'create', email, password }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || `Could not create the account (${r.status}).`);
  return signIn(email, password);
}

export async function signIn(email, password) {
  const sb = await client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
  return data.user;
}

export async function signOut() {
  const sb = await client();
  await sb.auth.signOut();
}
