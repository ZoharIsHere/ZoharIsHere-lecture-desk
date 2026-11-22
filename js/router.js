// router.js — which view is on screen. Views register a mount function:
//   router.register('lecture', (outlet, route) => ({ unmount(), ...extras }))
// Routes: { view:'home' } | { view:'course', id } | { view:'lecture', id, block? }
// Each route also gets a plain #token (#c-<id>, #l-<id>) for direct links.

import { bus } from './util.js';

const views = new Map();
let outlet = null;
let cur = null;

const toToken = (r) => (r.view === 'course' ? 'c-' + r.id : r.view === 'lecture' ? 'l-' + r.id : '');
export function parseHash(hash) {
  const t = String(hash || '').replace(/^#/, '');
  if (t.startsWith('c-')) return { view: 'course', id: t.slice(2) };
  if (t.startsWith('l-')) return { view: 'lecture', id: t.slice(2) };
  return { view: 'home' };
}

export const router = {
  register(name, mount) { views.set(name, mount); },

  start(el) {
    outlet = el;
    window.addEventListener('popstate', (e) => this.go(e.state?.view ? e.state : parseHash(location.hash), { history: 'none' }));
    this.go(parseHash(location.hash), { history: 'replace' });
  },

  go(route, { history: mode = 'push' } = {}) {
    // Same lecture, different block: let the open view handle it.
    if (cur && route.view === 'lecture' && cur.route.view === 'lecture' && cur.route.id === route.id && route.block) {
      cur.focusBlock?.(route.block);
      return;
    }
    if (cur?.unmount) { try { cur.unmount(); } catch (e) { console.error('[router] unmount', e); } }
    outlet.replaceChildren();
    outlet.scrollTop = 0;
    const mount = views.get(route.view) || views.get('home');
    let inst = {};
    try { inst = mount(outlet, route) || {}; } catch (e) {
      console.error('[router] mount', e);
      outlet.textContent = 'Something went wrong while opening this page. Reload to try again.';
    }
    cur = { ...inst, route };
    const token = toToken(route);
    try {
      const state = { view: route.view, id: route.id };
      const url = token ? '#' + token : location.pathname + location.search;
      if (mode === 'replace') history.replaceState(state, '', url);
      else if (mode === 'push') history.pushState(state, '', url);
    } catch { /* history unavailable in some frames */ }
    bus.emit('route', route);
  },

  current() { return cur?.route || { view: 'home' }; },
  instance() { return cur; },
};
