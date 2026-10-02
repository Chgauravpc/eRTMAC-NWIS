import React, { useState } from 'react';
import { PlanningForm } from './PlanningForm';
import { BriefView } from './BriefView';
import { apiFetch } from '../../lib/api';
import './print.css';

export function PlanningPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [params, setParams] = useState(null);
  const [error, setError] = useState(null);

  const handleSubmit = async (formParams) => {
    setLoading(true);
    setError(null);
    setParams(formParams);
    try {
      const res = await apiFetch('/api/planning/brief', {
        method: 'POST',
        body: JSON.stringify(formParams)
      });
      setData(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 print-container">
      <PlanningForm onSubmit={handleSubmit} loading={loading} />
      
      {error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg border border-red-100 no-print">
          Error: {error}
        </div>
      )}

      {data && (
        <BriefView data={data} requestParams={params} />
      )}
    </div>
  );
}
