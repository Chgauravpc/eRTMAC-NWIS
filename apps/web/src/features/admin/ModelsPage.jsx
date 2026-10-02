import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { apiFetch } from '../../lib/api';
import { RISK_LABELS, RISK_TYPES } from '../../lib/constants';
import { RequireRole } from '../auth/RequireRole';
import { Loader2, RefreshCw } from 'lucide-react';
import { POLL_MS, POLL_WINDOW_MS, beatsBaseline, fmt2, fmt3, groupRuns, prAucBars, stillTraining } from './models';

const TH = 'px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-700';

function PrAucBars({ metrics }) {
  const bars = prAucBars(metrics);
  if (bars.model === null && bars.baseline === null) return <span className="text-sm text-gray-600">—</span>;
  const better = beatsBaseline(metrics);
  const row = (label, pct, value, tone) => (
    <div className="flex items-center gap-2">
      <span className="w-16 text-xs text-gray-700">{label}</span>
      <div className="h-2.5 w-32 overflow-hidden rounded bg-gray-200" aria-hidden="true">
        <div className={`h-full ${tone}`} style={{ width: `${pct ?? 0}%` }} />
      </div>
      <span className="font-mono text-xs text-gray-900">{value}</span>
    </div>
  );
  return (
    <div className="space-y-1" data-testid="pr-auc-bars">
      {row('Model', bars.model, fmt3(metrics?.pr_auc), better === false ? 'bg-orange-600' : 'bg-indigo-700')}
      {row('Baseline', bars.baseline, fmt3(metrics?.baseline_pr_auc), 'bg-gray-500')}
      {better !== null && (
        <div className={`text-xs font-medium ${better ? 'text-green-800' : 'text-orange-800'}`}>
          {better ? 'Beats the offset-only baseline' : 'Does not beat the baseline'}
        </div>
      )}
    </div>
  );
}

