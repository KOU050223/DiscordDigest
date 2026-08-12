import type { DigestJob } from "./digest-job";

/**
 * Worker 側だけで使う型。
 *
 * ブラウザと共有する型（ProgressEvent など）は protocol.ts にある。
 * 再エクスポートもしているので、サーバー側は従来どおり
 * ここから import できる。
 */

export type {
  DigestParams,
  JobSnapshot,
  JobStatus,
  ProgressEvent,
  ResultStats,
} from "./protocol";

export type Env = {
  AI: Ai;
  DIGEST_JOB: DurableObjectNamespace<DigestJob>;
  /** メッセージ取得に使う Bot トークン（"Bot " は付けずに保存する） */
  DISCORD_BOT_TOKEN: string;
  /** OAuth ログイン用 */
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  /** セッション署名鍵（32バイト以上のランダム値） */
  SESSION_SECRET: string;
  /** このサーバーのメンバーだけがログインできる */
  ALLOWED_GUILD_ID: string;
};

/** Discord から取得したメッセージを、要約に必要な形へ落としたもの */
export type NormalizedMessage = {
  id: string;
  authorName: string;
  authorId: string;
  /** ISO8601 */
  timestamp: string;
  content: string;
  /** 返信元メッセージの ID（返信でなければ undefined） */
  replyToId?: string;
  /** 添付ファイル名の配列 */
  attachments: string[];
};

export type FetchResult = {
  messages: NormalizedMessage[];
  /** 上限に達して打ち切ったか */
  truncated: boolean;
  truncateReason?: string;
  pagesFetched: number;
};
