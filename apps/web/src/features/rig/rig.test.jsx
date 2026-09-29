import React from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { computeMaxGauges, RiskGauges } from './RiskGauges';
import { DepthPanel } from './DepthPanel';
import { RigView } from './RigView';
import { useWakeLock } from './useWakeLock';
import { AlertProvider } from '../alerts/AlertProvider';
import { useProfile } from '../auth/useProfile';
import { db } from '../../mocks/db';
import { mockAdvanceBit } from '../../mocks/handlers/risk';
import { ACTIVE_WELLBORE_ID } from '../../mocks/ids';
import { dropStream } from '../../lib/data/stream';
import { clone, createServer, installRelativeFetch, makeProfile, renderApp, resetMockState } from '../../dev/testHarness';

vi.mock('../auth/useProfile', () => ({ useProfile: vi.fn() }));

const server = createServer();
let restoreFetch;

beforeAll(() => {
  vi.stubEnv('VITE_USE_MOCKS', 'true');
  server.listen({ onUnhandledRequest: 'bypass' });
  restoreFetch = installRelativeFetch();
});
afterAll(() => {
  restoreFetch();
  server.close();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  resetMockState();
  useProfile.mockReturnValue({ profile: makeProfile('rig_engineer'), session: { user: {} }, isLoading: false });
});
afterEach(() => {
  server.resetHandlers();
  delete navigator.wakeLock;
});

const row = (o) => ({ wellbore_id: 'w', risk_type: 'losses', md_from_m: 1000, md_to_m: 1025, fused: 10, confidence: 'high', computed_at: '2026-01-01T00:00:00Z', ...o });

describe('computeMaxGauges (max fused in the NEXT 300 m of the bit)', () => {
  it('finds the maximum per risk type inside [bit, bit + 300]', () => {
    const scores = [
      row({ fused: 30, md_from_m: 1000 }),
      row({ fused: 85, md_from_m: 1025, md_to_m: 1050, confidence: 'medium' }),
      row({ risk_type: 'stuck_pipe', fused: 50, confidence: 'low' }),
    ];
    const maxes = computeMaxGauges(scores, 1000);
    expect(maxes.losses.fused).toBe(85);
    expect(maxes.losses.md_from_m).toBe(1025);
    expect(maxes.stuck_pipe.fused).toBe(50);
    expect(maxes.kick).toBeNull();
  });

  it('ignores rows behind the bit and rows beyond bit + 300 m', () => {
    const scores = [
      row({ fused: 40, md_from_m: 1100, md_to_m: 1125 }),
      row({ fused: 97, md_from_m: 1300, md_to_m: 1325 }), // starts exactly at bit + 300: outside
      row({ fused: 99, md_from_m: 900, md_to_m: 925 }), // behind the bit
      row({ fused: 60, md_from_m: 1275, md_to_m: 1300 }), // last interval: inside
    ];
    expect(computeMaxGauges(scores, 1000).losses.fused).toBe(60);
  });
});

describe('RiskGauges', () => {
  it('shows score, band WORD, icon, confidence and the depth of the peak for each of the 5 types', () => {
    const scores = [row({ fused: 85, md_from_m: 1025, md_to_m: 1050, confidence: 'low', confidence_reason: '1 offset' }), row({ risk_type: 'kick', fused: 12 })];
    renderApp(<RiskGauges scores={scores} bitMd={1000} />);
    const g = screen.getByTestId('gauge-losses');
    expect(g).toHaveAttribute('data-band', 'critical');
    expect(within(g).getByText('85')).toBeInTheDocument();
    expect(within(g).getByText('Critical')).toBeInTheDocument();
    expect(g.querySelector('svg')).not.toBeNull();
    expect(within(g).getByText('Low confidence')).toBeInTheDocument();
    expect(within(g).getByText(/Peak at 1025–1050 m/)).toBeInTheDocument();
    expect(screen.getByTestId('gauge-kick')).toHaveAttribute('data-band', 'low');
    expect(within(screen.getByTestId('gauge-torque')).getByText('No score yet')).toBeInTheDocument();
    expect(screen.getByText(/next 300 m/)).toBeInTheDocument();
  });
});

