import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { apiFetch } from '../../lib/api';
import { RISK_TYPES } from '../../lib/constants';
import { RequireRole } from '../auth/RequireRole';
import { Loader2, RefreshCw, BarChart2 } from 'lucide-react';

export function ModelsPage() {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [retraining, setRetraining] = useState(false);
  const [selectedRisks, setSelectedRisks] = useState([]);
  const [pollingRunIds, setPollingRunIds] = useState([]);

  const fetchModels = async () => {
    const { data } = await supabase.from('model_runs').select('*').order('created_at', { ascending: false });
    if (data) setModels(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchModels();
  }, []);

  useEffect(() => {
    if (pollingRunIds.length === 0) return;
    const interval = setInterval(async () => {
      const { data } = await supabase.from('model_runs').select('*').in('id', pollingRunIds);
      if (data) {
        setModels(prev => {
          const next = [...prev];
          data.forEach(d => {
            const idx = next.findIndex(m => m.id === d.id);
            if (idx >= 0) next[idx] = d;
            else next.unshift(d);
          });
          return next;
        });
        
        // Remove completed runs from polling
        const completedIds = data.filter(d => d.is_active || d.metrics).map(d => d.id);
        if (completedIds.length > 0) {
          setPollingRunIds(prev => prev.filter(id => !completedIds.includes(id)));
        }
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [pollingRunIds]);

  const handleRetrain = async () => {
    if (selectedRisks.length === 0) return;
    setRetraining(true);
    try {
      const res = await apiFetch('/api/admin/retrain', {
        method: 'POST',
        body: JSON.stringify({ risk_types: selectedRisks })
      });
      if (res.model_run_ids) {
        setPollingRunIds(prev => [...prev, ...res.model_run_ids]);
        setSelectedRisks([]);
      }
    } catch (err) {
      console.error('Retrain failed:', err);
    } finally {
      setRetraining(false);
    }
  };

  const toggleRisk = (rt) => {
    setSelectedRisks(prev => prev.includes(rt) ? prev.filter(r => r !== rt) : [...prev, rt]);
  };

  return (
    <RequireRole roles={['admin']}>
      <div className="max-w-6xl mx-auto p-6 space-y-8">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Model Runs</h1>
            <p className="text-sm text-gray-500 mt-1">Manage and retrain risk prediction models</p>
          </div>
          
          <div className="flex items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-200">
            <div className="flex gap-2">
              {RISK_TYPES.map(rt => (
                <label key={rt} className={`px-3 py-1.5 rounded-lg text-sm font-medium cursor-pointer transition-colors border ${
                  selectedRisks.includes(rt) ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                }`}>
                  <input 
                    type="checkbox" 
                    className="sr-only"
                    checked={selectedRisks.includes(rt)}
                    onChange={() => toggleRisk(rt)}
                  />
                  {rt.replace('_', ' ')}
                </label>
              ))}
            </div>
            <button
              onClick={handleRetrain}
              disabled={retraining || selectedRisks.length === 0}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {retraining ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Retrain
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          {loading ? (
            <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Version</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Risk Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Metrics vs Baseline</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Created</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {models.map(m => {
                  const isPolling = pollingRunIds.includes(m.id);
                  const isBetter = m.metrics?.pr_auc > m.metrics?.baseline_pr_auc;
                  
                  return (
                    <tr key={m.id} className={m.is_active ? 'bg-indigo-50/30' : ''}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="font-mono text-sm text-gray-900">{m.version || 'Pending...'}</div>
                        {m.is_active && <span className="inline-flex mt-1 items-center px-2 py-0.5 rounded text-[10px] font-medium bg-green-100 text-green-800">ACTIVE</span>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 capitalize">
                        {m.risk_type.replace('_', ' ')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {isPolling ? (
                          <div className="flex items-center gap-2 text-sm text-blue-600">
                            <Loader2 className="w-4 h-4 animate-spin" /> Training...
                          </div>
                        ) : (
                          <span className="text-sm text-gray-500">Completed</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {m.metrics ? (
                          <div className="flex items-center gap-3">
                            <div className="flex flex-col">
                              <span className="text-xs text-gray-500">PR AUC</span>
                              <span className={`font-semibold ${isBetter ? 'text-green-600' : 'text-orange-600'}`}>
                                {m.metrics.pr_auc?.toFixed(3)}
                              </span>
                            </div>
                            <div className="text-gray-300">/</div>
                            <div className="flex flex-col">
                              <span className="text-xs text-gray-500">Baseline</span>
                              <span className="font-medium text-gray-600">
                                {m.metrics.baseline_pr_auc?.toFixed(3)}
                              </span>
                            </div>
                            <div className="ml-2 text-xs text-gray-400 flex items-center gap-1">
                              <BarChart2 className="w-3 h-3" />
                              {m.metrics.n_wells} wells
                            </div>
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(m.created_at).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
                {models.length === 0 && (
                  <tr>
                    <td colSpan="5" className="px-6 py-10 text-center text-gray-500">No model runs found</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </RequireRole>
  );
}
