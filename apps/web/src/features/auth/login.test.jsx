import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const h = vi.hoisted(() => {
  const listeners = [];
  const profileRow = { id: 'u-1', email: 'r@x.in', full_name: 'Real Rtoc', role: 'rtoc_engineer', assigned_wellbore_ids: [] };
  const state = { session: null, profileResult: { data: profileRow, error: null } };
  const supabase = {
    auth: {
      signInWithPassword: vi.fn(),
      signOut: vi.fn(async () => ({ error: null })),
      resetPasswordForEmail: vi.fn(async () => ({ error: null })),
      getSession: vi.fn(async () => ({ data: { session: state.session } })),
      onAuthStateChange: vi.fn((cb) => {
        listeners.push(cb);
        return { data: { subscription: { unsubscribe() {} } } };
      }),
    },
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ single: async () => state.profileResult }) }) })),
  };
  return { supabase, listeners, state, profileRow };
});
vi.mock('../../lib/supabase', () => ({ supabase: h.supabase }));

import { AuthProvider } from './AuthProvider';
import { LoginPage } from './LoginPage';
import { RequireRole } from './RequireRole';

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<RequireRole><div>HOME</div></RequireRole>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubEnv('VITE_USE_MOCKS', 'false');
  window.localStorage.clear();
  h.state.session = null;
  h.state.profileResult = { data: h.profileRow, error: null };
  h.listeners.length = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('LoginPage (real mode)', () => {
  it('does not show the mock role picker', async () => {
    renderLogin();
    expect(await screen.findByRole('heading', { name: /Sign in/i })).toBeInTheDocument();
    expect(screen.queryByText(/Mock mode/i)).toBeNull();
  });

  it('shows the plain error message when sign-in fails', async () => {
    const user = userEvent.setup();
    h.supabase.auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: { message: 'Invalid login credentials' } });
    renderLogin();
    await user.type(await screen.findByLabelText('Email'), 'a@b.in');
    await user.type(screen.getByLabelText('Password'), 'nope');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials');
    expect(h.supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.in', password: 'nope' });
  });

  it('loads the profile after sign-in and lands on the protected page', async () => {
    const user = userEvent.setup();
    h.supabase.auth.signInWithPassword.mockImplementationOnce(async () => {
      h.listeners.forEach((cb) => cb('SIGNED_IN', { access_token: 't', user: { id: 'u-1' } }));
      return { data: { user: { id: 'u-1' } }, error: null };
    });
    renderLogin();
    await user.type(await screen.findByLabelText('Email'), 'r@x.in');
    await user.type(screen.getByLabelText('Password'), 'pw');
    await user.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(await screen.findByText('HOME')).toBeInTheDocument();
    expect(h.supabase.from).toHaveBeenCalledWith('profiles');
  });

  it('Forgot password calls resetPasswordForEmail and confirms without revealing the account', async () => {
    const user = userEvent.setup();
    renderLogin();
    await user.click(await screen.findByRole('button', { name: 'Forgot password?' }));
    await user.type(screen.getByLabelText('Email'), 'someone@x.in');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    await waitFor(() => expect(h.supabase.auth.resetPasswordForEmail).toHaveBeenCalled());
    expect(h.supabase.auth.resetPasswordForEmail.mock.calls[0][0]).toBe('someone@x.in');
    expect(await screen.findByRole('status')).toHaveTextContent(/If an account exists for someone@x.in/);
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('shows a reset error plainly', async () => {
    const user = userEvent.setup();
    h.supabase.auth.resetPasswordForEmail.mockResolvedValueOnce({ error: { message: 'Rate limit exceeded' } });
    renderLogin();
    await user.click(await screen.findByRole('button', { name: 'Forgot password?' }));
    await user.type(screen.getByLabelText('Email'), 'a@b.in');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Rate limit exceeded');
  });
});

describe('AuthProvider (real mode)', () => {
  it('restores an existing Supabase session and its profile', async () => {
    h.state.session = { access_token: 't', user: { id: 'u-1' } };
    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<RequireRole roles={['rtoc_engineer']}><div>HOME</div></RequireRole>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('HOME')).toBeInTheDocument();
  });

  it('reports a missing profile row instead of looping to /login', async () => {
    h.state.session = { access_token: 't', user: { id: 'u-1' } };
    h.state.profileResult = { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<RequireRole><div>HOME</div></RequireRole>} />
            <Route path="/login" element={<div>LOGIN</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Your profile could not be loaded')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('LOGIN')).toBeInTheDocument();
    expect(h.supabase.auth.signOut).toHaveBeenCalled();
  });
});
