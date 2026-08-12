import { describe, expect, it } from "vitest";
import { buildShareText, extractOverview } from "./share-text";

describe("extractOverview", () => {
  it("## 概要 の中身を取り出す", () => {
    const md = "# タイトル\n\n## 概要\n\n今日は認証の設計を決めた。\n\n## 決定事項\n\n- 採用する";
    expect(extractOverview(md)).toBe("今日は認証の設計を決めた。");
  });

  it("概要が複数行なら連結する", () => {
    const md = "## 概要\n一行目。\n二行目。\n\n## 次の見出し\n無関係";
    expect(extractOverview(md)).toBe("一行目。 二行目。");
  });

  it("次の見出しで打ち切る", () => {
    const md = "## 概要\n中身。\n## 決定事項\n拾ってはいけない";
    expect(extractOverview(md)).toBe("中身。");
  });

  it("概要が無ければ最初の段落で代用する", () => {
    const md = "# タイトル\n\n最初の段落。\n続き。\n\n## 概要ではない見出し\n別の話";
    expect(extractOverview(md)).toBe("最初の段落。 続き。");
  });

  it("箇条書きの記号を行ごとに落とす", () => {
    const md = "## 概要\n- 一つ目\n- 二つ目\n1. 三つ目";
    expect(extractOverview(md)).toBe("一つ目 二つ目 三つ目");
  });

  it("Markdown の装飾を落とす", () => {
    const md = "## 概要\n**太字**と`コード`と_斜体_、[リンク](https://example.com)。";
    expect(extractOverview(md)).toBe("太字とコードと斜体、リンク。");
  });

  it("画像記法もテキストだけ残す", () => {
    const md = "## 概要\n![代替テキスト](https://example.com/a.png)";
    expect(extractOverview(md)).toBe("代替テキスト");
  });

  it("300字を超えたら省略記号を付ける", () => {
    const md = `## 概要\n${"あ".repeat(400)}`;
    const result = extractOverview(md);
    // 300字 + "…"
    expect(Array.from(result)).toHaveLength(301);
    expect(result.endsWith("…")).toBe(true);
  });

  it("絵文字を途中で割らない", () => {
    // サロゲートペアを含む絵文字を並べ、300コードポイントを超えさせる
    const md = `## 概要\n${"🪄".repeat(400)}`;
    const result = extractOverview(md);
    expect(result).not.toContain("�");
    expect(Array.from(result)).toHaveLength(301);
  });

  it("空の Markdown では空文字を返す", () => {
    expect(extractOverview("")).toBe("");
  });

  it("見出しだけなら空文字を返す", () => {
    expect(extractOverview("# タイトル\n## 概要")).toBe("");
  });
});

describe("buildShareText", () => {
  const url = "https://example.com/#job=abc";

  it("定型文・URL・概要を並べる", () => {
    const text = buildShareText("## 概要\n決まったこと。", url);
    expect(text).toBe(
      "Disgest を使って、Discord の要約やってみました！🪄\n" +
        `${url}\n` +
        "\n【概要】\n決まったこと。",
    );
  });

  it("概要が取れないときは URL までで止める", () => {
    const text = buildShareText("", url);
    expect(text).toBe(`Disgest を使って、Discord の要約やってみました！🪄\n${url}`);
    expect(text).not.toContain("【概要】");
  });
});
