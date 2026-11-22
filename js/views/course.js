// views/course.js — one course: every lecture and tutorial, the open
// questions collected from all of them, and the glossary built from #tags.

import { h, icon, bus, ls } from '../util.js';
import { store } from '../store.js';
import { router } from '../router.js';
import { loadEntries, openQuestions, glossary } from '../insights.js';
import { openPalette } from '../palette.js';
import { lectureRow, newLecture, editCourseDialog, emptyState } from './parts.js';

const FILTERS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'lecture', label: 'Lectures', test: (l) => l.kind !== 'tutorial' },
  { id: 'tutorial', label: 'Tutorials', test: (l) => l.kind === 'tutorial' },
  { id: 'review', label: 'To review', test: (l) => l.status === 'review' },
  { id: 'catchup', label: 'Catch-up', test: (l) => l.catchUp },
];

export function mountCourse(root, route) {
  const page = h('div', { class: 'page page-course' });
  root.append(page);
  let filter = ls.get('filter:' + route.id, 'all');
  let entries = null;
  let alive = true;

  const side = h('aside', { class: 'course-side' });
  const main = h('div', { class: 'course-main' });

  function render() {
    const c = store.course(route.id);
    if (!c) {
      page.replaceChildren(emptyState({
        title: store.ready ? 'This course no longer exists' : 'Opening…',
        actions: store.ready ? [h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => router.go({ view: 'home' }) }, 'Go to your courses')] : [],
      }));
      return;
    }
    page.dataset.color = c.color;
    const lecs = store.lecturesOf(c.id);
    const shown = lecs.filter((FILTERS.find((f) => f.id === filter) || FILTERS[0]).test).reverse();

    const head = h('header', { class: 'page-head course-head' },
      h('p', { class: 'eyebrow eyebrow-course' }, h('span', { class: 'swatch-dot' }), c.code),
      h('div', { class: 'course-title-row' },
        h('h1', { class: 'page-title', dir: 'auto' }, c.name),
        h('div', { class: 'course-actions' },
          h('button', { class: 'btn btn-course', type: 'button', onclick: () => newLecture(c.id, 'lecture') }, icon('plus', 15), 'New lecture'),
          h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => newLecture(c.id, 'tutorial') }, icon('plus', 15), 'New tutorial'),
          h('button', { class: 'icon-btn', type: 'button', title: 'Edit course', 'aria-label': 'Edit course', onclick: () => editCourseDialog(c) }, icon('edit', 17)))));

    const chips = h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Filter lectures' },
      ...FILTERS.map((f) => {
        const n = lecs.filter(f.test).length;
        return h('button', {
          class: `chip${filter === f.id ? ' is-on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(filter === f.id),
          onclick: () => { filter = f.id; ls.set('filter:' + c.id, f.id); render(); },
        }, f.label, h('span', { class: 'chip-n' }, String(n)));
      }));

    main.replaceChildren(
      chips,
      lecs.length
        ? (shown.length ? h('div', { class: 'lrows lrows-full' }, ...shown.map((l) => lectureRow(l))) : h('p', { class: 'muted' }, 'Nothing here with this filter.'))
        : emptyState({
          title: 'No lectures yet',
          body: 'Create the lecture when class starts. Add the slides now or later; notes you take before the slides arrive simply have no slide number.',
          actions: [h('button', { class: 'btn btn-course', type: 'button', onclick: () => newLecture(c.id, 'lecture') }, icon('plus', 15), 'New lecture')],
        }));
    renderSide();
    page.replaceChildren(head, h('div', { class: 'course-body' }, main, side));
  }

  function renderSide() {
    if (!entries) {
      side.replaceChildren(
        h('section', { class: 'panel' }, h('h2', { class: 'panel-title' }, 'Open questions'), h('p', { class: 'muted' }, 'Reading your notes…')),
        h('section', { class: 'panel' }, h('h2', { class: 'panel-title' }, 'Glossary'), h('p', { class: 'muted' }, 'Reading your notes…')));
      return;
    }
    const qs = openQuestions(entries);
    const qPanel = h('section', { class: 'panel' }, h('h2', { class: 'panel-title' }, 'Open questions', qs.length ? h('span', { class: 'panel-n' }, String(qs.length)) : null));
    if (!qs.length) qPanel.append(h('p', { class: 'muted' }, 'Type /question in a lecture to collect things to ask in the tutorial.'));
    else {
      qPanel.append(h('ul', { class: 'qlist' }, ...qs.slice(0, 30).map((e) => {
        const l = store.lecture(e.lectureId);
        return h('li', null, h('button', { class: 'qitem', type: 'button', onclick: () => router.go({ view: 'lecture', id: e.lectureId, block: e.blockId }) },
          h('span', { class: 'qitem-text', dir: 'auto' }, e.text),
          h('span', { class: 'qitem-src' }, [store.label(l, true), e.at ? 'slide ' + e.at.p : ''].filter(Boolean).join(' · '))));
      })));
    }

    const g = glossary(entries);
    const gPanel = h('section', { class: 'panel' }, h('h2', { class: 'panel-title' }, 'Glossary', g.length ? h('span', { class: 'panel-n' }, String(g.length)) : null));
    if (!g.length) gPanel.append(h('p', { class: 'muted' }, 'Write #term in a note, for example #heap or #polymorphism, and the term collects here with every place you used it.'));
    else {
      gPanel.append(h('dl', { class: 'gloss' }, ...g.slice(0, 60).flatMap((t) => [
        h('dt', null, h('button', { class: 'tag', type: 'button', onclick: () => openPalette('#' + t.tag) }, '#' + t.tag), h('span', { class: 'gloss-n' }, `${t.items.length}×`)),
        h('dd', { dir: 'auto' }, t.def
          ? h('button', { class: 'gloss-def', type: 'button', onclick: () => router.go({ view: 'lecture', id: t.def.lectureId, block: t.def.blockId }) }, trimDef(t.def.text, t.tag))
          : h('span', { class: 'muted' }, 'No definition yet. Tag a Definition block to add one.')),
      ])));
    }
    side.replaceChildren(qPanel, gPanel);
  }

  async function refreshEntries() {
    try { entries = await loadEntries(route.id); } catch (e) { console.warn(e); entries = []; }
    if (alive) renderSide();
  }

  render();
  refreshEntries();
  const offs = [
    bus.on('data', () => alive && render()),
    bus.on('note:saved', () => alive && refreshEntries()),
  ];
  return { unmount: () => { alive = false; offs.forEach((f) => f()); } };
}

function trimDef(text, tag) {
  const t = text.replace(new RegExp('#' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), tag);
  return t.length > 160 ? t.slice(0, 157) + '…' : t;
}
