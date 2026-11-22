// views/lecture.js — the lecture desk: header, slides beside notes, and the
// glue between them (anchoring, snapshots, keyboard, autosave).

import { h, icon, bus, ls, debounce, isTypingTarget, clamp } from '../util.js';
import { store, NoteSession } from '../store.js';
import { registry } from '../registry.js';
import { BlockEditor } from '../editor.js';
import { SlideViewer } from '../viewer.js';
import { toast, showMenu, confirmDialog, openDialog, showShortcuts, isMenuOpen } from '../ui.js';
import { router } from '../router.js';
import { openPalette, invalidateSearch } from '../palette.js';
import { STATUS, emptyState } from './parts.js';
import { syncText } from './shell.js';

const LAYOUTS = [
  { id: 'slides', icon: 'slides', label: 'Slides only' },
  { id: 'split', icon: 'split', label: 'Slides and notes' },
  { id: 'notes', icon: 'notes', label: 'Notes only' },
];
const narrow = () => window.matchMedia('(max-width: 760px)').matches;

export function mountLecture(root, route) {
  const lec0 = store.lecture(route.id);
  if (!lec0) {
    root.append(emptyState({
      title: store.ready ? 'This lecture no longer exists' : 'Opening…',
      actions: [h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => router.go({ view: 'home' }) }, 'Go to your courses')],
    }));
    return {};
  }
  const id = lec0.id;
  const lec = () => store.lecture(id) || lec0;
  ls.set('last', id);
  const course = store.course(lec0.courseId);

  let layout = narrow() ? (ls.get('layoutPhone', 'notes')) : ls.get('layout', 'split');
  let split = clamp(ls.get('split', 0.5), 0.25, 0.75);

  // ---- slides & notes ---------------------------------------------------------
  let editor = null; // created below; the viewer may report a slide before then
  const followDefault = ls.get('follow:' + id, lec0.status !== 'live');
  const viewer = new SlideViewer({
    lecture: lec0,
    follow: followDefault,
    onSlide: (at) => editor?.onSlideChange(at),
    onDecksChange: (decks) => store.updateLecture(id, { decks }).catch((e) => toast(`Couldn’t save the slides list. ${e?.message || ''}`, { tone: 'error' })),
  });

  const actions = {
    async snapshot(afterId) {
      if (layout === 'notes') setLayout('split');
      const shot = await viewer.snapshot();
      if (shot) editor.addImage(shot.blob, { afterId, at: shot.at, w: shot.w, h: shot.h });
    },
    async slideText(afterId) {
      let lines = null;
      try { lines = await viewer.slideText(); } catch (e) { console.warn(e); }
      if (lines === null) { toast('Add slides first.'); return; }
      if (!lines.length) { toast('This slide has no selectable text. Take a snapshot instead.', { tone: 'warn' }); return; }
      const looksCode = (l) => /[;{}]\s*$|^\s*(public|private|protected|static|class|interface|int|void|for|while|if|else|return|#include|def)\b/.test(l);
      const codey = lines.filter(looksCode).length >= Math.max(2, lines.length * 0.4);
      let md;
      if (codey) {
        const first = Math.max(0, lines.findIndex(looksCode));
        const lead = lines.slice(0, first).map((l) => l.trim());
        const code = lines.slice(first);
        const strip = Math.min(...code.map((l) => l.match(/^ */)[0].length));
        md = (lead.length ? `**${lead.join(' ')}**\n` : '') + '```\n' + code.map((l) => l.slice(strip)).join('\n') + '\n```';
      } else {
        md = lines.map((l) => '> ' + l.trim()).join('\n');
      }
      editor.insertText(md, { afterId });
    },
  };
  viewer.onAction = (name) => actions[name]?.(null);

  const notesScroll = h('div', { class: 'notes-scroll' });
  const notesInner = h('div', { class: 'notes-inner' });
  notesScroll.append(notesInner);
  const loading = h('div', { class: 'notes-loading' }, h('span'), h('span'), h('span'));
  notesInner.append(loading);

  const session = new NoteSession(lec0);
  editor = new BlockEditor(notesInner, {
    anchorNow: () => viewer.anchor(),
    anchorLabel: (at) => viewer.label(at),
    isOnSlide: (at) => viewer.isOn(at),
    goTo: (at, o) => viewer.goTo(at, o),
    follow: () => viewer.follow && layout !== 'notes',
    slideStep: (d) => viewer.step(d),
    action: (name, blockId) => actions[name]?.(blockId),
    openTag: (t) => openPalette('#' + t),
    onChange: (blocks) => { session.change(blocks); invalidateSearch(); },
    onEscape: () => viewer.stage.focus({ preventScroll: true }),
  });
  editor.sheet.hidden = true;
  editor.tail.hidden = true;
  session.onRemote = (blocks) => editor.setBlocks(blocks, { keepEditing: true });

  // ---- header ----------------------------------------------------------------
  const kindBtn = h('button', { class: 'lec-kind', type: 'button', title: 'Change type or number' });
  kindBtn.addEventListener('click', () => showMenu(kindBtn, [
    { label: 'Lecture', checked: lec().kind !== 'tutorial', run: () => setKind('lecture') },
    { label: 'Tutorial', checked: lec().kind === 'tutorial', run: () => setKind('tutorial') },
    '-',
    { label: 'Change number…', icon: 'edit', run: renumber },
  ]));
  const title = h('input', {
    class: 'lec-title', type: 'text', value: lec0.title || '', placeholder: 'Topic, e.g. Heaps and priority queues',
    'aria-label': 'Lecture topic', dir: 'auto', maxlength: '140', spellcheck: 'false',
  });
  const saveTitle = debounce(() => store.updateLecture(id, { title: title.value.trim() }).catch(() => {}), 600);
  title.addEventListener('input', saveTitle);
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || (e.key === 'ArrowDown' && !e.shiftKey)) { e.preventDefault(); saveTitle(); editor.appendAndEdit(); }
    if (e.key === 'Escape') title.blur();
  });
  title.addEventListener('blur', () => { saveTitle.cancel(); if ((lec().title || '') !== title.value.trim()) store.updateLecture(id, { title: title.value.trim() }).catch(() => {}); });

  const date = h('input', { class: 'lec-date', type: 'date', value: lec0.date || '', 'aria-label': 'Date' });
  date.addEventListener('change', () => { if (date.value) store.updateLecture(id, { date: date.value }).catch(() => {}); });

  const statusSeg = h('div', { class: 'seg seg-status', role: 'radiogroup', 'aria-label': 'Status' },
    ...Object.entries(STATUS).map(([k, s]) => h('button', {
      class: 'seg-btn', type: 'button', role: 'radio', 'data-status': k, title: s.label,
      onclick: () => setStatus(k),
    }, h('span', { class: `dot dot-${k}`, 'aria-hidden': 'true' }), h('span', { class: 'seg-text' }, s.label))));

  const flagBtn = h('button', {
    class: 'icon-btn lec-flag', type: 'button', title: 'Catch-up: study this one from the slides', 'aria-label': 'Catch-up flag',
    onclick: () => store.updateLecture(id, { catchUp: !lec().catchUp }).catch(() => {}),
  }, icon('flag', 17));

  const syncEl = h('span', { class: 'sync', role: 'status' }, h('span', { class: 'sync-dot', 'aria-hidden': 'true' }), h('span', { class: 'sync-text' }));
  const layoutSeg = h('div', { class: 'seg seg-icons', role: 'radiogroup', 'aria-label': 'Layout' },
    ...LAYOUTS.map((L) => h('button', {
      class: 'seg-btn', type: 'button', role: 'radio', 'data-layout': L.id, title: L.label, 'aria-label': L.label,
      onclick: () => setLayout(L.id),
    }, icon(L.icon, 17), h('span', { class: 'seg-text phone-only' }, L.id === 'slides' ? 'Slides' : L.id === 'notes' ? 'Notes' : 'Both'))));

  const toolBtns = registry.lectureTools.map((t) => h('button', {
    class: 'icon-btn', type: 'button', title: t.label, 'aria-label': t.label, onclick: () => t.run(publicCtx),
  }, icon(t.icon || 'right', 17)));

  const moreBtn = h('button', { class: 'icon-btn', type: 'button', title: 'More', 'aria-label': 'More options' }, icon('more', 18));
  moreBtn.addEventListener('click', () => showMenu(moreBtn, [
    { label: 'Copy notes as Markdown', icon: 'copy', run: copyMarkdown },
    { label: 'Focus mode', icon: 'focus', hint: 'F', run: toggleFocus },
    { label: 'Keyboard shortcuts', icon: 'keyboard', hint: '?', run: showShortcuts },
    '-',
    { label: course ? `Open ${course.code}` : 'Open course', icon: 'book', run: () => router.go({ view: 'course', id: lec().courseId }) },
    { label: `Delete this ${lec().kind === 'tutorial' ? 'tutorial' : 'lecture'}`, icon: 'trash', danger: true, run: deleteLecture },
  ]));

  const crumb = h('button', { class: 'lec-course', type: 'button', onclick: () => router.go({ view: 'course', id: lec().courseId }), title: course?.name || '' },
    h('span', { class: 'swatch-dot' }), h('span', null, course?.code || 'Course'));

  const head = h('header', { class: 'lec-head' },
    h('div', { class: 'lec-id' }, crumb, h('span', { class: 'lec-slash', 'aria-hidden': 'true' }, '/'), kindBtn, date),
    h('div', { class: 'lec-titlewrap' }, title),
    h('div', { class: 'lec-tools' }, statusSeg, flagBtn, syncEl, h('span', { class: 'lec-sep' }), layoutSeg, ...toolBtns, moreBtn));

  // ---- body ------------------------------------------------------------------
  const paneSlides = h('div', { class: 'pane pane-slides' }, viewer.el);
  const paneNotes = h('div', { class: 'pane pane-notes' }, notesScroll);
  const resizer = h('div', { class: 'resizer', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize slides and notes', tabindex: '0' });
  const body = h('div', { class: 'lec-body' }, paneSlides, resizer, paneNotes);
  const exitFocus = h('button', { class: 'focus-exit', type: 'button', onclick: () => toggleFocus(false) }, 'Exit focus', h('kbd', null, 'F'));
  const bar = h('div', { class: 'classbar', role: 'toolbar', 'aria-label': 'In class' });
  const page = h('div', { class: 'lec', 'data-color': course?.color || 'graphite' }, head, bar, body, exitFocus);
  root.append(page);

  resizer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    resizer.setPointerCapture(e.pointerId);
    page.classList.add('is-resizing');
    const r = body.getBoundingClientRect();
    const move = (ev) => { split = clamp((ev.clientX - r.left) / r.width, 0.25, 0.75); body.style.setProperty('--split', split); };
    const up = () => {
      resizer.removeEventListener('pointermove', move); resizer.removeEventListener('pointerup', up);
      page.classList.remove('is-resizing'); ls.set('split', split);
    };
    resizer.addEventListener('pointermove', move);
    resizer.addEventListener('pointerup', up);
  });
  resizer.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    split = clamp(split + (e.key === 'ArrowLeft' ? -0.03 : 0.03), 0.25, 0.75);
    body.style.setProperty('--split', split); ls.set('split', split);
  });

  // PDFs dropped anywhere in the lecture go to the slides.
  page.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
  page.addEventListener('drop', (e) => {
    const pdfs = [...(e.dataTransfer?.files || [])].filter((f) => f.type === 'application/pdf' || /\.(pdf|pptx?)$/i.test(f.name));
    if (!pdfs.length) return;
    e.preventDefault();
    if (layout === 'notes') setLayout('split');
    viewer.addFiles(pdfs);
  });

  // ---- state → DOM -----------------------------------------------------------
  function paintHeader() {
    const l = lec();
    kindBtn.textContent = store.label(l);
    if (document.activeElement !== title && title.value !== (l.title || '')) title.value = l.title || '';
    if (document.activeElement !== date && date.value !== (l.date || '')) date.value = l.date || '';
    statusSeg.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.status === (l.status || 'live'))));
    flagBtn.setAttribute('aria-pressed', String(!!l.catchUp));
  }
  function paintLayout() {
    body.dataset.layout = layout;
    body.style.setProperty('--split', split);
    layoutSeg.querySelectorAll('.seg-btn').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.layout === layout)));
  }
  function paintSync(s) {
    syncEl.dataset.state = s.state;
    syncEl.querySelector('.sync-text').textContent = syncText(s.state);
  }

  function setLayout(v) {
    if (narrow() && v === 'split') v = 'notes';
    layout = v;
    ls.set(narrow() ? 'layoutPhone' : 'layout', v);
    paintLayout();
  }
  function toggleSlides() { setLayout(layout === 'notes' ? 'split' : 'notes'); }
  function setStatus(k) {
    store.updateLecture(id, { status: k }).catch(() => {});
    if (k !== 'live' && !ls.get('follow:' + id) && !viewer.follow) { viewer.follow = true; viewer.followBtn.setAttribute('aria-pressed', 'true'); }
  }
  function setKind(kind) {
    if (lec().kind === kind) return;
    store.updateLecture(id, { kind, number: store.nextNumber(lec().courseId, kind) }).catch(() => {});
  }
  async function renumber() {
    const v = await openDialog({ title: 'Change number', fields: [{ id: 'n', label: `${lec().kind === 'tutorial' ? 'Tutorial' : 'Lecture'} number`, type: 'number', value: String(lec().number), required: true }], submit: 'Save' });
    const n = parseInt(v?.n, 10);
    if (n > 0) store.updateLecture(id, { number: n }).catch(() => {});
  }
  function toggleFocus(force) {
    const on = typeof force === 'boolean' ? force : !document.documentElement.classList.contains('is-focus');
    document.documentElement.classList.toggle('is-focus', on);
  }
  async function copyMarkdown() {
    const md = editor.toMarkdown([course?.code, store.label(lec()), lec().title].filter(Boolean).join(' · '));
    try { await navigator.clipboard.writeText(md); toast('Notes copied as Markdown.'); } catch {
      const ta = h('textarea', { class: 'copy-box', readonly: true }, md);
      openDialog({ title: 'Copy your notes', description: 'Select all and copy.', submit: 'Done' });
      requestAnimationFrame(() => { document.querySelector('.dlg-desc')?.after(ta); ta.focus(); ta.select(); });
    }
  }
  async function deleteLecture() {
    const what = lec().kind === 'tutorial' ? 'tutorial' : 'lecture';
    const ok = await confirmDialog({ title: `Delete ${store.label(lec())}?`, description: `The ${what} and all its notes will be deleted. Slide files stay available to other lectures that use them. This can’t be undone.`, confirm: `Delete ${what}` });
    if (!ok) return;
    deleted = true;
    const courseId = lec().courseId;
    session.discard();
    router.go({ view: 'course', id: courseId });
    store.deleteLecture(id).then(() => toast(`${what[0].toUpperCase() + what.slice(1)} deleted.`)).catch((e) => toast(`Couldn’t delete. ${e?.message || ''}`, { tone: 'error' }));
  }

  // ---- keyboard --------------------------------------------------------------
  function onKey(e) {
    if (e.defaultPrevented || e.isComposing) return;
    if (document.querySelector('.scrim, .snap-ov') || isMenuOpen()) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === '\\') { e.preventDefault(); toggleSlides(); return; }
    if (isTypingTarget(e.target) || mod || e.altKey) return;
    if ((e.key === ' ' || e.key === 'Enter') && e.target.closest?.('button, a, [role=option]')) return;
    if (viewer.grid && e.target.closest?.('.proj-grid')) return;
    switch (e.key) {
      case 'ArrowRight': case 'PageDown': case ' ': viewer.step(1); break;
      case 'ArrowLeft': case 'PageUp': viewer.step(-1); break;
      case 'Home': viewer.first(); break;
      case 'End': viewer.last(); break;
      case 'g': case 'G': viewer.toggleGrid(); break;
      case 's': case 'S': actions.snapshot(null); break;
      case 'n': case 'N': case 'Enter': editor.appendAndEdit(); break;
      case 'f': case 'F': toggleFocus(); break;
      case 'Escape': if (document.documentElement.classList.contains('is-focus')) toggleFocus(false); else return; break;
      default: return;
    }
    e.preventDefault();
  }
  document.addEventListener('keydown', onKey);

  // ---- lifecycle ---------------------------------------------------------------
  let deleted = false;
  const flush = () => { if (!deleted) session.flush(); };
  const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', onHide);
  const mq = window.matchMedia('(max-width: 760px)');
  const onMq = () => { layout = narrow() ? ls.get('layoutPhone', 'notes') : ls.get('layout', 'split'); paintLayout(); };
  mq.addEventListener?.('change', onMq);
  // Diagrams take their colours from the theme: redraw when it changes.
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const repaint = () => { if (!editor.editing) editor.renderAll(); };
  dark.addEventListener?.('change', repaint);
  const themeObs = new MutationObserver(repaint);
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  const offs = [
    bus.on('data', (kind) => {
      if (deleted) return;
      if (kind === 'lectures' || kind === undefined) {
        const l = store.lecture(id);
        if (!l) { if (store.ready) router.go({ view: 'course', id: lec0.courseId }); return; }
        paintHeader();
        viewer.setDecks(l.decks || []);
        editor.refreshMargins();
      }
    }),
    bus.on('sync', paintSync),
  ];

  paintHeader();
  paintLayout();
  paintSync({ state: store.mode === 'local' ? 'local' : 'saved' });

  session.open().then(({ blocks, restored }) => {
    if (deleted) return;
    loading.remove();
    editor.sheet.hidden = false;
    editor.tail.hidden = false;
    editor.setBlocks(blocks);
    if (restored) toast('Restored notes from this device that hadn’t synced yet.');
    if (route.block) requestAnimationFrame(() => editor.focusBlock(route.block));
    else if (route.fresh || (!lec().title && !blocks.length)) title.focus();
  });

  const publicCtx = { lecture: lec, course, editor, viewer, session, setLayout, toast };
  const featureOffs = registry.lectureMounts.map((m) => {
    try { return m(publicCtx, { page, head, body, paneNotes, paneSlides, bar }); } catch (e) { console.error('[feature]', e); return null; }
  });
  bar.hidden = !bar.childElementCount;

  return {
    focusBlock: (blockId) => editor.focusBlock(blockId),
    ctx: publicCtx,
    unmount() {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      mq.removeEventListener?.('change', onMq);
      dark.removeEventListener?.('change', repaint);
      themeObs.disconnect();
      offs.forEach((f) => f());
      featureOffs.forEach((f) => { try { f?.(); } catch (e) { console.error(e); } });
      document.documentElement.classList.remove('is-focus');
      saveTitle.cancel();
      if (!deleted) {
        if ((lec().title || '') !== title.value.trim()) store.updateLecture(id, { title: title.value.trim() }).catch(() => {});
        editor.blur();
        session.close();
      }
      viewer.destroy();
    },
  };
}
