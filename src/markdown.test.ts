import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown - XSS対策", () => {
  it("scriptタグをエスケープする", () => {
    const out = renderMarkdown("<script>alert(1)</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("imgのonerrorをエスケープする", () => {
    const out = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("見出しの中のHTMLもエスケープする", () => {
    const out = renderMarkdown("## <script>bad</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("<h2>");
  });

  it("箇条書きの中のHTMLもエスケープする", () => {
    const out = renderMarkdown("- <script>bad</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("<li>");
  });

  it("コードブロック内のHTMLもエスケープする", () => {
    const out = renderMarkdown("```\n<script>bad</script>\n```");
    expect(out).not.toContain("<script>");
    expect(out).toContain("<pre><code>");
  });

  it("引用符と&もエスケープする", () => {
    const out = renderMarkdown('a & b "c" \'d\'');
    expect(out).toContain("&amp;");
    expect(out).toContain("&quot;");
  });
});

describe("renderMarkdown - 生成タグの許可リスト", () => {
  // 出力は innerHTML に入るため、意図した以外のタグや
  // イベントハンドラが一切生成されないことを保証する。
  const ALLOWED = new Set([
    "p", "h1", "h2", "h3", "h4", "ul", "ol", "li",
    "strong", "em", "code", "pre", "hr", "blockquote", "br",
  ]);

  const attacks = [
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "<svg onload=alert(1)>",
    '<iframe src="javascript:alert(1)">',
    '<a href="javascript:alert(1)">click</a>',
    "## <img src=x onerror=alert(1)>",
    "* <script>alert(1)</script>",
    "`<script>alert(1)</script>`",
    "**<img src=x onerror=alert(1)>**",
    '<div onmouseover="alert(1)">hover</div>',
    "<body onload=alert(1)>",
    '"><script>alert(1)</script>',
    "```\n<script>alert(1)</script>\n```",
    "> <script>alert(1)</script>",
  ];

  it.each(attacks)("許可タグ以外を生成しない: %s", (input) => {
    const out = renderMarkdown(input);
    const tags = [...out.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g)].map((m) =>
      m[1].toLowerCase(),
    );
    for (const tag of tags) expect(ALLOWED).toContain(tag);
    // インラインイベントハンドラが生成されないこと
    expect(out).not.toMatch(/<[^>]*\son\w+\s*=/i);
  });
});

describe("renderMarkdown - 見出し", () => {
  it("## を h2 にする", () => {
    expect(renderMarkdown("## 概要")).toContain("<h2>概要</h2>");
  });

  it("### を h3 にする", () => {
    expect(renderMarkdown("### 詳細")).toContain("<h3>詳細</h3>");
  });
});

describe("renderMarkdown - リスト", () => {
  it("* を ul にまとめる", () => {
    const out = renderMarkdown("* one\n* two");
    expect(out).toContain("<ul>");
    expect(out.match(/<li>/g)).toHaveLength(2);
    expect(out).toContain("</ul>");
  });

  it("- も ul として扱う", () => {
    expect(renderMarkdown("- one")).toContain("<li>one</li>");
  });

  it("番号付きを ol にする", () => {
    const out = renderMarkdown("1. one\n2. two");
    expect(out).toContain("<ol>");
    expect(out).toContain("</ol>");
  });

  it("空行でリストを閉じる", () => {
    const out = renderMarkdown("* one\n\n段落");
    expect(out.indexOf("</ul>")).toBeLessThan(out.indexOf("<p>"));
  });

  it("ul と ol が続いたら別リストにする", () => {
    const out = renderMarkdown("* a\n1. b");
    expect(out).toContain("</ul>");
    expect(out).toContain("<ol>");
  });
});

describe("renderMarkdown - インライン装飾", () => {
  it("**bold** を strong にする", () => {
    expect(renderMarkdown("**強調**")).toContain("<strong>強調</strong>");
  });

  it("`code` を code にする", () => {
    expect(renderMarkdown("`x = 1`")).toContain("<code>x = 1</code>");
  });

  it("*italic* を em にする", () => {
    expect(renderMarkdown("これは *斜体* です")).toContain("<em>斜体</em>");
  });

  it("boldをitalicと誤認しない", () => {
    const out = renderMarkdown("**太字**");
    expect(out).toContain("<strong>");
    expect(out).not.toContain("<em>");
  });
});

describe("renderMarkdown - 改行が潰れた出力への耐性", () => {
  // モデルがまれに改行を落として1行で返すことがある。
  // そのままだと全体が1つの見出しに潰れて読めなくなる。
  const flat =
    "## 概要 音楽の共有。 ## 主な話題 ### 音楽 - SiMのツアー。 - バンドリの話題。 ## 決まったこと - 特になし";

  it("見出しを分割して認識する", () => {
    const out = renderMarkdown(flat);
    expect(out.match(/<h2>/g)).toHaveLength(3);
    expect(out.match(/<h3>/g)).toHaveLength(1);
  });

  it("箇条書きを分割して認識する", () => {
    const out = renderMarkdown(flat);
    expect(out.match(/<li>/g)).toHaveLength(3);
  });

  it("正常な改行ありの入力を壊さない", () => {
    const normal = "## 概要\n音楽の雑談。\n\n## 主な話題\n* SiM\n* ヤバT";
    const out = renderMarkdown(normal);
    expect(out.match(/<h2>/g)).toHaveLength(2);
    expect(out.match(/<li>/g)).toHaveLength(2);
    expect(out).toContain("<p>音楽の雑談。</p>");
  });

  it("本文中のハイフンを箇条書きと誤認しない", () => {
    const out = renderMarkdown("## 概要\n2024-03-14 のログ。範囲は10-20件。");
    expect(out).not.toContain("<li>");
    expect(out).toContain("2024-03-14");
    expect(out).toContain("10-20件");
  });
});

describe("renderMarkdown - 実際の要約出力", () => {
  it("典型的な要約を破綻なく変換する", () => {
    const md = [
      "## 概要",
      "リリースを延期した。",
      "",
      "## 決まったこと",
      "* リリースを月曜に延期する",
      "* テストは金曜までに完了",
      "",
      "## 未解決・持ち越し",
      "特になし",
    ].join("\n");

    const out = renderMarkdown(md);
    expect(out).toContain("<h2>概要</h2>");
    expect(out).toContain("<h2>決まったこと</h2>");
    expect(out.match(/<li>/g)).toHaveLength(2);
    expect(out).toContain("<p>特になし</p>");
    // タグの開閉数が合っていること
    expect(out.match(/<ul>/g)?.length).toBe(out.match(/<\/ul>/g)?.length);
  });

  it("空文字でも壊れない", () => {
    expect(renderMarkdown("")).toBe("");
  });
});
