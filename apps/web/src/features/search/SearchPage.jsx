import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';

export function SearchPage() {
  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-12">
        <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500 mb-4">
          Knowledge / Query
        </div>
        <h1 className="text-5xl font-medium tracking-tight text-gray-900 mb-4">Search & Ask</h1>
        <p className="text-gray-500 text-lg">This showcase view is ready for the next engineering workflow.</p>
      </div>

      <div className="bg-white border border-dashed border-gray-200 rounded p-24 flex flex-col items-center justify-center text-center">
        <Sparkles className="h-8 w-8 text-[#d97706] mb-6" />
        <h2 className="text-xl font-medium text-gray-900 mb-3">Workspace module</h2>
        <p className="text-sm text-gray-400 mb-8 max-w-md mx-auto">
          Premium NWIS patterns, evidence states, and realistic data are ready to extend here.
        </p>
        
        <Link 
          to="/wells" 
          className="inline-flex items-center gap-2 bg-[#111827] text-white px-5 py-2.5 rounded text-sm font-medium hover:bg-gray-800 transition-colors shadow-sm"
        >
          <ArrowRight className="h-4 w-4" /> Return to wells
        </Link>
      </div>
    </div>
  );
}
