import type { ResultStats } from "../protocol";
import { els } from "./dom";
import { addLog } from "./progress-log";
import { closeTips, openTips } from "./tips";

/** Workers AI 無料枠の1日あたりの上限 */
const FREE_NEURONS_PER_DAY = 10000;

/**
 * 処理中フラグ。小話モーダルの開閉もここに集約する。
 *
 * 「処理中」への入口は submit・再接続・スナップショットの3つ、出口は
 * 完了とエラーの2つあるが、すべてこの関数を通る。個別に書くと閉じ忘れる。
 */
export function setBusy(busy: boolean): void {
  els.submitBtn.disabled = busy;
  els.submitBtn.setAttribute("aria-busy", busy ? "true" : "false");
  els.submitBtn.textContent = busy ? "処理中…" : "要約する";

  els.tipsOpenBtn.hidden = !busy;
  if (busy) openTips();
  else closeTips();
}

/**
 * 入力フォームと進捗を畳む / 開く。
 *
 * 「もう結果が出ている URL」を開いたときだけ畳む。実行中に再読み込み
 * された場合は進捗ログが主役なので開いたままにする。
 */
export function setInputCollapsed(collapsed: boolean): void {
  els.inputPanel.open = !collapsed;
  els.inputSummary.textContent = collapsed
    ? "別の条件で要約する（入力と進捗を表示）"
    : "条件を入力して要約する";
}

/** 表示中の要約の Markdown。コピーと共有がこれを使う */
let currentMarkdown = "";

export function getCurrentMarkdown(): string {
  return currentMarkdown;
}

/** 統計情報を1行のテキストへ整える */
function formatStats(stats: ResultStats): string {
  const parts = [
    `${stats.messageCount}件`,
    `${stats.authorCount}人`,
    `チャンク ${stats.chunkCount}`,
  ];

  if (typeof stats.neurons === "number" && stats.neurons > 0) {
    const n = stats.neurons;
    const pct = (n / FREE_NEURONS_PER_DAY) * 100;
    parts.push(
      `消費 ${n.toFixed(1)} Neurons（無料枠の ${pct.toFixed(2)}%／` +
        `1日あたり残り約 ${Math.floor(FREE_NEURONS_PER_DAY / n)} 回）`,
    );
  }

  parts.push(stats.model);

  let text = parts.join(" / ");
  if (stats.truncated) {
    text += `  ※${stats.truncateReason || "上限に達したため一部のみ要約しました"}`;
  }
  return text;
}

/**
 * 要約結果を表示する。
 *
 * htmlBody は markdown.ts の renderMarkdown が生成したものだけを渡すこと。
 * あの関数は装飾を当てる前に必ず全行を HTML エスケープする（Discord の
 * 発言内容がそのまま入るため）。エスケープ済みだからこそ innerHTML で
 * 流し込める。ここに別経路の HTML を渡すと XSS になるので、
 * クライアント側で Markdown をレンダリングし直す設計にはしない。
 */
export function showResult(
  markdown: string,
  stats?: ResultStats,
  htmlBody?: string,
): void {
  els.resultSection.hidden = false;
  currentMarkdown = markdown || "";

  // サーバーでエスケープ済みの HTML。無ければ生テキストで安全側に倒す
  if (htmlBody) els.resultBody.innerHTML = htmlBody;
  else els.resultBody.textContent = markdown;

  if (stats) els.resultMeta.textContent = formatStats(stats);

  setBusy(false);
}

export function showError(message: string): void {
  addLog(`エラー: ${message}`);
  setBusy(false);
}
