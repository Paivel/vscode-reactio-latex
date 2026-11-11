/**
 * The article for a journal that builds the LaTeX itself: one `.tex`, with
 * the project's own `\input` and `\include` files written into it, and each
 * figure made from a drawing as `\includegraphics{Scheme1}`, the exported file.
 * The figure's marks stay in an unprinted box right after it, so every
 * compound keeps its number in the text.
 */
import * as path from "node:path";

export type SubmissionFigure = {
  /** The entry file's name as the export build recorded it (`scheme.tex`). */
  file: string;
  /** The exported file's name without extension (`Scheme1`). */
  name: string;
};

export type SubmissionTexInput = {
  /** The root document, an absolute path. */
  root: string;
  /** The figures in the order the export build placed them. */
  figures: readonly SubmissionFigure[];
  /** The figures' entry files, absolute paths. */
  entries: readonly string[];
  read: (file: string) => string | null;
  exists: (file: string) => boolean;
};

export type SubmissionTex = {
  text: string;
  /** Other files the article needs (images, .bib), relative to the root's folder. */
  assets: string[];
  /** Entry files that stayed as `\input`: the export build placed no figure for them. */
  unmatched: string[];
};

const INCLUDE = /\\(input|include)\s*\{([^{}]*)\}/g;
const MARK = /\\rcmpd\s*\{[^{}]*\}/g;
const GRAPHICS = /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g;
const GRAPHICS_EXTENSIONS = ["", ".pdf", ".png", ".jpg", ".jpeg", ".eps"];
const MAX_DEPTH = 20;

const withTex = (name: string) => (/\.[A-Za-z]+$/.test(name) ? name : `${name}.tex`);

/** A line split before its comment: the first `%` not escaped by a backslash. */
function splitComment(line: string): [string, string] {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") {
      i++;
      continue;
    }
    if (line[i] === "%") return [line.slice(0, i), line.slice(i)];
  }
  return [line, ""];
}

/** The code of a text, comments blanked. */
const codeOf = (text: string) => text.split(/\r?\n/).map((line) => splitComment(line)[0]).join("\n");

/** Whether `file` lies inside `dir`. */
const inside = (dir: string, file: string) => {
  const rel = path.relative(dir, file);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
};

export function submissionTex(input: SubmissionTexInput): SubmissionTex {
  const rootDir = path.dirname(input.root);
  const entries = new Set(input.entries.map((entry) => path.resolve(entry)));
  // Each entry's exported names, in placing order: an entry included twice gives two figures.
  const queues = new Map<string, string[]>();
  for (const figure of input.figures) {
    const key = path.basename(figure.file);
    queues.set(key, [...(queues.get(key) ?? []), figure.name]);
  }
  const unmatched: string[] = [];
  const names = new Set(input.figures.map((figure) => figure.name));

  const figureText = (entry: string, original: string) => {
    const name = queues.get(path.basename(entry))?.shift();
    if (!name) {
      unmatched.push(path.relative(rootDir, entry));
      return original;
    }
    const marks = (codeOf(input.read(entry) ?? "").match(MARK) ?? []).join("");
    return `\\includegraphics{${name}}` + (marks ? `\\begingroup\\setbox0\\hbox{${marks}}\\endgroup` : "");
  };

  const flatten = (file: string, text: string, depth: number, open: Set<string>): string =>
    text.split(/\r?\n/).map((line) => {
      const [code, comment] = splitComment(line);
      const replaced = code.replace(INCLUDE, (whole, command: string, name: string) => {
        const candidates = [path.resolve(rootDir, withTex(name.trim())), path.resolve(path.dirname(file), withTex(name.trim()))];
        const found = candidates.find((candidate) => input.exists(candidate));
        if (!found) return whole;
        if (entries.has(found)) return figureText(found, whole);
        if (!found.endsWith(".tex") || !inside(rootDir, found) || depth >= MAX_DEPTH || open.has(found)) return whole;
        const body = input.read(found);
        if (body === null) return whole;
        const inner = flatten(found, body.replace(/\s+$/, ""), depth + 1, new Set([...open, found]));
        const marked = `% ${path.relative(rootDir, found).split(path.sep).join("/")}\n${inner}\n`;
        return command === "include" ? `\\clearpage\n${marked}\\clearpage\n` : marked;
      });
      return replaced + comment;
    }).join("\n");

  const text = flatten(input.root, input.read(input.root) ?? "", 0, new Set([input.root]));
  const code = codeOf(text);

  // The images and bibliographies the article names, found as LaTeX would find them.
  const assets = new Set<string>();
  const graphicsDirs = [""];
  for (const match of code.matchAll(/\\graphicspath\s*\{((?:\{[^{}]*\})*)\}/g)) {
    for (const dir of match[1].matchAll(/\{([^{}]*)\}/g)) graphicsDirs.push(dir[1]);
  }
  const addAsset = (candidates: string[]) => {
    const found = candidates.map((candidate) => path.resolve(rootDir, candidate)).find((candidate) => inside(rootDir, candidate) && input.exists(candidate));
    if (found) assets.add(path.relative(rootDir, found).split(path.sep).join("/"));
  };
  for (const match of code.matchAll(GRAPHICS)) {
    const name = match[1].trim().replace(/^"(.*)"$/, "$1");
    if (!name || names.has(name)) continue;
    addAsset(graphicsDirs.flatMap((dir) => GRAPHICS_EXTENSIONS.map((ext) => path.join(dir, name + ext))));
  }
  for (const match of code.matchAll(/\\bibliography\s*\{([^{}]*)\}/g)) {
    for (const name of match[1].split(",").map((part) => part.trim()).filter(Boolean)) addAsset([/\.bib$/i.test(name) ? name : `${name}.bib`]);
  }
  for (const match of code.matchAll(/\\addbibresource\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g)) addAsset([match[1].trim()]);

  return { text: text.endsWith("\n") ? text : `${text}\n`, assets: [...assets], unmatched };
}
