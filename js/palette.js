// palette.js — Ctrl/⌘ K: one box to find a lecture, search every note,
// or run a command. "#tag" searches the glossary tags.

import { h, icon, fmtDate } from './util.js';
import { store } from './store.js';
import { registry } from './registry.js';
import { router } from './router.js';
import { entriesFrom, search, normalize } from './insights.js';
import { keepVisible } from './editor.js';

let state = null;
let notes = null;
let entries = null;
let entriesAt = 0;

export function openPalette(initial = '') {
  if (state) { state.input.value = initial; state.update(); state.input.focus(); return; }
  const prev = document.activeElement;
  const input = h('input', {
    class: 'pal-input', type: 'text', placeholder: 'Search notes, lectures and commands', value: initial,
    'aria-label': 'Search', autocomplete: 'off', spellcheck: 'false', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'pal-list',
  });
  const list = h('div', { class: 'pal-list', id: 'pal-list', role: 'listbox' });
  const foot = h('div', { class: 'pal-foot' },
    h('span', null, h('kbd', null, '↑↓'), ' move'), h('span', null, h('kbd', null, 'Enter'), ' open'),
    h('span', null, h('kbd', null, '#'), ' tags'), h('span', null, h('kbd', null, 'Esc'), ' close'));
  const box = h('div', { class: 'pal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search' },
    h('div', { class: 'pal-top' }, icon('search', 18), input), list, foot);
  const scrim = h('div', { class: 'scrim scrim-top' }, box);
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
  document.body.append(scrim);

  let items = [];
  let active = 0;
  let searching = false;

  function close() {
    scrim.remove(); state = null;
    if (prev && document.contains(prev)) prev.focus?.();
  }

  function run(item) { close(); item.run(); }

  function render() {
    list.replaceChildren();
    if (!items.length) {
      list.append(h('div', { class: 'pal-empty' }, searching ? 'Searching your notes…' : input.value.trim() ? 'Nothing matches. Try fewer or different words.' : 'Type to search.'));
      return;
    }
    let group = null;
    items.forEach((it, i) => {
      if (it.group !== group) { group = it.group; list.append(h('div', { class: 'pal-group' }, group)); }
      const row = h('div', {
        class: `pal-item${i === active ? ' is-active' : ''}`, role: 'option', 'aria-selected': String(i === active),
        'data-color': it.color || null,
        onmousemove: () => { if (active !== i) { active = i; paintActive(); } },
        onclick: () => run(it),
      },
      it.badge ? h('span', { class: 'pal-badge' }, it.badge) : icon(it.icon || 'right', 15),
      h('span', { class: 'pal-main' },
        h('span', { class: 'pal-label', dir: 'auto' }, it.label),
        it.sub ? h('span', { class: 'pal-sub', dir: 'auto' }, it.sub) : null),
      it.hint ? h('span', { class: 'pal-hint' }, it.hint) : null);
      list.append(row);
    });
    paintActive();
  }

  function paintActive() {
    list.querySelectorAll('.pal-item').forEach((el, i) => {
      el.classList.toggle('is-active', i === active);
      el.setAttribute('aria-selected', String(i === active));
    });
    keepVisible(list, list.querySelectorAll('.pal-item')[active]);
  }

  function lectureItem(l, group = 'Lectures') {
    const c = store.course(l.courseId);
    return {
      group, color: c?.color, badge: store.label(l, true),
      label: l.title || (l.kind === 'tutorial' ? 'Tutorial' : 'Lecture') + ' ' + l.number,
      sub: [c?.code, fmtDate(l.date)].filter(Boolean).join(' · '),
      run: () => router.go({ view: 'lecture', id: l.id }),
    };
  }

  function update() {
    const q = input.value.trim();
    const nq = normalize(q);
    const ctx = { route: router.current() };
    const out = [];

    const cmds = registry.commands.filter((c) => !c.when || c.when(ctx));
    if (!q) {
      const recent = [...store.lectures.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 6);
      out.push(...recent.map((l) => lectureItem(l, 'Recent')));
      out.push(...cmds.slice(0, 6).map((c) => ({ group: 'Commands', icon: c.icon || 'right', label: c.label, hint: c.hint, run: () => c.run(ctx) })));
    } else if (q.startsWith('#')) {
      // tag search happens below with the notes
    } else {
      out.push(...cmds.filter((c) => normalize(`${c.label} ${c.keys || ''}`).includes(nq))
        .slice(0, 5).map((c) => ({ group: 'Commands', icon: c.icon || 'right', label: c.label, hint: c.hint, run: () => c.run(ctx) })));
      for (const c of store.coursesSorted()) {
        if (normalize(`${c.name} ${c.code}`).includes(nq)) {
          out.push({ group: 'Courses', color: c.color, badge: c.code, label: c.name, run: () => router.go({ view: 'course', id: c.id }) });
        }
      }
      const lecs = [...store.lectures.values()].filter((l) => {
        const c = store.course(l.courseId);
        return nq.split(' ').every((t) => normalize(`${l.title} ${store.label(l)} ${store.label(l, true)} ${c?.code || ''} ${c?.name || ''} ${l.date} ${fmtDate(l.date)}`).includes(t));
      }).slice(0, 8);
      out.push(...lecs.map((l) => lectureItem(l)));
    }

    if (q && entries) {
      for (const hit of search(entries, q, 25)) {
        const e = hit.entry;
        const l = store.lecture(e.lectureId); const c = l && store.course(l.courseId);
        if (!l) continue;
        const kind = registry.blockType(e.type);
        out.push({
          group: q.startsWith('#') ? `Tagged ${q}` : 'In your notes', color: c?.color,
          badge: kind.tag || store.label(l, true),
          label: hit.snippet || '(snapshot)',
          sub: [c?.code, store.label(l, true), l.title, e.at ? 'slide ' + e.at.p : ''].filter(Boolean).join(' · '),
          run: () => router.go({ view: 'lecture', id: l.id, block: e.blockId }),
        });
      }
    }
    items = out;
    active = 0;
    render();
  }

  async function ensureEntries() {
    if (!notes || Date.now() - entriesAt > 20000) {
      searching = !notes;
      if (searching) render();
      try { notes = await store.notesFor(); entriesAt = Date.now(); } catch (e) { console.warn('[palette]', e); notes = notes || []; }
      searching = false;
    }
    // The lecture on screen may have edits that haven't saved yet: use them.
    const live = router.instance()?.ctx;
    const merged = notes.filter((n) => !live || n.id !== live.lecture().id);
    if (live?.editor) merged.push({ id: live.lecture().id, blocks: live.editor.serialize() });
    entries = entriesFrom(merged);
    if (state) update();
  }

  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); paintActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); paintActive(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) run(items[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });

  state = { input, update };
  update();
  input.focus();
  input.select();
  ensureEntries();
}

/** Notes changed: refresh the search index on next open. */
export function invalidateSearch() { entriesAt = 0; }
