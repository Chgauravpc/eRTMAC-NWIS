import React from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { AlertProvider, useAlerts } from './AlertProvider';
import { AlertBanner } from './AlertBanner';
import { AlertCard } from './AlertCard';
import { AlertsPage } from './AlertsPage';
import { WellAlertsTab, summarizeHistory } from './WellAlertsTab';
import { buildTimeline } from './AlertCard';
import { EvidencePanel } from './EvidencePanel';
import { aheadMeters, depthPhrase, fmtAge, notificationBody, shouldNotify } from './alertUtils';
import { getActiveSoundLevel } from './sound';
import { enableSound, disableSound } from './sound';
import { useProfile } from '../auth/useProfile';
import { db } from '../../mocks/db';
import { mockCreateAlert, mockViewsFor } from '../../mocks/handlers/alerts';
import { ACTIVE_WELLBORE_ID } from '../../mocks/ids';
import { useAlert } from '../../lib/hooks/alerts';
import { setMockConnection } from '../../lib/realtime';
import { clone, createServer, installFakeNotification, installRelativeFetch, makeProfile, renderApp, resetMockState } from '../../dev/testHarness';

vi.mock('../auth/useProfile', () => ({ useProfile: vi.fn() }));

const server = createServer();
let restoreFetch;
const requests = [];

const AL = (n) => `00000000-0000-4000-b000-${String(n).padStart(12, '0')}`;
const WARN_SENT = AL(1);
const WATCH_VIEWED = AL(2);
const CRIT_ACKED = AL(3);
const INFO_GENERATED = AL(4);
const RESOLVED = AL(5);
const FEEDBACK = AL(6);

beforeAll(() => {
  vi.stubEnv('VITE_USE_MOCKS', 'true');
  server.listen({ onUnhandledRequest: 'bypass' });
  server.events.on('request:start', ({ request }) => requests.push({ method: request.method, url: request.url }));
  restoreFetch = installRelativeFetch();
});
afterAll(() => {
  restoreFetch();
  server.close();
  vi.unstubAllEnvs();
});

function as(role) {
  localStorage.setItem('nwis_mock_role', role);
  const profile = makeProfile(role);
  useProfile.mockReturnValue({ profile, session: { user: {} }, isLoading: false });
  return profile;
}

beforeEach(() => {
  resetMockState();
  requests.length = 0;
  as('rtoc_engineer');
});
afterEach(() => {
  server.resetHandlers();
  disableSound();
  localStorage.clear();
});

const withProvider = (ui, opts) => renderApp(<AlertProvider>{ui}</AlertProvider>, opts);

/** The card always reads the live alert (like AlertOverlay does). */
function LiveCard({ id, user }) {
  const { data } = useAlert(id, db.getAlert(id));
  return data ? <AlertCard alert={data} user={user} /> : null;
}

const insertCritical = (extra = {}) =>
  act(() => {
    mockCreateAlert({ kind: 'detector', severity: 'critical', title: 'Pit gain detected', risk_type: 'kick', ...extra }, { sendAfterMs: null });
  });

