import React, { useEffect, useRef, useState } from 'react';
import { X, ExternalLink, Loader2, FileImage } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Highlighted } from './Highlighted';

/**
 * Drawer with the cited page: the snippet, the page image (signed URL, bucket `page-images`, `{doc_id}/{page}.png`)
 * and a link to the original (bucket `documents`, `{doc_id}/{filename}`, opened at `#page=N`).
 * Shared by Search, Ask and the alert evidence. Escape and the backdrop close it.
 */
export function SourceViewer({ source, query = '', onClose }) {
  const [imageUrl, setImageUrl] = useState(null);
  const [docUrl, setDocUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const closeRef = useRef(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setImageUrl(null);
    setDocUrl(null);

    async function loadUrls() {
      try {
        const [img, doc] = await Promise.all([
          supabase.storage.from('page-images').createSignedUrl(`${source.doc_id}/${source.page}.png`, 3600),
          supabase.storage.from('documents').createSignedUrl(`${source.doc_id}/${source.doc_title}`, 3600),
        ]);
        if (!mounted) return;
        if (img?.data?.signedUrl) setImageUrl(img.data.signedUrl);
        if (doc?.data?.signedUrl) setDocUrl(`${doc.data.signedUrl}#page=${source.page}`);
      } catch {
        // the drawer still shows the snippet; the image area says it is unavailable
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadUrls();
    return () => {
      mounted = false;
    };
  }, [source]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Source: ${source.doc_title}, page ${source.page}`}
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-2xl md:w-[600px]"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <h2 className="line-clamp-1 text-lg font-semibold text-slate-800">{source.doc_title}</h2>
            <p className="text-sm text-slate-600">Page {source.page}</p>
          </div>
          <div className="flex items-center gap-2">
            {docUrl && (
              <a
                href={docUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-800 transition-colors hover:bg-indigo-100"
              >
                <ExternalLink aria-hidden="true" className="h-4 w-4" />
                <span>Open document</span>
              </a>
            )}
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close source"
              className="rounded-full p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto bg-slate-50 p-6">
          {source.snippet && (
            <div className="rounded-xl border border-yellow-300 bg-yellow-50 p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-yellow-900">Relevant excerpt</h3>
              <p className="text-sm italic leading-relaxed text-yellow-950">
                <Highlighted text={source.snippet} query={query} />
              </p>
            </div>
          )}

          <div className="relative flex min-h-[400px] flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {loading ? (
              <div role="status" className="absolute inset-0 flex flex-col items-center justify-center text-slate-600">
                <Loader2 aria-hidden="true" className="mb-4 h-8 w-8 animate-spin" />
                <p className="text-sm">Loading page image...</p>
              </div>
            ) : imageUrl ? (
              <img src={imageUrl} alt={`Page ${source.page} of ${source.doc_title}`} className="h-auto w-full object-contain" />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-600">
                <FileImage aria-hidden="true" className="mb-4 h-12 w-12 opacity-60" />
                <p className="text-sm">Page image unavailable</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
