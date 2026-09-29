import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { fmtDepth } from '../../lib/units';

export function WellPopup({ well }) {
  const [casing, setCasing] = useState(null);

  useEffect(() => {
    supabase.from('hole_sections').select('*').eq('wellbore_id', well.wellbore_id)
      .then(({ data }) => setCasing(data));
  }, [well.wellbore_id]);

  return (
    <div className="p-1 min-w-[200px]">
      <h4 className="font-bold text-base mb-1">{well.well_name}</h4>
      <div className="text-xs text-gray-600 space-y-1 mb-2">
        <div>Field: {well.field || '-'}</div>
        <div>Status: <span className="capitalize">{well.status}</span></div>
        <div>TD: {fmtDepth(well.td_md_m)}</div>
      </div>
      
      {casing && casing.length > 0 && (
        <div className="mb-2 text-xs">
          <strong>Casing:</strong>
          <ul className="list-disc list-inside mt-1">
            {casing.map(c => (
              <li key={c.id}>{c.casing_od_in}" @ {fmtDepth(c.shoe_md_m)}</li>
            ))}
          </ul>
        </div>
      )}
      
      <div className="mt-3 border-t pt-2">
        <Link to={`/wells/${well.wellbore_id}/map`} className="text-blue-600 text-sm font-medium hover:underline block">
          Open workspace →
        </Link>
      </div>
    </div>
  );
}
