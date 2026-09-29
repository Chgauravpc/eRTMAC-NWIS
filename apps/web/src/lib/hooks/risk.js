import { useEffect, useMemo } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { subscribe } from '../realtime';
import { upsertScore } from '../risk';
import { getEventsByIds, getFormationAt, getFormationTops, getLessons, getOffsetDistances, getRiskScores, bestTop, recomputeRisk } from '../data/risk';
import { getStreamState, listStreamStates } from '../data/stream';

export const riskKeys = {
  stream: (wb) => ['stream_state', wb],
  scores: (wb) => ['risk_scores', wb],
  scoresWindow: (wb, snap) => ['risk_scores', wb, snap],
  formation: (wb, md) => ['formation_at_md', wb, md],
  tops: (wb) => ['formation_tops', wb],
  lessons: (formations, riskType) => ['lessons', formations, riskType],
};

/** stream_state for one wellbore, kept live through Realtime. */
export function useStreamState(wellboreId) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: riskKeys.stream(wellboreId),
    queryFn: () => getStreamState(wellboreId),
    enabled: !!wellboreId,
  });
  useEffect(() => {
    if (!wellboreId) return undefined;
    return subscribe('stream_state', `wellbore_id=eq.${wellboreId}`, (payload) => {
      if (payload.new) qc.setQueryData(riskKeys.stream(wellboreId), payload.new);
    });
  }, [wellboreId, qc]);
  return query;
}

/**
 * risk_scores overlapping the look-ahead window of `bitMd`, kept live: every Realtime row is upserted
 * (identity = risk_type + md range) into whichever window is cached; views filter to the exact window.
 */
export function useRiskScores(wellboreId, bitMd) {
  const qc = useQueryClient();
  const snap = bitMd == null ? null : Math.floor(bitMd / 25);
  const query = useQuery({
    queryKey: riskKeys.scoresWindow(wellboreId, snap),
    queryFn: () => getRiskScores(wellboreId, bitMd),
    enabled: !!wellboreId && bitMd != null,
    placeholderData: keepPreviousData,
  });
  useEffect(() => {
    if (!wellboreId) return undefined;
    return subscribe('risk_scores', `wellbore_id=eq.${wellboreId}`, (payload) => {
      if (!payload.new) return;
      qc.setQueriesData({ queryKey: riskKeys.scores(wellboreId) }, (old) => (old ? upsertScore(old, payload.new) : old));
    });
  }, [wellboreId, qc]);
  return query;
}

export function useRecomputeRisk(wellboreId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => recomputeRisk(wellboreId),
    onSuccess: (rows) => {
      qc.setQueriesData({ queryKey: riskKeys.scores(wellboreId) }, (old) => (rows || []).reduce((acc, r) => upsertScore(acc, r), old || []));
    },
  });
}

/** formation_at_md at the bit + the uncertainty of the next top (from formation_tops). */
export function useFormation(wellboreId, bitMd) {
  const snap = bitMd == null ? null : Math.floor(bitMd);
  const at = useQuery({
    queryKey: riskKeys.formation(wellboreId, snap),
    queryFn: () => getFormationAt(wellboreId, bitMd),
    enabled: !!wellboreId && bitMd != null,
    placeholderData: keepPreviousData,
  });
  const tops = useQuery({
    queryKey: riskKeys.tops(wellboreId),
    queryFn: () => getFormationTops(wellboreId),
    enabled: !!wellboreId,
  });
  const nextTop = useMemo(() => (at.data?.next_formation ? bestTop(tops.data, at.data.next_formation) : null), [at.data, tops.data]);
  return {
    data: at.data ?? null,
    isLoading: at.isLoading,
    isError: at.isError,
    nextUncertaintyM: nextTop?.uncertainty_m ?? null,
  };
}

export function useLessons(formations, riskType = null, limit = 3) {
  const key = (formations || []).filter(Boolean);
  return useQuery({
    queryKey: [...riskKeys.lessons(key, riskType), limit],
    queryFn: () => getLessons({ formations: key, riskType, limit }),
    enabled: key.length > 0,
  });
}

/** Offset events behind an interval's L1 score (well, distance, event, NPT, source). */
export function useIntervalEvents(score) {
  const ids = (score?.reasons || []).filter((r) => r.kind === 'offset_event' && r.event_id).map((r) => r.event_id);
  const eventsQ = useQuery({
    queryKey: ['events_by_ids', ids],
    queryFn: () => getEventsByIds(ids),
    enabled: ids.length > 0,
  });
  const mid = score ? (score.md_from_m + score.md_to_m) / 2 : null;
  const distQ = useQuery({
    queryKey: ['offset_distances', score?.wellbore_id, mid],
    queryFn: () => getOffsetDistances(score.wellbore_id, mid),
    enabled: ids.length > 0 && mid != null,
  });
  return { events: eventsQ.data ?? [], distances: distQ.data ?? {} };
}

/** wellbore_id -> bit depth for every visible stream (used to say "~N m ahead" on any screen). */
export function useBitDepths(enabled = true) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['stream_state', 'all'], queryFn: listStreamStates, enabled });
  useEffect(() => {
    if (!enabled) return undefined;
    return subscribe('stream_state', undefined, (payload) => {
      const row = payload.new;
      if (!row?.wellbore_id) return;
      qc.setQueryData(riskKeys.stream(row.wellbore_id), row);
      qc.setQueryData(['stream_state', 'all'], (old) => {
        if (!old) return old;
        const idx = old.findIndex((s) => s.wellbore_id === row.wellbore_id);
        if (idx < 0) return [...old, row];
        const next = [...old];
        next[idx] = row;
        return next;
      });
    });
  }, [enabled, qc]);
  return useMemo(() => Object.fromEntries((query.data || []).map((s) => [s.wellbore_id, s.bit_md_m])), [query.data]);
}
