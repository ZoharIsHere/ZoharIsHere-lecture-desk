// features/export.js — End lesson, and notes as a PDF.
//
// End lesson: stops listening, writes the last auto notes, marks the lesson
// "To review", downloads the notes as a PDF, and refreshes the course summary.
// The PDF is named "<course> <Lecture 4> notes <date>.pdf", so it never takes
// the name of the slides file it sits next to in Downloads.

import { h, bus, loadScript, fmtDate } from '../util.js';
import { registry } from '../registry.js';
import { store } from '../store.js';
import { toast } from '../ui.js';
import { renderMarkdown } from '../markdown.js';
import { updatePrinciples } from './sheets.js';
import { room } from './classroom.js';

const HTML2CANVAS = 'https://cdn.jsdelivr.net/npm/html2canvas-pro@1.5.8/dist/html2canvas-pro.min.js';
const JSPDF = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';

export function pdfName(lec) {
  const l = lec.lecture();
  const base = `${lec.course?.code || 'Notes'} ${store.label(l)} notes ${l.date || ''}`.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  const taken = new Set((l.decks || []).map((d) => String(d.name || '').replace(/\.pdf$/i, '').toLowerCase()));
  let name = base; let n = 2;
  while (taken.has(name.toLowerCase())) name = `${base} (${n++})`;
  return name + '.pdf';
}

/** Renders the notes on a white page and saves them as a PDF. */
export async function downloadPdf(lec) {
  await Promise.all([loadScript(HTML2CANVAS), loadScript(JSPDF)]);
  const l = lec.lecture();
  const blocks = lec.editor.serialize();
  const page = h('div', { class: 'pdf-page' },
    h('header', { class: 'pdf-head' },
      h('div', { class: 'pdf-kicker' }, `${lec.course?.name || ''} · ${store.label(l)} · ${fmtDate(l.date, { day: 'numeric', month: 'long', year: 'numeric' })}`),
      h('h1', { dir: 'auto' }, l.title || store.label(l))));
  for (const b of blocks) {
    const type = registry.blockType(b.type);
    const el = h('section', { class: `pdf-blk${type.tone ? ' pdf-' + type.tone : ''}`, dir: 'auto' });
    if (type.tag && b.type !== 'text') el.append(h('span', { class: 'pdf-tag' }, type.label));
    if (b.type === 'image' && b.img?.asset) {
      const src = store.assetUrl(b.img.asset) || lec.editor.nodes.get(b.id)?.node.querySelector('img')?.src;
      if (src) el.append(h('img', { src }));
    }
    if (b.md?.trim()) el.append(h('div', { class: 'md', html: renderMarkdown(b.type === 'question' ? `${b.done ? '✓' : '?'} ${b.md}` : b.md) }));
    page.append(el);
  }
  const holder = h('div', { class: 'pdf-holder', 'data-theme': 'light' }, page);
  document.body.append(holder);
  try {
    await document.fonts?.ready;
    await Promise.all([...page.querySelectorAll('img')].map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))));
    const canvas = await window.html2canvas(page, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' });
    const pw = pdf.internal.pageSize.getWidth(); const ph = pdf.internal.pageSize.getHeight();
    const margin = 28;
    const scale = (pw - margin * 2) / canvas.width;
    const sliceH = Math.floor((ph - margin * 2) / scale);
    // Cut pages at white rows between blocks where possible.
    const ctx = canvas.getContext('2d');
    const isBlankRow = (y) => { const d = ctx.getImageData(0, y, canvas.width, 1).data; for (let i = 0; i < d.length; i += 16) if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) return false; return true; };
    let y = 0; let first = true;
    while (y < canvas.height) {
      let end = Math.min(canvas.height, y + sliceH);
      if (end < canvas.height) { for (let k = end; k > y + sliceH * 0.6; k -= 2) if (isBlankRow(k)) { end = k; break; } }
      const part = document.createElement('canvas');
      part.width = canvas.width; part.height = end - y;
      part.getContext('2d').drawImage(canvas, 0, y, canvas.width, end - y, 0, 0, canvas.width, end - y);
      if (!first) pdf.addPage();
      pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', margin, margin, canvas.width * scale, (end - y) * scale);
      first = false; y = end;
    }
    const name = pdfName(lec);
    pdf.save(name);
    return name;
  } finally { holder.remove(); }
}

registry.addLectureMount((lec, { bar }) => {
  const endBtn = h('button', { class: 'cb-btn cb-end', type: 'button', title: 'End the lesson: stop listening, save, download the PDF' }, 'End lesson');
  endBtn.addEventListener('click', async () => {
    endBtn.disabled = true; endBtn.textContent = 'Wrapping up…';
    const r = room(lec);
    try {
      r?.stopListening?.();
      bus.emit('lesson:end', lec.lecture().id);
      await r?.autoNotesPass?.({ final: true });
      await lec.session.flush();
      await store.updateLecture(lec.lecture().id, { status: 'review' });
      const name = await downloadPdf(lec);
      toast(`Lesson saved. Downloaded “${name}”.`, { ms: 7000 });
      updatePrinciples(lec, { quiet: true }).catch((e) => console.warn('[sheets]', e));
    } catch (e) {
      console.error(e);
      toast(`Couldn’t finish the PDF. ${e.message || ''} Your notes are saved.`, { tone: 'error', ms: 8000 });
    } finally { endBtn.disabled = false; endBtn.textContent = 'End lesson'; }
  });
  const spacer = h('span', { class: 'grow' });
  bar.append(spacer, endBtn);
  return null;
});

registry.addCommand({
  id: 'pdf', label: 'Download these notes as a PDF', keys: 'export pdf print download', icon: 'notes',
  when: (ctx) => ctx.route.view === 'lecture',
  run: async () => {
    const lec = window.LectureDesk?.router?.instance?.()?.ctx;
    if (!lec) return;
    try { toast(`Downloaded “${await downloadPdf(lec)}”.`); } catch (e) { toast(e.message, { tone: 'error' }); }
  },
});
