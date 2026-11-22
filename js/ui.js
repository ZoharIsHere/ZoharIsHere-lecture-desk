// ui.js — shared interface pieces: toasts, dialogs, menus, shortcut sheet.

import { h, icon, bus, modKey } from './util.js';
import { registry } from './registry.js';

// --- Toasts ------------------------------------------------------------------
let toastHost = null;
export function toast(text, { tone = 'info', action = null, ms = 4000 } = {}) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const el = h('div', { class: `toast toast-${tone}` }, h('span', { class: 'toast-text' }, text));
  if (action) {
    el.append(h('button', {
      class: 'toast-act', type: 'button',
      onclick: () => { action.run(); dismiss(); },
    }, action.label));
  }
  toastHost.append(el);
  let gone = false;
  function dismiss() {
    if (gone) return; gone = true;
    el.classList.add('out');
    setTimeout(() => el.remove(), 220);
  }
  setTimeout(dismiss, action ? Math.max(ms, 6000) : ms);
  return dismiss;
}
bus.on('toast', (t) => toast(t.text, t));

// --- Dialogs -----------------------------------------------------------------
/**
 * openDialog({ title, description, fields, submit, danger, secondary })
 * fields: [{ id, label, type: 'text'|'date'|'colors', value, placeholder, help, required, max }]
 * Resolves to the field values (or true when there are no fields), or null on cancel.
 */
