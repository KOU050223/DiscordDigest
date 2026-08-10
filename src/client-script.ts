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

  function setBusy(busy) {
    submitBtn.disabled = busy;
    submitBtn.setAttribute("aria-busy", busy ? "true" : "false");
    submitBtn.textContent = busy ? "処理中…" : "要約する";
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
