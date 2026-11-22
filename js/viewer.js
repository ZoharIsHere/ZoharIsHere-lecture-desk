// viewer.js — the projector pane: a lecture's slide decks (PDF).
// Renders with pdf.js, keeps nearby slides pre-rendered for instant flipping,
// and provides the slide overview, snapshots and slide text extraction.

import { h, icon, ls, clamp, loadScript, debounce } from './util.js';
import { store } from './store.js';
import { toast, showMenu, confirmDialog } from './ui.js';
import { pickRegion, cropToBlob } from './snapshot.js';
import { uploadMessage } from './editor.js';

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
export const MAX_PDF = 20 * 1024 * 1024;

let libP = null;
export function pdfjs() {
  if (!libP) {
    libP = loadScript(PDFJS).then(() => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      return window.pdfjsLib;
    }).catch((e) => { libP = null; throw e; });
  }
  return libP;
}

const docs = new Map();
export function loadPdf(assetId) {
  if (!docs.has(assetId)) {
    const p = (async () => {
      const [lib, buf] = await Promise.all([pdfjs(), store.fetchAsset(assetId)]);
      return lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
    })();
    p.catch(() => docs.delete(assetId));
    docs.set(assetId, p);
  }
  return docs.get(assetId);
}

const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
const letter = (i) => String.fromCharCode(65 + i);

export class SlideViewer {
  /**
   * opts = { lecture, onSlide(at|null), onDecksChange(decks), follow:boolean }
   */
  constructor({ lecture, onSlide, onDecksChange, follow = false }) {
    this.lectureId = lecture.id;
    this.courseId = lecture.courseId;
    this.decks = (lecture.decks || []).map((d) => ({ ...d }));
    const pos = ls.get('pos:' + lecture.id) || {};
    this.deckIdx = Math.max(0, this.decks.findIndex((d) => d.id === pos.d));
    this.page = pos.p || 1;
    this.fit = ls.get('fit', 'page');
    this.zoom = 1;
    this.follow = follow;
    this.onSlide = onSlide;
    this.onDecksChange = onDecksChange;
    this.cache = new Map();
    this.gen = 0;
    this.tok = 0;
    this.canvas = null;
    this.thumbs = new Map();
    this.build();
    this.lastBox = '';
    this.ro = new ResizeObserver(debounce(() => {
      const k = `${this.stage.clientWidth}x${this.stage.clientHeight}`;
      if (k === this.lastBox || !this.stage.clientWidth) return;
      this.lastBox = k;
      this.invalidate();
      this.draw();
    }, 140));
    this.ro.observe(this.stage);
    this.draw();
  }

