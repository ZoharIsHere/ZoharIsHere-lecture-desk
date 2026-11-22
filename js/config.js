// config.js — where the app's backend lives.
// The publishable key is public by design: row-level security in the database
// keeps every row readable and writable by the signed-in owner only.

export const SUPABASE_URL = 'https://ljmbtpsnfwwtmbjlaqth.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_jKtBd9fWflDX64Zjzt1KJA_ViE2jCjh';

export const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
export const BUCKET = 'files';

// Where to get a free Gemini key, and where it goes in Supabase.
export const GEMINI_KEY_URL = 'https://aistudio.google.com/app/apikey';
export const SECRETS_URL = 'https://supabase.com/dashboard/project/ljmbtpsnfwwtmbjlaqth/functions/secrets';
