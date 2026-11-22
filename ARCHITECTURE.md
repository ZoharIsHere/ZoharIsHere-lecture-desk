# Lecture Desk — architecture

A note-taking app for lectures: slides (PDF) on one side, notes on the other,
every note anchored to the slide that was showing when it was written.
Plain ES modules, no build step, installable (PWA). Each file has one job;
features plug in through a registry, so adding one rarely touches existing files.

## Files

| File | Job |
|---|---|
| `index.html`, `manifest.webmanifest`, `sw.js`, `icons/` | Installable app shell; opens offline after the first visit |
| `css/app.css` | All styles. Tokens at the top (light + dark), then sections per area |
| `css/katex.css` | KaTeX stylesheet with fonts embedded (fonts can't load from a CDN) |
| `js/main.js` | Boot (sign-in, then the store), view registration, palette commands, global keys |
| `js/config.js` | Supabase project address and publishable key |
| `js/supa.js` | Supabase client, account creation (once) and sign-in |
| `js/ai.js` | Calls the backend `ai` function (Gemini free tier); tolerant JSON |
| `js/speech.js` | Browser speech recognition that restarts itself |
| `js/views/auth.js` | First-run / sign-in screen |
| `js/registry.js` | **Extension points**: block types, `/` menu, palette commands, lecture tools, course colours |
| `js/blocks.js` | Built-in block types and `/` entries |
| `js/store.js` | All persistence. `SupabaseBackend` (normal) or `LocalBackend` (`?local`). `NoteSession` = autosave + local safety copy |
| `js/editor.js` | The notebook sheet: blocks, editing keys, slash menu, block menu, images |
| `js/viewer.js` | Slide pane: pdf.js rendering, decks, overview grid, snapshots, slide text |
| `js/snapshot.js` | Drag-to-select region over the slide, crop to an image |
| `js/markdown.js` | Markdown → safe HTML: math, #tags, code highlighting, Mermaid, task lists, RTL per paragraph |
| `js/insights.js` | Derived data: tags/glossary, open questions, search (never stored) |
| `js/palette.js` | Ctrl/⌘ K search and commands |
| `js/router.js` | Which view is shown; `#c-<id>` / `#l-<id>` links |
| `js/ui.js` | Toasts, dialogs, menus, shortcut sheet |
| `js/views/*` | `shell` (rail), `home`, `course`, `lecture`, `parts` (shared rows/dialogs) |
| `js/features/index.js` | Where features are imported (their order = order in the class bar) |
| `js/features/classroom.js` | Listen + transcript; the shared per-lecture `room()` |
| `js/features/autonotes.js` | Auto notes (the prompt lives here) |
| `js/features/breaks.js` | Bathroom break with catch-up and timing advice; silent phone timer |
| `js/features/questions.js` | `??` → Question blocks; the To ask panel |
| `js/features/sheets.js` | Words (from #tags) and the AI principles sheet per course |
| `js/features/export.js` | End lesson and the PDF |
| `js/features/settings.js` | AI key check, listening language, sign out |
| `js/features/drawer.js` | The side panel the features share |

## Data model

```
courses/{id}      { name, code, color, order, createdAt }
lectures/{id}     { courseId, kind:'lecture'|'tutorial', number, title, date:'YYYY-MM-DD',
                    status:'live'|'review'|'done', catchUp, decks:[{id, name, pages}],
                    createdAt, updatedAt }
notes/{lectureId} { courseId, blocks:[Block], updatedAt, writer }

Block = { id, type, md, at:{d:deckAssetId, p:page}|null, done?, img?:{asset, w, h} }
```

sheets/{courseId}:principles { courseId, kind, md, updatedAt }
```

## Backend (Supabase project `lecture-desk`, free tier)

- `docs` table: one row per document `(user_id, col, id, data jsonb)`.
- `transcript` table: one row per recognised phrase `(lecture_id, t, text, slide)`.
- Storage bucket `files` (private): slide PDFs and snapshots under `<user id>/`.
  Downloaded files are cached in IndexedDB so slides open offline.
- Row-level security everywhere: owner only. Only one account can ever be created.
- Edge Functions: `setup` (creates the one account, reports whether it exists),
  `ai` (forwards prompts to Gemini with the `GEMINI_API_KEY` secret; tries
  3.8 Flash, then 3.6 Flash, then 3.5 Flash-Lite on free-tier limits).

```


## Adding a feature

1. Create `js/features/<name>.js`.
2. Register what it adds:
   ```js
   // UI inside an open lecture (the class bar, panels); return a cleanup function
   registry.addLectureMount((lec, { bar, page, paneNotes }) => { bar.append(myButton); return () => {}; });
   registry.addPrefix({ match: /^!!\s*/, type: 'trap' });   // typing shortcut
   import { registry } from '../registry.js';
   registry.addBlockType('proof', { label: 'Proof', tag: 'Pf', tone: 'thm' });
   registry.addSlash({ id: 'proof', group: 'Callouts', label: 'Proof', keys: 'proof הוכחה',
                       run: (a) => a.setType('proof') });
   registry.addCommand({ id: 'my-cmd', label: 'Do something', run: (ctx) => {} });
   registry.addLectureTool({ id: 'x', label: 'Tool', icon: 'question', run: (lec) => {
     // lec.editor, lec.viewer, lec.lecture(), lec.course, lec.setLayout(), lec.toast()
   } });
   ```
3. Import it in `js/features/index.js`.

New colours or tones: add tokens in `css/app.css` (`--t-*` / `--c-*`, both themes)
and a `[data-tone]` / `[data-color]` rule.

Slash-menu `run(api)`: `api.insert(template)` (‸ marks the caret),
`api.setType(type)`, `api.setPrefix('## ')`, `api.action('snapshot'|'slideText')`.

## Behaviour worth knowing

- **Anchoring**: a block takes the current slide when you first type in it;
  an empty block follows the slides until you type. The margin shows the slide
  number where it changes; notes for the slide on screen get a highlighter mark.
- **Saving**: each change is copied to this browser at once, then saved after
  ~1 s of quiet (at most 8 s while typing). Failed saves retry with backoff;
  the local copy is restored on the next open if needed.
- **Direction**: each paragraph picks LTR/RTL from its letters (Hebrew is
  weighted up), ignoring code and math.

## Ideas for later

Flashcards from Definition and Theorem blocks; "explain this slide"; a
course-wide exam-traps sheet.
