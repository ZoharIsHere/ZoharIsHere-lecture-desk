// features/sheets.js — living course summaries. Keyboard: W.
//
// Words: every #word you tag, with its meaning (the Definition block that tags
//   it, or the first sentence that does). Updates as you write.
// Principles: an AI-kept summary sheet per course. For an OOP course it is the
//   OOP principles sheet (encapsulation, inheritance, polymorphism, SOLID…, each
//   with what you wrote and where); for other courses, the key ideas. It
//   refreshes when a lesson ends, or with "Update now".

import { h, isTypingTarget, bus, timeAgo } from '../util.js';
import { registry } from '../registry.js';
import { store } from '../store.js';
import { router } from '../router.js';
import { entriesFrom, glossary } from '../insights.js';
import { renderMarkdown } from '../markdown.js';
import { ask, aiAvailable } from '../ai.js';
import { toast } from '../ui.js';
import { openDrawer, drawerOpen } from './drawer.js';

const isOop = (course) => /oop|object|מונחה|עצמים/i.test(`${course?.name || ''} ${course?.code || ''}`);

async function courseEntries(lec) {
  const id = lec.lecture().id;
  const notes = (await store.notesFor(lec.lecture().courseId)).filter((n) => n.id !== id);
  notes.push({ id, blocks: lec.editor.serialize() });
  return entriesFrom(notes);
}

/** Rebuilds the course's principles sheet with the AI. Exported for "End lesson". */
export async function updatePrinciples(lec, { quiet = false } = {}) {
  if (!aiAvailable()) { if (!quiet) toast('Summaries need AI (Settings → AI).', { tone: 'warn' }); return null; }
  const course = lec.course;
  const entries = await courseEntries(lec);
  const text = entries.filter((e) => e.type !== 'image').map((e) => {
    const l = store.lecture(e.lectureId);
    return `[${l ? store.label(l, true) : ''}${e.type !== 'text' ? ' ' + e.type : ''}] ${e.md}`;
  }).join('\n').slice(-60000);
  const oop = isOop(course);
  const md = await ask({
    max_tokens: 4000,
    system: oop
      ? 'From a student\'s OOP course notes, write a principles sheet in Markdown. One ### section per principle or concept the notes cover (e.g. encapsulation, abstraction, inheritance, polymorphism, interfaces vs abstract classes, composition, SOLID, design patterns, generics, exceptions). Under each: 2–4 bullets in the student\'s language mix with the essence, a tiny Java example only when it clarifies, and where it was taught in brackets like [L3]. Only include what the notes cover. No preamble.'
      : 'From a student\'s course notes, write a one-page summary sheet in Markdown: one ### section per main topic, with the key definitions, results (with complexity where relevant) and exam traps as short bullets, in the student\'s language mix, each with where it was taught in brackets like [L3]. Only what the notes cover. No preamble.',
    prompt: text || '(no notes yet)',
  });
  const sheet = { courseId: course.id, kind: 'principles', md: md.trim() };
  await store.saveSheet(`${course.id}:principles`, sheet);
  bus.emit('sheet:updated', course.id);
  return sheet;
}

registry.addLectureMount((lec, { bar, page }) => {
  const btn = h('button', { class: 'cb-btn', type: 'button', title: 'Course summaries and saved words (W)', onclick: () => open() }, 'Summaries');
  bar.append(btn);
  let tab = 'words';
  let drawer = null;

  function open() {
    drawer = openDrawer(page, { id: 'sheets', title: lec.course?.code ? `${lec.course.code} summaries` : 'Summaries', onClose: () => { drawer = null; } });
    if (drawer) render();
  }

  async function render() {
    if (!drawer) return;
    const tabs = h('div', { class: 'seg drawer-tabs', role: 'tablist' },
      ...[['words', 'Words'], ['principles', isOop(lec.course) ? 'OOP principles' : 'Key ideas']].map(([id, label]) => h('button', {
        class: 'seg-btn', type: 'button', role: 'tab', 'aria-selected': String(tab === id), onclick: () => { tab = id; render(); },
      }, label)));
    const content = h('div', { class: 'drawer-content' }, h('p', { class: 'drawer-note' }, 'Loading…'));
    drawer.body.replaceChildren(tabs, content);
    try {
      if (tab === 'words') content.replaceChildren(await wordsView());
      else content.replaceChildren(await principlesView());
    } catch (e) { content.replaceChildren(h('p', { class: 'drawer-note' }, e.message)); }
  }

  async function wordsView() {
    const words = glossary(await courseEntries(lec));
    if (!words.length) return h('p', { class: 'drawer-note' }, 'Tag a word with # (like #heap or #רקורסיה) and it shows up here with its meaning. A Definition block that tags the word becomes its meaning.');
    return h('dl', { class: 'words' }, ...words.flatMap((w) => {
      const src = w.def || w.items[0];
      const l = store.lecture(src.lectureId);
      const meaning = src.text.replace(/#[\p{L}\p{N}_-]+/gu, (m) => m.slice(1));
      return [
        h('dt', { dir: 'auto' }, w.tag, h('span', { class: 'words-n' }, w.items.length > 1 ? `×${w.items.length}` : '')),
        h('dd', { dir: 'auto' },
          h('span', null, meaning.length > 220 ? meaning.slice(0, 220) + '…' : meaning),
          l ? h('button', { class: 'words-src', type: 'button', onclick: () => (src.lectureId === lec.lecture().id ? lec.editor.focusBlock(src.blockId) : router.go({ view: 'lecture', id: src.lectureId, block: src.blockId })) }, store.label(l, true)) : null),
      ];
    }));
  }

  async function principlesView() {
    const sheet = await store.sheet(`${lec.lecture().courseId}:principles`).catch(() => null);
    const upd = h('button', {
      class: 'btn btn-quiet', type: 'button',
      onclick: async () => {
        upd.disabled = true; upd.textContent = 'Updating…';
        try { await updatePrinciples(lec); } catch (e) { toast(e.message, { tone: 'warn' }); }
        render();
      },
    }, 'Update now');
    const meta = h('p', { class: 'drawer-note' }, sheet ? `Updated ${timeAgo(sheet.updatedAt)}. Refreshes when a lesson ends.` : 'Not made yet. It’s built when a lesson ends, or now:');
    return h('div', null, h('div', { class: 'drawer-actions' }, meta, upd),
      sheet ? h('div', { class: 'md drawer-md', dir: 'auto', html: renderMarkdown(sheet.md) }) : null);
  }

  const offs = [
    bus.on('note:saved', () => { if (drawerOpen('sheets') && tab === 'words') render(); }),
    bus.on('sheet:updated', () => { if (drawerOpen('sheets') && tab === 'principles') render(); }),
  ];
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target) || document.querySelector('.scrim')) return;
    if (e.key === 'w' || e.key === 'W') { e.preventDefault(); open(); }
  };
  document.addEventListener('keydown', onKey);
  return () => { offs.forEach((f) => f()); document.removeEventListener('keydown', onKey); };
});
