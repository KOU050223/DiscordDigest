/**
 * ユーザーにそのまま見せてよい日本語メッセージを持つエラー。
 * これ以外の例外は「予期しないエラー」として扱う。
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

/** 入力フォームの内容が不正 */
export class BadInputError extends UserFacingError {
  constructor(message: string) {
    super(message);
    this.name = "BadInputError";
  }
}

/** Discord API 由来のエラー */
export class DiscordError extends UserFacingError {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DiscordError";
    this.status = status;
  }
}

/**
 * Message Content Intent が無効なときに投げる。
 * Discord はエラーを返さず content を空文字にするだけなので、
 * 明示的に検知しないと「中身のない要約」が出てしまう。
 */
export class MessageContentIntentError extends UserFacingError {
  constructor() {
    super(
      "メッセージ本文を取得できませんでした。Discord Developer Portal で " +
        "対象アプリの Bot → Privileged Gateway Intents → MESSAGE CONTENT INTENT " +
        "を有効にしてください。",
    );
    this.name = "MessageContentIntentError";
  }
}

/** Workers AI 由来のエラー */
export class AiError extends UserFacingError {
  constructor(message: string) {
    super(message);
    this.name = "AiError";
  }
}

/** 例外を、ユーザーに見せる日本語メッセージへ変換する */
export function toUserMessage(err: unknown): string {
  if (err instanceof UserFacingError) return err.message;
  const detail = err instanceof Error ? err.message : String(err);
  return `予期しないエラーが発生しました: ${detail}`;
}
