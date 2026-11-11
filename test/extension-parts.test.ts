import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fromAppleScript } from "../src/clipboard";
import { figuresOnLine, openingFor, sourceOfEntry, sourceOfFigureFile } from "../src/figure-source";
import { decodeEntities, htmlAttribute } from "../src/html";
import { FigureError, importEditableFigure, rewriteNames } from "../src/import-figure";
import { editableFigureFromHtml, type EditableFigureManifest } from "../src/lattice/editable-figure";
import { auxTexts, findRoot, magicRoot, outputDirectory, rootIncludes } from "../src/project";

const b64 = (text: string) => Buffer.from(text).toString("base64");
const ENTRY = "% editable-figure source: scheme.reactio\n\\includegraphics{scheme.pdf}\n";
const manifest = (over: Partial<EditableFigureManifest> = {}): EditableFigureManifest => ({
  version: 1,
  name: "scheme",
  source: { name: "scheme.reactio", data: b64("{}") },
  outputs: [{ name: "scheme.pdf", data: b64("%PDF") }, { name: "scheme.tex", data: b64(ENTRY) }],
  entry: "scheme.tex",
  packages: ["graphicx", "tikz", "chemnum"],
  ...over,
});

let dir: string;
beforeEach(() => { dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rl-"))); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
const write = (name: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), text);
  return path.join(dir, name);
};

describe("the clipboard's HTML", () => {
  const json = JSON.stringify(manifest());
  it("reads the attribute as WebKit writes it, with &quot;", () => {
    const html = `<meta charset="utf-8"><div style="x" data-editable-figure="${json.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">\\input{figures/scheme}</div>`;
    expect(editableFigureFromHtml(html)?.entry).toBe("scheme.tex");
  });
  it("reads single quotes, numeric entities and Windows' CF_HTML header", () => {
    const html = `Version:0.9\r\nStartHTML:0000000105\r\n<html><body><!--StartFragment--><div data-editable-figure='${json.replaceAll('"', "&#34;")}'></div><!--EndFragment--></body></html>`;
    expect(editableFigureFromHtml(html)?.outputs).toHaveLength(2);
  });
  it("takes only an attribute of a tag, not the words of the page", () => {
    expect(htmlAttribute(`<p>data-editable-figure="{}"</p>`, "data-editable-figure")).toBeNull();
    expect(htmlAttribute(`<p title="a > b" data-x="1">`, "data-x")).toBe("1");
  });
  it("decodes entities, leaving unknown ones", () => {
    expect(decodeEntities("&lt;&#x41;&#66;&amp;&nope;")).toBe("<AB&&nope;");
  });
  it("reads megabytes of base64 at once", () => {
    const big = JSON.stringify(manifest({ source: { name: "scheme.reactio", data: "A".repeat(30_000_000) } }));
    const html = `<div data-editable-figure="${big.replaceAll('"', "&quot;")}"></div>`;
    const start = Date.now();
    expect(editableFigureFromHtml(html)?.source.data.length).toBe(30_000_000);
    expect(Date.now() - start).toBeLessThan(3000);
  });
  it("reads macOS's answer, the HTML in hex", () => {
    expect(fromAppleScript(`«data HTML${Buffer.from("<b>é</b>").toString("hex")}»\n`)).toBe("<b>é</b>");
    expect(fromAppleScript("")).toBe("");
  });
});

