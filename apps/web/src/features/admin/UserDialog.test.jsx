import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UserDialog } from './UsersPage';

describe('UserDialog validation', () => {
  it('shows error when email or full name is missing on invite', () => {
    const onSaved = vi.fn();
    render(<UserDialog onClose={() => {}} onSaved={onSaved} />);
    
    const saveButton = screen.getByText('Save');
    fireEvent.click(saveButton);
    
    expect(screen.getByText('Email is required')).toBeDefined();
    expect(screen.getByText('Full name is required')).toBeDefined();
    expect(onSaved).not.toHaveBeenCalled();
    
    // Test invalid email format
    const emailInput = screen.getByTestId('email-input');
    fireEvent.change(emailInput, { target: { value: 'not-an-email' } });
    fireEvent.click(saveButton);
    expect(screen.getByText('Invalid email')).toBeDefined();
  });

  it('allows save when valid data is provided', () => {
    const onSaved = vi.fn();
    render(<UserDialog onClose={() => {}} onSaved={onSaved} />);
    
    fireEvent.change(screen.getByTestId('email-input'), { target: { value: 'test@oilindia.in' } });
    fireEvent.change(screen.getByTestId('name-input'), { target: { value: 'Test User' } });
    
    fireEvent.click(screen.getByText('Save'));
    
    // We expect an API call to be attempted, the state sets 'saving' and clears errors.
    expect(screen.queryByText('Email is required')).toBeNull();
    expect(screen.queryByText('Invalid email')).toBeNull();
  });

  it('hides email/name inputs when editing an existing user', () => {
    const user = { id: 'uuid-1', email: 'test@oilindia.in', full_name: 'Test', role: 'rig_engineer', assigned_wellbore_ids: [] };
    render(<UserDialog user={user} onClose={() => {}} onSaved={() => {}} />);
    
    expect(screen.queryByTestId('email-input')).toBeNull();
    expect(screen.queryByTestId('name-input')).toBeNull();
    expect(screen.getByText('Edit User')).toBeDefined();
  });
});
