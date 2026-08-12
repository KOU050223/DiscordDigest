/**
 * SNS へ貼る共有テキストの組み立て。
 *
 * DOM に触らない純関数だけを置く（テストできるようにするため）。
 */

/** 共有文に載せる概要の最大文字数 */
const OVERVIEW_MAX_CHARS = 300;

/**
 * 行頭の箇条書き記号を落とす。
 * 連結してからでは行頭でなくなるので、必ず1行ずつ通す。
 */
function stripBullet(line: string): string {
  return line.trim().replace(/^(?:[-*+]|\d+\.)\s+/, "");
}

/** SNS に貼る前提で、Markdown の装飾を落として素の文章にする */
function stripMarkdown(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 共有文に載せる「概要」を取り出す。
 *
 * ## 概要 はプロンプトの目安でしかなく、まとめ方の希望次第では
 * 出てこない。その場合は本文の最初の段落で代用する。
 */
export function extractOverview(markdown: string): string {
  const lines = markdown.split("\n");
  const picked: string[] = [];
  let inOverview = false;

  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      if (inOverview) break; // 次の見出しまでが概要
      inOverview = /^##\s*概要\s*$/.test(line);
      continue;
    }
    if (inOverview && line.trim()) picked.push(stripBullet(line));
  }

  if (picked.length === 0) {
    // 概要が無いときは、見出し以外で最初に現れるまとまりを使う
    for (const line of lines) {
      if (/^#{1,6}\s/.test(line) || !line.trim()) {
        if (picked.length > 0) break;
        continue;
      }
      picked.push(stripBullet(line));
    }
  }

  const text = stripMarkdown(picked.join(" "));

  // 絵文字の途中で切ると文字化けするので、コードポイント単位で数える
  const chars = Array.from(text);
  return chars.length > OVERVIEW_MAX_CHARS
    ? `${chars.slice(0, OVERVIEW_MAX_CHARS).join("")}…`
    : text;
}

/** 共有テキスト。URL は #job= を含む今開いている URL をそのまま使う */
export function buildShareText(markdown: string, url: string): string {
  const overview = extractOverview(markdown);
  const lines = ["Disgest を使って、Discord の要約やってみました！🪄", url];
  if (overview) {
    lines.push("", "【概要】", overview);
  }
  return lines.join("\n");
}
