import React, { useState } from 'react';
import { dismissAlert } from '../../lib/data/alerts';
import { Button } from '../../components/ui/Primitives';

export function DismissDialog({ alert, onClose, onDismissed }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleDismiss = async () => {
    if (reason.trim().length < 5) {
      setError('Reason must be at least 5 characters.');
      return;
    }
    setIsSubmitting(true);
    try {
      await dismissAlert(alert.id, reason);
      if (onDismissed) onDismissed();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
      <div className="bg-white p-6 rounded-xl w-full max-w-md shadow-2xl">
        <h2 className="text-xl font-bold mb-6 text-red-600 border-b border-red-100 pb-2">Dismiss Alert</h2>
        
        <p className="text-sm text-gray-600 mb-5">
          Dismissing prevents this alert from escalating and marks it as irrelevant. A descriptive reason is required for auditing.
        </p>

        <div className="mb-6">
          <label htmlFor="dismiss-reason" className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Reason for dismissal <span className="text-red-500">*</span></label>
          <textarea 
            id="dismiss-reason"
            className="w-full border border-gray-300 p-3 rounded-lg bg-gray-50 focus:ring-2 focus:ring-red-500 focus:outline-none" 
            rows={3} 
            value={reason} 
            onChange={e => { setReason(e.target.value); setError(''); }}
            placeholder="Why is this info/watch alert being dismissed?"
          ></textarea>
        </div>

        {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg mb-6 border border-red-100">{error}</div>}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button className="bg-red-600 text-white hover:bg-red-700" onClick={handleDismiss} disabled={isSubmitting}>Dismiss Alert</Button>
        </div>
      </div>
    </div>
  );
}
