import type { DigestJob } from "./digest-job";

export type Env = {
  AI: Ai;
  DIGEST_JOB: DurableObjectNamespace<DigestJob>;
  DISCORD_BOT_TOKEN: string;
};

/** フォームから受け取るジョブのパラメータ */
export type DigestParams = {
  channelId: string;
  /** 取得期間の開始（unix ms, inclusive） */
  fromMs: number;
  /** 取得期間の終了（unix ms, inclusive） */
  toMs: number;
  /** 任意のカスタムプロンプト。空文字なら既定の観点で要約する */
  customPrompt: string;
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

export type JobStatus = "pending" | "running" | "done" | "error";

/** WebSocket でブラウザへ push するイベント */
export type ProgressEvent =
  | { phase: "status"; status: JobStatus; message?: string }
  | { phase: "fetch"; pages: number; count: number }
  | { phase: "summarize"; done: number; total: number }
  | {
      phase: "result";
      markdown: string;
      /** markdown をサーバー側でHTMLに変換したもの（エスケープ済み） */
      html: string;
      stats: ResultStats;
    }
  | { phase: "error"; message: string };

export type ResultStats = {
  messageCount: number;
  authorCount: number;
  truncated: boolean;
  truncateReason?: string;
  chunkCount: number;
  model: string;
  /** この1回で消費した Neurons（無料枠は 10,000/日） */
  neurons?: number;
  inputTokens?: number;
  outputTokens?: number;
};

/** DO に保存し、再接続時にそのまま返すスナップショット */
export type JobSnapshot = {
  status: JobStatus;
  params?: DigestParams;
  progress: string[];
  markdown?: string;
  /** markdown をサーバー側でHTMLに変換したもの（エスケープ済み） */
  html?: string;
  stats?: ResultStats;
  error?: string;
};
