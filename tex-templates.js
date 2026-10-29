// Starter documents for new ThinkerTex projects. Plain strings, no placeholders to fill in by hand.
const BS = String.fromCharCode(92); // a backslash, so these stay readable and safe in any tool
const tex = (lines) => lines.join('\n') + '\n';
const b = (name) => BS + name;

const TEMPLATES = {
  article: {
    label: 'Article',
    description: 'A short paper with sections, a maths example and a table.',
    files: {
      'main.tex': tex([
        b('documentclass[11pt]{article}'),
        b('usepackage[utf8]{inputenc}'),
        b('usepackage{amsmath,amssymb}'),
        b('usepackage{booktabs}'),
        b('usepackage{graphicx}'),
        b('usepackage[hidelinks]{hyperref}'),
        '',
        b('title{Untitled paper}'),
        b('author{Your name}'),
        b('date{') + b('today}'),
        '',
        b('begin{document}'),
        b('maketitle'),
        '',
        b('begin{abstract}'),
        'A short summary of what this paper is about.',
        b('end{abstract}'),
        '',
        b('section{Introduction}'),
        'Start writing here. You can use ' + b('textbf{bold}') + ', ' + b('emph{emphasis}') + ' and inline maths like $e^{i' + b('pi') + '} + 1 = 0$.',
        '',
        b('section{Method}'),
        b('begin{equation}'),
        '  E = mc^2',
        b('end{equation}'),
        '',
        b('begin{table}[h]'),
        b('centering'),
        b('begin{tabular}{lr}'),
        b('toprule'),
        'Item & Value ' + BS + BS,
        b('midrule'),
        'First & 1 ' + BS + BS,
        'Second & 2 ' + BS + BS,
        b('bottomrule'),
        b('end{tabular}'),
        b('caption{A small table.}'),
        b('end{table}'),
        '',
        b('end{document}')
      ])
    }
  },
  report: {
    label: 'Report',
    description: 'Chapters, a table of contents and a bibliography file.',
    files: {
      'main.tex': tex([
        b('documentclass[11pt]{report}'),
        b('usepackage[utf8]{inputenc}'),
        b('usepackage{amsmath}'),
        b('usepackage{graphicx}'),
        b('usepackage[hidelinks]{hyperref}'),
        '',
        b('title{Untitled report}'),
        b('author{Your name}'),
        '',
        b('begin{document}'),
        b('maketitle'),
        b('tableofcontents'),
        '',
        b('chapter{Introduction}'),
        'Write the first chapter here.',
        '',
        b('chapter{Findings}'),
        b('section{First result}'),
        'Describe what you found, and cite a source ' + b('cite{example2024}') + '.',
        '',
        b('bibliographystyle{plain}'),
        b('bibliography{refs}'),
        b('end{document}')
      ]),
      'refs.bib': tex([
        '@article{example2024,',
        '  author  = {Author, Example},',
        '  title   = {An example entry to replace},',
        '  journal = {Journal of Examples},',
        '  year    = {2024}',
        '}'
      ])
    }
  },
  beamer: {
    label: 'Slides',
    description: 'A short slide deck (Beamer).',
    files: {
      'main.tex': tex([
        b('documentclass{beamer}'),
        b('usetheme{default}'),
        b('title{Untitled talk}'),
        b('author{Your name}'),
        '',
        b('begin{document}'),
        b('frame{') + b('titlepage}'),
        '',
        b('begin{frame}{First slide}'),
        b('begin{itemize}'),
        '  ' + b('item A point worth making'),
        '  ' + b('item Another point'),
        b('end{itemize}'),
        b('end{frame}'),
        '',
        b('end{document}')
      ])
    }
  },
  letter: {
    label: 'Letter',
    description: 'A formal letter.',
    files: {
      'main.tex': tex([
        b('documentclass{letter}'),
        b('usepackage[utf8]{inputenc}'),
        b('signature{Your name}'),
        b('address{Your address ') + BS + BS + ' City}',
        '',
        b('begin{document}'),
        b('begin{letter}{Recipient ') + BS + BS + ' Their address}',
        b('opening{Dear Sir or Madam,}'),
        'Write your letter here.',
        b('closing{Yours faithfully,}'),
        b('end{letter}'),
        b('end{document}')
      ])
    }
  },
  blank: {
    label: 'Blank',
    description: 'Just the bare minimum.',
    files: {
      'main.tex': tex([b('documentclass{article}'), b('begin{document}'), '', b('end{document}')])
    }
  }
};

function listTemplates() {
  return Object.entries(TEMPLATES).map(([id, t]) => ({ id, label: t.label, description: t.description }));
}

module.exports = { TEMPLATES, listTemplates };
