// store.js — every read and write goes through here.
//
// Two interchangeable backends share one interface:
//   SupabaseBackend  your Supabase project (normal use)
//   LocalBackend     this browser only (open the app with ?local)
//
// Data model (collections → documents):
//   courses/{id}   { name, code, color, order, createdAt }
//   lectures/{id}  { courseId, kind:'lecture'|'tutorial', number, title, date,
//                    status:'live'|'review'|'done', catchUp, decks:[{id,name,pages}],
//                    createdAt, updatedAt }
//   notes/{lectureId} { courseId, blocks:[Block], updatedAt, writer }
//   Block = { id, type, md, at:{d:deckId,p:page}|null, done?, img?:{asset,w,h} }
//
// Slides and snapshots are stored as assets; documents keep only their ids.

import { bus, ls, uid, todayISO } from './util.js';
import { BUCKET } from './config.js';

export const SESSION = uid('s');
const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One write at a time per document, in order.
const queues = new Map();
function serial(key, fn) {
  const next = (queues.get(key) || Promise.resolve()).catch(() => {}).then(fn);
  queues.set(key, next);
  next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => {});
  return next;
}

// ---------------------------------------------------------------------------
// SupabaseBackend: one table `docs` (user_id, col, id, data jsonb) holds every
// document; slides and snapshots live in the private `files` bucket under the
// owner's id. Lists are refreshed on focus, every 20 s, and after each write,
// and the last copy is kept in this browser so the app opens offline.
class SupabaseBackend {
  constructor(sb, user) {
    this.sb = sb; this.user = user; this.name = 'cloud';
    this.watchers = new Map(); this.cache = new Map(); this.urls = new Map(); this.loading = new Map();
    const refresh = () => { for (const col of this.watchers.keys()) if (!col.includes('/')) this.refresh(col); };
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 20000);
  }
  rowsToDocs(rows) { return (rows || []).map((r) => ({ id: r.id, ...(r.data || {}) })); }
  async refresh(col) {
    const { data, error } = await this.sb.from('docs').select('id,data').eq('col', col);
    if (error) throw Object.assign(new Error(error.message), { code: 'unavailable' });
    const list = this.rowsToDocs(data);
    this.cache.set(col, list);
    ls.set('cache:' + col, list);
    for (const fn of this.watchers.get(col) || []) fn(clone(list));
    return list;
  }
  watch(col, onData, onError) {
    if (!this.watchers.has(col)) this.watchers.set(col, new Set());
    this.watchers.get(col).add(onData);
    const cached = ls.get('cache:' + col, null);
    this.refresh(col).catch((e) => { if (cached) onData(cached); onError?.(e); });
    return () => this.watchers.get(col)?.delete(onData);
  }
  watchDoc(col, id, onData) {
    // Notes are edited in one place at a time; a fresh copy is read on open.
    return () => {};
  }
  async get(col, id) {
    const { data, error } = await this.sb.from('docs').select('id,data').eq('col', col).eq('id', id).maybeSingle();
    if (error) throw Object.assign(new Error(error.message), { code: 'unavailable' });
    return data ? { id: data.id, ...clone(data.data) } : null;
  }
  async set(col, id, doc) {
    const { error } = await this.sb.from('docs').upsert({ user_id: this.user.id, col, id, data: doc }, { onConflict: 'user_id,col,id' });
    if (error) throw Object.assign(new Error(error.message), { code: navigator.onLine ? 'failed' : 'unavailable' });
    this.after(col);
  }
  async update(col, id, patch) {
    const cur = await this.get(col, id);
    if (!cur) throw Object.assign(new Error('Missing document'), { code: 'invalid_argument' });
    const { id: _, ...rest } = cur;
    return this.set(col, id, { ...rest, ...patch });
  }
  async del(col, id) {
    const { error } = await this.sb.from('docs').delete().eq('col', col).eq('id', id);
    if (error) throw Object.assign(new Error(error.message), { code: 'unavailable' });
    this.after(col);
  }
  after(col) { if (this.watchers.has(col)) this.refresh(col).catch(() => {}); }
  async query(col, field, value) {
    let q = this.sb.from('docs').select('id,data').eq('col', col);
    if (field) q = q.eq(`data->>${field}`, value);
    const { data, error } = await q;
    if (error) throw Object.assign(new Error(error.message), { code: 'unavailable' });
    return this.rowsToDocs(data);
  }
  get canUpload() { return true; }
  async upload(blob, type) {
    const id = uid('a');
    const { error } = await this.sb.storage.from(BUCKET).upload(`${this.user.id}/${id}`, blob, { contentType: type || blob.type, upsert: false });
    if (error) throw new Error(error.message);
    this.urls.set(id, URL.createObjectURL(blob));
    return { id, url: this.urls.get(id), sizeBytes: blob.size, contentType: type || blob.type };
  }
  async blob(id) {
    if (!this.loading.has(id)) {
      const p = (async () => {
        let blob = await idbGet(id).catch(() => null);
        if (!blob) {
          const { data, error } = await this.sb.storage.from(BUCKET).download(`${this.user.id}/${id}`);
          if (error) throw new Error(`A file could not be loaded. ${error.message}`);
          blob = data;
          idbPut(id, blob).catch(() => {});
        }
        return blob;
      })();
      p.catch(() => this.loading.delete(id));
      this.loading.set(id, p);
    }
    return this.loading.get(id);
  }
  /** Images load in the background; <img data-asset> elements get their source when ready. */
  assetUrl(id) {
    if (this.urls.has(id)) return this.urls.get(id);
    this.blob(id).then((b) => {
      const url = URL.createObjectURL(b);
      this.urls.set(id, url);
      document.querySelectorAll(`img[data-asset="${id}"]`).forEach((img) => { img.src = url; img.closest('figure')?.classList.remove('is-broken'); });
    }).catch((e) => console.warn('[store] image', e));
    return '';
  }
  async fetchAsset(id) { return (await this.blob(id)).arrayBuffer(); }

  async addTranscript(rows) {
    const { error } = await this.sb.from('transcript').insert(rows.map((r) => ({ ...r, user_id: this.user.id })));
    if (error) throw new Error(error.message);
  }
  async transcript(lectureId) {
    const { data, error } = await this.sb.from('transcript').select('t,text,slide').eq('lecture_id', lectureId).order('t');
    if (error) throw new Error(error.message);
    return data || [];
  }
}

