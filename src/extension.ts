/**
 * Reactio Draw figures in LaTeX for VS Code: a figure copied with Copy for
 * LaTeX pastes with its files (an editable-figure manifest, see
 * docs/editable-figures.md in Lattice), its drawing opens from the source,
 * and compound marks show their numbers.
 */
import * as path from "node:path";
import { execFile } from "node:child_process";
import * as vscode from "vscode";
import { clipboardHtml } from "./clipboard";
import { compoundKeyAt, compoundSlot, markInsertion } from "./compound-text";
import { compoundProject, invalidateCompounds } from "./compounds";
import { compoundRows, type CompoundRow } from "./compound-list";
import { compoundCommand, compoundEntries, compoundKeysIn, numberedKey } from "./lattice/compound-keys";
import {
  editableFigureChanges, editableFigureFromHtml, editableFigureInclude, pastesFigureBlock, preambleFiles,
  preambleNeedsConfirmation, type EditableFigureManifest, type ImportedFigure,
} from "./lattice/editable-figure";
import { FigureError, importEditableFigure } from "./import-figure";
import { editLabel, figuresOnLine, openingFor, sourceOfEntry, sourceOfFigureFile } from "./figure-source";
import { isRootText, readText, rootIncludes, type RootDocument } from "./project";
import { figureNeeds } from "./figure-needs";
import { engineOf, exportFigures } from "./export-figures";
import { floatKind, type FloatKind } from "./float-kind";
import { currentText, projectTexFiles, rootOf } from "./workspace";

const SELECTOR: vscode.DocumentSelector = [
  { language: "latex", scheme: "file" },
  { language: "tex", scheme: "file" },
];
const PASTE_KIND = vscode.DocumentDropOrPasteEditKind.Empty.append("latex", "editableFigure");

const settings = () => vscode.workspace.getConfiguration("reactioLatex");

const offsets = (document: vscode.TextDocument, range: vscode.Range) => ({ from: document.offsetAt(range.start), to: document.offsetAt(range.end) });

/** The float for a pasted figure, as a VS Code snippet: the caption, then the label, then past the end. */
function figureBlockSnippet(figure: ImportedFigure, kind: FloatKind): vscode.SnippetString {
  return new vscode.SnippetString()
    .appendText(`\\begin{${kind.environment}}\n\t\\centering\n\t${editableFigureInclude(figure)}\n\t\\caption{`)
    .appendTabstop(1)
    .appendText(`}\n\t\\label{${kind.labelPrefix}`)
    .appendTabstop(2)
    .appendText(`}\n\\end{${kind.environment}}`)
    .appendTabstop(0);
}

/** What goes at the paste: a whole float on an empty line of the body, else the include line. */
function insertionFor(document: vscode.TextDocument, range: vscode.Range, figure: ImportedFigure, root: RootDocument): vscode.SnippetString {
  const text = document.getText();
  if (pastesFigureBlock(text, offsets(document, range))) {
    return figureBlockSnippet(figure, floatKind(root.root ? currentText(root.root) : text, settings().get<string>("paste.float") || "auto"));
  }
  return new vscode.SnippetString().appendText(editableFigureInclude(figure));
}

/** Copies the figure's files into the project (or, in a dry run, names where they would go); null after telling the user why it could not. */
async function importFigure(document: vscode.TextDocument, manifest: EditableFigureManifest, dryRun = false): Promise<{ figure: ImportedFigure; root: RootDocument } | null> {
  const root = await rootOf(document);
  const folder = (settings().get<string>("figuresFolder") || "figures").replace(/^[/\\]+|[/\\]+$/g, "");
  try {
    const imported = importEditableFigure(root.rootDir, manifest, folder, { dryRun });
    return { figure: { ...imported, preamble: manifest.preamble }, root };
  } catch (error) {
    const message = error instanceof FigureError ? error.message : `Could not copy the figure's files: ${(error as Error).message}`;
    void vscode.window.showErrorMessage(message);
    return null;
  }
}

