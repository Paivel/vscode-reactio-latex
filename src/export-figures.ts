/**
 * Export Figures for Submission: each figure made from a drawing, cut out of
 * the built document with its compound numbers, as `Scheme1.pdf` and
 * `Scheme1.tiff` in a folder of its own. Journals (ACS among them) take
 * figures as separate TIFF, PDF or EPS files named by their function, at 300
 * dpi for colour and up to 1200 dpi for line art. The working files are
 * never changed.
 */
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PDFDocument } from "pdf-lib";
import { cropBox, exportHook, parsePlacedFigures, submissionNames, type PlacedFigure } from "./export-tex";
import { submissionTex } from "./submission-tex";

const run = (command: string, args: string[], cwd: string, timeout = 300_000) => new Promise<{ code: number; output: string }>((resolve) => {
  execFile(command, args, { cwd, timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
    const code = error ? (typeof (error as NodeJS.ErrnoException).code === "number" ? Number((error as NodeJS.ErrnoException).code) : 1) : 0;
    resolve({ code, output: `${stdout}${stderr}${error && !stdout ? error.message : ""}` });
  });
});

/** Where TeX's programs may be when VS Code was started without the shell's PATH. */
const TEX_DIRS = ["/Library/TeX/texbin", "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"];

/** A program by name: on PATH, or in TeX's usual folders. */
export function findProgram(name: string): string | null {
  const exts = process.platform === "win32" ? [".exe", ".cmd", ""] : [""];
  const dirs = [...(process.env.PATH ?? "").split(path.delimiter), ...TEX_DIRS];
  if (process.platform !== "win32") {
    // TeX Live installed by hand: /usr/local/texlive/2026*/bin/<platform>.
    try {
      for (const year of fs.readdirSync("/usr/local/texlive").sort().reverse()) {
        const bin = path.join("/usr/local/texlive", year, "bin");
        if (fs.existsSync(bin)) for (const platform of fs.readdirSync(bin)) dirs.push(path.join(bin, platform));
      }
    } catch {
      // No TeX Live there.
    }
  } else {
    try {
      for (const year of fs.readdirSync("C:\\texlive").sort().reverse()) dirs.push(path.join("C:\\texlive", year, "bin", "windows"), path.join("C:\\texlive", year, "bin", "win64"));
    } catch {
      // No TeX Live there.
    }
  }
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = path.join(dir, name + ext);
      try {
        if (dir && fs.statSync(file).isFile()) return file;
      } catch {
        // Not here.
      }
    }
  }
  return null;
}

/** The engine a document asks for in `% !TeX program = …`, else pdflatex. */
const ENGINES = ["pdflatex", "xelatex", "lualatex"];

export function engineOf(rootText: string, setting: string): string {
  // Only a TeX engine: a workspace's settings come with the folder, and must not name another program to run.
  if (ENGINES.includes(setting)) return setting;
  const magic = /^\s*%\s*!\s*TeX\s+(?:TS-)?program\s*=\s*(pdflatex|xelatex|lualatex)\b/im.exec(rootText.split(/\r?\n/, 30).join("\n"));
  return magic ? magic[1].toLowerCase() : "pdflatex";
}

/** The export folder, which must lie inside the main document's folder: a workspace's settings must not send files elsewhere. */
export function exportFolder(rootDir: string, setting: string): string {
  const folder = path.resolve(rootDir, setting || "figures-for-submission");
  const rel = path.relative(rootDir, folder);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`The export folder must be a folder inside ${path.basename(rootDir)}/, not ${setting}.`);
  return folder;
}

/** One figure cut out of a page, as a PDF of its own. */
async function cropToPdf(source: PDFDocument, figure: PlacedFigure): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const [page] = await out.copyPages(source, [figure.page - 1]);
  const box = cropBox(figure);
  const width = box.right - box.left;
  const height = box.top - box.bottom;
  page.setMediaBox(box.left, box.bottom, width, height);
  page.setCropBox(box.left, box.bottom, width, height);
  page.setTrimBox(box.left, box.bottom, width, height);
  page.setBleedBox(box.left, box.bottom, width, height);
  page.setArtBox(box.left, box.bottom, width, height);
  out.addPage(page);
  out.setProducer("Reactio Draw figures for LaTeX");
  out.setCreator("Reactio Draw figures for LaTeX");
  return out.save();
}

