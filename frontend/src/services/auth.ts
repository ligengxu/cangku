import api from './api';
import type { ApiResponse, UserInfo } from '@/types';

interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: UserInfo;
}

export async function login(username: string, password: string, remember = false) {
  const res = await api.post<ApiResponse<LoginResponse>>('/auth/login', { username, password, remember });
  const { access_token, user } = res.data.data!;
  localStorage.setItem('token', access_token);
  localStorage.setItem('user', JSON.stringify(user));
  return user;
}

export async function getMe() {
  const res = await api.get<ApiResponse<UserInfo>>('/auth/me');
  return res.data.data!;
}

export function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login';
}

export function getStoredUser(): UserInfo | null {
  if (typeof window === 'undefined') return null;
  const data = localStorage.getItem('user');
  return data ? JSON.parse(data) : null;
}

export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem('token');
}
