// markdown.js — turns one block's Markdown into safe HTML.
// Adds: $inline$ and $$display$$ math (KaTeX), #tags, syntax-highlighted
// code, ```mermaid diagrams, clickable task lists, per-paragraph direction.

import { esc, detectDir, loadScript, uid } from './util.js';

const MERMAID_SRC = 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js';
const CODE_LANGS = ['java', 'c', 'cpp', 'python', 'javascript', 'bash', 'sql'];

function katexHtml(tex, display) {
  if (!window.katex) return `<code>${esc(tex)}</code>`;
  try {
    return window.katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', output: 'htmlAndMathml' });
  } catch {
    return `<code class="math-error">${esc(tex)}</code>`;
  }
}

const mathBlock = {
  name: 'mathBlock',
  level: 'block',
  start(src) { const i = src.indexOf('$$'); return i < 0 ? undefined : i; },
  tokenizer(src) {
    const m = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/.exec(src);
    if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() };
    return undefined;
  },
  renderer(tok) { return `<div class="math-block" dir="ltr">${katexHtml(tok.text, true)}</div>`; },
};

const mathInline = {
  name: 'mathInline',
  level: 'inline',
  start(src) { const i = src.indexOf('$'); return i < 0 ? undefined : i; },
  tokenizer(src) {
    let m = /^\$\$([\s\S]+?)\$\$/.exec(src);
    if (m) return { type: 'mathInline', raw: m[0], text: m[1].trim(), display: true };
    m = /^\$(?!\s)((?:\\.|[^\\$\n])+?)\$(?!\d)/.exec(src);
    if (m && !/\s$/.test(m[1])) return { type: 'mathInline', raw: m[0], text: m[1], display: false };
    return undefined;
  },
  renderer(tok) {
    return tok.display
      ? `<span class="math-display" dir="ltr">${katexHtml(tok.text, true)}</span>`
      : `<span class="math-inline" dir="ltr">${katexHtml(tok.text, false)}</span>`;
  },
};

