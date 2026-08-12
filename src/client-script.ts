/**
 * ブラウザで動くスクリプト。ui.tsx からインライン <script> として埋め込む。
 * ビルド工程を増やさないため、素の JS を文字列で持つ。
 */
export const CLIENT_SCRIPT = String.raw`
(function () {
  var form = document.getElementById("digest-form");
  var log = document.getElementById("progress-log");
  var section = document.getElementById("progress-section");
  var resultSection = document.getElementById("result-section");
  var resultBody = document.getElementById("result-body");
  var resultMeta = document.getElementById("result-meta");
  var submitBtn = document.getElementById("submit-btn");
  var copyBtn = document.getElementById("copy-btn");
  var shareBtn = document.getElementById("share-btn");
  var socket = null;

  function setLog(lines) {
    log.textContent = lines.join("\n");
    log.scrollTop = log.scrollHeight;
  }

  function addLog(line) {
    var lines = log.textContent ? log.textContent.split("\n") : [];
    lines.push(line);
    setLog(lines);
  }

  function replaceLastLog(line) {
    var lines = log.textContent ? log.textContent.split("\n") : [];
    if (lines.length > 0) lines[lines.length - 1] = line;
    else lines.push(line);
    setLog(lines);
  }

  // --- 待ち時間に出す小話カルーセル ---

  var tipsDialog = document.getElementById("tips-dialog");
  var tipsTrack = document.getElementById("tips-track");
  var tipsDots = document.getElementById("tips-dots");
  var tipsCount = document.getElementById("tips-count");
  var tipsOpenBtn = document.getElementById("tips-open");
  var tipCount = tipsTrack.children.length;
  var tipTimer = null;

  for (var i = 0; i < tipCount; i++) {
    var dot = document.createElement("span");
    dot.setAttribute("role", "tab");
    tipsDots.appendChild(dot);
  }

  function currentTip() {
    var w = tipsTrack.clientWidth;
    return w ? Math.round(tipsTrack.scrollLeft / w) : 0;
  }

  function goToTip(index, smooth) {
    // 端まで来たら反対側へ回る。自動送りが止まって見えないように
    var next = (index + tipCount) % tipCount;
    tipsTrack.scrollTo({
      left: next * tipsTrack.clientWidth,
      behavior: smooth ? "smooth" : "auto",
    });
  }

  function syncDots() {
    var active = currentTip();
    for (var i = 0; i < tipsDots.children.length; i++) {
      tipsDots.children[i].setAttribute("aria-selected", i === active ? "true" : "false");
    }
    tipsCount.textContent = active + 1 + " / " + tipCount;
  }

  tipsTrack.addEventListener("scroll", syncDots, { passive: true });

  function startAutoAdvance() {
    stopAutoAdvance();
    tipTimer = setInterval(function () {
      goToTip(currentTip() + 1, true);
    }, 9000);
  }

  function stopAutoAdvance() {
    if (tipTimer) clearInterval(tipTimer);
    tipTimer = null;
  }

  // 手で送ったら自動送りをリセットする（読んでいる途中で流れると鬱陶しい）
  function moveTip(delta) {
    goToTip(currentTip() + delta, true);
    startAutoAdvance();
  }

  function openTips() {
    if (tipsDialog.open) return;

    // スクロール位置の指定は showModal() の後で行う。
    // 開く前は clientWidth が 0 なので、移動先が必ず 0 に潰れる
    tipsDialog.showModal();
    // Pico は <html class="modal-is-open"> で背面のスクロールを止める
    document.documentElement.classList.add("modal-is-open");

    // 毎回1枚目からだと、使うたびに同じ話を読まされる。
    // ループするのでどこから始めても全部読める
    goToTip(Math.floor(Math.random() * tipCount), false);
    syncDots();
    startAutoAdvance();
  }

  function closeTips() {
    stopAutoAdvance();
    if (tipsDialog.open) tipsDialog.close();
    document.documentElement.classList.remove("modal-is-open");
  }

  document.getElementById("tips-prev").addEventListener("click", function () {
    moveTip(-1);
  });
  document.getElementById("tips-next").addEventListener("click", function () {
    moveTip(1);
  });
  document.getElementById("tips-close").addEventListener("click", closeTips);

  // Esc で閉じられた場合の後始末。closeTips 経由でも発火するが、
  // closeTips は open を見てから close() するので再帰しない
  tipsDialog.addEventListener("close", closeTips);

  tipsDialog.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") moveTip(-1);
    if (e.key === "ArrowRight") moveTip(1);
  });

  tipsOpenBtn.addEventListener("click", openTips);

  /**
   * 処理中フラグ。小話モーダルの開閉もここに集約する。
   *
   * 「処理中」への入口は submit・再接続・スナップショットの3つ、出口は
   * 完了とエラーの2つあるが、すべてこの関数を通る。個別に書くと閉じ忘れる。
   */
  function setBusy(busy) {
    submitBtn.disabled = busy;
    submitBtn.setAttribute("aria-busy", busy ? "true" : "false");
    submitBtn.textContent = busy ? "処理中…" : "要約する";

    tipsOpenBtn.hidden = !busy;
    if (busy) openTips();
    else closeTips();
  }

  var inputPanel = document.getElementById("input-panel");

  /**
   * 入力フォームと進捗を畳む / 開く。
   *
   * 「もう結果が出ている URL」を開いたときだけ畳む。実行中に再読み込み
   * された場合は進捗ログが主役なので開いたままにする。
   */
  function setInputCollapsed(collapsed) {
    if (collapsed) inputPanel.removeAttribute("open");
    else inputPanel.setAttribute("open", "");
    document.getElementById("input-summary").textContent = collapsed
      ? "別の条件で要約する（入力と進捗を表示）"
      : "条件を入力して要約する";
  }

  var currentMarkdown = "";

  function showResult(markdown, stats, htmlBody) {
    resultSection.hidden = false;
    currentMarkdown = markdown || "";
    // HTML はサーバー側でエスケープ済み。無ければ生テキストで表示する
    if (htmlBody) resultBody.innerHTML = htmlBody;
    else resultBody.textContent = markdown;
    if (stats) {
      var parts = [
        stats.messageCount + "件",
        stats.authorCount + "人",
        "チャンク " + stats.chunkCount,
      ];
      if (typeof stats.neurons === "number" && stats.neurons > 0) {
        var n = stats.neurons;
        var pct = (n / 10000) * 100;
        parts.push(
          "消費 " + n.toFixed(1) + " Neurons（無料枠の " + pct.toFixed(2) + "%／" +
            "1日あたり残り約 " + Math.floor(10000 / n) + " 回）",
        );
      }
      parts.push(stats.model);
      resultMeta.textContent = parts.join(" / ");
      if (stats.truncated) {
        resultMeta.textContent +=
          "  ※" + (stats.truncateReason || "上限に達したため一部のみ要約しました");
      }
    }
    setBusy(false);
  }

  function showError(message) {
    addLog("エラー: " + message);
    setBusy(false);
  }

  /**
   * サーバーからの音沙汰が絶えたと判断するまでの時間。
   *
   * 要約1回の待ちは数十秒だが、チャンクが多いと間隔が開く。
   * ジョブ自体が消えた場合はこれを超えて無言になるので、
   * 「進捗が止まったまま気づけない」状態を避けるために監視する。
   */
  var SILENCE_TIMEOUT_MS = 5 * 60 * 1000;

  function connect(jobId) {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";

    // このハンドラ群が触るのは常に「自分が開いたソケット」にする。
    // 続けて実行するとグローバルの socket は次の接続で上書きされるので、
    // 古いクロージャが新しいソケットを閉じてしまう
    var ws = new WebSocket(proto + "//" + location.host + "/api/digest/" + jobId + "/ws");
    socket = ws;

    // ジョブが終わったかどうか。切断時に異常か正常かを見分けるために持つ
    var finished = false;
    var silenceTimer = null;

    function stopWatchdogs() {
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
    function finish() {
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
    function armSilenceWatchdog() {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(function () {
        if (finished) return;
        stopWatchdogs();
        showError(
          "サーバーからの応答が5分以上ありません。処理が中断された可能性があります。" +
            "ページを再読み込みすると最新の状態を確認できます。",
        );
      }, SILENCE_TIMEOUT_MS);
    }

    // 1回の要約呼び出しは数十秒無通信になりうる。
    // 経路のアイドルタイムアウトで切られないよう定期的に ping を送る。
    var keepalive = setInterval(function () {
      if (ws.readyState === WebSocket.OPEN) ws.send("ping");
    }, 20000);

    ws.onopen = armSilenceWatchdog;

    ws.onmessage = function (event) {
      var ev = JSON.parse(event.data);

      // 何か届いた＝サーバーは生きている。無音タイマーを巻き戻す
      armSilenceWatchdog();

      if (ev.phase === "snapshot") {
        if (ev.progress && ev.progress.length) setLog(ev.progress);
        if (ev.status === "done" && ev.markdown) {
          finish();
          showResult(ev.markdown, ev.stats, ev.html);
          // 解析済みの URL を開き直した場合。入力も進捗も用は無いので畳む
          setInputCollapsed(true);
        } else if (ev.status === "error") {
          finish();
          showError(ev.error || "不明なエラー");
        } else if (ev.status === "running") setBusy(true);
        return;
      }
      if (ev.phase === "status" && ev.message) addLog(ev.message);
      if (ev.phase === "fetch") {
        var line = "取得中… " + ev.count + "件（" + ev.pages + "ページ）";
        if (ev.pages > 1) replaceLastLog(line);
        else addLog(line);
      }
      if (ev.phase === "summarize") {
        var sline = "要約中… " + ev.done + "/" + ev.total;
        if (ev.done > 0) replaceLastLog(sline);
        else addLog(sline);
      }
      if (ev.phase === "result") {
        finish();
        showResult(ev.markdown, ev.stats, ev.html);
      }
      if (ev.phase === "error") {
        finish();
        showError(ev.message);
      }
    };

    ws.onclose = function () {
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

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    setBusy(true);
    setInputCollapsed(false); // 畳んだ状態から再実行された場合、進捗を隠さない
    section.hidden = false;
    resultSection.hidden = true;
    setLog(["ジョブを開始しています…"]);

    var data = new FormData(form);
    var payload = {
      channel: data.get("channel"),
      from: data.get("from"),
      to: data.get("to"),
      prompt: data.get("prompt") || "",
    };

    try {
      var res = await fetch("/api/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        // セッション切れ。ログインし直せば同じ操作を続けられる
        location.href = "/auth/login";
        return;
      }
      var body = await res.json();
      if (!res.ok) {
        showError(body.error || "ジョブを開始できませんでした");
        return;
      }
      location.hash = "job=" + body.jobId;
      connect(body.jobId);
    } catch (err) {
      showError(String(err));
    }
  });

  // ローカルタイムゾーンでの YYYY-MM-DD を返す。
  // toISOString() は UTC なので、日本時間の夜に使うと前日が選ばれてしまう。
  function localDate(d) {
    var off = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - off).toISOString().slice(0, 10);
  }

  function setRange(days) {
    var to = new Date();
    var from = new Date(to.getTime() - days * 86400000);
    form.querySelector('[name="from"]').value = localDate(from);
    form.querySelector('[name="to"]').value = localDate(to);
  }

  // クイック期間指定
  document.querySelectorAll("[data-days]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setRange(parseInt(btn.getAttribute("data-days"), 10));
    });
  });

  copyBtn.addEventListener("click", function () {
    // 表示はHTMLだが、コピーは元のMarkdownを渡す
    navigator.clipboard.writeText(currentMarkdown).then(function () {
      flashLabel(copyBtn, "コピーしました", "コピー");
    });
  });

  // --- 共有 ---

  /** ボタンの文言を一時的に差し替えて、操作できたことを伝える */
  function flashLabel(btn, temp, original) {
    btn.textContent = temp;
    setTimeout(function () {
      btn.textContent = original;
    }, 1500);
  }

  /**
   * 行頭の箇条書き記号を落とす。
   * 連結してからでは行頭でなくなるので、必ず1行ずつ通す。
   */
  function stripBullet(line) {
    return line.trim().replace(/^(?:[-*+]|\d+\.)\s+/, "");
  }

  /** SNS に貼る前提で、Markdown の装飾を落として素の文章にする */
  function stripMarkdown(text) {
    return text
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_~\x60]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * 共有文に載せる「概要」を取り出す。
   *
   * ## 概要 はプロンプトの目安でしかなく、まとめ方の希望次第では
   * 出てこない。その場合は本文の最初の段落で代用する。
   */
  function extractOverview(markdown) {
    var lines = markdown.split("\n");
    var picked = [];
    var inOverview = false;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^#{1,6}\s/.test(line)) {
        if (inOverview) break; // 次の見出しまでが概要
        inOverview = /^##\s*概要\s*$/.test(line);
        continue;
      }
      if (inOverview && line.trim()) picked.push(stripBullet(line));
    }

    if (picked.length === 0) {
      // 概要が無いときは、見出し以外で最初に現れるまとまりを使う
      for (var j = 0; j < lines.length; j++) {
        var l = lines[j];
        if (/^#{1,6}\s/.test(l) || !l.trim()) {
          if (picked.length > 0) break;
          continue;
        }
        picked.push(stripBullet(l));
      }
    }

    var text = stripMarkdown(picked.join(" "));

    // 絵文字の途中で切ると文字化けするので、コードポイント単位で数える
    var chars = Array.from(text);
    return chars.length > 300 ? chars.slice(0, 300).join("") + "…" : text;
  }

  /** 例に合わせた共有テキスト。URL は #job= を含む今開いている URL をそのまま使う */
  function buildShareText() {
    var overview = extractOverview(currentMarkdown);
    var lines = [
      "Disgest を使って、Discord の要約やってみました！🪄",
      location.href,
    ];
    if (overview) {
      lines.push("");
      lines.push("【概要】");
      lines.push(overview);
    }
    return lines.join("\n");
  }

  shareBtn.addEventListener("click", async function () {
    var text = buildShareText();

    // 共有シートがあれば任せる。無い環境ではクリップボードに落とす
    if (navigator.share) {
      try {
        await navigator.share({ title: "Disgest の要約", text: text });
        return;
      } catch (err) {
        // ユーザーが閉じただけの場合は何もしない
        if (err && err.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(text);
      flashLabel(shareBtn, "共有文をコピーしました", "共有する");
    } catch (err) {
      flashLabel(shareBtn, "コピーできませんでした", "共有する");
    }
  });

  // 左上のロゴから最初の状態に戻す。
  // #job=… が残ったままだと同じジョブに再接続してしまい、
  // 結果の表示も開いた WebSocket もそのままになる。確実に読み直す
  var homeLink = document.querySelector(".home-link");
  if (homeLink) {
    homeLink.addEventListener("click", function (e) {
      if (!location.hash) return; // ハッシュが無ければ通常の遷移で足りる
      e.preventDefault();
      history.replaceState(null, "", "/");
      location.reload();
    });
  }

  // 既存ジョブへの再接続（タブを閉じても DO 側で処理は続いている）
  var m = location.hash.match(/job=([0-9a-f-]+)/);
  if (m) {
    section.hidden = false;
    setLog(["進行中のジョブに再接続しています…"]);
    connect(m[1]);
  } else {
    setRange(7); // 初期値は直近7日
  }
})();
`;
