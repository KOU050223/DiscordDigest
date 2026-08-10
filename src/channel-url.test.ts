import { describe, expect, it } from "vitest";
import {
  maxSnowflake,
  parseChannelRef,
  parseDateRange,
  snowflakeToDate,
  timestampToSnowflake,
} from "./channel-url";
import { BadInputError } from "./errors";

describe("parseChannelRef", () => {
  it("チャンネルURLから channel id を取り出す", () => {
    expect(parseChannelRef("https://discord.com/channels/111111111111111111/222222222222222222")).toBe(
      "222222222222222222",
    );
  });

  it("メッセージIDまで含むURLでも channel id を取る", () => {
    expect(
      parseChannelRef(
        "https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333",
      ),
    ).toBe("222222222222222222");
  });

  it("discordapp.com にも対応する", () => {
    expect(
      parseChannelRef("https://discordapp.com/channels/111111111111111111/222222222222222222"),
    ).toBe("222222222222222222");
  });

  it("生のIDをそのまま受け付ける", () => {
    expect(parseChannelRef("222222222222222222")).toBe("222222222222222222");
    expect(parseChannelRef("  222222222222222222  ")).toBe("222222222222222222");
  });

  it("空文字や不正な形式を弾く", () => {
    expect(() => parseChannelRef("")).toThrow(BadInputError);
    expect(() => parseChannelRef("not a url")).toThrow(BadInputError);
    expect(() => parseChannelRef("12345")).toThrow(BadInputError);
  });
});

describe("snowflake", () => {
  it("時刻→snowflake→時刻で元に戻る", () => {
    const ms = Date.parse("2024-03-14T10:23:00.000Z");
    const sf = timestampToSnowflake(ms);
    expect(snowflakeToDate(sf).getTime()).toBe(ms);
  });

  it("Discord Epoch より前は 0 になる", () => {
    expect(timestampToSnowflake(Date.parse("2010-01-01T00:00:00Z"))).toBe("0");
  });

  it("既知の snowflake の時刻を復元できる", () => {
    // (ms - 1420070400000) << 22 の関係を満たす値
    const ms = Date.parse("2020-01-01T00:00:00.000Z");
    expect(snowflakeToDate(timestampToSnowflake(ms)).toISOString()).toBe(
      "2020-01-01T00:00:00.000Z",
    );
  });
});

describe("maxSnowflake", () => {
  it("数値としての最大を返す（文字列比較ではない）", () => {
    // 桁数が異なると文字列比較では誤る組み合わせ
    expect(maxSnowflake(["9999999999999999999", "10000000000000000000"])).toBe(
      "10000000000000000000",
    );
  });

  it("並び順に関係なく最大を返す", () => {
    const ids = ["300000000000000000", "100000000000000000", "200000000000000000"];
    expect(maxSnowflake(ids)).toBe("300000000000000000");
    expect(maxSnowflake([...ids].reverse())).toBe("300000000000000000");
  });
});

describe("parseDateRange", () => {
  it("JSTの日付として解釈する（終了日はその日いっぱいを含む）", () => {
    const { fromMs, toMs } = parseDateRange("2024-03-01", "2024-03-02");
    // JST 03-01 00:00 = UTC 02-29 15:00
    expect(new Date(fromMs).toISOString()).toBe("2024-02-29T15:00:00.000Z");
    // JST 03-02 23:59:59.999 = UTC 03-02 14:59:59.999
    expect(new Date(toMs).toISOString()).toBe("2024-03-02T14:59:59.999Z");
  });

  it("1日を指定するとちょうど24時間になる", () => {
    const { fromMs, toMs } = parseDateRange("2024-03-01", "2024-03-01");
    expect(toMs - fromMs).toBe(86400000 - 1);
  });

  it("開始日が終了日より後なら弾く", () => {
    expect(() => parseDateRange("2024-03-05", "2024-03-01")).toThrow(BadInputError);
  });

  it("不正な日付を弾く", () => {
    expect(() => parseDateRange("", "")).toThrow(BadInputError);
  });
});
