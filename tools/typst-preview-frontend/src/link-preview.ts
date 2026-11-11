import type { RenderSession } from "@myriaddreamin/typst.ts/dist/esm/renderer.mjs";

/// A position inside the document that an internal link points to.
export interface LinkTarget {
  /// 1-based page number.
  page: number;
  /// Page-local x coordinate in pt.
  x: number;
  /// Page-local y coordinate in pt.
  y: number;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Size {
  width: number;
  height: number;
}

/// The renderer turns a link to a document position into
/// `onclick="handleTypstLocation(this, page, x, y); return false"`.
const LOCATION_RE =
  /handleTypstLocation\(\s*this\s*,\s*(\d+)\s*,\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)/;

/// Extracts the link target from the `onclick` attribute of a link, or returns
/// `undefined` for anything that is not a link to a document position.
export function parseLinkTarget(onclick: string | null | undefined): LinkTarget | undefined {
  const m = onclick && LOCATION_RE.exec(onclick);
  if (!m) {
    return undefined;
  }
  const page = Number.parseInt(m[1]);
  const x = Number.parseFloat(m[2]);
  const y = Number.parseFloat(m[3]);
  if (!(page >= 1) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return undefined;
  }
  return { page, x, y };
}

/// Finds the internal link under an event target, if any.
export function findInternalLink(
  target: EventTarget | null,
): { anchor: Element; target: LinkTarget } | undefined {
  if (!(target instanceof Element)) {
    return undefined;
  }
  const anchor = target.closest("a");
  if (!anchor) {
    return undefined;
  }
  const linkTarget = parseLinkTarget(anchor.getAttribute("onclick"));
  return linkTarget && { anchor, target: linkTarget };
}

/// Places a popover of `size` next to `anchor` inside `viewport`: below the
/// anchor when it fits, otherwise above, otherwise on the side with more room.
/// The popover is kept `margin` px away from the viewport edges.
export function placePopover(
  anchor: Rect,
  size: Size,
  viewport: Size,
  gap = 6,
  margin = 8,
): { left: number; top: number } {
  const spaceBelow = viewport.height - (anchor.top + anchor.height) - gap - margin;
  const spaceAbove = anchor.top - gap - margin;
  let top: number;
  if (spaceBelow >= size.height || spaceBelow >= spaceAbove) {
    top = anchor.top + anchor.height + gap;
  } else {
    top = anchor.top - gap - size.height;
  }
  top = clamp(top, margin, viewport.height - margin - size.height);

  let left = anchor.left + anchor.width / 2 - size.width / 2;
  left = clamp(left, margin, viewport.width - margin - size.width);
  return { left, top };
}

/// Browsers refuse to allocate canvases that are too large; keep a page render
/// below these limits by lowering its resolution.
const MAX_CANVAS_SIDE = 16384;
const MAX_CANVAS_AREA = 32 * 1024 * 1024;

/// Picks the pixels-per-pt to render a `width` x `height` pt page with, wanting
/// `desired` but staying within the canvas size limits.
export function limitPixelPerPt(desired: number, width: number, height: number): number {
  const bySide = MAX_CANVAS_SIDE / Math.max(width, height, 1);
  const byArea = Math.sqrt(MAX_CANVAS_AREA / Math.max(width * height, 1));
  return Math.max(Math.min(desired, bySide, byArea), 0.01);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(v, hi));
}

/// How long the cursor has to rest on a link before its preview opens.
const HOVER_OPEN_DELAY = 500;
/// How long a hover preview stays after the cursor leaves the link, so that the
/// cursor can move into the popover.
const HOVER_CLOSE_DELAY = 300;
/// Where the target position is placed in the popover, as a fraction of its height.
const TARGET_OFFSET_RATIO = 0.3;
/// Width of the popover border in px, see `link-preview.css`.
const POPOVER_BORDER = 1;

export interface LinkPreviewOptions {
  /// The element containing the rendered document.
  hookedElem: HTMLElement;
  /// The element that scrolls the document.
  scrollElem: HTMLElement;
  /// The render session holding the current document.
  kModule: RenderSession;
  /// Scrolls the preview to a link target.
  jump(target: LinkTarget): void;
}