describe("copying a pasted figure into the project", () => {
  it("writes the files into figures/ and names what to include", () => {
    const figure = importEditableFigure(dir, manifest(), "figures");
    expect(figure).toEqual({ directory: "figures", entry: "scheme.tex", source: "figures/scheme.reactio", packages: ["graphicx", "tikz", "chemnum"] });
    expect(fs.readFileSync(path.join(dir, "figures/scheme.tex"), "utf8")).toBe(ENTRY);
  });
  it("moves the set to a free name together, and rewrites the entry's references", () => {
    write("figures/scheme.pdf", "theirs");
    const figure = importEditableFigure(dir, manifest(), "figures");
    expect(figure.entry).toBe("scheme-2.tex");
    expect(figure.source).toBe("figures/scheme-2.reactio");
    expect(fs.readFileSync(path.join(dir, "figures/scheme.pdf"), "utf8")).toBe("theirs");
    expect(fs.readFileSync(path.join(dir, "figures/scheme-2.tex"), "utf8")).toBe("% editable-figure source: scheme-2.reactio\n\\includegraphics{scheme-2.pdf}\n");
  });
  it("counts a name taken in the document's own folder, where LaTeX looks first", () => {
    write("scheme.pdf", "x");
    expect(importEditableFigure(dir, manifest(), "figures").entry).toBe("scheme-2.tex");
  });
  it("never writes through a link", () => {
    fs.mkdirSync(path.join(dir, "figures"));
    fs.symlinkSync(path.join(dir, "elsewhere.tex"), path.join(dir, "figures/scheme.tex"));
    expect(importEditableFigure(dir, manifest(), "figures").entry).toBe("scheme-2.tex");
    expect(fs.existsSync(path.join(dir, "elsewhere.tex"))).toBe(false);
  });
  it("refuses a figures folder that leads out of the project", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "rl-out-"));
    fs.symlinkSync(outside, path.join(dir, "figures"));
    expect(() => importEditableFigure(dir, manifest(), "figures")).toThrow(FigureError);
    expect(fs.readdirSync(outside)).toEqual([]);
    fs.rmSync(outside, { recursive: true });
    expect(() => importEditableFigure(dir, manifest(), "../x")).toThrow(FigureError);
  });
  it("refuses paths, odd names, foreign types and doubled names", () => {
    expect(() => importEditableFigure(dir, manifest({ source: { name: "../x.reactio", data: "" } }), "figures")).toThrow(/usable name/);
    expect(() => importEditableFigure(dir, manifest({ source: { name: "s\\x.reactio", data: "" } }), "figures")).toThrow(/usable name/);
    expect(() => importEditableFigure(dir, manifest({ source: { name: "run.sh", data: "" } }), "figures")).toThrow(/file type/);
    expect(() => importEditableFigure(dir, manifest({ entry: "scheme.pdf" }), "figures")).toThrow(/file type/);
    expect(() => importEditableFigure(dir, manifest({ entry: "other.tex" }), "figures")).toThrow(/not among/);
    expect(() => importEditableFigure(dir, manifest({ outputs: [{ name: "Scheme.tex", data: "" }, { name: "scheme.tex", data: b64(ENTRY) }] }), "figures")).toThrow(/twice/);
    expect(() => importEditableFigure(dir, manifest({ version: 2 }), "figures")).toThrow(/newer/);
    expect(fs.existsSync(path.join(dir, "figures/scheme.reactio"))).toBe(false);
  });
  it("refuses too many files and too many bytes", () => {
    const outputs = Array.from({ length: 32 }, (_, i) => ({ name: `f${i}.pdf`, data: "" }));
    expect(() => importEditableFigure(dir, manifest({ outputs: [...outputs, { name: "scheme.tex", data: b64(ENTRY) }] }), "figures")).toThrow(/too many/);
    expect(() => importEditableFigure(dir, manifest({ source: { name: "scheme.reactio", data: "A".repeat(90_000_000) } }), "figures")).toThrow(/too large/);
  });
  it("writes nothing when the entry is not text", () => {
    expect(() => importEditableFigure(dir, manifest({ outputs: [{ name: "scheme.pdf", data: "" }, { name: "scheme.tex", data: Buffer.from([0xff, 0xfe, 0x00]).toString("base64") }] }), "figures")).toThrow(/not text/);
    expect(fs.readdirSync(path.join(dir, "figures"))).toEqual([]);
  });
  it("drops packages with odd names", () => {
    expect(importEditableFigure(dir, manifest({ packages: ["tikz", "x}\\evil", ""] }), "figures").packages).toEqual(["tikz"]);
  });
  it("in a dry run, names where the figure would go and writes nothing", () => {
    write("figures/scheme.pdf", "theirs");
    expect(importEditableFigure(dir, manifest(), "figures", { dryRun: true }).entry).toBe("scheme-2.tex");
    expect(importEditableFigure(dir, manifest(), "new", { dryRun: true }).directory).toBe("new");
    expect(fs.readdirSync(dir).sort()).toEqual(["figures"]);
    expect(fs.readdirSync(path.join(dir, "figures"))).toEqual(["scheme.pdf"]);
  });
  it("rewrites whole names only", () => {
    expect(rewriteNames("a.pdf my_a.pdf {a.pdf}", [["a.pdf", "a-2.pdf"]])).toBe("a-2.pdf my_a.pdf {a-2.pdf}");
  });
});

