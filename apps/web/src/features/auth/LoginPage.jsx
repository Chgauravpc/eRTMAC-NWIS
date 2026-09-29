import React, { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button, Card, cn, FOCUS_RING } from '../../components/ui/Primitives';
import { ROLE_LABELS } from '../../lib/constants';
import { useProfile } from './useProfile';

const INPUT = cn('mt-1 block w-full rounded border border-gray-300 shadow-sm p-2', FOCUS_RING);

/** Email + password login, "Forgot password", and (mock mode only) a role picker. */
export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, profile, isMock, signIn, signInMock, resetPassword, listMockProfiles } = useProfile();
  const from = location.state?.from?.pathname || '/';

  const [mode, setMode] = useState('login'); // 'login' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mockProfiles, setMockProfiles] = useState([]);

  useEffect(() => {
    if (!isMock) return undefined;
    let cancelled = false;
    listMockProfiles().then((rows) => {
      if (!cancelled) setMockProfiles(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [isMock, listMockProfiles]);

  if (session && profile) return <Navigate to={from} replace />;

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: err } = await signIn(email.trim(), password);
    setBusy(false);
    if (err) setError(err.message || 'Sign-in failed.');
    else navigate(from, { replace: true });
  };

  const handleMockLogin = async (id) => {
    setError(null);
    const { error: err } = await signInMock(id);
    if (err) setError(err.message);
    else navigate(from, { replace: true });
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    const { error: err } = await resetPassword(email.trim());
    setBusy(false);
    if (err) setError(err.message || 'Could not send the reset link.');
    else setNotice(`If an account exists for ${email.trim()}, a password reset link has been sent.`);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <div className="mb-3">
          <Link to="/" className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900 transition-colors">
            <span>&larr; Back to Overview</span>
          </Link>
        </div>
        <h1 className="text-2xl font-bold mb-4">{mode === 'reset' ? 'Reset your password' : 'Sign in to NWIS'}</h1>

        {error && (
          <div role="alert" className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="mb-3 rounded bg-green-50 p-2 text-sm text-green-800">
            {notice}
          </div>
        )}

        {mode === 'login' && isMock && (
          <section aria-label="Mock roles" className="mb-5">
            <p className="text-sm text-gray-600 mb-2">Mock mode is active. Sign in as one of the demo users:</p>
            <ul className="space-y-2">
              {mockProfiles.map((p) => (
                <li key={p.id}>
                  <Button variant="outline" className="w-full text-left flex flex-col items-start" onClick={() => handleMockLogin(p.id)}>
                    <span>Log in as {ROLE_LABELS[p.role] || p.role}</span>
                    <span className="text-xs font-normal text-gray-500">{p.full_name}</span>
                  </Button>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs uppercase tracking-wide text-gray-500">Or use email and password</p>
          </section>
        )}

        {mode === 'login' ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-gray-700">Email</label>
              <input id="login-email" type="email" required autoComplete="username" className={INPUT} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-gray-700">Password</label>
              <input id="login-password" type="password" required autoComplete="current-password" className={INPUT} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Signing in...' : 'Sign In'}</Button>
            <button
              type="button"
              className={cn('text-sm text-blue-700 underline rounded', FOCUS_RING)}
              onClick={() => {
                setMode('reset');
                setError(null);
                setNotice(null);
              }}
            >
              Forgot password?
            </button>
          </form>
        ) : (
          <form onSubmit={handleReset} className="space-y-4">
            <p className="text-sm text-gray-600">Enter your account email and we will send you a reset link.</p>
            <div>
              <label htmlFor="reset-email" className="block text-sm font-medium text-gray-700">Email</label>
              <input id="reset-email" type="email" required autoComplete="username" className={INPUT} value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Sending...' : 'Send reset link'}</Button>
            <button
              type="button"
              className={cn('text-sm text-blue-700 underline rounded', FOCUS_RING)}
              onClick={() => {
                setMode('login');
                setError(null);
                setNotice(null);
              }}
            >
              Back to sign in
            </button>
          </form>
        )}
      </Card>
    </div>
  );
}