export function ModelsPage() {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [retraining, setRetraining] = useState(false);
  const [retrainError, setRetrainError] = useState(null);
  const [selectedRisks, setSelectedRisks] = useState([]);
  // {types: still waiting for a new run, baselineIds, startedAt} while a retrain is being watched
  const [watch, setWatch] = useState(null);
  const [timedOut, setTimedOut] = useState(false);
  const watchRef = useRef(null);
  watchRef.current = watch;

  const fetchModels = useCallback(async () => {
    const { data, error } = await supabase.from('model_runs').select('*').order('created_at', { ascending: false });
    if (error) setLoadError(error.message || 'Could not load the model runs.');
    else {
      setLoadError(null);
      setModels(data || []);
    }
    setLoading(false);
    return data || [];
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Retrain answers at once with an empty id list; the runs appear in model_runs as each risk type finishes.
  useEffect(() => {
    if (!watch) return undefined;
    const timer = setInterval(async () => {
      const w = watchRef.current;
      if (!w) return;
      const rows = await fetchModels();
      const left = stillTraining(w.types, w.baselineIds, rows);
      if (left.length === 0) {
        setWatch(null);
      } else if (Date.now() - w.startedAt >= POLL_WINDOW_MS) {
        setWatch(null);
        setTimedOut(true);
      } else if (left.length !== w.types.length) {
        setWatch({ ...w, types: left });
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [watch, fetchModels]);

  const handleRetrain = async () => {
    if (selectedRisks.length === 0) return;
    setRetraining(true);
    setRetrainError(null);
    setTimedOut(false);
    try {
      await apiFetch('/api/admin/retrain', { method: 'POST', body: JSON.stringify({ risk_types: selectedRisks }) });
      setWatch({ types: selectedRisks, baselineIds: models.map((m) => m.id), startedAt: Date.now() });
      setSelectedRisks([]);
    } catch (err) {
      setRetrainError(err.message || 'Retraining could not be started.');
    } finally {
      setRetraining(false);
    }
  };

  const toggleRisk = (rt) => setSelectedRisks((prev) => (prev.includes(rt) ? prev.filter((r) => r !== rt) : [...prev, rt]));
  const groups = groupRuns(models, RISK_TYPES);

  return (
    <RequireRole roles={['admin']}>
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Model runs</h1>
          <p className="mt-1 text-sm text-gray-700">
            One model per risk type adds a learned score on top of the offset evidence. A new model becomes active only if it beats the
            offset-only baseline.
          </p>
        </div>

        <fieldset className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <legend className="px-2 text-sm font-semibold text-gray-800">Retrain</legend>
          <div className="flex flex-wrap items-center gap-3">
            {RISK_TYPES.map((rt) => (
              <label
                key={rt}
                className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-indigo-600 ${
                  selectedRisks.includes(rt) ? 'border-indigo-400 bg-indigo-50 text-indigo-900' : 'border-gray-300 bg-gray-50 text-gray-800 hover:bg-gray-100'
                }`}
              >
                <input type="checkbox" className="sr-only" checked={selectedRisks.includes(rt)} onChange={() => toggleRisk(rt)} />
                {RISK_LABELS[rt] || rt}
              </label>
            ))}
            <button
              type="button"
              onClick={handleRetrain}
              disabled={retraining || selectedRisks.length === 0}
              className="ml-auto flex items-center gap-2 rounded-lg bg-indigo-700 px-5 py-2 font-medium text-white transition-colors hover:bg-indigo-800 disabled:opacity-50"
            >
              {retraining ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <RefreshCw aria-hidden="true" className="h-4 w-4" />}
              Retrain
            </button>
          </div>
          {retrainError && (
            <p role="alert" className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">
              {retrainError}
            </p>
          )}
          {watch && (
            <p role="status" data-testid="training-status" className="mt-3 flex items-center gap-2 text-sm font-medium text-indigo-900">
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
              Training started for {watch.types.map((t) => RISK_LABELS[t] || t).join(', ')}. This page checks for new runs every 10 seconds
              (for up to 10 minutes).
            </p>
          )}
          {timedOut && (
            <p role="status" className="mt-3 text-sm text-orange-900">
              No new run appeared within 10 minutes. Training may still be running; reload this page later to check.
            </p>
          )}
        </fieldset>

        {loadError && (
          <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Could not load the model runs: {loadError}
          </p>
        )}

        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          {loading ? (
            <div role="status" className="flex justify-center p-10">
              <Loader2 aria-label="Loading model runs" className="h-6 w-6 animate-spin text-gray-600" />
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className={TH}>Risk type</th>
                  <th scope="col" className={TH}>Version</th>
                  <th scope="col" className={TH}>PR-AUC vs baseline</th>
                  <th scope="col" className={TH}>Precision</th>
                  <th scope="col" className={TH}>Recall</th>
                  <th scope="col" className={TH}>Wells</th>
                  <th scope="col" className={TH}>Trained</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {groups.flatMap(([type, runs]) =>
                  runs.map((m, i) => (
                    <tr key={m.id} data-testid={`run-${type}`} className={m.is_active ? 'bg-indigo-50/40' : ''}>
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{i === 0 ? RISK_LABELS[type] || type : ''}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="font-mono text-sm text-gray-900">{m.version || '—'}</div>
                        {m.is_active ? (
                          <span className="mt-1 inline-flex items-center rounded bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-900">ACTIVE</span>
                        ) : (
                          <span className="mt-1 inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-800">inactive</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <PrAucBars metrics={m.metrics} />
                      </td>
                      <td className="px-4 py-3 font-mono text-sm text-gray-900">{fmt2(m.metrics?.precision)}</td>
                      <td className="px-4 py-3 font-mono text-sm text-gray-900">{fmt2(m.metrics?.recall)}</td>
                      <td className="px-4 py-3 font-mono text-sm text-gray-900">{m.metrics?.n_wells ?? '—'}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">{m.created_at ? new Date(m.created_at).toLocaleString() : '—'}</td>
                    </tr>
                  )),
                )}
                {models.length === 0 && (
                  <tr>
                    <td colSpan="7" className="px-6 py-10 text-center text-gray-700">
                      No model runs yet. Choose a risk type and click Retrain.
                    </td>
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

export default ModelsPage;