  // ---- DOM ----------------------------------------------------------------------
  build() {
    this.file = h('input', {
      type: 'file', accept: 'application/pdf,.pdf', multiple: true, hidden: true,
      onchange: () => { this.addFiles([...this.file.files]); this.file.value = ''; },
    });
    this.tabs = h('div', { class: 'proj-tabs' });
    this.frame = h('div', { class: 'proj-frame' });
    this.status = h('div', { class: 'proj-status', hidden: true });
    this.empty = this.buildEmpty();
    this.stage = h('div', { class: 'proj-stage', tabindex: '0', 'aria-label': 'Slide. Use the arrow keys to move between slides.' },
      this.frame, this.empty, this.status);
    this.frame.addEventListener('click', (e) => {
      const r = this.frame.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      if (x < 0.22) this.step(-1); else if (x > 0.78) this.step(1);
    });

    const btn = (name, label, onclick, extra = {}) => h('button', { class: 'pbtn', type: 'button', title: label, 'aria-label': label, onclick, ...extra }, icon(name, 17));
    this.counter = h('input', {
      class: 'proj-num', type: 'text', inputmode: 'numeric', 'aria-label': 'Slide number', value: '–',
      onkeydown: (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this.page = parseInt(this.counter.value, 10) || this.page; this.draw(); this.stage.focus(); }
        if (e.key === 'Escape') { this.counter.blur(); }
      },
      onfocus: () => this.counter.select(),
      onblur: () => this.updateCounter(),
    });
    this.total = h('span', { class: 'proj-total' }, '/ –');
    this.followBtn = btn('link', 'Follow notes: opening a note shows its slide', () => this.setFollow(!this.follow), { 'aria-pressed': String(this.follow) });
    this.fitBtn = btn('fit', 'Fit width', () => this.setFit(this.fit === 'page' ? 'width' : 'page'));
    this.bar = h('div', { class: 'proj-bar', role: 'toolbar', 'aria-label': 'Slide controls' },
      btn('left', 'Previous slide', () => this.step(-1)),
      h('span', { class: 'proj-count' }, this.counter, this.total),
      btn('right', 'Next slide', () => this.step(1)),
      h('span', { class: 'proj-sep' }),
      btn('grid', 'Slide overview (G)', () => this.toggleGrid()),
      this.fitBtn,
      btn('zoomOut', 'Zoom out', () => this.setZoom(this.zoom / 1.25), { class: 'pbtn wide-only' }),
      btn('zoomIn', 'Zoom in', () => this.setZoom(this.zoom * 1.25), { class: 'pbtn wide-only' }),
      h('span', { class: 'proj-sep' }),
      h('button', { class: 'pbtn pbtn-text', type: 'button', title: 'Snapshot part of the slide into your notes (S)', onclick: () => this.onAction?.('snapshot') }, icon('crop', 16), h('span', null, 'Snapshot')),
      h('button', { class: 'pbtn pbtn-text wide-only', type: 'button', title: 'Copy the slide text into your notes', onclick: () => this.onAction?.('slideText') }, icon('lines', 16), h('span', null, 'Slide text')),
      h('span', { class: 'grow' }),
      this.followBtn,
    );
    this.el = h('section', { class: 'proj', 'aria-label': 'Slides' }, this.tabs, this.stage, this.bar, this.file);
    this.el.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); this.el.classList.add('is-drop'); } });
    this.el.addEventListener('dragleave', (e) => { if (!this.el.contains(e.relatedTarget)) this.el.classList.remove('is-drop'); });
    this.el.addEventListener('drop', (e) => {
      this.el.classList.remove('is-drop');
      const files = [...(e.dataTransfer?.files || [])];
      if (!files.length) return;
      e.preventDefault(); e.stopPropagation();
      this.addFiles(files);
    });
    this.updateFitBtn();
  }

  buildEmpty() {
    const reuse = h('button', { class: 'btn btn-ghost-dark', type: 'button', onclick: (e) => this.reuseMenu(e.currentTarget) }, 'Use slides from another lecture');
    const el = h('div', { class: 'proj-empty' },
      h('div', { class: 'proj-empty-mark' }, icon('slides', 28)),
      h('p', { class: 'proj-empty-title' }, 'Add the lecture slides'),
      h('p', { class: 'proj-empty-sub' }, 'Drop a PDF here or choose a file, up to 20 MB. For PowerPoint, save the presentation as PDF first.'),
      h('div', { class: 'proj-empty-actions' },
        h('button', { class: 'btn btn-light', type: 'button', onclick: () => this.pick() }, icon('upload', 16), 'Choose PDF'),
        reuse));
    this.reuseBtn = reuse;
    return el;
  }

  renderTabs() {
    this.tabs.replaceChildren();
    this.decks.forEach((d, i) => {
      const active = i === this.deckIdx;
      const tab = h('button', {
        class: `proj-tab${active ? ' is-active' : ''}`, type: 'button', title: active ? `${d.name} · options` : d.name,
        onclick: (e) => {
          if (!active) { this.deckIdx = i; this.page = 1; this.draw(); return; }
          showMenu(e.currentTarget, [
            { label: 'Add another PDF', icon: 'upload', run: () => this.pick() },
            { label: 'Remove from this lecture', icon: 'trash', danger: true, run: () => this.removeDeck(i) },
          ]);
        },
      }, this.decks.length > 1 ? h('span', { class: 'proj-tab-key' }, letter(i)) : null, h('span', { class: 'proj-tab-name' }, d.name || 'Slides'));
      this.tabs.append(tab);
    });
    if (this.decks.length) {
      this.tabs.append(h('button', { class: 'proj-tab proj-tab-add', type: 'button', title: 'Add slides', 'aria-label': 'Add slides', onclick: (e) => this.addMenu(e.currentTarget) }, icon('plus', 14)));
    }
    this.tabs.hidden = !this.decks.length;
    this.reuseBtn.hidden = !this.otherDecks().length;
  }

  // ---- state ----------------------------------------------------------------------
  get deck() { return this.decks[this.deckIdx] || null; }
  anchor() { return this.deck ? { d: this.deck.id, p: this.page } : null; }
  isOn(at) { return !!(at && this.deck && at.d === this.deck.id && at.p === this.page); }
  label(at) {
    if (!at) return null;
    const i = this.decks.findIndex((d) => d.id === at.d);
    if (i < 0) return '–';
    return this.decks.length > 1 ? `${letter(i)}·${at.p}` : String(at.p);
  }

  setDecks(decks) {
    const next = (decks || []).map((d) => ({ ...d }));
    if (JSON.stringify(next) === JSON.stringify(this.decks)) return;
    const cur = this.deck?.id;
    this.decks = next;
    const i = this.decks.findIndex((d) => d.id === cur);
    this.deckIdx = i >= 0 ? i : clamp(this.deckIdx, 0, Math.max(0, this.decks.length - 1));
    this.draw();
  }

  saveDecks() { this.onDecksChange?.(this.decks.map((d) => ({ ...d }))); }

  setFollow(v) {
    this.follow = v;
    ls.set('follow:' + this.lectureId, v);
    this.followBtn.setAttribute('aria-pressed', String(v));
    toast(v ? 'Opening a note now shows its slide.' : 'Slides stay put when you open a note.');
  }

  setFit(f) { this.fit = f; this.zoom = 1; ls.set('fit', f); this.updateFitBtn(); this.invalidate(); this.draw(); }
  updateFitBtn() {
    const label = this.fit === 'page' ? 'Fit width' : 'Fit whole slide';
    this.fitBtn.title = label; this.fitBtn.setAttribute('aria-label', label);
    this.fitBtn.setAttribute('aria-pressed', String(this.fit === 'width'));
  }
  setZoom(z) { this.zoom = clamp(z, 0.5, 4); this.invalidate(); this.draw(); }
  invalidate() { this.gen++; this.cache.clear(); }

  // ---- navigation ------------------------------------------------------------------
  step(d) {
    const deck = this.deck; if (!deck) return;
    const n = this.page + d;
    const pages = deck.pages || 1;
    if (n < 1) {
      if (this.deckIdx === 0) return this.nudge();
      this.deckIdx--; this.page = this.deck.pages || 1;
    } else if (n > pages) {
      if (this.deckIdx >= this.decks.length - 1) return this.nudge();
      this.deckIdx++; this.page = 1;
    } else this.page = n;
    this.draw();
  }
  first() { if (this.deck) { this.page = 1; this.draw(); } }
  last() { if (this.deck) { this.page = this.deck.pages || 1; this.draw(); } }
  nudge() { this.stage.classList.remove('is-edge'); void this.stage.offsetWidth; this.stage.classList.add('is-edge'); }

  goTo(at, { quiet = false } = {}) {
    if (!at) return;
    const i = this.decks.findIndex((d) => d.id === at.d);
    if (i < 0) { if (!quiet) toast('Those slides were removed from this lecture.', { tone: 'warn' }); return; }
    if (i === this.deckIdx && at.p === this.page) return;
    this.deckIdx = i; this.page = at.p;
    this.draw();
    if (!quiet) { this.stage.classList.remove('is-flash'); void this.stage.offsetWidth; this.stage.classList.add('is-flash'); }
  }

  updateCounter(total) {
    if (total != null) this.totalPages = total;
    if (document.activeElement !== this.counter) this.counter.value = this.deck ? String(this.page) : '–';
    this.total.textContent = `/ ${this.deck ? (this.totalPages || this.deck.pages || '–') : '–'}`;
  }

  setStatus(text, isError = false) {
    this.status.hidden = !text;
    this.status.textContent = text || '';
    this.status.classList.toggle('is-error', !!isError);
  }

  // ---- rendering --------------------------------------------------------------------
  box() {
    return { w: Math.max(120, this.stage.clientWidth - 32), h: Math.max(120, this.stage.clientHeight - 32) };
  }

  async draw() {
    const tok = ++this.tok;
    const deck = this.deck;
    this.renderTabs();
    this.empty.hidden = !!deck;
    this.frame.hidden = !deck;
    this.bar.classList.toggle('is-off', !deck);
    if (!deck) { this.setStatus(null); this.canvas = null; this.updateCounter(0); this.onSlide?.(null); return; }

    const slow = setTimeout(() => { if (tok === this.tok) this.setStatus('Loading slides…'); }, 250);
    let doc;
    try { doc = await loadPdf(deck.id); } catch (e) {
      clearTimeout(slow);
      if (tok === this.tok) this.setStatus(`These slides could not be opened. ${e?.message || ''}`.trim(), true);
      return;
    }
    if (tok !== this.tok) { clearTimeout(slow); return; }
    if (deck.pages !== doc.numPages) { deck.pages = doc.numPages; this.saveDecks(); }
    this.page = clamp(this.page, 1, doc.numPages);
    this.updateCounter(doc.numPages);
    ls.set('pos:' + this.lectureId, { d: deck.id, p: this.page });
    this.onSlide?.(this.anchor());

    let canvas = null;
    try { canvas = await this.rendered(doc, deck.id, this.page); } catch (e) {
      if (e?.name !== 'RenderingCancelledException') console.warn('[slides]', e);
    }
    clearTimeout(slow);
    if (tok !== this.tok || !canvas) return;
    this.setStatus(null);
    if (this.frame.firstChild !== canvas) this.frame.replaceChildren(canvas);
    this.canvas = canvas;
    this.stage.classList.toggle('is-scroll', this.fit === 'width' || this.zoom > 1);
    this.prefetch(doc, deck.id);
  }

  rendered(doc, deckId, n) {
    const key = `${this.gen}:${deckId}:${n}`;
    if (!this.cache.has(key)) {
      const p = this.renderPage(doc, n);
      p.catch(() => this.cache.delete(key));
      this.cache.set(key, p);
      if (this.cache.size > 10) this.cache.delete(this.cache.keys().next().value);
    }
    return this.cache.get(key);
  }

  async renderPage(doc, n) {
    const page = await doc.getPage(n);
    const vp1 = page.getViewport({ scale: 1 });
    const { w, h: hh } = this.box();
    let s = this.fit === 'width' ? w / vp1.width : Math.min(w / vp1.width, hh / vp1.height);
    s = Math.max(0.1, s * this.zoom);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vp = page.getViewport({ scale: s * dpr });
    const c = document.createElement('canvas');
    c.className = 'proj-canvas';
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    c.style.width = Math.floor(vp.width / dpr) + 'px';
    c.style.height = Math.floor(vp.height / dpr) + 'px';
    await page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp }).promise;
    return c;
  }

  prefetch(doc, deckId) {
    const gen = this.gen;
    const pages = [this.page + 1, this.page - 1, this.page + 2].filter((n) => n >= 1 && n <= doc.numPages);
    (async () => {
      for (const n of pages) {
        if (gen !== this.gen) return;
        try { await this.rendered(doc, deckId, n); } catch { /* ignore */ }
      }
    })();
  }

  // ---- overview grid ----------------------------------------------------------------
  async toggleGrid() {
    if (this.grid) { this.closeGrid(); return; }
    const deck = this.deck; if (!deck) return;
    let doc;
    try { doc = await loadPdf(deck.id); } catch { return; }
    const p1 = await doc.getPage(1);
    const v = p1.getViewport({ scale: 1 });
    const list = h('div', { class: 'grid-list' });
    const ov = h('div', { class: 'proj-grid', role: 'dialog', 'aria-label': 'Slide overview', tabindex: '-1' },
      h('div', { class: 'grid-head' },
        h('span', { class: 'grid-title' }, deck.name || 'Slides'),
        h('span', { class: 'grid-count' }, `${doc.numPages} slides`),
        h('button', { class: 'pbtn', type: 'button', 'aria-label': 'Close overview', onclick: () => this.closeGrid() }, icon('x', 17))),
      list);
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        io.unobserve(en.target);
        this.thumb(doc, deck.id, Number(en.target.dataset.page), en.target.querySelector('.thumb-img'));
      }
    }, { root: list, rootMargin: '300px' });
    for (let i = 1; i <= doc.numPages; i++) {
      const b = h('button', {
        class: `thumb${i === this.page ? ' is-current' : ''}`, type: 'button', 'data-page': String(i), 'aria-label': `Slide ${i}`,
        onclick: () => { this.page = i; this.closeGrid(); this.draw(); },
      }, h('span', { class: 'thumb-img', style: { aspectRatio: `${v.width} / ${v.height}` } }), h('span', { class: 'thumb-n' }, String(i)));
      list.append(b);
      io.observe(b);
    }
    ov.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'g' || e.key === 'G') { e.preventDefault(); e.stopPropagation(); this.closeGrid(); }
    });
    this.stage.append(ov);
    this.grid = { ov, io };
    ov.focus();
    list.querySelector('.is-current')?.scrollIntoView({ block: 'center' });
  }

  closeGrid() {
    if (!this.grid) return;
    this.grid.io.disconnect(); this.grid.ov.remove(); this.grid = null;
    this.stage.focus();
  }

  async thumb(doc, deckId, n, holder) {
    const key = `${deckId}:${n}`;
    let c = this.thumbs.get(key);
    if (!c) {
      const page = await doc.getPage(n);
      const v = page.getViewport({ scale: 1 });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale: (200 / v.width) * dpr });
      c = document.createElement('canvas');
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      await page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp }).promise;
      this.thumbs.set(key, c);
    }
    holder.replaceChildren(c);
  }

  // ---- decks -----------------------------------------------------------------------
  pick() { this.file.click(); }

  otherDecks() {
    const seen = new Set(this.decks.map((d) => d.id));
    const out = [];
    for (const l of store.lecturesOf(this.courseId)) {
      if (l.id === this.lectureId) continue;
      for (const d of l.decks || []) {
        if (seen.has(d.id)) continue;
        seen.add(d.id); out.push({ deck: d, lecture: l });
      }
    }
    return out.reverse();
  }

  addMenu(anchor) {
    const items = [{ label: 'Upload a PDF', icon: 'upload', run: () => this.pick() }];
    const others = this.otherDecks();
    if (others.length) items.push('-', { heading: 'From another lecture' });
    for (const o of others.slice(0, 10)) items.push({ label: `${store.label(o.lecture, true)} · ${o.deck.name}`, icon: 'slides', run: () => this.attach(o.deck) });
    showMenu(anchor, items);
  }

  reuseMenu(anchor) {
    const others = this.otherDecks();
    if (!others.length) return;
    showMenu(anchor, others.slice(0, 12).map((o) => ({ label: `${store.label(o.lecture, true)} · ${o.deck.name}`, icon: 'slides', run: () => this.attach(o.deck) })));
  }

  attach(deck) {
    this.decks.push({ ...deck });
    this.deckIdx = this.decks.length - 1;
    this.page = 1;
    this.saveDecks();
    this.draw();
  }

  async removeDeck(i) {
    const d = this.decks[i]; if (!d) return;
    const ok = await confirmDialog({
      title: 'Remove these slides?',
      description: `“${d.name}” will be removed from this lecture. Your notes stay, but their slide numbers for this file will show as “–”.`,
      confirm: 'Remove slides',
    });
    if (!ok) return;
    this.decks.splice(i, 1);
    this.deckIdx = clamp(this.deckIdx >= i ? this.deckIdx - 1 : this.deckIdx, 0, Math.max(0, this.decks.length - 1));
    this.page = 1;
    this.saveDecks();
    this.draw();
  }

  async addFiles(files) {
    for (const f of files) {
      if (!isPdf(f)) {
        if (/\.(pptx?|key|odp)$/i.test(f.name)) {
          toast('Presentation files can’t be shown directly. Save it as PDF (File › Save as › PDF), then add the PDF.', { tone: 'warn', ms: 8000 });
        } else toast(`“${f.name}” isn’t a PDF.`, { tone: 'warn' });
        continue;
      }
      if (f.size > MAX_PDF) {
        toast(`“${f.name}” is ${(f.size / 1048576).toFixed(1)} MB. The limit is 20 MB, so compress or split the PDF and add it again.`, { tone: 'error', ms: 9000 });
        continue;
      }
      if (!store.canUpload) { toast('Slides can’t be stored in this browser.', { tone: 'error' }); return; }
      this.setStatus(`Adding “${f.name}”…`);
      try {
        const lib = await pdfjs();
        const buf = new Uint8Array(await f.arrayBuffer());
        const doc = await lib.getDocument({ data: buf, isEvalSupported: false }).promise;
        const res = await store.upload(f, 'application/pdf');
        docs.set(res.id, Promise.resolve(doc));
        this.decks.push({ id: res.id, name: f.name.replace(/\.pdf$/i, ''), pages: doc.numPages });
        this.deckIdx = this.decks.length - 1;
        this.page = 1;
        this.saveDecks();
        this.setStatus(null);
        this.draw();
      } catch (e) {
        this.setStatus(null);
        const msg = e?.name === 'InvalidPDFException' ? `“${f.name}” is damaged or not a real PDF.` : uploadMessage(e, 'PDF');
        toast(msg, { tone: 'error', ms: 7000 });
      }
    }
  }

  // ---- capture -----------------------------------------------------------------------
  async snapshot() {
    const deck = this.deck;
    if (!deck || !this.canvas) { toast('Add slides first, then take a snapshot.'); return null; }
    if (this.grid) this.closeGrid();
    const region = await pickRegion(this.canvas);
    if (!region) return null;
    const doc = await loadPdf(deck.id);
    const page = await doc.getPage(this.page);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = clamp(1600 / (vp1.width * region.w), 1.5, 4);
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    await page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp }).promise;
    const out = await cropToBlob(c, region);
    return { ...out, at: { d: deck.id, p: this.page } };
  }

  /** The current slide's text as lines (best effort; reading order follows the layout). */
  async slideText() {
    const deck = this.deck; if (!deck) return null;
    const page = await (await loadPdf(deck.id)).getPage(this.page);
    const tc = await page.getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4]; const y = it.transform[5];
      const ht = it.height || Math.hypot(it.transform[2], it.transform[3]) || 10;
      let row = rows.find((r) => Math.abs(r.y - y) < ht * 0.55);
      if (!row) { row = { y, h: ht, items: [] }; rows.push(row); }
      row.items.push({ x, w: it.width || 0, str: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    // Drop a trailing slide number ("12") at the bottom of the slide.
    const lastRow = rows.at(-1);
    if (rows.length > 1 && lastRow && /^\d{1,3}$/.test(lastRow.items.map((i) => i.str).join('').trim())) rows.pop();
    const minX = Math.min(...rows.map((r) => Math.min(...r.items.map((i) => i.x))));
    return rows.map((r) => {
      const heb = r.items.filter((i) => /[֐-׿]/.test(i.str)).length > r.items.length / 2;
      r.items.sort((a, b) => (heb ? b.x - a.x : a.x - b.x));
      let s = ''; let end = null;
      for (const i of r.items) {
        if (s && !s.endsWith(' ') && (heb || end === null || i.x - end > r.h * 0.15)) s += ' ';
        s += i.str; end = i.x + i.w;
      }
      s = s.replace(/\s+/g, ' ').trim();
      if (heb || !s) return s;
      // Keep indentation (matters for code on slides).
      const chars = r.items.reduce((n, i) => n + i.str.length, 0);
      const charW = chars ? r.items.reduce((n, i) => n + i.w, 0) / chars : r.h * 0.6;
      const indent = Math.max(0, Math.round((Math.min(...r.items.map((i) => i.x)) - minX) / Math.max(1, charW)));
      return ' '.repeat(Math.min(indent, 40)) + s;
    }).filter((s) => s.trim());
  }

  destroy() {
    this.ro.disconnect();
    this.closeGrid();
    this.tok++;
  }
}
