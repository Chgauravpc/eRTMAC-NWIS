import React from 'react';
import { AlertOctagon, CircleDot, PauseCircle, WifiOff } from 'lucide-react';
import { fmtDepth, fmtTimeAgo, fmtTorque, fmtVolume } from '../../lib/units';
import { useNow } from '../../lib/hooks/alerts';

const num = (v, digits = 1) => (v == null ? '-' : Number(v).toFixed(digits));
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString() : 'an unknown time');

function Metric({ label, value }) {
  return (
    <div className="min-h-[72px] rounded-lg border border-white/30 p-3 text-center">
      <div className="text-lg font-semibold uppercase tracking-wide text-gray-300">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

const STATUS = {
  live: { Icon: CircleDot, word: 'Live', tone: 'text-white' },
  stale: { Icon: PauseCircle, word: 'Stale', tone: 'text-amber-300' },
  stopped: { Icon: PauseCircle, word: 'Stopped', tone: 'text-gray-300' },
  lost: { Icon: WifiOff, word: 'Lost', tone: 'text-white' },
};

/** Bit depth (huge), hole depth, ROP, torque, flow in/out, pit volume, stream status + last data. */
export function DepthPanel({ streamState }) {
  useNow(1000); // keeps "last data ... ago" honest

  if (!streamState) {
    return (
      <section aria-label="Depth" className="rounded-lg border border-white/30 p-6 text-center text-xl font-semibold">
        Waiting for stream state…
      </section>
    );
  }

  const { bit_md_m, hole_md_m, status, last_sample_at, latest } = streamState;
  const st = STATUS[status] || STATUS.stopped;

  return (
    <section aria-label="Depth" className="rounded-lg border border-white/30 p-4">
      {status === 'lost' && (
        <div role="alert" className="-mx-4 -mt-4 mb-4 flex items-center gap-3 rounded-t-lg bg-red-800 px-4 py-3 text-xl font-bold text-white">
          <AlertOctagon size={28} aria-hidden="true" />
          <span>
            Live data lost at {clock(last_sample_at)}. Look-ahead from offset wells continues; live detectors paused.
          </span>
        </div>
      )}
      <div className="flex items-end justify-between gap-4 border-b border-white/30 pb-4">
        <div>
          <h2 className="text-lg font-semibold uppercase tracking-wide text-gray-300">Bit depth (MD)</h2>
          <div data-testid="bit-depth" className="text-7xl font-black tabular-nums leading-none">
            {bit_md_m != null ? Number(bit_md_m).toFixed(1) : '-'} <span className="text-4xl font-bold">m</span>
          </div>
        </div>
        <div className="text-right">
          <h2 className="text-lg font-semibold uppercase tracking-wide text-gray-300">Hole depth</h2>
          <div className="text-4xl font-bold tabular-nums">{fmtDepth(hole_md_m)}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-5 gap-3">
        <Metric label="ROP" value={latest?.rop_m_h != null ? `${num(latest.rop_m_h)} m/h` : '-'} />
        <Metric label="Torque" value={fmtTorque(latest?.torque_knm)} />
        <Metric label="Flow in" value={latest?.flow_in_lpm != null ? `${num(latest.flow_in_lpm, 0)} L/min` : '-'} />
        <Metric label="Flow out" value={latest?.flow_out_lpm != null ? `${num(latest.flow_out_lpm, 0)} L/min` : '-'} />
        <Metric label="Pit volume" value={fmtVolume(latest?.pit_vol_m3)} />
      </div>

      <div className={`mt-4 flex items-center justify-end gap-2 text-lg font-semibold ${st.tone}`}>
        <st.Icon size={20} aria-hidden="true" />
        <span>
          Stream {st.word.toLowerCase()}
          {last_sample_at ? `: last data ${fmtTimeAgo(last_sample_at)}` : ''}
        </span>
      </div>
    </section>
  );
}