// ------------------------------------------------------------------------------------- utils
describe('alertUtils', () => {
  it('aheadMeters / depthPhrase say "~N m ahead", "at the bit" or fall back to the depth', () => {
    const a = { kind: 'lookahead', expected_md_m: 2460, zone_md_from_m: 2450 };
    expect(aheadMeters(a, 2405)).toBe(55);
    expect(depthPhrase(a, 2405)).toBe('~55 m ahead');
    expect(depthPhrase(a, 2460)).toBe('at the bit');
    expect(depthPhrase(a, undefined)).toBe('at 2460 m');
    expect(depthPhrase({ kind: 'system' }, 2405)).toBe('');
  });

  it('notification body names the well and the depth', () => {
    const body = notificationBody({ kind: 'lookahead', expected_md_m: 2460 }, 'SYN-DLJ-03', 2405);
    expect(body).toContain('SYN-DLJ-03');
    expect(body).toContain('~55 m ahead');
    expect(body).toContain('2460 m MD');
  });

  it('fmtAge counts mm:ss then hours', () => {
    const now = Date.parse('2026-01-01T01:00:00Z');
    expect(fmtAge('2026-01-01T00:59:15Z', now)).toBe('00:45');
    expect(fmtAge('2026-01-01T00:00:00Z', now)).toBe('1h 00m');
  });

  it('shouldNotify: new or re-notified (sent_at changed) warning/critical only', () => {
    const notified = new Map();
    const base = { id: 'a', severity: 'critical', state: 'sent', sent_at: 't1', escalated_at: null };
    expect(shouldNotify(undefined, base, notified)).toBe(true); // new
    expect(shouldNotify(undefined, { ...base, severity: 'info' }, notified)).toBe(false);
    expect(shouldNotify(undefined, { ...base, state: 'acknowledged' }, notified)).toBe(false);
    expect(shouldNotify(base, { ...base }, notified)).toBe(false); // unrelated update
    expect(shouldNotify(base, { ...base, sent_at: 't2' }, notified)).toBe(true); // re-notified
    expect(shouldNotify(base, { ...base, escalated_at: 't3', state: 'escalated' }, notified)).toBe(true);
    // generated -> sent for an alert we already announced on insert: no duplicate
    notified.set('a', null);
    expect(shouldNotify({ ...base, sent_at: null, state: 'generated' }, base, notified)).toBe(false);
  });
});

