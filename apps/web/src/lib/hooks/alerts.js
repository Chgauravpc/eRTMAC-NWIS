import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAlert, getMyAlertView, listOpenAlerts, listWellHistory, markAlertViewed, ackAlert, resolveAlert, dismissAlert, rateAlert, mapAlertError } from '../data/alerts';
import { getRealtimeConnected, subscribeRealtimeStatus } from '../realtime';
import { useWells } from './wells';

export const ALERT_KEYS = {
  all: ['alerts'],
  open: (userId) => ['alerts', 'open', userId ?? null],
  openPrefix: ['alerts', 'open'],
  history: (wb) => ['alerts', 'history', wb],
  view: (id) => ['alerts', 'view', id],
  one: (id) => ['alerts', 'one', id],
};

export const isOpenAlert = (a) => !!a && !['resolved', 'feedback'].includes(a.state);

const mergeRow = (old, row) => ({ ...(old || {}), ...row });

/**
 * Apply one alert row (from a Realtime event or an RPC result) to every cache that holds alerts:
 * the shared open list and the per-well history lists. This is what keeps AlertProvider, AlertsPage,
 * WellAlertsTab and the rig view showing the same thing.
 */
export function applyAlertChange(qc, row, { deleted = false } = {}) {
  if (!row?.id) return;
  qc.setQueryData(ALERT_KEYS.one(row.id), (old) => (old && !deleted ? mergeRow(old, row) : old));
  qc.setQueriesData({ queryKey: ALERT_KEYS.openPrefix }, (old) => {
    if (!old) return old;
    const idx = old.findIndex((a) => a.id === row.id);
    if (deleted || !isOpenAlert(row)) return idx >= 0 ? old.filter((a) => a.id !== row.id) : old;
    if (idx >= 0) {
      const next = [...old];
      next[idx] = mergeRow(old[idx], row);
      return next;
    }
    return [row, ...old];
  });
  qc.setQueryData(ALERT_KEYS.history(row.wellbore_id), (old) => {
    if (!old) return old; // not loaded yet: the first fetch will include it
    const idx = old.findIndex((a) => a.id === row.id);
    if (deleted || isOpenAlert(row)) return idx >= 0 ? old.filter((a) => a.id !== row.id) : old;
    if (idx >= 0) {
      const next = [...old];
      next[idx] = mergeRow(old[idx], row);
      return next;
    }
    return [row, ...old];
  });
}

/** Open alerts, shared by the provider, /alerts, the well tab and the rig view (one cache entry). */
export function useOpenAlerts(profile) {
  return useQuery({
    queryKey: ALERT_KEYS.open(profile?.id),
    queryFn: () => listOpenAlerts(profile),
    enabled: !!profile,
  });
}

export function useWellHistory(wellboreId) {
  return useQuery({
    queryKey: ALERT_KEYS.history(wellboreId),
    queryFn: () => listWellHistory(wellboreId),
    enabled: !!wellboreId,
  });
}

/** One alert by id, seeded with `initial` and kept fresh by applyAlertChange (works for resolved alerts too). */
export function useAlert(alertId, initial = null) {
  return useQuery({
    queryKey: ALERT_KEYS.one(alertId),
    queryFn: async () => (await getAlert(alertId)) ?? initial,
    enabled: !!alertId,
    initialData: initial ?? undefined,
    staleTime: 0,
  });
}

export function useMyAlertView(alertId) {
  return useQuery({
    queryKey: ALERT_KEYS.view(alertId),
    queryFn: () => getMyAlertView(alertId),
    enabled: !!alertId,
  });
}

/** wellbore_id -> well name (never show a raw id). */
export function useWellNames() {
  const { data } = useWells();
  return useMemo(() => Object.fromEntries((data || []).map((w) => [w.wellbore_id, w.well_name])), [data]);
}

export function useRealtimeConnected() {
  return useSyncExternalStore(subscribeRealtimeStatus, getRealtimeConnected, () => true);
}

/** Re-render every `everyMs` (age counters). */
export function useNow(everyMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}

const viewedThisSession = new Set();
export function resetViewedForTests() {
  viewedThisSession.clear();
}

/** Opening an alert calls mark_alert_viewed once per user, whatever its state (contract §7). */
export function useMarkViewedOnOpen(alertId, userId = null) {
  const qc = useQueryClient();
  useEffect(() => {
    const key = `${userId ?? ''}:${alertId}`;
    if (!alertId || viewedThisSession.has(key)) return;
    viewedThisSession.add(key);
    markAlertViewed(alertId)
      .then(() => qc.invalidateQueries({ queryKey: ALERT_KEYS.view(alertId) }))
      .catch(() => viewedThisSession.delete(key));
  }, [alertId, userId, qc]);
}

/**
 * Lifecycle actions shared by the card, the banner and the dialogs so they map errors identically.
 * Each action resolves to the updated alert row, or null after setting `error` (friendly text).
 */
export function useAlertActions() {
  const qc = useQueryClient();
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (fn) => {
      setPending(true);
      setError(null);
      try {
        const row = await fn();
        if (row && row.id) applyAlertChange(qc, row);
        return row ?? {};
      } catch (e) {
        const err = mapAlertError(e);
        if (mounted.current) setError(err);
        if (err.stale) qc.invalidateQueries({ queryKey: ALERT_KEYS.all });
        return null;
      } finally {
        if (mounted.current) setPending(false);
      }
    },
    [qc]
  );

  return useMemo(
    () => ({
      error,
      pending,
      clearError: () => setError(null),
      ack: (id, note) => run(() => ackAlert(id, note)),
      resolve: (id, outcome, note) => run(() => resolveAlert(id, outcome, note)),
      dismiss: (id, reason) => run(() => dismissAlert(id, reason)),
      rate: (id, useful) => run(() => rateAlert(id, useful)),
    }),
    [error, pending, run]
  );
}
