// views/auth.js — first run (create the one account) and sign-in.

import { h } from '../util.js';
import { accountExists, createAccount, signIn } from '../supa.js';

/** Resolves with the signed-in user. */
export function showAuth(stage) {
  return new Promise((resolve) => {
    const card = h('form', { class: 'auth-card', novalidate: true });
    const wrap = h('div', { class: 'auth' }, card);
    stage.replaceChildren(wrap);

    let mode = 'checking';
    const err = h('p', { class: 'dlg-error', role: 'alert', hidden: true });
    const email = h('input', { id: 'auth-email', type: 'email', autocomplete: 'username', required: true, spellcheck: 'false' });
    const pass = h('input', { id: 'auth-pass', type: 'password', autocomplete: 'current-password', required: true, minlength: 8 });
    const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Sign in');
    const title = h('h1', { class: 'auth-title' }, 'Lecture Desk');
    const lead = h('p', { class: 'auth-lead' }, 'Checking your account…');

    card.append(
      h('span', { class: 'brand-mark auth-mark', 'aria-hidden': 'true' }, h('span'), h('span')),
      title, lead,
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'auth-email' }, 'Email'), email),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'auth-pass' }, 'Password'), pass),
      err, submit,
      h('p', { class: 'auth-foot' }, h('a', { href: '?local' }, 'Try it without an account'), ' · notes stay in this browser, no AI'));

    const paint = () => {
      const create = mode === 'create';
      lead.textContent = create
        ? 'First run: create your account. It will be the only one this app ever accepts.'
        : 'Sign in to open your notes.';
      submit.textContent = create ? 'Create account' : 'Sign in';
      pass.autocomplete = create ? 'new-password' : 'current-password';
    };

    accountExists().then((exists) => { mode = exists ? 'signin' : 'create'; paint(); })
      .catch(() => { mode = 'signin'; paint(); lead.textContent = 'Sign in to open your notes. (The server is slow to answer; it may be waking up.)'; });

    card.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      const em = email.value.trim(); const pw = pass.value;
      if (!em || pw.length < 8) { err.textContent = 'Enter your email and a password of at least 8 characters.'; err.hidden = false; return; }
      submit.disabled = true;
      try {
        const user = mode === 'create' ? await createAccount(em, pw) : await signIn(em, pw);
        resolve(user);
      } catch (ex) {
        err.textContent = ex.message; err.hidden = false;
        if (/already exists/i.test(ex.message)) { mode = 'signin'; paint(); }
      } finally { submit.disabled = false; }
    });
    requestAnimationFrame(() => email.focus());
  });
}