/**
 * Adds what the root document's preamble lacks for a pasted figure: its
 * packages, `\graphicspath` and the manifest's `preamble` lines. Lines that
 * are not plain definitions are shown first. Without a known root document,
 * a notice names the lines to add.
 */
let preambleQueue: Promise<unknown> = Promise.resolve();

/** One preamble change at a time: a paste and the files it writes both ask, and each must see the other's lines. */
function completePreamble(root: RootDocument, figure: ImportedFigure, options: { saveIfClean?: boolean } = {}): Promise<number> {
  const next = preambleQueue.then(() => completePreambleNow(root, figure, options), () => completePreambleNow(root, figure, options));
  preambleQueue = next.catch(() => undefined);
  return next;
}

async function completePreambleNow(root: RootDocument, figure: ImportedFigure, { saveIfClean = false } = {}): Promise<number> {
  if (!root.root) {
    const { unplaced } = editableFigureChanges("", { from: 0, to: 0 }, figure);
    const lines = unplaced.join("\n");
    const choice = await vscode.window.showInformationMessage(`No main document with \\begin{document} was found. Add to its preamble:\n${lines}`, "Copy lines");
    if (choice) await vscode.env.clipboard.writeText(lines);
    return 0;
  }
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(root.root));
  const known = figure.preamble?.length
    ? preambleFiles(document.getText()).map((file) => currentText(path.resolve(root.rootDir, file))).join("\n")
    : "";
  let placed = figure;
  if (preambleNeedsConfirmation(document.getText(), known, figure)) {
    const lines = (figure.preamble ?? []).join("\n");
    const add = await vscode.window.showWarningMessage("This figure wants to add these lines to the preamble. Add them?", { modal: true, detail: lines }, "Add");
    if (add !== "Add") placed = { ...figure, preamble: undefined };
  }
  // Read again: the text may have changed while the question was open.
  const text = document.getText();
  const { changes } = editableFigureChanges(text, { from: 0, to: 0 }, placed, known);
  const edits = changes.slice(1);
  if (!edits.length) return 0;
  const wasDirty = document.isDirty;
  const edit = new vscode.WorkspaceEdit();
  for (const change of edits) {
    const from = document.positionAt(change.from);
    edit.replace(document.uri, new vscode.Range(from, document.positionAt(change.to ?? change.from)), change.insert);
  }
  await vscode.workspace.applyEdit(edit);
  // A figure changed on disk rebuilds the document now: a main document that had no unsaved changes is saved with what it needs.
  if (saveIfClean && !wasDirty) await document.save();
  return edits.length;
}

/**
 * A figure's entry file written again (its drawing saved in its program):
 * each main document that includes it gets what the file now needs, such as
 * `chemnum` and `\rcmpd` for marks added since it was pasted.
 */
async function completeFigureNeeds(entry: string) {
  const text = readText(entry);
  if (!sourceOfEntry(entry, text.split(/\r?\n/, 1)[0])) return;
  const needs = figureNeeds(text);
  const candidates = await projectTexFiles(vscode.Uri.file(entry));
  for (const root of candidates.filter((file) => isRootText(currentText(file)) && rootIncludes(file, entry, currentText))) {
    const rootDir = path.dirname(root);
    const figure: ImportedFigure = {
      directory: path.relative(rootDir, path.dirname(entry)).split(path.sep).join("/"),
      entry: path.basename(entry),
      source: "",
      packages: needs.packages,
      preamble: needs.preamble,
    };
    const added = await completePreamble({ root, rootDir }, figure, { saveIfClean: true });
    if (added) vscode.window.setStatusBarMessage(`Reactio: added what ${path.basename(entry)} needs to the preamble of ${path.basename(root)}`, 5000);
  }
}

/**
 * A paste carrying a figure manifest: the include line (or a whole float) at
 * the caret. The files are written only once that text is in the document,
 * so a paste switched to plain text in the paste menu leaves none behind.
 */
