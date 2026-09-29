import { useAuth } from './AuthProvider';

export function useProfile() {
  const { profile, session, isLoading } = useAuth();
  return { profile, session, isLoading };
}
