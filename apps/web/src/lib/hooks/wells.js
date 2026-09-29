// TanStack Query hooks for the wells / workspace / map / correlation screens.
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { subscribe } from '../realtime';
import {
  getWellSummaries,
  getWellSummary,
  getStreamStates,
  getStreamState,
  getOpenAlertCounts,
  getFormationAtMd,
  getFormationTops,
  getHoleSections,
  getFormations,
  getLessons,
  predictTops,
  getCorrelation,
  sortDrillingFirst,
} from '../data/wells';
import { getOffsets, getTrajectories, getSurveyStations, getWellPositionAtMd } from '../data/geo';
import { getEventsForOffsets, getWellEvents } from '../data/events';

export function useWells() {
  return useQuery({
    queryKey: ['wells'],
    queryFn: async () => sortDrillingFirst(await getWellSummaries()),
  });
}

export function useWellSummary(wellboreId) {
  return useQuery({
    queryKey: ['wellSummary', wellboreId],
    queryFn: () => getWellSummary(wellboreId),
    enabled: !!wellboreId,
  });
}

/** stream_state for one wellbore, kept live through Realtime (`live: false` = read only). */
export function useStreamState(wellboreId, { live = true } = {}) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!live || !wellboreId) return undefined;
    return subscribe('stream_state', `wellbore_id=eq.${wellboreId}`, (payload) => {
      // copy: the mock bus re-emits the same mutated object, and React bails out on identical refs
      if (payload?.new) qc.setQueryData(['streamState', wellboreId], { ...payload.new });
    });
  }, [qc, wellboreId, live]);
  return useQuery({
    queryKey: ['streamState', wellboreId],
    queryFn: () => getStreamState(wellboreId),
    enabled: !!wellboreId,
  });
}

/** All stream_state rows keyed by wellbore id, live. */
export function useStreamStates() {
  const qc = useQueryClient();
  useEffect(
    () =>
      subscribe('stream_state', undefined, (payload) => {
        const row = payload?.new;
        if (!row) return;
        qc.setQueryData(['streamStates'], (prev) => ({ ...(prev || {}), [row.wellbore_id]: { ...row } }));
        qc.setQueryData(['streamState', row.wellbore_id], { ...row });
      }),
    [qc],
  );
  return useQuery({
    queryKey: ['streamStates'],
    queryFn: async () => Object.fromEntries((await getStreamStates()).map((s) => [s.wellbore_id, s])),
  });
}

/** Open alert counts by wellbore and severity, refreshed on any alert change. */
export function useOpenAlertCounts() {
  const qc = useQueryClient();
  useEffect(() => subscribe('alerts', undefined, () => qc.invalidateQueries({ queryKey: ['openAlertCounts'] })), [qc]);
  return useQuery({ queryKey: ['openAlertCounts'], queryFn: getOpenAlertCounts });
}

export function useFormationAtMd(wellboreId, md) {
  return useQuery({
    queryKey: ['formation_at_md', wellboreId, md],
    queryFn: () => getFormationAtMd(wellboreId, md),
    enabled: !!wellboreId && md != null,
    placeholderData: keepPreviousData,
  });
}

export function useFormationTops(wellboreId) {
  return useQuery({
    queryKey: ['formationTops', wellboreId],
    queryFn: () => getFormationTops(wellboreId),
    enabled: !!wellboreId,
  });
}

export function useHoleSections(wellboreId) {
  return useQuery({
    queryKey: ['holeSections', wellboreId],
    queryFn: () => getHoleSections(wellboreId),
    enabled: !!wellboreId,
  });
}

export function useFormations() {
  return useQuery({ queryKey: ['formations'], queryFn: getFormations, staleTime: 5 * 60_000 });
}

export function useLessons(formations, enabled = true) {
  return useQuery({
    queryKey: ['lessons', formations],
    queryFn: () => getLessons(formations),
    enabled,
  });
}

/** Offsets for the map / correlation picker. Previous data is kept while a new radius/depth loads. */
export function useOffsets(wellboreId, radiusM, md, mode) {
  return useQuery({
    queryKey: ['offsets', wellboreId, radiusM, md, mode],
    queryFn: () => getOffsets(wellboreId, radiusM, md, mode),
    enabled: !!wellboreId && radiusM != null,
    placeholderData: keepPreviousData,
  });
}

export function useTrajectories() {
  return useQuery({ queryKey: ['trajectories'], queryFn: getTrajectories, staleTime: 5 * 60_000 });
}

export function useSurveyStations(wellboreIds, enabled = true) {
  const key = [...(wellboreIds || [])].sort().join(',');
  return useQuery({
    queryKey: ['surveyStations', key],
    queryFn: () => getSurveyStations(wellboreIds),
    enabled: enabled && !!key,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useWellPositionAtMd(wellboreId, md, enabled = true) {
  return useQuery({
    queryKey: ['wellPosition', wellboreId, md],
    queryFn: () => getWellPositionAtMd(wellboreId, md),
    enabled: enabled && !!wellboreId && md != null,
    placeholderData: keepPreviousData,
  });
}

/** Events of the offsets (RPC events_for_offsets), optionally limited to formations. */
export function useEventsForOffsets(wellboreId, radiusM, formations, { limit = 200, enabled = true } = {}) {
  return useQuery({
    queryKey: ['eventsForOffsets', wellboreId, radiusM, formations, limit],
    queryFn: () => getEventsForOffsets(wellboreId, radiusM, formations, limit),
    enabled: enabled && !!wellboreId && radiusM != null,
    placeholderData: keepPreviousData,
  });
}

export function useWellEvents(wellboreId, enabled = true) {
  return useQuery({
    queryKey: ['wellEvents', wellboreId],
    queryFn: () => getWellEvents(wellboreId),
    enabled: enabled && !!wellboreId,
  });
}

export function usePredictTops(wellboreId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (radiusM) => predictTops(wellboreId, radiusM),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['formationTops', wellboreId] });
      qc.invalidateQueries({ queryKey: ['formation_at_md', wellboreId] });
      qc.invalidateQueries({ queryKey: ['correlation'] });
    },
  });
}

export function useCorrelation(wellboreId, params, enabled = true) {
  return useQuery({
    queryKey: ['correlation', wellboreId, params],
    queryFn: () => getCorrelation(wellboreId, params),
    enabled: enabled && !!wellboreId && (params?.offsets?.length ?? 0) > 0,
    placeholderData: keepPreviousData,
  });
}
