// views/parts.js — pieces shared by several views: lecture rows, status
// pills, and the course/lecture creation flows.

import { h, icon, fmtDate } from '../util.js';
import { store } from '../store.js';
import { router } from '../router.js';
import { openDialog, confirmDialog, toast } from '../ui.js';

export const STATUS = {
  live: { label: 'In progress', short: 'Live' },
  review: { label: 'To review', short: 'Review' },
  done: { label: 'Reviewed', short: 'Done' },
};

export function statusPill(l) {
  const s = STATUS[l.status] || STATUS.live;
  return h('span', { class: `pill pill-${l.status || 'live'}` }, s.label);
}

export function lectureRow(l, { showCourse = false } = {}) {
  const c = store.course(l.courseId);
  const decks = (l.decks || []).length;
  return h('button', {
    class: `lrow${l.kind === 'tutorial' ? ' is-tut' : ''}`, type: 'button', 'data-color': c?.color || null,
    onclick: () => router.go({ view: 'lecture', id: l.id }),
  },
  h('span', { class: 'lrow-k' }, store.label(l, true)),
  h('span', { class: 'lrow-main' },
    h('span', { class: `lrow-title${l.title ? '' : ' is-blank'}`, dir: 'auto' }, l.title || 'No topic yet'),
    showCourse && c ? h('span', { class: 'lrow-course' }, c.code) : null),
  h('span', { class: 'lrow-meta' },
    l.catchUp ? h('span', { class: 'lrow-flag', title: 'Catch-up: study from the slides' }, icon('flag', 13)) : null,
    decks ? h('span', { class: 'lrow-decks', title: `${decks} slide file${decks > 1 ? 's' : ''}` }, icon('slides', 13)) : null,
    h('span', { class: 'lrow-date' }, fmtDate(l.date))),
  statusPill(l));
}

export async function newLecture(courseId, kind = 'lecture') {
  try {
    const id = await store.createLecture({ courseId, kind });
    router.go({ view: 'lecture', id, fresh: true });
  } catch (e) {
    toast(`Couldn’t create the ${kind}. ${e?.message || ''}`.trim(), { tone: 'error' });
  }
}

export async function newCourseDialog() {
  const v = await openDialog({
    title: 'Add a course',
    fields: [
      { id: 'name', label: 'Course name', placeholder: 'Data Structures', required: true, max: 80 },
      { id: 'code', label: 'Short code', placeholder: 'DS', help: 'Shown in lists and slide references. Up to 6 characters.', max: 6 },
      { id: 'color', label: 'Colour', type: 'colors' },
    ],
    submit: 'Add course',
  });
  if (!v) return null;
  try {
    const id = await store.createCourse({ name: v.name, code: v.code, color: v.color });
    router.go({ view: 'course', id });
    return id;
  } catch (e) {
    toast(`Couldn’t add the course. ${e?.message || ''}`.trim(), { tone: 'error' });
    return null;
  }
}

export async function editCourseDialog(c) {
  const v = await openDialog({
    title: 'Edit course',
    fields: [
      { id: 'name', label: 'Course name', value: c.name, required: true, max: 80 },
      { id: 'code', label: 'Short code', value: c.code, max: 6 },
      { id: 'color', label: 'Colour', type: 'colors', value: c.color },
    ],
    submit: 'Save',
    secondary: { label: 'Delete course', danger: true, run: () => deleteCourse(c) },
  });
  if (!v) return;
  store.updateCourse(c.id, { name: v.name, code: v.code || c.code, color: v.color })
    .catch((e) => toast(`Couldn’t save. ${e?.message || ''}`.trim(), { tone: 'error' }));
}

async function deleteCourse(c) {
  const n = store.lecturesOf(c.id).length;
  const ok = await confirmDialog({
    title: `Delete ${c.name}?`,
    description: n ? `This deletes the course and its ${n} lecture${n > 1 ? 's' : ''} with all their notes. This can’t be undone.` : 'This deletes the course. This can’t be undone.',
    confirm: 'Delete course',
  });
  if (!ok) return;
  router.go({ view: 'home' });
  try { await store.deleteCourse(c.id); toast('Course deleted.'); } catch (e) { toast(`Couldn’t delete the course. ${e?.message || ''}`.trim(), { tone: 'error' }); }
}

export function emptyState({ title, body, actions = [] }) {
  return h('div', { class: 'empty' },
    h('p', { class: 'empty-title' }, title),
    body ? h('p', { class: 'empty-body' }, body) : null,
    actions.length ? h('div', { class: 'empty-actions' }, ...actions) : null);
}
