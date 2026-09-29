import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { subscribe } from '../../lib/realtime';
import { DepthPanel } from './DepthPanel';
import { FormationPanel } from './FormationPanel';
import { RiskGauges } from './RiskGauges';
import { LessonsPanel } from './LessonsPanel';

// Temporary placeholder for alert banner (will be fulfilled in FE-09)
const AlertBannerPlaceholder = () => (
  <div className="bg-red-600 text-white p-4 font-bold text-center cursor-pointer uppercase tracking-wider shadow-lg z-50">
    ⚠️ [Placeholder] Active Alert Banner - Tap to open
  </div>
);

export function RigView() {
  const { wellboreId } = useParams();
  const [streamState, setStreamState] = useState(null);
  const [scores, setScores] = useState([]);
  const [currentFormation, setCurrentFormation] = useState(null);
  const [nextFormation, setNextFormation] = useState(null);

  // Request Wake Lock for tablets
  useEffect(() => {
    let wakeLock = null;
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen');
        }
      } catch (err) {
        console.warn('Wake Lock request failed:', err);
      }
    };
    requestWakeLock();
    
    const handleVisibilityChange = () => {
      if (wakeLock !== null && document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (wakeLock) wakeLock.release();
    };
  }, []);

  useEffect(() => {
    supabase.from('stream_state').select('*').eq('wellbore_id', wellboreId).single()
      .then(({ data }) => setStreamState(data));

    supabase.from('risk_scores').select('*').eq('wellbore_id', wellboreId)
      .then(({ data }) => setScores(data || []));

    const unsubStream = subscribe('stream_state', `wellbore_id=eq.${wellboreId}`, (payload) => {
      setStreamState(payload.new);
    });

    const unsubScores = subscribe('risk_scores', `wellbore_id=eq.${wellboreId}`, (payload) => {
      setScores(prev => {
        const next = [...prev];
        const idx = next.findIndex(s => s.risk_type === payload.new.risk_type && s.md_from_m === payload.new.md_from_m);
        if (idx >= 0) next[idx] = payload.new;
        else next.push(payload.new);
        return next;
      });
    });

    return () => {
      unsubStream();
      unsubScores();
    };
  }, [wellboreId]);

  useEffect(() => {
    if (streamState?.bit_md_m != null) {
      supabase.rpc('formation_at_md', { p_wellbore_id: wellboreId, p_md_m: streamState.bit_md_m })
        .then(({ data }) => {
          if (data && data.length > 0) {
            setCurrentFormation(data[0].formation);
            setNextFormation(data[0].next_formation);
          }
        });
    }
  }, [wellboreId, streamState?.bit_md_m]);

  return (
    <div className="rig bg-gray-900 min-h-screen text-gray-100 flex flex-col font-sans select-none">
      <AlertBannerPlaceholder />
      
      {/* Top Header / Exit */}
      <div className="px-6 py-4 flex justify-between items-center border-b border-gray-800">
        <h1 className="text-2xl font-black tracking-widest text-blue-500 uppercase">NWIS RIG VIEW</h1>
        <Link to={`/wells/${wellboreId}/map`} className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-6 py-3 rounded-lg font-bold uppercase tracking-wider text-sm transition-colors border border-gray-700">
          Exit to Office Workspace
        </Link>
      </div>

      <div className="flex-1 p-4 md:p-6 overflow-y-auto">
        <div className="max-w-7xl mx-auto space-y-6">
          <DepthPanel streamState={streamState} />
          
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            <div className="lg:col-span-1">
              <FormationPanel wellboreId={wellboreId} bitMd={streamState?.bit_md_m} />
            </div>
            <div className="lg:col-span-3">
              <RiskGauges scores={scores} />
            </div>
          </div>
          
          <LessonsPanel formation={currentFormation} nextFormation={nextFormation} />
        </div>
      </div>
    </div>
  );
}
