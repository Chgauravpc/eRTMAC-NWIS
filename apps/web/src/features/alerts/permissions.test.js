import { describe, it, expect } from 'vitest';
import { ALERT_SEVERITIES, ALERT_STATES, USER_ROLES } from '../../lib/constants';
import { canAcknowledge, canDismiss, canRate, canResolve, canView } from './permissions';

// Contract §12 permission table, written as data (rows) and expanded over the full
// role x state x severity grid, so every cell of the grid is asserted.
const WELL = 'wb-1';
const OTHER_WELL = 'wb-2';

const ACTORS = {
  rig_assigned: { id: 'u-rig', role: 'rig_engineer', assigned_wellbore_ids: [WELL] },
  rig_other_well: { id: 'u-rig2', role: 'rig_engineer', assigned_wellbore_ids: [OTHER_WELL] },
  rtoc_engineer: { id: 'u-rtoc', role: 'rtoc_engineer', assigned_wellbore_ids: [] },
  office_engineer: { id: 'u-office', role: 'office_engineer', assigned_wellbore_ids: [] },
  reviewer: { id: 'u-rev', role: 'reviewer', assigned_wellbore_ids: [] },
  admin: { id: 'u-admin', role: 'admin', assigned_wellbore_ids: [] },
};

const ALL = { severities: ALERT_SEVERITIES, states: ALERT_STATES };
const LOW = ['info', 'watch'];
const HIGH = ['warning', 'critical'];

/** row = { who: actor keys, states, severities } ; allowed iff some row matches. */
const RULES = {
  acknowledge: [{ who: ['rig_assigned', 'rtoc_engineer', 'admin'], states: ['sent', 'viewed', 'escalated'], severities: ALL.severities }],
  resolve: [
    { who: ['rtoc_engineer', 'admin'], states: ['acknowledged'], severities: HIGH },
    { who: ['rtoc_engineer', 'admin', 'rig_assigned'], states: ['sent', 'viewed', 'acknowledged'], severities: LOW },
  ],
  dismiss: [{ who: ['rig_assigned', 'rtoc_engineer', 'admin'], states: ['sent', 'viewed'], severities: LOW }],
  // rate: "the resolver, or any rig/rtoc engineer on that well" (+ admin, see 0008_alert_rpcs.sql)
  rate: [{ who: ['rig_assigned', 'rtoc_engineer', 'admin'], states: ['resolved'], severities: ALL.severities }],
};

const FN = { acknowledge: canAcknowledge, resolve: canResolve, dismiss: canDismiss, rate: canRate };

const expected = (action, actorKey, state, severity) =>
  RULES[action].some((r) => r.who.includes(actorKey) && r.states.includes(state) && r.severities.includes(severity));

const alertOf = (state, severity, extra = {}) => ({ id: 'a1', wellbore_id: WELL, state, severity, ...extra });

describe('contract §12 permission table (full role x state x severity grid)', () => {
  for (const action of Object.keys(RULES)) {
    describe(action, () => {
      for (const [key, user] of Object.entries(ACTORS)) {
        it.each(ALERT_STATES.flatMap((state) => ALERT_SEVERITIES.map((sev) => [state, sev])))(
          `${key}: state=%s severity=%s`,
          (state, severity) => {
            expect(FN[action](user, alertOf(state, severity))).toBe(expected(action, key, state, severity));
          }
        );
      }
    });
  }

  it('the grid covers every enum value in the contract', () => {
    expect(Object.keys(ACTORS).length).toBeGreaterThanOrEqual(USER_ROLES.length);
    expect(ALERT_STATES).toHaveLength(7);
    expect(ALERT_SEVERITIES).toHaveLength(4);
  });
});

describe('specific §12 rules', () => {
  it('escalated alerts can be acknowledged but never resolved directly', () => {
    for (const sev of ALERT_SEVERITIES) {
      expect(canAcknowledge(ACTORS.rtoc_engineer, alertOf('escalated', sev))).toBe(true);
      expect(canResolve(ACTORS.rtoc_engineer, alertOf('escalated', sev))).toBe(false);
      expect(canResolve(ACTORS.admin, alertOf('escalated', sev))).toBe(false);
    }
  });

  it('generated alerts have no lifecycle action yet (backend sends them first)', () => {
    for (const sev of ALERT_SEVERITIES) {
      const a = alertOf('generated', sev);
      expect([canAcknowledge, canResolve, canDismiss, canRate].some((f) => f(ACTORS.admin, a))).toBe(false);
    }
  });

  it('dismiss is never offered for warning/critical', () => {
    for (const state of ALERT_STATES) {
      for (const sev of HIGH) expect(canDismiss(ACTORS.admin, alertOf(state, sev))).toBe(false);
    }
  });

  it('feedback only after resolved (not before, not after feedback was given)', () => {
    for (const state of ALERT_STATES.filter((s) => s !== 'resolved')) {
      expect(canRate(ACTORS.rtoc_engineer, alertOf(state, 'warning'))).toBe(false);
    }
    expect(canRate(ACTORS.rtoc_engineer, alertOf('resolved', 'warning'))).toBe(true);
  });

  it('the resolver may rate even without a rig/rtoc role', () => {
    const a = alertOf('resolved', 'warning', { resolved_by: ACTORS.office_engineer.id });
    expect(canRate(ACTORS.office_engineer, a)).toBe(true);
    expect(canRate(ACTORS.reviewer, a)).toBe(false);
  });

  it('rig engineers see only assigned wells; others see all', () => {
    expect(canView(ACTORS.rig_assigned, alertOf('sent', 'info'))).toBe(true);
    expect(canView(ACTORS.rig_other_well, alertOf('sent', 'info'))).toBe(false);
    expect(canView(ACTORS.office_engineer, alertOf('sent', 'info'))).toBe(true);
  });

  it('missing user or alert is denied', () => {
    for (const f of [canAcknowledge, canResolve, canDismiss, canRate, canView]) {
      expect(f(null, alertOf('sent', 'info'))).toBe(false);
      expect(f(ACTORS.admin, null)).toBe(false);
    }
  });
});
