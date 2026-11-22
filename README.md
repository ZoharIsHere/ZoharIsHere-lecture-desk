# Lecture Desk

Lecture notes beside the slides, for CS lectures and tutorials. Live listening,
auto notes in your own style, bathroom and phone breaks with catch-ups,
questions to ask, living course summaries, and a PDF when the lesson ends.

**Open it:** https://zoharishere.github.io/ZoharIsHere-lecture-desk/

## Install on the Mac (Chrome)

1. Open the address above in Google Chrome.
2. Click the install icon at the right of the address bar
   (or ⋮ → Cast, save and share → Install page as app).
3. It gets its own Dock icon and opens in its own window.

## First run

1. **Create your account** on the first screen. It's the only account the app will ever accept.
2. **Turn on AI** (free): Settings (gear at the bottom left) → follow the three steps
   to put a free Gemini key into Supabase as `GEMINI_API_KEY`, then press **Check connection**.
   Everything except auto notes, catch-ups, break advice and summaries works without it.

## In class

| Key | |
|---|---|
| L | Listen: live transcript (Chrome's free recogniser; עברית / English button beside it) |
| A | Auto notes on/off: written in your style, skipping students' questions and filler; exam remarks become Exam traps |
| B | Break: bathroom (keeps listening, catch-up when you're back, "is now a good time?") or a silent phone timer |
| Q | To ask: every line you start with `??` |
| W | Summaries: your `#words` with meanings, and the OOP principles sheet (key ideas for other courses) |
| ⌘K | Search notes, lectures and commands |
| Alt ↑/↓ | Flip slides while typing |
| / | Definition, theorem, code, math, diagram… |

**End lesson** stops listening, writes the last auto notes, marks the lesson *To review*,
downloads the notes as `OOP Lecture 4 notes 2026-11-22.pdf` (never the slides' file name),
and refreshes the course summary.

Lectures and tutorials are numbered separately (L1, L2… and T1, T2…).

Try it without an account: add `?local` to the address (notes stay in that browser; no AI).

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it's built and how to add features.
