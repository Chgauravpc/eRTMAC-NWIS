// bbox jsonb (contract §6): {"x":0.12,"y":0.40,"w":0.30,"h":0.03}, fractions (0..1) of the page image.
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

export function isValidBbox(b) {
  return !!b && isNum(b.x) && isNum(b.y) && isNum(b.w) && isNum(b.h) && b.w > 0 && b.h > 0;
}

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/** CSS percentages for an overlay placed inside a wrapper that has exactly the size of the page image. */
export function bboxToPercentStyle(b) {
  if (!isValidBbox(b)) return null;
  const x = clamp01(b.x);
  const y = clamp01(b.y);
  const w = Math.min(b.w, 1 - x);
  const h = Math.min(b.h, 1 - y);
  const pct = (n) => `${+(n * 100).toFixed(4)}%`;
  return { left: pct(x), top: pct(y), width: pct(w), height: pct(h) };
}

/** Pixel rectangle for a rendered image size (bbox fractions x image size). */
export function bboxToPixels(b, width, height) {
  if (!isValidBbox(b)) return null;
  return { left: b.x * width, top: b.y * height, width: b.w * width, height: b.h * height };
}
