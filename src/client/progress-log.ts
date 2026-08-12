import { els } from "./dom";

/** 進捗ログの表示。行単位で足す / 最後の行を差し替える */

export function setLog(lines: string[]): void {
  els.progressLog.textContent = lines.join("\n");
  els.progressLog.scrollTop = els.progressLog.scrollHeight;
}

function currentLines(): string[] {
  const text = els.progressLog.textContent;
  return text ? text.split("\n") : [];
}

export function addLog(line: string): void {
  const lines = currentLines();
  lines.push(line);
  setLog(lines);
}

export function replaceLastLog(line: string): void {
  const lines = currentLines();
  if (lines.length > 0) lines[lines.length - 1] = line;
  else lines.push(line);
  setLog(lines);
}
