import { els } from "./dom";

/**
 * 待ち時間に出す小話カルーセル。左右スワイプ / ボタンで移動する。
 *
 * 横スクロール + スナップは CSS に任せ、JS は位置の同期と自動送りだけを持つ。
 */

/** 自動送りの間隔 */
const AUTO_ADVANCE_MS = 9000;

const tipCount = els.tipsTrack.children.length;
let tipTimer: ReturnType<typeof setInterval> | null = null;

for (let i = 0; i < tipCount; i++) {
  const dot = document.createElement("span");
  dot.setAttribute("role", "tab");
  els.tipsDots.appendChild(dot);
}

function currentTip(): number {
  const w = els.tipsTrack.clientWidth;
  return w ? Math.round(els.tipsTrack.scrollLeft / w) : 0;
}

function goToTip(index: number, smooth: boolean): void {
  // 端まで来たら反対側へ回る。自動送りが止まって見えないように
  const next = ((index % tipCount) + tipCount) % tipCount;
  els.tipsTrack.scrollTo({
    left: next * els.tipsTrack.clientWidth,
    behavior: smooth ? "smooth" : "auto",
  });
}

function syncDots(): void {
  const active = currentTip();
  for (let i = 0; i < els.tipsDots.children.length; i++) {
    els.tipsDots.children[i].setAttribute("aria-selected", i === active ? "true" : "false");
  }
  els.tipsCount.textContent = `${active + 1} / ${tipCount}`;
}

function startAutoAdvance(): void {
  stopAutoAdvance();
  tipTimer = setInterval(() => goToTip(currentTip() + 1, true), AUTO_ADVANCE_MS);
}

function stopAutoAdvance(): void {
  if (tipTimer) clearInterval(tipTimer);
  tipTimer = null;
}

// 手で送ったら自動送りをリセットする（読んでいる途中で流れると鬱陶しい）
function moveTip(delta: number): void {
  goToTip(currentTip() + delta, true);
  startAutoAdvance();
}

export function openTips(): void {
  if (els.tipsDialog.open) return;

  // スクロール位置の指定は showModal() の後で行う。
  // 開く前は clientWidth が 0 なので、移動先が必ず 0 に潰れる
  els.tipsDialog.showModal();
  // Pico は <html class="modal-is-open"> で背面のスクロールを止める
  document.documentElement.classList.add("modal-is-open");

  // 毎回1枚目からだと、使うたびに同じ話を読まされる。
  // ループするのでどこから始めても全部読める
  goToTip(Math.floor(Math.random() * tipCount), false);
  syncDots();
  startAutoAdvance();
}

export function closeTips(): void {
  stopAutoAdvance();
  if (els.tipsDialog.open) els.tipsDialog.close();
  document.documentElement.classList.remove("modal-is-open");
}

export function initTips(): void {
  els.tipsTrack.addEventListener("scroll", syncDots, { passive: true });

  els.tipsPrevBtn.addEventListener("click", () => moveTip(-1));
  els.tipsNextBtn.addEventListener("click", () => moveTip(1));
  els.tipsCloseBtn.addEventListener("click", closeTips);
  els.tipsOpenBtn.addEventListener("click", openTips);

  // Esc で閉じられた場合の後始末。closeTips 経由でも発火するが、
  // closeTips は open を見てから close() するので再帰しない
  els.tipsDialog.addEventListener("close", closeTips);

  els.tipsDialog.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") moveTip(-1);
    if (e.key === "ArrowRight") moveTip(1);
  });
}
