import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { isMockMode } from '../../lib/constants';
import { loadMockProfile, mockSessionFor, readStoredMockId, storeMockId, loadMockProfiles } from './mockAuth';

const noop = async () => ({ error: null });

const AuthContext = createContext({
  session: null,
  profile: null,
  isLoading: true,
  profileError: null,
  isMock: false,
  signIn: noop,
  signInMock: noop,
  signOut: noop,
  resetPassword: noop,
  listMockProfiles: async () => [],
});

/**
 * Holds the session and the caller's `profiles` row (role, full_name, assigned_wellbore_ids).
 *
 * Real mode: Supabase session + `profiles` select of the caller's own row (RLS).
 * Mock mode (VITE_USE_MOCKS=true): the provider itself holds the session (persisted in localStorage
 * by profile id) and takes the profile from fixtures/profiles.json. It does NOT depend on a fake
 * Supabase session; it only best-effort mirrors one through the MSW auth handlers so data-layer
 * code that reads supabase.auth.getSession() keeps working.
 */
export function AuthProvider({ children }) {
  const mock = isMockMode();
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const loadedFor = useRef(null);

  const applyMock = useCallback((p) => {
    storeMockId(p.id);
    loadedFor.current = p.id;
    setSession(mockSessionFor(p));
    setProfile(p);
    setProfileError(null);
    setIsLoading(false);
  }, []);

  const loadProfile = useCallback(async (userId) => {
    try {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (error) throw error;
      loadedFor.current = userId;
      setProfile(data);
      setProfileError(null);
    } catch (e) {
      setProfile(null);
      setProfileError(e?.message || 'Could not load your profile.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (mock) {
      const id = readStoredMockId();
      if (!id) {
        setIsLoading(false);
        return undefined;
      }
      loadMockProfile(id).then((p) => {
        if (cancelled) return;
        if (p) applyMock(p);
        else {
          storeMockId(null);
          setIsLoading(false);
        }
      });
      return () => {
        cancelled = true;
      };
    }

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      if (data.session?.user) loadProfile(data.session.user.id);
      else setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next?.user) {
        if (loadedFor.current !== next.user.id) {
          setIsLoading(true); // keep guards on the spinner until the profile arrives
          // Do not call supabase from inside the auth callback (deadlock); defer a tick.
          setTimeout(() => loadProfile(next.user.id), 0);
        }
      } else {
        loadedFor.current = null;
        setProfile(null);
        setProfileError(null);
        setIsLoading(false);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [mock, applyMock, loadProfile]);

  /** Email + password. Returns {error}. */
  const signIn = useCallback(
    async (email, password) => {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error };
      if (mock && data?.user) {
        const p = await loadMockProfile(data.user.id);
        if (!p) return { error: new Error('Profile not found') };
        applyMock(p);
      }
      return { error: null };
    },
    [mock, applyMock],
  );

  /** Mock role picker: `profileId` is a row of fixtures/profiles.json. */
  const signInMock = useCallback(
    async (profileId) => {
      const p = await loadMockProfile(profileId);
      if (!p) return { error: new Error('Unknown mock profile') };
      applyMock(p);
      // Best effort: mirror a Supabase session through the MSW handlers (never required).
      try {
        await supabase.auth.signInWithPassword({ email: p.email, password: 'mock-password' });
      } catch {
        /* ignore */
      }
      return { error: null };
    },
    [applyMock],
  );

  /** Clears the session and profile everywhere; callers navigate to /login. */
  const signOut = useCallback(async () => {
    storeMockId(null);
    loadedFor.current = null;
    setSession(null);
    setProfile(null);
    setProfileError(null);
    setIsLoading(false);
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      /* already signed out */
    }
    return { error: null };
  }, []);

  const resetPassword = useCallback(async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/login` });
    return { error };
  }, []);

  const value = useMemo(
    () => ({
      session,
      profile,
      isLoading,
      profileError,
      isMock: mock,
      signIn,
      signInMock,
      signOut,
      resetPassword,
      listMockProfiles: loadMockProfiles,
    }),
    [session, profile, isLoading, profileError, mock, signIn, signInMock, signOut, resetPassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
