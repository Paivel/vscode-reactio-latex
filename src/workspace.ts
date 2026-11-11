/** The workspace as the extension reads it: its `.tex` files, their current text, a file's root document. */
import * as path from "node:path";
import * as vscode from "vscode";
import { findRoot, readText, type RootDocument } from "./project";

/** Every `.tex` file of the document's workspace folder, for finding its root and its compounds. */
export async function projectTexFiles(document: vscode.TextDocument | vscode.Uri): Promise<string[]> {
  const uri = document instanceof vscode.Uri ? document : document.uri;
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  const pattern = folder ? new vscode.RelativePattern(folder, "**/*.tex") : new vscode.RelativePattern(vscode.Uri.file(path.dirname(uri.fsPath)), "*.tex");
  const files = await vscode.workspace.findFiles(pattern, "**/{node_modules,.git}/**", 300);
  return files.map((file) => file.fsPath).sort();
}

/** The text of a file: what the editor holds when it is open, else what is on disk. */
export function currentText(file: string): string {
  const open = vscode.workspace.textDocuments.find((document) => document.uri.scheme === "file" && path.resolve(document.uri.fsPath) === path.resolve(file));
  return open ? open.getText() : readText(file);
}

export async function rootOf(document: vscode.TextDocument): Promise<RootDocument> {
  const text = document.getText();
  if (/^[^%\n]*\\begin\s*\{document\}/m.test(text)) return { root: document.uri.fsPath, rootDir: path.dirname(document.uri.fsPath) };
  return findRoot(document.uri.fsPath, text, await projectTexFiles(document), currentText);
}

