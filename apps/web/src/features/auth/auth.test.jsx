import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RequireRole } from './RequireRole';
import { useProfile } from './useProfile';

vi.mock('./useProfile');

describe('RequireRole', () => {
  it('redirects to /login when not authenticated', () => {
    useProfile.mockReturnValue({ session: null, profile: null, isLoading: false });
    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route path="/protected" element={
            <RequireRole><div data-testid="protected">Content</div></RequireRole>
          } />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('Login Page')).toBeTruthy();
  });

  it('shows 403 Forbidden when role does not match', () => {
    useProfile.mockReturnValue({
      session: { user: {} },
      profile: { role: 'office_engineer' },
      isLoading: false
    });
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={
            <RequireRole roles={['admin']}><div data-testid="admin">Admin Content</div></RequireRole>
          } />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText(/403 Forbidden/i)).toBeTruthy();
  });

  it('renders content when role matches', () => {
    useProfile.mockReturnValue({
      session: { user: {} },
      profile: { role: 'admin' },
      isLoading: false
    });
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <Routes>
          <Route path="/admin" element={
            <RequireRole roles={['admin', 'rtoc_engineer']}><div data-testid="admin">Admin Content</div></RequireRole>
          } />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('admin')).toBeTruthy();
  });
});
