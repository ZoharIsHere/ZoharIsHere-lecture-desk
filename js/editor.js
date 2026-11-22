// editor.js — the notebook sheet: a list of Markdown blocks, each anchored
// to the slide that was showing when it was written. One block is edited at
// a time (as a textarea); every other block is shown rendered.
//
// The editor knows nothing about PDFs or storage. The lecture view passes a
// ctx object with the hooks it needs (see constructor).

import { h, icon, uid, detectDir } from './util.js';
import { registry } from './registry.js';
import { renderMarkdown, postRender, toggleTask } from './markdown.js';
import { showMenu, toast } from './ui.js';
import { store } from './store.js';

const CARET = '‸';
const countFences = (s) => (s.match(/^\s*```/gm) || []).length;
const lastLine = (s) => s.slice(s.lastIndexOf('\n') + 1);
const firstLine = (s) => s.split('\n')[0];
/** Empty, or only a list marker like "- " or "1. [ ] ". */
const isBlank = (md) => !String(md || '').replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '').trim();

export const newBlock = (type = 'text', md = '', at = null) => ({ id: uid('b'), type, md, at });

export class BlockEditor {
  /**
   * ctx = {
   *   anchorNow(): {d,p}|null       current slide
   *   anchorLabel(at): string|null  "14" or "B·14"
   *   isOnSlide(at): boolean        is this the slide on screen
   *   goTo(at)                      show that slide
   *   follow(): boolean             jump slides when a block is opened
   *   slideStep(delta)              flip slides while typing
   *   action(name, blockId)         'snapshot' | 'slideText'
   *   openTag(name)                 search a #tag
   *   onChange(blocks)              persist
   *   onEscape()                    editing stopped with Esc
   * }
   */
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.blocks = [];
    this.nodes = new Map();
    this.pending = new Map(); // image block id -> object URL while uploading
    this.editing = null;
    this.ta = null;
    this.lastId = null;
    this.suppressBlur = false;

    this.sheet = h('div', { class: 'sheet', role: 'list', 'aria-label': 'Notes' });
    this.tail = h('button', { class: 'sheet-tail', type: 'button', onclick: () => this.appendAndEdit() },
      h('span', null, 'Continue writing'), h('kbd', null, 'N'));
    root.append(this.sheet, this.tail);
    this.slash = new SlashMenu(this);

    this.sheet.addEventListener('click', (e) => this.onClick(e));
    this.sheet.addEventListener('dragover', (e) => {
      if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault();
    });
    this.sheet.addEventListener('drop', (e) => {
      const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault(); e.stopPropagation();
      const after = e.target.closest?.('.blk')?.dataset.id || this.blocks.at(-1)?.id;
      files.forEach((f) => this.addImage(f, { afterId: after }));
    });
  }

  // ---- data -------------------------------------------------------------------
  find(id) { return this.blocks.find((b) => b.id === id) || null; }
  index(id) { return this.blocks.findIndex((b) => b.id === id); }
  neighbor(id, d) { return this.blocks[this.index(id) + d] || null; }

  /** Blocks as saved: images still uploading are left out. */
  serialize() {
    return this.blocks
      .filter((b) => !(b.type === 'image' && !b.img?.asset))
      .map((b) => {
        const o = { id: b.id, type: b.type || 'text', md: b.md || '', at: b.at || null };
        if (b.done) o.done = true;
        if (b.auto) o.auto = true;
        if (b.img) o.img = b.img;
        return o;
      });
  }

  changed() { this.ctx.onChange?.(this.serialize()); }

  setBlocks(blocks, { keepEditing = false } = {}) {
    const editingId = this.editing;
    let caret = null;
    if (this.ta) caret = this.ta.selectionStart;
    if (this.editing) { this.ta?.remove(); this.ta = null; this.editing = null; this.slash.close(); }
    this.blocks = (blocks || []).map((b) => ({ ...b, at: b.at ? { ...b.at } : null, img: b.img ? { ...b.img } : undefined }));
    if (!this.blocks.length) this.blocks.push(newBlock('text', '', this.ctx.anchorNow()));
    this.renderAll();
    if (keepEditing && editingId && this.find(editingId)) this.edit(editingId, caret ?? 'end');
  }

  // ---- rendering --------------------------------------------------------------
  renderAll() {
    this.nodes.clear();
    this.sheet.replaceChildren(...this.blocks.map((b) => this.buildNode(b)));
    this.refreshMargins();
  }

  buildNode(b) {
    const type = registry.blockType(b.type);
    const node = h('div', { class: `blk${b.auto ? ' is-auto' : ''}`, role: 'listitem', 'data-id': b.id, 'data-type': b.type || 'text', 'data-tone': type.tone || null });
    const margin = h('div', { class: 'blk-margin' });
    const main = h('div', { class: 'blk-main' });
    const body = h('div', { class: 'blk-body' });
    const view = h('div', { class: 'blk-view md' });
    if (type.checkable) {
      main.append(h('button', {
        class: 'blk-check', type: 'button', 'aria-pressed': String(!!b.done),
        title: b.done ? 'Answered. Click to reopen' : 'Open question. Click when answered',
        onclick: (e) => { e.stopPropagation(); this.toggleDone(b.id); },
      }, b.done ? icon('check', 13) : '?'));
    } else if (type.tag) {
      main.append(h('span', { class: 'blk-label', 'aria-hidden': 'true' }, type.tag));
    }
    if (type.media) body.append(this.buildFigure(b));
    body.append(view);
    main.append(body);
    const handle = h('button', {
      class: 'blk-handle', type: 'button', 'aria-label': 'Block options', title: 'Block options',
      onclick: (e) => { e.stopPropagation(); this.blockMenu(b.id, handle); },
    }, icon('more', 16));
    node.append(margin, main, handle);
    const rec = { id: b.id, node, margin, main, body, view };
    this.nodes.set(b.id, rec);
    this.paint(rec);
    return node;
  }

  buildFigure(b) {
    const src = this.pending.get(b.id) || (b.img?.asset ? store.assetUrl(b.img.asset) : '');
    const img = h('img', { src: src || null, 'data-asset': b.img?.asset || null, alt: b.md || 'Slide snapshot', width: b.img?.w || null, height: b.img?.h || null, draggable: 'false' });
    const fig = h('figure', { class: `blk-fig${this.pending.has(b.id) ? ' is-uploading' : ''}` }, img);
    img.addEventListener('error', () => { if (img.getAttribute('src')) fig.classList.add('is-broken'); });
    return fig;
  }

  paint(rec) {
    const b = this.find(rec.id); if (!b) return;
    const dir = this.dirOf(b);
    rec.main.dir = dir;
    const md = b.md || '';
    rec.view.innerHTML = md.trim() ? renderMarkdown(md) : '';
    rec.view.classList.toggle('is-empty', !md.trim());
    if (!md.trim() && this.blocks.length === 1) rec.view.dataset.placeholder = 'Start writing. Type / for definitions, code, math and diagrams.';
    else delete rec.view.dataset.placeholder;
    rec.node.classList.toggle('is-done', !!b.done);
    if (md.trim()) postRender(rec.view, dir);
  }

  /** Paragraph direction; empty blocks follow the block above. */
  dirOf(b) {
    if (b.md && b.md.trim()) return detectDir(b.md);
    for (let i = this.index(b.id) - 1; i >= 0; i--) {
      const p = this.blocks[i];
      if (p.md && p.md.trim()) return detectDir(p.md);
    }
    return 'ltr';
  }

  /** Slide numbers in the margin: shown where the slide changes. */
  refreshMargins() {
    let prevKey = null;
    for (const b of this.blocks) {
      const rec = this.nodes.get(b.id); if (!rec) continue;
      const key = b.at ? `${b.at.d}:${b.at.p}` : null;
      const label = b.at ? this.ctx.anchorLabel(b.at) : null;
      rec.margin.replaceChildren();
      if (label && key !== prevKey) {
        rec.margin.append(h('button', {
          class: 'anchor', type: 'button', title: `Show slide ${label}`,
          onclick: (e) => { e.stopPropagation(); this.ctx.goTo(b.at); },
        }, label));
      }
      rec.node.classList.toggle('is-cont', !!key && key === prevKey);
      rec.node.classList.toggle('on-slide', !!b.at && this.ctx.isOnSlide(b.at));
      prevKey = key;
    }
  }

  /** The slide on screen changed. Empty blocks re-anchor to it. */
  onSlideChange(at) {
    const b = this.editing && this.find(this.editing);
    if (b && isBlank(b.md) && b.type !== 'image') b.at = at;
    this.refreshMargins();
  }

  rebuild(id) {
    const rec = this.nodes.get(id); if (!rec) return;
    const b = this.find(id);
    const wasEditing = this.editing === id && this.ta;
    const ta = this.ta;
    const sel = wasEditing ? [ta.selectionStart, ta.selectionEnd] : null;
    this.suppressBlur = true;
    const node = this.buildNode(b);
    rec.node.replaceWith(node);
    if (wasEditing) {
      const nrec = this.nodes.get(id);
      nrec.view.hidden = true;
      nrec.body.append(ta);
      nrec.node.classList.add('is-editing');
      ta.placeholder = this.placeholderFor(b);
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(sel[0], sel[1]);
      this.autosize();
    }
    this.suppressBlur = false;
    this.refreshMargins();
  }

  // ---- editing ----------------------------------------------------------------
  placeholderFor(b) {
    const t = registry.blockType(b.type);
    if (t.placeholder) return t.placeholder;
    return this.blocks.length === 1 ? 'Start writing. Type / for definitions, code, math and diagrams.' : 'Type / for blocks';
  }

  edit(id, caret = 'end') {
    const b = this.find(id); if (!b) return;
    if (this.editing === id && this.ta) { this.ta.focus(); this.setCaret(caret); return; }
    if (this.editing) this.commit();
    const rec = this.nodes.get(id); if (!rec) return;
    const ta = h('textarea', { class: 'blk-src', rows: '1', spellcheck: 'true', 'aria-label': `${registry.blockType(b.type).label} block` });
    ta.value = b.md || '';
    ta.placeholder = this.placeholderFor(b);
    ta.dir = this.dirOf(b);
    ta.classList.toggle('is-code', /^\s*```/m.test(ta.value));
    rec.view.hidden = true;
    rec.body.append(ta);
    rec.node.classList.add('is-editing');
    this.editing = id;
    this.ta = ta;
    ta.addEventListener('input', () => this.onInput());
    ta.addEventListener('keydown', (e) => this.onKey(e));
    ta.addEventListener('blur', () => this.onBlur());
    ta.addEventListener('paste', (e) => this.onPaste(e));
    ta.addEventListener('click', () => this.slash.sync());
    this.autosize();
    ta.focus({ preventScroll: true });
    this.setCaret(caret);
    rec.node.scrollIntoView({ block: 'nearest' });
    if (b.at && this.ctx.follow()) this.ctx.goTo(b.at, { quiet: true });
  }

  setCaret(c) {
    const ta = this.ta; if (!ta) return;
    const n = c === 'end' ? ta.value.length : c === 'start' ? 0 : Math.max(0, Math.min(ta.value.length, c));
    ta.setSelectionRange(n, n);
  }

  commit() {
    const id = this.editing; if (!id) return;
    const rec = this.nodes.get(id);
    this.ta?.remove();
    this.editing = null; this.ta = null; this.lastId = id;
    this.slash.close();
    if (rec) { rec.node.classList.remove('is-editing'); rec.view.hidden = false; }
    const b = this.find(id);
    if (b && isBlank(b.md) && b.type !== 'image' && this.blocks.length > 1) {
      this.removeBlock(id);
      return;
    }
    if (b) {
      for (const p of registry.prefixes) {
        const m = (b.md || '').match(p.match);
        if (m && (!p.types || p.types.includes(b.type || 'text'))) {
          b.md = b.md.slice(m[0].length);
          if (p.type) b.type = p.type;
          this.rebuild(b.id);
          this.changed();
          return;
        }
      }
    }
    if (rec && b) this.paint(rec);
  }

  /** Stop editing (keeps everything saved). */
  blur() { if (this.editing) this.commit(); }

  onBlur() {
    if (this.suppressBlur) return;
    setTimeout(() => {
      if (!this.ta || this.suppressBlur) return;
      const a = document.activeElement;
      if (a === this.ta) return;
      if (this.slash.el && this.slash.el.contains(a)) return;
      this.commit();
    }, 0);
  }

  autosize() {
    const ta = this.ta; if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  onInput() {
    const b = this.find(this.editing); if (!b || !this.ta) return;
    const wasEmpty = isBlank(b.md);
    b.md = this.ta.value;
    if (wasEmpty && !isBlank(b.md) && b.type !== 'image') {
      const now = this.ctx.anchorNow();
      if (now) b.at = now;
      this.refreshMargins();
    }
    this.ta.dir = this.dirOf(b);
    this.ta.classList.toggle('is-code', /^\s*```/m.test(b.md));
    this.nodes.get(b.id).main.dir = this.ta.dir;
    this.autosize();
    this.slash.sync();
    this.changed();
  }

  /** Replace [s,t) with text; "‸" in text marks the caret. Keeps native undo. */
  replaceRange(s, t, text) {
    const ta = this.ta; if (!ta) return;
    const caret = text.indexOf(CARET);
    const clean = text.replace(CARET, '');
    ta.focus();
    ta.setSelectionRange(s, t);
    let ok = false;
    try { ok = document.execCommand('insertText', false, clean); } catch { ok = false; }
    if (!ok || ta.value.slice(s, s + clean.length) !== clean) {
      ta.setRangeText(clean, s, t, 'end');
      this.onInput();
    }
    if (caret >= 0) ta.setSelectionRange(s + caret, s + caret);
    this.autosize();
  }

  wrap(mark) {
    const ta = this.ta; const s = ta.selectionStart; const t = ta.selectionEnd;
    const sel = ta.value.slice(s, t);
    if (sel && sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= mark.length * 2) {
      this.replaceRange(s, t, sel.slice(mark.length, sel.length - mark.length) + CARET);
    } else {
      this.replaceRange(s, t, sel ? mark + sel + mark + CARET : mark + CARET + mark);
    }
  }

  setLinePrefix(prefix) {
    const ta = this.ta; const v = ta.value; const s = ta.selectionStart;
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    const le0 = v.indexOf('\n', s);
    const le = le0 < 0 ? v.length : le0;
    const line = v.slice(ls, le);
    const rest = line.replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+|>\s+)/, '');
    this.replaceRange(ls, le, prefix + rest + CARET);
  }

  indent(out) {
    const ta = this.ta; const v = ta.value;
    const s = ta.selectionStart; const t = ta.selectionEnd;
    const unit = countFences(v.slice(0, s)) % 2 ? '    ' : '  ';
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    const le0 = v.indexOf('\n', Math.max(t - 1, s));
    const le = le0 < 0 ? v.length : le0;
    const lines = v.slice(ls, le).split('\n');
    let delta0 = 0; let total = 0;
    const next = lines.map((l, i) => {
      if (out) {
        const m = l.match(new RegExp(`^ {1,${unit.length}}`));
        const n = m ? m[0].length : 0;
        if (i === 0) delta0 = -n; total -= n;
        return l.slice(n);
      }
      if (i === 0) delta0 = unit.length; total += unit.length;
      return unit + l;
    }).join('\n');
    this.replaceRange(ls, le, next);
    const ns = Math.max(ls, s + delta0);
    ta.setSelectionRange(ns, Math.max(ns, t + total));
  }

  // ---- keys -------------------------------------------------------------------
  onKey(e) {
    if (this.slash.open && this.slash.key(e)) return;
    const ta = this.ta; const b = this.find(this.editing); if (!ta || !b) return;
    const v = ta.value; const s = ta.selectionStart; const t = ta.selectionEnd;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;

    if ((e.altKey && !e.shiftKey && !mod && (k === 'ArrowUp' || k === 'ArrowDown')) || k === 'PageUp' || k === 'PageDown') {
      e.preventDefault();
      this.ctx.slideStep(k === 'ArrowDown' || k === 'PageDown' ? 1 : -1);
      return;
    }
    if (e.altKey && e.shiftKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
      e.preventDefault(); this.move(b.id, k === 'ArrowUp' ? -1 : 1); return;
    }
    if (mod && !e.altKey && !e.shiftKey) {
      const mark = { b: '**', i: '*', e: '`', m: '$' }[k.toLowerCase()];
      if (mark) { e.preventDefault(); this.wrap(mark); return; }
    }
    if (k === 'Escape') { e.preventDefault(); this.commit(); this.ctx.onEscape?.(); return; }
    if (k === 'Enter' && !e.isComposing) { if (this.onEnter(e, b)) e.preventDefault(); return; }
    if (k === 'Tab' && !mod) { e.preventDefault(); this.indent(e.shiftKey); return; }
    if (k === 'Backspace' && s === 0 && t === 0) { if (this.backspaceAtStart(b)) e.preventDefault(); return; }
    if (k === 'Delete' && s === v.length && t === s) { if (this.mergeNext(b)) e.preventDefault(); return; }

    const oneRow = ta.scrollHeight <= parseFloat(getComputedStyle(ta).lineHeight || '24') * 1.7;
    if (k === 'ArrowUp' && !e.shiftKey && !e.altKey && !mod && s === t && (s === 0 || (oneRow && !v.slice(0, s).includes('\n')))) {
      const p = this.neighbor(b.id, -1);
      if (p) { e.preventDefault(); this.edit(p.id, 'end'); }
      return;
    }
    if (k === 'ArrowDown' && !e.shiftKey && !e.altKey && !mod && s === t && (s === v.length || (oneRow && !v.slice(s).includes('\n')))) {
      const n = this.neighbor(b.id, 1);
      if (n) { e.preventDefault(); this.edit(n.id, 'start'); }
    }
  }

  /** Returns true when Enter was handled here (so no newline is typed). */
  onEnter(e, b) {
    const ta = this.ta; const v = ta.value; const s = ta.selectionStart; const t = ta.selectionEnd;
    const before = v.slice(0, s); const after = v.slice(t);
    if (e.shiftKey) return false;
    // Ctrl/⌘ Enter: finish this block (even inside code) and start a new one below.
    if (e.ctrlKey || e.metaKey) {
      const nb = this.insertAfter(b.id, newBlock('text', '', this.ctx.anchorNow()));
      this.edit(nb.id, 0);
      this.changed();
      return true;
    }

    // Inside a code fence: newline with indentation; auto-close a fresh fence.
    if (countFences(before) % 2 === 1) {
      const line = lastLine(before);
      if (/^\s*```[\w+#.-]*\s*$/.test(line) && countFences(after) === 0) {
        this.replaceRange(s, t, '\n' + CARET + '\n```');
        return true;
      }
      const indent = (line.match(/^\s*/)?.[0] || '') + (/[{([]\s*$/.test(line) ? '    ' : '');
      this.replaceRange(s, t, '\n' + indent + CARET);
      return true;
    }
    // Inside $$ … $$
    if ((before.match(/\$\$/g) || []).length % 2 === 1) {
      if (/^\s*\$\$\s*$/.test(lastLine(before)) && !(after.match(/\$\$/g) || []).length) {
        this.replaceRange(s, t, '\n' + CARET + '\n$$');
        return true;
      }
      return false;
    }
    // Lists continue in the next block; an empty item ends the list.
    const line = lastLine(before);
    const m = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?/.exec(line);
    if (m) {
      const itemText = line.slice(m[0].length) + firstLine(after);
      if (!itemText.trim()) {
        const lineStart = s - line.length;
        this.replaceRange(lineStart, s, '');
        if (lineStart > 0 && !this.ta.value.slice(lineStart).trim()) {
          // drop the trailing newline and start a fresh block
          const v2 = this.ta.value;
          this.replaceRange(lineStart - 1, v2.length, '');
          this.split(b, this.ta.value, '', 'text');
        }
        return true;
      }
      let marker = m[2];
      if (/^\d/.test(marker)) marker = (parseInt(marker, 10) + 1) + marker.replace(/^\d+/, '');
      this.split(b, before, after, b.type === 'image' ? 'text' : b.type, m[1] + marker + m[3] + (m[4] ? '[ ] ' : ''));
      return true;
    }
    // Enter at the very start of a block: open space above it.
    if (!before.trim() && after.trim()) {
      const nb = newBlock('text', '', b.at);
      this.insertBefore(b.id, nb);
      this.changed();
      return true;
    }
    const type = b.type === 'image' ? 'text' : (after.trim() ? b.type : 'text');
    this.split(b, before, after, type);
    return true;
  }

  split(b, before, after, type, prefix = '') {
    b.md = before;
    if (this.ta && this.editing === b.id) { this.ta.value = before; }
    const at = after.trim() ? b.at : (this.ctx.anchorNow() || null);
    const nb = newBlock(type, prefix + after.replace(/^[ \t]*\n?/, ''), at);
    this.insertAfter(b.id, nb);
    this.edit(nb.id, prefix.length);
    this.changed();
  }

  backspaceAtStart(b) {
    const type = registry.blockType(b.type);
    if (type.media) return false;
    if (b.type !== 'text') { this.setType(b, 'text'); return true; }
    const prev = this.neighbor(b.id, -1);
    if (!prev) return false;
    if (registry.blockType(prev.type).media) {
      if (!b.md) { this.removeBlock(b.id); this.edit(prev.id, 'end'); return true; }
      return false;
    }
    const pos = (prev.md || '').length;
    prev.md = (prev.md || '') + (b.md || '');
    this.removeBlock(b.id);
    this.paint(this.nodes.get(prev.id));
    this.edit(prev.id, pos);
    this.changed();
    return true;
  }

  mergeNext(b) {
    const next = this.neighbor(b.id, 1);
    if (!next || registry.blockType(next.type).media || registry.blockType(b.type).media) return false;
    const pos = (b.md || '').length;
    b.md = (b.md || '') + (next.md || '');
    this.removeBlock(next.id);
    this.ta.value = b.md;
    this.setCaret(pos);
    this.autosize();
    this.changed();
    return true;
  }

  onPaste(e) {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      e.preventDefault();
      files.forEach((f) => this.addImage(f, { afterId: this.editing }));
      return;
    }
    const text = e.clipboardData?.getData('text/plain') || '';
    const ta = this.ta;
    if (!/\n[ \t]*\n/.test(text) || text.includes('```') || countFences(ta.value.slice(0, ta.selectionStart)) % 2) return;
    e.preventDefault();
    const parts = text.replace(/\r/g, '').split(/\n[ \t]*\n/).map((p) => p.trim()).filter(Boolean);
    const b = this.find(this.editing);
    this.replaceRange(ta.selectionStart, ta.selectionEnd, parts[0] + CARET);
    let prevId = b.id;
    let lastId = b.id;
    for (const p of parts.slice(1)) {
      const nb = newBlock('text', p, b.at);
      this.insertAfter(prevId, nb);
      prevId = lastId = nb.id;
    }
    this.changed();
    if (lastId !== b.id) this.edit(lastId, 'end');
  }

  // ---- structure ----------------------------------------------------------------
  insertAfter(id, nb) {
    const i = id ? this.index(id) : this.blocks.length - 1;
    this.blocks.splice(i + 1, 0, nb);
    const node = this.buildNode(nb);
    const ref = id && this.nodes.get(id)?.node;
    if (ref) ref.after(node); else this.sheet.append(node);
    this.refreshMargins();
    return nb;
  }

  insertBefore(id, nb) {
    const i = this.index(id);
    this.blocks.splice(i, 0, nb);
    this.nodes.get(id).node.before(this.buildNode(nb));
    this.refreshMargins();
    return nb;
  }

  removeBlock(id) {
    const i = this.index(id); if (i < 0) return;
    if (this.editing === id) { this.ta?.remove(); this.ta = null; this.editing = null; this.slash.close(); }
    this.blocks.splice(i, 1);
    this.nodes.get(id)?.node.remove();
    this.nodes.delete(id);
    if (this.pending.has(id)) { URL.revokeObjectURL(this.pending.get(id)); this.pending.delete(id); }
    if (!this.blocks.length) {
      const nb = newBlock('text', '', this.ctx.anchorNow());
      this.blocks.push(nb);
      this.sheet.append(this.buildNode(nb));
    }
    this.refreshMargins();
    this.changed();
  }

  deleteWithUndo(id) {
    const i = this.index(id); const b = this.find(id); if (!b) return;
    const copy = JSON.parse(JSON.stringify(b));
    this.removeBlock(id);
    toast('Block deleted.', {
      action: {
        label: 'Undo',
        run: () => {
          const prev = this.blocks[i - 1];
          if (prev) this.insertAfter(prev.id, copy);
          else { this.blocks.unshift(copy); this.sheet.prepend(this.buildNode(copy)); this.refreshMargins(); }
          this.changed();
        },
      },
    });
  }

  move(id, d) {
    const i = this.index(id); const j = i + d;
    if (j < 0 || j >= this.blocks.length) return;
    [this.blocks[i], this.blocks[j]] = [this.blocks[j], this.blocks[i]];
    const node = this.nodes.get(id).node;
    const other = this.nodes.get(this.blocks[i].id).node;
    const ta = this.ta; const sel = ta ? [ta.selectionStart, ta.selectionEnd] : null;
    this.suppressBlur = true;
    if (d < 0) other.before(node); else other.after(node);
    if (ta && this.editing === id) { ta.focus({ preventScroll: true }); ta.setSelectionRange(sel[0], sel[1]); }
    this.suppressBlur = false;
    node.scrollIntoView({ block: 'nearest' });
    this.refreshMargins();
    this.changed();
  }

  setType(b, type) {
    if (b.type === type) return;
    b.type = type;
    if (type !== 'question') delete b.done;
    this.rebuild(b.id);
    this.changed();
  }

  toggleDone(id) {
    const b = this.find(id); if (!b) return;
    b.done = !b.done;
    this.rebuild(id);
    this.changed();
  }

  appendAndEdit() {
    const last = this.blocks.at(-1);
    if (last && !(last.md || '').trim() && last.type === 'text') { this.edit(last.id, 'end'); return; }
    const nb = newBlock('text', '', this.ctx.anchorNow());
    this.insertAfter(last?.id || null, nb);
    this.edit(nb.id, 'end');
  }

  focusBlock(id) {
    const rec = this.nodes.get(id); if (!rec) return false;
    rec.node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    rec.node.classList.remove('flash');
    void rec.node.offsetWidth;
    rec.node.classList.add('flash');
    setTimeout(() => rec.node.classList.remove('flash'), 1800);
    const b = this.find(id);
    if (b?.at) this.ctx.goTo(b.at, { quiet: true });
    return true;
  }

  /** Where new material (snapshots, slide text) is inserted. */
  insertionPoint() {
    for (const id of [this.editing, this.lastId]) if (id && this.find(id)) return id;
    return this.blocks.at(-1)?.id || null;
  }

  /** Stop editing and return the index for new material (handles the edited block disappearing). */
  insertIndex(afterId) {
    const id = afterId && this.find(afterId) ? afterId : this.insertionPoint();
    const idx = id ? this.index(id) : this.blocks.length - 1;
    if (this.editing) this.commit();
    if (id && !this.find(id)) return Math.max(0, idx);
    return id ? this.index(id) + 1 : this.blocks.length;
  }

  insertAt(index, nb) {
    const i = Math.max(0, Math.min(this.blocks.length, index));
    const ref = this.blocks[i];
    this.blocks.splice(i, 0, nb);
    const node = this.buildNode(nb);
    if (ref) this.nodes.get(ref.id).node.before(node); else this.sheet.append(node);
    this.refreshMargins();
    return nb;
  }

  /** Remove a lone empty block once real content arrives. */
  dropLoneBlank(exceptId) {
    if (this.blocks.length !== 2) return;
    const other = this.blocks.find((b) => b.id !== exceptId);
    if (other && other.type === 'text' && isBlank(other.md) && this.editing !== other.id) this.removeBlock(other.id);
  }

  insertText(md, { afterId, type = 'text' } = {}) {
    const editingBlank = this.editing && this.find(this.editing);
    if (editingBlank && editingBlank.type === 'text' && isBlank(editingBlank.md) && !afterId) {
      editingBlank.md = md;
      editingBlank.at = this.ctx.anchorNow() || editingBlank.at;
      this.commit();
      this.refreshMargins();
      this.changed();
      this.focusBlock(editingBlank.id);
      return editingBlank;
    }
    const nb = this.insertAt(this.insertIndex(afterId), newBlock(type, md, this.ctx.anchorNow()));
    this.dropLoneBlank(nb.id);
    this.changed();
    this.focusBlock(nb.id);
    return nb;
  }

  async addImage(blob, { afterId = null, at, w, h: hgt, caption = '' } = {}) {
    if (!store.canUpload) { toast('Images can’t be stored in this browser.', { tone: 'error' }); return; }
    const url = URL.createObjectURL(blob);
    if (!w) {
      try {
        const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
        w = img.naturalWidth; hgt = img.naturalHeight;
      } catch { /* unknown size */ }
    }
    const nb = { id: uid('b'), type: 'image', md: caption, at: at === undefined ? this.ctx.anchorNow() : at, img: { asset: null, w: w || null, h: hgt || null } };
    this.pending.set(nb.id, url);
    this.insertAt(this.insertIndex(afterId), nb);
    this.dropLoneBlank(nb.id);
    this.nodes.get(nb.id)?.node.scrollIntoView({ block: 'nearest' });
    try {
      const res = await store.upload(blob, blob.type || 'image/png');
      nb.img.asset = res.id;
      URL.revokeObjectURL(url);
      this.pending.delete(nb.id);
      if (this.find(nb.id)) this.rebuild(nb.id);
      this.changed();
    } catch (e) {
      toast(uploadMessage(e, 'image'), { tone: 'error' });
      this.removeBlock(nb.id);
    }
  }

  blockMenu(id, anchorEl) {
    const b = this.find(id); if (!b) return;
    const type = registry.blockType(b.type);
    const items = [];
    if (type.convertible) {
      items.push({ heading: 'Turn into' });
      for (const t of registry.blockTypes.values()) {
        if (!t.convertible) continue;
        items.push({ label: t.label, checked: (b.type || 'text') === t.id, run: () => this.setType(b, t.id) });
      }
      items.push('-');
    }
    const now = this.ctx.anchorNow();
    items.push(
      { label: now ? `Anchor to slide ${this.ctx.anchorLabel(now)}` : 'Anchor to current slide', icon: 'anchor', disabled: !now, run: () => { b.at = now; this.refreshMargins(); this.changed(); } },
      { label: 'Remove slide anchor', icon: 'unlink', disabled: !b.at, run: () => { b.at = null; this.refreshMargins(); this.changed(); } },
      '-',
      { label: 'Move up', icon: 'up', hint: 'Alt Shift ↑', disabled: this.index(id) === 0, run: () => this.move(id, -1) },
      { label: 'Move down', icon: 'down', hint: 'Alt Shift ↓', disabled: this.index(id) === this.blocks.length - 1, run: () => this.move(id, 1) },
      { label: 'Duplicate', icon: 'dup', run: () => { const c = { ...JSON.parse(JSON.stringify(b)), id: uid('b') }; this.insertAfter(id, c); this.changed(); } },
      { label: 'Delete', icon: 'trash', danger: true, run: () => this.deleteWithUndo(id) },
    );
    showMenu(anchorEl, items);
  }

  onClick(e) {
    const blk = e.target.closest('.blk'); if (!blk) return;
    const id = blk.dataset.id;
    const tagEl = e.target.closest('a.tag');
    if (tagEl) { e.preventDefault(); this.ctx.openTag(tagEl.dataset.tag); return; }
    if (e.target.closest('a[href]')) return;
    const cb = e.target.closest('input.task');
    if (cb) {
      e.preventDefault();
      const rec = this.nodes.get(id); const b = this.find(id);
      const idx = [...rec.view.querySelectorAll('input.task')].indexOf(cb);
      b.md = toggleTask(b.md, idx);
      this.paint(rec);
      this.changed();
      return;
    }
    if (e.target.closest('.blk-handle, .blk-check, .anchor, textarea')) return;
    if (String(window.getSelection?.() || '').length) return;
    if (this.editing === id) return;
    this.edit(id, 'end');
  }

  /** Lecture notes as Markdown (for copying elsewhere). */
  toMarkdown(title = '') {
    const out = title ? [`# ${title}`, ''] : [];
    for (const b of this.blocks) {
      const t = registry.blockType(b.type);
      const md = (b.md || '').trim();
      if (t.media) {
        const src = b.img?.asset ? new URL(store.assetUrl(b.img.asset), location.href).href : '';
        out.push(`![${md || 'Slide snapshot'}](${src})`);
      } else if (b.type === 'question') {
        out.push(`- [${b.done ? 'x' : ' '}] **Question:** ${md}`);
      } else if (t.tag) {
        out.push(`> **${t.label}.** ${md.replace(/\n/g, '\n> ')}`);
      } else if (md) {
        out.push(md);
      } else continue;
      out.push('');
    }
    return out.join('\n').trim() + '\n';
  }
}

export function uploadMessage(e, what = 'file') {
  switch (e?.code) {
    case 'too_large': return `That ${what} is over the 20 MB limit.`;
    case 'unsupported_type': return `That ${what} type can't be stored here.`;
    case 'quota_or_state': return 'Storage for this page is full. Remove slides you no longer need, then try again.';
    case 'rate_limited': return 'Too many uploads at once. Wait a moment and try again.';
    case 'not_granted': return 'Uploading needs edit access to this page.';
    default: return `Upload failed${e?.message ? ': ' + e.message : '.'}`;
  }
}

/** Scroll a list so the item is visible, without scrolling anything else. */
export function keepVisible(list, item) {
  if (!list || !item) return;
  const top = item.offsetTop; const bottom = top + item.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = top - 4;
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 4;
}

// ---------------------------------------------------------------------------
/** The "/" menu: appears while typing "/word" in a block. */
class SlashMenu {
  constructor(ed) { this.ed = ed; this.el = null; this.items = []; this.i = 0; this.start = -1; this.query = ''; }
  get open() { return !!this.el; }

  sync() {
    const ta = this.ed.ta; if (!ta) { this.close(); return; }
    const v = ta.value; const s = ta.selectionStart;
    if (s !== ta.selectionEnd || countFences(v.slice(0, s)) % 2) { this.close(); return; }
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    const seg = v.slice(ls, s);
    const m = /(^|\s)\/([\p{L}\p{N}-]*)$/u.exec(seg);
    if (!m) { this.close(); return; }
    const q = m[2].toLowerCase();
    this.start = ls + m.index + m[1].length;
    const items = registry.slash
      .map((c) => {
        if (!q) return { c, score: 1 };
        const label = c.label.toLowerCase(); const keys = `${c.id} ${c.keys || ''}`.toLowerCase();
        if (label.startsWith(q) || c.id.startsWith(q)) return { c, score: 3 };
        if (keys.split(/\s+/).some((k) => k.startsWith(q))) return { c, score: 2 };
        if (label.includes(q) || keys.includes(q)) return { c, score: 1 };
        return null;
      })
      .filter(Boolean);
    if (!items.length) { this.close(); return; }
    if (q) items.sort((a, b) => b.score - a.score);
    this.items = items.map((x) => x.c);
    if (q !== this.query) this.i = 0;
    this.query = q;
    this.render();
  }

  render() {
    if (!this.el) {
      this.el = h('div', { class: 'slash', role: 'listbox', 'aria-label': 'Insert block', style: { top: '0px', left: '0px', visibility: 'hidden' } });
      this.el.addEventListener('mousedown', (e) => e.preventDefault());
      document.body.append(this.el);
    }
    this.i = Math.min(this.i, this.items.length - 1);
    let group = null;
    const kids = [];
    this.items.forEach((c, idx) => {
      if (!this.query && c.group !== group) { group = c.group; kids.push(h('div', { class: 'slash-group' }, group)); }
      kids.push(h('div', {
        class: `slash-item${idx === this.i ? ' is-active' : ''}`, role: 'option', 'aria-selected': String(idx === this.i),
        onclick: () => this.choose(c),
      }, h('span', { class: 'slash-label' }, c.label), c.hint ? h('span', { class: 'slash-hint' }, c.hint) : null));
    });
    this.el.replaceChildren(...kids);
    this.place();
    keepVisible(this.el, this.el.querySelector('.is-active'));
  }

  place() {
    const ta = this.ed.ta; if (!ta || !this.el) return;
    const r = ta.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 24;
    const lineIdx = ta.value.slice(0, this.start).split('\n').length;
    let top = r.top + Math.min(lineIdx * lh, r.height) + 4;
    const mh = this.el.offsetHeight;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top + (lineIdx - 1) * lh - mh - 4);
    const rtl = ta.dir === 'rtl';
    const left = rtl ? Math.max(8, r.right - this.el.offsetWidth) : Math.min(r.left, window.innerWidth - this.el.offsetWidth - 8);
    this.el.style.top = top + 'px';
    this.el.style.left = Math.max(8, left) + 'px';
    this.el.style.visibility = '';
  }

  key(e) {
    const n = this.items.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); this.i = (this.i + 1) % n; this.render(); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); this.i = (this.i - 1 + n) % n; this.render(); return true; }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); this.choose(this.items[this.i]); return true; }
    if (e.key === 'Escape') { e.preventDefault(); this.close(); return true; }
    return false;
  }

  choose(cmd) {
    const ed = this.ed; const ta = ed.ta; if (!ta || !cmd) return;
    const b = ed.find(ed.editing);
    const end = ta.selectionStart;
    const start = this.start;
    this.close();
    ed.replaceRange(start, end, '');
    cmd.run({
      block: b,
      insert: (tpl) => ed.replaceRange(ed.ta.selectionStart, ed.ta.selectionEnd, tpl.includes(CARET) ? tpl : tpl + CARET),
      setType: (t) => ed.setType(b, t),
      setPrefix: (p) => ed.setLinePrefix(p),
      action: (name) => ed.ctx.action?.(name, b.id),
    });
  }

  close() {
    this.el?.remove(); this.el = null; this.items = []; this.i = 0; this.query = '';
  }
}
