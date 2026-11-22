// insights.js — things derived from the notes: tags (the glossary),
// open questions and full-text search. Nothing here is stored; it is
// recomputed from the note documents whenever it is needed.

import { store } from './store.js';

const TAG_RE = /(^|[\s(\[{,;:])#([\p{L}\p{N}_][\p{L}\p{N}_-]*)/gu;

export function stripCode(md) {
  return String(md || '').replace(/```[\s\S]*?(```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ');
}

export function tagsOf(md) {
  const out = new Set();
  for (const m of stripCode(md).matchAll(TAG_RE)) {
    if (!/^\d+$/.test(m[2])) out.add(m[2]);
  }
  return [...out];
}

/** Markdown → readable plain text for search and previews. */
const texToText = (tex) => tex
  .replace(/\\(left|right|,|;|!|quad)/g, ' ')
  .replace(/\\([a-zA-Z]+)/g, '$1 ')
  .replace(/[{}]/g, '')
  .replace(/\s+/g, ' ').trim();

export function plain(md) {
  return String(md || '')
    .replace(/\$\$([\s\S]+?)\$\$/g, (m, t) => texToText(t))
    .replace(/\$([^$\n]+)\$/g, (m, t) => texToText(t))
    .replace(/```(\w+)?\n?/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/\[[ xX]\]\s+/g, '')
    .replace(/(\*\*|__|\*|_|~~|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const normalize = (s) => String(s || '').toLowerCase().replace(/[֑-ׇ]/g, '').replace(/\s+/g, ' ');

/** Flatten note documents into one searchable list of blocks. */
export function entriesFrom(notes) {
  const out = [];
  for (const n of notes) {
    const lec = store.lecture(n.id);
    if (!lec) continue;
    for (const b of n.blocks || []) {
      const text = plain(b.md);
      if (!text && b.type !== 'image') continue;
      out.push({
        lectureId: n.id, courseId: lec.courseId, blockId: b.id, type: b.type || 'text',
        md: b.md || '', text, norm: normalize(text), tags: tagsOf(b.md), done: !!b.done, at: b.at || null,
      });
    }
  }
  return out;
}

export async function loadEntries(courseId = null) {
  return entriesFrom(await store.notesFor(courseId));
}

export function openQuestions(entries) {
  return entries.filter((e) => e.type === 'question' && !e.done);
}

/** Tags with every block that mentions them; a Definition block is the tag's definition. */
export function glossary(entries) {
  const map = new Map();
  for (const e of entries) {
    for (const t of e.tags) {
      const key = normalize(t);
      if (!map.has(key)) map.set(key, { tag: t, items: [], def: null });
      const g = map.get(key);
      g.items.push(e);
      if (e.type === 'def' && !g.def) g.def = e;
    }
  }
  return [...map.values()].sort((a, b) => b.items.length - a.items.length || a.tag.localeCompare(b.tag));
}

/** Rank blocks for a query; "#tag" searches tags only. */
export function search(entries, query, limit = 30) {
  const q = normalize(query).trim();
  if (!q) return [];
  if (q.startsWith('#')) {
    const t = q.slice(1);
    return entries.filter((e) => e.tags.some((x) => normalize(x).startsWith(t))).slice(0, limit)
      .map((e) => ({ entry: e, snippet: snippet(e.text, '') }));
  }
  const terms = q.split(' ').filter(Boolean);
  const hits = [];
  for (const e of entries) {
    let score = 0;
    for (const t of terms) {
      const i = e.norm.indexOf(t);
      if (i < 0) { score = 0; break; }
      score += 10 - Math.min(9, i / 40);
    }
    if (!score) continue;
    if (e.type === 'def' || e.type === 'thm') score += 4;
    if (/^#{1,3}\s/.test(e.md)) score += 3;
    hits.push({ entry: e, score, snippet: snippet(e.text, terms[0]) });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

function snippet(text, term) {
  if (text.length <= 140) return text;
  const i = term ? normalize(text).indexOf(term) : 0;
  const start = Math.max(0, i - 50);
  return (start ? '…' : '') + text.slice(start, start + 140) + (start + 140 < text.length ? '…' : '');
}
