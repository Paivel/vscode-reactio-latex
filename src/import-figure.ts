/**
 * Copying a pasted figure's files into the project. Adapted from Lattice
 * (src-tauri/src/project/editable_figure.rs), Apache-2.0, Copyright 2026
 * Leonardo and the Lattice contributors: the same limits and the same names.
 *
 * The source and the outputs go into one folder under one shared name, so
 * the entry file's references to its siblings still hold after a rename.
 * Nothing is written over an existing file or through a link.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { EditableFigureManifest, ImportedFigure } from "./lattice/editable-figure";

/** The most a pasted figure may carry, all its files together. */
const MAX_FIGURE_BYTES = 64 * 1024 * 1024;
/** The most files one paste may carry, its source included. */
const MAX_FIGURE_FILES = 32;
/** Tries before giving up on a name that keeps being taken while writing. */
const WRITE_ATTEMPTS = 8;
/** Numbered names tried for one file before giving up. */
const MAX_NAME_NUMBER = 10_000;

/** The file types figures are drawn in, opened in the program the system has for them. */
export const DRAWING_EXTENSIONS = ["reactio", "cdxml", "cdx", "drawio", "dio", "ipe", "excalidraw", "ggb", "odg"];
/** What a figure's rendered files may be. */
const OUTPUT_EXTENSIONS = ["tex", "pdf", "pdf_tex", "png", "jpg", "svg", "eps"];

export const NO_FREE_NAME = "No free name was found for the figure.";
const TOO_LARGE = "The figure is too large to import.";

export class FigureError extends Error {}

export const extensionOf = (name: string) => {
  const base = path.basename(name);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
};

/** A plain name: one path component of letters, digits, spaces, `.`, `_` and `-`, so it reaches `\input{…}` intact. */
export function fileNameOf(name: string): string {
  if (!name || name === "." || name === ".." || name.length > 255 || !/^[A-Za-z0-9 ._-]+$/.test(name)) {
    throw new FigureError("The figure names a file without a usable name.");
  }
  return name;
}

/** The bytes of one file, counted against what the whole paste may carry. */
function bytesOf(data: string, budget: { left: number }): Buffer {
  const text = data.trim();
  // Checked before decoding, so an oversized paste is never held twice.
  if (Math.floor(text.length / 4) * 3 > budget.left + 3) throw new FigureError(TOO_LARGE);
  if (!/^[A-Za-z0-9+/\s]*={0,2}\s*$/.test(text)) throw new FigureError("Could not decode the figure.");
  const bytes = Buffer.from(text, "base64");
  budget.left -= bytes.length;
  if (budget.left < 0) throw new FigureError(TOO_LARGE);
  return bytes;
}

/** Only file types a figure is made of come in from a paste. */
function checkTypes(named: [string, Buffer][], entry: string) {
  const source = extensionOf(named[0][0]);
  const sourceAllowed = source === "svg" || DRAWING_EXTENSIONS.includes(source);
  const outputsAllowed = named.slice(1).every(([name]) => OUTPUT_EXTENSIONS.includes(extensionOf(name)));
  if (!sourceAllowed || !outputsAllowed || extensionOf(entry) !== "tex") {
    throw new FigureError("The figure carries a file type this extension does not import.");
  }
}

