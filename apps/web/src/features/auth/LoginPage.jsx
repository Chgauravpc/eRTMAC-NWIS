import React, { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button, cn, FOCUS_RING } from '../../components/ui/Primitives';
import { ROLE_LABELS } from '../../lib/constants';
import { useProfile } from './useProfile';
import { ArrowLeft, HelpCircle } from 'lucide-react';

const INPUT = cn(
  'mt-1 block w-full rounded border border-gray-200 bg-white p-3 text-sm shadow-sm transition-colors',
  'focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900'
);
const LABEL = 'mb-1 block text-xs font-semibold text-gray-700';

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
    setBusy(true);
    const { error: err } = await signInMock(id);
    setBusy(false);
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
    <div className="flex min-h-screen w-full bg-white font-sans text-gray-900">
      {/* Left panel - Dark navy branding */}
      <div className="relative hidden w-1/2 flex-col justify-between bg-[#111827] p-12 text-white lg:flex overflow-hidden">
        {/* Background watermark */}
        <div className="pointer-events-none absolute -bottom-24 -right-12 select-none text-[240px] font-black leading-none tracking-tighter text-white/[0.02]">
          NWIS
        </div>

        <div className="relative z-10">
          <div className="mb-16 flex items-center gap-2 font-bold tracking-wider">
            <div className="flex h-5 items-end gap-0.5">
              <div className="h-2 w-1.5 rounded-sm bg-orange-400" />
              <div className="h-3.5 w-1.5 rounded-sm bg-orange-400" />
              <div className="h-5 w-1.5 rounded-sm bg-orange-400" />
            </div>
            NWIS
          </div>

          <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">
            NATIONAL WELL INTELLIGENCE SYSTEM • OIL INDIA LIMITED
          </div>

          <h1 className="mb-6 text-6xl font-medium tracking-tight">
            Know what's ahead.<br />
            <span className="text-[#f1a260]">Before the bit gets<br />there.</span>
          </h1>

          <p className="max-w-md text-sm leading-relaxed text-gray-400">
            A decision layer for drilling teams — connecting offset evidence,
            formation intelligence, and real-time awareness in one precise
            workspace.
          </p>
        </div>

        <div className="relative z-10 flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-gray-500">
          <div className="flex items-center gap-3">
            <div className="h-[1px] w-8 bg-orange-400/50" />
            Systems nominal
          </div>
          <div>eRTMAC-NWIS / 01</div>
        </div>
      </div>

      {/* Right panel - Login form */}
      <div className="flex w-full flex-col p-8 lg:w-1/2 lg:p-12 xl:p-24">
        <div className="mb-12 flex items-center justify-between text-xs font-medium text-gray-500">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-gray-600 hover:text-gray-950 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Overview</span>
          </Link>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">
            <span>SECURE WORKSPACE</span>
            <HelpCircle className="h-3.5 w-3.5" />
          </div>
        </div>

        <div className="mx-auto w-full max-w-md flex-1">
          <h2 className="mb-2 text-3xl font-medium tracking-tight text-gray-950">
            {mode === 'reset' ? 'Reset your password' : 'Sign in to NWIS'}
          </h2>
          <p className="mb-8 text-sm text-gray-500">
            {mode === 'reset' ? 'Enter your account email to receive a password reset link.' : 'Enter the operations workspace.'}
          </p>

          {error && (
            <div role="alert" className="mb-6 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {notice && (
            <div role="status" className="mb-6 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              {notice}
            </div>
          )}

          {mode === 'login' && isMock && (
            <section aria-label="Mock roles" className="mb-8">
              <p className="text-xs uppercase font-bold tracking-wider text-gray-400 mb-3">
                Mock mode is active. Sign in as one of the demo users:
              </p>
              <div className="space-y-2.5">
                {mockProfiles.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleMockLogin(p.id)}
                    disabled={busy}
                    className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white p-3.5 text-left shadow-sm transition-all hover:border-gray-900 hover:bg-gray-50 disabled:opacity-60"
                  >
                    <div>
                      <div className="font-bold text-sm text-gray-900">
                        Log in as {ROLE_LABELS[p.role] || p.role}
                      </div>
                      <div className="text-xs text-gray-500">{p.full_name}</div>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                  </button>
                ))}
              </div>
              <div className="flex items-center my-6">
                <div className="h-px flex-1 bg-gray-200"></div>
                <span className="px-4 text-[10px] font-bold uppercase tracking-widest text-gray-400">Or use email</span>
                <div className="h-px flex-1 bg-gray-200"></div>
              </div>
            </section>
          )}

          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label htmlFor="login-email" className={LABEL}>Email</label>
                <input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="username"
                  className={INPUT}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="login-password" className={LABEL}>Password</label>
                  <button
                    type="button"
                    className="text-xs text-neutral-600 hover:text-neutral-950 underline"
                    onClick={() => {
                      setMode('reset');
                      setError(null);
                      setNotice(null);
                    }}
                  >
                    Forgot password?
                  </button>
                </div>
                <input
                  id="login-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  className={INPUT}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-[#111827] px-4 py-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-black disabled:opacity-60"
              >
                {busy ? 'Signing in...' : 'Sign In'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </form>
          ) : (
            <form onSubmit={handleReset} className="space-y-5">
              <p className="text-sm text-gray-600">
                Enter your account email and we will send you a reset link.
              </p>
              <div>
                <label htmlFor="reset-email" className={LABEL}>Email</label>
                <input
                  id="reset-email"
                  type="email"
                  required
                  autoComplete="username"
                  className={INPUT}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <button
                type="submit"
                disabled={busy}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-[#111827] px-4 py-3.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-black disabled:opacity-60"
              >
                {busy ? 'Sending...' : 'Send reset link'}
              </button>

              <div className="pt-3 text-center">
                <button
                  type="button"
                  className="text-xs text-neutral-600 hover:text-neutral-950 underline"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                    setNotice(null);
                  }}
                >
                  Back to sign in
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="mt-auto pt-8 flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-gray-400">
          <div>OIL INDIA LIMITED · SIH26121</div>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live operations feed
          </div>
        </div>
      </div>
    </div>
  );
}
