import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, within, fireEvent, act, waitFor } from '@testing-library/react';
import { ModelsPage } from './ModelsPage';
import { UserDialog } from './UsersPage';
import { beatsBaseline, prAucBars, stillTraining, groupRuns, fmt2, fmt3 } from './models';

const h = vi.hoisted(() => ({ rows: [], apiFetch: vi.fn() }));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => {
        const result = { then: (res) => Promise.resolve({ data: h.rows, error: null }).then(res) };
        return { order: () => result, ...result };
      },
    }),
  },
}));
vi.mock('../../lib/api', () => ({ apiFetch: (...a) => h.apiFetch(...a) }));
vi.mock('../auth/RequireRole', () => ({ RequireRole: ({ children }) => children }));

const run = (id, risk_type, over = {}) => ({
  id,
  risk_type,
  version: `v-${id}`,
  is_active: false,
  created_at: '2026-10-01T10:00:00Z',
  metrics: { pr_auc: 0.41, baseline_pr_auc: 0.28, precision: 0.5, recall: 0.62, n_wells: 12 },
  ...over,
});

describe('model helpers', () => {
  it('compares PR-AUC with the baseline and tolerates missing numbers', () => {
    expect(beatsBaseline({ pr_auc: 0.4, baseline_pr_auc: 0.3 })).toBe(true);
    expect(beatsBaseline({ pr_auc: 0.3, baseline_pr_auc: 0.3 })).toBe(false);
    expect(beatsBaseline({ pr_auc: null, baseline_pr_auc: 0.3 })).toBeNull();
    expect(beatsBaseline(undefined)).toBeNull();
  });

  it('turns the pair into bar widths and formats numbers', () => {
    expect(prAucBars({ pr_auc: 0.41, baseline_pr_auc: 0.28 })).toEqual({ model: 41, baseline: 28 });
    expect(prAucBars({ pr_auc: 3, baseline_pr_auc: -1 })).toEqual({ model: 100, baseline: 0 });
    expect(prAucBars(null)).toEqual({ model: null, baseline: null });
    expect(fmt3(0.41234)).toBe('0.412');
    expect(fmt2(null)).toBe('—');
  });

  it('finds the risk types that still have no new run (by id, not by clock)', () => {
    const rows = [run('old', 'losses'), run('new1', 'losses'), run('old2', 'kick')];
    expect(stillTraining(['losses', 'kick'], ['old', 'old2'], rows)).toEqual(['kick']);
    expect(stillTraining(['losses'], ['old', 'old2'], rows)).toEqual([]);
    expect(stillTraining(['torque'], [], [])).toEqual(['torque']);
  });

  it('groups runs by risk type, newest first', () => {
    const rows = [run('a', 'kick', { created_at: '2026-09-01T00:00:00Z' }), run('b', 'losses'), run('c', 'kick', { created_at: '2026-10-02T00:00:00Z' })];
    const groups = groupRuns(rows, ['losses', 'kick', 'torque']);
    expect(groups.map(([t, r]) => [t, r.map((x) => x.id)])).toEqual([['losses', ['b']], ['kick', ['c', 'a']]]);
  });
});

