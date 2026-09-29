import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { PageViewer } from './PageViewer';
import { FieldList } from './FieldList';
import { useProfile } from '../auth/useProfile';
import { getReviewQueue } from '../../lib/data/review';
import { reviewKeys, useDocumentPages, usePageImageUrl, useReviewAction, useReviewFields } from '../../lib/hooks/review';

const AUTO_NEXT_MS = 1500;
const TEXT_ENTRY = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const pageOf = (f) => f?.page || 1;
const NO_FIELDS = [];

export function ReviewDoc() {
  const { docId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { profile } = useProfile();
  // Contract §7/§8: only reviewer/admin can call review_field; office engineers see the queue read-only.
  const isReadOnly = !(profile?.role === 'reviewer' || profile?.role === 'admin');

  const { data: loaded, isLoading, error: loadError } = useReviewFields(docId);
  const fields = loaded || NO_FIELDS;
  const { data: pageRows } = useDocumentPages(docId);
  const review = useReviewAction(docId);

  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [nextDocId, setNextDocId] = useState(undefined); // undefined = not looked up yet, null = queue empty
  const cardRefs = useRef(new Map());

  const selected = fields.find((f) => f.id === selectedId) || null;
  const pendingCount = fields.filter((f) => f.review_status === 'pending').length;
  const completed = !isLoading && !loadError && pendingCount === 0;

  const pageNumbers = useMemo(() => {
    const set = new Set([...(pageRows || []).map((p) => p.page_no), ...fields.map(pageOf)]);
    return [...set].sort((a, b) => a - b);
  }, [pageRows, fields]);
  const lastPage = pageNumbers[pageNumbers.length - 1] || 1;
  const pageFields = fields.filter((f) => pageOf(f) === currentPage);
  const imagePath = (pageRows || []).find((p) => p.page_no === currentPage)?.image_path || fields.find((f) => pageOf(f) === currentPage)?.image_path;
  const { data: imageUrl, isLoading: imageLoading } = usePageImageUrl(docId, currentPage, imagePath);

  // Start on the first pending field.
  useEffect(() => {
    if (selectedId || fields.length === 0) return;
    const first = fields.find((f) => f.review_status === 'pending') || fields[0];
    setSelectedId(first.id);
    setCurrentPage(pageOf(first));
  }, [fields, selectedId]);

  // Keep the keyboard cursor visible: focus the selected card when the selection changes or an edit closes.
  useEffect(() => {
    if (!selectedId || editingId) return;
    const el = cardRefs.current.get(selectedId);
    if (el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView?.({ block: 'nearest' });
    }
  }, [selectedId, editingId, currentPage]);

  const select = useCallback((field) => {
    setSelectedId(field.id);
    setCurrentPage(pageOf(field));
    setEditingId(null);
    setActionError(null);
  }, []);

  const move = useCallback(
    (delta) => {
      const idx = fields.findIndex((f) => f.id === selectedId);
      const target = fields[idx + delta];
      if (idx >= 0 && target) select(target);
    },
    [fields, selectedId, select]
  );

  const act = useCallback(
    async (field, action, value = null) => {
      if (isReadOnly || busy || !field) return;
      setBusy(true);
      setActionError(null);
      try {
        await review(field, action, value);
        setReviewedCount((n) => n + 1);
        setEditingId(null);
        const idx = fields.findIndex((f) => f.id === field.id);
        const stillPending = (f) => f.id !== field.id && f.review_status === 'pending';
        const next = fields.slice(idx + 1).find(stillPending) || fields.find(stillPending);
        if (next) select(next);
      } catch (e) {
        setActionError(e);
      } finally {
        setBusy(false);
      }
    },
    [isReadOnly, busy, review, fields, select]
  );

  // Latest-state ref so the single window listener never sees stale closures.
  const latest = useRef({});
  latest.current = { act, move, selected, editingId, busy, isReadOnly, completed };
  useEffect(() => {
    const onKeyDown = (e) => {
      const s = latest.current;
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (TEXT_ENTRY.has(t.tagName) || t.isContentEditable)) return;
      if (s.completed) return;
      const key = e.key.toLowerCase();
      if (key === 'j' || key === 'k') {
        e.preventDefault();
        s.move(key === 'j' ? 1 : -1);
        return;
      }
      if (s.isReadOnly || s.busy || !s.selected || s.editingId) return;
      if (key === 'a') {
        e.preventDefault();
        s.act(s.selected, 'approve');
      } else if (key === 'r') {
        e.preventDefault();
        s.act(s.selected, 'reject');
      } else if (key === 'e') {
        e.preventDefault();
        setEditingId(s.selected.id);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // After the last field: look up the next document in the queue and go there.
  useEffect(() => {
    if (!completed) return undefined;
    let alive = true;
    let timer;
    qc.fetchQuery({ queryKey: reviewKeys.queue, queryFn: getReviewQueue, staleTime: 0 })
      .then((queue) => {
        if (!alive) return;
        const next = queue.find((d) => d.doc_id !== docId);
        setNextDocId(next ? next.doc_id : null);
        if (next && reviewedCount > 0) {
          timer = setTimeout(() => navigate(`/review/${next.doc_id}`), AUTO_NEXT_MS);
        }
      })
      .catch(() => alive && setNextDocId(null));
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [completed, docId, qc, navigate, reviewedCount]);

  // A different document resets the session state.
  useEffect(() => {
    setSelectedId(null);
    setEditingId(null);
    setCurrentPage(1);
    setActionError(null);
    setReviewedCount(0);
    setNextDocId(undefined);
  }, [docId]);

  const goToPage = (p) => {
    const page = Math.min(lastPage, Math.max(1, p));
    setCurrentPage(page);
    setEditingId(null);
    const first = fields.find((f) => pageOf(f) === page && f.review_status === 'pending') || fields.find((f) => pageOf(f) === page);
    if (first) setSelectedId(first.id);
  };

  if (loadError) {
    return (
      <div role="alert" className="m-6 rounded-lg border border-red-200 bg-red-50 p-4 font-bold text-red-700">
        Could not load this document&apos;s fields: {loadError.message}
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100">
      <section aria-label="Page image" className="flex h-full w-1/2 flex-col border-r border-gray-700 bg-[#1e1e1e]">
        <div className="z-10 flex items-center justify-between border-b border-gray-700 bg-[#2d2d2d] p-3 text-white shadow-sm">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous page"
              disabled={currentPage <= 1}
              onClick={() => goToPage(currentPage - 1)}
              className="rounded bg-gray-700 p-1.5 hover:bg-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className="px-3 font-mono font-black" aria-live="polite">
              Page {currentPage} of {lastPage}
            </span>
            <button
              type="button"
              aria-label="Next page"
              disabled={currentPage >= lastPage}
              onClick={() => goToPage(currentPage + 1)}
              className="rounded bg-gray-700 p-1.5 hover:bg-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="relative flex flex-1 items-start justify-center overflow-auto p-6">
          <PageViewer imageUrl={imageUrl} loading={imageLoading} selectedField={selected && pageOf(selected) === currentPage ? selected : null} />
        </div>
      </section>

      <section aria-label="Extracted fields" className="flex h-full w-1/2 flex-col bg-gray-50">
        <div className="z-10 border-b border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-black uppercase tracking-tight text-gray-900">Review fields</h1>
            <span className="text-sm font-bold text-gray-600" aria-live="polite">
              {pendingCount} pending in this document
            </span>
          </div>
          <p className="mt-2 text-xs text-gray-600" data-testid="shortcut-hint">
            Keyboard:{' '}
            <kbd className="rounded border bg-gray-100 px-1 font-mono">J</kbd>/<kbd className="rounded border bg-gray-100 px-1 font-mono">K</kbd> next / previous field,{' '}
            <kbd className="rounded border bg-gray-100 px-1 font-mono">A</kbd> approve,{' '}
            <kbd className="rounded border bg-gray-100 px-1 font-mono">E</kbd> edit,{' '}
            <kbd className="rounded border bg-gray-100 px-1 font-mono">R</kbd> reject,{' '}
            <kbd className="rounded border bg-gray-100 px-1 font-mono">Esc</kbd> cancel edit
          </p>
          {isReadOnly && (
            <p className="mt-2 rounded bg-gray-200 px-3 py-1 text-sm font-bold text-gray-700">
              Read-only: only reviewers and admins can approve, edit or reject fields.
            </p>
          )}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {actionError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700" data-error-code={actionError.code}>
              {actionError.message}
            </div>
          )}

          {isLoading && <div className="p-10 text-center font-bold text-gray-500">Loading fields…</div>}

          {completed && (
            <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
              <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-600" aria-hidden="true" />
              <p className="text-lg font-black text-green-800">Document reviewed</p>
              {nextDocId ? (
                <p className="mt-2 text-sm text-green-800">
                  {reviewedCount > 0 ? 'Opening the next document… ' : ''}
                  <Link to={`/review/${nextDocId}`} className="font-bold underline focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600">
                    Next document
                  </Link>
                </p>
              ) : (
                <p className="mt-2 text-sm text-green-800">
                  {nextDocId === null ? 'No more documents in the queue. ' : ''}
                  <Link to="/review" className="font-bold underline focus:outline-none focus-visible:ring-2 focus-visible:ring-green-600">
                    Back to the queue
                  </Link>
                </p>
              )}
            </div>
          )}

          {!isLoading && fields.length > 0 && (
            <>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
                {pageFields.length} field{pageFields.length === 1 ? '' : 's'} on page {currentPage}
              </p>
              <FieldList
                fields={pageFields}
                selectedId={selectedId}
                editingId={editingId}
                busy={busy}
                isReadOnly={isReadOnly}
                cardRefs={cardRefs.current}
                onSelect={(id) => {
                  const f = fields.find((x) => x.id === id);
                  if (f && f.id !== selectedId) select(f);
                }}
                onAction={act}
                onStartEdit={(id) => setEditingId(id)}
                onCancelEdit={() => setEditingId(null)}
              />
            </>
          )}
        </div>
      </section>
    </div>
  );
}
