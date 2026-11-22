// main.js — boots the app.
//
// Architecture in one screen (details in ARCHITECTURE.md):
//   store.js      persistence (your Supabase project, or this browser with ?local)
//   supa.js       Supabase client and sign-in
//   registry.js   extension points: block types, "/" menu, commands, lecture tools
//   blocks.js     built-in block types and "/" entries
//   editor.js     the notebook sheet (blocks anchored to slides)
//   viewer.js     the slide pane (pdf.js)
//   markdown.js   Markdown + math + code + diagrams → safe HTML
//   insights.js   tags, open questions, search (derived, never stored)
//   palette.js    Ctrl/⌘ K
//   views/*       home, course, lecture and the surrounding shell
//   features/*    optional features that plug into the registry

import './blocks.js';
import './features/index.js';
import { bus, isTypingTarget } from './util.js';
import { store } from './store.js';
import { router } from './router.js';
import { registry } from './registry.js';
import { openPalette } from './palette.js';
import { showShortcuts, toast } from './ui.js';
import { mountShell, toggleRail } from './views/shell.js';
import { mountHome } from './views/home.js';
import { mountCourse } from './views/course.js';
import { mountLecture } from './views/lecture.js';
import { newLecture, newCourseDialog, editCourseDialog } from './views/parts.js';
import { showAuth } from './views/auth.js';
import { client, currentUser } from './supa.js';

router.register('home', mountHome);
router.register('course', mountCourse);
router.register('lecture', mountLecture);

// ---- palette commands ----------------------------------------------------------
const courseIdOf = (ctx) => (ctx.route.view === 'course' ? ctx.route.id
  : ctx.route.view === 'lecture' ? store.lecture(ctx.route.id)?.courseId : null);

registry.addCommand({ id: 'new-course', label: 'Add course', keys: 'new create', icon: 'plus', run: () => newCourseDialog() });
registry.addCommand({ id: 'home', label: 'Go to your courses', keys: 'home overview dashboard', icon: 'home', run: () => router.go({ view: 'home' }) });
registry.addCommand({ id: 'shortcuts', label: 'Keyboard shortcuts', keys: 'help keys hotkeys', icon: 'keyboard', hint: '?', run: () => showShortcuts() });
registry.addCommand({ id: 'sidebar', label: 'Show or hide the sidebar', keys: 'rail sidebar collapse', icon: 'sidebar', run: () => toggleRail() });
registry.addCommand({
  id: 'edit-course', label: 'Edit this course', keys: 'rename colour color delete', icon: 'edit',
  when: (ctx) => !!courseIdOf(ctx), run: (ctx) => { const c = store.course(courseIdOf(ctx)); if (c) editCourseDialog(c); },
});

function syncCourseCommands() {
  registry.commands = registry.commands.filter((c) => !c.id.startsWith('new-l:') && !c.id.startsWith('new-t:'));
  for (const c of store.coursesSorted()) {
    registry.addCommand({ id: 'new-l:' + c.id, label: `New ${c.code} lecture`, keys: `new lecture ${c.name}`, icon: 'plus', run: () => newLecture(c.id, 'lecture') });
    registry.addCommand({ id: 'new-t:' + c.id, label: `New ${c.code} tutorial`, keys: `new tutorial ${c.name}`, icon: 'plus', run: () => newLecture(c.id, 'tutorial') });
  }
}
bus.on('data', (kind) => { if (kind === 'courses') syncCourseCommands(); });

// ---- global keys ------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (e.key === '?' && !isTypingTarget(e.target) && !document.querySelector('.scrim')) { e.preventDefault(); showShortcuts(); }
});

// ---- boot -------------------------------------------------------------------------
async function boot() {
  const app = document.getElementById('app');
  const bootEl = document.getElementById('boot');
  const stage = mountShell(app);
  if (bootEl) stage.append(bootEl);
  const local = new URLSearchParams(location.search).has('local');
  try {
    if (local) {
      await store.init();
    } else {
      let user = null;
      try { user = await currentUser(); } catch (e) { console.warn('[boot] auth', e); }
      if (!user) {
        if (!navigator.onLine) { stage.textContent = 'You are offline and not signed in yet. Connect once to sign in.'; return; }
        app.classList.add('is-auth');
        user = await showAuth(stage);
        app.classList.remove('is-auth');
        stage.replaceChildren();
      }
      await store.init({ sb: await client(), user });
    }
  } catch (e) {
    console.error(e);
    stage.textContent = 'Your notes could not be opened. Reload the page to try again.';
    return;
  }
  app.removeAttribute('aria-busy');
  syncCourseCommands();
  router.start(stage);
  if (store.mode === 'local') {
    toast('Trial mode: notes are saved in this browser only, and AI features are off.', { tone: 'warn', ms: 8000 });
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[sw]', e));
  }
}

window.LectureDesk = { store, registry, router, bus };
boot();
