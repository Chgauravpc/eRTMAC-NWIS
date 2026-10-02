import React, { useEffect, useState } from 'react';
import { bboxToPercentStyle } from './bbox';

/**
 * Page image with the selected field's bbox highlighted.
 * The wrapper is exactly the size of the image (no border/padding, image is display:block), so the
 * percentage overlay (bbox fractions x 100) lines up with the text on the page at any zoom.
 */
// @surface #1e1e1e (the dark image pane of the review page)
export function PageViewer({ imageUrl, selectedField, loading = false }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [imageUrl]);

  if (!imageUrl) {
    return (
      <div role="status" className="mt-20 text-sm font-bold uppercase tracking-widest text-gray-400">
        {loading ? 'Loading page image…' : 'No image available for this page'}
      </div>
    );
  }
  if (failed) {
    return (
      <div role="alert" className="mt-20 text-sm font-bold text-red-400">
        The page image could not be loaded.
      </div>
    );
  }

  const style = bboxToPercentStyle(selectedField?.bbox);

  return (
    <div className="relative inline-block max-w-full bg-white shadow-2xl" data-testid="page-frame">
      <img
        src={imageUrl}
        alt="Document page"
        onError={() => setFailed(true)}
        className="block h-auto max-w-full"
        style={{ maxHeight: 'calc(100vh - 140px)' }}
      />
      {style && (
        <div
          data-testid="bbox-overlay"
          aria-label="Highlighted text location for the selected field"
          role="img"
          className="pointer-events-none absolute z-10 rounded-sm border-2 border-amber-500 bg-amber-300/30 transition-all duration-200"
          style={style}
        />
      )}
      {selectedField && !style && (
        <div className="absolute left-2 top-2 rounded bg-gray-900/80 px-2 py-1 text-xs font-bold text-white">
          No location recorded for this field
        </div>
      )}
    </div>
  );
}