class FigurePasteProvider implements vscode.DocumentPasteEditProvider {
  async provideDocumentPasteEdits(document: vscode.TextDocument, ranges: readonly vscode.Range[], dataTransfer: vscode.DataTransfer, _context: vscode.DocumentPasteEditContext, token: vscode.CancellationToken) {
    const html = await dataTransfer.get("text/html")?.asString();
    if (token.isCancellationRequested || !html) return undefined;
    const manifest = editableFigureFromHtml(html);
    if (!manifest) return undefined;
    const planned = await importFigure(document, manifest, true);
    if (!planned || token.isCancellationRequested) return undefined;
    const include = editableFigureInclude(planned.figure);
    const edit = new vscode.DocumentPasteEdit(insertionFor(document, ranges[0], planned.figure, planned.root), "Insert figure with its files", PASTE_KIND);
    const listener = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document !== document || !event.contentChanges.some((change) => change.text.includes(include))) return;
      listener.dispose();
      clearTimeout(timer);
      void placeFigure(document, manifest, planned.figure);
    });
    // Long enough for the paste to land; a paste not taken writes nothing.
    const timer = setTimeout(() => listener.dispose(), 30_000);
    return [edit];
  }
}

/** Writes a pasted figure's files and completes the preamble; a name taken since the paste was planned is corrected in the text. */
async function placeFigure(document: vscode.TextDocument, manifest: EditableFigureManifest, planned: ImportedFigure) {
  const imported = await importFigure(document, manifest);
  if (!imported) return;
  const { figure, root } = imported;
  const wanted = editableFigureInclude(planned);
  const actual = editableFigureInclude(figure);
  if (wanted !== actual) {
    const at = document.getText().lastIndexOf(wanted);
    if (at >= 0) {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(document.positionAt(at), document.positionAt(at + wanted.length)), actual);
      await vscode.workspace.applyEdit(edit);
    }
  }
  await completePreamble(root, figure);
}

/** The Paste Figure command: reads the system clipboard's HTML itself, for when a plain paste does not bring the figure. */
async function pasteFigureCommand() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const manifest = editableFigureFromHtml(await clipboardHtml());
  if (!manifest) {
    void vscode.window.showInformationMessage("The clipboard holds no figure. In Reactio Draw, use Copy for LaTeX first.");
    return;
  }
  const imported = await importFigure(editor.document, manifest);
  if (!imported) return;
  const { figure, root } = imported;
  await editor.insertSnippet(insertionFor(editor.document, editor.selection, figure, root), editor.selections);
  await completePreamble(root, figure);
}

/** Folders a drawing may be opened from: the workspace's and the root document's. */
const allowedRoots = (file: string) => {
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file));
  return folder ? [folder.uri.fsPath] : [path.dirname(file)];
};

function openWithSystem(file: string) {
  const [command, args] = process.platform === "darwin" ? ["open", [file]]
    : process.platform === "win32" ? ["explorer.exe", [file]]
      : ["xdg-open", [file]];
  execFile(command, args, { windowsHide: true }, (error) => {
    // explorer.exe reports 1 even when it opened the file.
    if (error && process.platform !== "win32") void vscode.window.showErrorMessage(`Could not open ${path.basename(file)}: ${error.message}`);
  });
}

/** Opens a figure's drawing in the program the system has for it, as safely as its type allows. */
async function openSource(source: string, from: string) {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage("Drawings open in other programs only in a trusted workspace.");
    return;
  }
  const opening = openingFor(source, allowedRoots(from));
  if (opening.kind === "refuse") {
    void vscode.window.showErrorMessage(opening.reason);
  } else if (opening.kind === "open") {
    openWithSystem(opening.file);
  } else if (opening.kind === "ask") {
    const yes = await vscode.window.showWarningMessage(
      `Open ${path.basename(opening.file)} in its default program?`,
      { modal: true, detail: "An SVG's default program is often a web browser, which runs any script the file holds." },
      "Open",
    );
    if (yes === "Open") openWithSystem(opening.file);
  } else {
    await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(opening.file));
  }
}

