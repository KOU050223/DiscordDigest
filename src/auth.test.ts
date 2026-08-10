import { describe, expect, it } from "vitest";
import { verifySession } from "./auth";
import type { Env } from "./types";

const env = { SESSION_SECRET: "test-secret-value-32-bytes-long!!" } as Env;
const otherEnv = { SESSION_SECRET: "a-completely-different-secret-key" } as Env;

/** テスト用にセッション文字列を組み立てる（auth.ts の署名処理と同じ手順） */
async function makeToken(
  secret: string,
  payloadObj: Record<string, unknown>,
): Promise<string> {
  const json = JSON.stringify(payloadObj);
  const payload = btoa(String.fromCharCode(...new TextEncoder().encode(json)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${payload}.${b64}`;
}

const future = () => Math.floor(Date.now() / 1000) + 3600;
const past = () => Math.floor(Date.now() / 1000) - 3600;

describe("verifySession", () => {
  it("正しく署名されたセッションを受け入れる", async () => {
    const token = await makeToken(env.SESSION_SECRET, {
      userId: "123",
      userName: "田中",
      expiresAt: future(),
    });
    const s = await verifySession(env, token);
    expect(s).toEqual({ userId: "123", userName: "田中" });
  });

  it("別の鍵で署名されたセッションを拒否する", async () => {
    const token = await makeToken(otherEnv.SESSION_SECRET, {
      userId: "123",
      userName: "攻撃者",
      expiresAt: future(),
    });
    expect(await verifySession(env, token)).toBeNull();
  });

  it("payload を改ざんしたセッションを拒否する", async () => {
    const token = await makeToken(env.SESSION_SECRET, {
      userId: "123",
      userName: "田中",
      expiresAt: future(),
    });
    const [, sig] = token.split(".");
    const forged = await makeToken(env.SESSION_SECRET, {
      userId: "999",
      userName: "別人",
      expiresAt: future(),
    });
    // 中身だけ差し替えて署名は元のまま
    const tampered = `${forged.split(".")[0]}.${sig}`;
    expect(await verifySession(env, tampered)).toBeNull();
  });

  it("期限切れのセッションを拒否する", async () => {
    const token = await makeToken(env.SESSION_SECRET, {
      userId: "123",
      userName: "田中",
      expiresAt: past(),
    });
    expect(await verifySession(env, token)).toBeNull();
  });

  it("署名の無い文字列を拒否する", async () => {
    expect(await verifySession(env, "just-a-string")).toBeNull();
    expect(await verifySession(env, "")).toBeNull();
  });

  it("期限が無いセッションを拒否する", async () => {
    const token = await makeToken(env.SESSION_SECRET, {
      userId: "123",
      userName: "田中",
    });
    expect(await verifySession(env, token)).toBeNull();
  });

  it("payload が壊れていても例外を投げない", async () => {
    expect(await verifySession(env, "!!!notbase64!!!.sig")).toBeNull();
  });
});
