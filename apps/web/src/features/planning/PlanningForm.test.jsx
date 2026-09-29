import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlanningForm } from './PlanningForm';

describe('PlanningForm validation', () => {
  it('shows error when lat or lon is missing or invalid', () => {
    const onSubmit = vi.fn();
    render(<PlanningForm onSubmit={onSubmit} loading={false} />);
    
    // Clear the latitude
    const latInput = screen.getByTestId('lat-input');
    fireEvent.change(latInput, { target: { value: '' } });
    
    const submitButton = screen.getByText('Generate Planning Brief');
    fireEvent.click(submitButton);
    
    expect(screen.getByText('Invalid Latitude')).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();
    
    // Invalid lat value
    fireEvent.change(latInput, { target: { value: '95' } }); // > 90
    fireEvent.click(submitButton);
    expect(screen.getByText('Invalid Latitude')).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows error when TD is <= 0', () => {
    const onSubmit = vi.fn();
    render(<PlanningForm onSubmit={onSubmit} loading={false} />);
    
    const tdInput = screen.getByTestId('td-input');
    fireEvent.change(tdInput, { target: { value: '-10' } });
    
    fireEvent.click(screen.getByText('Generate Planning Brief'));
    
    expect(screen.getByText('TD must be > 0')).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits valid data', () => {
    const onSubmit = vi.fn();
    render(<PlanningForm onSubmit={onSubmit} loading={false} />);
    
    const submitButton = screen.getByText('Generate Planning Brief');
    fireEvent.click(submitButton);
    
    expect(onSubmit).toHaveBeenCalledWith({
      lat: 27.35,
      lon: 95.3,
      planned_td_m: 3600,
      radius_m: 10000
    });
  });
});
