import { useAuth } from './AuthProvider';

/** Session + profile + auth actions (signOut, ...). Components should use this, not supabase directly. */
export function useProfile() {
  return useAuth();
}
