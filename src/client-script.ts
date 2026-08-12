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

  function connect(jobId) {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(proto + "//" + location.host + "/api/digest/" + jobId + "/ws");

    // 1回の要約呼び出しは数十秒無通信になりうる。
    // 経路のアイドルタイムアウトで切られないよう定期的に ping を送る。
    var keepalive = setInterval(function () {
      if (socket && socket.readyState === WebSocket.OPEN) socket.send("ping");
    }, 20000);

    socket.onmessage = function (event) {
      var ev = JSON.parse(event.data);

      if (ev.phase === "snapshot") {
        if (ev.progress && ev.progress.length) setLog(ev.progress);
        if (ev.status === "done" && ev.markdown) showResult(ev.markdown, ev.stats, ev.html);
        else if (ev.status === "error") showError(ev.error || "不明なエラー");
        else if (ev.status === "running") setBusy(true);
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
      if (ev.phase === "result") showResult(ev.markdown, ev.stats, ev.html);
      if (ev.phase === "error") showError(ev.message);
    };

    socket.onclose = function () {
      clearInterval(keepalive);
      // ジョブは Durable Object 側で続いている。再読み込みすれば追いつける
    };
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    setBusy(true);
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
      copyBtn.textContent = "コピーしました";
      setTimeout(function () {
        copyBtn.textContent = "コピー";
      }, 1500);
    });
  });

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
