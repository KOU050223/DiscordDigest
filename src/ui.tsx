import { TIPS } from "./data";

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

/** 待ち時間に出す小話モーダル。左右スワイプ / ボタンで移動する */
const TipsDialog = () => (
  <dialog id="tips-dialog">
    <article>
      <header class="tips-header">
        <strong>解析中の小話</strong>
        <button
          type="button"
          id="tips-close"
          class="secondary outline"
          aria-label="小話を閉じる"
        >
          閉じる
        </button>
      </header>

      <div id="tips-track">
        {TIPS.map((tip) => (
          <section class="tip">
            <div class="tip-emoji" aria-hidden="true">
              {tip.emoji}
            </div>
            <h3>{tip.title}</h3>
            <p>{tip.body}</p>
          </section>
        ))}
      </div>

      <footer class="tips-nav">
        <button
          type="button"
          id="tips-prev"
          class="secondary outline"
          aria-label="前の小話"
        >
          ‹
        </button>
        <div id="tips-dots" role="tablist" aria-label="小話の位置"></div>
        <small id="tips-count" aria-live="polite"></small>
        <button
          type="button"
          id="tips-next"
          class="secondary outline"
          aria-label="次の小話"
        >
          ›
        </button>
      </footer>

      <p class="tips-note">
        <small>処理はこのウィンドウを閉じても続きます。</small>
      </p>
    </article>
  </dialog>
);

const ProgressSection = () => (
  <section id="progress-section" hidden>
    <article>
      <header class="progress-header">
        進捗
        <button type="button" id="tips-open" class="secondary outline" hidden>
          小話を見る
        </button>
      </header>
      <pre id="progress-log"></pre>
    </article>
  </section>
);

const ResultSection = () => (
  <section id="result-section" hidden>
    <article>
      <header class="result-header">
        <strong>要約</strong>
        <div class="result-actions">
          <button type="button" id="share-btn">
            共有する
          </button>
          <button type="button" id="copy-btn" class="secondary outline">
            コピー
          </button>
        </div>
      </header>
      <div id="result-body"></div>
      <footer id="result-meta"></footer>
    </article>
  </section>
);

const DESCRIPTION =
  "Discord のチャンネル / スレッドを、期間を指定して日本語で要約します。";

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
    <meta property="og:site_name" content="Disgest" />
    <meta property="og:locale" content="ja_JP" />
    <meta property="og:title" content={props.title} />
    <meta property="og:description" content={DESCRIPTION} />
    <meta property="og:url" content={`${props.origin}/`} />
    <meta property="og:image" content={`${props.origin}/og.png`} />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="Disgest" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content={props.title} />
    <meta name="twitter:description" content={DESCRIPTION} />
    <meta name="twitter:image" content={`${props.origin}/og.png`} />

    {/* どちらも public/ 配下。CDN を挟まないので実行時の外部依存が無い */}
    <link rel="stylesheet" href="/pico.min.css" />
    <link rel="stylesheet" href="/app.css" />
  </head>
);

/** 未ログイン時に出す画面 */
export const LoginPage = (props: { origin: string; error?: string }) => (
  <html lang="ja">
    <Head title="Disgest - ログイン" origin={props.origin} />
    <body>
      <main class="container">
        <hgroup>
          <h1>Disgest</h1>
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
          {/*
            Pico は role="button" でリンクをボタンの見た目にする。
            押すと /auth/login へ遷移するので <button> ではなく <a> のままにする
          */}
          {/* biome-ignore lint/a11y/useSemanticElements: 遷移するリンクなので <a> が正しい */}
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
    <Head title="Disgest" origin={props.origin} />
    <body>
      <main class="container">
        <div class="topbar">
          <hgroup>
            <h1>
              <a href="/" class="home-link">
                Disgest
              </a>
            </h1>
            <p>{DESCRIPTION}</p>
          </hgroup>
          <small>
            {props.userName} ／ <a href="/auth/logout">ログアウト</a>
          </small>
        </div>

        {/*
          既に要約済みの URL（#job=…）を開いたときは、クライアント側が
          open を外して畳む。details なので開閉自体に JS は要らない
        */}
        <details id="input-panel" open>
          <summary id="input-summary">条件を入力して要約する</summary>
          <Form />
          <ProgressSection />
        </details>

        <ResultSection />
        <TipsDialog />

        <footer>
          <small>
            処理は Durable Object 内で実行されます。タブを閉じても続行し、同じ URL
            （#job=…）を開き直せば結果を受け取れます。
          </small>
        </footer>
      </main>
      {/* src/client/ を esbuild でバンドルしたもの（npm run build:client） */}
      <script src="/app.js" defer></script>
    </body>
  </html>
);
