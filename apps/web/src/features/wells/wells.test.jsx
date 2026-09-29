import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WellsPage } from './WellsPage';
import { useWells } from '../../lib/hooks/wells';

vi.mock('../../lib/hooks/wells');

describe('WellsPage', () => {
  it('renders drilling wells first', () => {
    useWells.mockReturnValue({
      isLoading: false,
      data: [
        { wellbore_id: '1', well_name: 'Well A', status: 'completed' },
        { wellbore_id: '2', well_name: 'Well B', status: 'drilling' },
      ]
    });

    render(
      <MemoryRouter>
        <WellsPage />
      </MemoryRouter>
    );

    expect(screen.getByText('Active Drilling Wells')).toBeTruthy();
    const allB = screen.getAllByText('Well B');
    expect(allB.length).toBeGreaterThan(0);
  });
});
