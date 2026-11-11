/**
 * What a figure's entry file needs in the preamble, read from the file
 * itself: a drawing saved again with compound marks it did not have when it
 * was pasted needs `tikz`, `chemnum` and `\rcmpd`, which the paste could not add.
 */

/**
 * The `\rcmpd` definition, as Reactio Draw puts it in a figure's manifest
 * (RCMPD_PREAMBLE in its index.html) and docs/latex-marks.md prints it.
 * Keep the three the same.
 */
export const RCMPD_PREAMBLE = [
  String.raw`% Compound marks from drawings: \rcmpd{what is inside [[ ]]}, added for editable figures`,
  String.raw`\makeatletter`,
  String.raw`\providecommand\rcmpd@series[2]{%`,
  String.raw`  \@ifundefined{cmpdser@#1@#2}{%`,
  String.raw`    \@ifundefined{c@cmpdser#1}{\newcounter{cmpdser#1}}{}%`,
  String.raw`    \stepcounter{cmpdser#1}%`,
  String.raw`    \expandafter\xdef\csname cmpdser@#1@#2\endcsname{\csname rcmpd@style@#1\endcsname{\value{cmpdser#1}}}%`,
  String.raw`    \immediate\write\@auxout{\string\cmpdser@aux{#1}{#2}{\csname cmpdser@#1@#2\endcsname}}%`,
  String.raw`  }{}%`,
  String.raw`  \textbf{\csname cmpdser@#1@#2\endcsname}%`,
  String.raw`}`,
  String.raw`\providecommand\cmpdser@aux[3]{}`,
  String.raw`\providecommand\rcmpd@style@A[1]{\@Alph{#1}}`,
  String.raw`\providecommand\rcmpd@style@a[1]{\@alph{#1}}`,
  String.raw`\providecommand\rcmpd@style@I[1]{\@Roman{#1}}`,
  String.raw`\providecommand\rcmpd@style@i[1]{\@roman{#1}}`,
  String.raw`\makeatother`,
  String.raw`\ExplSyntaxOn`,
  String.raw`\ProvideDocumentCommand \rcmpd { m }`,
  String.raw`  {`,
  String.raw`    \regex_match:nnTF { \A [A-Za-z0-9_\-] } {#1}`,
  String.raw`      {`,
  String.raw`        \regex_extract_once:nnNTF { \A ([AaIi]) \: (.*) \Z } {#1} \l_tmpa_seq`,
  String.raw`          { \use:c { rcmpd@series } { \seq_item:Nn \l_tmpa_seq { 2 } } { \seq_item:Nn \l_tmpa_seq { 3 } } }`,
  String.raw`          {`,
  String.raw`            \regex_extract_once:nnNTF { \A ([^.]+ \. [^.]+) \. (num|dash) \Z } {#1} \l_tmpa_seq`,
  String.raw`              {`,
  String.raw`                \use:e`,
  String.raw`                  {`,
  String.raw`                    \exp_not:N \cmpd`,
  String.raw`                    [ post-main-label-code = \str_if_eq:eeTF { \seq_item:Nn \l_tmpa_seq { 3 } } { num } { . } { - } , sub-counter-format = arabic ]`,
  String.raw`                    { \seq_item:Nn \l_tmpa_seq { 2 } }`,
  String.raw`                  }`,
  String.raw`              }`,
  String.raw`              {`,
  String.raw`                \regex_extract_once:nnNTF { \A ([^.]+ \. [^.]+) \. letter \Z } {#1} \l_tmpa_seq`,
  String.raw`                  { \use:e { \exp_not:N \cmpd { \seq_item:Nn \l_tmpa_seq { 2 } } } }`,
  String.raw`                  { \cmpd {#1} }`,
  String.raw`              }`,
  String.raw`          }`,
  String.raw`      }`,
  String.raw`      { \textbf { ?? } }`,
  String.raw`  }`,
  String.raw`\ExplSyntaxOff`,
];

/** The packages and preamble lines an entry file's own text needs, comments aside. */
export function figureNeeds(entryText: string): { packages: string[]; preamble?: string[] } {
  const code = entryText.replace(/(?<!\\)%.*$/gm, "");
  const packages = ["graphicx"];
  if (/\\begin\s*\{tikzpicture\}|\\tikz\b/.test(code)) packages.push("tikz");
  if (/\\(?:r?cmpd\*?|refcmpd)\b/.test(code)) packages.push("chemnum");
  return /\\rcmpd\s*\{/.test(code) ? { packages, preamble: RCMPD_PREAMBLE } : { packages };
}
