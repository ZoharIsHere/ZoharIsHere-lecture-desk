// snapshot.js — drag a rectangle over the slide to capture it.
// Resolves to the selection as fractions of the slide {x, y, w, h},
// the whole slide when the user just clicks, or null on Esc.

import { h } from './util.js';

export function pickRegion(canvas) {
  return new Promise((resolve) => {
    const r = canvas.getBoundingClientRect();
    const box = h('div', { class: 'snap-box', hidden: true });
    const hint = h('div', { class: 'snap-hint' }, 'Drag over the part to capture · Click for the whole slide · Esc to cancel');
    const ov = h('div', { class: 'snap-ov', tabindex: '-1', role: 'application', 'aria-label': 'Select an area of the slide' }, box, hint);
    Object.assign(ov.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    document.body.append(ov);
    ov.focus();

    let start = null;
    const pt = (e) => ({ x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)) });
    const rect = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

    ov.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      ov.setPointerCapture(e.pointerId);
      start = pt(e);
      hint.hidden = true;
    });
    ov.addEventListener('pointermove', (e) => {
      if (!start) return;
      const q = rect(start, pt(e));
      box.hidden = false;
      Object.assign(box.style, { left: q.x + 'px', top: q.y + 'px', width: q.w + 'px', height: q.h + 'px' });
    });
    ov.addEventListener('pointerup', (e) => {
      if (!start) return;
      const q = rect(start, pt(e));
      done(q.w < 10 || q.h < 10 ? { x: 0, y: 0, w: 1, h: 1 } : { x: q.x / r.width, y: q.y / r.height, w: q.w / r.width, h: q.h / r.height });
    });
    ov.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
      if (e.key === 'Enter') { e.preventDefault(); done({ x: 0, y: 0, w: 1, h: 1 }); }
    });
    const onScroll = () => done(null);
    window.addEventListener('resize', onScroll, { once: true });

    function done(v) {
      window.removeEventListener('resize', onScroll);
      ov.remove();
      resolve(v);
    }
  });
}

/** Crop a rendered canvas region into an image blob (WebP where supported). */
export async function cropToBlob(source, region) {
  const sx = Math.round(region.x * source.width);
  const sy = Math.round(region.y * source.height);
  const sw = Math.max(1, Math.round(region.w * source.width));
  const sh = Math.max(1, Math.round(region.h * source.height));
  const out = document.createElement('canvas');
  out.width = sw; out.height = sh;
  out.getContext('2d').drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  let blob = await new Promise((res) => out.toBlob(res, 'image/webp', 0.92));
  if (!blob || blob.type !== 'image/webp') blob = await new Promise((res) => out.toBlob(res, 'image/png'));
  return { blob, w: sw, h: sh };
}
