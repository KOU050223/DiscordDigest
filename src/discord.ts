import { maxSnowflake, snowflakeToDate, timestampToSnowflake } from "./channel-url";
import { DiscordError, MessageContentIntentError } from "./errors";
import type { Env, FetchResult, NormalizedMessage } from "./types";

const API_BASE = "https://discord.com/api/v10";

/** 1リクエストあたりの取得上限（Discord の仕様上の最大値） */
const PAGE_SIZE = 100;

/** 安全弁。到達してもエラーにはせず、部分結果に truncated を立てて返す */
export const DEFAULT_LIMITS = { maxPages: 100, maxMessages: 5000 } as const;

/** メッセージ本文を持つ通常メッセージの type（DEFAULT / REPLY） */
const TEXT_MESSAGE_TYPES = new Set([0, 19]);

type RawMessage = {
  id: string;
  type: number;
  content: string;
  timestamp: string;
  author: {
    id: string;
    username: string;
    global_name?: string | null;
    bot?: boolean;
  };
  attachments?: { filename: string }[];
  referenced_message?: { id: string } | null;
};

/**
 * Discord API を GET する。429 は retry_after に従って自動リトライする。
 *
 * retry_after はボディでは「秒（小数）」で返るのでミリ秒へ換算すること。
 */
async function discordGet<T>(env: Env, url: URL, attempt = 0): Promise<T> {
  const res = await fetch(url, {
    headers: {
      // シークレットには裸のトークンを保存し、プレフィックスはここだけで付ける
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "User-Agent": "Disgest (https://github.com/, 0.1.0)",
    },
  });

  if (res.status === 429) {
    if (attempt >= 5) {
      throw new DiscordError(
        "Discord のレート制限が続いています。しばらく待ってから再実行してください。",
        429,
      );
    }
    const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
    const headerRetry = Number(res.headers.get("retry-after"));
    const retryAfterSec =
      body.retry_after ?? (Number.isFinite(headerRetry) ? headerRetry : 1);
    const waitMs = Math.ceil(retryAfterSec * 1000) + 100;
    await new Promise((r) => setTimeout(r, waitMs));
    return discordGet<T>(env, url, attempt + 1);
  }

  if (res.status === 401) {
    throw new DiscordError("Botトークンが無効です。", 401);
  }
  if (res.status === 403) {
    throw new DiscordError(
      "Botにこのチャンネルの閲覧権限がありません（View Channel / Read Message History を確認してください）。",
      403,
    );
  }
  if (res.status === 404) {
    throw new DiscordError("チャンネルが見つかりません。IDを確認してください。", 404);
  }
  if (!res.ok) {
    throw new DiscordError(`Discord APIエラー: ${res.status}`, res.status);
  }

  return (await res.json()) as T;
}

/** チャンネル名を取得する（表示用。失敗しても致命的ではない） */
export async function fetchChannelName(
  env: Env,
  channelId: string,
): Promise<string | undefined> {
  try {
    const data = await discordGet<{ name?: string }>(
      env,
      new URL(`${API_BASE}/channels/${channelId}`),
    );
    return data.name;
  } catch {
    return undefined;
  }
}

/**
 * 指定期間のメッセージを取得する。
 *
 * messages エンドポイントには期間指定が無く、before/after/around は相互排他。
 * そこで after に開始時刻の snowflake を渡して前進ページングし、
 * 終了時刻はクライアント側で打ち切る。
 */
export async function fetchMessages(
  env: Env,
  channelId: string,
  fromMs: number,
  toMs: number,
  onProgress: (p: { pages: number; count: number }) => void,
  limits: { maxPages: number; maxMessages: number } = DEFAULT_LIMITS,
): Promise<FetchResult> {
  let cursor = timestampToSnowflake(fromMs);
  const collected: RawMessage[] = [];
  let truncated = false;
  let truncateReason: string | undefined;
  let pages = 0;
  let reachedEnd = false;

  while (true) {
    if (pages >= limits.maxPages) {
      truncated = true;
      truncateReason = `取得ページ数の上限（${limits.maxPages}ページ）に達しました`;
      break;
    }

    const url = new URL(`${API_BASE}/channels/${channelId}/messages`);
    url.searchParams.set("limit", String(PAGE_SIZE));
    url.searchParams.set("after", cursor);

    const batch = await discordGet<RawMessage[]>(env, url);
    pages++;

    if (batch.length === 0) break;

    // 終了時刻を超えたものは捨てる。1件でも捨てたら期間の終端に到達している
    const inRange = batch.filter((m) => snowflakeToDate(m.id).getTime() <= toMs);
    collected.push(...inRange);
    if (inRange.length < batch.length) reachedEnd = true;

    onProgress({ pages, count: collected.length });

    if (reachedEnd) break;

    if (collected.length >= limits.maxMessages) {
      truncated = true;
      truncateReason = `取得件数の上限（${limits.maxMessages}件）に達しました`;
      break;
    }

    // これ以上のページは存在しない
    if (batch.length < PAGE_SIZE) break;

    // 並び順に依存しないよう、位置ではなく値の最大を次カーソルにする
    cursor = maxSnowflake(batch.map((m) => m.id));
  }

  const messages = normalize(collected);

  // Intent 無効時、Discord はエラーを返さず content を空にするだけなので明示的に検知する。
  //
  // 判定は「人間が書いた通常メッセージ」に限る。参加通知やピン留め通知は type が
  // 0/19 以外で content も空なので、生の配列で見ると Intent が有効でも誤検知する。
  const humanMessages = collected.filter(
    (m) => !m.author.bot && TEXT_MESSAGE_TYPES.has(m.type),
  );
  if (humanMessages.length > 0 && humanMessages.every((m) => m.content === "")) {
    throw new MessageContentIntentError();
  }

  return { messages, truncated, truncateReason, pagesFetched: pages };
}

/** Bot・システムメッセージを除き、要約に必要な形へ整える */
function normalize(raw: RawMessage[]): NormalizedMessage[] {
  const seen = new Set<string>();

  return raw
    .filter((m) => !m.author.bot)
    .filter((m) => TEXT_MESSAGE_TYPES.has(m.type))
    .filter((m) => m.content.trim() !== "" || (m.attachments?.length ?? 0) > 0)
    .filter((m) => {
      // ページングの境界で同じメッセージを拾う可能性に備える
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    })
    .map((m) => ({
      id: m.id,
      authorName: m.author.global_name || m.author.username,
      authorId: m.author.id,
      timestamp: m.timestamp,
      content: m.content,
      replyToId: m.referenced_message?.id,
      attachments: (m.attachments ?? []).map((a) => a.filename),
    }))
    .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}
