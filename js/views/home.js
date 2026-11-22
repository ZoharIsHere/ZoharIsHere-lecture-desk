// views/home.js — the overview: where you left off, each course with its
// latest lectures, and what still needs reviewing.

import { h, icon, bus, ls, fmtDate, timeAgo, modKey } from '../util.js';
import { store } from '../store.js';
import { router } from '../router.js';
import { lectureRow, newLecture, newCourseDialog, emptyState } from './parts.js';
import { openPalette } from '../palette.js';

export function mountHome(root) {
  const page = h('div', { class: 'page page-home' });
  root.append(page);
  let queued = false;
  const render = () => {
    if (queued) return; queued = true;
    requestAnimationFrame(() => { queued = false; page.replaceChildren(...build()); });
  };
  page.replaceChildren(...build());
  const off = bus.on('data', render);
  return { unmount: off };
}

function build() {
  const courses = store.coursesSorted();
  const out = [];
  out.push(h('header', { class: 'page-head' },
    h('p', { class: 'eyebrow' }, new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })),
    h('h1', { class: 'page-title' }, 'Your courses')));

  if (!store.ready) {
    out.push(h('p', { class: 'muted' }, 'Opening your notes…'));
    return out;
  }

  if (!courses.length) {
    out.push(emptyState({
      title: 'Add your first course',
      body: 'Each course holds its lectures and tutorials. Inside a lecture, the slides sit beside your notes and every note remembers its slide.',
      actions: [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => newCourseDialog() }, icon('plus', 16), 'Add course')],
    }));
    return out;
  }

  const last = store.lecture(ls.get('last'));
  if (last) {
    const c = store.course(last.courseId);
    out.push(h('button', { class: 'resume', type: 'button', 'data-color': c?.color, onclick: () => router.go({ view: 'lecture', id: last.id }) },
      h('span', { class: 'resume-k' }, 'Continue'),
      h('span', { class: 'resume-main' },
        h('span', { class: 'resume-title', dir: 'auto' }, last.title || store.label(last)),
        h('span', { class: 'resume-sub' }, [c?.code, store.label(last), fmtDate(last.date), last.updatedAt ? 'edited ' + timeAgo(last.updatedAt) : ''].filter(Boolean).join(' · '))),
      icon('right', 18)));
  }

  const grid = h('div', { class: 'cgrid' });
  for (const c of courses) grid.append(courseCard(c));
  out.push(grid);

  const attention = [...store.lectures.values()]
    .filter((l) => l.status === 'review' || l.catchUp)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const lower = h('div', { class: 'home-lower' });
  lower.append(h('section', { class: 'panel' },
    h('h2', { class: 'panel-title' }, 'Needs attention'),
    attention.length
      ? h('div', { class: 'lrows' }, ...attention.slice(0, 10).map((l) => lectureRow(l, { showCourse: true })))
      : h('p', { class: 'muted' }, 'Nothing waiting. Lectures you mark “To review” or flag for catch-up appear here.')));
  lower.append(h('section', { class: 'panel panel-keys' },
    h('h2', { class: 'panel-title' }, 'In a lecture'),
    h('dl', { class: 'keys-list keys-compact' },
      h('dt', null, h('kbd', null, 'Alt ↑ ↓')), h('dd', null, 'Flip slides while you type'),
      h('dt', null, h('kbd', null, '/')), h('dd', null, 'Definition, theorem, code, math, diagram'),
      h('dt', null, h('kbd', null, 'S')), h('dd', null, 'Snapshot part of the slide into your notes'),
      h('dt', null, h('kbd', null, '#term')), h('dd', null, 'Add a term to the course glossary'),
      h('dt', null, h('kbd', null, `${modKey} K`)), h('dd', null, 'Search every note you have taken')),
    h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => openPalette() }, icon('search', 15), 'Search notes')));
  out.push(lower);
  return out;
}

function courseCard(c) {
  const lecs = store.lecturesOf(c.id);
  const nL = lecs.filter((l) => l.kind !== 'tutorial').length;
  const nT = lecs.length - nL;
  const review = lecs.filter((l) => l.status === 'review').length;
  const stats = [`${nL} lecture${nL === 1 ? '' : 's'}`, `${nT} tutorial${nT === 1 ? '' : 's'}`];
  if (review) stats.push(`${review} to review`);
  return h('article', { class: 'ccard', 'data-color': c.color },
    h('header', { class: 'ccard-head' },
      h('button', { class: 'ccard-title', type: 'button', onclick: () => router.go({ view: 'course', id: c.id }) },
        h('span', { class: 'ccard-code' }, c.code),
        h('span', { class: 'ccard-name', dir: 'auto' }, c.name)),
      h('div', { class: 'ccard-actions' },
        h('button', { class: 'btn btn-course', type: 'button', onclick: () => newLecture(c.id, 'lecture') }, icon('plus', 15), 'Lecture'),
        h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => newLecture(c.id, 'tutorial') }, icon('plus', 15), 'Tutorial'))),
    h('p', { class: 'ccard-stats' }, stats.join(' · ')),
    lecs.length
      ? h('div', { class: 'lrows' }, ...lecs.slice().reverse().slice(0, 4).map((l) => lectureRow(l)))
      : h('p', { class: 'ccard-empty' }, 'No lectures yet. Start one when class begins; the slides can be added any time.'),
    lecs.length > 4 ? h('button', { class: 'ccard-more', type: 'button', onclick: () => router.go({ view: 'course', id: c.id }) }, `All ${lecs.length}`, icon('right', 14)) : null);
}
