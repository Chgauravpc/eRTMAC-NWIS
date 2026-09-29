import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { RadiusControl } from './RadiusControl';

describe('RadiusControl mappings', () => {
  it('calls onChange with correct parsed numeric values when sliders move', () => {
    const onChange = vi.fn();
    const params = { radius: 10000, depth: 0, mode: 'surface', formation: '', eventType: '' };
    
    render(<RadiusControl params={params} onChange={onChange} />);

    const radiusSlider = screen.getByLabelText(/Radius/i);
    fireEvent.change(radiusSlider, { target: { value: '15000' } });

    expect(onChange).toHaveBeenCalled();
    const callback = onChange.mock.calls[0][0];
    // Evaluate the state update function with the previous state
    const nextState = callback(params);
    expect(nextState.radius).toBe(15000);
  });

  it('toggles mode correctly', () => {
    const onChange = vi.fn();
    const params = { radius: 10000, depth: 0, mode: 'surface', formation: '', eventType: '' };
    
    render(<RadiusControl params={params} onChange={onChange} />);

    const modeToggle = screen.getByLabelText(/Distance at depth/i);
    fireEvent.click(modeToggle);

    const callback = onChange.mock.calls[0][0];
    const nextState = callback(params);
    expect(nextState.mode).toBe('depth');
  });
});
