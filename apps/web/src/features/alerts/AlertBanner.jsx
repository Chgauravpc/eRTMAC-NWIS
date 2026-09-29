import React, { useState } from 'react';
import { useAlerts } from './AlertProvider';
import { canAcknowledge } from './permissions';
import { useProfile } from '../auth/useProfile';
import { supabase } from '../../lib/supabase';
import { BAND_META } from '../../lib/risk';
import { Button } from '../../components/ui/Primitives';
import { isSoundEnabled, setSoundEnabled } from './sound';

export function AlertBanner() {
  const { alerts, notificationPermission, requestNotificationPermission } = useAlerts();
  const { profile } = useProfile();
  const [soundEnabled, setLocalSoundEnabled] = useState(isSoundEnabled());

  const handleToggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    setLocalSoundEnabled(next);
  };

  const topAlert = alerts
    .filter(a => ['sent', 'viewed', 'escalated'].includes(a.state) && ['warning', 'critical'].includes(a.severity))
    .sort((a, b) => new Date(b.sent_at || 0) - new Date(a.sent_at || 0))[0];

  const handleAck = async (alert) => {
    try {
      await supabase.rpc('ack_alert', { p_alert: alert.id });
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <>
      {(!soundEnabled || notificationPermission === 'default') && (
        <div className="bg-gray-800 text-gray-300 px-6 py-3 flex items-center justify-between text-sm border-b border-gray-700">
          <span>Enable alert sounds and notifications to avoid missing critical risks.</span>
          <div className="flex gap-3">
            {!soundEnabled && <Button variant="outline" size="sm" onClick={handleToggleSound}>Enable Sound</Button>}
            {notificationPermission === 'default' && <Button variant="outline" size="sm" onClick={requestNotificationPermission}>Enable Notifications</Button>}
          </div>
        </div>
      )}

      {topAlert && (
        <div 
          className={`${BAND_META[topAlert.risk_band || 'critical']?.color || 'bg-red-500 text-white'} p-4 flex justify-between items-center shadow-lg font-bold text-lg`}
          aria-live={topAlert.severity === 'critical' ? 'assertive' : 'polite'}
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚠️</span>
            <span>
              {topAlert.title}
              <span className="mx-3 opacity-50">•</span>
              {topAlert.wellbore_id}
              <span className="mx-3 opacity-50">•</span>
              Zone: {topAlert.zone_md_from_m}m - {topAlert.zone_md_to_m}m
              {topAlert.state === 'escalated' && <span className="ml-4 bg-black/30 px-2 py-1 rounded text-xs uppercase tracking-wider">Escalated to RTOC Lead</span>}
            </span>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => { /* View logic implemented later */ }}>View Details</Button>
            {canAcknowledge(profile, topAlert) && (
              <Button onClick={() => handleAck(topAlert)}>Acknowledge</Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
