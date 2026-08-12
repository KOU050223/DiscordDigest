/**
 * サーバー（Durable Object）とブラウザの間でやり取りする型。
 *
 * 両方から import されるので、ここには Workers 固有の型
 * （Ai や DurableObjectNamespace）も DOM の型も持ち込まないこと。
 * ブラウザ側は tsconfig.client.json で lib に DOM を入れて別に検査する。
 */

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

export type JobStatus = "pending" | "running" | "done" | "error";

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

/**
 * WebSocket でブラウザへ push するイベント。
 *
 * digest-job.ts の send() と client/connection.ts の onmessage が
 * 同じこの型を使う。ここに無い phase を送るとどちらの側もコンパイルエラーになる。
 */
export type ProgressEvent =
  /** 接続直後に現在の状態をまとめて渡す。再接続したブラウザはこれで追いつく */
  | ({ phase: "snapshot" } & JobSnapshot)
  /** クライアントの ping への応答。中身は無く、生存確認のみに使う */
  | { phase: "pong" }
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