/** Whether anything is at `file`, a link that leads nowhere included. */
function taken(file: string): boolean {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

const carriesStem = (name: string, stem: string) => name.startsWith(stem) && name[stem.length] === ".";

/** `name` with `stem` swapped for `next` when it starts with `stem.`. */
const renamed = (name: string, stem: string, next: string) => (carriesStem(name, stem) ? next + name.slice(stem.length) : name);

/** `name`, then `name-2`, `name-3`, … (before the extension). */
export function* numbered(name: string): Generator<string> {
  const dot = name.lastIndexOf(".");
  const [base, rest] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  yield name;
  for (let number = 2; number < MAX_NAME_NUMBER; number += 1) yield `${base}-${number}${rest}`;
}

const find = (names: Iterable<string>, test: (name: string) => boolean) => {
  for (const name of names) if (test(name)) return name;
  throw new FigureError(NO_FREE_NAME);
};

/**
 * Where each file goes. Files carrying the entry's stem move together, so the
 * entry's references hold; any other file finds a free name of its own. LaTeX
 * looks in the document's folder before `\graphicspath`, so a name taken
 * there counts too.
 */
export function planNames(root: string, target: string, names: string[], stem: string): { next: string; renames: [string, string][] } {
  const free = (file: string) => !taken(path.join(target, file)) && !taken(path.join(root, file));
  const next = find(numbered(stem), (candidate) => names.filter((name) => carriesStem(name, stem)).every((name) => free(renamed(name, stem, candidate))));
  const used = new Set(names.map((name) => renamed(name, stem, next)).filter((name) => carriesStem(name, next)));
  const renames: [string, string][] = names.map((name) => {
    if (carriesStem(name, stem)) return [name, renamed(name, stem, next)];
    const to = find(numbered(name), (candidate) => free(candidate) && !used.has(candidate));
    used.add(to);
    return [name, to];
  });
  return { next, renames };
}

/**
 * `text` with each whole file name of `renames` replaced: a name preceded by
 * a letter, digit, `_` or `-` is part of a longer name and kept.
 */
export function rewriteNames(text: string, renames: [string, string][]): string {
  let out = text;
  for (const [from, to] of renames.filter(([a, b]) => a !== b)) {
    let next = "";
    let rest = out;
    for (let index = rest.indexOf(from); index >= 0; index = rest.indexOf(from)) {
      const joined = index > 0 && /[A-Za-z0-9_-]/.test(rest[index - 1]);
      next += rest.slice(0, index) + (joined ? from : to);
      rest = rest.slice(index + from.length);
    }
    out = next + rest;
  }
  return out;
}

class NameTaken extends Error {}

/** Writes the whole set, or nothing: what this try created goes if one fails. */
function writeAllNew(target: string, files: [string, Buffer][], entry: string, renames: [string, string][]) {
  const created: string[] = [];
  try {
    files.forEach(([name, bytes], index) => {
      let data = bytes;
      if (name === entry) {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        data = Buffer.from(rewriteNames(text, renames), "utf8");
      }
      const destination = path.join(target, renames[index][1]);
      let handle: number;
      try {
        // `wx`: a new file only, never through a link.
        handle = fs.openSync(destination, "wx");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new NameTaken();
        throw error;
      }
      created.push(destination);
      try {
        fs.writeSync(handle, data);
      } finally {
        fs.closeSync(handle);
      }
    });
  } catch (error) {
    for (const file of created) fs.rmSync(file, { force: true });
    if (error instanceof TypeError) throw new FigureError("The figure's file to include is not text.");
    throw error;
  }
}

const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

/**
 * Copies a pasted figure into `targetDirectory` (relative to `root`, the
 * folder the root document is built in; created when missing). Returns where
 * it landed, relative to `root` with `/` separators. A dry run checks the
 * paste and names where it would land, writing nothing.
 */
export function importEditableFigure(root: string, manifest: EditableFigureManifest, targetDirectory: string, { dryRun = false } = {}): ImportedFigure {
  if (manifest.version !== 1) throw new FigureError("This figure was made for a newer version of the editable-figure format.");
  if (!targetDirectory || path.isAbsolute(targetDirectory) || targetDirectory.split(/[\\/]/).some((part) => part === ".." || part === "")) {
    throw new FigureError("The figures folder must be a folder inside the project.");
  }
  const files = [manifest.source, ...manifest.outputs];
  if (files.length > MAX_FIGURE_FILES) throw new FigureError("The figure carries too many files.");
  const budget = { left: MAX_FIGURE_BYTES };
  const named: [string, Buffer][] = files.map((file) => [fileNameOf(file.name), bytesOf(file.data, budget)]);
  // Compared as a case-insensitive file system would.
  if (new Set(named.map(([name]) => name.toLowerCase())).size !== named.length) throw new FigureError("The figure names one file twice.");
  let entry: string;
  try {
    entry = fileNameOf(manifest.entry);
  } catch {
    throw new FigureError("The figure names no file to include.");
  }
  if (!named.slice(1).some(([name]) => name === entry)) throw new FigureError("The figure's file to include is not among its files.");
  checkTypes(named, entry);
  const packages = (manifest.packages ?? []).filter((name) => /^[A-Za-z0-9-]+$/.test(name));

  const realRoot = fs.realpathSync(root);
  const target = path.join(realRoot, targetDirectory);
  // Each existing part of the way must be a real folder inside the project, not a link out of it.
  if (!dryRun) fs.mkdirSync(target, { recursive: true });
  const realTarget = dryRun && !taken(target) ? target : fs.realpathSync(target);
  if (!inside(realRoot, realTarget) || (taken(realTarget) && !fs.statSync(realTarget).isDirectory())) throw new FigureError("The figures folder leads outside the project.");
  const stem = entry.replace(/\.[^.]*$/, "") || "figure";
  const names = named.map(([name]) => name);
  const directory = path.relative(realRoot, realTarget).split(path.sep).join("/");
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    const { next, renames } = planNames(realRoot, realTarget, names, stem);
    try {
      if (!dryRun) writeAllNew(realTarget, named, entry, renames);
    } catch (error) {
      // Something took a name since it was chosen: choose again.
      if (error instanceof NameTaken) continue;
      throw error;
    }
    return { directory, entry: renamed(entry, stem, next), source: `${directory ? `${directory}/` : ""}${renames[0][1]}`, packages };
  }
  throw new FigureError(NO_FREE_NAME);
}
