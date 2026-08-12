/**
 * DOM 参照をまとめて解決する。
 *
 * 以前は 19 箇所に getElementById が散っていて、ui.tsx の id を
 * 変えても何も検知できなかった。参照をここ1箇所に集約し、
 * 存在しない id は起動時に必ず落ちるようにする。
 */
function must<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`要素が見つかりません: #${id}`);
  return el as T;
}

/** name 属性で引く入力欄。id を持たないフォーム部品用 */
function mustInput(name: string): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(`[name="${name}"]`);
  if (!el) throw new Error(`入力欄が見つかりません: [name="${name}"]`);
  return el;
}

/** ui.tsx のマークアップと1対1で対応する参照。id の綴りはここだけに書く */
export const els = {
  form: must<HTMLFormElement>("digest-form"),
  fromInput: mustInput("from"),
  toInput: mustInput("to"),
  submitBtn: must<HTMLButtonElement>("submit-btn"),
  inputPanel: must<HTMLDetailsElement>("input-panel"),
  inputSummary: must("input-summary"),

  progressSection: must("progress-section"),
  progressLog: must("progress-log"),

  resultSection: must("result-section"),
  resultBody: must("result-body"),
  resultMeta: must("result-meta"),
  copyBtn: must<HTMLButtonElement>("copy-btn"),
  shareBtn: must<HTMLButtonElement>("share-btn"),

  tipsDialog: must<HTMLDialogElement>("tips-dialog"),
  tipsTrack: must("tips-track"),
  tipsDots: must("tips-dots"),
  tipsCount: must("tips-count"),
  tipsOpenBtn: must<HTMLButtonElement>("tips-open"),
  tipsPrevBtn: must<HTMLButtonElement>("tips-prev"),
  tipsNextBtn: must<HTMLButtonElement>("tips-next"),
  tipsCloseBtn: must<HTMLButtonElement>("tips-close"),
} as const;
