/**
 * Export of figures for a journal, the TeX side: a file read before the
 * document that wraps each figure's entry file in a box, records where that
 * box lands in the PDF, and which float (Scheme 1, Figure 2) holds it.
 * Nothing in the document changes: the run writes to a scratch folder.
 */

/** A figure as the export run recorded it: its float and its box on a PDF page, in TeX points (sp/65536). */
export type PlacedFigure = {
  index: number;
  /** The float type it is in (`figure`, `scheme`, …), or `none`. */
  type: string;
  /** The float's number, if it has a caption. */
  number: number;
  /** The entry file's name. */
  file: string;
  /** 1-based page of the PDF. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
};

const SP_PER_PT = 65536;

/** The TeX read before the document. `entries` are the entry files' names (`scheme.tex`). It writes `<job>.figures` beside the PDF: TeX may write only there. */
export function exportHook(entries: readonly string[]): string {
  const list = entries.map((name) => name.replace(/[{}\\%#\r\n]/g, "")).join(",");
  return String.raw`% Reactio Draw figures for LaTeX: export of figures, read before the document
\makeatletter
\newcount\rcx@depth \global\rcx@depth=0
\newcount\rcx@open \global\rcx@open=-1000
\newcount\rcx@index \global\rcx@index=0
\newcount\rcx@page \global\rcx@page=0
\newbox\rcx@box
\newwrite\rcx@out
\immediate\openout\rcx@out=\jobname.figures
\edef\rcx@list{\detokenize{,${list},}}
\xdef\rcx@start{0}
\ifdefined\pdfsavepos\else\ifdefined\savepos
  \let\pdfsavepos\savepos \let\pdflastxpos\lastxpos \let\pdflastypos\lastypos
\fi\fi
\AddToHook{shipout/before}{\global\advance\rcx@page\@ne}
\AtBeginDocument{%
  \let\rcx@xfloat\@xfloat
  \def\@xfloat#1{\xdef\rcx@start{\ifcsname c@#1\endcsname\the\value{#1}\else 0\fi}\rcx@xfloat{#1}}%
}
\AddToHook{file/before}{%
  \global\advance\rcx@depth\@ne
  \ifnum\rcx@open=-1000
    \edef\rcx@cur{\noexpand\in@{,\detokenize\expandafter{\CurrentFile},}{\rcx@list}}%
    \rcx@cur
    \ifin@
      \global\rcx@open=\rcx@depth
      \xdef\rcx@file{\detokenize\expandafter{\CurrentFile}}%
      \leavevmode\setbox\rcx@box\hbox\bgroup
    \fi
  \fi}
\AddToHook{file/after}{%
  \ifnum\rcx@open=\rcx@depth
    \egroup
    \global\rcx@open=-1000
    \rcx@emit
  \fi
  \global\advance\rcx@depth\m@ne}
\def\rcx@emit{%
  \global\advance\rcx@index\@ne
  \edef\rcx@type{\ifx\@captype\@undefined none\else\@captype\fi}%
  \edef\rcx@do{\write\rcx@out{fig;\the\rcx@index;\rcx@type;\rcx@start;\rcx@file;\the\wd\rcx@box;\the\ht\rcx@box;\the\dp\rcx@box;\noexpand\the\rcx@page;\noexpand\the\pdflastxpos;\noexpand\the\pdflastypos}}%
  \pdfsavepos\rcx@do\box\rcx@box}
\makeatother
`;
}

const points = (value: string) => {
  const number = parseFloat(value);
  return Number.isFinite(number) ? number : NaN;
};

/** The figures an export run recorded, in the order the document includes them. */
export function parsePlacedFigures(text: string): PlacedFigure[] {
  const out: PlacedFigure[] = [];
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split(";");
    if (parts[0] !== "fig" || parts.length !== 11) continue;
    const [, index, type, start, file, wd, ht, dp, page, x, y] = parts;
    const figure: PlacedFigure = {
      index: Number(index),
      type: type.trim(),
      number: Number(start) + 1,
      file: file.trim(),
      page: Number(page),
      x: Number(x) / SP_PER_PT,
      y: Number(y) / SP_PER_PT,
      width: points(wd),
      height: points(ht),
      depth: points(dp),
    };
    if ([figure.index, figure.number, figure.page, figure.x, figure.y, figure.width, figure.height, figure.depth].every(Number.isFinite) && figure.width > 0) out.push(figure);
  }
  return out;
}

const KINDS: Record<string, string> = { figure: "Figure", scheme: "Scheme", chart: "Chart", graph: "Graph", table: "Table" };

/**
 * File names a journal expects, by function: `Scheme1`, `Figure2`; a second
 * figure in one float is `Scheme1b` (and the first `Scheme1a`). A figure in no
 * float keeps its own name.
 */
export function submissionNames(figures: readonly PlacedFigure[]): string[] {
  const base = figures.map((figure) => {
    const kind = KINDS[figure.type.replace(/\*$/, "")];
    return kind ? `${kind}${figure.number}` : figure.file.replace(/\.tex$/i, "");
  });
  const counts = new Map<string, number>();
  for (const name of base) counts.set(name, (counts.get(name) ?? 0) + 1);
  const seen = new Map<string, number>();
  return base.map((name) => {
    if ((counts.get(name) ?? 0) < 2) return name;
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    return `${name}${String.fromCharCode(97 + Math.min(n, 25))}`;
  });
}

/** The box on its page in PDF points (1/72 in), with a little margin: TeX points are 1/72.27 in. */
export function cropBox(figure: PlacedFigure, margin = 1): { left: number; bottom: number; right: number; top: number } {
  const bp = (pt: number) => (pt * 72) / 72.27;
  return {
    left: bp(figure.x) - margin,
    bottom: bp(figure.y - figure.depth) - margin,
    right: bp(figure.x + figure.width) + margin,
    top: bp(figure.y + figure.height) + margin,
  };
}