// ------------------------------------------------------------------------------------- banner
describe('AlertBanner', () => {
  it('shows title, well NAME and "~N m ahead" (never an id); aria-live follows severity', async () => {
    withProvider(<AlertBanner />);
    const banner = await screen.findByRole('status'); // the fixture warning
    expect(banner).toHaveAttribute('aria-live', 'polite');
    expect(banner).toHaveTextContent('Mud losses likely in Tipam');
    expect(banner).toHaveTextContent('SYN-DLJ-03');
    expect(banner).toHaveTextContent('~55 m ahead');
    expect(banner).not.toHaveTextContent(ACTIVE_WELLBORE_ID);
    insertCritical();
    const crit = await screen.findByRole('alert');
    expect(crit).toHaveAttribute('aria-live', 'assertive');
    expect(crit).toHaveTextContent('Pit gain detected');
    expect(crit).toHaveTextContent('(+1 more)');
  });

  it("includes the 'generated' state (no Acknowledge yet: contract only allows sent/viewed/escalated)", async () => {
    withProvider(<AlertBanner />);
    await screen.findByRole('status');
    db.updateAlert(WARN_SENT, { state: 'acknowledged' }); // clear the fixture warning
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    insertCritical({ state: 'generated' });
    const crit = await screen.findByRole('alert');
    expect(crit).toHaveTextContent('Pit gain detected');
    expect(within(crit).getByRole('button', { name: 'View' })).toBeInTheDocument();
    expect(within(crit).queryByRole('button', { name: 'Acknowledge' })).toBeNull();
  });

  it('is not shown for info/watch, acknowledged or resolved alerts', async () => {
    db.updateAlert(WARN_SENT, { state: 'acknowledged' });
    withProvider(<AlertBanner />);
    await waitFor(() => expect(requests.some((r) => r.url.includes('v_open_alerts'))).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the "Escalated to RTOC lead" badge', async () => {
    db.updateAlert(WARN_SENT, { state: 'escalated', escalated_at: new Date().toISOString() });
    withProvider(<AlertBanner />);
    expect(await screen.findByText('Escalated to RTOC lead')).toBeInTheDocument();
  });

  it('"View" opens the alert card full screen', async () => {
    withProvider(<AlertBanner />);
    const banner = await screen.findByRole('status');
    fireEvent.click(within(banner).getByRole('button', { name: 'View' }));
    const dialog = await screen.findByRole('dialog', { name: 'Alert details' });
    expect(within(dialog).getByRole('heading', { name: 'Mud losses likely in Tipam' })).toBeInTheDocument();
    expect(dialog.className).toMatch(/fixed inset-0/);
  });

  it('Acknowledge from the banner changes state for everyone: banner and sound go away', async () => {
    enableSound();
    withProvider(<AlertBanner />);
    const banner = await screen.findByRole('status');
    await waitFor(() => expect(getActiveSoundLevel()).toBe('warning'));
    fireEvent.click(within(banner).getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(db.getAlert(WARN_SENT).state).toBe('acknowledged');
    expect(getActiveSoundLevel()).toBeNull();
  });

  it('another user acknowledging (Realtime) stops the banner and the sound here too', async () => {
    enableSound();
    withProvider(<AlertBanner />);
    await screen.findByRole('status');
    await waitFor(() => expect(getActiveSoundLevel()).toBe('warning'));
    act(() => {
      db.updateAlert(WARN_SENT, { state: 'acknowledged', acknowledged_by: 'someone-else', acknowledged_at: new Date().toISOString() });
    });
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(getActiveSoundLevel()).toBeNull();
  });

  it('maps a server FORBIDDEN error in plain words (same mapping as the card)', async () => {
    withProvider(<AlertBanner />);
    const banner = await screen.findByRole('status');
    localStorage.setItem('nwis_mock_role', 'office_engineer'); // the server disagrees with the UI role
    fireEvent.click(within(banner).getByRole('button', { name: 'Acknowledge' }));
    expect(await screen.findByText("You don't have permission for this.")).toBeInTheDocument();
  });

  it('maps BAD_STATE to "This alert has changed; refreshed." and refetches', async () => {
    withProvider(<AlertBanner />);
    const banner = await screen.findByRole('status');
    const stored = db.alerts.find((a) => a.id === WARN_SENT);
    stored.state = 'acknowledged'; // silently changed on the server (no Realtime event)
    fireEvent.click(within(banner).getByRole('button', { name: 'Acknowledge' }));
    expect(await screen.findByText('This alert has changed; refreshed.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('status', { name: '' })).toBeNull());
  });

  it('shows the Reconnecting… indicator and refetches open alerts when the link returns', async () => {
    withProvider(<AlertBanner />);
    await screen.findByRole('status');
    act(() => setMockConnection(false));
    expect(await screen.findByText(/Reconnecting/)).toBeInTheDocument();
    // an alert that arrived while we were disconnected (no event delivered)
    db.alerts.push({ ...clone(db.getAlert(WARN_SENT)), id: AL(99), severity: 'critical', title: 'Missed while offline', dedup_key: 'missed', created_at: new Date().toISOString() });
    const before = requests.filter((r) => r.url.includes('v_open_alerts')).length;
    act(() => setMockConnection(true));
    await waitFor(() => expect(requests.filter((r) => r.url.includes('v_open_alerts')).length).toBeGreaterThan(before));
    expect(await screen.findByText('Missed while offline')).toBeInTheDocument();
    expect(screen.queryByText(/Reconnecting/)).toBeNull();
  });
});

// ------------------------------------------------------------------------------------- provider
describe('AlertProvider notifications and shared list', () => {
  function Probe() {
    const { alerts } = useAlerts();
    return <span data-testid="count">{alerts.length}</span>;
  }

  it('notifies once for a new critical alert (also under StrictMode) with well name + depth; click focuses the alert', async () => {
    const n = installFakeNotification('granted');
    const focus = vi.spyOn(window, 'focus').mockImplementation(() => {});
    try {
      withProvider(<Probe />, { strict: true });
      await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('4')); // 4 open in the fixture
      await waitFor(() => expect(requests.some((r) => r.url.includes('stream_state'))).toBe(true));
      await new Promise((r) => setTimeout(r, 100));
      expect(n.shown).toHaveLength(0); // existing alerts do not notify on load
      insertCritical();
      await waitFor(() => expect(n.shown).toHaveLength(1));
      expect(n.shown[0].title).toBe('Critical: Pit gain detected');
      expect(n.shown[0].options.body).toContain('SYN-DLJ-03');
      expect(n.shown[0].options.body).toMatch(/~\d+ m ahead/);
      expect(n.shown[0].options.body).toMatch(/\d+ m MD/);
      expect(n.shown[0].options.tag).toBeTruthy();
      await new Promise((r) => setTimeout(r, 100));
      expect(n.shown).toHaveLength(1);

      // click focuses the app on that alert (full-screen card)
      act(() => n.shown[0].onclick());
      expect(focus).toHaveBeenCalled();
      const dialog = await screen.findByRole('dialog', { name: 'Alert details' });
      expect(within(dialog).getByRole('heading', { name: 'Pit gain detected' })).toBeInTheDocument();
    } finally {
      n.restore();
    }
  });

  it('re-notifies when sent_at changes but not for unrelated updates; info/watch never notify', async () => {
    const n = installFakeNotification('granted');
    try {
      withProvider(<Probe />);
      await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('4'));
      act(() => db.updateAlert(WARN_SENT, { action_note: 'unrelated change' }));
      await new Promise((r) => setTimeout(r, 80));
      expect(n.shown).toHaveLength(0);
      act(() => db.updateAlert(WARN_SENT, { sent_at: new Date(Date.now() + 1000).toISOString() }));
      await waitFor(() => expect(n.shown).toHaveLength(1));
      expect(n.shown[0].title).toBe('Warning: Mud losses likely in Tipam');
      act(() => {
        mockCreateAlert({ severity: 'info', title: 'FYI' }, { sendAfterMs: null });
      });
      await new Promise((r) => setTimeout(r, 80));
      expect(n.shown).toHaveLength(1);
    } finally {
      n.restore();
    }
  });

  it('does not notify without permission and never runs side effects inside a state updater', async () => {
    const n = installFakeNotification('default');
    try {
      withProvider(<Probe />, { strict: true });
      await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('4'));
      insertCritical();
      await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('5'));
      expect(n.shown).toHaveLength(0);
    } finally {
      n.restore();
    }
  });

  it('a rig engineer only receives alerts of the assigned wellbore (in.(…) filter + RLS)', async () => {
    as('rig_engineer');
    withProvider(<Probe />);
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('4'));
    act(() => {
      mockCreateAlert({ wellbore_id: '00000000-0000-4000-8000-000000000004', severity: 'critical', title: 'Other well' }, { sendAfterMs: null });
    });
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.getByTestId('count')).toHaveTextContent('4');
    insertCritical();
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('5'));
  });
});