describe("the root document", () => {
  it("is the file itself with \\begin{document}, a % !TeX root, or a document that includes it", () => {
    const main = write("main.tex", "\\documentclass{article}\n\\begin{document}\n\\include{chapters/one}\n\\end{document}\n");
    const one = write("chapters/one.tex", "\\input{chapters/two}\n");
    const two = write("chapters/two.tex", "text\n");
    const lone = write("lone.tex", "text\n");
    expect(findRoot(main, fs.readFileSync(main, "utf8"), []).root).toBe(main);
    expect(findRoot(two, "text\n", [lone, main, one, two])).toEqual({ root: main, rootDir: dir });
    expect(findRoot(lone, "text\n", [main, lone])).toEqual({ root: null, rootDir: dir });
    expect(magicRoot(two, "% !TEX root = ../main.tex\n")).toBe(main);
    expect(findRoot(lone, "%!TeX root=main\n", []).root).toBe(main);
    expect(rootIncludes(main, path.join(dir, "nothing.tex"))).toBe(false);
  });
  it("finds the .aux in LaTeX Workshop's outDir, with the chapters it names", () => {
    const main = write("main.tex", "");
    write("out/main.aux", "\\@input{chapters/one.aux}\n\\newlabel{a}{{1}{1}}");
    write("out/chapters/one.aux", "\\chemnum@cmpd {k}{1}{1}{}{}{}{}{}");
    const out = outputDirectory("%DIR%/out", main, dir);
    expect(out).toBe(path.join(dir, "out"));
    expect(auxTexts(main, [dir, out])).toHaveLength(2);
    expect(outputDirectory("%DIR%", main, undefined)).toBe(dir);
  });
});

describe("a figure's drawing", () => {
  it("is named by the entry's first line, relative to it", () => {
    const entry = write("figures/scheme.tex", ENTRY);
    write("figures/scheme.reactio", "{}");
    write("figures/scheme.pdf", "%PDF");
    expect(sourceOfEntry(entry)).toBe(path.join(dir, "figures/scheme.reactio"));
    expect(sourceOfFigureFile(path.join(dir, "figures/scheme.pdf"))).toBe(path.join(dir, "figures/scheme.reactio"));
    expect(sourceOfEntry(write("plain.tex", "\\section{x}"))).toBeNull();
    expect(sourceOfEntry("/x.tex", "% editable-figure source: /etc/passwd")).toBeNull();
  });
  it("is found from the line that includes it, from the root's folder or the file's", () => {
    write("figures/scheme.tex", ENTRY);
    const chapter = write("chapters/one.tex", "");
    expect(figuresOnLine("  \\input{figures/scheme} % x", chapter, dir).map((f) => path.basename(f.source))).toEqual(["scheme.reactio"]);
    expect(figuresOnLine("% \\input{figures/scheme}", chapter, dir)).toEqual([]);
    expect(figuresOnLine("\\import{figures/}{scheme.tex}", chapter, dir)).toHaveLength(1);
  });
  it("opens only when it is a drawing inside the project; an SVG asks; anything else is revealed", () => {
    const drawing = write("figures/scheme.reactio", "{}");
    expect(openingFor(drawing, [dir])).toEqual({ kind: "open", file: drawing });
    expect(openingFor(write("figures/s.svg", "<svg/>"), [dir]).kind).toBe("ask");
    expect(openingFor(write("figures/run.command", ""), [dir]).kind).toBe("reveal");
    expect(openingFor(path.join(dir, "missing.reactio"), [dir]).kind).toBe("refuse");
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "rl-out-"));
    fs.writeFileSync(path.join(outside, "x.reactio"), "{}");
    fs.symlinkSync(path.join(outside, "x.reactio"), path.join(dir, "link.reactio"));
    expect(openingFor(path.join(dir, "link.reactio"), [dir]).kind).toBe("refuse");
    fs.rmSync(outside, { recursive: true });
  });
});

