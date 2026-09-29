import React, { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useDebounce } from 'use-debounce';
import { CorrelationControls } from './CorrelationControls';
import { CorrelationPlot } from './CorrelationPlot';
import {
  DEFAULT_CHANNELS,
  OFFSET_SEARCH_RADIUS_M,
  defaultFlattenFormation,
  defaultOffsetIds,
  formationsFromTops,
} from './correlationModel';
import { useCorrelation, useFormationAtMd, useFormationTops, useOffsets, useStreamState } from '../../lib/hooks/wells';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '../wells/StateBlocks';

export function CorrelationTab() {
  const { wellboreId } = useParams();
  // null = "not touched": the value is derived from the data (4 nearest offsets, next formation below the bit)
  const [picked, setPicked] = useState({ offsets: null, flatten: null, channels: [...DEFAULT_CHANNELS] });

  const streamQ = useStreamState(wellboreId, { live: false });
  const bitMd = streamQ.data?.bit_md_m ?? null;
  const offsetsQ = useOffsets(wellboreId, OFFSET_SEARCH_RADIUS_M, null, 'surface');
  const topsQ = useFormationTops(wellboreId);
  const atBitQ = useFormationAtMd(wellboreId, bitMd);

  const formations = useMemo(() => formationsFromTops(topsQ.data), [topsQ.data]);
  const defaultFlatten = useMemo(
    () => defaultFlattenFormation({ tops: topsQ.data, bitMd, next: atBitQ.data?.next_formation }),
    [topsQ.data, bitMd, atBitQ.data],
  );
  const availableOffsets = offsetsQ.data || [];
  const selectedOffsets = picked.offsets ?? defaultOffsetIds(availableOffsets);
  const flatten = picked.flatten ?? defaultFlatten;

  const ready = offsetsQ.isSuccess && topsQ.isSuccess && !streamQ.isLoading && (bitMd == null || !atBitQ.isLoading);
  const queryKey = JSON.stringify({ offsets: selectedOffsets, flatten, channels: picked.channels });
  const [debouncedKey] = useDebounce(queryKey, 300);
  const query = useMemo(() => JSON.parse(debouncedKey), [debouncedKey]);
  const corr = useCorrelation(wellboreId, query, ready);

  return (
    <div className="flex h-full flex-col gap-4 pb-4">
      <CorrelationControls
        offsets={availableOffsets}
        selectedOffsets={selectedOffsets}
        onOffsetsChange={(offsets) => setPicked((p) => ({ ...p, offsets }))}
        formations={formations}
        flatten={flatten}
        onFlattenChange={(f) => setPicked((p) => ({ ...p, flatten: f }))}
        channels={picked.channels}
        onChannelsChange={(channels) => setPicked((p) => ({ ...p, channels }))}
      />
      <div className="min-h-[600px] flex-1 overflow-hidden rounded-lg border border-gray-200 bg-white">
        {offsetsQ.error || topsQ.error ? (
          <ErrorBlock
            message="Could not load the offsets or formation tops."
            onRetry={() => {
              offsetsQ.refetch();
              topsQ.refetch();
            }}
          />
        ) : !ready || (corr.isLoading && !corr.data) ? (
          <LoadingBlock label="Loading correlation…" />
        ) : availableOffsets.length === 0 ? (
          <EmptyBlock>No offsets within {OFFSET_SEARCH_RADIUS_M / 1000} km, so there is nothing to correlate.</EmptyBlock>
        ) : selectedOffsets.length === 0 ? (
          <EmptyBlock>Select at least one offset well to correlate.</EmptyBlock>
        ) : corr.error ? (
          <ErrorBlock message="Failed to load correlation data." onRetry={() => corr.refetch()} />
        ) : corr.data ? (
          <CorrelationPlot data={corr.data} channels={query.channels} flatten={query.flatten} bitMd={bitMd} />
        ) : null}
      </div>
    </div>
  );
}

export default CorrelationTab;
