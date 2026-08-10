import { Hono } from "hono";
import {
  clearSessionCookie,
  getSessionToken,
  handleCallback,
  startLogin,
  verifySession,
  type Session,
} from "./auth";
import { parseChannelRef, parseDateRange } from "./channel-url";
import { toUserMessage, UserFacingError } from "./errors";
import type { Env } from "./types";
import { LoginPage, Page } from "./ui";

export { DigestJob } from "./digest-job";

type Vars = { session: Session };

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// --- 認証 ---

/**
 * 認証ゲート。/auth/* 以外はすべてログインを要求する。
 *
 * ルートごとに書くと WebSocket のような追加時に守り忘れるので、
 * 全体に掛けてから例外を開ける方針にする。
 */
app.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/auth/")) return next();

  const token = getSessionToken(c.req.raw);
  const session = token ? await verifySession(c.env, token) : null;

  if (!session) {
    // WebSocket と API はリダイレクトしても意味がないので 401 を返す
    if (path.startsWith("/api/")) return c.json({ error: "ログインが必要です" }, 401);
    return c.html(<LoginPage />, 401);
  }

  c.set("session", session);
  return next();
});

app.get("/auth/login", (c) => startLogin(c.req.raw, c.env));

app.get("/auth/callback", async (c) => {
  const result = await handleCallback(c.req.raw, c.env);
  if (!result.ok) return c.html(<LoginPage error={result.message} />, 403);

  result.headers.set("Location", "/");
  return new Response(null, { status: 302, headers: result.headers });
});

app.get("/auth/logout", (c) => {
  return new Response(null, {
    status: 302,
    headers: { Location: "/auth/login", "Set-Cookie": clearSessionCookie() },
  });
});

// --- アプリ本体 ---

app.get("/", (c) => c.html(<Page userName={c.get("session").userName} />));

app.get("/api/health", (c) => c.json({ ok: true }));

/** ジョブを作って開始する。処理の完了は待たず、すぐ jobId を返す */
app.post("/api/digest", async (c) => {
  try {
    const body = await c.req.json<{
      channel?: string;
      from?: string;
      to?: string;
      prompt?: string;
    }>();

    const channelId = parseChannelRef(body.channel ?? "");
    const { fromMs, toMs } = parseDateRange(body.from ?? "", body.to ?? "");

    const jobId = crypto.randomUUID();
    const stub = c.env.DIGEST_JOB.getByName(jobId);
    await stub.start({ channelId, fromMs, toMs, customPrompt: body.prompt ?? "" });

    return c.json({ jobId });
  } catch (err) {
    const status = err instanceof UserFacingError ? 400 : 500;
    return c.json({ error: toUserMessage(err) }, status);
  }
});

/** 進捗と結果を受け取る WebSocket。DO へそのまま委譲する */
app.get("/api/digest/:id/ws", (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("Expected WebSocket", 400);
  }
  const stub = c.env.DIGEST_JOB.getByName(c.req.param("id"));
  return stub.fetch(c.req.raw);
});

export default app;