export function openDialog({ title, description, fields = [], submit = 'Save', danger = false, secondary = null }) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const form = h('form', { class: 'dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title', novalidate: true });
    form.append(h('h2', { class: 'dlg-title', id: 'dlg-title' }, title));
    if (description) form.append(h('p', { class: 'dlg-desc' }, description));
    const controls = {};
    for (const f of fields) {
      const id = 'dlg-f-' + f.id;
      let control;
      if (f.type === 'colors') {
        control = colorPicker(id, f.value);
      } else {
        control = h('input', {
          id, name: f.id, type: f.type || 'text', value: f.value ?? '', placeholder: f.placeholder || null,
          maxlength: f.max || null, autocomplete: 'off', spellcheck: 'false',
        });
      }
      controls[f.id] = control;
      form.append(h('div', { class: 'field' },
        h('label', { class: 'field-label', for: id }, f.label), control,
        f.help ? h('span', { class: 'field-help' }, f.help) : null));
    }
    const err = h('p', { class: 'dlg-error', role: 'alert', hidden: true });
    form.append(err);
    const actions = h('div', { class: 'dlg-actions' });
    if (secondary) {
      actions.append(h('button', {
        type: 'button', class: `btn btn-quiet${secondary.danger ? ' is-danger' : ''}`,
        onclick: () => { close(null); secondary.run(); },
      }, secondary.label));
    }
    actions.append(
      h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'btn btn-quiet', onclick: () => close(null) }, 'Cancel'),
      h('button', { type: 'submit', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}` }, submit),
    );
    form.append(actions);
    const scrim = h('div', { class: 'scrim' }, form);
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(null); });
    form.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); } });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const vals = {};
      for (const f of fields) {
        const c = controls[f.id];
        vals[f.id] = (c.dataset.value ?? c.value ?? '').trim();
        if (f.required && !vals[f.id]) { err.textContent = `${f.label} is required.`; err.hidden = false; c.focus?.(); return; }
      }
      close(fields.length ? vals : true);
    });
    document.body.append(scrim);
    requestAnimationFrame(() => (form.querySelector('input') || form.querySelector('button[type=submit]'))?.focus());
    function close(v) { scrim.remove(); prev?.focus?.(); resolve(v); }
  });
}

export const confirmDialog = ({ title, description, confirm = 'Confirm', danger = true }) =>
  openDialog({ title, description, submit: confirm, danger });

function colorPicker(id, value) {
  const wrap = h('div', { class: 'swatches', id, role: 'radiogroup' });
  wrap.dataset.value = value || registry.courseColors[0].id;
  for (const c of registry.courseColors) {
    const b = h('button', {
      type: 'button', class: 'swatch', role: 'radio', 'data-color': c.id, title: c.label,
      'aria-label': c.label, 'aria-checked': String(c.id === wrap.dataset.value),
      onclick: () => {
        wrap.dataset.value = c.id;
        wrap.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-checked', String(s === b)));
      },
    });
    wrap.append(b);
  }
  return wrap;
}

// --- Menus -------------------------------------------------------------------
let openMenu = null;
/** items: [{ label, icon?, hint?, run, danger?, checked?, disabled? } | '-' | { heading }] */
export function showMenu(anchor, items, { placement = 'below' } = {}) {
  closeMenu();
  const menu = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (it === '-') { menu.append(h('div', { class: 'menu-sep', role: 'separator' })); continue; }
    if (it.heading) { menu.append(h('div', { class: 'menu-head' }, it.heading)); continue; }
    menu.append(h('button', {
      type: 'button', role: 'menuitem',
      class: `menu-item${it.danger ? ' is-danger' : ''}${it.checked ? ' is-checked' : ''}`,
      disabled: !!it.disabled,
      onclick: (e) => { e.stopPropagation(); closeMenu(); it.run?.(); },
    },
    it.icon ? icon(it.icon, 15) : h('span', { class: 'ico ico-blank' }),
    h('span', { class: 'menu-label' }, it.label),
    it.checked ? icon('check', 14) : (it.hint ? h('span', { class: 'menu-hint' }, it.hint) : null)));
  }
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth; const mh = menu.offsetHeight;
  let left = Math.min(r.left, window.innerWidth - mw - 8);
  let top = placement === 'above' ? r.top - mh - 6 : r.bottom + 6;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  if (top < 8) top = 8;
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top = top + 'px';

  const btns = () => [...menu.querySelectorAll('.menu-item:not([disabled])')];
  menu.addEventListener('keydown', (e) => {
    const list = btns(); const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); anchor.focus?.(); }
  });
  const onDoc = (e) => { if (!menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeMenu(); };
  setTimeout(() => document.addEventListener('pointerdown', onDoc, true), 0);
  openMenu = { menu, off: () => document.removeEventListener('pointerdown', onDoc, true) };
  btns()[0]?.focus({ preventScroll: true });
  return menu;
}
export function closeMenu() {
  if (!openMenu) return;
  openMenu.off(); openMenu.menu.remove(); openMenu = null;
}
export const isMenuOpen = () => !!openMenu;

// --- Keyboard shortcuts --------------------------------------------------------
export const SHORTCUTS = [
  { group: 'Anywhere', items: [
    [`${modKey} K`, 'Search notes, lectures and commands'],
    ['?', 'Show this list'],
  ] },
  { group: 'In a lecture', items: [
    ['← →', 'Previous / next slide'],
    ['N', 'Write a new note'],
    ['G', 'Slide overview'],
    ['S', 'Snapshot part of the slide'],
    ['F', 'Focus mode'],
    [`${modKey} \\`, 'Show or hide the slides'],
  ] },
  { group: 'In class', items: [
    ['L', 'Listen to the lesson (live transcript)'],
    ['A', 'Auto notes on or off'],
    ['B', 'Break: bathroom (keeps listening) or a silent phone timer'],
    ['Q', 'Questions to ask'],
    ['W', 'Summaries: saved words and principles'],
    ['?? at the start', 'Turns the line into a question to ask'],
  ] },
  { group: 'While writing', items: [
    ['Alt ↑  Alt ↓', 'Previous / next slide without leaving the note'],
    ['Enter', 'New block (anchored to the current slide)'],
    ['Shift Enter', 'Line break inside a block'],
    [`${modKey} Enter`, 'Finish the block (leaves a code block) and start a new one'],
    ['/', 'Insert: definition, theorem, code, math, diagram…'],
    [`${modKey} B · I · E · M`, 'Bold · italic · code · math'],
    ['Tab', 'Indent (lists and code)'],
    ['Alt Shift ↑ ↓', 'Move the block'],
    ['#word', 'Tag a term for the course glossary'],
    ['Esc', 'Stop editing'],
  ] },
];

export function showShortcuts() {
  const body = h('div', { class: 'keys' });
  for (const g of SHORTCUTS) {
    body.append(h('h3', { class: 'keys-group' }, g.group));
    const dl = h('dl', { class: 'keys-list' });
    for (const [k, d] of g.items) dl.append(h('dt', null, h('kbd', null, k)), h('dd', null, d));
    body.append(dl);
  }
  const panel = h('div', { class: 'dlg dlg-wide', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Keyboard shortcuts', tabindex: '-1' },
    h('div', { class: 'dlg-head' },
      h('h2', { class: 'dlg-title' }, 'Keyboard shortcuts'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('x'))),
    body);
  const scrim = h('div', { class: 'scrim' }, panel);
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); close(); } });
  document.body.append(scrim);
  panel.focus();
  function close() { scrim.remove(); }
}
