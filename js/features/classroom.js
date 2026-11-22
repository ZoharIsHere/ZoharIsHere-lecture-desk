// features/classroom.js — the live lesson: listening and the transcript.
//
// Each open lecture gets one "room" (see room()) that the other in-class
// features share: the transcript so far, who is listening, and events.
//   room.lines      [{ t, text, slide }]   t = seconds since the lesson's epoch
//   room.on(evt, fn)  'line' | 'listening' | 'tick'
// Keyboard: L toggles listening.

import { h, icon, ls, bus, isTypingTarget } from '../util.js';
import { registry } from '../registry.js';
import { store } from '../store.js';
import { Listener, speechSupported } from '../speech.js';
import { toast } from '../ui.js';

const rooms = new Map();

export function room(lec) {
  return rooms.get(lec.lecture().id);
}

function makeRoom(lec) {
  const id = lec.lecture().id;
  const handlers = new Map();
  const r = {
    id, lec, lines: [], listening: false, interim: '',
    epoch: lec.lecture().createdAt || Date.now(),
    on(evt, fn) { if (!handlers.has(evt)) handlers.set(evt, new Set()); handlers.get(evt).add(fn); return () => handlers.get(evt)?.delete(fn); },
    emit(evt, data) { for (const fn of handlers.get(evt) || []) { try { fn(data); } catch (e) { console.error(e); } } },
    now() { return Math.round((Date.now() - r.epoch) / 1000); },
    slideLabel() { const a = lec.viewer.anchor(); return a ? `${a.p}` : null; },
    since(t) { return r.lines.filter((l) => l.t >= t); },
    text(lines = r.lines) { return lines.map((l) => (l.slide ? `[slide ${l.slide}] ` : '') + l.text).join('\n'); },
  };
  rooms.set(id, r);
  return r;
}

const LANGS = [
  { id: 'he-IL', label: 'עברית' },
  { id: 'en-US', label: 'English' },
];

registry.addLectureMount((lec, { bar, page, paneNotes }) => {
  const r = makeRoom(lec);
  store.transcript(r.id).then((rows) => {
    const old = rows.map((row) => ({ t: Math.round((Date.parse(row.t) - r.epoch) / 1000), text: row.text, slide: row.slide ?? null }));
    r.lines = old.concat(r.lines); paintLog();
  }).catch((e) => console.warn('[transcript]', e));

  // Unsaved phrases are sent in small batches.
  let pending = [];
  const flush = async () => {
    if (!pending.length) return;
    const rows = pending; pending = [];
    try { await store.addTranscript(rows); } catch (e) { pending = rows.concat(pending); console.warn('[transcript] save', e); }
  };
  const flushTimer = setInterval(flush, 8000);

  let lang = ls.get('speechLang', 'he-IL');
  const listener = new Listener({
    lang,
    onFinal: (text) => {
      const line = { t: r.now(), text, slide: r.slideLabel() };
      r.lines.push(line);
      pending.push({ lecture_id: r.id, t: new Date().toISOString(), text, slide: line.slide });
      r.interim = '';
      paintLog();
      r.emit('line', line);
    },
    onInterim: (text) => { r.interim = text; paintInterim(); },
    onState: (s) => {
      r.listening = s === 'listening';
      paintBtn();
      r.emit('listening', r.listening);
      if (!r.listening) flush();
    },
    onError: (msg) => toast(msg, { tone: 'error', ms: 7000 }),
  });
  r.startListening = () => listener.start();
  r.stopListening = () => listener.stop();

  // ---- controls ----------------------------------------------------------------
  const btn = h('button', {
    class: 'cb-btn cb-listen', type: 'button', 'aria-pressed': 'false', title: 'Listen to the lesson (L)',
    onclick: () => (r.listening ? listener.stop() : listener.start()),
  }, h('span', { class: 'cb-rec', 'aria-hidden': 'true' }), h('span', { class: 'cb-label' }, 'Listen'));
  const langBtn = h('button', {
    class: 'cb-btn cb-lang', type: 'button', title: 'Language of the lesson',
    onclick: () => {
      const i = LANGS.findIndex((l) => l.id === lang);
      lang = LANGS[(i + 1) % LANGS.length].id;
      ls.set('speechLang', lang);
      listener.setLang(lang);
      paintBtn();
    },
  });
  const logBtn = h('button', {
    class: 'cb-btn cb-icon', type: 'button', title: 'Show what was said', 'aria-label': 'Transcript', 'aria-pressed': 'false',
    onclick: () => { log.hidden = !log.hidden; logBtn.setAttribute('aria-pressed', String(!log.hidden)); if (!log.hidden) log.scrollTop = log.scrollHeight; },
  }, icon('lines', 16));
  if (!speechSupported()) { btn.disabled = true; btn.title = 'Listening needs Google Chrome.'; }
  bar.append(h('div', { class: 'cb-group' }, btn, langBtn, logBtn));

  // ---- transcript strip ------------------------------------------------------------
  const logList = h('div', { class: 'tlog-list' });
  const interimEl = h('p', { class: 'tlog-interim' });
  const log = h('div', { class: 'tlog', hidden: true, 'aria-live': 'off' }, logList, interimEl);
  paneNotes.append(log);

  function paintBtn() {
    btn.setAttribute('aria-pressed', String(r.listening));
    btn.querySelector('.cb-label').textContent = r.listening ? 'Listening' : 'Listen';
    langBtn.textContent = LANGS.find((l) => l.id === lang)?.label || lang;
    page.classList.toggle('is-listening', r.listening);
  }
  function paintLog() {
    const last = r.lines.slice(-60);
    logList.replaceChildren(...last.map((l) => h('p', { dir: 'auto' }, l.slide ? h('span', { class: 'tlog-slide' }, l.slide) : null, l.text)));
    paintInterim();
    if (!log.hidden) log.scrollTop = log.scrollHeight;
  }
  function paintInterim() { interimEl.textContent = r.interim; interimEl.dir = 'auto'; }
  paintBtn();

  const tick = setInterval(() => r.emit('tick', r.now()), 1000);
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target) || document.querySelector('.scrim')) return;
    if (e.key === 'l' || e.key === 'L') { e.preventDefault(); btn.click(); }
  };
  document.addEventListener('keydown', onKey);
  const offEnd = bus.on('lesson:end', (lid) => { if (lid === r.id) listener.stop(); });

  return () => {
    listener.stop();
    flush();
    clearInterval(flushTimer); clearInterval(tick);
    document.removeEventListener('keydown', onKey);
    offEnd();
    rooms.delete(r.id);
  };
});
