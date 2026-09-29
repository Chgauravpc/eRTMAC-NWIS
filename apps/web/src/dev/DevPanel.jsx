import React from 'react';
import { db } from '../mocks/db';

export function DevPanel() {
  if (import.meta.env.VITE_USE_MOCKS !== 'true') return null;

  const emitAlert = (severity) => {
    const newAlert = {
      id: crypto.randomUUID(),
      wellbore_id: 'mock-wellbore-id',
      kind: 'detector',
      severity,
      state: 'generated',
      title: `Mock ${severity} Alert`,
      message: 'Generated via DevPanel',
      created_at: new Date().toISOString()
    };
    db.alerts.push(newAlert);
    db.emitChange('alerts', newAlert);
  };

  const advanceBit = () => {
    const stream = db.stream_state[0];
    if (stream) {
      stream.bit_md_m += 5;
      db.emitChange('stream_state', stream);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 bg-gray-900 text-white p-4 rounded-lg shadow-xl z-50 opacity-90 text-sm">
      <h3 className="font-bold mb-2">Dev Panel (Mocks)</h3>
      <div className="flex flex-col gap-2">
        <button onClick={() => emitAlert('warning')} className="bg-orange-600 px-2 py-1 rounded">Emit Warning Alert</button>
        <button onClick={() => emitAlert('critical')} className="bg-red-600 px-2 py-1 rounded">Emit Critical Alert</button>
        <button onClick={advanceBit} className="bg-blue-600 px-2 py-1 rounded">Advance Bit 5m</button>
      </div>
    </div>
  );
}
