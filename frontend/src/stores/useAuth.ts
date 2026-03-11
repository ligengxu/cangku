import { create } from 'zustand';
import type { UserInfo } from '@/types';
import { getStoredUser } from '@/services/auth';

interface AuthState {
  user: UserInfo | null;
  setUser: (user: UserInfo | null) => void;
  isAdmin: () => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: typeof window !== 'undefined' ? getStoredUser() : null,
  setUser: (user) => set({ user }),
  isAdmin: () => get().user?.role === 'admin',
}));
