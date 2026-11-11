/**
 * The system clipboard's HTML, for the Paste Figure command: VS Code gives an
 * extension only the clipboard's text, so this asks the system for the rest.
 */
import { execFile } from "node:child_process";

const run = (command: string, args: string[]) => new Promise<string>((resolve, reject) => {
  execFile(command, args, { maxBuffer: 512 * 1024 * 1024, encoding: "utf8", windowsHide: true, timeout: 20_000 }, (error, stdout) => {
    if (error) reject(error);
    else resolve(stdout);
  });
});

/** macOS answers `«data HTML3C6469…»`: the HTML's bytes in hex. */
export function fromAppleScript(output: string): string {
  const hex = /«data HTML([0-9A-Fa-f]*)»/.exec(output)?.[1];
  return hex ? Buffer.from(hex, "hex").toString("utf8") : "";
}

/** The clipboard's `text/html`, or "" when it holds none (or the system cannot be asked). */
export async function clipboardHtml(platform: NodeJS.Platform = process.platform): Promise<string> {
  try {
    if (platform === "darwin") return fromAppleScript(await run("osascript", ["-e", "the clipboard as «class HTML»"]));
    if (platform === "win32") {
      return await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-STA", "-Command",
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.Clipboard]::GetText([Windows.Forms.TextDataFormat]::Html)"]);
    }
    return await run("wl-paste", ["--no-newline", "--type", "text/html"]).catch(() => run("xclip", ["-selection", "clipboard", "-target", "text/html", "-out"]));
  } catch {
    return "";
  }
}
