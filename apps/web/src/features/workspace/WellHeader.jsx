import React from 'react';
import { Link } from 'react-router-dom';
import { StreamStatusPill } from './StreamStatusPill';
import { Badge, Button } from '../../components/ui/Primitives';
import { fmtDepth } from '../../lib/units';
import { useProfile } from '../auth/useProfile';

export function WellHeader({ well, streamState, formation }) {
  const { profile } = useProfile();
  const canViewRig = ['rig_engineer', 'rtoc_engineer', 'admin'].includes(profile?.role);

  return (
    <div className="bg-white border-b border-gray-200 p-4 flex items-center justify-between">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">{well?.well_name || 'Loading...'}</h1>
          {well?.provenance && <Badge>{well.provenance}</Badge>}
          {streamState && <StreamStatusPill status={streamState.status} lastSampleAt={streamState.last_sample_at} />}
        </div>
        <div className="text-sm text-gray-500 mt-1 flex gap-4">
          <span>Field: {well?.field || '-'}</span>
          <span>Bit: {streamState?.bit_md_m ? fmtDepth(streamState.bit_md_m) : '-'}</span>
          <span>Formation: {formation?.formation || '-'}</span>
        </div>
      </div>
      <div>
        {canViewRig && well && (
          <Link to={`/rig/${well.wellbore_id}`}>
            <Button variant="outline">Open Rig View</Button>
          </Link>
        )}
      </div>
    </div>
  );
}
