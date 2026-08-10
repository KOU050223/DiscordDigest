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
  #result-body { white-space: pre-wrap; word-break: break-word; font-size: .9rem; }
  #result-meta { font-size: .8rem; color: var(--pico-muted-color); }
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

export const Page = () => (
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>DiscordDigest</title>
      <link
        rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css"
      />
      {html`<style>
        ${raw(EXTRA_CSS)}
      </style>`}
    </head>
    <body>
      <main class="container">
        <hgroup>
          <h1>DiscordDigest</h1>
          <p>Discord のチャンネル / スレッドを、期間を指定して日本語で要約します。</p>
        </hgroup>

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
