// features/breaks.js — stepping out without losing the lesson.
//
// Bathroom break: keeps listening (and auto notes, if on) while you're away;
//   "When's a good time?" asks the AI whether the lecturer is mid-topic;
//   "I'm back" gives a catch-up of what you missed, which you can add to your notes.
// Phone break: a silent timer. Nothing plays when it ends; the bar glows instead.
// Keyboard: B.

import { h, uid, isTypingTarget } from '../util.js';
import { registry } from '../registry.js';
import { toast, showMenu } from '../ui.js';
import { ask, aiAvailable } from '../ai.js';
import { room } from './classroom.js';
import { openDrawer, closeDrawer } from './drawer.js';

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;

registry.addLectureMount((lec, { bar, page }) => {
  const r = room(lec); if (!r) return null;
  let away = null;   // { kind: 'bathroom'|'phone', start, ends? }

  const btn = h('button', { class: 'cb-btn', type: 'button', title: 'Take a break (B)' }, h('span', { class: 'cb-label' }, 'Break'));
  btn.addEventListener('click', () => (away ? back() : menu()));
  bar.append(btn);

  function menu() {
    showMenu(btn, [
      { label: 'Bathroom break', hint: 'keeps listening', run: () => start('bathroom') },
      { label: 'Is now a good time?', run: advice },
      '-',
      { heading: 'Phone break (silent timer)' },
      ...[2, 5, 10].map((m) => ({ label: `${m} minutes`, run: () => start('phone', m) })),
    ]);
  }

  function start(kind, minutes = 0) {
    away = { kind, start: r.now(), ends: minutes ? r.now() + minutes * 60 : null };
    if (kind === 'bathroom' && !r.listening) r.startListening?.();
    page.classList.add('is-away');
    paint();
  }

  async function back() {
    const a = away; away = null;
    page.classList.remove('is-away', 'is-overtime');
    paint();
    if (a.kind === 'phone') { toast('Welcome back.'); return; }
    await r.autoNotesPass?.({ final: true });
    const missed = r.since(a.start);
    if (!missed.length) { toast('Nothing was picked up while you were away.'); return; }
    catchUp(missed);
  }

  async function catchUp(missed) {
    const d = openDrawer(page, { id: 'catchup', title: 'While you were out' }); if (!d) return;
    if (!aiAvailable()) { d.body.append(transcriptView(missed)); return; }
    d.body.append(h('p', { class: 'drawer-note' }, 'Summarising what you missed…'));
    try {
      const md = await ask({
        system: 'You help a CS student who stepped out of a lecture catch up. From the transcript (speech recognition, may be noisy), write a short catch-up in Markdown: what was covered, in order, with any definitions, results, examples or exam remarks. Same language mix as the lecture. Under 180 words. No preamble.',
        prompt: r.text(missed),
        max_tokens: 900,
      });
      d.body.replaceChildren(
        h('div', { class: 'md drawer-md', dir: 'auto', html: (await import('../markdown.js')).renderMarkdown(md) }),
        h('div', { class: 'drawer-actions' },
          h('button', {
            class: 'btn btn-primary', type: 'button',
            onclick: () => {
              lec.editor.insertAt(lec.editor.blocks.length, { id: uid('b'), type: 'text', md: `**While I was out:**\n${md.trim()}`, at: lec.viewer.anchor(), auto: true });
              lec.editor.changed(); closeDrawer(); toast('Added to your notes.');
            },
          }, 'Add to notes'),
          h('button', { class: 'btn btn-quiet', type: 'button', onclick: () => { d.body.replaceChildren(transcriptView(missed)); } }, 'Show what was said')));
    } catch (e) {
      d.body.replaceChildren(h('p', { class: 'drawer-note' }, e.message), transcriptView(missed));
    }
  }

  function transcriptView(lines) {
    return h('div', { class: 'drawer-transcript' }, ...lines.map((l) => h('p', { dir: 'auto' }, l.text)));
  }

  async function advice() {
    const recent = r.since(r.now() - 240);
    if (!aiAvailable() || recent.length < 3) {
      toast(recent.length < 3 ? 'Listen for a few minutes first, then ask again.' : 'Advice needs AI (Settings → AI).', { tone: 'warn' });
      return;
    }
    toast('Checking…', { ms: 2000 });
    try {
      const res = await ask({
        json: true, max_tokens: 300,
        system: 'A student wants to step out of a lecture for ~4 minutes. From the last few minutes of transcript, judge whether the lecturer is in the middle of a key derivation, definition or exam remark (bad time) or between topics, on examples, admin or Q&A (good time). Return JSON {"verdict":"go"|"wait","reason":"one short sentence, same language as the lecture"}.',
        prompt: r.text(recent),
      });
      toast(`${res.verdict === 'go' ? 'Good time to go.' : 'Better wait a bit.'} ${res.reason || ''}`, { tone: res.verdict === 'go' ? 'info' : 'warn', ms: 8000 });
    } catch (e) { toast(e.message, { tone: 'warn' }); }
  }

  function paint() {
    if (!away) { btn.replaceChildren(h('span', { class: 'cb-label' }, 'Break')); btn.removeAttribute('aria-pressed'); return; }
    btn.setAttribute('aria-pressed', 'true');
    const t = r.now();
    const label = away.kind === 'phone'
      ? (away.ends - t > 0 ? `Phone · ${mmss(away.ends - t)}` : `Time’s up · ${mmss(t - away.ends)}`)
      : `Away ${mmss(t - away.start)} · I’m back`;
    btn.replaceChildren(h('span', { class: 'cb-label' }, label));
    page.classList.toggle('is-overtime', away.kind === 'phone' && t >= away.ends);
  }

  const offTick = r.on('tick', () => { if (away) paint(); });
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target) || document.querySelector('.scrim')) return;
    if (e.key === 'b' || e.key === 'B') { e.preventDefault(); btn.click(); }
  };
  document.addEventListener('keydown', onKey);
  return () => { offTick(); document.removeEventListener('keydown', onKey); page.classList.remove('is-away', 'is-overtime'); };
});
