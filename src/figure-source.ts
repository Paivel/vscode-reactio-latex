/** Finding the drawing a figure was made from, and how it may be opened. */
import * as fs from "node:fs";
import * as path from "node:path";
import { DRAWING_EXTENSIONS, extensionOf } from "./import-figure";
import { includedTexPaths } from "./lattice/editable-figure";

const HEADER = "% editable-figure source: ";

/** The first line of a file, read without the rest. */
function firstLine(file: string): string {
  let handle: number | undefined;
  try {
    handle = fs.openSync(file, "r");
    const buffer = Buffer.alloc(2048);
    const read = fs.readSync(handle, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, read).toString("utf8").split(/\r?\n/, 1)[0];
  } catch {
    return "";
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

/** The drawing an entry file names in its first line, as an absolute path; null for any other file. */
export function sourceOfEntry(entry: string, firstLineText = firstLine(entry)): string | null {
  if (firstLineText.length > 1024 || !firstLineText.startsWith(HEADER)) return null;
  const name = firstLineText.slice(HEADER.length).trimEnd();
  // Relative to the entry; whether it stays in the project is checked when it is opened.
  if (!name || name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:/.test(name)) return null;
  return path.resolve(path.dirname(entry), ...name.split("/"));
}

/** The drawing of a figure's `.tex` or `.pdf`: the `.tex` itself, or the `.tex` beside a `.pdf`. */
export function sourceOfFigureFile(file: string): string | null {
  const ext = extensionOf(file);
  if (ext === "tex") return sourceOfEntry(file);
  if (ext === "pdf" || ext === "png" || ext === "svg" || ext === "eps" || ext === "pdf_tex") {
    const tex = file.replace(/\.(?:pdf|png|svg|eps|pdf_tex)$/i, ".tex");
    if (tex !== file && fs.existsSync(tex)) return sourceOfEntry(tex);
  }
  if (DRAWING_EXTENSIONS.includes(ext)) return file;
  return null;
}

/** The figures included on a source line, each with its drawing: entry files that name one. */
export function figuresOnLine(line: string, file: string, rootDir: string): { entry: string; source: string }[] {
  if (!line.includes("\\")) return [];
  const found: { entry: string; source: string }[] = [];
  const seen = new Set<string>();
  // `includedTexPaths` gives paths from a project root; both the root's folder and the file's own are tried.
  for (const base of [rootDir, path.dirname(file)]) {
    for (const relative of includedTexPaths(line, "x")) {
      const entry = path.resolve(base, relative);
      if (seen.has(entry) || !fs.existsSync(entry)) continue;
      seen.add(entry);
      const source = sourceOfEntry(entry);
      if (source) found.push({ entry, source });
    }
  }
  return found;
}

export type Opening = { kind: "open"; file: string } | { kind: "ask"; file: string } | { kind: "reveal"; file: string } | { kind: "refuse"; reason: string };

const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

/**
 * How a figure's drawing is shown. A project names the file, and a project
 * may come from anyone, so only drawing formats run in another program; an
 * SVG opens only once the user agrees, each time, since its program is often
 * a browser; anything else is only revealed. It must be inside one of `roots`.
 */
export function openingFor(source: string, roots: readonly string[]): Opening {
  let real: string;
  try {
    real = fs.realpathSync(source);
  } catch {
    return { kind: "refuse", reason: `The drawing ${path.basename(source)} is not there.` };
  }
  const realRoots = roots.flatMap((root) => {
    try {
      return [fs.realpathSync(root)];
    } catch {
      return [];
    }
  });
  if (!realRoots.some((root) => inside(root, real))) return { kind: "refuse", reason: "The drawing is outside the project." };
  if (!fs.statSync(real).isFile()) return { kind: "refuse", reason: "The drawing is not a file." };
  const ext = extensionOf(real);
  if (DRAWING_EXTENSIONS.includes(ext)) return { kind: "open", file: real };
  if (ext === "svg") return { kind: "ask", file: real };
  return { kind: "reveal", file: real };
}

/** What the program for a drawing is called on a button. */
export const editLabel = (source: string) => (extensionOf(source) === "reactio" ? "Edit in Reactio Draw" : `Edit figure source (${path.basename(source)})`);
