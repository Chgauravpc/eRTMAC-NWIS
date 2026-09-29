import { describe, it, expect } from 'vitest';
import { canAcknowledge, canResolve, canDismiss, canRate } from './permissions';

describe('Alert permissions', () => {
  const admin = { id: 'a1', role: 'admin' };
  const rtoc = { id: 'r1', role: 'rtoc_engineer' };
  const rigMatch = { id: 'rg1', role: 'rig_engineer', assigned_wellbore_ids: ['w1'] };
  const rigNoMatch = { id: 'rg2', role: 'rig_engineer', assigned_wellbore_ids: ['w2'] };

  const alertSentWarn = { state: 'sent', severity: 'warning', wellbore_id: 'w1' };
  const alertViewedInfo = { state: 'viewed', severity: 'info', wellbore_id: 'w1' };
  const alertAckCrit = { state: 'acknowledged', severity: 'critical', wellbore_id: 'w1' };
  const alertResolved = { state: 'resolved', severity: 'warning', wellbore_id: 'w1', resolved_by: 'rg1' };

  it('canAcknowledge limits to correct roles and states', () => {
    expect(canAcknowledge(admin, alertSentWarn)).toBe(true);
    expect(canAcknowledge(rigMatch, alertSentWarn)).toBe(true);
    expect(canAcknowledge(rigNoMatch, alertSentWarn)).toBe(false);
    expect(canAcknowledge(admin, alertAckCrit)).toBe(false);
  });

  it('canResolve enforces severity gates for rig engineers', () => {
    expect(canResolve(admin, alertAckCrit)).toBe(true);
    expect(canResolve(admin, alertSentWarn)).toBe(false);
    expect(canResolve(rigMatch, alertViewedInfo)).toBe(true);
    expect(canResolve(rigMatch, alertAckCrit)).toBe(false);
  });

  it('canDismiss restricts to info/watch only', () => {
    expect(canDismiss(admin, alertViewedInfo)).toBe(true);
    expect(canDismiss(rigMatch, alertViewedInfo)).toBe(true);
    expect(canDismiss(rigMatch, alertSentWarn)).toBe(false);
  });

  it('canRate permits resolver or admins/assigned engineers', () => {
    expect(canRate(rigMatch, alertResolved)).toBe(true);
    expect(canRate(admin, alertResolved)).toBe(true);
    expect(canRate(rigNoMatch, alertResolved)).toBe(false);
  });
});
