// features/settings.js — AI key check, listening language, account.

import { h, ls } from '../util.js';
import { registry } from '../registry.js';
import { store } from '../store.js';
import { ask, aiAvailable } from '../ai.js';
import { signOut } from '../supa.js';
import { GEMINI_KEY_URL, SECRETS_URL } from '../config.js';

export function openSettings() {
  const prev = document.activeElement;
  const status = h('p', { class: 'set-status', role: 'status' }, aiAvailable() ? 'Not checked yet.' : 'AI is off in trial mode (?local).');
  const check = h('button', {
    class: 'btn btn-quiet', type: 'button', disabled: !aiAvailable(),
    onclick: async () => {
      check.disabled = true; status.textContent = 'Checking…'; status.dataset.tone = '';
      try {
        const t = await ask({ prompt: 'Reply with the single word: ready', max_tokens: 256 });
        status.textContent = `Connected. Gemini answered “${String(t).trim().slice(0, 30)}”.`; status.dataset.tone = 'ok';
      } catch (e) { status.textContent = e.message; status.dataset.tone = 'error'; }
      check.disabled = false;
    },
  }, 'Check connection');

  const lang = h('select', { id: 'set-lang', onchange: () => ls.set('speechLang', lang.value) },
    h('option', { value: 'he-IL' }, 'Hebrew (עברית)'), h('option', { value: 'en-US' }, 'English'));
  lang.value = ls.get('speechLang', 'he-IL');

  const form = h('div', { class: 'dlg dlg-wide', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'set-title' },
    h('h2', { class: 'dlg-title', id: 'set-title' }, 'Settings'),

    h('h3', { class: 'set-h' }, 'AI (free Gemini key)'),
    h('p', { class: 'dlg-desc' }, 'Auto notes, catch-ups, break advice and summaries use Google’s free Gemini tier. Nothing is paid. Google may use free-tier text to improve its products.'),
    h('ol', { class: 'set-steps' },
      h('li', null, 'Open ', h('a', { href: GEMINI_KEY_URL, target: '_blank', rel: 'noopener' }, 'Google AI Studio'), ', sign in, and press “Create API key”. Copy it.'),
      h('li', null, 'Open your ', h('a', { href: SECRETS_URL, target: '_blank', rel: 'noopener' }, 'Supabase secrets'), ', add a secret named ', h('code', null, 'GEMINI_API_KEY'), ' with the key as its value, and save.'),
      h('li', null, 'Come back and press Check connection.')),
    h('div', { class: 'set-row' }, check, status),

    h('h3', { class: 'set-h' }, 'Listening'),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'set-lang' }, 'Default language of lessons'), lang,
      h('span', { class: 'field-help' }, 'Switch per lesson with the language button next to Listen. Listening uses Chrome’s built-in recogniser and costs nothing.')),

    h('h3', { class: 'set-h' }, 'Account'),
    h('div', { class: 'set-row' },
      h('span', { class: 'dlg-desc' }, store.mode === 'cloud' ? 'Signed in. Notes sync through your Supabase project.' : 'Trial mode: notes live in this browser only.'),
      store.mode === 'cloud'
        ? h('button', { class: 'btn btn-quiet', type: 'button', onclick: async () => { await signOut(); location.href = location.pathname; } }, 'Sign out')
        : h('a', { class: 'btn btn-quiet', href: location.pathname }, 'Sign in')),

    h('div', { class: 'dlg-actions' }, h('span', { class: 'grow' }), h('button', { class: 'btn btn-primary', type: 'button', onclick: () => close() }, 'Done')));

  const scrim = h('div', { class: 'scrim' }, form);
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
  form.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  document.body.append(scrim);
  requestAnimationFrame(() => form.querySelector('button, a')?.focus());
  function close() { scrim.remove(); prev?.focus?.(); }
}

registry.addCommand({ id: 'settings', label: 'Settings: AI, listening, account', keys: 'settings gemini key api preferences sign out', icon: 'gear', run: openSettings });
