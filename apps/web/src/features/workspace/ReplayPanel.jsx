import React, { useState } from 'react';
import { useProfile } from '../auth/useProfile';
import { Button, Card, Spinner } from '../../components/ui/Primitives';
import { apiFetch } from '../../lib/api';

// A demo pace: the hidden hazard of a drilling well is 100-200 m below its start depth.
const START_SPEED = 300;

export function ReplayPanel({ wellboreId, streamState, source = 'synthetic' }) {
  const { profile } = useProfile();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!profile || !['rtoc_engineer', 'admin'].includes(profile.role)) {
    return null;
  }

  const status = streamState?.status || 'stopped';
  const currentSpeed = streamState?.speed || 1;

  const handleStart = async () => {
    setLoading(true);
    setError(null);
    try {
      await apiFetch('/api/stream/start', {
        method: 'POST',
        body: JSON.stringify({ wellbore_id: wellboreId, source, speed: START_SPEED, start_md_m: null }),
      });
    } catch (e) {
      console.error('Failed to start stream', e);
      setError(e?.message || 'The replay could not be started.');
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      await apiFetch('/api/stream/stop', { 
        method: 'POST', 
        body: JSON.stringify({ wellbore_id: wellboreId }) 
      });
    } catch (e) {
      console.error('Failed to stop stream', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSpeed = async (e) => {
    const speed = parseInt(e.target.value, 10);
    setLoading(true);
    try {
      await apiFetch('/api/stream/speed', { 
        method: 'POST', 
        body: JSON.stringify({ wellbore_id: wellboreId, speed }) 
      });
    } catch (e) {
      console.error('Failed to set speed', e);
    } finally {
      setLoading(false);
    }
  };

  const handleDrop = async () => {
    setLoading(true);
    try {
      await apiFetch('/api/stream/drop', { 
        method: 'POST', 
        body: JSON.stringify({ wellbore_id: wellboreId, seconds: 45 }) 
      });
    } catch (e) {
      console.error('Failed to drop connection', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="flex items-center gap-4 p-3 bg-gray-50 border-gray-200 mt-4 mb-4">
      <span className="text-sm font-medium text-gray-700">Replay Controls</span>
      
      <Button 
        variant="primary" 
        onClick={handleStart} 
        disabled={loading || status !== 'stopped'}
      >
        Start
      </Button>
      
      <Button 
        variant="outline" 
        onClick={handleStop} 
        disabled={loading || status === 'stopped'}
      >
        Stop
      </Button>
      
      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-600">Speed</label>
        <select 
          className="border border-gray-300 rounded px-2 py-1 text-sm disabled:opacity-50"
          value={currentSpeed}
          onChange={handleSpeed}
          disabled={loading || status === 'stopped'}
        >
          <option value={1}>1x</option>
          <option value={10}>10x</option>
          <option value={60}>60x</option>
          <option value={300}>300x</option>
          <option value={600}>600x</option>
        </select>
      </div>

      <Button 
        variant="secondary" 
        onClick={handleDrop} 
        disabled={loading || status === 'stopped'}
        title="Simulate connection drop for 45 seconds"
      >
        Drop 45s
      </Button>

      {error && <span role="alert" className="text-sm text-red-700">{error}</span>}
      {loading && <Spinner className="w-4 h-4 ml-auto" />}
    </Card>
  );
}