describe('ModelsPage', () => {
  beforeEach(() => {
    h.rows = [run('r1', 'losses', { is_active: true }), run('r2', 'losses', { created_at: '2026-09-01T10:00:00Z', metrics: { pr_auc: 0.2, baseline_pr_auc: 0.28, precision: 0.3, recall: 0.4, n_wells: 9 } })];
    h.apiFetch.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('shows version, active flag, PR-AUC vs baseline, precision, recall and wells', async () => {
    render(<ModelsPage />);
    const rows = await screen.findAllByTestId('run-losses');
    expect(rows).toHaveLength(2);
    const first = within(rows[0]);
    expect(first.getByText('ACTIVE')).toBeInTheDocument();
    expect(first.getByText('Beats the offset-only baseline')).toBeInTheDocument();
    expect(first.getByText('0.410')).toBeInTheDocument();
    expect(first.getByText('0.280')).toBeInTheDocument();
    expect(first.getByText('0.50')).toBeInTheDocument();
    expect(first.getByText('0.62')).toBeInTheDocument();
    expect(first.getByText('12')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Does not beat the baseline')).toBeInTheDocument();
    expect(within(rows[1]).getByText('inactive')).toBeInTheDocument();
    expect(screen.getByText(/becomes active only if it beats the offset-only baseline/)).toBeInTheDocument();
  });

  it('starts a retrain, then watches model_runs every 10 s until a new run appears', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    h.apiFetch.mockResolvedValue({ model_run_ids: [] }); // the backend answers 202 at once with no ids
    render(<ModelsPage />);
    await screen.findAllByTestId('run-losses');

    fireEvent.click(screen.getByLabelText('Stuck pipe'));
    fireEvent.click(screen.getByRole('button', { name: 'Retrain' }));
    expect(await screen.findByTestId('training-status')).toHaveTextContent('Training started for Stuck pipe');
    expect(h.apiFetch).toHaveBeenCalledWith('/api/admin/retrain', { method: 'POST', body: JSON.stringify({ risk_types: ['stuck_pipe'] }) });

    // a run for another type is not enough; the one for stuck_pipe ends the watch
    h.rows = [run('x1', 'losses'), ...h.rows];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByTestId('training-status')).toBeInTheDocument();

    h.rows = [run('sp1', 'stuck_pipe', { is_active: true }), ...h.rows];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await waitFor(() => expect(screen.queryByTestId('training-status')).toBeNull());
    expect(screen.getAllByTestId('run-stuck_pipe')).toHaveLength(1);
  });

  it('gives up after 10 minutes with an explanation', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    h.apiFetch.mockResolvedValue({ model_run_ids: [] });
    render(<ModelsPage />);
    await screen.findAllByTestId('run-losses');
    fireEvent.click(screen.getByLabelText('Kick / overpressure'));
    fireEvent.click(screen.getByRole('button', { name: 'Retrain' }));
    await screen.findByTestId('training-status');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000 + 10_000);
    });
    expect(await screen.findByText(/No new run appeared within 10 minutes/)).toBeInTheDocument();
    expect(screen.queryByTestId('training-status')).toBeNull();
  });

  it('shows why a retrain could not start (it used to be only a console message)', async () => {
    h.apiFetch.mockRejectedValue(new Error('A retrain is already running'));
    render(<ModelsPage />);
    await screen.findAllByTestId('run-losses');
    fireEvent.click(screen.getByLabelText('Mud losses'));
    fireEvent.click(screen.getByRole('button', { name: 'Retrain' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A retrain is already running');
    expect(screen.queryByTestId('training-status')).toBeNull();
  });

  it('has an empty state', async () => {
    h.rows = [];
    render(<ModelsPage />);
    expect(await screen.findByText(/No model runs yet/)).toBeInTheDocument();
  });
});

describe('UserDialog accessibility and safety', () => {
  const user = { id: 'u-1', email: 'a@b.in', full_name: 'Ann', role: 'admin', assigned_wellbore_ids: [] };

  it('is a labelled dialog that closes on Escape', () => {
    const onClose = vi.fn();
    render(<UserDialog user={null} onClose={onClose} onSaved={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'Invite User' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Full name')).toBeInTheDocument();
    expect(screen.getByLabelText('Role')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('stops an admin from changing their own role', () => {
    render(<UserDialog user={user} selfId="u-1" onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByLabelText('Role')).toBeDisabled();
    expect(screen.getByText(/cannot change your own role/)).toBeInTheDocument();
  });

  it('lets an admin change someone else', () => {
    render(<UserDialog user={user} selfId="u-2" onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByLabelText('Role')).not.toBeDisabled();
  });
});
