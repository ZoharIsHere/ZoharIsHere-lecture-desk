// util.js — small shared helpers: DOM building, events, ids, local storage,
// dates, text direction and the icon set. No app logic lives here.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** h('button', {class:'btn', onclick: fn}, 'Label', childNode) */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/** Tiny pub/sub used to decouple the store, views and features. */
export const bus = (() => {
  const map = new Map();
  return {
    on(evt, fn) {
      if (!map.has(evt)) map.set(evt, new Set());
      map.get(evt).add(fn);
      return () => map.get(evt)?.delete(fn);
    },
    emit(evt, payload) {
      for (const fn of [...(map.get(evt) || [])]) {
        try { fn(payload); } catch (e) { console.error(`[bus:${evt}]`, e); }
      }
    },
  };
})();

export const uid = (prefix = '') =>
  prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  return d;
}

/** localStorage that never throws (private windows, blocked storage). */
export const ls = {
  get(k, fallback = null) {
    try { const v = localStorage.getItem('ld:' + k); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(k, v) { try { localStorage.setItem('ld:' + k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem('ld:' + k); } catch { /* ignore */ } },
};

export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function fmtDate(iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-GB', opts);
}

export function timeAgo(ms) {
  if (!ms) return '';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const days = Math.round(s / 86400);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/**
 * Decide paragraph direction for mixed Hebrew/English notes.
 * Code and math are ignored. Hebrew is weighted up because it is written
 * without vowels, so a Hebrew sentence with an English term stays RTL.
 */
export function detectDir(text, fallback = 'ltr') {
  const t = String(text || '')
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\$\$[\s\S]*?(\$\$|$)/g, ' ')
    .replace(/\$[^$\n]*\$/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ');
  const he = (t.match(/[֐-׿]/g) || []).length;
  const la = (t.match(/[A-Za-z]/g) || []).length;
  if (!he && !la) return fallback;
  const first = t.match(/[֐-׿A-Za-z]/)?.[0] || '';
  const firstHe = /[֐-׿]/.test(first);
  const heScore = he * 1.4 + (firstHe ? 3 : 0);
  const laScore = la + (first && !firstHe ? 3 : 0);
  return heScore > laScore ? 'rtl' : 'ltr';
}

const scriptLoads = new Map();
/** Load a classic script once (used for heavier libraries on demand). */
export function loadScript(src) {
  if (!scriptLoads.has(src)) {
    scriptLoads.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => { scriptLoads.delete(src); reject(new Error('Could not load ' + src)); };
      document.head.append(s);
    }));
  }
  return scriptLoads.get(src);
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? '⌘' : 'Ctrl';

export function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable ||
    (tag === 'INPUT' && !['checkbox', 'radio', 'button', 'range'].includes(el.type));
}

// ---------------------------------------------------------------------------
// Icons: 24px grid, drawn with currentColor strokes.
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  home: '<path d="M4 11.2 12 4.5l8 6.7V20h-5.5v-5.5h-5V20H4z"/>',
  left: '<path d="m14.5 6-6 6 6 6"/>',
  right: '<path d="m9.5 6 6 6-6 6"/>',
  up: '<path d="m6 14.5 6-6 6 6"/>',
  down: '<path d="m6 9.5 6 6 6-6"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>',
  crop: '<path d="M7 3v14h14"/><path d="M3 7h14v14"/>',
  lines: '<path d="M4 6.5h16M4 11.5h16M4 16.5h9"/>',
  more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  flag: '<path d="M6 21V4h10.5L15 8l1.5 4H6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  upload: '<path d="M12 15.5V4.5m0 0L7.8 8.7M12 4.5l4.2 4.2"/><path d="M4.5 14.5v5h15v-5"/>',
  split: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M11 4.5v15"/>',
  slides: '<rect x="3.5" y="4.5" width="17" height="11.5" rx="1.5"/><path d="M12 16v3.5M8.5 19.5h7"/>',
  notes: '<path d="M6.5 3.5h8l3.5 3.5v13.5H6.5z"/><path d="M9.5 10.5h5.5M9.5 14h5.5M9.5 17.5h3.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>',
  zoomIn: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M11 8.2v5.6M8.2 11h5.6"/>',
  zoomOut: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M8.2 11h5.6"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  focus: '<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/><circle cx="12" cy="12" r="2.2"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11.5" rx="1.5"/><path d="M5.5 15.5V5.5A1.5 1.5 0 0 1 7 4h8.5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  keyboard: '<rect x="3" y="6.5" width="18" height="11" rx="1.5"/><path d="M7 10.2h.01M10.3 10.2h.01M13.7 10.2h.01M17 10.2h.01M8 14h8"/>',
  edit: '<path d="M4.5 19.5h4l10.5-10.5-4-4L4.5 15.5z"/>',
  anchor: '<circle cx="12" cy="5.5" r="2"/><path d="M12 7.5v13M5 13a7 7 0 0 0 14 0M8.5 11h7"/>',
  unlink: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-3.2-6.8M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 3.2 6.8"/><path d="M4 4l16 16"/>',
  sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M9 4.5v15"/>',
  book: '<path d="M5 4.5h9.5a3 3 0 0 1 3 3v12.5H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h9.5"/>',
  question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.6"/><path d="M12 16.8h.01"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6"/>',
  dup: '<rect x="8.5" y="8.5" width="11" height="11.5" rx="1.5"/><path d="M5.5 15.5V5.5A1.5 1.5 0 0 1 7 4h8.5M14 11.5v5.5M11.2 14.2h5.6"/>',
};

export function icon(name, size = 16) {
  const span = document.createElement('span');
  span.className = 'ico';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
}
