import React, { useState } from 'react';
import { resolveAlert } from '../../lib/data/alerts';
import { Button } from '../../components/ui/Primitives';

export function ResolveDialog({ alert, onClose, onResolved }) {
  const [outcome, setOutcome] = useState('event_occurred');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleResolve = async () => {
    setIsSubmitting(true);
    try {
      await resolveAlert(alert.id, outcome, note);
      if (onResolved) onResolved();
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
        <h2 className="text-xl font-bold mb-6 text-gray-800 border-b pb-2">Resolve Alert</h2>
        
        <div className="mb-5">
          <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Outcome</label>
          <select className="w-full border border-gray-300 p-3 rounded-lg bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:outline-none" value={outcome} onChange={e => setOutcome(e.target.value)}>
            <option value="event_occurred">Event Occurred</option>
            <option value="avoided">Avoided (Mitigated)</option>
            <option value="false_alarm">False Alarm</option>
          </select>
        </div>

        <div className="mb-6">
          <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Note (Optional)</label>
          <textarea 
            className="w-full border border-gray-300 p-3 rounded-lg bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:outline-none" 
            rows={3} 
            value={note} 
            onChange={e => setNote(e.target.value)}
            placeholder="Add context to help future ML training..."
          ></textarea>
        </div>

        {error && <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg mb-6 border border-red-100">{error}</div>}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
          <Button onClick={handleResolve} disabled={isSubmitting}>Confirm Resolution</Button>
        </div>
      </div>
    </div>
  );
}
