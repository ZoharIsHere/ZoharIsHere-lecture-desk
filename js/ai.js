// ai.js — asks the backend's `ai` function (Gemini free tier).
// The function checks that the caller is the signed-in owner.

import { store } from './store.js';
import { client } from './supa.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const aiAvailable = () => store.mode === 'cloud';

const MESSAGES = {
  missing_key: 'AI is off until you add your free Gemini key (Settings → AI).',
  rate_limited: 'Gemini’s free limit is used up for the moment. Try again in a minute.',
  bad_key_or_request: 'Gemini refused the request. Check the key in Settings → AI.',
  unauthorized: 'Sign in again to use AI.',
};

/**
 * ask({ system, prompt, json, max_tokens, temperature }) → string (or parsed JSON when json: true)
 * Throws an Error whose .code is one of the keys above, 'offline' or 'local'.
 */
export async function ask({ system, prompt, json = false, max_tokens = 2048, temperature = 0.3 }) {
  if (!aiAvailable()) throw Object.assign(new Error('AI needs your account (it’s off in trial mode).'), { code: 'local' });
  if (!navigator.onLine) throw Object.assign(new Error('You’re offline, so AI is paused.'), { code: 'offline' });
  const sb = await client();
  const { data: s } = await sb.auth.getSession();
  const token = s?.session?.access_token;
  const r = await fetch(`${SUPABASE_URL}/functions/v1/ai`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ system, prompt, json, max_tokens, temperature }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(MESSAGES[data.error] || data.message || `AI failed (${r.status}).`), { code: data.error || 'api_error' });
  return json ? parseJson(data.text) : data.text;
}

/** Tolerant JSON: strips code fences and trailing prose. */
export function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const start = t.search(/[[{]/);
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
  throw Object.assign(new Error('The AI answer could not be read.'), { code: 'bad_json' });
}

/** Last N of the student's own notes, as a style sample. */
export function styleSample(blocks, n = 14) {
  return blocks.filter((b) => !b.auto && b.md && b.md.trim() && b.type !== 'image').slice(-n)
    .map((b) => (b.type && b.type !== 'text' ? `[${b.type}] ` : '') + b.md.trim()).join('\n---\n');
}
