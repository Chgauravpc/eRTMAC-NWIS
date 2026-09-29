import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useWells } from '../../lib/hooks/wells';
import { Card, Badge, Spinner, cn } from '../../components/ui/Primitives';
import { fmtDepth } from '../../lib/units';
import { StreamStatusPill } from '../workspace/StreamStatusPill';

export function WellsPage() {
  const { data: wells, isLoading } = useWells();
  const [search, setSearch] = useState('');

  if (isLoading) return <div className="flex justify-center p-10"><Spinner /></div>;

  const drillingWells = wells?.filter(w => w.status === 'drilling') || [];
  
  const filteredAll = wells?.filter(w => 
    w.well_name?.toLowerCase().includes(search.toLowerCase()) || 
    w.field?.toLowerCase().includes(search.toLowerCase())
  ) || [];

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <section>
        <h2 className="text-xl font-bold mb-4">Active Drilling Wells</h2>
        {drillingWells.length === 0 ? (
          <p className="text-gray-500">No active wells right now.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {drillingWells.map(well => (
              <DrillingWellCard key={well.wellbore_id} well={well} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold">All Wells</h2>
          <input 
            type="text" 
            placeholder="Search wells..." 
            className="border border-gray-300 rounded p-2 text-sm"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Field</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">TD</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Events</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Provenance</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredAll.map(well => (
                <tr key={well.wellbore_id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-blue-600">
                    <Link to={`/wells/${well.wellbore_id}/map`}>{well.well_name}</Link>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{well.field}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">{well.status}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{fmtDepth(well.td_md_m)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{well.event_count}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500"><Badge>{well.provenance}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function DrillingWellCard({ well }) {
  return (
    <Card className="hover:border-blue-300 transition-colors">
      <div className="flex justify-between items-start mb-2">
        <Link to={`/wells/${well.wellbore_id}/map`} className="text-lg font-bold text-blue-600 hover:underline">
          {well.well_name}
        </Link>
        <Badge>{well.provenance}</Badge>
      </div>
      <div className="text-sm text-gray-600 mb-4">{well.field}</div>
      <div className="flex items-center justify-between text-sm">
        <div className="flex flex-col">
          <span className="text-gray-500 text-xs uppercase">Top Risk Now</span>
          <span className={cn("font-medium", well.top_risk_type ? "text-orange-600" : "text-gray-400")}>
            {well.top_risk_type ? well.top_risk_type.replace('_', ' ') : 'None'}
          </span>
        </div>
        <StreamStatusPill status="live" lastSampleAt={new Date().toISOString()} />
      </div>
    </Card>
  );
}
