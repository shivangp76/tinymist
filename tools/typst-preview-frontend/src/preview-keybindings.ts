import { PreviewMode } from "typst-dom/typst-doc.mjs";

export type PreviewKeyAction =
  | "prev"
  | "next"
  | "scrollDown"
  | "scrollUp"
  | "scrollPageUp"
  | "scrollPageDown"
  | "toggleHelp"
  | "toggleOutline"
  | "escape"
  | "toggleTheme"
  | "unlinkScroll"
  | "linkScroll"
  | "fitToWidth"
  | "gotoFirstPage"
  | "gotoLastPage"
  | "gotoPage";

export interface PreviewKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export interface PreviewKeyResult {
  action: PreviewKeyAction | null;
  preventDefault: boolean;
  /// The page number for `gotoPage`.
  page?: number;
}

const NONE: PreviewKeyResult = { action: null, preventDefault: false };

export function resolvePreviewKey(e: PreviewKeyEvent, previewMode: PreviewMode): PreviewKeyResult {
  if (e.ctrlKey || e.metaKey || e.altKey) {
    return NONE;
  }

  const inSlide = previewMode === PreviewMode.Slide;

  switch (e.key) {
    case "ArrowLeft":
    case "ArrowUp":
      return { action: inSlide ? "prev" : null, preventDefault: true };
    case " ":
    case "ArrowRight":
    case "ArrowDown":
      return { action: inSlide ? "next" : null, preventDefault: true };
    case "j":
      return { action: "scrollDown", preventDefault: true };
    case "k":
      return { action: "scrollUp", preventDefault: true };
    case "h":
      return { action: "scrollPageUp", preventDefault: true };
    case "l":
      return { action: "scrollPageDown", preventDefault: true };
    case "?":
      return { action: "toggleHelp", preventDefault: true };
    case "o":
      return { action: "toggleOutline", preventDefault: true };
    case "Escape":
      return { action: "escape", preventDefault: false };
    case "t":
      return { action: "toggleTheme", preventDefault: true };
    case "u":
      return { action: "unlinkScroll", preventDefault: true };
    case "U":
      return { action: "linkScroll", preventDefault: true };
    case "=":
      return { action: "fitToWidth", preventDefault: true };
    default:
      return NONE;
  }
}

/// Resolves keys that only make sense as part of a vim-like sequence: a count
/// prefix (`12G`, `12gg`) and the two-key `gg`. Every other key is passed to
/// `resolvePreviewKey`.
export class PreviewKeySequence {
  private count = "";
  private pendingG = false;

  constructor(private previewMode: PreviewMode) {}

  /// The keys typed so far in an unfinished sequence, for display.
  get pending(): string {
    return this.count + (this.pendingG ? "g" : "");
  }

  reset() {
    this.count = "";
    this.pendingG = false;
  }

  resolve(e: PreviewKeyEvent): PreviewKeyResult {
    if (e.ctrlKey || e.metaKey || e.altKey) {
      this.reset();
      return NONE;
    }

    const isDigit = e.key.length === 1 && e.key >= "0" && e.key <= "9";
    // A leading `0` is not a count, matching vim.
    if (isDigit && !this.pendingG && (e.key !== "0" || this.count !== "")) {
      this.count += e.key;
      return { action: null, preventDefault: true };
    }

    if (e.key === "g" && !this.pendingG) {
      this.pendingG = true;
      return { action: null, preventDefault: true };
    }

    if (e.key === "G" || (e.key === "g" && this.pendingG)) {
      const count = this.count;
      const fallback = e.key === "G" ? "gotoLastPage" : "gotoFirstPage";
      this.reset();
      if (count !== "") {
        return { action: "gotoPage", preventDefault: true, page: Number.parseInt(count) };
      }
      return { action: fallback, preventDefault: true };
    }

    this.reset();
    return resolvePreviewKey(e, this.previewMode);
  }
}