// ------------------------------------------------------------------------------------- card
describe('AlertCard', () => {
  const user = () => makeProfile('rtoc_engineer');

  it('derives band from score, shows confidence chip, zone, expected depth, formation and message', async () => {
    renderApp(<LiveCard id={WARN_SENT} user={user()} />);
    const card = await screen.findByRole('article', { name: /Mud losses likely in Tipam/ });
    expect(within(card).getAllByText('High').length).toBeGreaterThan(0); // score 72 -> High band
    expect(within(card).getByText('Warning')).toBeInTheDocument(); // severity word
    expect(within(card).getByText('Medium confidence')).toBeInTheDocument();
    expect(card).toHaveTextContent('2450–2475 m');
    expect(card).toHaveTextContent('2460.0 m');
    expect(card).toHaveTextContent('Tipam');
    await waitFor(() => expect(card).toHaveTextContent('SYN-DLJ-03')); // well NAME, resolved asynchronously
    expect(card).toHaveTextContent('Pump an LCM pill before the sand');
    expect(card).toHaveTextContent('72 / 100');
  });

  it('low confidence is dashed, says "Low confidence" and carries the reason in a tooltip', async () => {
    db.updateAlert(WATCH_VIEWED, { evidence: { ...db.getAlert(WATCH_VIEWED).evidence, confidence_reason: '1 offset within 10 km' } });
    renderApp(<LiveCard id={WATCH_VIEWED} user={user()} />);
    const chip = await screen.findByText('Low confidence');
    expect(chip.className).toMatch(/border-dashed/);
    expect(chip.getAttribute('title')).toContain('1 offset within 10 km');
  });

  it('renders the evidence JSON: offsets with well/distance/NPT/source link, lessons, SHAP, layers, sources', async () => {
    renderApp(<LiveCard id={WARN_SENT} user={user()} />, { route: '/' });
    const ev = await screen.findByRole('region', { name: 'Evidence' });
    expect(ev).toHaveTextContent('SYN-DLJ-01');
    expect(ev).toHaveTextContent('850 m away');
    expect(ev).toHaveTextContent('NPT 12 h');
    const srcLinks = within(ev).getAllByRole('link');
    expect(srcLinks.some((l) => /^\/sources\/[^?]+\?page=37$/.test(l.getAttribute('href')))).toBe(true);
    expect(within(ev).getByText('Recommended lessons')).toBeInTheDocument();
    expect(ev).toHaveTextContent('Success rate 80%');
    expect(ev).toHaveTextContent('flow out minus in trend');
    expect(ev).toHaveTextContent('L1 offset wells78%');
    expect(ev).toHaveTextContent('L3 live detectorsnot available');
    expect(within(ev).getByRole('link', { name: /DDR SYN-DLJ-01, page 37/ })).toBeInTheDocument();
  });

  it('shows the detector signal for detector alerts', async () => {
    renderApp(<LiveCard id={CRIT_ACKED} user={user()} />);
    const ev = await screen.findByRole('region', { name: 'Evidence' });
    expect(ev).toHaveTextContent('torque spike');
    expect(ev).toHaveTextContent('z score4.1');
  });

  it('system alerts get a distinct badge and no evidence panel', async () => {
    const sys = mockCreateAlert({ kind: 'system', risk_type: null, severity: 'warning', title: 'Live data lost', score: null, confidence: null, evidence: {} }, { sendAfterMs: null });
    renderApp(<LiveCard id={sys.id} user={user()} />);
    const card = await screen.findByRole('article', { name: /Live data lost/ });
    expect(within(card).getByText('System')).toBeInTheDocument();
    expect(within(card).queryByRole('region', { name: 'Evidence' })).toBeNull();
  });

  it('opening records the view once per user, for ANY state, even across re-opens and StrictMode', async () => {
    const { unmount } = renderApp(<LiveCard id={WARN_SENT} user={user()} />, { strict: true });
    await waitFor(() => expect(mockViewsFor(WARN_SENT)).toHaveLength(1));
    await waitFor(() => expect(db.getAlert(WARN_SENT).state).toBe('viewed')); // sent -> viewed
    unmount();
    renderApp(<LiveCard id={WARN_SENT} user={user()} />);
    await screen.findByRole('article');
    await new Promise((r) => setTimeout(r, 100));
    expect(mockViewsFor(WARN_SENT)).toHaveLength(1);
    expect(requests.filter((r) => r.url.endsWith('/rpc/mark_alert_viewed'))).toHaveLength(1);

    // states other than 'sent' are recorded too (contract: "others: just record the view")
    for (const id of [CRIT_ACKED, RESOLVED, INFO_GENERATED]) {
      renderApp(<LiveCard id={id} user={user()} />);
      await waitFor(() => expect(mockViewsFor(id)).toHaveLength(1));
    }
    expect(db.getAlert(CRIT_ACKED).state).toBe('acknowledged'); // unchanged
  });

  it('timeline lists Generated → Sent → Viewed → (Escalated) → Acknowledged → Resolved → Feedback with times and who', async () => {
    const me = user();
    const steps = buildTimeline(db.getAlert(FEEDBACK), me, null).map((s) => s.key);
    expect(steps).toEqual(['generated', 'sent', 'viewed', 'acknowledged', 'resolved', 'feedback']);
    const esc = buildTimeline({ ...db.getAlert(WARN_SENT), state: 'escalated', escalated_at: 'x' }, me, null).map((s) => s.key);
    expect(esc).toContain('escalated');
    renderApp(<LiveCard id={FEEDBACK} user={me} />);
    const tl = await screen.findByRole('list', { name: 'Alert timeline' });
    expect(within(tl).getByText(/Resolved/).closest('li')).toHaveTextContent('by you');
    expect(within(tl).getByText(/Resolved/).closest('li')).toHaveTextContent('event occurred');
    expect(within(tl).getByText(/Feedback/).closest('li')).toHaveTextContent('useful');
    expect(tl.querySelectorAll('[data-done="true"]').length).toBe(6);
    expect(summarizeHistory([db.getAlert(RESOLVED), db.getAlert(FEEDBACK)])).toMatchObject({ total: 2, avoided: 1, event_occurred: 1, useful: 1, unrated: 1 });
  });

  it('EvidencePanel tolerates an alert without evidence', () => {
    renderApp(<EvidencePanel alert={{ evidence: {} }} />);
    expect(screen.getByText(/No evidence was recorded/)).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------------------------- actions
describe('lifecycle actions', () => {
  it('Acknowledge with an optional note sends p_note and the state changes', async () => {
    const me = as('rtoc_engineer');
    renderApp(<LiveCard id={WARN_SENT} user={me} />);
    fireEvent.change(await screen.findByLabelText(/Acknowledge note/), { target: { value: 'LCM pill ready' } });
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(db.getAlert(WARN_SENT).state).toBe('acknowledged'));
    expect(db.getAlert(WARN_SENT).action_note).toBe('LCM pill ready');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Acknowledge' })).toBeNull());
    expect(await screen.findByRole('button', { name: 'Resolve' })).toBeInTheDocument(); // acknowledged warning -> resolvable by RTOC
  });

  it('Resolve asks for an outcome (+ note) and resolves; then feedback can be given, only after resolved', async () => {
    const me = as('rtoc_engineer');
    renderApp(<LiveCard id={CRIT_ACKED} user={me} />);
    expect(screen.queryByText('Was this alert useful?')).toBeNull(); // not yet resolved
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve' }));
    const dlg = await screen.findByRole('dialog', { name: 'Resolve this alert' });
    fireEvent.change(within(dlg).getByLabelText('Outcome'), { target: { value: 'event_occurred' } });
    fireEvent.change(within(dlg).getByLabelText(/Note/), { target: { value: 'Torque normalised after sweep' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirm resolution' }));
    await waitFor(() => expect(db.getAlert(CRIT_ACKED).state).toBe('resolved'));
    expect(db.getAlert(CRIT_ACKED)).toMatchObject({ outcome: 'event_occurred', resolved_how: 'manual', action_note: 'Torque normalised after sweep' });
    expect(await screen.findByText('Was this alert useful?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Yes/ }));
    await waitFor(() => expect(db.getAlert(CRIT_ACKED).state).toBe('feedback'));
    expect(db.getAlert(CRIT_ACKED).useful).toBe(true);
    expect(await screen.findByTestId('feedback-summary')).toHaveTextContent('was useful');
  });

  it('Dismiss is offered for info/watch only, requires a reason of >= 5 characters', async () => {
    const me = as('rtoc_engineer');
    const { unmount } = renderApp(<LiveCard id={WARN_SENT} user={me} />);
    await screen.findByRole('article');
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull(); // warning: never
    unmount();

    renderApp(<LiveCard id={WATCH_VIEWED} user={me} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    const dlg = await screen.findByRole('dialog', { name: 'Dismiss this alert' });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirm dismissal' }));
    expect(within(dlg).getByText('Reason must be at least 5 characters.')).toBeInTheDocument();
    fireEvent.change(within(dlg).getByLabelText(/Reason for dismissal/), { target: { value: 'bad' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirm dismissal' }));
    expect(within(dlg).getByText('Reason must be at least 5 characters.')).toBeInTheDocument();
    expect(db.getAlert(WATCH_VIEWED).state).toBe('viewed');
    fireEvent.change(within(dlg).getByLabelText(/Reason for dismissal/), { target: { value: 'Offset event is in a different sand' } });
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirm dismissal' }));
    await waitFor(() => expect(db.getAlert(WATCH_VIEWED).state).toBe('resolved'));
    expect(db.getAlert(WATCH_VIEWED)).toMatchObject({ resolved_how: 'dismissed', outcome: 'false_alarm', dismiss_reason: 'Offset event is in a different sand' });
  });

  it('a rig engineer can acknowledge a warning but cannot resolve or dismiss it', async () => {
    const me = as('rig_engineer');
    renderApp(<LiveCard id={WARN_SENT} user={me} />);
    expect(await screen.findByRole('button', { name: 'Acknowledge' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('a rig engineer can resolve and dismiss an info alert once it is sent', async () => {
    const me = as('rig_engineer');
    db.updateAlert(INFO_GENERATED, { state: 'sent', sent_at: new Date().toISOString() });
    renderApp(<LiveCard id={INFO_GENERATED} user={me} />);
    expect(await screen.findByRole('button', { name: 'Resolve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeInTheDocument();
  });

  it('an office engineer sees no lifecycle buttons at all', async () => {
    const me = as('office_engineer');
    renderApp(<LiveCard id={WARN_SENT} user={me} />);
    await screen.findByRole('article');
    for (const name of ['Acknowledge', 'Resolve', 'Dismiss']) expect(screen.queryByRole('button', { name })).toBeNull();
  });

  it('server BAD_REQUEST / FORBIDDEN / BAD_STATE errors are shown in plain words', async () => {
    const me = as('rtoc_engineer');
    renderApp(<LiveCard id={CRIT_ACKED} user={me} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve' }));
    const dlg = await screen.findByRole('dialog', { name: 'Resolve this alert' });
    db.alerts.find((a) => a.id === CRIT_ACKED).state = 'resolved'; // resolved elsewhere in the meantime
    fireEvent.click(within(dlg).getByRole('button', { name: 'Confirm resolution' }));
    expect(await within(dlg).findByText('This alert has changed; refreshed.')).toBeInTheDocument();
  });

  it('feedback is not offered before resolution or to people who may not rate', async () => {
    renderApp(<LiveCard id={RESOLVED} user={as('rtoc_engineer')} />);
    expect(await screen.findByText('Was this alert useful?')).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------------------------- AlertsPage
describe('AlertsPage (/alerts)', () => {
  const addAlert = (o) => mockCreateAlert({ state: 'sent', sent_at: new Date().toISOString(), ...o }, { sendAfterMs: null });

  it('queries v_open_alerts, groups by well NAME, pins unacknowledged warning/critical on top', async () => {
    addAlert({ wellbore_id: '00000000-0000-4000-8000-000000000004', severity: 'critical', title: 'Kick on the other well' });
    withProvider(<AlertsPage />);
    const pinned = await screen.findByRole('region', { name: 'Needs acknowledgement' });
    expect(requests.some((r) => r.url.includes('/rest/v1/v_open_alerts'))).toBe(true);
    const pinnedTitles = within(pinned).getAllByRole('listitem').map((li) => li.textContent);
    expect(pinnedTitles[0]).toContain('Kick on the other well'); // critical first
    expect(pinnedTitles[0]).toContain('SYN-DLJ-04');
    expect(pinnedTitles[1]).toContain('Mud losses likely in Tipam');
    const group = screen.getByRole('region', { name: 'Alerts for SYN-DLJ-03' });
    expect(within(group).getByText('Stuck pipe risk building near the Barail top')).toBeInTheDocument();
    expect(within(group).queryByText('Mud losses likely in Tipam')).toBeNull(); // pinned ones are not repeated
    expect(screen.queryByText(ACTIVE_WELLBORE_ID)).toBeNull();
    expect(screen.queryByText(/Wellbore:/)).toBeNull();
  });

  it('shows running age counters for the pinned alerts', async () => {
    db.updateAlert(WARN_SENT, { created_at: new Date(Date.now() - 5000).toISOString() });
    withProvider(<AlertsPage />);
    const pinned = await screen.findByRole('region', { name: 'Needs acknowledgement' });
    const first = within(pinned).getAllByTestId('alert-age')[0].textContent;
    expect(first).toMatch(/^\d\d:\d\d$/);
    await waitFor(() => expect(within(pinned).getAllByTestId('alert-age')[0].textContent).not.toBe(first), { timeout: 3000 });
  });

  it('filters by state and sorts by severity or age', async () => {
    withProvider(<AlertsPage />);
    const group = await screen.findByRole('region', { name: 'Alerts for SYN-DLJ-03' });
    expect(within(group).getByText('Cementing issue: low risk ahead')).toBeInTheDocument(); // generated info
    fireEvent.click(screen.getByRole('button', { name: 'generated' })); // untoggle
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Alerts for SYN-DLJ-03' })).queryByText('Cementing issue: low risk ahead')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'generated' }));
    const titles = () => within(screen.getByRole('region', { name: 'Alerts for SYN-DLJ-03' })).getAllByRole('listitem').map((li) => li.getAttribute('data-severity'));
    // the group holds: watch (viewed, 30 min old), info (generated), critical (acknowledged, 90 min old)
    expect(titles()).toEqual(['critical', 'watch', 'info']);
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'age' } });
    expect(titles()).toEqual(['critical', 'watch', 'info']); // oldest first: 90 min, 30 min, 1 min
  });

  it('new alerts appear live and acknowledged ones leave the pinned list (Realtime)', async () => {
    withProvider(<AlertsPage />);
    await screen.findByRole('region', { name: 'Needs acknowledgement' });
    addAlert({ severity: 'critical', title: 'Appeared live' });
    expect(await screen.findByText('Appeared live')).toBeInTheDocument();
    act(() => db.updateAlert(WARN_SENT, { state: 'acknowledged' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Needs acknowledgement' })).queryByText('Mud losses likely in Tipam')).toBeNull());
  });

  it('Open shows the alert card full screen', async () => {
    withProvider(<AlertsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open alert: Mud losses likely in Tipam' }));
    const dialog = await screen.findByRole('dialog', { name: 'Alert details' });
    expect(within(dialog).getByRole('heading', { name: 'Mud losses likely in Tipam' })).toBeInTheDocument();
    await waitFor(() => expect(mockViewsFor(WARN_SENT)).toHaveLength(1));
  });
});

// ------------------------------------------------------------------------------------- WellAlertsTab
describe('WellAlertsTab', () => {
  const renderTab = () =>
    withProvider(<WellAlertsTab />, { route: `/wells/${ACTIVE_WELLBORE_ID}/alerts`, path: '/wells/:wellboreId/alerts' });

  it('lists open alerts (shared list) and the resolved history with outcome and feedback summary', async () => {
    renderTab();
    const open = await screen.findByRole('region', { name: 'Open alerts' });
    await waitFor(() => expect(within(open).getAllByRole('listitem')).toHaveLength(4));
    const history = screen.getByRole('region', { name: 'Alert history' });
    await waitFor(() => expect(within(history).getAllByRole('listitem')).toHaveLength(2));
    const summary = within(history).getByTestId('history-summary');
    expect(summary).toHaveTextContent('1 avoided, 1 event occurred, 0 false alarm');
    expect(summary).toHaveTextContent('1 useful, 0 not useful, 1 not rated');
    expect(history).toHaveTextContent('outcome: event occurred');
    expect(history).toHaveTextContent('rated useful');
  });

  it('moves an alert from open to history live when it is resolved (Realtime)', async () => {
    renderTab();
    const open = await screen.findByRole('region', { name: 'Open alerts' });
    await waitFor(() => expect(within(open).getAllByRole('listitem')).toHaveLength(4));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Alert history' })).getAllByRole('listitem')).toHaveLength(2));
    act(() => db.updateAlert(CRIT_ACKED, { state: 'resolved', resolved_at: new Date().toISOString(), resolved_how: 'manual', outcome: 'avoided' }));
    await waitFor(() => expect(within(open).getAllByRole('listitem')).toHaveLength(3));
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Alert history' })).getAllByRole('listitem')).toHaveLength(3));
  });
});