// A small IndexedDB cache for downloaded files (slides open offline).
let cacheDbP = null;
function cacheDb() {
  if (!cacheDbP) {
    cacheDbP = new Promise((resolve, reject) => {
      const req = indexedDB.open('lecture-desk-files', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return cacheDbP;
}
async function idbGet(id) {
  const db = await cacheDb();
  return new Promise((res, rej) => { const r = db.transaction('files').objectStore('files').get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function idbPut(id, blob) {
  const db = await cacheDb();
  return new Promise((res, rej) => { const tx = db.transaction('files', 'readwrite'); tx.objectStore('files').put(blob, id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}

// ---------------------------------------------------------------------------
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('lecture-desk', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('assets');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbDo(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('assets', mode);
    const req = fn(tx.objectStore('assets'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

class LocalBackend {
  constructor() { this.name = 'local'; this.watchers = new Map(); this.urls = new Map(); }
  async init() {
    this.data = ls.get('db', null) || { courses: {}, lectures: {}, notes: {} };
    try {
      this.idb = await idbOpen();
      const keys = await idbDo(this.idb, 'readonly', (s) => s.getAllKeys());
      for (const k of keys || []) {
        const blob = await idbDo(this.idb, 'readonly', (s) => s.get(k));
        if (blob) this.urls.set(k, URL.createObjectURL(blob));
      }
    } catch { this.idb = null; }
    return this;
  }
  col(c) { return (this.data[c] ||= {}); }
  list(c) { return Object.entries(this.col(c)).map(([id, v]) => ({ id, ...clone(v) })); }
  persist() { if (!ls.set('db', this.data)) bus.emit('toast', { text: 'This browser is out of storage space for notes.', tone: 'error' }); }
  notify(c, id) {
    queueMicrotask(() => {
      for (const fn of this.watchers.get(c) || []) fn(this.list(c));
      const v = this.col(c)[id];
      for (const fn of this.watchers.get(`${c}/${id}`) || []) fn(v ? { id, ...clone(v) } : null, { hasPendingWrites: false });
    });
  }
  sub(key, fn, first) {
    if (!this.watchers.has(key)) this.watchers.set(key, new Set());
    this.watchers.get(key).add(fn);
    queueMicrotask(first);
    return () => this.watchers.get(key)?.delete(fn);
  }
  watch(c, onData) { return this.sub(c, onData, () => onData(this.list(c))); }
  watchDoc(c, id, onData) {
    return this.sub(`${c}/${id}`, onData, () => { const v = this.col(c)[id]; onData(v ? { id, ...clone(v) } : null, {}); });
  }
  async get(c, id) { const v = this.col(c)[id]; return v ? { id, ...clone(v) } : null; }
  async set(c, id, data) { this.col(c)[id] = clone(data); this.persist(); this.notify(c, id); }
  async update(c, id, patch) {
    if (!this.col(c)[id]) throw Object.assign(new Error('Missing document'), { code: 'invalid_argument' });
    this.col(c)[id] = { ...this.col(c)[id], ...clone(patch) }; this.persist(); this.notify(c, id);
  }
  async del(c, id) { delete this.col(c)[id]; this.persist(); this.notify(c, id); }
  async query(c, field, value) { return this.list(c).filter((d) => !field || d[field] === value); }
  get canUpload() { return !!this.idb; }
  async upload(blob, type) {
    const id = uid('a');
    await idbDo(this.idb, 'readwrite', (s) => s.put(blob, id));
    this.urls.set(id, URL.createObjectURL(blob));
    return { id, url: this.urls.get(id), sizeBytes: blob.size, contentType: type || blob.type };
  }
  assetUrl(id) { return this.urls.get(id) || ''; }
  async addTranscript(rows) {
    for (const r of rows) { const k = 'tr:' + r.lecture_id; const list = ls.get(k, []); list.push({ t: r.t, text: r.text, slide: r.slide }); ls.set(k, list); }
  }
  async transcript(lectureId) { return ls.get('tr:' + lectureId, []); }
  async fetchAsset(id) {
    const blob = this.idb && await idbDo(this.idb, 'readonly', (s) => s.get(id));
    if (!blob) throw new Error('This slides file is not stored in this browser.');
    return blob.arrayBuffer();
  }
}

// ---------------------------------------------------------------------------
const byLectureOrder = (a, b) =>
  String(a.date || '').localeCompare(String(b.date || '')) ||
  (a.kind === b.kind ? 0 : a.kind === 'lecture' ? -1 : 1) ||
  (a.number || 0) - (b.number || 0) ||
  (a.createdAt || 0) - (b.createdAt || 0);

function abbreviate(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  return words.map((w) => w[0]).join('').slice(0, 4).toUpperCase();
}

export const store = {
  backend: null,
  mode: 'connecting',
  ready: false,
  courses: new Map(),
  lectures: new Map(),
  noteCache: new Map(),
  inflight: 0,
  lastError: null,

  /** backend: a ready SupabaseBackend, or null for this browser only. */
  async init({ sb = null, user = null } = {}) {
    this.backend = sb && user ? new SupabaseBackend(sb, user) : await new LocalBackend().init();
    this.mode = this.backend.name;

    await new Promise((resolve) => {
      let pending = 2;
      const timer = setTimeout(resolve, 8000);
      const once = () => { if (--pending === 0) { clearTimeout(timer); resolve(); } };
      let gotC = false; let gotL = false;
      this.backend.watch('courses', (list) => {
        this.courses = new Map(list.map((c) => [c.id, c]));
        bus.emit('data', 'courses');
        if (!gotC) { gotC = true; once(); }
      }, (e) => this.fail(e));
      this.backend.watch('lectures', (list) => {
        this.lectures = new Map(list.map((l) => [l.id, l]));
        bus.emit('data', 'lectures');
        if (!gotL) { gotL = true; once(); }
      }, (e) => this.fail(e));
    });
    this.ready = true;
    this.emitSync();
  },

  fail(e) {
    this.lastError = e;
    console.warn('[store]', e);
    this.emitSync();
    bus.emit('toast', { text: `Lost the connection to your notes. ${e?.message || ''}`.trim(), tone: 'error' });
  },

  emitSync() {
    const state = this.inflight > 0 ? 'saving' : this.lastError ? 'error' : this.mode === 'local' ? 'local' : 'saved';
    bus.emit('sync', { state, mode: this.mode });
  },

  async write(col, id, op, data) {
    this.inflight++; this.emitSync();
    const run = () => (op === 'set' ? this.backend.set(col, id, data)
      : op === 'update' ? this.backend.update(col, id, data)
        : this.backend.del(col, id));
    try {
      try { await serial(`${col}/${id}`, run); }
      catch (e) {
        if (e?.code !== 'unavailable') throw e;
        await sleep(400 + Math.random() * 600);
        await serial(`${col}/${id}`, run);
      }
      this.lastError = null;
    } catch (e) {
      this.lastError = e;
      throw e;
    } finally {
      this.inflight--; this.emitSync();
    }
  },

  // -- courses ---------------------------------------------------------------
  coursesSorted() {
    return [...this.courses.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.createdAt || 0) - (b.createdAt || 0));
  },
  course(id) { return this.courses.get(id) || null; },

  async createCourse({ name, code, color }) {
    const id = uid('c');
    const doc = { name: name.trim(), code: (code || abbreviate(name)).trim(), color: color || 'teal', order: Date.now(), createdAt: Date.now() };
    this.courses.set(id, { id, ...doc }); bus.emit('data', 'courses');
    await this.write('courses', id, 'set', doc);
    return id;
  },
  async updateCourse(id, patch) {
    const c = this.courses.get(id); if (!c) return;
    this.courses.set(id, { ...c, ...patch }); bus.emit('data', 'courses');
    await this.write('courses', id, 'update', patch);
  },
  async deleteCourse(id) {
    for (const l of this.lecturesOf(id)) await this.deleteLecture(l.id);
    this.courses.delete(id); bus.emit('data', 'courses');
    await this.write('courses', id, 'del');
  },

  // -- lectures --------------------------------------------------------------
  lecture(id) { return this.lectures.get(id) || null; },
  lecturesOf(courseId) { return [...this.lectures.values()].filter((l) => l.courseId === courseId).sort(byLectureOrder); },
  nextNumber(courseId, kind) {
    return Math.max(0, ...this.lecturesOf(courseId).filter((l) => l.kind === kind).map((l) => Number(l.number) || 0)) + 1;
  },
  label(l, short = false) {
    if (!l) return '';
    const k = l.kind === 'tutorial' ? (short ? 'T' : 'Tutorial') : (short ? 'L' : 'Lecture');
    return short ? `${k}${l.number}` : `${k} ${l.number}`;
  },
  async createLecture({ courseId, kind = 'lecture', date, title = '' }) {
    const id = uid('l'); const now = Date.now();
    const doc = {
      courseId, kind, number: this.nextNumber(courseId, kind), title, date: date || todayISO(),
      status: 'live', catchUp: false, decks: [], createdAt: now, updatedAt: now,
    };
    this.lectures.set(id, { id, ...doc }); bus.emit('data', 'lectures');
    await this.write('lectures', id, 'set', doc);
    return id;
  },
  async updateLecture(id, patch) {
    const l = this.lectures.get(id); if (!l) return;
    const p = { ...patch, updatedAt: Date.now() };
    this.lectures.set(id, { ...l, ...p }); bus.emit('data', 'lectures');
    await this.write('lectures', id, 'update', p);
  },
  async deleteLecture(id) {
    this.lectures.delete(id); this.noteCache.delete(id); bus.emit('data', 'lectures');
    ls.del('draft:' + id); ls.del('pos:' + id);
    await this.write('notes', id, 'del');
    await this.write('lectures', id, 'del');
  },

  // -- notes -----------------------------------------------------------------
  loadNote(lectureId) { return this.backend.get('notes', lectureId); },
  watchNote(lectureId, fn) { return this.backend.watchDoc('notes', lectureId, fn); },
  async saveNote(lectureId, courseId, blocks) {
    const doc = { courseId, blocks, updatedAt: Date.now(), writer: SESSION };
    if (JSON.stringify(doc).length > 250000) {
      throw Object.assign(new Error('These notes are too long to save as one lecture. Move part of them into a new lecture.'), { code: 'too_big' });
    }
    await this.write('notes', lectureId, 'set', doc);
    this.noteCache.set(lectureId, { id: lectureId, ...doc });
    bus.emit('note:saved', { lectureId });
    return doc.updatedAt;
  },
  /** All notes for a course (or every course), refreshed from the store. */
  async notesFor(courseId = null) {
    const list = await this.backend.query('notes', courseId ? 'courseId' : null, courseId);
    for (const n of list) this.noteCache.set(n.id, n);
    return list.filter((n) => this.lectures.has(n.id));
  },

  // -- transcript (what was said in the lesson) -----------------------------------
  addTranscript(rows) { return this.backend.addTranscript(rows); },
  transcript(lectureId) { return this.backend.transcript(lectureId); },

  // -- sheets (summaries kept per course) -------------------------------------
  sheet(id) { return this.backend.get('sheets', id); },
  saveSheet(id, data) { return this.write('sheets', id, 'set', { ...data, updatedAt: Date.now() }); },

  // -- assets ----------------------------------------------------------------
  get canUpload() { return !!this.backend?.canUpload; },
  upload(blob, type) { return this.backend.upload(blob, type); },
  assetUrl(id) { return this.backend?.assetUrl(id) || ''; },
  fetchAsset(id) { return this.backend.fetchAsset(id); },
};

// ---------------------------------------------------------------------------
/**
 * One open lecture's notes: autosave with a local safety copy.
 * Every change is written to this browser at once, then saved to the store
 * after a short pause. If the page closes before the save, the local copy is
 * restored the next time the lecture opens.
 */
export class NoteSession {
  constructor(lecture) {
    this.lectureId = lecture.id;
    this.courseId = lecture.courseId;
    this.blocks = [];
    this.dirty = false;
    this.version = 0;
    this.lastRemoteAt = 0;
    this.saving = null;
    this.onRemote = null;
    this.draftTimer = null;
    this.saveTimer = null;
    this.firstDirtyAt = 0;
    this.retryMs = 5000;
  }

  async open() {
    let remote = null;
    try { remote = await store.loadNote(this.lectureId); } catch (e) { console.warn('[notes] load failed', e); }
    const draft = ls.get('draft:' + this.lectureId);
    this.lastRemoteAt = remote?.updatedAt || 0;
    let blocks = remote?.blocks || [];
    let restored = false;
    if (draft && draft.at > this.lastRemoteAt && JSON.stringify(draft.blocks) !== JSON.stringify(blocks)) {
      blocks = draft.blocks; restored = true;
    } else if (draft) {
      ls.del('draft:' + this.lectureId);
    }
    this.blocks = clone(blocks);
    if (restored) { this.dirty = true; this.version++; this.scheduleSave(); }
    this.unwatch = store.watchNote(this.lectureId, (doc, meta) => this.remote(doc, meta));
    return { blocks: this.blocks, restored };
  }

  remote(doc, meta) {
    if (!doc || meta?.hasPendingWrites || doc.writer === SESSION) return;
    if ((doc.updatedAt || 0) <= this.lastRemoteAt) return;
    this.lastRemoteAt = doc.updatedAt;
    if (this.dirty) return; // last writer wins: our pending save will replace it
    this.blocks = clone(doc.blocks || []);
    this.onRemote?.(this.blocks);
  }

  change(blocks) {
    if (this.closed) return;
    this.blocks = blocks;
    this.dirty = true;
    this.version++;
    if (!this.draftTimer) {
      this.draftTimer = setTimeout(() => {
        this.draftTimer = null;
        if (this.dirty) ls.set('draft:' + this.lectureId, { blocks: this.blocks, at: Date.now() });
      }, 400);
    }
    this.scheduleSave();
  }

  scheduleSave(ms = 1200) {
    if (this.failing) return; // a retry is already scheduled and saves the latest blocks
    clearTimeout(this.saveTimer);
    if (!this.firstDirtyAt) this.firstDirtyAt = Date.now();
    const overdue = Date.now() - this.firstDirtyAt > 8000;
    this.saveTimer = setTimeout(() => this.flush(), overdue ? 0 : ms);
  }

  async flush() {
    clearTimeout(this.saveTimer);
    if (this.draftTimer) {
      clearTimeout(this.draftTimer); this.draftTimer = null;
      if (this.dirty) ls.set('draft:' + this.lectureId, { blocks: this.blocks, at: Date.now() });
    }
    if (!this.dirty) return;
    if (this.saving) { this.again = true; return this.saving; }
    const v = this.version;
    const blocks = clone(this.blocks);
    this.saving = (async () => {
      try {
        const at = await store.saveNote(this.lectureId, this.courseId, blocks);
        this.lastRemoteAt = at;
        this.retryMs = 5000;
        this.failing = false;
        this.warned = false;
        if (this.version === v) {
          this.dirty = false; this.firstDirtyAt = 0;
          ls.del('draft:' + this.lectureId);
        }
      } catch (e) {
        if (e?.code === 'too_big') bus.emit('toast', { text: e.message, tone: 'error' });
        else if (!this.warned) {
          this.warned = true;
          bus.emit('toast', { text: 'Notes are kept on this device and will sync when the connection returns.', tone: 'warn' });
        }
        this.again = false;
        this.failing = true;
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => { this.failing = false; this.flush(); }, this.retryMs);
        this.retryMs = Math.min(this.retryMs * 2, 60000);
      } finally {
        this.saving = null;
        if (this.again) { this.again = false; this.scheduleSave(300); }
        else if (this.dirty && this.version !== v) this.scheduleSave();
      }
    })();
    return this.saving;
  }

  close() {
    this.unwatch?.();
    return this.flush();
  }

  /** The lecture is being deleted: stop everything without saving. */
  discard() {
    this.unwatch?.();
    clearTimeout(this.saveTimer); clearTimeout(this.draftTimer);
    this.dirty = false; this.failing = true; this.closed = true;
    ls.del('draft:' + this.lectureId);
  }
}
