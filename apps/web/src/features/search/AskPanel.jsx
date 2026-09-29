import React, { useState, useEffect } from 'react';
import { Sparkles, ArrowRight, Loader2, Clock } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { AnswerView } from './AnswerView';

const EXAMPLES = [
  "What worked for mud losses in Tipam?",
  "Where did offsets get stuck in Barail?",
  "Kicks below 3,500 m?",
  "Cement problems behind 9-5/8 casing?"
];

export function AskPanel({ filters }) {
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState(() => JSON.parse(localStorage.getItem('nwis_ask_history') || '[]'));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    localStorage.setItem('nwis_ask_history', JSON.stringify(history));
  }, [history]);

  const handleSubmit = async (q) => {
    const text = typeof q === 'string' ? q : query;
    if (!text.trim()) return;

    setQuery(text);
    setLoading(true);
    setResult(null);
    setError(null);

    // Update history
    setHistory(prev => {
      const next = [text, ...prev.filter(h => h !== text)].slice(0, 10);
      return next;
    });

    try {
      const body = {
        question: text,
        filters: {
          formation: filters.formation || null,
          event_type: filters.event_type || null,
          field: filters.field || null,
          md_from: filters.md_from ? Number(filters.md_from) : null,
          md_to: filters.md_to ? Number(filters.md_to) : null,
        },
        wellbore_id: null
      };
      
      const res = await apiFetch('/api/ask', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      setResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Search Box */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500 transition-shadow">
        <form 
          className="relative flex items-center p-2"
          onSubmit={e => { e.preventDefault(); handleSubmit(); }}
        >
          <Sparkles className="w-5 h-5 text-indigo-400 ml-3 shrink-0" />
          <input
            type="text"
            placeholder="Ask a question about offset wells..."
            className="flex-1 bg-transparent border-0 ring-0 focus:ring-0 text-slate-800 text-lg px-4 py-3 placeholder:text-slate-400"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <button 
            type="submit"
            disabled={!query.trim() || loading}
            className="p-3 bg-indigo-50 text-indigo-600 rounded-xl hover:bg-indigo-100 disabled:opacity-50 disabled:hover:bg-indigo-50 transition-colors"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
          </button>
        </form>
      </div>

      {/* Examples & History */}
      {!result && !loading && (
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-medium text-slate-500 mb-3 uppercase tracking-wider">Examples</h3>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map(ex => (
                <button
                  key={ex}
                  onClick={() => handleSubmit(ex)}
                  className="px-4 py-2 rounded-full bg-white border border-slate-200 text-sm text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          {history.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-slate-500 mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4" /> Recent Questions
              </h3>
              <div className="flex flex-col gap-1">
                {history.map(h => (
                  <button
                    key={h}
                    onClick={() => handleSubmit(h)}
                    className="text-left px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 truncate w-full"
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* States */}
      {loading && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
          <div className="space-y-4 animate-pulse">
            <div className="h-4 bg-slate-100 rounded w-3/4"></div>
            <div className="h-4 bg-slate-100 rounded w-full"></div>
            <div className="h-4 bg-slate-100 rounded w-5/6"></div>
          </div>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 text-red-600 rounded-xl border border-red-100">
          Error: {error}
        </div>
      )}

      {result && (
        <AnswerView 
          answer_md={result.answer_md}
          citations={result.citations}
          evidence={result.evidence}
          provider={result.provider}
          cached={result.cached}
        />
      )}
    </div>
  );
}
