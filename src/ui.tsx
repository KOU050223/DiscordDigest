import { html, raw } from "hono/html";
import { CLIENT_SCRIPT } from "./client-script";

const EXTRA_CSS = `
  :root { --pico-form-element-spacing-vertical: 0.6rem; }
  body { padding-block: 2rem; }
  .quick-range { display: flex; gap: .5rem; margin-block: .25rem 1rem; }
  .quick-range button { width: auto; padding: .25rem .75rem; font-size: .8rem; margin: 0; }
  #progress-log {
    font-family: var(--pico-font-family-monospace);
    font-size: .8rem; white-space: pre-wrap; word-break: break-all;
    max-height: 14rem; overflow-y: auto; margin: 0;
  }
  #result-body { word-break: break-word; font-size: .95rem; }
  #result-body h2 { font-size: 1.15rem; margin-block: 1.4rem .5rem; }
  #result-body h2:first-child { margin-block-start: 0; }
  #result-body h3 { font-size: 1rem; margin-block: 1rem .4rem; }
  #result-body ul, #result-body ol { margin-block: .4rem .8rem; padding-inline-start: 1.4rem; }
  #result-body li { margin-block: .2rem; }
  #result-body p { margin-block: .5rem; }
  #result-body pre { padding: .6rem; font-size: .8rem; overflow-x: auto; }
  #result-body blockquote { margin-block: .5rem; }
  #result-meta { font-size: .8rem; color: var(--pico-muted-color); }
  .topbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; }
  .topbar hgroup { margin-block-end: .5rem; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  @media (max-width: 480px) { .row { grid-template-columns: 1fr; } }

`;

const Form = () => (
  <form id="digest-form">
    <label>
      チャンネル / スレッドの URL または ID
      <input
        type="text"
        name="channel"
        required
        placeholder="https://discord.com/channels/123.../456..."
      />
      <small>スレッドも同じ形式で指定できます。</small>
    </label>

    <div class="row">
      <label>
        開始日
        <input type="date" name="from" required />
      </label>
      <label>
        終了日
        <input type="date" name="to" required />
      </label>
    </div>

    <div class="quick-range">
      <button type="button" class="secondary outline" data-days="7">
        直近7日
      </button>
      <button type="button" class="secondary outline" data-days="30">
        直近30日
      </button>
    </div>

    <label>
      まとめ方の希望（任意）
      <textarea
        name="prompt"
        rows={3}
        placeholder="例: 決まったことと担当者だけを箇条書きで。技術的な議論は詳しめに。"
      ></textarea>
    </label>

    <button type="submit" id="submit-btn">
      要約する
    </button>
  </form>
);

const ProgressSection = () => (
  <section id="progress-section" hidden>
    <article>
      <header>進捗</header>
      <pre id="progress-log"></pre>
    </article>
  </section>
);

const ResultSection = () => (
  <section id="result-section" hidden>
    <article>
      <header>
        <strong>要約</strong>
        <button
          type="button"
          id="copy-btn"
          class="secondary outline"
          style="width:auto;float:right;padding:.2rem .6rem;font-size:.8rem;margin:0"
        >
          コピー
        </button>
      </header>
      <div id="result-body"></div>
      <footer id="result-meta"></footer>
    </article>
  </section>
);

const DESCRIPTION = "Discord のチャンネル / スレッドを、期間を指定して日本語で要約します。";

/**
 * 共通の <head>。OGP は SNS のクローラー向けなので、
 * クローラーが実際に見るログイン画面にも必ず出す。
 *
 * origin はリクエスト URL から渡す。og:image / og:url は絶対 URL でないと解決されない。
 */
const Head = (props: { title: string; origin: string }) => (
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{props.title}</title>
    <meta name="description" content={DESCRIPTION} />

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="DiscordDigest" />
    <meta property="og:locale" content="ja_JP" />
    <meta property="og:title" content={props.title} />
    <meta property="og:description" content={DESCRIPTION} />
    <meta property="og:url" content={`${props.origin}/`} />
    <meta property="og:image" content={`${props.origin}/og.png`} />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="DiscordDigest" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content={props.title} />
    <meta name="twitter:description" content={DESCRIPTION} />
    <meta name="twitter:image" content={`${props.origin}/og.png`} />

    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css"
    />
    {html`<style>
      ${raw(EXTRA_CSS)}
    </style>`}
  </head>
);

/** 未ログイン時に出す画面 */
export const LoginPage = (props: { origin: string; error?: string }) => (
  <html lang="ja">
    <Head title="DiscordDigest - ログイン" origin={props.origin} />
    <body>
      <main class="container">
        <hgroup>
          <h1>DiscordDigest</h1>
          <p>{DESCRIPTION}</p>
        </hgroup>

        {props.error ? (
          <article style="border-left:4px solid var(--pico-del-color)">
            <strong>ログインできませんでした</strong>
            <p>{props.error}</p>
          </article>
        ) : null}

        <p>利用するには Discord でログインしてください。</p>
        <p>
          <a href="/auth/login" role="button">
            Discord でログイン
          </a>
        </p>
        <p>
          <small>
            対象サーバーのメンバーであることを確認します。
            サーバーの一覧を読む権限のみ要求し、メッセージの読み取りやアカウント操作は行いません。
          </small>
        </p>
      </main>
    </body>
  </html>
);

export const Page = (props: { userName: string; origin: string }) => (
  <html lang="ja">
    <Head title="DiscordDigest" origin={props.origin} />
    <body>
      <main class="container">
        <div class="topbar">
          <hgroup>
            <h1>DiscordDigest</h1>
            <p>{DESCRIPTION}</p>
          </hgroup>
          <small>
            {props.userName} ／ <a href="/auth/logout">ログアウト</a>
          </small>
        </div>

        <Form />
        <ProgressSection />
        <ResultSection />

        <footer>
          <small>
            処理は Durable Object 内で実行されます。タブを閉じても続行し、同じ URL
            （#job=…）を開き直せば結果を受け取れます。
          </small>
        </footer>
      </main>
      {html`<script>
        ${raw(CLIENT_SCRIPT)}
      </script>`}
    </body>
  </html>
);
