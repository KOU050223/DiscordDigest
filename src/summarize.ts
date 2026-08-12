import { AiError } from "./errors";
import {
  buildMapUserContent,
  buildReduceUserContent,
  buildSingleUserContent,
  formatTranscript,
  MAP_SYSTEM_PROMPT,
  REDUCE_SYSTEM_PROMPT,
  SINGLE_SYSTEM_PROMPT,
} from "./prompts";
import type { Env, NormalizedMessage } from "./types";

export const PRIMARY_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const FALLBACK_MODEL = "@cf/zai-org/glm-4.7-flash";

/**
 * 単発要約に切り替える閾値。
 * モデルのコンテキストは 256K あるが、上端付近では再現率が落ちるため
 * 窓の限界まで詰めずに余裕をもって分割する。
 */
const SINGLE_PASS_THRESHOLD = 60_000;

/** 1チャンクの目標トークン数 */
const CHUNK_TARGET_TOKENS = 40_000;

/** 会話の切れ目とみなす無発言時間 */
const CONVERSATION_GAP_MS = 30 * 60 * 1000;

/** チャンク間で重複させるメッセージ数（返信の連鎖を断ち切らないため） */
const CHUNK_OVERLAP = 2;

/** map の並列度。全並列にすると Workers AI のレート制限を踏む */
const MAP_CONCURRENCY = 3;

/**
 * 出力トークンの予算。
 *
 * gemma-4 は思考モデルで、本文を出す前に reasoning_content へ推論を書く。
 * 実測では15文字の返答に約1,000トークンの推論を使ったため、
 * 「本文の想定量」ではなく「推論 + 本文」を賄える値を渡す必要がある。
 * 足りないと finish_reason: "length" で本文が空のまま返る。
 */
const MAX_TOKENS_MAP = 6144;
const MAX_TOKENS_REDUCE = 8192;
const MAX_TOKENS_SINGLE = 8192;

/**
 * トークン数を見積もる。
 *
 * 「文字数 / 4」は英語基準のヒューリスティックで、CJK では大幅に過小評価する。
 * 日本語は 1 文字 ≒ 1 トークンとして保守的に数える。
 */
export function estimateTokens(s: string): number {
  const cjk = (s.match(/[　-ヿ㐀-䶿一-鿿＀-￯]/g) ?? []).length;
  const rest = s.length - cjk;
  return Math.ceil(cjk + rest / 4);
}

/**
 * メッセージ列をチャンクに分割する。
 *
 * メッセージの途中では切らず、可能なら会話の切れ目（30分以上の間隔）を
 * 境界に選ぶ。各チャンクの先頭には直前の数件を重複させる。
 */
export function chunkMessages(
  messages: NormalizedMessage[],
  targetTokens = CHUNK_TARGET_TOKENS,
): NormalizedMessage[][] {
  if (messages.length === 0) return [];

  const chunks: NormalizedMessage[][] = [];
  let current: NormalizedMessage[] = [];
  let currentTokens = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const tokens = estimateTokens(msg.content) + 20; // 話者名・時刻の分を加算

    const prev = messages[i - 1];
    const isGap =
      prev !== undefined &&
      new Date(msg.timestamp).getTime() - new Date(prev.timestamp).getTime() >=
        CONVERSATION_GAP_MS;

    // 目標を超えている、かつ会話の切れ目なら、ここで区切るのが最も自然
    const shouldSplit =
      current.length > 0 &&
      (currentTokens + tokens > targetTokens ||
        (isGap && currentTokens > targetTokens * 0.6));

    if (shouldSplit) {
      chunks.push(current);
      const overlap = current.slice(-CHUNK_OVERLAP);
      current = [...overlap];
      currentTokens = overlap.reduce((sum, m) => sum + estimateTokens(m.content) + 20, 0);
    }

    current.push(msg);
    currentTokens += tokens;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * 1回の要約で消費した Neurons の合計。
 *
 * 無料枠は 10,000 Neurons/日なので、1回いくら使うのかを
 * 実測値で把握できるようにしておく。
 */
export type UsageTotal = { neurons: number; inputTokens: number; outputTokens: number };

function addUsage(total: UsageTotal, res: unknown): void {
  if (!res || typeof res !== "object") return;
  const u = (res as { usage?: Record<string, unknown> }).usage;
  if (!u) return;
  if (typeof u.neurons === "number") total.neurons += u.neurons;
  if (typeof u.prompt_tokens === "number") total.inputTokens += u.prompt_tokens;
  if (typeof u.completion_tokens === "number") total.outputTokens += u.completion_tokens;
}

/** Workers AI を1回呼ぶ。容量不足のときだけ別モデルへ1度フォールバックする */
async function runModel(
  env: Env,
  system: string,
  user: string,
  maxTokens: number,
  usage: UsageTotal,
): Promise<string> {
  const input = {
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: maxTokens,
  };

  try {
    const res = await env.AI.run(PRIMARY_MODEL as never, input as never);
    addUsage(usage, res);
    return extractText(res);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("3036")) {
      throw new AiError(
        "Workers AI の本日の無料枠（10,000 Neurons/日）を使い切りました。日付が変わるまで待つか、Workers Paid プランをご検討ください。",
      );
    }

    // 容量不足のときのみ別モデルで1度だけ再試行する
    if (message.includes("3040") || message.toLowerCase().includes("capacity")) {
      try {
        const res = await env.AI.run(FALLBACK_MODEL as never, input as never);
        addUsage(usage, res);
        return extractText(res);
      } catch (fallbackErr) {
        const detail =
          fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        throw new AiError(
          `AIモデルが混み合っています（フォールバックも失敗: ${detail}）`,
        );
      }
    }

    throw new AiError(`AI呼び出しに失敗しました: ${message}`);
  }
}

