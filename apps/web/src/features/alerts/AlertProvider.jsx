import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { subscribe, onRealtimeReconnect } from '../../lib/realtime';
import { ALERT_KEYS, applyAlertChange, useOpenAlerts, useWellNames } from '../../lib/hooks/alerts';
import { useBitDepths } from '../../lib/hooks/risk';
import { useProfile } from '../auth/useProfile';
import { notificationBody, shouldNotify } from './alertUtils';
import { updateAlertSound } from './sound';
import { AlertOverlay } from './AlertOverlay';

const EMPTY = [];
const DEFAULT_CTX = {
  alerts: EMPTY,
  isLoading: false,
  wellNames: {},
  bitDepths: {},
  openAlertId: null,
  openAlert: () => {},
  closeAlert: () => {},
  notificationPermission: 'default',
  requestNotificationPermission: async () => {},
};

const AlertContext = createContext(DEFAULT_CTX);

/**
 * App-wide alert state. The open-alert list lives in ONE TanStack cache entry (fed by v_open_alerts and
 * Realtime) so /alerts, the well tab, the banner and the rig view all read the same list. Side effects
 * (sound, notifications) are driven from effects and event handlers, never from state updaters.
 */
export function AlertProvider({ children }) {
  const { profile } = useProfile();
  const qc = useQueryClient();
  const openQ = useOpenAlerts(profile);
  const alerts = openQ.data ?? EMPTY;
  const wellNames = useWellNames();
  const bitDepths = useBitDepths(!!profile);
  const [openAlertId, setOpenAlertId] = useState(null);
  const [openSeed, setOpenSeed] = useState(null);
  const [permission, setPermission] = useState(() => (typeof Notification !== 'undefined' ? Notification.permission : 'denied'));

  const notified = useRef(new Map()); // alert id -> sent_at we already notified for
  const live = useRef({});
  live.current = { wellNames, bitDepths, permission };

  const openAlert = useCallback(
    (alertOrId) => {
      const seed = typeof alertOrId === 'object' ? alertOrId : (qc.getQueryData(ALERT_KEYS.open(profile?.id)) || []).find((a) => a.id === alertOrId) || null;
      const id = typeof alertOrId === 'object' ? alertOrId.id : alertOrId;
      setOpenSeed(seed);
      setOpenAlertId(id);
    },
    [qc, profile?.id]
  );
  const closeAlert = useCallback(() => {
    setOpenAlertId(null);
    setOpenSeed(null);
  }, []);
  const openRef = useRef(openAlert);
  openRef.current = openAlert;

  const requestNotificationPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return 'denied';
    const p = await Notification.requestPermission();
    setPermission(p);
    return p;
  }, []);

  // Sound follows the list; the sound module only restarts its cadence when the level changes.
  useEffect(() => {
    updateAlertSound(alerts);
  }, [alerts]);

  const notify = useCallback((row) => {
    notified.current.set(row.id, row.sent_at ?? null);
    if (typeof Notification === 'undefined' || live.current.permission !== 'granted') return;
    const { wellNames: names, bitDepths: bits } = live.current;
    const well = names[row.wellbore_id] ?? row.well_name;
    const n = new Notification(`${row.severity === 'critical' ? 'Critical' : 'Warning'}: ${row.title}`, {
      body: notificationBody(row, well, bits[row.wellbore_id]),
      tag: row.id,
      requireInteraction: row.severity === 'critical',
    });
    n.onclick = () => {
      window.focus();
      openRef.current(row);
      if (n.close) n.close();
    };
  }, []);

  // Realtime: keep the shared cache current, then decide about notifications (outside any updater).
  const profileKey = profile ? `${profile.id}|${profile.role}|${(profile.assigned_wellbore_ids || []).join(',')}` : null;
  useEffect(() => {
    if (!profile) return undefined;
    const ids = profile.role === 'rig_engineer' ? profile.assigned_wellbore_ids || [] : [];
    const filter = ids.length > 0 ? `wellbore_id=in.(${ids.join(',')})` : undefined;
    return subscribe('alerts', filter, (payload) => {
      const deleted = payload.eventType === 'DELETE';
      const row = deleted ? payload.old : payload.new;
      if (!row?.id) return;
      const list = qc.getQueryData(ALERT_KEYS.open(profile.id));
      const prev = list?.find((a) => a.id === row.id);
      applyAlertChange(qc, row, { deleted });
      if (!deleted && list && shouldNotify(prev, row, notified.current)) notify({ ...prev, ...row });
    });
    // profileKey is the identity of the subscription
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileKey, qc, notify]);

  // PRD §9: after the connection comes back, refetch what may have been missed.
  useEffect(
    () =>
      onRealtimeReconnect(() => {
        qc.invalidateQueries({ queryKey: ALERT_KEYS.all });
        qc.invalidateQueries({ queryKey: ['stream_state'] });
        qc.invalidateQueries({ queryKey: ['risk_scores'] });
      }),
    [qc]
  );

  const value = useMemo(
    () => ({
      alerts,
      isLoading: openQ.isLoading,
      wellNames,
      bitDepths,
      openAlertId,
      openAlert,
      closeAlert,
      notificationPermission: permission,
      requestNotificationPermission,
    }),
    [alerts, openQ.isLoading, wellNames, bitDepths, openAlertId, openAlert, closeAlert, permission, requestNotificationPermission]
  );

  return (
    <AlertContext.Provider value={value}>
      {children}
      {openAlertId && <AlertOverlay alertId={openAlertId} seed={openSeed} user={profile} onClose={closeAlert} />}
    </AlertContext.Provider>
  );
}

export function useAlerts() {
  return useContext(AlertContext);
}
