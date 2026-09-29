import React from 'react';
import { Link } from 'react-router-dom';
import { StreamStatusPill } from './StreamStatusPill';
import { ProvenanceBadge } from '../wells/ProvenanceBadge';
import { fmtDepth } from '../../lib/units';
import { useProfile } from '../auth/useProfile';

const RIG_ROLES = ['rig_engineer', 'rtoc_engineer', 'admin'];

export function WellHeader({ well, streamState, formation }) {
  const { profile } = useProfile();
  const canViewRig = RIG_ROLES.includes(profile?.role);

  return (
    <div className="flex items-center justify-between border-b border-gray-800/60 bg-[#0B0F19] px-6 py-5">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-medium tracking-tight text-white">{well?.well_name || 'Loading…'}</h1>
          <ProvenanceBadge provenance={well?.provenance} />
          <StreamStatusPill status={streamState?.status || 'stopped'} lastSampleAt={streamState?.last_sample_at} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-6 text-sm text-gray-400">
          <span className="flex items-center gap-2"><span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Field</span> <span className="text-gray-200">{well?.field || '-'}</span></span>
          <span className="flex items-center gap-2" data-testid="header-bit"><span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Bit</span> <span className="font-mono text-gray-200">{fmtDepth(streamState?.bit_md_m)}</span></span>
          <span className="flex items-center gap-2" data-testid="header-formation"><span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Formation</span> <span className="text-gray-200">{formation?.formation || '-'}</span></span>
        </div>
      </div>
      <div>
        {canViewRig && well && (
          <Link
            to={`/rig/${well.wellbore_id}`}
            className="rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700"
          >
            Open rig view
          </Link>
        )}
      </div>
    </div>
  );
}
