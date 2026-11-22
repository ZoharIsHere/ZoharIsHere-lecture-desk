// blocks.js — the built-in block types and "/" menu entries.
// Add a new kind of block or insert template by registering it here
// (or in a feature file); the editor picks it up automatically.

import { registry } from './registry.js';

// ---- Block types --------------------------------------------------------------
// tag:  the short label printed in the block's gutter
// tone: colour family in app.css ([data-tone="…"])
registry.addBlockType('text', { label: 'Text' });
registry.addBlockType('def', { label: 'Definition', tag: 'Def', tone: 'def', placeholder: 'Define the term. Tag it with #name for the glossary.' });
registry.addBlockType('thm', { label: 'Theorem', tag: 'Thm', tone: 'thm', placeholder: 'Theorem, lemma or claim' });
registry.addBlockType('example', { label: 'Example', tag: 'Ex', tone: 'ex', placeholder: 'Worked example' });
registry.addBlockType('trap', { label: 'Exam trap', tag: 'Trap', tone: 'trap', placeholder: 'What will catch people out in the exam?' });
registry.addBlockType('question', { label: 'Question', tag: '?', tone: 'q', checkable: true, placeholder: 'Question to ask in the tutorial' });
registry.addBlockType('image', { label: 'Snapshot', media: true, convertible: false, placeholder: 'Caption (optional)' });

// ---- "/" menu -----------------------------------------------------------------
// In templates, ‸ marks where the caret lands.
const S = (c) => registry.addSlash(c);

S({ id: 'heading', group: 'Structure', label: 'Heading', hint: '##', keys: 'h2 heading title section כותרת', run: (a) => a.setPrefix('## ') });
S({ id: 'subheading', group: 'Structure', label: 'Subheading', hint: '###', keys: 'h3 subheading subtitle', run: (a) => a.setPrefix('### ') });
S({ id: 'bullets', group: 'Structure', label: 'Bullet list', hint: '-', keys: 'list bullets ul רשימה', run: (a) => a.setPrefix('- ') });
S({ id: 'numbered', group: 'Structure', label: 'Numbered list', hint: '1.', keys: 'ol numbered steps', run: (a) => a.setPrefix('1. ') });
S({ id: 'checklist', group: 'Structure', label: 'Checklist', hint: '- [ ]', keys: 'todo task checkbox', run: (a) => a.setPrefix('- [ ] ') });
S({ id: 'quote', group: 'Structure', label: 'Quote', hint: '>', keys: 'quote blockquote ציטוט', run: (a) => a.setPrefix('> ') });

S({ id: 'def', group: 'Callouts', label: 'Definition', keys: 'definition def הגדרה', run: (a) => a.setType('def') });
S({ id: 'thm', group: 'Callouts', label: 'Theorem', keys: 'theorem lemma claim proof משפט טענה למה', run: (a) => a.setType('thm') });
S({ id: 'example', group: 'Callouts', label: 'Example', keys: 'example ex דוגמה', run: (a) => a.setType('example') });
S({ id: 'trap', group: 'Callouts', label: 'Exam trap', keys: 'trap exam pitfall warning מלכודת מבחן', run: (a) => a.setType('trap') });
S({ id: 'question', group: 'Callouts', label: 'Question for the TA', keys: 'question ask ta שאלה', run: (a) => a.setType('question') });
S({ id: 'text', group: 'Callouts', label: 'Plain text', keys: 'text paragraph plain normal', run: (a) => a.setType('text') });

S({ id: 'java', group: 'Code & math', label: 'Java code', hint: '```java', keys: 'java code oop', run: (a) => a.insert('```java\n‸\n```') });
S({ id: 'c', group: 'Code & math', label: 'C code', hint: '```c', keys: 'c code', run: (a) => a.insert('```c\n‸\n```') });
S({ id: 'code', group: 'Code & math', label: 'Code / pseudocode', hint: '```', keys: 'code pseudo pseudocode snippet', run: (a) => a.insert('```\n‸\n```') });
S({ id: 'math', group: 'Code & math', label: 'Math block', hint: '$$', keys: 'math equation latex formula נוסחה', run: (a) => a.insert('$$\n‸\n$$') });
S({ id: 'bigo', group: 'Code & math', label: 'Complexity', hint: '$O(n)$', keys: 'complexity big o runtime סיבוכיות', run: (a) => a.insert('$O(‸)$') });
S({ id: 'table', group: 'Code & math', label: 'Table', keys: 'table grid compare טבלה', run: (a) => a.insert('| Operation | Time |\n|---|---|\n| ‸ | |') });

S({ id: 'tree', group: 'Diagrams', label: 'Tree', keys: 'tree bst heap avl diagram עץ', run: (a) => a.insert('```mermaid\ngraph TD\n  r((8)) --> a((3))\n  r --> b((10))\n  a --> c((1))\n  a --> d((6))‸\n```') });
S({ id: 'list-diagram', group: 'Diagrams', label: 'Linked list', keys: 'linked list nodes pointers רשימה מקושרת', run: (a) => a.insert('```mermaid\ngraph LR\n  head([head]) --> n1[3] --> n2[7] --> n3[12] --> nil([null])‸\n```') });
S({ id: 'graph', group: 'Diagrams', label: 'Graph', keys: 'graph vertices edges bfs dfs גרף', run: (a) => a.insert('```mermaid\ngraph LR\n  A --- B\n  A --- C\n  B --- D\n  C --- D‸\n```') });
S({ id: 'class', group: 'Diagrams', label: 'Class diagram', keys: 'uml class inheritance interface oop מחלקה', run: (a) => a.insert('```mermaid\nclassDiagram\n  class Shape {\n    <<abstract>>\n    +area() double\n  }\n  class Circle {\n    -double r\n    +area() double\n  }\n  Shape <|-- Circle‸\n```') });
S({ id: 'flow', group: 'Diagrams', label: 'Flowchart', keys: 'flow flowchart algorithm steps תרשים', run: (a) => a.insert('```mermaid\nflowchart TD\n  s([start]) --> c{condition?}\n  c -- yes --> a[step]\n  c -- no --> e([end])‸\n```') });

S({ id: 'snapshot', group: 'From the slide', label: 'Snapshot of the slide', hint: 'S', keys: 'snapshot image screenshot capture crop תמונה', run: (a) => a.action('snapshot') });
S({ id: 'slidetext', group: 'From the slide', label: 'Text from the slide', keys: 'text copy extract slide טקסט', run: (a) => a.action('slideText') });
S({ id: 'divider', group: 'Structure', label: 'Divider', hint: '---', keys: 'divider rule line hr', run: (a) => a.insert('---‸') });
