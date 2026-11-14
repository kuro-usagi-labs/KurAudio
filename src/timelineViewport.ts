// Kept in sync with layout.track-header in design-tokens.json; verified by the UI audit.
export const HEADER_WIDTH = 176;

function cursorIn(scroller: HTMLElement) { return scroller.parentElement?.querySelector<HTMLElement>('.playhead'); }

export function syncTimelineScroll(scroller: HTMLElement) {
  const cursor = cursorIn(scroller); if (!cursor) return;
  cursor.style.left = `${Number(cursor.dataset.timelinePixel || 0) - scroller.scrollLeft}px`;
}

/** The cursor layer starts at the audio boundary, outside the sticky track controls. */
export function updateTimelinePlayhead(scroller: HTMLElement | null, time: number, scale: number, follow = false) {
  if (!scroller) return;
  const cursor = cursorIn(scroller); if (!cursor) return;
  const pixel = Math.max(0, time) * scale, width = Math.max(1, scroller.clientWidth - HEADER_WIDTH);
  cursor.dataset.timelinePixel = String(pixel);
  if (follow) {
    const margin = Math.min(48, width / 4), lead = Math.min(100, width / 3);
    if (pixel < scroller.scrollLeft) scroller.scrollLeft = Math.max(0, pixel - margin);
    else if (pixel > scroller.scrollLeft + width - margin) scroller.scrollLeft = Math.max(0, pixel - lead);
  }
  syncTimelineScroll(scroller);
}
