/**
 * 要約結果を表示するための最小限の Markdown レンダラ。
 *
 * 外部ライブラリを足さずに済ませるため自前で持つ。対応するのは
 * 要約プロンプトが実際に生成する範囲（見出し・箇条書き・番号付き・
 * 強調・インラインコード・コードブロック・水平線）に限る。
 *
 * 入力には Discord の発言内容が含まれるため、
 * **必ず先にHTMLエスケープしてから**装飾を適用する。
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** エスケープ済みテキストにインライン装飾を適用する */
function renderInline(escaped: string): string {
  return (
    escaped
      // `code`
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      // **bold**
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      // *italic* / _italic_（**の処理後なので単独の * のみ残る）
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/(^|[^_])_([^_]+)_/g, "$1<em>$2</em>")
  );
}

type ListState = { type: "ul" | "ol"; open: boolean };

/**
 * Markdown を HTML 文字列へ変換する。
 * 戻り値は innerHTML に代入して使う。
 */
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  const list: ListState = { type: "ul", open: false };
  let inCodeBlock = false;
  let paragraph: string[] = [];

  const closeList = () => {
    if (list.open) {
      out.push(`</${list.type}>`);
      list.open = false;
    }
  };

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      out.push(`<p>${renderInline(paragraph.join("<br>"))}</p>`);
      paragraph = [];
    }
  };

  const openList = (type: "ul" | "ol") => {
    if (list.open && list.type !== type) closeList();
    if (!list.open) {
      out.push(`<${type}>`);
      list.type = type;
      list.open = true;
    }
  };

  for (const rawLine of lines) {
    const line = escapeHtml(rawLine);

    // コードブロックの内側は装飾せずそのまま出す
    if (/^\s*```/.test(rawLine)) {
      if (inCodeBlock) {
        out.push("</code></pre>");
        inCodeBlock = false;
      } else {
        flushParagraph();
        closeList();
        out.push("<pre><code>");
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      out.push(line);
      continue;
    }

    // 空行は段落とリストの区切り
    if (rawLine.trim() === "") {
      flushParagraph();
      closeList();
      continue;
    }

    // 見出し（#### まで）
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    // 水平線
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(rawLine)) {
      flushParagraph();
      closeList();
      out.push("<hr>");
      continue;
    }

    // 箇条書き
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      flushParagraph();
      openList("ul");
      out.push(`<li>${renderInline(bullet[1])}</li>`);
      continue;
    }

    // 番号付きリスト
    const numbered = line.match(/^\s*\d+\.\s+(.*)$/);
    if (numbered) {
      flushParagraph();
      openList("ol");
      out.push(`<li>${renderInline(numbered[1])}</li>`);
      continue;
    }

    // 引用
    const quote = line.match(/^\s*&gt;\s?(.*)$/);
    if (quote) {
      flushParagraph();
      closeList();
      out.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
      continue;
    }

    // それ以外は段落として蓄積する
    closeList();
    paragraph.push(line);
  }

  flushParagraph();
  closeList();
  if (inCodeBlock) out.push("</code></pre>");

  return out.join("\n");
}
