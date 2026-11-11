/** What a project knows about its compounds: read from its `.tex` files and the last build's `.aux`. */
import * as path from "node:path";
import * as vscode from "vscode";
import { parseAux, type CompiledLabel } from "./lattice/compiled-labels";
import { parseCompoundNumbers } from "./lattice/compound-keys";
import { compoundPlaces, placeLine, type CompoundSource } from "./lattice/compound-places";
import { auxTexts, outputDirectory, projectPath } from "./project";
import { currentText, projectTexFiles, rootOf } from "./workspace";

export type CompoundProject = {
  sources: CompoundSource[];
  numbers: Map<string, string>;
  /** Each drawn key's "Scheme 1: …" line. */
  placeLines: Map<string, string>;
};

let cache: { key: string; at: number; project: Promise<CompoundProject> } | null = null;
/** Typing asks often; a project is read again after this long, or when a `.tex` or `.aux` changes on disk. */
const FRESH_MS = 3000;

export const invalidateCompounds = () => { cache = null; };

/** The `.aux` folders to look in: this extension's setting, LaTeX Workshop's `outDir`, and the root's own folder. */
function auxDirectories(root: string): string[] {
  const workspace = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(root))?.uri.fsPath;
  const own = vscode.workspace.getConfiguration("reactioLatex").get<string>("auxDirectory") ?? "";
  const outDir = vscode.workspace.getConfiguration("latex-workshop").get<string>("latex.outDir") ?? "%DIR%";
  return [...(own ? [outputDirectory(own, root, workspace)] : []), outputDirectory(outDir, root, workspace), path.dirname(root)];
}

export function compoundProject(document: vscode.TextDocument): Promise<CompoundProject> {
  const key = document.uri.toString();
  if (cache && cache.key === key && Date.now() - cache.at < FRESH_MS) return cache.project;
  const project = readProject(document);
  cache = { key, at: Date.now(), project };
  return project;
}

async function readProject(document: vscode.TextDocument): Promise<CompoundProject> {
  const root = await rootOf(document);
  const files = await projectTexFiles(document);
  const sources = files.map((file) => ({ path: projectPath(root.rootDir, file), text: currentText(file) }));
  const texts = root.root ? auxTexts(root.root, auxDirectories(root.root)) : [];
  const numbers = parseCompoundNumbers(texts.join("\n"));
  const labels: Map<string, CompiledLabel> | null = texts.length ? new Map(texts.flatMap((aux) => [...parseAux(aux).labels])) : null;
  const placeLines = new Map([...compoundPlaces(sources)].map(([key, place]) => [key, placeLine(place, labels, numbers)]));
  return { sources, numbers, placeLines };
}
