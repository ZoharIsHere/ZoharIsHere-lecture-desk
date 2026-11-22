// features/questions.js — questions to ask.
// Start any line with ?? and it becomes a Question block when you leave it.
// "To ask" lists the open questions of this lesson and the rest of the course.
// Keyboard: Q.

import { h, isTypingTarget, bus } from '../util.js';
import { registry } from '../registry.js';
import { store } from '../store.js';
import { router } from '../router.js';
import { entriesFrom, openQuestions } from '../insights.js';
import { openDrawer, drawerOpen } from './drawer.js';

registry.addPrefix({ match: /^\?\?\s*/, type: 'question', types: ['text'] });

registry.addLectureMount((lec, { bar, page }) => {
  const id = lec.lecture().id;
  const count = h('span', { class: 'cb-count' });
  const btn = h('button', { class: 'cb-btn', type: 'button', title: 'Questions to ask (Q). Start a line with ?? to add one.', onclick: () => open() },
    h('span', null, 'To ask'), count);
  bar.append(btn);

  const mine = () => lec.editor.blocks.filter((b) => b.type === 'question' && !b.done && (b.md || '').trim());
  const paintCount = () => { const n = mine().length; count.textContent = n ? String(n) : ''; };
  paintCount();

  let drawer = null;
  async function open() {
    drawer = openDrawer(page, { id: 'ask', title: 'To ask', onClose: () => { drawer = null; } });
    if (drawer) render();
  }
  async function render() {
    if (!drawer) return;
    const here = mine();
    const list = h('div', { class: 'ask-list' });
    if (!here.length) list.append(h('p', { class: 'drawer-note' }, 'No open questions in this lesson. Start a line with ?? to add one.'));
    for (const b of here) {
      list.append(h('div', { class: 'ask-item' },
        h('button', { class: 'ask-check', type: 'button', title: 'Mark as asked', 'aria-label': 'Mark as asked', onclick: () => { lec.editor.toggleDone(b.id); render(); paintCount(); } }),
        h('button', { class: 'ask-text', type: 'button', dir: 'auto', onclick: () => lec.editor.focusBlock(b.id) }, b.md.trim())));
    }
    const others = h('div', { class: 'ask-list' });
    try {
      const notes = (await store.notesFor(lec.lecture().courseId)).filter((n) => n.id !== id);
      const open = openQuestions(entriesFrom(notes));
      if (open.length) {
        others.append(h('h3', { class: 'drawer-sub' }, 'Earlier in this course'));
        for (const e of open) {
          const l = store.lecture(e.lectureId);
          others.append(h('div', { class: 'ask-item' },
            h('span', { class: 'ask-from' }, l ? store.label(l, true) : ''),
            h('button', { class: 'ask-text', type: 'button', dir: 'auto', onclick: () => router.go({ view: 'lecture', id: e.lectureId, block: e.blockId }) }, e.text)));
        }
      }
    } catch (e) { console.warn('[questions]', e); }
    if (drawer) drawer.body.replaceChildren(list, others);
  }

  const offs = [bus.on('note:saved', ({ lectureId }) => { if (lectureId === id) { paintCount(); if (drawerOpen('ask')) render(); } })];
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target) || document.querySelector('.scrim')) return;
    if (e.key === 'q' || e.key === 'Q') { e.preventDefault(); open(); }
  };
  document.addEventListener('keydown', onKey);
  return () => { offs.forEach((f) => f()); document.removeEventListener('keydown', onKey); };
});
