// features/drawer.js — a side panel over the notes, shared by the in-class features.

import { h, icon } from '../util.js';

let current = null;

/** Opens a panel on the right of the lecture. Returns { el, body, close, setTitle }. */
export function openDrawer(page, { id, title, onClose }) {
  if (current?.id === id) { current.close(); return null; }
  current?.close();
  const body = h('div', { class: 'drawer-body' });
  const titleEl = h('h2', { class: 'drawer-title' }, title);
  const el = h('aside', { class: 'drawer', 'aria-label': title },
    h('header', { class: 'drawer-head' }, titleEl,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', title: 'Close (Esc)', onclick: () => api.close() }, icon('x', 16))),
    body);
  // Esc closes the panel, unless you're writing (then Esc just stops editing).
  const onKey = (e) => {
    if (e.key !== 'Escape' || document.querySelector('.scrim, .menu')) return;
    const t = e.target;
    if (!el.contains(t) && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return;
    e.stopPropagation(); api.close();
  };
  document.addEventListener('keydown', onKey, true);
  (page.querySelector('.lec-body') || page).append(el);
  const api = {
    id, el, body,
    setTitle: (t) => { titleEl.textContent = t; },
    close() {
      if (current !== api) return;
      document.removeEventListener('keydown', onKey, true);
      el.remove(); current = null; onClose?.();
    },
  };
  current = api;
  return api;
}

export const closeDrawer = () => current?.close();
export const drawerOpen = (id) => current?.id === id;
