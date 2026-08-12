import type { ProgressEvent } from "../protocol";
import { addLog, replaceLastLog, setLog } from "./progress-log";
import { setBusy, setInputCollapsed, showError, showResult } from "./view";

/**
 * 進捗と結果を受け取る WebSocket。
 *
 * ジョブは Durable Object の中で走るので、この接続が切れても処理は続く。
 * 再接続すると snapshot が届いて追いつける。
 */

/**
 * サーバーからの音沙汰が絶えたと判断するまでの時間。
 *
 * 要約1回の待ちは数十秒だが、チャンクが多いと間隔が開く。
 * ジョブ自体が消えた場合はこれを超えて無言になるので、
 * 「進捗が止まったまま気づけない」状態を避けるために監視する。
 */
const SILENCE_TIMEOUT_MS = 5 * 60 * 1000;

/** 経路のアイドルタイムアウトで切られないよう ping を送る間隔 */
const KEEPALIVE_MS = 20000;

export function connect(jobId: string): void {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";

  // このハンドラ群が触るのは常に「自分が開いたソケット」にする。
  // 続けて実行すると外側の参照は次の接続で上書きされるので、
  // 古いクロージャが新しいソケットを閉じてしまう
  const ws = new WebSocket(`${proto}//${location.host}/api/digest/${jobId}/ws`);

  // ジョブが終わったかどうか。切断時に異常か正常かを見分けるために持つ
  let finished = false;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;

  // 1回の要約呼び出しは数十秒無通信になりうる。
  // 経路のアイドルタイムアウトで切られないよう定期的に ping を送る。
  const keepalive = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.send("ping");
  }, KEEPALIVE_MS);

  function stopWatchdogs(): void {
    clearInterval(keepalive);
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = null;
  }

  /**
   * ジョブが終わったので後始末する。
   *
   * ping を止めるだけでなくソケットも閉じる。開いたままだと接続が残り、
   * DO を起こし続けることになる（結果を受け取った後に用は無い）。
   * finished を先に立てるので onclose は切断エラーを出さない。
   */
  function finish(): void {
    finished = true;
    stopWatchdogs();
    if (ws.readyState === WebSocket.OPEN) ws.close();
  }

  /**
   * 無音の監視。サーバーから何か届くたびに時計を巻き戻す。
   *
   * DO が退避されるとジョブは消えるが、WebSocket は Cloudflare 側が
   * 保持するので切断イベントが来ない。ping にも応答が返るため、
   * クライアントからは「生きているが無言」に見える。だから受信で測る。
   */
  function armSilenceWatchdog(): void {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (finished) return;
      stopWatchdogs();
      showError(
        "サーバーからの応答が5分以上ありません。処理が中断された可能性があります。" +
          "ページを再読み込みすると最新の状態を確認できます。",
      );
    }, SILENCE_TIMEOUT_MS);
  }

  ws.onopen = armSilenceWatchdog;

  ws.onmessage = (event: MessageEvent<string>) => {
    const ev: ProgressEvent = JSON.parse(event.data);

    // 何か届いた＝サーバーは生きている。無音タイマーを巻き戻す
    armSilenceWatchdog();

    switch (ev.phase) {
      case "snapshot": {
        if (ev.progress.length) setLog(ev.progress);
        if (ev.status === "done" && ev.markdown) {
          finish();
          showResult(ev.markdown, ev.stats, ev.html);
          // 解析済みの URL を開き直した場合。入力も進捗も用は無いので畳む
          setInputCollapsed(true);
        } else if (ev.status === "error") {
          finish();
          showError(ev.error || "不明なエラー");
        } else if (ev.status === "running") {
          setBusy(true);
        }
        return;
      }
      case "status":
        if (ev.message) addLog(ev.message);
        return;
      case "fetch": {
        const line = `取得中… ${ev.count}件（${ev.pages}ページ）`;
        // 同種の行は上書きしてログが膨らむのを防ぐが、1件目は直前の
        // ステータス行を消さないよう新しい行として追加する
        if (ev.pages > 1) replaceLastLog(line);
        else addLog(line);
        return;
      }
      case "summarize": {
        const line = `要約中… ${ev.done}/${ev.total}`;
        if (ev.done > 0) replaceLastLog(line);
        else addLog(line);
        return;
      }
      case "result":
        finish();
        showResult(ev.markdown, ev.stats, ev.html);
        return;
      case "error":
        finish();
        showError(ev.message);
        return;
      case "pong":
        // 生存確認のみ。上の armSilenceWatchdog で十分
        return;
    }
  };

  ws.onclose = () => {
    stopWatchdogs();
    // 結果を受け取る前に切れた場合だけ知らせる。
    // 黙って止まると「AI が遅い」のか「落ちた」のか区別できない
    if (!finished) {
      showError(
        "サーバーとの接続が切れました。処理は続いている可能性があります。" +
          "ページを再読み込みすると最新の状態を確認できます。",
      );
    }
  };
}
