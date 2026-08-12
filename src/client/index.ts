import { connect } from "./connection";
import { els } from "./dom";
import { setLog } from "./progress-log";
import { buildShareText } from "./share-text";
import { initTips } from "./tips";
import { getCurrentMarkdown, setBusy, setInputCollapsed, showError } from "./view";

/** 期間の初期値 */
const DEFAULT_RANGE_DAYS = 7;

/** ボタンの文言を戻すまでの時間 */
const FLASH_MS = 1500;

/** ボタンの文言を一時的に差し替えて、操作できたことを伝える */
function flashLabel(btn: HTMLButtonElement, temp: string, original: string): void {
  btn.textContent = temp;
  setTimeout(() => {
    btn.textContent = original;
  }, FLASH_MS);
}

// ローカルタイムゾーンでの YYYY-MM-DD を返す。
// toISOString() は UTC なので、日本時間の夜に使うと前日が選ばれてしまう。
function localDate(d: Date): string {
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

function setRange(days: number): void {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  els.form.querySelector<HTMLInputElement>('[name="from"]')!.value = localDate(from);
  els.form.querySelector<HTMLInputElement>('[name="to"]')!.value = localDate(to);
}

function initForm(): void {
  els.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setBusy(true);
    setInputCollapsed(false); // 畳んだ状態から再実行された場合、進捗を隠さない
    els.progressSection.hidden = false;
    els.resultSection.hidden = true;
    setLog(["ジョブを開始しています…"]);

    const data = new FormData(els.form);
    const payload = {
      channel: data.get("channel"),
      from: data.get("from"),
      to: data.get("to"),
      prompt: data.get("prompt") || "",
    };

    try {
      const res = await fetch("/api/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 401) {
        // セッション切れ。ログインし直せば同じ操作を続けられる
        location.href = "/auth/login";
        return;
      }

      const body = (await res.json()) as { jobId?: string; error?: string };
      if (!res.ok || !body.jobId) {
        showError(body.error || "ジョブを開始できませんでした");
        return;
      }

      location.hash = `job=${body.jobId}`;
      connect(body.jobId);
    } catch (err) {
      showError(String(err));
    }
  });

  // クイック期間指定
  for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-days]")) {
    btn.addEventListener("click", () => {
      setRange(Number.parseInt(btn.dataset.days ?? "", 10));
    });
  }
}

function initResultActions(): void {
  els.copyBtn.addEventListener("click", () => {
    // 表示はHTMLだが、コピーは元のMarkdownを渡す
    navigator.clipboard.writeText(getCurrentMarkdown()).then(() => {
      flashLabel(els.copyBtn, "コピーしました", "コピー");
    });
  });

  els.shareBtn.addEventListener("click", async () => {
    const text = buildShareText(getCurrentMarkdown(), location.href);

    // 共有シートがあれば任せる。無い環境ではクリップボードに落とす
    if (navigator.share) {
      try {
        await navigator.share({ title: "Disgest の要約", text });
        return;
      } catch (err) {
        // ユーザーが閉じただけの場合は何もしない
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(text);
      flashLabel(els.shareBtn, "共有文をコピーしました", "共有する");
    } catch {
      flashLabel(els.shareBtn, "コピーできませんでした", "共有する");
    }
  });
}

// 左上のロゴから最初の状態に戻す。
// #job=… が残ったままだと同じジョブに再接続してしまい、
// 結果の表示も開いた WebSocket もそのままになる。確実に読み直す
function initHomeLink(): void {
  const homeLink = document.querySelector<HTMLAnchorElement>(".home-link");
  if (!homeLink) return;

  homeLink.addEventListener("click", (e) => {
    if (!location.hash) return; // ハッシュが無ければ通常の遷移で足りる
    e.preventDefault();
    history.replaceState(null, "", "/");
    location.reload();
  });
}

initTips();
initForm();
initResultActions();
initHomeLink();

// 既存ジョブへの再接続（タブを閉じても DO 側で処理は続いている）
const jobMatch = location.hash.match(/job=([0-9a-f-]+)/);
if (jobMatch) {
  els.progressSection.hidden = false;
  setLog(["進行中のジョブに再接続しています…"]);
  connect(jobMatch[1]);
} else {
  setRange(DEFAULT_RANGE_DAYS); // 初期値は直近7日
}
