import type { Env } from "./types";

/**
 * Discord OAuth2 によるログインと、サーバー所属の検証。
 *
 * Cloudflare Access を使わず、アプリ側で「対象サーバーのメンバーか」を
 * 判定する。Access では Discord のサーバー所属までは判定できないため。
 *
 * 所属確認はログイン時に1度だけ行う。リクエストごとに Discord へ
 * 問い合わせるとレート制限に当たるため、以降は自前のセッションを信頼する。
 * その代わりセッションは短めに切る（退部した人が残り続けないように）。
 */

const SESSION_COOKIE = "dd_session";
const STATE_COOKIE = "dd_oauth_state";

/** セッションの有効期間 */
const SESSION_TTL_SEC = 7 * 24 * 60 * 60;

/** OAuth の往復中だけ state を保持する */
const STATE_TTL_SEC = 10 * 60;

export type Session = { userId: string; userName: string };

// --- 署名付きセッション ---

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return base64UrlEncode(new Uint8Array(sig));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * base64url を UTF-8 文字列として復号する。
 * atob はバイト列を返すため、日本語のユーザー名がそのままでは文字化けする。
 */
function base64UrlDecode(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** タイミング攻撃を避けるため、長さと内容を定数時間で比較する */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 鍵として短すぎる値を弾く（設定ミスで総当たり可能になるのを防ぐ） */
const MIN_SECRET_LENGTH = 32;

export function assertSecretStrength(env: Env): void {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET が短すぎます（${env.SESSION_SECRET?.length ?? 0}文字）。` +
        `${MIN_SECRET_LENGTH}文字以上を設定してください。` +
        `openssl rand -hex 32 で生成できます` +
        `（base64 だと '=' 以降が切れることがあります）。`,
    );
  }
}

async function signSession(env: Env, session: Session): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const payload = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ ...session, expiresAt })),
  );
  return `${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
}

export async function verifySession(env: Env, token: string): Promise<Session | null> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  const expected = await hmac(env.SESSION_SECRET, payload);
  if (!timingSafeEqual(sig, expected)) return null;

  try {
    const data = JSON.parse(base64UrlDecode(payload));
    if (typeof data.expiresAt !== "number" || data.expiresAt < Date.now() / 1000) {
      return null;
    }
    return { userId: String(data.userId), userName: String(data.userName) };
  } catch {
    return null;
  }
}

// --- Cookie ---

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("Cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

function cookieAttrs(request: Request, maxAge: number): string {
  // localhost は http なので Secure を付けると保存されない
  const isHttps = new URL(request.url).protocol === "https:";
  return [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    isHttps ? "Secure" : "",
    `Max-Age=${maxAge}`,
  ]
    .filter(Boolean)
    .join("; ");
}

export function getSessionToken(request: Request): string | undefined {
  return readCookie(request, SESSION_COOKIE);
}

// --- OAuth フロー ---

/**
 * redirect_uri はリクエストの origin から組み立てる。
 * ローカルと本番で同じコードが使えるようにするため。
 * ただし Discord 側にも同じ URI を登録しておく必要がある。
 */
function redirectUri(request: Request): string {
  return `${new URL(request.url).origin}/auth/callback`;
}

/** ログイン開始。Discord の認可画面へ飛ばす */
export function startLogin(request: Request, env: Env): Response {
  assertSecretStrength(env);

  const state = crypto.randomUUID();
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri(request));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify guilds");
  url.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      // state は CSRF 対策。往復のあいだだけ持つ
      "Set-Cookie": `${STATE_COOKIE}=${state}; ${cookieAttrs(request, STATE_TTL_SEC)}`,
    },
  });
}

export type CallbackResult =
  | { ok: true; headers: Headers }
  | { ok: false; message: string };

/** 認可コードを受け取り、所属を検証してセッションを発行する */
export async function handleCallback(
  request: Request,
  env: Env,
): Promise<CallbackResult> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const savedState = readCookie(request, STATE_COOKIE);

  if (url.searchParams.get("error")) {
    return { ok: false, message: "Discord のログインがキャンセルされました。" };
  }
  if (!code) return { ok: false, message: "認可コードがありません。" };
  if (!state || !savedState || !timingSafeEqual(state, savedState)) {
    return {
      ok: false,
      message: "ログインの検証に失敗しました。もう一度お試しください。",
    };
  }

  // トークン交換。Basic 認証 + form-urlencoded が必須（JSON は受け付けられない）
  const tokenRes = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env.DISCORD_CLIENT_ID}:${env.DISCORD_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(request),
    }),
  });

  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => "");
    return {
      ok: false,
      message:
        `Discord との認証に失敗しました（${tokenRes.status}）。` +
        (detail.includes("redirect_uri")
          ? "リダイレクトURIが Discord 側の設定と一致していない可能性があります。"
          : ""),
    };
  }

  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const bearer = { Authorization: `Bearer ${access_token}` };

  const [meRes, guildsRes] = await Promise.all([
    fetch("https://discord.com/api/v10/users/@me", { headers: bearer }),
    fetch("https://discord.com/api/v10/users/@me/guilds", { headers: bearer }),
  ]);

  if (!meRes.ok || !guildsRes.ok) {
    return { ok: false, message: "Discord からユーザー情報を取得できませんでした。" };
  }

  const me = (await meRes.json()) as {
    id: string;
    username: string;
    global_name?: string | null;
  };
  const guilds = (await guildsRes.json()) as { id: string }[];

  if (!guilds.some((g) => g.id === env.ALLOWED_GUILD_ID)) {
    return {
      ok: false,
      message: "このツールは対象サーバーのメンバーのみ利用できます。",
    };
  }

  // 所属を確認できたので、以降は自前のセッションで認証する。
  // Discord のトークンは用済みなので保存しない。
  const token = await signSession(env, {
    userId: me.id,
    userName: me.global_name || me.username,
  });

  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; ${cookieAttrs(request, SESSION_TTL_SEC)}`,
  );
  // 使い終わった state は消す
  headers.append("Set-Cookie", `${STATE_COOKIE}=; Path=/; HttpOnly; Max-Age=0`);

  return { ok: true, headers };
}

/** ログアウト用の Cookie 削除ヘッダ */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
