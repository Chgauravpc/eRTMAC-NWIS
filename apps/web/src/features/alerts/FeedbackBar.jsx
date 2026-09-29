import React, { useState } from 'react';
import { canRate } from './permissions';
import { rateAlert } from '../../lib/data/alerts';
import { Button } from '../../components/ui/Primitives';

export function FeedbackBar({ alert, user }) {
  const [rated, setRated] = useState(alert.feedback_useful != null);
  const [error, setError] = useState('');

  if (!canRate(user, alert)) return null;

  const handleRate = async (useful) => {
    try {
      await rateAlert(alert.id, useful);
      setRated(true);
    } catch (e) {
      setError(e.message);
    }
  };

  if (rated) {
    return (
      <div className="mt-4 bg-gray-50 border border-gray-200 p-3 rounded-lg text-sm text-gray-600 italic text-center">
        Thank you for providing feedback! This helps tune the ML models.
      </div>
    );
  }

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-6 flex flex-col md:flex-row items-center justify-between gap-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-xl">📊</span>
        <div>
          <span className="font-bold text-blue-900 block">Was this alert useful?</span>
          <span className="text-xs text-blue-700">Your feedback trains the detection engine.</span>
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" className="bg-white hover:bg-green-50 border-green-200 text-green-700" onClick={() => handleRate(true)}>Yes, Helpful</Button>
        <Button variant="outline" className="bg-white hover:bg-red-50 border-red-200 text-red-700" onClick={() => handleRate(false)}>No, False Alarm</Button>
      </div>
      {error && <span className="text-red-600 text-sm font-medium w-full text-center">{error}</span>}
    </div>
  );
}
