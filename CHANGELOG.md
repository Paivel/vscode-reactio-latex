# Changelog

## 0.1.0

First version: paste a figure with its files, Edit in Reactio Draw, compound numbers in hovers and completion.

## 0.1.1

- A paste now inserts the figure (it wrote the files but no text), and writes the files only once the paste is taken.

## 0.1.2

- A figure whose drawing gained compound marks after it was pasted adds what it now needs (`tikz`, `chemnum`, `\rcmpd`) to the main document, when the drawing is saved or the document is opened.

## 0.2.0

- Export Figures for Submission: each figure with its compound numbers as `Scheme1.pdf` and `Scheme1.tiff`, named by function, for journals that take figures as separate files.

## 0.2.1

- TIFF export on macOS draws the figure (it gave an all-black image).

## 0.2.2

- Export Figures for Submission also writes the article as one `.tex` with each figure as `\includegraphics{Scheme1}`, with the files it needs, builds it from that folder to check it, and puts its PDF beside it.
- `\rcmpd`: the hyphen in its character class is escaped, so a build no longer warns "Invalid end-point for range" at every mark.
- A workspace's settings can no longer name a program other than pdflatex, xelatex or lualatex for the export, or an export folder outside the document's; export is off in an untrusted workspace.

## 0.2.3

- A figure pasted on an empty line goes in a `scheme` with `\label{sch:}` when the document has a scheme float (the ACS class `achemso`, `chemstyle`, or `\newfloat{scheme}`), and in a `figure` otherwise. The setting `reactioLatex.paste.float` picks one always.

## 0.2.5

- 0.2.4 (a click in the PDF opening the drawing) is withdrawn: the click shows the figure's `.tex` again.
- Copy Compound by Number: the number the PDF shows gives the exact `\rcmpd{…}` or `\cmpd{…}` that cites the compound.
- A Compounds view in the explorer lists every compound by number, with that LaTeX and its figure; a click copies it.