describe('DepthPanel', () => {
  const base = { bit_md_m: 1200, hole_md_m: 1210, status: 'live', last_sample_at: new Date().toISOString(), latest: { rop_m_h: 12.5, torque_knm: 15, flow_in_lpm: 2000, flow_out_lpm: 1950, pit_vol_m3: 42 } };

  it('renders the lost-stream bar with the time of loss and the detector message', () => {
    renderApp(<DepthPanel streamState={{ ...base, status: 'lost', last_sample_at: '2026-10-04T10:15:00Z' }} />);
    const bar = screen.getByRole('alert');
    expect(bar).toHaveTextContent(/Live data lost at /);
    expect(bar).toHaveTextContent('Look-ahead from offset wells continues; live detectors paused.');
    expect(bar.className).toMatch(/bg-red-800/);
  });

  it('formats with units.js (kN·m, m³, m) and shows last data', () => {
    renderApp(<DepthPanel streamState={base} />);
    expect(screen.getByTestId('bit-depth')).toHaveTextContent('1200.0 m');
    expect(screen.getByText('15.0 kN·m')).toBeInTheDocument();
    expect(screen.getByText('42.0 m³')).toBeInTheDocument();
    expect(screen.getByText('1210.0 m')).toBeInTheDocument();
    expect(screen.getByText(/Stream live: last data/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('useWakeLock', () => {
  function Probe() {
    return <span data-testid="wl">{useWakeLock()}</span>;
  }

  it('requests a screen wake lock, re-acquires it when the tab is visible again and releases on unmount', async () => {
    const release = vi.fn(async () => {});
    const request = vi.fn(async () => ({ release, addEventListener: () => {} }));
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    const { unmount } = renderApp(<Probe />);
    await waitFor(() => expect(screen.getByTestId('wl')).toHaveTextContent('active'));
    expect(request).toHaveBeenCalledWith('screen');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    unmount();
    expect(release).toHaveBeenCalled();
  });

  it('reports "unsupported" without navigator.wakeLock', () => {
    renderApp(<Probe />);
    expect(screen.getByTestId('wl')).toHaveTextContent('unsupported');
  });
});

describe('FE-08 RigView (tablet, 1024x768, .rig theme)', () => {
  const renderRig = (opts = {}) =>
    renderApp(
      <AlertProvider>
        <RigView />
      </AlertProvider>,
      { route: `/rig/${ACTIVE_WELLBORE_ID}`, path: '/rig/:wellboreId', ...opts }
    );

  it('shows depth, ROP, torque (kN·m), flows, pit volume and the five gauges from the mock stream', async () => {
    renderRig();
    await waitFor(() => expect(screen.getByTestId('bit-depth')).toHaveTextContent('2405.0 m'));
    expect(screen.getByText('14.2 kN·m')).toBeInTheDocument();
    expect(screen.getByText('40.5 m³')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('gauge-losses')).toHaveAttribute('data-band'));
    // max within the next 300 m from fixtures: losses 77 (High), kick 91.2 (Critical), cementing 21.2 (Moderate)
    expect(within(screen.getByTestId('gauge-losses')).getByText('77')).toBeInTheDocument();
    expect(within(screen.getByTestId('gauge-kick')).getByText('91')).toBeInTheDocument();
    expect(screen.getByTestId('gauge-kick')).toHaveAttribute('data-band', 'critical');
    expect(screen.getByTestId('gauge-cementing')).toHaveAttribute('data-band', 'moderate');
  });

  it('formation panel: next formation, distance to its top and "± uncertainty"', async () => {
    renderRig();
    const next = await screen.findByTestId('next-formation');
    expect(next.textContent).toMatch(/in ~\d+ m ± \d+ m/);
  });

  it('lessons panel lists at most 3 lessons with mitigation, success rate and well count', async () => {
    renderRig();
    const panel = await screen.findByRole('region', { name: 'Lessons' });
    await waitFor(() => expect(within(panel).getAllByRole('listitem').length).toBeGreaterThan(0));
    expect(within(panel).getAllByRole('listitem').length).toBeLessThanOrEqual(3);
    expect(panel.textContent).toMatch(/Success \d+% · \d+ wells?/);
  });

  it('values update live during replay: advancing the bit changes depth and re-windows the gauges', async () => {
    renderRig();
    await waitFor(() => expect(screen.getByTestId('bit-depth')).toHaveTextContent('2405.0 m'));
    await waitFor(() => expect(screen.getByTestId('gauge-kick')).toHaveAttribute('data-band'));
    act(() => {
      mockAdvanceBit(ACTIVE_WELLBORE_ID, 5);
    });
    await waitFor(() => expect(screen.getByTestId('bit-depth')).toHaveTextContent('2410.0 m'));
    await waitFor(() => expect(screen.getByTestId('gauge-kick').textContent).toMatch(/Peak at 2\d{3}(\.\d)?–/));
  });

  it('a new risk_scores row arriving through Realtime shows in the gauge without reload', async () => {
    renderRig();
    await waitFor(() => expect(screen.getByTestId('gauge-torque')).toHaveAttribute('data-band', 'moderate'));
    const r = { ...clone(db.risk_scores.find((x) => x.risk_type === 'torque')), md_from_m: 2500, md_to_m: 2525, fused: 93, band: 'critical', computed_at: new Date().toISOString() };
    act(() => {
      db.risk_scores.push(r);
      db.emitChange('risk_scores', r);
    });
    await waitFor(() => expect(screen.getByTestId('gauge-torque')).toHaveAttribute('data-band', 'critical'));
    expect(within(screen.getByTestId('gauge-torque')).getByText('93')).toBeInTheDocument();
  });

  it('the lost-stream bar appears when /api/stream/drop is called and clears when the stream returns', async () => {
    renderRig();
    await waitFor(() => expect(screen.getByTestId('bit-depth')).toHaveTextContent('2405.0 m'));
    expect(screen.queryByText(/Live data lost at/)).toBeNull();
    await act(async () => {
      await dropStream(ACTIVE_WELLBORE_ID, 1);
    });
    expect(await screen.findByText(/Live data lost at/)).toBeInTheDocument();
    expect(screen.getByText(/live detectors paused/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Live data lost at/)).toBeNull(), { timeout: 4000 });
  });

  it('banner "View" opens the alert card full screen in the rig theme', async () => {
    renderRig();
    const banner = await screen.findByRole('status');
    expect(banner).toHaveTextContent('Mud losses likely in Tipam');
    expect(banner).toHaveTextContent('SYN-DLJ-03');
    expect(banner).toHaveTextContent('~55 m ahead');
    fireEvent.click(within(banner).getByRole('button', { name: 'View' }));
    const dialog = await screen.findByRole('dialog', { name: 'Alert details' });
    expect(dialog.className).toMatch(/\brig\b/);
    expect(dialog.className).toMatch(/fixed inset-0/);
    expect(within(dialog).getByRole('heading', { name: 'Mud losses likely in Tipam' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /Close/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is built for a tablet: .rig theme, no text below 18 px, touch targets >= 48 px', async () => {
    const { container } = renderRig();
    await waitFor(() => expect(screen.getByTestId('bit-depth')).toHaveTextContent('2405.0 m'));
    await screen.findByRole('status'); // banner
    const root = container.querySelector('.rig');
    expect(root).not.toBeNull();
    expect(root.className).toMatch(/text-lg/);
    // nothing in the rig subtree may use a size below text-lg (text-base/sm/xs)
    const small = root.querySelectorAll('[class*="text-xs"], [class*="text-sm"], [class*="text-base"], [class*="text-[1"]');
    expect([...small].filter((el) => /(^|\s)text-(xs|sm|base)(\s|$)/.test(el.className))).toHaveLength(0);
    // every button/link is at least 48 px tall by class
    const targets = root.querySelectorAll('button, a');
    expect(targets.length).toBeGreaterThan(0);
    targets.forEach((el) => expect(el.className).toMatch(/min-h-\[48px\]/));
    expect(screen.getByRole('button', { name: 'Enable alert sound' })).toBeInTheDocument(); // the rig has no top bar
    // uses theme tokens, not ad-hoc dark palettes
    expect(root.innerHTML).not.toMatch(/bg-gray-(800|900)/);
  });
});
