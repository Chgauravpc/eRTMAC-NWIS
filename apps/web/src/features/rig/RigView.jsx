import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { MonitorSmartphone } from 'lucide-react';
import { useRiskScores, useStreamState, useFormation } from '../../lib/hooks/risk';
import { useWellNames } from '../../lib/hooks/alerts';
import { scoresInWindow } from '../../lib/risk';
import { AlertBanner } from '../alerts/AlertBanner';
import { EnableSoundButton } from '../alerts/EnableSoundButton';
import { DepthPanel } from './DepthPanel';
import { FormationPanel } from './FormationPanel';
import { RiskGauges } from './RiskGauges';
import { LessonsPanel } from './LessonsPanel';
import { useWakeLock } from './useWakeLock';

/**
 * Rig view: dark high-contrast `.rig` theme, tablet-first (landscape 1024x768), body text >= 18 px,
 * touch targets >= 48 px. Everything updates through Realtime (stream_state, risk_scores, alerts).
 */
export function RigView() {
  const { wellboreId } = useParams();
  const wakeLock = useWakeLock();
  const names = useWellNames();
  const streamQ = useStreamState(wellboreId);
  const bitMd = streamQ.data?.bit_md_m ?? null;
  const scoresQ = useRiskScores(wellboreId, bitMd);
  const scores = scoresInWindow(scoresQ.data, bitMd);
  const formation = useFormation(wellboreId, bitMd);

  return (
    <div className="rig flex min-h-screen flex-col text-lg">
      <AlertBanner />

      <header className="flex items-center justify-between gap-4 border-b border-white/30 px-4 py-2">
        <h1 className="text-2xl font-black uppercase tracking-wide">
          Rig view{names[wellboreId] ? ` · ${names[wellboreId]}` : ''}
        </h1>
        <div className="flex items-center gap-3">
          <span data-testid="wake-lock" className="hidden items-center gap-1 text-lg text-gray-300 lg:inline-flex">
            <MonitorSmartphone size={20} aria-hidden="true" />
            {wakeLock === 'active' ? 'Screen kept awake' : wakeLock === 'unsupported' ? 'Screen may sleep' : 'Screen wake lock: ' + wakeLock}
          </span>
          <EnableSoundButton variant="rig" />
          <Link
            to={`/wells/${wellboreId}/map`}
            className="inline-flex min-h-[48px] min-w-[48px] items-center rounded-lg border-2 border-white px-4 text-lg font-semibold"
          >
            Office workspace
          </Link>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-3 p-3">
        {streamQ.isError && (
          <div role="alert" className="rounded border-2 border-white p-3 text-lg font-semibold">
            Could not load the live stream state. Retrying…
          </div>
        )}
        <DepthPanel streamState={streamQ.data} />
        <div className="grid grid-cols-4 gap-3">
          <div className="col-span-1">
            <FormationPanel wellboreId={wellboreId} bitMd={bitMd} />
          </div>
          <div className="col-span-3">
            <RiskGauges scores={scores} bitMd={bitMd} />
          </div>
        </div>
        <LessonsPanel formation={formation.data?.formation} nextFormation={formation.data?.next_formation} />
      </main>
    </div>
  );
}

export default RigView;