/** Edit Figure Source: from a figure's `.tex` or `.pdf` in the explorer, or from the include line at the cursor. */
async function editFigureSourceCommand(target?: vscode.Uri | string) {
  if (typeof target === "string") {
    const entry = target;
    const source = sourceOfEntry(entry);
    if (source) await openSource(source, entry);
    return;
  }
  if (target instanceof vscode.Uri) {
    const source = sourceOfFigureFile(target.fsPath);
    if (source) await openSource(source, target.fsPath);
    else void vscode.window.showInformationMessage(`${path.basename(target.fsPath)} is not a figure made from a drawing.`);
    return;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const file = editor.document.uri.fsPath;
  const own = editor.selection.active.line === 0 ? sourceOfEntry(file, editor.document.lineAt(0).text) : null;
  if (own) return openSource(own, file);
  const root = await rootOf(editor.document);
  const [figure] = figuresOnLine(editor.document.lineAt(editor.selection.active.line).text, file, root.rootDir);
  if (figure) await openSource(figure.source, figure.entry);
  else void vscode.window.showInformationMessage("Put the cursor on a line that includes a figure made from a drawing.");
}

/** "Edit in Reactio Draw" above each line that includes a figure made from a drawing, and on an entry file's first line. */
class FigureCodeLensProvider implements vscode.CodeLensProvider {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;
  refresh() { this.changed.fire(); }

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    if (!settings().get<boolean>("codeLens", true)) return [];
    const lenses: vscode.CodeLens[] = [];
    const file = document.uri.fsPath;
    const own = document.lineCount ? sourceOfEntry(file, document.lineAt(0).text) : null;
    if (own) lenses.push(new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), { title: editLabel(own), command: "reactioLatex.editFigureSource", arguments: [file] }));
    const text = document.getText();
    if (!/\\(?:input|include|import|subimport)\b/.test(text)) return lenses;
    const root = await rootOf(document);
    for (let line = 0; line < document.lineCount; line += 1) {
      const content = document.lineAt(line).text;
      if (!/\\(?:input|include|import|subimport)\s*\{/.test(content)) continue;
      for (const figure of figuresOnLine(content, file, root.rootDir)) {
        lenses.push(new vscode.CodeLens(new vscode.Range(line, 0, line, 0), { title: editLabel(figure.source), command: "reactioLatex.editFigureSource", arguments: [figure.entry] }));
      }
    }
    return lenses;
  }
}

/** A drawing opened in VS Code: a page with a button that opens it in its own program. */
class DrawingEditorProvider implements vscode.CustomReadonlyEditorProvider {
  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => undefined };
  }

  resolveCustomEditor(document: vscode.CustomDocument, panel: vscode.WebviewPanel) {
    panel.webview.options = { enableScripts: false, enableCommandUris: ["reactioLatex.openDrawing"] };
    const file = document.uri.fsPath;
    const name = path.basename(file);
    const program = path.extname(file).toLowerCase() === ".reactio" ? "Reactio Draw" : "its program";
    const link = `command:reactioLatex.openDrawing?${encodeURIComponent(JSON.stringify([document.uri.toString()]))}`;
    const escape = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
    panel.webview.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<style>body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:2em}