/** macOS: PDFKit draws the page into an RGB bitmap on white, saved as an LZW TIFF. */
const RENDER_JXA = String.raw`
ObjC.import('Cocoa');
ObjC.import('Quartz');
function run(argv) {
  const dpi = Number(argv[2]);
  const doc = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));
  if (doc.isNil()) throw new Error('cannot open PDF');
  const page = doc.pageAtIndex(0);
  const b = page.boundsForBox(0); // kPDFDisplayBoxMediaBox, exact points
  const pw = b.size.width, ph = b.size.height;
  const w = Math.max(1, Math.round(pw * dpi / 72)), h = Math.max(1, Math.round(ph * dpi / 72));
  // 3 samples, no alpha, 32 bits per pixel: AppKit draws nothing into a 24-bit one.
  const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, w, h, 8, 3, false, false, 'NSDeviceRGBColorSpace', 0, 32);
  rep.size = $.NSMakeSize(pw, ph);
  const ctx = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep);
  if (ctx.isNil()) throw new Error('no graphics context for the bitmap');
  $.NSGraphicsContext.saveGraphicsState; // methods without arguments take no () in JXA
  $.NSGraphicsContext.setCurrentContext(ctx);
  $.NSColor.whiteColor.set;
  $.NSBezierPath.fillRect($.NSMakeRect(0, 0, pw, ph));
  page.drawWithBoxToContext(0, ctx.CGContext);
  ctx.flushGraphics;
  $.NSGraphicsContext.restoreGraphicsState;
  const props = $.NSDictionary.dictionaryWithObjectForKey($.NSNumber.numberWithInt(5), $.NSImageCompressionMethod); // LZW
  if (!rep.representationUsingTypeProperties(0, props).writeToFileAtomically(argv[1], true)) throw new Error('write failed');
}`;

/** A TIFF of a one-page PDF at `dpi`: PDFKit on macOS, else Ghostscript or pdftoppm when installed. */
async function renderTiff(pdf: string, tiff: string, dpi: number, scratch: string): Promise<string | null> {
  if (process.platform === "darwin") {
    const script = path.join(scratch, "render.js");
    fs.writeFileSync(script, RENDER_JXA);
    const result = await run("osascript", ["-l", "JavaScript", script, pdf, tiff, String(dpi)], scratch, 120_000);
    if (fs.existsSync(tiff)) return null;
    return `macOS could not draw the TIFF: ${result.output.trim().slice(0, 300)}`;
  }
  const gs = findProgram(process.platform === "win32" ? "gswin64c" : "gs") ?? findProgram("gs");
  if (gs) {
    await run(gs, ["-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-sDEVICE=tiff24nc", "-sCompression=lzw", `-r${dpi}`, `-sOutputFile=${tiff}`, pdf], scratch, 120_000);
    if (fs.existsSync(tiff)) return null;
  }
  const pdftoppm = findProgram("pdftoppm");
  if (pdftoppm) {
    await run(pdftoppm, ["-r", String(dpi), "-tiff", "-tiffcompression", "lzw", "-singlefile", pdf, tiff.replace(/\.tiff?$/i, "")], scratch, 120_000);
    if (fs.existsSync(tiff.replace(/\.tiff?$/i, ".tif"))) fs.renameSync(tiff.replace(/\.tiff?$/i, ".tif"), tiff);
    if (fs.existsSync(tiff)) return null;
  }
  return "TIFF needs Ghostscript or pdftoppm (Poppler) on this system; the PDFs are written.";
}

export type ExportOptions = {
  root: string;
  entries: string[];
  folder: string;
  engine: string;
  dpi: number;
  tiff: boolean;
  /** Also write the article as one .tex that includes the exported files, for a journal that builds the LaTeX itself. */
  texCopy: boolean;
  /** Folders of the project's `.tex` files relative to the root, for `\include` to write its `.aux` files. */
  subfolders: string[];
  log: (line: string) => void;
};

export type ExportResult = { written: string[]; problems: string[]; texCopy?: string };

const readOrNull = (file: string) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};
const isFile = (file: string) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};
/** Files of a journal's class or style kept beside the article: they travel with it. */
const TEMPLATE_FILE = /\.(?:cls|sty|bst|bbx|cbx|clo)$/i;

/**
 * Builds the document once more in a scratch folder, recording where each
 * figure lands, then cuts each one out of that PDF.
 */
