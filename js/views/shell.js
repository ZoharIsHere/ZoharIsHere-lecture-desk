// views/shell.js — the frame around every view: the course rail on the
// left (a drawer on phones) and the main stage.

import { h, icon, bus, ls, modKey, fmtDate } from '../util.js';
import { store } from '../store.js';
import { router } from '../router.js';
import { openPalette } from '../palette.js';
import { showShortcuts } from '../ui.js';
import { newCourseDialog } from './parts.js';
import { openSettings } from '../features/settings.js';

let lastSync = { state: 'saved' };
const SYNC_TEXT = {
  saving: 'Saving…',
  saved: 'All changes saved',
  local: 'Saved in this browser only',
  error: 'Not synced · kept on this device',
};

export function mountShell(app) {
  const rail = h('aside', { class: 'rail', 'aria-label': 'Courses and lectures' });
  const stage = h('main', { class: 'stage', id: 'main' });
  const mobile = h('header', { class: 'mobilebar' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Open menu', onclick: () => app.classList.add('rail-open') }, icon('menu', 20)),
    h('button', { class: 'mobile-brand', type: 'button', onclick: () => router.go({ view: 'home' }) }, 'Lecture Desk'),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Search', onclick: () => openPalette() }, icon('search', 20)));
  const scrim = h('div', { class: 'rail-scrim', onclick: () => app.classList.remove('rail-open') });
  app.replaceChildren(rail, scrim, h('div', { class: 'stage-wrap' }, mobile, stage));
  if (ls.get('railCollapsed')) app.classList.add('rail-collapsed');

  let queued = false;
  const render = () => {
    if (queued) return; queued = true;
    requestAnimationFrame(() => { queued = false; renderRail(rail, app); });
  };
  render();
  bus.on('data', render);
  bus.on('route', () => { app.classList.remove('rail-open'); render(); });
  bus.on('sync', (s) => { lastSync = s; paintSync(rail); });
  return stage;
}

export function toggleRail(app = document.getElementById('app')) {
  const v = !app.classList.contains('rail-collapsed');
  app.classList.toggle('rail-collapsed', v);
  ls.set('railCollapsed', v);
}

function renderRail(rail, app) {
  const route = router.current();
  const openCourse = route.view === 'course' ? route.id : route.view === 'lecture' ? store.lecture(route.id)?.courseId : null;

  const head = h('div', { class: 'rail-head' },
    h('button', { class: 'brand', type: 'button', onclick: () => router.go({ view: 'home' }), title: 'Home' },
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, h('span'), h('span')),
      h('span', { class: 'brand-name' }, 'Lecture Desk')),
    h('button', { class: 'icon-btn rail-toggle', type: 'button', title: 'Collapse sidebar', 'aria-label': 'Collapse sidebar', onclick: () => toggleRail(app) }, icon('sidebar', 18)));

  const search = h('button', { class: 'rail-search', type: 'button', onclick: () => openPalette(), title: `Search (${modKey} K)` },
    icon('search', 15), h('span', { class: 'rail-text' }, 'Search notes'), h('kbd', { class: 'rail-text' }, `${modKey} K`));

  const home = h('button', { class: `rail-link${route.view === 'home' ? ' is-current' : ''}`, type: 'button', onclick: () => router.go({ view: 'home' }), title: 'Home' },
    icon('home', 16), h('span', { class: 'rail-text' }, 'Home'));

  const list = h('div', { class: 'rail-courses' }, h('div', { class: 'rail-label rail-text' }, 'Courses'));
  for (const c of store.coursesSorted()) {
    const lecs = store.lecturesOf(c.id);
    const open = c.id === openCourse;
    list.append(h('button', {
      class: `rail-course${route.view === 'course' && route.id === c.id ? ' is-current' : ''}${open ? ' is-open' : ''}`,
      type: 'button', 'data-color': c.color, title: c.name,
      onclick: () => router.go({ view: 'course', id: c.id }),
    },
    h('span', { class: 'swatch-dot', 'aria-hidden': 'true' }),
    h('span', { class: 'rail-code' }, c.code),
    h('span', { class: 'rail-course-name rail-text', dir: 'auto' }, c.name),
    lecs.length ? h('span', { class: 'rail-count rail-text' }, String(lecs.length)) : null));
    if (open && lecs.length) {
      const sub = h('div', { class: 'rail-lectures rail-text', 'data-color': c.color });
      for (const l of lecs.slice().reverse().slice(0, 14)) {
        sub.append(h('button', {
          class: `rail-lec${route.view === 'lecture' && route.id === l.id ? ' is-current' : ''}`, type: 'button',
          onclick: () => router.go({ view: 'lecture', id: l.id }),
        },
        h('span', { class: 'rail-lec-k' }, store.label(l, true)),
        h('span', { class: `rail-lec-t${l.title ? '' : ' is-blank'}`, dir: 'auto' }, l.title || fmtDate(l.date)),
        h('span', { class: `dot dot-${l.status || 'live'}`, title: l.status === 'done' ? 'Reviewed' : l.status === 'review' ? 'To review' : 'In progress' })));
      }
      list.append(sub);
    }
  }
  list.append(h('button', { class: 'rail-add', type: 'button', onclick: () => newCourseDialog(), title: 'Add course' }, icon('plus', 15), h('span', { class: 'rail-text' }, 'Add course')));

  const foot = h('div', { class: 'rail-foot' },
    h('span', { class: 'sync rail-text', role: 'status' }, h('span', { class: 'sync-dot', 'aria-hidden': 'true' }), h('span', { class: 'sync-text' })),
    h('button', { class: 'icon-btn', type: 'button', title: 'Keyboard shortcuts (?)', 'aria-label': 'Keyboard shortcuts', onclick: showShortcuts }, icon('keyboard', 18)),
    h('button', { class: 'icon-btn', type: 'button', title: 'Settings', 'aria-label': 'Settings', onclick: () => openSettings() }, icon('gear', 18)));

  rail.replaceChildren(head, search, home, list, foot);
  paintSync(rail);
}

function paintSync(rail) {
  const el = rail.querySelector('.sync'); if (!el) return;
  el.dataset.state = lastSync.state;
  el.querySelector('.sync-text').textContent = SYNC_TEXT[lastSync.state] || '';
}

export const syncText = (s) => SYNC_TEXT[s] || '';