const tag = {
  name: 'tag',
  level: 'inline',
  start(src) {
    const m = /(^|[\s(\[{,;:])#[\p{L}\p{N}_]/u.exec(src);
    return m ? m.index + m[1].length : undefined;
  },
  tokenizer(src) {
    const m = /^#([\p{L}\p{N}_][\p{L}\p{N}_-]*)/u.exec(src);
    if (m && !/^\d+$/.test(m[1])) return { type: 'tag', raw: m[0], name: m[1] };
    return undefined;
  },
  renderer(tok) { return `<a class="tag" href="#" data-tag="${esc(tok.name)}">#${esc(tok.name)}</a>`; },
};

let parser = null;
function getParser() {
  if (parser) return parser;
  const { Marked } = window.marked;
  parser = new Marked({ gfm: true, breaks: true });
  parser.use({
    extensions: [mathBlock, mathInline, tag],
    renderer: {
      code(code, info) {
        const lang = String(info || '').trim().split(/\s+/)[0].toLowerCase();
        if (lang === 'mermaid') {
          return `<div class="mermaid-box" dir="ltr" data-src="${encodeURIComponent(code)}"><span class="mermaid-wait">Drawing diagram…</span></div>`;
        }
        const hljs = window.hljs;
        let html = esc(code);
        let label = lang;
        try {
          if (hljs && lang && hljs.getLanguage(lang)) html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
          else if (hljs && !lang && code.trim()) {
            const r = hljs.highlightAuto(code, CODE_LANGS);
            if (r.relevance > 4) { html = r.value; label = r.language || ''; }
          }
        } catch { /* fall back to plain text */ }
        return `<div class="code" dir="ltr">${label ? `<span class="code-lang">${esc(label)}</span>` : ''}<pre><code class="hljs">${html}</code></pre></div>`;
      },
      link(href, title, text) {
        const safe = /^(https?:|mailto:|#|\/)/i.test(href || '') ? href : '#';
        return `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${esc(title)}"` : ''}>${text}</a>`;
      },
      image(href, title, text) {
        if (/^\/_blob\/|^blob:/.test(href || '')) return `<img src="${esc(href)}" alt="${esc(text)}" loading="lazy">`;
        return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text || href)}</a>`;
      },
      checkbox(checked) { return `<input type="checkbox" class="task"${checked ? ' checked' : ''}> `; },
      table(header, body) {
        return `<div class="table-wrap"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
      },
    },
  });
  return parser;
}

const cache = new Map();
/** Markdown → sanitized HTML string (memoized). */
export function renderMarkdown(src) {
  const key = String(src || '');
  if (cache.has(key)) return cache.get(key);
  let html;
  try {
    html = getParser().parse(key);
  } catch (e) {
    console.warn('[markdown]', e);
    html = `<p>${esc(key)}</p>`;
  }
  if (window.DOMPurify) {
    html = window.DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form'] });
  }
  if (cache.size > 800) cache.delete(cache.keys().next().value);
  cache.set(key, html);
  return html;
}

/** After inserting rendered HTML: per-paragraph direction and diagrams. */
export function postRender(el, fallbackDir = 'ltr') {
  el.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, figcaption').forEach((n) => {
    if (n.closest('.code, .math-block, .mermaid-box')) return;
    n.setAttribute('dir', detectDir(n.textContent, fallbackDir));
  });
  el.querySelectorAll('.mermaid-box').forEach((box) => renderMermaid(box));
}

/** Toggle the n-th "- [ ]" task in a block's Markdown. */
export function toggleTask(md, n) {
  let i = -1;
  return md.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/gm, (m, pre, mark) => {
    i++;
    return i === n ? `${pre}[${mark === ' ' ? 'x' : ' '}]` : m;
  });
}

// --- Mermaid (loaded only when a diagram first appears) ----------------------
const diagramCache = new Map();
let queue = Promise.resolve();

function themeKey() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function themeVars() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, f) => (cs.getPropertyValue(n).trim() || f);
  return {
    background: v('--sheet', '#fff'),
    mainBkg: v('--tint', '#eef2f6'),
    primaryColor: v('--tint', '#eef2f6'),
    primaryTextColor: v('--ink', '#18202b'),
    primaryBorderColor: v('--rule-strong', '#c3cad3'),
    nodeBorder: v('--rule-strong', '#c3cad3'),
    lineColor: v('--ink-2', '#4a5563'),
    secondaryColor: v('--ground', '#e9ecef'),
    tertiaryColor: v('--sheet', '#fff'),
    textColor: v('--ink', '#18202b'),
    clusterBkg: v('--ground', '#e9ecef'),
    edgeLabelBackground: v('--sheet', '#fff'),
    fontSize: '14px',
  };
}

function renderMermaid(box) {
  const src = decodeURIComponent(box.dataset.src || '');
  if (!src.trim()) { box.textContent = ''; return; }
  const key = themeKey() + '\n' + src;
  if (diagramCache.has(key)) { box.innerHTML = diagramCache.get(key); return; }
  queue = queue.then(async () => {
    const id = 'mmd' + uid();
    try {
      await loadScript(MERMAID_SRC);
      const m = window.mermaid;
      m.initialize({
        startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: themeVars(),
        fontFamily: '"IBM Plex Sans Hebrew", system-ui, sans-serif',
      });
      const { svg } = await m.render(id, src);
      diagramCache.set(key, svg);
      if (box.isConnected) box.innerHTML = svg;
    } catch (e) {
      document.getElementById('d' + id)?.remove();
      document.getElementById(id)?.remove();
      const msg = String(e?.message || e || 'Unknown error').split('\n')[0];
      if (box.isConnected) box.innerHTML = `<div class="mermaid-error">This diagram has an error: ${esc(msg)}</div>`;
    }
  });
}
