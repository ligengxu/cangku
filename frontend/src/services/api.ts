import axios from 'axios';
import { message } from 'antd';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      const url = error.config?.url || '';
      // Don't redirect on login endpoint
      if (!url.includes('/auth/login') && typeof window !== 'undefined') {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        if (!window.location.pathname.includes('/login')) {
          message.warning('登录已过期，请重新登录');
          window.location.href = '/login';
        }
      }
    } else if (error.response?.status === 409) {
      if (typeof window !== 'undefined') {
        const detail = error.response?.data?.detail || '检测到重复操作，请确认';
        message.warning(detail);
      }
    } else if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      if (typeof window !== 'undefined') message.error('请求超时，请稍后重试');
    } else if (error.response?.status === 500) {
      if (typeof window !== 'undefined') message.error('服务器错误，请稍后重试');
    }
    return Promise.reject(error);
  }
);

export default api;
