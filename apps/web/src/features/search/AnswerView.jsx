import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Info, ExternalLink } from 'lucide-react';
import { SourceViewer } from './SourceViewer';
import { ProvenanceBadge } from '../wells/ProvenanceBadge';

export function AnswerView({ answer_md, citations, evidence, provider, cached }) {
  const [activeSource, setActiveSource] = useState(null);

  // Custom text renderer to replace [n] with interactive chips
  const renderTextWithCitations = (text) => {
    // Regex matches [1], [2], [1][3], etc.
    const parts = text.split(/(\[\d+\])/g);
    
    return parts.map((part, i) => {
      const match = part.match(/\[(\d+)\]/);
      if (match) {
        const n = parseInt(match[1], 10);
        const citation = citations?.find(c => c.n === n);
        
        if (citation) {
          return (
            <button
              key={i}
              onClick={() => setActiveSource(citation)}
              className="inline-flex items-center justify-center w-5 h-5 ml-1 mr-0.5 text-[10px] font-bold rounded-full bg-indigo-100 text-indigo-800 hover:bg-indigo-200 hover:ring-2 hover:ring-indigo-300 transition-all align-super cursor-pointer"
              title={`${citation.doc_title}, Page ${citation.page}`}
            >
              {n}
            </button>
          );
        }
        // Unknown number
        return <span key={i} className="text-slate-600">{part}</span>;
      }
      return <span key={i}>{part}</span>;
    });
  };

  if (evidence === 'insufficient') {
    return (
      <div className="bg-slate-50 rounded-2xl border border-slate-200 p-8 text-center">
        <Info className="w-10 h-10 text-slate-500 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-slate-800 mb-2">Not enough evidence</h3>
        <p className="text-slate-600 mb-6 max-w-lg mx-auto">
          We could not find sufficient information in the offset well reports to answer this question confidently. 
          Here are the closest records we found:
        </p>
        {citations?.length > 0 && (
          <div className="text-left max-w-2xl mx-auto space-y-3">
            {citations.map(c => (
              <button 
                key={c.chunk_id}
                onClick={() => setActiveSource(c)}
                className="w-full bg-white p-4 rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-sm transition-all flex items-center justify-between group"
              >
                <div>
                  <div className="font-medium text-slate-800 group-hover:text-indigo-600 transition-colors flex items-center gap-2">
                    {c.doc_title}
                    <ProvenanceBadge provenance={c.provenance} light />
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Page {c.page}
                  </div>
                </div>
                <ExternalLink className="w-4 h-4 text-slate-500 group-hover:text-indigo-600" />
              </button>
            ))}
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

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        <div className="prose prose-slate prose-indigo max-w-none text-slate-700 leading-relaxed">
          <ReactMarkdown
            components={{
              p: ({ children }) => {
                // If children is array, process text nodes
                const processed = React.Children.map(children, child => {
                  if (typeof child === 'string') {
                    return renderTextWithCitations(child);
                  }
                  return child;
                });
                return <p className="mb-4 last:mb-0">{processed}</p>;
              },
              li: ({ children }) => {
                const processed = React.Children.map(children, child => {
                  if (typeof child === 'string') {
                    return renderTextWithCitations(child);
                  }
                  return child;
                });
                return <li>{processed}</li>;
              }
            }}
          >
            {answer_md}
          </ReactMarkdown>
        </div>

        {/* Footer Meta */}
        {(provider || cached) && (
          <div className="mt-8 pt-4 border-t border-slate-100 flex items-center justify-end gap-3 text-xs text-slate-600">
            {provider && <span>Provider: {provider}</span>}
            {cached && <span className="bg-slate-100 px-2 py-0.5 rounded">cached</span>}
          </div>
        )}
      </div>

      {/* Sources List */}
      {citations?.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-3 px-2">Sources Referenced</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {citations.map((c) => (
              <button
                key={c.n}
                onClick={() => setActiveSource(c)}
                className="text-left bg-white p-4 rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-sm transition-all group flex items-start gap-3"
              >
                <div className="w-6 h-6 shrink-0 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center text-xs font-bold font-mono group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                  {c.n}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-800 text-sm truncate group-hover:text-indigo-600 transition-colors flex items-center gap-2">
                    {c.doc_title}
                    <ProvenanceBadge provenance={c.provenance} light />
                  </div>
                  <div className="text-xs text-slate-500 mt-1 line-clamp-2">
                    {c.snippet}
                  </div>
                </div>
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