a.button{display:inline-block;padding:.5em 1.2em;border-radius:2px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);text-decoration:none}
a.button:hover{background:var(--vscode-button-hoverBackground)}p{color:var(--vscode-descriptionForeground)}</style></head>
<body><h2>${escape(name)}</h2><p>A drawing. It is edited in ${escape(program)}; saving it there updates the figure and the document rebuilds.</p>
<a class="button" href="${link}">Open in ${escape(program)}</a></body></html>`;
  }
}

async function openDrawingCommand(target?: vscode.Uri | string) {
  const uri = typeof target === "string" ? vscode.Uri.parse(target) : target ?? vscode.window.activeTextEditor?.document.uri;
  if (!uri || uri.scheme !== "file") return;
  await openSource(uri.fsPath, uri.fsPath);
}

function compoundAt(document: vscode.TextDocument, position: vscode.Position) {
  const hit = compoundKeyAt(document.lineAt(position.line).text, position.character);
  return hit && { key: hit.key, mark: hit.mark, range: new vscode.Range(position.line, hit.from, position.line, hit.to) };
}

class CompoundHoverProvider implements vscode.HoverProvider {
  async provideHover(document: vscode.TextDocument, position: vscode.Position) {
    const hit = compoundAt(document, position);
    if (!hit) return undefined;
    const project = await compoundProject(document);
    const number = project.numbers.get(numberedKey(hit.key));
    const place = project.placeLines.get(hit.key);
    const markdown = new vscode.MarkdownString(undefined, true);
    markdown.isTrusted = { enabledCommands: ["reactioLatex.copyCompound"] };
    markdown.appendMarkdown(number ? `**${escapeMarkdown(number)}**` : "_not numbered yet: build the document_");
    if (place) markdown.appendMarkdown(` · ${escapeMarkdown(place)}`);
    const command = compoundCommand(hit.key, hit.mark);
    markdown.appendMarkdown(`\n\n[Copy \`${command.replace(/`/g, "")}\`](command:reactioLatex.copyCompound?${encodeURIComponent(JSON.stringify([command]))})`);
    return new vscode.Hover(markdown, hit.range);
  }
}

