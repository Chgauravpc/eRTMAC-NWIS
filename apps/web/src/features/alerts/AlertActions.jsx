import React, { useState } from 'react';
import { Button } from '../../components/ui/Primitives';
import { canAcknowledge, canResolve, canDismiss } from './permissions';
import { ackAlert } from '../../lib/data/alerts';
import { ResolveDialog } from './ResolveDialog';
import { DismissDialog } from './DismissDialog';

export function AlertActions({ alert, user, onStateChange }) {
  const [error, setError] = useState('');
  const [resolveOpen, setResolveOpen] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);

  const handleAck = async () => {
    try {
      setError('');
      await ackAlert(alert.id);
      if (onStateChange) onStateChange();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="flex gap-3 items-center flex-wrap pt-4">
      {canAcknowledge(user, alert) && <Button onClick={handleAck} className="shadow-sm">Acknowledge</Button>}
      {canResolve(user, alert) && <Button variant="outline" onClick={() => setResolveOpen(true)} className="shadow-sm">Resolve</Button>}
      {canDismiss(user, alert) && <Button variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 shadow-sm" onClick={() => setDismissOpen(true)}>Dismiss</Button>}
      
      {error && <span className="text-red-600 text-sm font-medium bg-red-50 px-3 py-1 rounded ml-auto">{error}</span>}
      
      {resolveOpen && <ResolveDialog alert={alert} onClose={() => setResolveOpen(false)} onResolved={onStateChange} />}
      {dismissOpen && <DismissDialog alert={alert} onClose={() => setDismissOpen(false)} onDismissed={onStateChange} />}
    </div>
  );
}
