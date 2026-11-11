import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { submissionTex } from "../src/submission-tex";

const dir = path.resolve("/proj");
const at = (rel: string) => path.join(dir, rel);

function project(files: Record<string, string>, extra: string[] = []) {
  const all = new Map(Object.entries(files).map(([rel, text]) => [at(rel), text]));
  const present = new Set([...all.keys(), ...extra.map(at)]);
  return { read: (file: string) => all.get(file) ?? null, exists: (file: string) => present.has(file) };
}

const FIG = "% editable-figure source: s.reactio\n\\node {\\textbf{\\rcmpd{1}}~(xx\\%)};\n\\node {\\rcmpd{A:x}};\n% \\rcmpd{nope}\n";

describe("the article for a journal", () => {
  it("puts the exported file where the figure was, its marks unprinted after it", () => {
    const fs = project({ "main.tex": "\\begin{figure}\n  \\input{figures/s}\n  \\caption{A}\n\\end{figure}\n", "figures/s.tex": FIG });
    const out = submissionTex({ root: at("main.tex"), figures: [{ file: "s.tex", name: "Scheme1" }], entries: [at("figures/s.tex")], ...fs });
    expect(out.text).toContain("  \\includegraphics{Scheme1}\\begingroup\\setbox0\\hbox{\\rcmpd{1}\\rcmpd{A:x}}\\endgroup\n  \\caption{A}");
    expect(out.unmatched).toEqual([]);
  });
  it("writes the project's own files into it, and leaves comments and other inputs alone", () => {
    const fs = project({
      "main.tex": "\\input{sections/intro} % first\n% \\input{figures/s}\n\\include{sections/end}\n\\input{tikzlibrary.code}\n",
      "sections/intro.tex": "Intro \\input{figures/s}.\n",
      "sections/end.tex": "End.\n",
      "figures/s.tex": FIG,
    });
    const out = submissionTex({ root: at("main.tex"), figures: [{ file: "s.tex", name: "Figure2" }], entries: [at("figures/s.tex")], ...fs });
    expect(out.text).toContain("% sections/intro.tex\nIntro \\includegraphics{Figure2}");
    expect(out.text).toContain("% \\input{figures/s}");
    expect(out.text).toContain("\\clearpage\n% sections/end.tex\nEnd.\n\\clearpage");
    expect(out.text).toContain("\\input{tikzlibrary.code}");
  });
  it("gives a figure included twice its two names, and keeps one the build did not place", () => {
    const fs = project({ "main.tex": "\\input{s}\n\\input{s}\n\\input{t}\n", "s.tex": FIG, "t.tex": FIG });
    const out = submissionTex({ root: at("main.tex"), figures: [{ file: "s.tex", name: "Scheme1a" }, { file: "s.tex", name: "Scheme1b" }], entries: [at("s.tex"), at("t.tex")], ...fs });
    expect(out.text).toMatch(/Scheme1a.*\n.*Scheme1b.*\n\\input\{t\}/);
    expect(out.unmatched).toEqual(["t.tex"]);
  });
  it("lists the images and bibliographies it needs", () => {
    const fs = project(
      { "main.tex": "\\graphicspath{{img/}}\n\\includegraphics[width=1cm]{logo}\n\\includegraphics{Scheme1}\n\\bibliography{refs,missing}\n\\addbibresource{more.bib}\n" },
      ["img/logo.png", "refs.bib", "more.bib"],
    );
    const out = submissionTex({ root: at("main.tex"), figures: [{ file: "s.tex", name: "Scheme1" }], entries: [], ...fs });
    expect(out.assets.sort()).toEqual(["img/logo.png", "more.bib", "refs.bib"]);
  });
  it("does not loop on a file that includes itself", () => {
    const fs = project({ "main.tex": "\\input{a}\n", "a.tex": "A \\input{a}\n" });
    const out = submissionTex({ root: at("main.tex"), figures: [], entries: [], ...fs });
    expect(out.text).toContain("A \\input{a}");
  });
});
