// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { ReplayPanel } from './ReplayPanel';
import * as useProfileHooks from '../auth/useProfile';

vi.mock('../../lib/api', () => ({
  apiFetch: vi.fn()
}));

describe('ReplayPanel', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });
  it('does not render for office_engineer', () => {
    vi.spyOn(useProfileHooks, 'useProfile').mockReturnValue({ profile: { role: 'office_engineer' } });
    const { container } = render(<ReplayPanel wellboreId="w1" streamState={{ status: 'stopped' }} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders for rtoc_engineer', () => {
    vi.spyOn(useProfileHooks, 'useProfile').mockReturnValue({ profile: { role: 'rtoc_engineer' } });
    render(<ReplayPanel wellboreId="w1" streamState={{ status: 'stopped' }} />);
    expect(screen.getByText('Replay Controls')).toBeDefined();
  });

  it('enables Start and disables Stop when stopped', () => {
    vi.spyOn(useProfileHooks, 'useProfile').mockReturnValue({ profile: { role: 'admin' } });
    render(<ReplayPanel wellboreId="w1" streamState={{ status: 'stopped' }} />);
    
    expect(screen.getByRole('button', { name: 'Start' }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Stop' }).disabled).toBe(true);
    expect(screen.getByRole('combobox').disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Drop 45s' }).disabled).toBe(true);
  });

  it('enables Stop, Speed, and Drop when live', () => {
    vi.spyOn(useProfileHooks, 'useProfile').mockReturnValue({ profile: { role: 'admin' } });
    render(<ReplayPanel wellboreId="w1" streamState={{ status: 'live' }} />);
    
    expect(screen.getByRole('button', { name: 'Start' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Stop' }).disabled).toBe(false);
    expect(screen.getByRole('combobox').disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Drop 45s' }).disabled).toBe(false);
  });
});
