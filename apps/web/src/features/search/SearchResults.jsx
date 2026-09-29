import React, { useState } from 'react';
import { Search, Loader2, FileText, ChevronRight } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { SourceViewer } from './SourceViewer';

export function SearchResults({ filters }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [activeSource, setActiveSource] = useState(null);

  const handleSearch = async (e) => {
    e?.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    try {
      const body = {
        q: query,
        filters: {
          formation: filters.formation || null,
          event_type: filters.event_type || null,
          field: filters.field || null,
          md_from: filters.md_from ? Number(filters.md_from) : null,
          md_to: filters.md_to ? Number(filters.md_to) : null,
        },
        limit: 20
      };
      const res = await apiFetch('/api/search', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      setResults(res.results);
    } catch (err) {
      console.error(err);
      // Handle error gracefully in real app
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSearch} className="relative">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
          <Search className="h-5 w-5 text-slate-400" />
        </div>
        <input
          type="text"
          className="block w-full pl-11 pr-4 py-3 bg-white border border-slate-300 rounded-xl text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-sm"
          placeholder="Search reports, well names, snippets..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="absolute inset-y-1.5 right-1.5 px-4 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors text-sm font-medium"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
        </button>
      </form>

      {results && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-slate-500">
            {results.length} results found
          </h3>
          <div className="flex flex-col gap-3">
            {results.map(r => (
              <button
                key={r.chunk_id}
                onClick={() => setActiveSource(r)}
                className="text-left bg-white p-5 rounded-xl border border-slate-200 hover:border-indigo-400 hover:shadow-md transition-all group flex gap-4 items-start"
              >
                <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg shrink-0">
                  <FileText className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="font-semibold text-slate-900 truncate">{r.doc_title}</h4>
                    <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full shrink-0">
                      Page {r.page}
                    </span>
                    {r.formation && (
                      <span className="text-xs px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full shrink-0 border border-emerald-100">
                        {r.formation}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-slate-500 flex items-center gap-2 mb-2">
                    <span className="font-medium text-slate-700">{r.well_name}</span>
                  </div>
                  <p 
                    className="text-sm text-slate-600 line-clamp-3 leading-relaxed"
                    dangerouslySetInnerHTML={{ __html: r.snippet }} 
                  />
                </div>
                <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-indigo-500 mt-2 shrink-0 transition-colors" />
              </button>
            ))}
          </div>
        </div>
      )}

      {activeSource && (
        <SourceViewer 
          source={activeSource} 
          onClose={() => setActiveSource(null)} 
        />
      )}
    </div>
  );
}
