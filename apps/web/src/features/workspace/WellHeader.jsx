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
    <div className="flex items-center justify-between border-b border-gray-200 bg-white p-4">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-bold">{well?.well_name || 'Loading…'}</h1>
          <ProvenanceBadge provenance={well?.provenance} />
          <StreamStatusPill status={streamState?.status || 'stopped'} lastSampleAt={streamState?.last_sample_at} />
        </div>
        <div className="mt-1 flex flex-wrap gap-x-4 text-sm text-gray-600">
          <span>Field: {well?.field || '-'}</span>
          <span data-testid="header-bit">Bit: {fmtDepth(streamState?.bit_md_m)}</span>
          <span data-testid="header-formation">Formation: {formation?.formation || '-'}</span>
        </div>
      </div>
      <div>
        {canViewRig && well && (
          <Link
            to={`/rig/${well.wellbore_id}`}
            className="rounded border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50"
          >
            Open rig view
          </Link>
        )}
      </div>
    </div>
  );
}
