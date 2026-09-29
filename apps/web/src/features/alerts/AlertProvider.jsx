import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { subscribe } from '../../lib/realtime';
import { useProfile } from '../auth/useProfile';
import { updateAlertSound } from './sound';

const AlertContext = createContext();

export function AlertProvider({ children }) {
  const { profile } = useProfile();
  const [alerts, setAlerts] = useState([]);
  const [notificationPermission, setNotificationPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );

  const requestNotificationPermission = async () => {
    if (typeof Notification === 'undefined') return;
    const p = await Notification.requestPermission();
    setNotificationPermission(p);
  };

  useEffect(() => {
    if (!profile) return;
    
    let q = supabase.from('alerts').select('*').neq('state', 'resolved');
    if (profile.role === 'rig_engineer' && profile.assigned_wellbore_ids?.length) {
      q = q.in('wellbore_id', profile.assigned_wellbore_ids);
    }
    q.then(({ data }) => setAlerts(data || []));

    const filter = profile.role === 'rig_engineer' && profile.assigned_wellbore_ids?.length > 0 
      ? `wellbore_id=in.(${profile.assigned_wellbore_ids.join(',')})`
      : undefined;

    const unsub = subscribe('alerts', filter, (payload) => {
      const { new: newAlert, old: oldAlert, eventType } = payload;
      
      setAlerts(prev => {
        const next = [...prev];
        const idx = next.findIndex(a => a.id === (newAlert?.id || oldAlert?.id));
        
        if (eventType === 'DELETE' || (newAlert && newAlert.state === 'resolved')) {
          if (idx >= 0) next.splice(idx, 1);
        } else if (newAlert) {
          if (idx >= 0) {
            const oldA = next[idx];
            if (
              (newAlert.sent_at && newAlert.sent_at !== oldA.sent_at) || 
              (newAlert.state === 'escalated' && oldA.state !== 'escalated') ||
              (newAlert.state === 'generated' && newAlert.state !== oldA.state)
            ) {
              triggerNotification(newAlert);
            }
            next[idx] = newAlert;
          } else {
            next.push(newAlert);
            triggerNotification(newAlert);
          }
        }
        return next;
      });
    });

    return () => unsub();
  }, [profile]);

  useEffect(() => {
    const unacknowledged = alerts.filter(a => ['generated', 'sent', 'viewed', 'escalated'].includes(a.state));
    updateAlertSound(unacknowledged);
  }, [alerts]);

  const triggerNotification = (alert) => {
    if (notificationPermission !== 'granted') return;
    if (['info', 'watch'].includes(alert.severity)) return;
    
    const n = new Notification(alert.title, {
      body: `Severity: ${alert.severity}. Depth: ${alert.zone_md_from_m}m.`,
      tag: alert.id,
      requireInteraction: alert.severity === 'critical'
    });
    n.onclick = () => {
      window.focus();
    };
  };

  const val = useMemo(() => ({ alerts, notificationPermission, requestNotificationPermission }), [alerts, notificationPermission]);

  return (
    <AlertContext.Provider value={val}>
      {children}
    </AlertContext.Provider>
  );
}

export function useAlerts() {
  return useContext(AlertContext);
}
