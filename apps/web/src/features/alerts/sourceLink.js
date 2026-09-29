/**
 * Link target for a cited document page. The shared SourceViewer (FE-12) is opened from this route.
 * Kept in one place so alerts, the risk tab and the rig view all agree.
 */
export function sourceHref(docId, page) {
  const qs = page != null ? `?page=${encodeURIComponent(page)}` : '';
  return `/sources/${encodeURIComponent(docId)}${qs}`;
}