export async function exportFigures(options: ExportOptions): Promise<ExportResult> {
  const { root, log } = options;
  const rootDir = path.dirname(root);
  const stem = path.basename(root).replace(/\.tex$/i, "");
  const engine = findProgram(options.engine);
  if (!engine) throw new Error(`${options.engine} was not found. Is TeX installed?`);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "reactio-export-"));
  try {
    for (const sub of options.subfolders) fs.mkdirSync(path.join(scratch, sub), { recursive: true });
    const job = `${stem}-figures`;
    // The last build's .aux, so this run lays out pages as that build did.
    const aux = path.join(rootDir, `${stem}.aux`);
    if (fs.existsSync(aux)) fs.copyFileSync(aux, path.join(scratch, `${job}.aux`));
    const hook = path.join(scratch, "reactio-export.tex");
    const recorded = path.join(scratch, `${job}.figures`);
    fs.writeFileSync(hook, exportHook(options.entries.map((entry) => path.basename(entry))));
    const texPath = (file: string) => file.split(path.sep).join("/");
    log(`Building ${path.basename(root)} with ${options.engine} to find the figures…`);
    const result = await run(engine, [
      "-interaction=nonstopmode", "-file-line-error", `-output-directory=${scratch}`, `-jobname=${job}`,
      `\\input{${texPath(hook)}}\\input{${path.basename(root)}}`,
    ], rootDir);
    log(result.output.split(/\r?\n/).slice(-40).join("\n"));
    const pdfFile = path.join(scratch, `${job}.pdf`);
    if (!fs.existsSync(pdfFile) || !fs.existsSync(recorded)) throw new Error(`The document did not build (see the Reactio output for the log).`);
    const figures = parsePlacedFigures(fs.readFileSync(recorded, "utf8"));
    if (!figures.length) throw new Error("No figure made from a drawing was found in the built document.");
    const names = submissionNames(figures);
    const source = await PDFDocument.load(fs.readFileSync(pdfFile));
    const folder = exportFolder(rootDir, options.folder);
    fs.mkdirSync(folder, { recursive: true });
    const written: string[] = [];
    const problems: string[] = [];
    for (const [index, figure] of figures.entries()) {
      if (figure.page < 1 || figure.page > source.getPageCount()) {
        problems.push(`${names[index]}: not on a page of the PDF.`);
        continue;
      }
      const pdf = path.join(folder, `${names[index]}.pdf`);
      fs.writeFileSync(pdf, await cropToPdf(source, figure));
      written.push(pdf);
      if (options.tiff) {
        const tiff = path.join(folder, `${names[index]}.tiff`);
        const problem = await renderTiff(pdf, tiff, options.dpi, scratch);
        if (problem) problems.push(`${names[index]}: ${problem}`);
        else written.push(tiff);
      }
    }
    let texCopy: string | undefined;
    if (options.texCopy) {
      texCopy = writeTexCopy({ root, stem, rootDir, folder, figures, names, entries: options.entries, problems });
      if (texCopy) {
        // Built once from the folder itself, so a missing file shows now and not at the journal.
        log(`Checking that ${path.basename(texCopy)} builds on its own…`);
        const check = path.join(scratch, "check");
        fs.mkdirSync(check, { recursive: true });
        if (isFile(path.join(folder, `${stem}.bbl`))) fs.copyFileSync(path.join(folder, `${stem}.bbl`), path.join(check, `${stem}.bbl`));
        const built = await run(engine, ["-interaction=nonstopmode", "-file-line-error", `-output-directory=${check}`, path.basename(texCopy)], folder);
        // Twice, so references and compound numbers settle; the PDF goes beside the article, to look at or send.
        if (fs.existsSync(path.join(check, `${stem}.pdf`))) await run(engine, ["-interaction=nonstopmode", "-file-line-error", `-output-directory=${check}`, path.basename(texCopy)], folder);
        if (fs.existsSync(path.join(check, `${stem}.pdf`))) {
          fs.copyFileSync(path.join(check, `${stem}.pdf`), path.join(folder, `${stem}.pdf`));
          written.push(path.join(folder, `${stem}.pdf`));
        } else {
          log(built.output.split(/\r?\n/).slice(-40).join("\n"));
          problems.push(`${path.basename(texCopy)} did not build from the folder on its own (see the Reactio output for the log).`);
        }
      }
    }
    return { written, problems: [...new Set(problems)], texCopy };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/** The article as one .tex beside the exported figures, with the files it needs; its path, or undefined if it was not written. */
function writeTexCopy(o: {
  root: string;
  stem: string;
  rootDir: string;
  folder: string;
  figures: PlacedFigure[];
  names: string[];
  entries: string[];
  problems: string[];
}): string | undefined {
  const target = path.join(o.folder, `${o.stem}.tex`);
  if (path.resolve(target) === path.resolve(o.root)) {
    o.problems.push("The export folder is the document's own folder, so the article copy was not written.");
    return undefined;
  }
  const copy = submissionTex({
    root: o.root,
    figures: o.figures.map((figure, index) => ({ file: figure.file, name: o.names[index] })),
    entries: o.entries,
    read: readOrNull,
    exists: isFile,
  });
  fs.writeFileSync(target, copy.text);
  const copyIn = (rel: string) => {
    const to = path.join(o.folder, rel);
    if (path.resolve(to) === path.resolve(o.rootDir, rel)) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(o.rootDir, rel), to);
  };
  for (const rel of copy.assets) copyIn(rel);
  if (isFile(path.join(o.rootDir, `${o.stem}.bbl`))) copyIn(`${o.stem}.bbl`);
  for (const name of fs.readdirSync(o.rootDir)) if (TEMPLATE_FILE.test(name) && isFile(path.join(o.rootDir, name))) copyIn(name);
  for (const entry of copy.unmatched) o.problems.push(`${entry} stays as \\input in ${o.stem}.tex: the build placed no figure for it.`);
  return target;
}
