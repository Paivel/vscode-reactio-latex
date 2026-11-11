/**
 * Where a LaTeX source belongs: its root document (the one with
 * `\begin{document}`, which LaTeX is run on, from its own folder), the files
 * that root brings in, and the `.aux` files its last build wrote.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseAux } from "./lattice/compiled-labels";

const BEGIN_DOCUMENT = /^[^%\n]*\\begin\s*\{document\}/m;
const MAGIC_ROOT = /^\s*%\s*!\s*TeX\s+root\s*=\s*(.+?)\s*$/im;
const INCLUDES = /\\(?:(sub)?import\*?\{([^{}]*)\}\{([^{}]*)\}|(?:input|include|subfile)\{([^{}]*)\})/g;
/** A longer file is not one anyone writes by hand; it is read as empty. */
export const MAX_SOURCE_CHARS = 2_000_000;
const MAX_AUX_CHARS = 4_000_000;
const MAX_AUX_INPUTS = 300;

export const isRootText = (text: string) => BEGIN_DOCUMENT.test(text);

export function readText(file: string, limit = MAX_SOURCE_CHARS): string {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > limit * 4) return "";
    const text = fs.readFileSync(file, "utf8");
    return text.length > limit ? "" : text;
  } catch {
    return "";
  }
}

const withTex = (name: string) => (/\.[A-Za-z]+$/.test(name) ? name : `${name}.tex`);
const blankComments = (text: string) => text.replace(/(?<!\\)%.*$/gm, "");

/** The `\TeX root` a file names in its first lines, as an absolute path, or null. */
export function magicRoot(file: string, text: string): string | null {
  const head = text.split(/\r?\n/, 20).join("\n");
  const name = MAGIC_ROOT.exec(head)?.[1];
  return name ? path.resolve(path.dirname(file), withTex(name)) : null;
}

/** The files a source includes, as absolute paths that exist: from the root's folder or beside the including file. */
export function includedFiles(file: string, text: string, rootDir: string): string[] {
  const out: string[] = [];
  for (const match of blankComments(text).matchAll(INCLUDES)) {
    const names = match[4] !== undefined
      ? [path.resolve(rootDir, withTex(match[4])), path.resolve(path.dirname(file), withTex(match[4]))]
      : match[1]
        ? [path.resolve(path.dirname(file), match[2], withTex(match[3]))]
        : [path.resolve(rootDir, match[2], withTex(match[3])), path.resolve(path.dirname(file), match[2], withTex(match[3]))];
    const found = names.find((name) => fs.existsSync(name));
    if (found) out.push(found);
  }
  return out;
}

/** Whether `root` brings in `target`, through any depth of includes. */
export function rootIncludes(root: string, target: string, read: (file: string) => string = readText): boolean {
  const rootDir = path.dirname(root);
  const seen = new Set<string>([root]);
  const queue = [root];
  while (queue.length && seen.size < 500) {
    const file = queue.shift() as string;
    for (const included of includedFiles(file, read(file), rootDir)) {
      if (samePath(included, target)) return true;
      if (!seen.has(included)) {
        seen.add(included);
        queue.push(included);
      }
    }
  }
  return false;
}

const samePath = (a: string, b: string) => path.resolve(a) === path.resolve(b);

export type RootDocument = {
  /** The root document, or null when none is known: the file is then built on its own. */
  root: string | null;
  /** The folder LaTeX runs in: the root's, or the file's own. */
  rootDir: string;
};

/**
 * The root document of `file`: a `% !TeX root` comment, the file itself when
 * it has `\begin{document}`, or a document among `candidates` that includes it.
 */
export function findRoot(file: string, text: string, candidates: readonly string[], read: (file: string) => string = readText): RootDocument {
  const magic = magicRoot(file, text);
  if (magic && fs.existsSync(magic)) return { root: magic, rootDir: path.dirname(magic) };
  if (isRootText(text)) return { root: file, rootDir: path.dirname(file) };
  for (const candidate of candidates) {
    if (samePath(candidate, file)) continue;
    if (isRootText(read(candidate)) && rootIncludes(candidate, file, read)) return { root: candidate, rootDir: path.dirname(candidate) };
  }
  return { root: null, rootDir: path.dirname(file) };
}

/** A LaTeX Workshop `outDir` with its placeholders filled in for `root`. */
export function outputDirectory(setting: string, root: string, workspaceFolder: string | undefined): string {
  const rootDir = path.dirname(root);
  const value = setting
    .replace(/%DIR%|%DIR_W32%/g, rootDir)
    .replace(/%WORKSPACE_FOLDER%|%WORKSPACE_FOLDER_W32%/g, workspaceFolder ?? rootDir)
    .replace(/%RELATIVE_DIR%/g, workspaceFolder ? path.relative(workspaceFolder, rootDir) : ".")
    .replace(/%DOCFILE%/g, path.basename(root).replace(/\.tex$/i, ""));
  return path.resolve(rootDir, value);
}

/** The text of the last build's `.aux` files: the root document's, and each chapter's it names. */
export function auxTexts(root: string, directories: readonly string[]): string[] {
  const name = path.basename(root).replace(/\.tex$/i, ".aux");
  for (const directory of [...new Set(directories)]) {
    const main = readText(path.join(directory, name), MAX_AUX_CHARS);
    if (!main) continue;
    return [main, ...parseAux(main).inputs.slice(0, MAX_AUX_INPUTS).map((input) => readText(path.join(directory, input), MAX_AUX_CHARS))];
  }
  return [];
}

/** A path from `from` to `to`, with `/`, as LaTeX and the compound lists name project files. */
export const projectPath = (from: string, to: string) => path.relative(from, to).split(path.sep).join("/");
