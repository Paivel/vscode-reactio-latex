import { describe, expect, it } from "vitest";
import * as path from "node:path";
import { engineOf, exportFolder } from "../src/export-figures";
import { cropBox, exportHook, parsePlacedFigures, submissionNames } from "../src/export-tex";

const record = (index: number, type: string, start: number, file = "s.tex") =>
  `fig;${index};${type};${start};${file};100.0pt;50.0pt;2.0pt;1;${72.27 * 65536};${72.27 * 2 * 65536}`;

describe("figures recorded by the export build", () => {
  it("reads each record, in TeX points", () => {
    const [figure] = parsePlacedFigures(`${record(1, "scheme", 0)}\nnoise\n`);
    expect(figure).toMatchObject({ index: 1, type: "scheme", number: 1, file: "s.tex", page: 1, width: 100, height: 50, depth: 2 });
    expect(figure.x).toBeCloseTo(72.27);
    expect(parsePlacedFigures("fig;1;scheme;0;s.tex;0.0pt;0pt;0pt;1;0;0")).toEqual([]);
  });
  it("names files by function, lettering several in one float", () => {
    const figures = parsePlacedFigures([record(1, "scheme", 0), record(2, "figure", 1), record(3, "scheme", 1, "a.tex"), record(4, "scheme", 1, "b.tex"), record(5, "none", 0, "toc_art.tex")].join("\n"));
    expect(submissionNames(figures)).toEqual(["Scheme1", "Figure2", "Scheme2a", "Scheme2b", "toc_art"]);
  });
  it("crops the box in PDF points, depth included", () => {
    const [figure] = parsePlacedFigures(record(1, "figure", 0));
    const box = cropBox(figure, 0);
    expect(box.left).toBeCloseTo(72);
    expect(box.bottom).toBeCloseTo(144 - 2 * 72 / 72.27);
    expect(box.right - box.left).toBeCloseTo(100 * 72 / 72.27);
  });
  it("lists the entry files for TeX, plainly", () => {
    const hook = exportHook(["Document_1-5.tex", "x}{y.tex"]);
    expect(hook).toContain(String.raw`\detokenize{,Document_1-5.tex,xy.tex,}`);
    expect(hook).toContain(String.raw`\openout\rcx@out=\jobname.figures`);
  });
  it("builds with the engine the document names", () => {
    expect(engineOf("% !TEX program = xelatex\n\\documentclass{article}", "auto")).toBe("xelatex");
    expect(engineOf("\\documentclass{article}", "auto")).toBe("pdflatex");
    expect(engineOf("% !TeX program = xelatex", "lualatex")).toBe("lualatex");
    expect(engineOf("\\documentclass{article}", "/bin/sh")).toBe("pdflatex");
  });
  it("exports only into a folder inside the document's", () => {
    const root = path.resolve("/proj");
    expect(exportFolder(root, "out/figs")).toBe(path.join(root, "out", "figs"));
    expect(() => exportFolder(root, "../elsewhere")).toThrow();
    expect(() => exportFolder(root, path.resolve("/tmp/x"))).toThrow();
    expect(() => exportFolder(root, ".")).toThrow();
  });
});
