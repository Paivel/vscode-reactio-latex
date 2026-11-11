import { describe, expect, it } from "vitest";
import { floatKind } from "../src/float-kind";

describe("the float a pasted figure goes in", () => {
  it("is a scheme in an ACS paper or a document that defines one", () => {
    expect(floatKind("\\documentclass[journal=jacsat,manuscript=article]{achemso}\n\\begin{document}", "auto")).toEqual({ environment: "scheme", labelPrefix: "sch:" });
    expect(floatKind("\\documentclass{article}\n\\usepackage{float}\n\\newfloat{scheme}{htbp}{los}\n\\begin{document}", "auto").environment).toBe("scheme");
    expect(floatKind("\\documentclass{article}\n\\usepackage[journal=rsc]{chemstyle}\n\\begin{document}", "auto").environment).toBe("scheme");
  });
  it("is a figure otherwise, or when the setting says so", () => {
    expect(floatKind("\\documentclass{article}\n% \\documentclass{achemso}\n\\begin{document}", "auto").environment).toBe("figure");
    expect(floatKind("\\documentclass{article}\n\\begin{document}\n\\newenvironment{scheme}{}{}", "auto").environment).toBe("figure");
    expect(floatKind("\\documentclass{achemso}\n\\begin{document}", "figure").environment).toBe("figure");
    expect(floatKind("\\documentclass{article}\n\\begin{document}", "scheme").environment).toBe("scheme");
  });
});
