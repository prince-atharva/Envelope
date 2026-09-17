import type { LoginInput, RegisterInput, UserProfile } from '@digitalsign/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { api, onSessionChange, refreshSession } from './api';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: AuthStatus;
  user: UserProfile | null;
  login(input: LoginInput): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Holds who is signed in. On load it tries to restore the session from the
 * refresh cookie; the access token itself only ever lives in memory.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    const unsubscribe = onSessionChange((session) => {
      setUser(session?.user ?? null);
      setStatus(session ? 'authenticated' : 'anonymous');
      if (!session) queryClient.clear();
    });
    void refreshSession({ retryOnRace: false }).then((session) => {
      if (!session) setStatus('anonymous');
    });
    return unsubscribe;
  }, [queryClient]);

  const login = useCallback(async (input: LoginInput) => {
    await api.login(input);
  }, []);
  const register = useCallback(async (input: RegisterInput) => {
    await api.register(input);
  }, []);
  const logout = useCallback(async () => {
    await api.logout();
  }, []);

  const value = useMemo(
    () => ({ status, user, login, register, logout }),
    [status, user, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
