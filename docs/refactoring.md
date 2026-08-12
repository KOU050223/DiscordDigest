# リファクタリングの記録と残りの選択肢

## 済んだこと

### クライアントスクリプトを型付きモジュールへ（`src/client/`）

`client-script.ts` は `String.raw` テンプレートリテラルの中に素の JS を
文字列として持っていた。そのため:

- 型検査・lint・テストのいずれも効かない
- **テンプレートリテラルが構文的に使えない**（`${` が壊れる）ので、
  動的なマークアップを組み立てられない。小話の文面を `data.ts` へ
  追い出していたのはこの制約が理由
- `getElementById` が19箇所に散り、`ui.tsx` の `id`・`EXTRA_CSS` の
  セレクタ・JS の3箇所を手で同期する必要があった（どれもノーチェック）

`src/client/` の実モジュールに分割し、esbuild で `public/app.js` へ
バンドルして `<script src>` で読む形にした。DOM 参照は `client/dom.ts` に
集約し、`id` が無ければ起動時に必ず落ちる。

### ワイヤープロトコルの型を共有（`src/protocol.ts`）

`ProgressEvent` に `snapshot` と `pong` のバリアントが無いまま、
`digest-job.ts` が実際にはその2つを送っていた。送信側も受信側も
型検査されていなかった。`protocol.ts` に切り出して両者で共有し、
DO からの送信は `send()` に集約、クライアントは判別共用体の
`switch` で受ける。ここに無い `phase` はコンパイルエラーになる。

### CSS を切り出し、Pico を同梱

`ui.tsx` の `EXTRA_CSS`（80行の文字列）を `public/app.css` へ。
Pico も jsdelivr から `public/pico.min.css` の同梱に変えて、
実行時の外部依存を無くした。

### Biome

lint の指摘は2件だけだった（コードの質は元から高い）。

## 残っている選択肢

順序は「効果 ÷ コスト」が高い順。各項目は独立して着手できる。

### 1. tsconfig の厳格化（依存追加なし）

`noUncheckedIndexedAccess` と `exactOptionalPropertyTypes` を足す。
効きどころ:

- `markdown.ts` の `heading[1].length`（正規表現マッチの添字アクセス）
- `digest-job.ts` の `rows[0].value as string`
- `types.ts` の `truncateReason?: string` 系

### 2. `auth.ts` を Hono 組み込みへ（依存追加なし）

`hono/jwt`・`hono/cookie`・`hono/csrf` は Hono に同梱されている（4.13.1 で確認）。
これで `hmac` / `base64UrlEncode` / `base64UrlDecode` / `timingSafeEqual` /
`readCookie` / `cookieAttrs` が消え、259行の半分近くが減る。

**注意**: `hono/jwt` の `verify` は `exp` 切れで例外を投げる。
現行の `verifySession` は `null` を返す設計なので、呼び出し側の分岐を書き換える。

### 3. DO の状態レイヤに型を通す（依存追加なし）

`digest-job.ts` の `get`/`put` は文字列 + `JSON.parse` + キャストだらけ
（`this.get("status") as JobSnapshot["status"]` など）。
キーと型を対応させたレコードから型付きアクセサを作れば全部消える。

```ts
type JobState = {
  status: JobStatus;
  params: DigestParams;
  progress: string[];
  startedAt: number;
  markdown: string; html: string; stats: ResultStats; error: string;
};
// get<K extends keyof JobState>(key: K): JobState[K] | undefined
```

### 4. 入力のランタイム検証

`index.tsx` の `c.req.json<{...}>()` はキャストであって検証ではない。
実質のバリデータは `parseChannelRef` / `parseDateRange` が担っているが型の裏付けが無い。

| 選択肢 | パッケージ | peer |
|---|---|---|
| valibot | `@hono/valibot-validator@0.6.1` | `hono>=3.9.0`, `valibot ^1.0.0` |
| zod | `@hono/zod-validator@0.9.0` | `hono>=4.11.2`, `zod ^3.25 \|\| ^4` |

入力は3フィールドしかないので**やらない判断も合理的**。

### 5. DO と Worker のテスト

`digest-job.ts` / `discord.ts` / `index.tsx` はカバレッジゼロ。
`@cloudflare/vitest-pool-workers@0.21.2` で実 workerd 上でテストできるが、
peer が **`vitest ^4.1.0`**。現行 `^2.1.8` からメジャー2段上げが前提で、
既存テストの書き換えが要る可能性がある。コストが一番読みにくい。

## やらない方がいいと判断したもの

### `markdown.ts`（175行）は残す

marked / markdown-it に置き換えると、このファイルが明言している不変条件
（「**必ず先にHTMLエスケープしてから**装飾を適用する」）を
サニタイズライブラリで置き換える話になる。`normalizeLineBreaks` は
実際に観測したモデル出力の癖をエンコードしており、197行のテストが
それを固定している。動くコードをセキュリティ面の面積と交換するだけ。

### `errors.ts`（60行）は残す

60行、不変条件ひとつ、明快。これに勝るライブラリは無い。

### `hono/jsx/dom` によるクライアント JSX 化は保留

同梱されており依存追加なしで使える（`./jsx/dom`, `./jsx/dom/client`,
`./jsx/dom/css` を確認済み）。ただし実装を読むと
**`hydrateRoot` は `createRoot().render()` の別名**で、
サーバーが描いた DOM に後付けするハイドレーションではない。つまり:

- インタラクティブな部分はサーバーレンダリングされなくなる。
  `TipsDialog` を移すと小話は JS が来るまで存在しない
- `app.css` の小話関連44行のうち7行が `#tips-*` の id セレクタ。
  id を保てば取り除いたはずの三重結合が残り、
  クラスに移すなら同じコミットで CSS を書き直す必要がある
- `tips.ts` が持つ可変状態は**2つだけ**（派生カウントとタイマーハンドル）。
  hooks が解く問題がこのコードには無い
- `TIPS` がクライアントバンドルに入る（gzip 3.5kb → 約6.9kb）。
  絶対値は小さいが、サーバーが無料で描けるものを送ることになる

`Form` は特に不向き。主要 UI が `defer` 後に現れることになり、
`<details id="input-panel">` は今 JS 無しで開閉している。