/**
 * Workers AI の応答から本文を取り出す。
 *
 * モデルによって形が違う:
 * - OpenAI 互換形式: choices[0].message.content
 * - 旧来の形式: { response: "..." }
 *
 * gemma-4 は思考モデルで、推論を reasoning_content に書いてから
 * content に本回答を出す。max_tokens が推論で尽きると
 * finish_reason: "length" となり content が空のまま返るので、
 * それを「解釈できない」ではなく専用のエラーとして扱う。
 */
function extractText(res: unknown): string {
  if (typeof res === "string") return res;

  if (res && typeof res === "object") {
    const r = res as {
      response?: unknown;
      choices?: { finish_reason?: string; message?: { content?: unknown } }[];
    };

    const choice = r.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content === "string" && content.trim() !== "") return content;

    if (typeof r.response === "string" && r.response.trim() !== "") return r.response;

    if (choice?.finish_reason === "length") {
      throw new AiError(
        "AIの出力が長さ上限に達し、本文が生成されませんでした。期間を短くして再実行してください。",
      );
    }
  }

  throw new AiError("AIの応答を解釈できませんでした");
}

/** 小さな並列度でタスクを実行する */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  onDone: (doneCount: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let done = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) break;
        results[i] = await fn(items[i], i);
        done++;
        onDone(done);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

export type SummarizeResult = {
  markdown: string;
  chunkCount: number;
  usage: UsageTotal;
};

/**
 * メッセージ列を要約する。
 * 規模が小さければ単発、大きければ map-reduce で処理する。
 */
export async function summarize(
  env: Env,
  messages: NormalizedMessage[],
  customPrompt: string,
  onProgress: (done: number, total: number) => void,
): Promise<SummarizeResult> {
  const transcript = formatTranscript(messages);
  const totalTokens = estimateTokens(transcript);
  const usage: UsageTotal = { neurons: 0, inputTokens: 0, outputTokens: 0 };

  if (totalTokens < SINGLE_PASS_THRESHOLD) {
    onProgress(0, 1);
    const markdown = await runModel(
      env,
      SINGLE_SYSTEM_PROMPT,
      buildSingleUserContent(transcript, customPrompt),
      MAX_TOKENS_SINGLE,
      usage,
    );
    onProgress(1, 1);
    return { markdown, chunkCount: 1, usage };
  }

  const chunks = chunkMessages(messages);
  // map の完了数 + reduce の 1 ステップ
  const total = chunks.length + 1;
  onProgress(0, total);

  const notes = await mapWithConcurrency(
    chunks,
    MAP_CONCURRENCY,
    (chunk) =>
      runModel(
        env,
        MAP_SYSTEM_PROMPT,
        buildMapUserContent(formatTranscript(chunk)),
        MAX_TOKENS_MAP,
        usage,
      ),
    (done) => onProgress(done, total),
  );

  const markdown = await runModel(
    env,
    REDUCE_SYSTEM_PROMPT,
    buildReduceUserContent(notes, customPrompt),
    MAX_TOKENS_REDUCE,
    usage,
  );
  onProgress(total, total);

  return { markdown, chunkCount: chunks.length, usage };
}
