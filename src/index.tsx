import { Hono } from "hono";
import { parseChannelRef, parseDateRange } from "./channel-url";
import { toUserMessage, UserFacingError } from "./errors";
import type { Env } from "./types";
import { Page } from "./ui";

export { DigestJob } from "./digest-job";

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.html(<Page />));

app.get("/api/health", (c) =>
  c.json({ ok: true, hasToken: Boolean(c.env.DISCORD_BOT_TOKEN) }),
);

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