import { compoundKeyAt, compoundSlot, markInsertion } from "../src/compound-text";

describe("compound keys on a line", () => {
  const line = String.raw`see \cmpd{ketone, alcohol.OMe} and \rcmpd{A:cat}.`;
  it("finds the key under the pointer, each of a list on its own", () => {
    expect(compoundKeyAt(line, line.indexOf("ketone"))).toMatchObject({ key: "ketone", mark: false });
    expect(compoundKeyAt(line, line.indexOf("OMe"))).toMatchObject({ key: "alcohol.OMe", from: line.indexOf("alcohol") });
    expect(compoundKeyAt(line, line.indexOf("A:cat") + 5)).toMatchObject({ key: "A:cat", mark: true });
    expect(compoundKeyAt(line, 1)).toBeNull();
    expect(compoundKeyAt(line, line.indexOf("\\cmpd"))).toBeNull();
  });
  it("knows the key being typed, and turns \\cmpd{ into \\rcmpd{ for a mark", () => {
    expect(compoundSlot(String.raw`x \cmpd{ketone, alc`)).toEqual({ from: 16, query: "alc", mark: false, afterCmpd: false });
    const slot = compoundSlot(String.raw`x \cmpd{A`);
    expect(slot).toEqual({ from: 8, query: "A", mark: false, afterCmpd: true });
    expect(markInsertion(slot!, "A:cat")).toEqual({ from: 2, filterText: String.raw`\cmpd{A:cat`, insertText: String.raw`\rcmpd{A:cat` });
    expect(markInsertion(slot!, "ketone")).toBeNull();
    expect(compoundSlot(String.raw`\rcmpd{am`)).toMatchObject({ from: 7, mark: true });
    expect(compoundSlot("plain text")).toBeNull();
  });
});

import { figureNeeds, RCMPD_PREAMBLE } from "../src/figure-needs";
import { isDefinitionsOnly } from "../src/lattice/editable-figure";

describe("what a figure's entry file needs", () => {
  it("reads tikz, chemnum and \\rcmpd from the file, comments aside", () => {
    expect(figureNeeds("% editable-figure source: s.reactio\n\\includegraphics{s.pdf}\n")).toEqual({ packages: ["graphicx"] });
    expect(figureNeeds("% \\rcmpd{x}\n\\begin{tikzpicture}\\node {\\cmpd{a}};\\end{tikzpicture}")).toEqual({ packages: ["graphicx", "tikz", "chemnum"] });
    expect(figureNeeds("\\begin{tikzpicture}\\node {\\textbf{\\rcmpd{1}}};\\end{tikzpicture}")).toEqual({ packages: ["graphicx", "tikz", "chemnum"], preamble: RCMPD_PREAMBLE });
  });
  it("adds \\rcmpd without asking: it is only definitions", () => {
    expect(isDefinitionsOnly(RCMPD_PREAMBLE)).toBe(true);
  });
});
