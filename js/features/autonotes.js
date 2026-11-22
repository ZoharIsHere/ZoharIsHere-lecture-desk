// features/autonotes.js — notes that write themselves from what the lecturer says.
//
// While on, every ~90 s of new speech goes to the AI with: the slide on screen,
// a sample of your own recent notes (so it writes in your style), and the rules:
// skip students' questions, chit-chat and admin; keep what matters; flag
// anything said about the exam. New blocks are added at the end, marked "auto",
// without moving your cursor. Keyboard: A.

import { h, uid, ls, isTypingTarget } from '../util.js';
import { registry } from '../registry.js';
import { toast } from '../ui.js';
import { ask, aiAvailable, styleSample } from '../ai.js';
import { room } from './classroom.js';

const EVERY = 90;          // seconds between passes
const MIN_CHARS = 180;     // don't bother with less new speech than this
const TYPES = ['text', 'def', 'thm', 'example', 'trap'];

export const SYSTEM = `You take lecture notes for a computer-science student at Bar-Ilan University.
You receive a raw speech-recognition transcript (Hebrew and/or English, with recognition errors), the text of the slide on screen, and a sample of the student's own notes.
Write ONLY what a strong student would write down from this stretch of the lesson:
- Continue in the student's own format and language mix (headings, bullets, abbreviations, Hebrew with English terms) as seen in the sample.
- Skip: students' questions and answers to them unless the answer adds new material; jokes, admin, repetition, filler, "as we saw last time".
- Keep: definitions, claims, algorithms and their complexity, important examples, and the lecturer's own emphasis ("this is important", "this will be on the exam").
- Do not repeat what is already in the student's notes or copy the slide verbatim; add what was SAID beyond the slide.
- Fix obvious recognition errors in technical terms. Use Markdown, $math$ and \`\`\`code\`\`\` where natural.
- Anything said about the exam goes in a block of type "trap".
Return JSON: {"blocks":[{"type":"text|def|thm|example|trap","md":"..."}]}. Return {"blocks":[]} if nothing is worth writing.`;

registry.addLectureMount((lec, { bar }) => {
  const r = room(lec); if (!r) return null;
  let on = false; let busy = false; let lastT = r.now(); let lastRun = 0;

  const btn = h('button', {
    class: 'cb-btn', type: 'button', 'aria-pressed': 'false', title: 'Auto notes from what is said (A)',
    onclick: () => toggle(),
  }, h('span', { class: 'cb-dot', 'aria-hidden': 'true' }), h('span', null, 'Auto notes'));
  bar.append(btn);

  function toggle(force) {
    const next = force ?? !on;
    if (next && !aiAvailable()) { toast('Auto notes need your account and a Gemini key (Settings → AI).', { tone: 'warn' }); return; }
    on = next;
    btn.setAttribute('aria-pressed', String(on));
    ls.set('autonotes', on);
    if (on) {
      lastT = Math.max(0, r.now() - 30);
      if (!r.listening) r.startListening?.();
      toast('Auto notes on. They’ll appear at the end of your notes, marked “auto”.');
    }
  }

  async function pass({ final = false } = {}) {
    if (busy || (!on && !final)) return;
    const fresh = r.since(lastT);
    const chars = fresh.reduce((n, l) => n + l.text.length, 0);
    if (chars < (final ? 60 : MIN_CHARS)) return;
    busy = true;
    const until = r.now();
    try {
      let slide = '';
      try { slide = ((await lec.viewer.slideText()) || []).join('\n').slice(0, 2500); } catch { /* no slides */ }
      const blocks = lec.editor.serialize();
      const res = await ask({
        system: SYSTEM, json: true, max_tokens: 2500,
        prompt: `STUDENT'S RECENT NOTES (style sample):\n${styleSample(blocks) || '(none yet)'}\n\nSLIDE ON SCREEN:\n${slide || '(no slide text)'}\n\nTRANSCRIPT OF THE LAST STRETCH:\n${r.text(fresh)}`,
      });
      const add = (res?.blocks || []).filter((b) => b && b.md && String(b.md).trim());
      if (add.length) {
        const at = lec.viewer.anchor();
        for (const b of add) {
          lec.editor.insertAt(lec.editor.blocks.length, { id: uid('b'), type: TYPES.includes(b.type) ? b.type : 'text', md: String(b.md).trim(), at, auto: true });
        }
        lec.editor.changed();
      }
      lastT = until;
    } catch (e) {
      if (e.code === 'missing_key' || e.code === 'local') toggle(false);
      toast(e.message, { tone: 'warn', ms: 6000 });
    } finally { busy = false; lastRun = Date.now(); }
  }
  r.autoNotesPass = pass;

  const offTick = r.on('tick', () => { if (on && Date.now() - lastRun > EVERY * 1000) pass(); });
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target) || document.querySelector('.scrim')) return;
    if (e.key === 'a' || e.key === 'A') { e.preventDefault(); toggle(); }
  };
  document.addEventListener('keydown', onKey);
  return () => { offTick(); document.removeEventListener('keydown', onKey); };
});
