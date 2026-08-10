import { BadInputError } from "./errors";

/** Discord Epoch: 2015-01-01T00:00:00Z */
const DISCORD_EPOCH = 1420070400000n;

/**
 * チャンネル URL または生の ID から channel id を取り出す。
 *
 * スレッドは独立した channel id を持つので、チャンネルと同じ形で扱える。
 * URL 末尾にメッセージ ID が付く形式もあるため、2 番目のセグメントを採用する。
 */
export function parseChannelRef(input: string): string {
  const s = input.trim();
  if (!s) throw new BadInputError("チャンネルURLまたはIDを入力してください");

  if (/^\d{17,20}$/.test(s)) return s;

  const m = s.match(/discord(?:app)?\.com\/channels\/(\d+)\/(\d+)/);
  if (!m) {
    throw new BadInputError(
      "チャンネルURLまたはIDの形式が不正です（例: https://discord.com/channels/123.../456...）",
    );
  }
  return m[2];
}

/**
 * unix ミリ秒から snowflake を合成する。
 *
 * Discord の messages エンドポイントには期間指定のパラメータが無いため、
 * 時刻を snowflake に変換して after に渡すことで期間の下限を表現する。
 */
export function timestampToSnowflake(unixMs: number): string {
  const ms = BigInt(Math.floor(unixMs));
  if (ms < DISCORD_EPOCH) return "0";
  return String((ms - DISCORD_EPOCH) << 22n);
}

/** snowflake に埋め込まれた生成時刻を取り出す */
export function snowflakeToDate(id: string): Date {
  return new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
}

/**
 * ID 群の最大値を返す。
 *
 * after ページングのカーソルに使う。Discord は after 使用時の並び順を
 * 明示していないため、配列の先頭/末尾を当てにすると順序次第で
 * 無限ループや取りこぼしを起こす。位置ではなく値で最大を取る。
 */
export function maxSnowflake(ids: string[]): string {
  if (ids.length === 0) throw new Error("maxSnowflake: 空配列");
  return ids.reduce((a, b) => (BigInt(b) > BigInt(a) ? b : a));
}

/**
 * フォームの日付文字列（YYYY-MM-DD）を範囲の unix ms に変換する。
 *
 * ユーザーが選ぶ日付は JST のカレンダー上の日付なので、JST の
 * 00:00:00〜23:59:59 として解釈する（+09:00 を明示）。
 * UTC で解釈すると期間が9時間ずれる。
 */
export function parseDateRange(
  fromDate: string,
  toDate: string,
): { fromMs: number; toMs: number } {
  const from = Date.parse(`${fromDate}T00:00:00+09:00`);
  // 終了日はその日いっぱいを含める
  const to = Date.parse(`${toDate}T23:59:59.999+09:00`);

  if (Number.isNaN(from) || Number.isNaN(to)) {
    throw new BadInputError("日付の形式が不正です");
  }
  if (from > to) {
    throw new BadInputError("開始日が終了日より後になっています");
  }
  return { fromMs: from, toMs: to };
}
