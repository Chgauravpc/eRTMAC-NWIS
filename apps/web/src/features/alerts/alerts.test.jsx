import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { DismissDialog } from './DismissDialog';
import { AlertActions } from './AlertActions';

describe('DismissDialog', () => {
  it('validates dismiss reason length (>= 5 chars)', async () => {
    const alert = { id: 'a1' };
    const { getByText, getByLabelText } = render(<DismissDialog alert={alert} onClose={() => {}} onDismissed={() => {}} />);
    
    // Attempt empty
    fireEvent.click(getByText('Dismiss Alert'));
    expect(getByText('Reason must be at least 5 characters.')).toBeTruthy();
    
    // Attempt short
    fireEvent.change(getByLabelText(/Reason for dismissal/i), { target: { value: 'bad' } });
    fireEvent.click(getByText('Dismiss Alert'));
    expect(getByText('Reason must be at least 5 characters.')).toBeTruthy();
  });
});

describe('AlertActions visibility by Role/State', () => {
  it('hides resolve/dismiss buttons for Rig Engineer on warning alerts', () => {
    // Rig engineers can acknowledge warning/critical, but cannot resolve or dismiss them.
    const alert = { id: 'a1', state: 'sent', severity: 'warning', wellbore_id: 'w1' };
    const rigEng = { id: 'rg1', role: 'rig_engineer', assigned_wellbore_ids: ['w1'] };
    
    const { queryByText } = render(<AlertActions alert={alert} user={rigEng} onStateChange={() => {}} />);
    
    expect(queryByText('Acknowledge')).toBeTruthy();
    expect(queryByText('Resolve')).toBeNull();
    expect(queryByText('Dismiss')).toBeNull();
  });

  it('shows resolve/dismiss for Rig Engineer on info alerts', () => {
    const alert = { id: 'a2', state: 'sent', severity: 'info', wellbore_id: 'w1' };
    const rigEng = { id: 'rg1', role: 'rig_engineer', assigned_wellbore_ids: ['w1'] };
    
    const { queryByText } = render(<AlertActions alert={alert} user={rigEng} onStateChange={() => {}} />);
    
    expect(queryByText('Acknowledge')).toBeTruthy(); // Info alerts don't mandate Ack but allowed by permissions logic (canAcknowledge allows sent/viewed)
    expect(queryByText('Resolve')).toBeTruthy();
    expect(queryByText('Dismiss')).toBeTruthy();
  });
});