const escapeMarkdown = (text: string) => text.replace(/[\\`*_{}[\]()#+\-.!|<>]/g, "\\$&");

/** `\cmpd{` and `\rcmpd{` list the project's compound keys, each with the number the last build gave it and the figure it is drawn in. */
class CompoundCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
    const slot = compoundSlot(document.lineAt(position.line).text.slice(0, position.character));
    if (!slot) return undefined;
    const project = await compoundProject(document);
    const keys = compoundKeysIn([document.getText(), ...project.sources.map((source) => source.text)]);
    return compoundEntries(keys, project.numbers).map(({ key, number }, index) => {
      const item = new vscode.CompletionItem({ label: key, description: number }, vscode.CompletionItemKind.Variable);
      item.detail = project.placeLines.get(key);
      item.sortText = String(index).padStart(5, "0");
      item.range = new vscode.Range(position.line, slot.from, position.line, position.character);
      const asMark = markInsertion(slot, key);
      if (asMark) {
        item.range = new vscode.Range(position.line, asMark.from, position.line, position.character);
        item.filterText = asMark.filterText;
        item.insertText = asMark.insertText;
      }
      return item;
    });
  }
}

const isLatex = (document: vscode.TextDocument) => /^(latex|tex)$/.test(document.languageId) && document.uri.scheme === "file";
let lastLatex: vscode.TextDocument | undefined;

/** The LaTeX document the reader works in, also while the PDF has the focus. */
function latexDocument(): vscode.TextDocument | undefined {
  const active = vscode.window.activeTextEditor?.document;
  if (active && isLatex(active)) return active;
  if (lastLatex && !lastLatex.isClosed) return lastLatex;
  return vscode.window.visibleTextEditors.map((editor) => editor.document).find(isLatex)
    ?? vscode.workspace.textDocuments.find(isLatex);
}

async function rowsOfProject(): Promise<CompoundRow[]> {
  const document = latexDocument();
  if (!document) return [];
  const project = await compoundProject(document);
  return compoundRows(project.sources.map((source) => source.text), project.numbers, project.placeLines);
}

async function copyCompound(text: unknown) {
  if (typeof text !== "string" || !/^\\r?cmpd\{[^\\{}%#$&^~\r\n]{1,200}\}$/.test(text)) return;
  await vscode.env.clipboard.writeText(text);
  vscode.window.setStatusBarMessage(`Copied ${text}`, 2500);
}

/** Copy Compound by Number: type the number the PDF shows, get the LaTeX that cites that compound. */
async function copyCompoundByNumberCommand() {
  const rows = await rowsOfProject();
  if (!rows.length) {
    void vscode.window.showInformationMessage("No compounds found. Open the document and build it once, so the numbers are known.");
    return;
  }
  const picked = await vscode.window.showQuickPick(
    rows.map((row) => ({ label: row.number ?? "not numbered yet", description: row.command, detail: row.place, row })),
    { title: "Copy compound by number", placeHolder: "The number as the PDF shows it, or the key", matchOnDescription: true, matchOnDetail: true },
  );
  if (picked) await copyCompound(picked.row.command);
}

/** The Compounds view: number, the LaTeX that cites it, and where it is drawn; a click copies the LaTeX. */
class CompoundTreeProvider implements vscode.TreeDataProvider<CompoundRow> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  refresh() { this.changed.fire(); }
  getChildren(element?: CompoundRow) { return element ? [] : rowsOfProject(); }
  getTreeItem(row: CompoundRow): vscode.TreeItem {
    const item = new vscode.TreeItem(row.number ?? "–");
    item.description = row.command;
    item.tooltip = [row.command, row.place].filter(Boolean).join("\n");
    item.contextValue = "compound";
    item.command = { title: "Copy", command: "reactioLatex.copyCompound", arguments: [row.command] };
    return item;
  }
}

let output: vscode.OutputChannel | undefined;

/** Export Figures for Submission: each figure, with its numbers, as Scheme1.pdf and Scheme1.tiff. */
async function exportFiguresCommand() {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage("Figures are exported only in a trusted workspace: the export builds the document with TeX.");
    return;
  }
  const editor = vscode.window.activeTextEditor;
  if (!editor || !["latex", "tex"].includes(editor.document.languageId)) {
    void vscode.window.showInformationMessage("Open the document's .tex file first.");
    return;
  }
  const root = await rootOf(editor.document);
  if (!root.root) {
    void vscode.window.showErrorMessage("No main document with \\begin{document} was found.");
    return;
  }
  const mainRoot = root.root;
  await vscode.workspace.saveAll(false);
  const files = await projectTexFiles(editor.document);
  const entries = files.filter((file) => sourceOfEntry(file));
  if (!entries.length) {
    void vscode.window.showInformationMessage("The project has no figure made from a drawing.");
    return;
  }
  const config = settings();
  const log = output ??= vscode.window.createOutputChannel("Reactio Draw figures");
  log.clear();
  const subfolders = [...new Set(files.map((file) => path.relative(root.rootDir, path.dirname(file))).filter((dir) => dir && !dir.startsWith("..") && !path.isAbsolute(dir)))];
  try {
    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Exporting figures for submission…" }, () => exportFigures({
      root: mainRoot,
      entries,
      folder: config.get<string>("export.folder") || "figures-for-submission",
      engine: engineOf(currentText(mainRoot), config.get<string>("export.engine") || "auto"),
      dpi: config.get<number>("export.tiffDpi") || 600,
      tiff: config.get<boolean>("export.tiff", true),
      texCopy: config.get<boolean>("export.texCopy", true),
      subfolders,
      log: (line) => log.appendLine(line),
    }));
    const names = [...new Set(result.written.map((file) => path.basename(file).replace(/\.[^.]+$/, "")))];
    if (result.texCopy) {
      const article = path.basename(result.texCopy).replace(/\.tex$/i, "");
      names.splice(0, names.length, ...names.filter((name) => name !== article), `${article}.tex`);
    }
    for (const problem of result.problems) log.appendLine(problem);
    const folder = result.written.length ? path.dirname(result.written[0]) : "";
    const message = `Exported ${names.join(", ")} to ${path.basename(folder)}/.${result.problems.length ? ` ${result.problems[0]}` : ""}`;
    const choice = await (result.problems.length ? vscode.window.showWarningMessage : vscode.window.showInformationMessage)(message, "Show folder");
    if (choice && folder) await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(result.written[0]));
  } catch (error) {
    log.show(true);
    void vscode.window.showErrorMessage(`Export failed: ${(error as Error).message}`);
  }
}

export function activate(context: vscode.ExtensionContext) {
  const lenses = new FigureCodeLensProvider();
  const watcher = vscode.workspace.createFileSystemWatcher("**/*.{aux,tex}");
  const compounds = new CompoundTreeProvider();
  void vscode.commands.executeCommand("setContext", "reactioLatex.active", true);
  const changed = () => { invalidateCompounds(); lenses.refresh(); compounds.refresh(); };
  // A drawing saved writes its .pdf and .tex in turn: wait for the writes to settle.
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const figureWritten = (uri: vscode.Uri) => {
    changed();
    if (uri.scheme !== "file" || !uri.fsPath.toLowerCase().endsWith(".tex")) return;
    clearTimeout(pending.get(uri.fsPath));
    pending.set(uri.fsPath, setTimeout(() => {
      pending.delete(uri.fsPath);
      void completeFigureNeeds(uri.fsPath);
    }, 400));
  };
  // Figures pasted before their drawing gained marks: checked when a document that includes them opens.
  const checkFigures = async (document: vscode.TextDocument) => {
    if (document.uri.scheme !== "file" || !["latex", "tex"].includes(document.languageId)) return;
    const root = await rootOf(document);
    const entries = new Set<string>();
    for (let line = 0; line < document.lineCount; line += 1) {
      for (const figure of figuresOnLine(document.lineAt(line).text, document.uri.fsPath, root.rootDir)) entries.add(figure.entry);
    }
    for (const entry of entries) await completeFigureNeeds(entry);
  };
  for (const document of vscode.workspace.textDocuments) void checkFigures(document);
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((document) => void checkFigures(document)),
    watcher, watcher.onDidChange(figureWritten), watcher.onDidCreate(figureWritten), watcher.onDidDelete(changed),
    vscode.languages.registerDocumentPasteEditProvider(SELECTOR, new FigurePasteProvider(), {
      providedPasteEditKinds: [PASTE_KIND],
      pasteMimeTypes: ["text/html"],
    }),
    vscode.languages.registerCodeLensProvider(SELECTOR, lenses),
    vscode.languages.registerHoverProvider(SELECTOR, new CompoundHoverProvider()),
    vscode.languages.registerCompletionItemProvider(SELECTOR, new CompoundCompletionProvider(), "{", ","),
    vscode.window.registerCustomEditorProvider("reactioLatex.drawing", new DrawingEditorProvider(), { supportsMultipleEditorsPerDocument: true }),
    vscode.commands.registerCommand("reactioLatex.pasteFigure", pasteFigureCommand),
    vscode.commands.registerCommand("reactioLatex.editFigureSource", editFigureSourceCommand),
    vscode.commands.registerCommand("reactioLatex.openDrawing", openDrawingCommand),
    vscode.commands.registerCommand("reactioLatex.exportFigures", exportFiguresCommand),
    vscode.commands.registerCommand("reactioLatex.copyCompound", copyCompound),
    vscode.commands.registerCommand("reactioLatex.copyCompoundByNumber", copyCompoundByNumberCommand),
    vscode.commands.registerCommand("reactioLatex.refreshCompounds", () => { invalidateCompounds(); compounds.refresh(); }),
    vscode.window.registerTreeDataProvider("reactioLatex.compounds", compounds),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && isLatex(editor.document) && editor.document !== lastLatex) { lastLatex = editor.document; compounds.refresh(); }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => { if (event.affectsConfiguration("reactioLatex")) changed(); }),
  );
}

export function deactivate() {}
