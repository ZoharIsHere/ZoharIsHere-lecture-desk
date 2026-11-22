// features/index.js — optional features plug in here.
//
// A feature is one file that registers what it adds through js/registry.js
// (block types, "/" entries, Ctrl+K commands, typing shortcuts, and
// addLectureMount for UI inside an open lecture). Order here = order in the
// class bar under the lecture title.

import './classroom.js';   // Listen + transcript (L)
import './autonotes.js';   // Auto notes (A)
import './breaks.js';      // Bathroom and phone breaks (B)
import './questions.js';   // ?? questions → "To ask" (Q)
import './sheets.js';      // Words and principles summaries (W)
import './export.js';      // End lesson → PDF
import './settings.js';    // Settings (AI key check, language, account)
