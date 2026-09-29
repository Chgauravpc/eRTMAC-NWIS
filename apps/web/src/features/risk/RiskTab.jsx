import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { subscribe } from '../../lib/realtime';
import { api } from '../../lib/api';
import { Button, Spinner } from '../../components/ui/Primitives';
import { RiskStrip } from './RiskStrip';
import { IntervalDetail } from './IntervalDetail';
import { BandLegend } from './BandLegend';

export function RiskTab() {
  const { wellboreId } = useParams();
  const [streamState, setStreamState] = useState(null);
  const [scores, setScores] = useState([]);
  const [selectedCell, setSelectedCell] = useState(null);
  const [isRecomputing, setIsRecomputing] = useState(false);

  useEffect(() => {
    supabase.from('stream_state').select('bit_md_m').eq('wellbore_id', wellboreId).single()
      .then(({ data }) => setStreamState(data));

    supabase.from('risk_scores').select('*').eq('wellbore_id', wellboreId)
      .then(({ data }) => setScores(data || []));

    const unsubScores = subscribe('risk_scores', `wellbore_id=eq.${wellboreId}`, (payload) => {
      setScores(prev => {
        const next = [...prev];
        const idx = next.findIndex(s => s.risk_type === payload.new.risk_type && s.md_from_m === payload.new.md_from_m);
        if (idx >= 0) next[idx] = payload.new;
        else next.push(payload.new);
        return next;
      });
    });

    const unsubStream = subscribe('stream_state', `wellbore_id=eq.${wellboreId}`, (payload) => {
      setStreamState(payload.new);
    });

    return () => {
      unsubScores();
      unsubStream();
    };
  }, [wellboreId]);

  const handleRecompute = async () => {
    setIsRecomputing(true);
    try {
      await api.post(`/api/wells/${wellboreId}/risk`);
      const { data } = await supabase.from('risk_scores').select('*').eq('wellbore_id', wellboreId);
      if (data) setScores(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsRecomputing(false);
    }
  };

  const bitMd = streamState?.bit_md_m;

  return (
    <div className="flex flex-col h-full gap-4 pb-4">
      <div className="flex justify-between items-center bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
        <p className="text-sm text-gray-700 font-medium">
          <strong>Score = </strong> estimated chance (%) that this happens in the interval, from offset wells, the ML model and live data.
        </p>
        <Button onClick={handleRecompute} disabled={isRecomputing || bitMd == null}>
          {isRecomputing ? <Spinner className="w-4 h-4 mr-2" /> : null}
          Recompute Risk
        </Button>
      </div>

      {bitMd != null ? (
        <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm overflow-hidden flex flex-col gap-4">
          <RiskStrip 
            bitMd={bitMd} 
            scores={scores} 
            selectedCell={selectedCell} 
            onSelectCell={setSelectedCell} 
          />
          <BandLegend />
        </div>
      ) : (
        <div className="bg-white p-10 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 shadow-sm">
          Waiting for stream state to resolve current bit depth...
        </div>
      )}

      <div>
        <IntervalDetail score={selectedCell} />
      </div>
    </div>
  );
}
