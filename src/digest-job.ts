import { DurableObject } from "cloudflare:workers";
import { fetchMessages } from "./discord";
import { toUserMessage } from "./errors";
import { renderMarkdown } from "./markdown";
import { PRIMARY_MODEL, summarize } from "./summarize";
import type {
  DigestParams,
  Env,
  JobSnapshot,
  ProgressEvent,
  ResultStats,
} from "./types";

/** これを超えて進捗が無いジョブは中断されたとみなす */
const STALL_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * 1回の要約ジョブを表す Durable Object。
 *
 * ジョブは DO の中で走るので、ブラウザが切断しても処理は続く。
 * 進捗と結果は SQLite に保存し、再接続時にそのまま返す。
 */
export class DigestJob extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(
      `CREATE TABLE IF NOT EXISTS job_state (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL
       )`,
    );
  }

  /** ジョブを開始する。処理の完了は待たず、呼び出し元へすぐ返る */
  async start(params: DigestParams): Promise<void> {
    const existing = this.get("status");
    if (existing && existing !== "pending") return; // 二重起動を防ぐ

    this.put("status", "running");
    this.put("params", JSON.stringify(params));
    this.put("progress", JSON.stringify([]));
    this.put("startedAt", String(Date.now()));

    // waitUntil でジョブ本体を切り離す。WebSocket が繋がっていなくても走る
    this.ctx.waitUntil(this.run(params));
  }

  /** 現在の状態を返す。再接続したブラウザはこれで追いつく */
  snapshot(): JobSnapshot {
    const statsRaw = this.get("stats");
    const paramsRaw = this.get("params");
    let status = (this.get("status") as JobSnapshot["status"]) ?? "pending";
    let error = this.get("error");

    // waitUntil はジョブの再開までは保証しないので、DO が退避されたり
    // isolate が再起動すると running のまま取り残されることがある。
    // 一定時間を超えたものは失敗として扱い、無言のスピナーを避ける。
    if (status === "running" && this.isStalled()) {
      status = "error";
      error =
        "処理が中断されたようです（一定時間進捗がありません）。" +
        "期間を短くして再実行してください。";
    }

    // html を保存していない頃のジョブも整形して表示できるよう、
    // 無ければ読み出し時に変換する
    const markdown = this.get("markdown");
    const html = this.get("html") ?? (markdown ? renderMarkdown(markdown) : undefined);

    return {
      status,
      params: paramsRaw ? JSON.parse(paramsRaw) : undefined,
      progress: JSON.parse(this.get("progress") ?? "[]"),
      markdown,
      html,
      stats: statsRaw ? JSON.parse(statsRaw) : undefined,
      error,
    };
  }

  private isStalled(): boolean {
    const startedAt = Number(this.get("startedAt"));
    if (!Number.isFinite(startedAt)) return false;
    return Date.now() - startedAt > STALL_TIMEOUT_MS;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 400 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    // accept() ではなく acceptWebSocket() を使うことで DO が休眠できる
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ phase: "snapshot", ...this.snapshot() }));

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // クライアントからの ping にだけ応じる。制御コマンドは受け付けない
    if (message === "ping") ws.send(JSON.stringify({ phase: "pong" }));
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code, reason);
  }

  // --- ジョブ本体 ---

  private async run(params: DigestParams): Promise<void> {
    try {
      this.emit({ phase: "status", status: "running", message: "メッセージを取得しています…" });

      const fetched = await fetchMessages(
        this.env,
        params.channelId,
        params.fromMs,
        params.toMs,
        ({ pages, count }) => this.emit({ phase: "fetch", pages, count }),
      );

      if (fetched.messages.length === 0) {
        this.finishEmpty(fetched.truncated, fetched.truncateReason);
        return;
      }

      this.emit({
        phase: "status",
        status: "running",
        message: `${fetched.messages.length}件を取得しました。要約しています…`,
      });

      const { markdown, chunkCount, usage } = await summarize(
        this.env,
        fetched.messages,
        params.customPrompt,
        (done, total) => this.emit({ phase: "summarize", done, total }),
      );

      const stats: ResultStats = {
        messageCount: fetched.messages.length,
        authorCount: new Set(fetched.messages.map((m) => m.authorId)).size,
        truncated: fetched.truncated,
        truncateReason: fetched.truncateReason,
        chunkCount,
        model: PRIMARY_MODEL,
        neurons: usage.neurons,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      };

      const rendered = renderMarkdown(markdown);
      this.put("markdown", markdown);
      this.put("html", rendered);
      this.put("stats", JSON.stringify(stats));
      this.put("status", "done");
      this.emit({ phase: "result", markdown, html: rendered, stats });
    } catch (err) {
      const message = toUserMessage(err);
      this.put("status", "error");
      this.put("error", message);
      this.emit({ phase: "error", message });
    }
  }

  private finishEmpty(truncated: boolean, truncateReason?: string): void {
    const markdown =
      "対象期間にメッセージがありませんでした。\n\n" +
      "期間を広げるか、別のチャンネルを指定してみてください。" +
      "（Botの発言とシステムメッセージは集計から除外しています）";
    const stats: ResultStats = {
      messageCount: 0,
      authorCount: 0,
      truncated,
      truncateReason,
      chunkCount: 0,
      model: PRIMARY_MODEL,
    };
    const rendered = renderMarkdown(markdown);
    this.put("markdown", markdown);
    this.put("html", rendered);
    this.put("stats", JSON.stringify(stats));
    this.put("status", "done");
    this.emit({ phase: "result", markdown, html: rendered, stats });
  }

  /** 進捗を保存しつつ、接続中の全クライアントへ配信する */
  private emit(ev: ProgressEvent): void {
    if (ev.phase === "status" && ev.message) this.appendProgress(ev.message);
    // 同種の行は上書きしてログが膨らむのを防ぐが、1件目は直前の
    // ステータス行を消さないよう新しい行として追加する
    if (ev.phase === "fetch") {
      this.appendProgress(`取得中… ${ev.count}件（${ev.pages}ページ）`, ev.pages > 1);
    }
    if (ev.phase === "summarize") {
      this.appendProgress(`要約中… ${ev.done}/${ev.total}`, ev.done > 0);
    }
    if (ev.phase === "error") this.appendProgress(`エラー: ${ev.message}`);

    const payload = JSON.stringify(ev);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch {
        // 切断済みのソケットは無視する（ジョブは継続する）
      }
    }
  }

  /**
   * 進捗ログに1行足す。
   * replaceLast を立てると、同種の行を上書きしてログが膨らむのを防ぐ。
   */
  private appendProgress(line: string, replaceLast = false): void {
    const lines: string[] = JSON.parse(this.get("progress") ?? "[]");
    if (replaceLast && lines.length > 0) lines[lines.length - 1] = line;
    else lines.push(line);
    // ログが無制限に伸びないよう上限を設ける
    this.put("progress", JSON.stringify(lines.slice(-100)));
    // 進捗があるうちは生存とみなす（長い処理を誤って中断扱いにしない）
    this.put("startedAt", String(Date.now()));
  }

  // --- SQLite への薄いアクセサ ---

  private get(key: string): string | undefined {
    const rows = this.sql.exec("SELECT value FROM job_state WHERE key = ?", key).toArray();
    return rows.length > 0 ? (rows[0].value as string) : undefined;
  }

  private put(key: string, value: string): void {
    this.sql.exec(
      "INSERT INTO job_state (key, value) VALUES (?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      value,
    );
  }
}
