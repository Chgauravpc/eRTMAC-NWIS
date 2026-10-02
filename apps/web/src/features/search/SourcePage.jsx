import React from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { SourceViewer } from './SourceViewer';

/** The page number from `?page=`: a whole number of at least 1, otherwise 1. */
export function pageFromQuery(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

async function getDocumentTitle(docId) {
  const { data, error } = await supabase.from('documents').select('id, title').eq('id', docId).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * /sources/:docId?page=N: opens the shared source drawer for a cited page. Alert evidence and the risk tab link here
 * (see alerts/sourceLink.js); Search and Ask open the same drawer in place.
 */
export function SourcePage() {
  const { docId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const page = pageFromQuery(params.get('page'));
  const { data: doc, isLoading, error } = useQuery({ queryKey: ['document-title', docId], queryFn: () => getDocumentTitle(docId), retry: false });
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/search'));

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 text-[10px] font-bold uppercase tracking-[0.2em] text-gray-600">Knowledge / Source</div>
      {isLoading && (
        <p role="status" className="text-gray-700">
          Loading the source…
        </p>
      )}
      {!isLoading && (error || !doc) && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-6 text-red-900">
          <h1 className="mb-2 text-xl font-semibold">{error ? 'The source could not be loaded' : 'This document was not found'}</h1>
          <p className="mb-4 text-sm">
            {error ? error.message : 'It may have been removed, or you may not have access to it.'}
          </p>
          <Link to="/search" className="font-medium underline">
            Go to Search &amp; Ask
          </Link>
        </div>
      )}
      {doc && (
        <>
          <h1 className="mb-1 text-3xl font-medium tracking-tight text-gray-900">{doc.title}</h1>
          <p className="mb-6 text-gray-700">Page {page}</p>
          <button type="button" onClick={back} className="rounded border border-gray-400 bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-50">
            Back
          </button>
          <SourceViewer source={{ doc_id: doc.id, doc_title: doc.title, page, snippet: null }} onClose={back} />
        </>
      )}
    </div>
  );
}

export default SourcePage;