/// Shows a popover with the destination of an internal link when the link is
/// hovered for a moment or right-clicked, similar to the link previews of PDF
/// viewers. Clicking the popover jumps to the destination.
export class LinkPreview {
  private readonly popover: HTMLDivElement;
  private readonly content: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly marker: HTMLDivElement;
  private readonly message: HTMLDivElement;

  private openTimer?: ReturnType<typeof setTimeout>;
  private closeTimer?: ReturnType<typeof setTimeout>;
  /// The link whose preview is shown or about to be shown.
  private anchor?: Element;
  private target?: LinkTarget;
  /// Whether the popover was opened by a right-click, in which case it stays
  /// until dismissed rather than closing when the cursor moves away.
  private pinned = false;
  /// Incremented on every open and close, to drop stale renders.
  private generation = 0;
  private readonly disposers: (() => void)[] = [];

  constructor(private readonly opts: LinkPreviewOptions) {
    this.popover = document.createElement("div");
    this.popover.id = "typst-link-preview";
    this.popover.classList.add("hidden");
    this.popover.title = "Click to go to the link target";

    this.content = document.createElement("div");
    this.content.classList.add("typst-link-preview-content");
    this.canvas = document.createElement("canvas");
    this.marker = document.createElement("div");
    this.marker.classList.add("typst-link-preview-marker");
    this.message = document.createElement("div");
    this.message.classList.add("typst-link-preview-message");
    this.content.append(this.canvas, this.marker);
    this.popover.append(this.content, this.message);
    document.body.appendChild(this.popover);

    this.listen(document, "mouseover", (e) => this.onMouseOver(e as MouseEvent));
    this.listen(opts.hookedElem, "contextmenu", (e) => this.onContextMenu(e as MouseEvent));
    this.listen(document, "mousedown", (e) => {
      if (this.isOpen() && !this.popover.contains(e.target as Node)) {
        this.close();
      }
    });
    this.listen(window, "keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") {
        this.close();
      }
    });
    this.listen(opts.scrollElem, "scroll", () => this.close());
    this.listen(window, "resize", () => this.close());
    this.listen(window, "blur", () => this.close());
    this.listen(this.popover, "click", (e) => {
      e.preventDefault();
      const target = this.target;
      this.close();
      if (target) {
        opts.jump(target);
      }
    });
    // Keep the document from scrolling (and closing the popover) when the
    // popover is scrolled past its ends.
    this.popover.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
  }

  dispose() {
    this.close();
    for (const dispose of this.disposers.splice(0)) {
      dispose();
    }
    this.popover.remove();
  }

  isOpen() {
    return !this.popover.classList.contains("hidden");
  }

  close() {
    this.cancelOpen();
    this.cancelClose();
    this.generation++;
    this.anchor = undefined;
    this.target = undefined;
    this.pinned = false;
    this.popover.classList.add("hidden");
  }

  private listen(target: EventTarget, type: string, handler: (e: Event) => void) {
    target.addEventListener(type, handler);
    this.disposers.push(() => target.removeEventListener(type, handler));
  }

  private onMouseOver(e: MouseEvent) {
    if (this.popover.contains(e.target as Node)) {
      this.cancelClose();
      return;
    }

    const link = this.opts.hookedElem.contains(e.target as Node)
      ? findInternalLink(e.target)
      : undefined;
    if (link && link.anchor === this.anchor) {
      // Still on the link being previewed.
      this.cancelClose();
      return;
    }

    if (this.pinned) {
      // A right-clicked preview stays until it is dismissed.
      return;
    }

    this.cancelOpen();
    if (link) {
      this.openTimer = setTimeout(
        () => this.open(link.anchor, link.target, false),
        HOVER_OPEN_DELAY,
      );
    }
    // `anchor` is also set while a preview is still rendering.
    if (this.anchor) {
      this.cancelClose();
      this.closeTimer = setTimeout(() => this.close(), HOVER_CLOSE_DELAY);
    }
  }

  private onContextMenu(e: MouseEvent) {
    const link = findInternalLink(e.target);
    if (!link) {
      return;
    }
    e.preventDefault();
    this.open(link.anchor, link.target, true);
  }

  private cancelOpen() {
    clearTimeout(this.openTimer);
    this.openTimer = undefined;
  }

  private cancelClose() {
    clearTimeout(this.closeTimer);
    this.closeTimer = undefined;
  }

  private async open(anchor: Element, target: LinkTarget, pinned: boolean) {
    this.close();
    const generation = this.generation;
    this.anchor = anchor;
    this.target = target;
    this.pinned = pinned;

    const pages = this.opts.kModule.retrievePagesInfo();
    const pageInfo = pages[target.page - 1];
    if (!pageInfo || !(pageInfo.width > 0) || !(pageInfo.height > 0)) {
      return;
    }

    // Draw the page at the scale of the main view so that its text has the
    // same size, and make the popover as wide as the main view's window (or
    // as the page, if it is narrower).
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const cssPerPt = this.mainCssPerPt(pageInfo.width);
    const pageWidth = pageInfo.width * cssPerPt;
    const maxWidth = Math.min(this.opts.scrollElem.clientWidth, viewport.width - 16);
    const size = {
      width: Math.min(pageWidth + POPOVER_BORDER * 2, maxWidth),
      height: Math.min(320, Math.max(120, viewport.height * 0.45)),
    };
    if (size.width < 80 || !(cssPerPt > 0)) {
      return;
    }

    // Render at the device resolution.
    const pixelPerPt = limitPixelPerPt(
      cssPerPt * (window.devicePixelRatio || 1),
      pageInfo.width,
      pageInfo.height,
    );
    const canvas = this.canvas;
    canvas.width = Math.ceil(pageInfo.width * pixelPerPt);
    canvas.height = Math.ceil(pageInfo.height * pixelPerPt);
    canvas.style.width = `${pageInfo.width * cssPerPt}px`;
    canvas.style.height = `${pageInfo.height * cssPerPt}px`;
    canvas.classList.toggle(
      "invert-colors",
      this.opts.hookedElem.classList.contains("invert-colors"),
    );
    this.marker.style.top = `${target.y * cssPerPt}px`;
    this.message.textContent = "";

    let failed = false;
    try {
      await this.opts.kModule.renderCanvas({
        canvas: canvas.getContext("2d")!,
        pageOffset: target.page - 1,
        backgroundColor: "#ffffff",
        pixelPerPt,
        dataSelection: { body: true },
      });
    } catch (err) {
      console.error("failed to render link preview", err);
      failed = true;
    }
    if (generation !== this.generation || !anchor.isConnected) {
      return;
    }
    this.message.textContent = failed ? `Page ${target.page} could not be rendered.` : "";

    const { left, top } = placePopover(anchor.getBoundingClientRect(), size, viewport);
    this.popover.style.left = `${left}px`;
    this.popover.style.top = `${top}px`;
    this.popover.style.width = `${size.width}px`;
    this.popover.style.height = `${size.height}px`;
    this.popover.classList.remove("hidden");
    // A page zoomed wider than the window can be scrolled sideways; show the
    // target near the left edge then.
    const overflowsX = pageWidth > size.width - POPOVER_BORDER * 2;
    this.content.classList.toggle("scroll-x", overflowsX);
    this.content.scrollTop = target.y * cssPerPt - size.height * TARGET_OFFSET_RATIO;
    this.content.scrollLeft = overflowsX ? target.x * cssPerPt - size.width * 0.1 : 0;
  }

  /// CSS px per pt of the pages in the main view. Falls back to fitting a
  /// `pageWidth` pt wide page to the main view's window.
  private mainCssPerPt(pageWidth: number): number {
    const svg = this.opts.hookedElem.firstElementChild;
    if (svg instanceof SVGSVGElement) {
      const svgWidth = Number.parseFloat(
        svg.getAttribute("data-width") || svg.getAttribute("width") || "",
      );
      const renderedWidth = svg.getBoundingClientRect().width;
      if (svgWidth > 0 && renderedWidth > 0) {
        return renderedWidth / svgWidth;
      }
    }
    return this.opts.scrollElem.clientWidth / pageWidth;
  }
}
