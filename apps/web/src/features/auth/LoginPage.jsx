import React, { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { cn, FOCUS_RING } from '../../components/ui/Primitives';
import { ROLE_LABELS } from '../../lib/constants';
import { useProfile } from './useProfile';
import { HelpCircle } from 'lucide-react';

const INPUT = cn(
  'mt-1 block w-full rounded border border-gray-200 bg-white p-3 text-sm shadow-sm transition-colors',
  'focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900'
);
const LABEL = "mb-1 block text-[10px] font-bold uppercase tracking-widest text-gray-400";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, profile, isMock, signIn, signInMock, listMockProfiles } = useProfile();
  const from = location.state?.from?.pathname || '/';

  const [email, setEmail] = useState('engineer@nwis.gov');
  const [password, setPassword] = useState('password123');
  const [selectedRole, setSelectedRole] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mockProfiles, setMockProfiles] = useState([]);

  useEffect(() => {
    if (!isMock) return;
    let cancelled = false;
    listMockProfiles().then((rows) => {
      if (!cancelled) {
        setMockProfiles(rows);
        if (rows.length > 0 && !selectedRole) {
          const rtoc = rows.find(r => r.role === 'rtoc_engineer') || rows[0];
          setSelectedRole(rtoc.id);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isMock, listMockProfiles, selectedRole]);

  if (session && profile) return <Navigate to={from} replace />;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    
    const { error: err } = await signIn(email.trim(), password);
    if (err) setError(err.message || 'Sign-in failed.');
    else navigate(from, { replace: true });
    
    setBusy(false);
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
            NATIONAL WELL INTELLIGENCE SYSTEM • 04.26
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
          <div>NWIS / 01</div>
        </div>
      </div>

      {/* Right panel - Login form */}
      <div className="flex w-full flex-col p-8 lg:w-1/2 lg:p-12 xl:p-24">
        <div className="mb-16 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">
          <div>SECURE WORKSPACE</div>
          <HelpCircle className="h-4 w-4" />
        </div>

        <div className="mx-auto w-full max-w-md flex-1">
          <h2 className="mb-2 text-3xl font-medium tracking-tight">Welcome back</h2>
          <p className="mb-10 text-sm text-gray-500">Enter the operations workspace.</p>

          {error && (
            <div role="alert" className="mb-6 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {isMock && (
            <div className="space-y-3 mb-8">
              <div className="mb-4 flex items-baseline justify-between">
                <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Select Demo Role</span>
                <span className="text-[10px] text-gray-400">Mock access · no account required</span>
              </div>
              {mockProfiles.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setSelectedRole(p.id);
                    setBusy(true);
                    signInMock(p.id).then(({ error: err }) => {
                      if (err) setError(err.message);
                      else navigate(from, { replace: true });
                      setBusy(false);
                    });
                  }}
                  disabled={busy}
                  className="flex w-full items-center justify-between rounded border border-gray-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-gray-900 hover:bg-gray-50 disabled:opacity-70"
                >
                  <div>
                    <div className="font-bold text-gray-900">{p.full_name}</div>
                    <div className="text-xs text-gray-500">{ROLE_LABELS[p.role] || p.role}</div>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                </button>
              ))}
            </div>
          )}

          {isMock && (
            <div className="flex items-center my-8">
              <div className="h-px flex-1 bg-gray-200"></div>
              <span className="px-4 text-[10px] font-bold uppercase tracking-widest text-gray-400">Or use email</span>
              <div className="h-px flex-1 bg-gray-200"></div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="email" className={LABEL}>Email Address</label>
              <input
                id="email"
                type="email"
                required
                className={INPUT}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            
            <div>
              <label htmlFor="password" className={LABEL}>Password</label>
              <div className="relative">
                <input
                  id="password"
                  type="password"
                  required
                  className={INPUT}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-widest text-gray-400 hover:text-gray-700">
                  Show
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="mt-8 flex w-full items-center justify-center gap-2 rounded bg-[#111827] px-4 py-3.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-70"
            >
              {busy ? 'Entering...' : 'Enter workspace'} 
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          </form>
        </div>

        <div className="mt-auto flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-gray-400">
          <div>Demo environment</div>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Live simulation feed
          </div>
        </div>
      </div>
    </div>
  );
}

