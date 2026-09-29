import React, { useEffect, useState } from 'react';
import { X, ExternalLink, Loader2, FileImage } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export function SourceViewer({ source, onClose }) {
  const [imageUrl, setImageUrl] = useState(null);
  const [docUrl, setDocUrl] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    
    async function loadUrls() {
      setLoading(true);
      
      // 1. Get signed URL for the specific page image
      const { data: imgData } = await supabase.storage
        .from('page-images')
        .createSignedUrl(`${source.doc_id}/${source.page}.png`, 3600);
        
      // 2. Get signed URL for the original document
      const { data: docData } = await supabase.storage
        .from('documents')
        .createSignedUrl(`${source.doc_id}/${source.doc_title}`, 3600);

      if (!mounted) return;
      
      if (imgData?.signedUrl) setImageUrl(imgData.signedUrl);
      if (docData?.signedUrl) setDocUrl(`${docData.signedUrl}#page=${source.page}`);
      
      setLoading(false);
    }
    
    loadUrls();
    
    return () => { mounted = false; };
  }, [source]);

  return (
    <>
      <div 
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      
      <div className="fixed inset-y-0 right-0 w-full md:w-[600px] bg-white shadow-2xl z-50 flex flex-col transform transition-transform duration-300 ease-in-out">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="font-semibold text-slate-800 text-lg line-clamp-1">{source.doc_title}</h2>
            <p className="text-sm text-slate-500">Page {source.page}</p>
          </div>
          <div className="flex items-center gap-2">
            {docUrl && (
              <a 
                href={docUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Open Document</span>
              </a>
            )}
            <button 
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto bg-slate-50 p-6 flex flex-col gap-6">
          {source.snippet && (
            <div className="bg-yellow-50/50 border border-yellow-200 rounded-xl p-4">
              <h4 className="text-xs font-semibold text-yellow-800 uppercase tracking-wider mb-2">Relevant Excerpt</h4>
              <p 
                className="text-sm text-yellow-900 italic leading-relaxed"
                dangerouslySetInnerHTML={{ __html: source.snippet }}
              />
            </div>
          )}

          <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col relative min-h-[400px]">
            {loading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                <Loader2 className="w-8 h-8 animate-spin mb-4" />
                <p className="text-sm">Loading page image...</p>
              </div>
            ) : imageUrl ? (
              <img 
                src={imageUrl} 
                alt={`Page ${source.page}`} 
                className="w-full h-auto object-contain"
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
                <FileImage className="w-12 h-12 mb-4 opacity-50" />
                <p className="text-sm">Page image unavailable</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
