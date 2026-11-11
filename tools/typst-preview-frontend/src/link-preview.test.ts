import { describe, expect, it } from "vitest";
import { limitPixelPerPt, parseLinkTarget, placePopover } from "./link-preview";

describe("parseLinkTarget", () => {
  it("reads the target of a link to a document position", () => {
    expect(parseLinkTarget("handleTypstLocation(this, 3, 72.5, 140.25); return false")).toEqual({
      page: 3,
      x: 72.5,
      y: 140.25,
    });
    expect(parseLinkTarget("handleTypstLocation(this,1,0,-0.5)")).toEqual({
      page: 1,
      x: 0,
      y: -0.5,
    });
  });

  it("ignores other links", () => {
    expect(parseLinkTarget(null)).toBeUndefined();
    expect(parseLinkTarget("")).toBeUndefined();
    expect(parseLinkTarget("; return false")).toBeUndefined();
    expect(parseLinkTarget("handleTypstLocation(this, 0, 1, 2)")).toBeUndefined();
    expect(parseLinkTarget("handleTypstLocation(this, 1, NaN, 2)")).toBeUndefined();
  });
});

describe("placePopover", () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 400, height: 200 };

  it("prefers placing the popover below the link, centered on it", () => {
    const anchor = { left: 450, top: 100, width: 100, height: 20 };
    expect(placePopover(anchor, size, viewport)).toEqual({ left: 300, top: 126 });
  });

  it("places the popover above a link near the bottom", () => {
    const anchor = { left: 450, top: 700, width: 100, height: 20 };
    expect(placePopover(anchor, size, viewport)).toEqual({ left: 300, top: 494 });
  });

  it("keeps the popover inside the viewport", () => {
    const anchor = { left: 0, top: 100, width: 20, height: 20 };
    expect(placePopover(anchor, size, viewport).left).toBe(8);
    const right = { left: 990, top: 100, width: 10, height: 20 };
    expect(placePopover(right, size, viewport).left).toBe(592);
    const tiny = { width: 1000, height: 300 };
    const top = placePopover({ left: 450, top: 150, width: 100, height: 20 }, size, tiny).top;
    expect(top).toBeGreaterThanOrEqual(8);
    expect(top + size.height).toBeLessThanOrEqual(292);
  });
});

describe("limitPixelPerPt", () => {
  it("keeps the requested resolution for ordinary pages", () => {
    expect(limitPixelPerPt(2, 595, 842)).toBe(2);
  });

  it("lowers the resolution so that tall pages fit in a canvas", () => {
    const ppt = limitPixelPerPt(2, 595, 20000);
    expect(ppt).toBeLessThan(2);
    expect(20000 * ppt).toBeLessThanOrEqual(16384);
    expect(595 * 20000 * ppt * ppt).toBeLessThanOrEqual(32 * 1024 * 1024);
  });
});
