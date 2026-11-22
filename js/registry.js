// registry.js — the extension points.
//
// Every feature registers what it adds here, and the views read from here.
// To add a feature later, create a file in js/features/, register its
// pieces, and import it from js/features/index.js. Nothing else changes.
//
//   blockTypes    kinds of note blocks (Definition, Question, Snapshot…)
//   slash         entries in the "/" menu inside the editor
//   commands      entries in the Ctrl+K palette
//   lectureTools  extra buttons in the lecture header
//   lectureMounts features that add UI to an open lecture (class bar, panels)
//   courseColors  the colour choices for courses (tokens live in app.css)

export const registry = {
  blockTypes: new Map(),
  slash: [],
  commands: [],
  lectureTools: [],
  lectureMounts: [],
  prefixes: [],
  courseColors: [
    { id: 'teal', label: 'Teal' },
    { id: 'oxblood', label: 'Oxblood' },
    { id: 'ink', label: 'Ink blue' },
    { id: 'ochre', label: 'Ochre' },
    { id: 'violet', label: 'Violet' },
    { id: 'graphite', label: 'Graphite' },
  ],

  /** def: { label, tag?, tone?, checkable?, media?, convertible? } */
  addBlockType(id, def) { this.blockTypes.set(id, { id, convertible: true, ...def }); },

  /**
   * cmd: { id, label, hint?, keys?, group?, run(api) }
   * api: { block, insert(tpl), setType(t), setPrefix(p), action(name) }
   * In templates, "‸" marks where the caret lands.
   */
  addSlash(cmd) { this.slash.push(cmd); },

  /** cmd: { id, label, hint?, keys?, group?, when?(ctx), run(ctx) } */
  addCommand(cmd) {
    const i = this.commands.findIndex((c) => c.id === cmd.id);
    if (i >= 0) this.commands.splice(i, 1, cmd); else this.commands.push(cmd);
  },

  /**
   * Typing shortcut at the start of a block, applied when you leave the block.
   * p: { match: (a RegExp, e.g. two question marks), type: 'question', types?: ['text'] }
   */
  addPrefix(p) { this.prefixes.push(p); },

  /** tool: { id, label, icon, run(lectureCtx) } */
  addLectureTool(tool) { this.lectureTools.push(tool); },

  /**
   * fn(lec, parts) runs when a lecture opens; it may return a cleanup function.
   * lec:   { lecture(), course, editor, viewer, session, setLayout, toast }
   * parts: { page, head, body, paneNotes, paneSlides, bar }
   *        bar is the class bar under the header: append controls to it.
   */
  addLectureMount(fn) { this.lectureMounts.push(fn); },

  blockType(id) { return this.blockTypes.get(id) || this.blockTypes.get('text'); },
};
