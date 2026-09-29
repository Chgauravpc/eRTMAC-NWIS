import React, { useState } from 'react';
import { AskPanel } from './AskPanel';
import { SearchResults } from './SearchResults';
import { EVENT_TYPES } from '../../lib/constants';

export function SearchPage() {
  const [tab, setTab] = useState('ask');
  const [filters, setFilters] = useState({
    formation: '',
    event_type: '',
    field: '',
    md_from: '',
    md_to: ''
  });

  return (
    <div className="flex h-full flex-col md:flex-row bg-slate-50">
      {/* Sidebar / Filters */}
      <div className="w-full md:w-64 shrink-0 border-r border-slate-200 bg-white p-4 overflow-y-auto">
        <h2 className="font-semibold text-slate-800 mb-4">Filters</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Formation</label>
            <input 
              type="text" 
              className="w-full text-sm border-slate-300 rounded-md" 
              placeholder="e.g. Tipam"
              value={filters.formation}
              onChange={e => setFilters(f => ({ ...f, formation: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Event Type</label>
            <select 
              className="w-full text-sm border-slate-300 rounded-md bg-white"
              value={filters.event_type}
              onChange={e => setFilters(f => ({ ...f, event_type: e.target.value }))}
            >
              <option value="">Any</option>
              {EVENT_TYPES.map(et => <option key={et} value={et}>{et}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Field</label>
            <input 
              type="text" 
              className="w-full text-sm border-slate-300 rounded-md" 
              placeholder="e.g. Duliajan"
              value={filters.field}
              onChange={e => setFilters(f => ({ ...f, field: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Depth Range (m)</label>
            <div className="flex gap-2">
              <input 
                type="number" 
                className="w-full text-sm border-slate-300 rounded-md" 
                placeholder="From"
                value={filters.md_from}
                onChange={e => setFilters(f => ({ ...f, md_from: e.target.value }))}
              />
              <input 
                type="number" 
                className="w-full text-sm border-slate-300 rounded-md" 
                placeholder="To"
                value={filters.md_to}
                onChange={e => setFilters(f => ({ ...f, md_to: e.target.value }))}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="border-b border-slate-200 bg-white px-6">
          <nav className="flex space-x-6" aria-label="Tabs">
            {['ask', 'search'].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`py-4 px-1 border-b-2 text-sm font-medium capitalize ${
                  tab === t
                    ? 'border-indigo-500 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                {t}
              </button>
            ))}
          </nav>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto">
            {tab === 'ask' ? (
              <AskPanel filters={filters} />
            ) : (
              <SearchResults filters={filters} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
