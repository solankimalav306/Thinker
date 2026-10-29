// Small pure helpers for the document viewer, kept apart from the DOM so they can be tested.

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 5;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Distance from point p to the segment a-b.
export function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Smallest distance between two segments (a-b and c-d); zero when they cross.
export function segmentDistance(a, b, c, d) {
  const orient = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return 0;
  return Math.min(distanceToSegment(a, c, d), distanceToSegment(b, c, d), distanceToSegment(c, a, b), distanceToSegment(d, a, b));
}

// Does a stroke (points in pixels) come within `radius` of the eraser path from `from` to `to`?
// Testing whole segments (not only the sampled points) means a quick flick cannot skip over a line.
export function strokeTouchedBy(points, from, to, radius) {
  if (!Array.isArray(points) || points.length === 0) return false;
  const end = to || from;
  const start = from || to;
  if (points.length === 1) return distanceToSegment(points[0], start, end) <= radius;
  for (let i = 1; i < points.length; i += 1) {
    if (segmentDistance(points[i - 1], points[i], start, end) <= radius) return true;
  }
  return false;
}

// Which page is mostly in view? `cards` are { page, top, height } measured in the scroll content's
// coordinates; the window of interest is [viewTop, viewTop + viewHeight).
export function mostVisiblePage(cards, viewTop, viewHeight) {
  const viewBottom = viewTop + viewHeight;
  let best = null;
  let bestVisible = 0;
  for (const card of cards) {
    const visible = Math.min(card.top + card.height, viewBottom) - Math.max(card.top, viewTop);
    if (visible > bestVisible + 0.5) {
      bestVisible = visible;
      best = card.page;
    }
  }
  return best;
}

// Pinch (Ctrl+wheel) to zoom. Trackpad pinches send small deltas, a mouse wheel notch sends ~100.
export function scaleAfterWheel(scale, deltaY) {
  const step = clamp(deltaY, -120, 120);
  return clamp(scale * Math.exp(-step * 0.0018), MIN_SCALE, MAX_SCALE);
}

// Turns a page after the person keeps pushing against the edge of the page with the wheel or a
// two-finger swipe. It needs a deliberate push, then ignores the long tail of trackpad inertia.
export function createWheelTurner({ threshold = 140, gapMs = 160, resetMs = 450 } = {}) {
  let sum = 0;
  let lastAt = -Infinity;
  let armed = true;
  return function turn({ deltaY, atTop, atBottom, now }) {
    const quiet = now - lastAt >= gapMs;
    lastAt = now;
    if (quiet) armed = true;
    if (!armed) return null;
    const pushingDown = deltaY > 0 && atBottom;
    const pushingUp = deltaY < 0 && atTop;
    if (!pushingDown && !pushingUp) {
      sum = 0;
      return null;
    }
    if (now - lastAt > resetMs) sum = 0;
    sum += deltaY;
    if (Math.abs(sum) < threshold) return null;
    sum = 0;
    armed = false;
    return deltaY > 0 ? 'next' : 'prev';
  };
}

// Keep the same spot of the document under the viewport after the pages are re-laid out.
// `anchor` is { page, fraction } where fraction is how far down that page the viewport top was.
export function anchorFromScroll(cards, scrollTop) {
  for (const card of cards) {
    if (scrollTop < card.top + card.height) {
      const fraction = card.height > 0 ? clamp((scrollTop - card.top) / card.height, 0, 1) : 0;
      return { page: card.page, fraction: Math.max(0, fraction) };
    }
  }
  const last = cards[cards.length - 1];
  return last ? { page: last.page, fraction: 1 } : null;
}

export function scrollFromAnchor(cards, anchor) {
  const card = cards.find((c) => c.page === anchor?.page);
  if (!card) return 0;
  return Math.round(card.top + card.height * (anchor.fraction || 0));
}
