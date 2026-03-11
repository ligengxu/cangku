'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Badge, Dropdown, Avatar, message, Modal, Form, Input } from 'antd';
import {
  HomeOutlined, AppstoreOutlined, ExperimentOutlined,
  BellOutlined, UserOutlined, LogoutOutlined, KeyOutlined,
  ThunderboltOutlined, BugOutlined, SettingOutlined,
} from '@ant-design/icons';
import { useAuth } from '@/stores/useAuth';
import { logout } from '@/services/auth';
import api from '@/services/api';

interface TabItem {
  key: string;
  icon: React.ReactNode;
  activeIcon: React.ReactNode;
  label: string;
  badge?: number;
}

export default function WorkerMobileLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const [msgCount, setMsgCount] = useState(0);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdForm] = Form.useForm();

  useEffect(() => {
    const fetchUnread = async () => {
      try {
        const r = await api.get('/system/messages/unread-count');
        setMsgCount((r.data as any)?.data?.count ?? 0);
      } catch { setMsgCount(0); }
    };
    fetchUnread();
    const id = setInterval(fetchUnread, 30000);
    return () => clearInterval(id);
  }, []);

  const tabs: TabItem[] = [
    {
      key: '/dashboard',
      icon: <HomeOutlined style={{ fontSize: 22 }} />,
      activeIcon: <HomeOutlined style={{ fontSize: 22 }} />,
      label: '首页',
    },
    {
      key: '/production/request',
      icon: <AppstoreOutlined style={{ fontSize: 22 }} />,
      activeIcon: <AppstoreOutlined style={{ fontSize: 22 }} />,
      label: '任务',
    },
    {
      key: '/production/input',
      icon: <ExperimentOutlined style={{ fontSize: 22 }} />,
      activeIcon: <ExperimentOutlined style={{ fontSize: 22 }} />,
      label: '录入',
    },
    {
      key: '/messages',
      icon: <BellOutlined style={{ fontSize: 22 }} />,
      activeIcon: <BellOutlined style={{ fontSize: 22 }} />,
      label: '消息',
      badge: msgCount,
    },
    {
      key: '/profile',
      icon: <UserOutlined style={{ fontSize: 22 }} />,
      activeIcon: <UserOutlined style={{ fontSize: 22 }} />,
      label: '我的',
    },
  ];

  const isActive = (key: string) => {
    if (key === '/profile') {
      return ['/profile', '/workers/performance', '/system/bugs'].includes(pathname);
    }
    return pathname === key || pathname.startsWith(key + '/');
  };

  const handleChangePassword = async () => {
    const vals = await pwdForm.validateFields();
    if (vals.new_password !== vals.confirm_password) {
      message.error('两次密码不一致');
      return;
    }
    setPwdLoading(true);
    try {
      await api.post('/auth/change-password', {
        old_password: vals.old_password,
        new_password: vals.new_password,
      });
      message.success('密码修改成功，请重新登录');
      setPwdOpen(false);
      pwdForm.resetFields();
      setTimeout(() => logout(), 1500);
    } catch (e: any) {
      message.error(e?.response?.data?.detail ?? '密码修改失败');
    } finally {
      setPwdLoading(false);
    }
  };

  return (
    <div className="worker-mobile-root">
      <div className="worker-mobile-content">
        {children}
      </div>

      <div className="worker-mobile-tabbar">
        {tabs.map((tab) => {
          const active = isActive(tab.key);
          return (
            <div
              key={tab.key}
              className={`worker-tab-item ${active ? 'active' : ''}`}
              onClick={() => router.push(tab.key)}
            >
              <div className="worker-tab-icon">
                {tab.badge && tab.badge > 0 ? (
                  <Badge count={tab.badge} size="small" offset={[4, -2]}>
                    {active ? tab.activeIcon : tab.icon}
                  </Badge>
                ) : (
                  active ? tab.activeIcon : tab.icon
                )}
              </div>
              <span className="worker-tab-label">{tab.label}</span>
              {active && <div className="worker-tab-indicator" />}
            </div>
          );
        })}
      </div>

      <Modal
        title="修改密码"
        open={pwdOpen}
        onOk={handleChangePassword}
        onCancel={() => { setPwdOpen(false); pwdForm.resetFields(); }}
        confirmLoading={pwdLoading}
        okText="确认修改"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={pwdForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="old_password" label="原密码" rules={[{ required: true, message: '请输入原密码' }]}>
            <Input.Password placeholder="当前密码" />
          </Form.Item>
          <Form.Item name="new_password" label="新密码" rules={[{ required: true, message: '请输入新密码' }, { min: 6, message: '密码至少 6 位' }]}>
            <Input.Password placeholder="6 位以上新密码" />
          </Form.Item>
          <Form.Item name="confirm_password" label="确认密码" rules={[{ required: true, message: '请确认新密码' }]}>
            <Input.Password placeholder="再次输入新密码" />
          </Form.Item>
        </Form>
      </Modal>

      <style jsx global>{`
        .worker-mobile-root {
          display: flex;
          flex-direction: column;
          min-height: 100vh;
          min-height: 100dvh;
          background: var(--bg-page);
          position: relative;
        }

        .worker-mobile-content {
          flex: 1;
          overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          padding-bottom: calc(68px + env(safe-area-inset-bottom, 0px));
        }

        .worker-mobile-tabbar {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          height: calc(64px + env(safe-area-inset-bottom, 0px));
          padding-bottom: env(safe-area-inset-bottom, 0px);
          display: flex;
          align-items: center;
          justify-content: space-around;
          background: rgba(255, 255, 255, 0.92);
          backdrop-filter: blur(20px) saturate(180%);
          -webkit-backdrop-filter: blur(20px) saturate(180%);
          border-top: 0.5px solid rgba(0, 0, 0, 0.06);
          z-index: 1000;
          box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.04);
        }

        [data-theme='dark'] .worker-mobile-tabbar {
          background: rgba(30, 30, 40, 0.92);
          border-top-color: rgba(255, 255, 255, 0.06);
          box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.2);
        }

        .worker-tab-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          flex: 1;
          height: 56px;
          cursor: pointer;
          position: relative;
          -webkit-tap-highlight-color: transparent;
          transition: all 0.2s ease;
        }

        .worker-tab-item:active {
          transform: scale(0.9);
        }

        .worker-tab-icon {
          color: var(--text-3);
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
          line-height: 1;
        }

        .worker-tab-item.active .worker-tab-icon {
          color: var(--brand);
          transform: translateY(-1px);
        }

        .worker-tab-label {
          font-size: 10px;
          margin-top: 3px;
          color: var(--text-3);
          font-weight: 400;
          transition: all 0.25s ease;
          line-height: 1;
        }

        .worker-tab-item.active .worker-tab-label {
          color: var(--brand);
          font-weight: 600;
        }

        .worker-tab-indicator {
          position: absolute;
          top: 2px;
          width: 20px;
          height: 3px;
          border-radius: 2px;
          background: var(--gradient-brand);
          box-shadow: 0 1px 6px rgba(22, 119, 255, 0.3);
        }
      `}</style>
    </div>
  );
}
