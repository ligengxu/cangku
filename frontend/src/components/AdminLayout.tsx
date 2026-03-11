'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  Layout, Menu, Avatar, Dropdown, Input, Badge, Typography, Button, Drawer, Modal,
  List, Tag, Space, Breadcrumb, Tooltip, Form, message, Popover, Spin, Empty,
} from 'antd';
import {
  DashboardOutlined, ShoppingCartOutlined, AppstoreOutlined, TeamOutlined,
  BarChartOutlined, SettingOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
  BellOutlined, SearchOutlined, UserOutlined, LogoutOutlined, KeyOutlined,
  ExperimentOutlined, CalendarOutlined, TrophyOutlined,
  FullscreenOutlined, FullscreenExitOutlined, HomeOutlined, ThunderboltOutlined,
  RestOutlined, DeleteOutlined, BulbOutlined, MoonOutlined, RobotOutlined, BugOutlined,
} from '@ant-design/icons';
import { useAuth } from '@/stores/useAuth';
import { logout } from '@/services/auth';
import api from '@/services/api';
import type { SearchResult } from '@/types';
import BackToTop from './BackToTop';
import CommandPalette from './CommandPalette';
import SpeedDial from './SpeedDial';
import AIFloatingChat from './AIFloatingChat';
import { useTheme } from '@/stores/useTheme';

const { Sider, Content } = Layout;
const { Text } = Typography;

interface MI { key: string; icon?: React.ReactNode; label: string | React.ReactNode; children?: MI[] }

const adminMenu: MI[] = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '\u5DE5\u4F5C\u53F0' },
  { key: 'orders', icon: <ShoppingCartOutlined />, label: '\u8BA2\u5355\u4E2D\u5FC3', children: [
    { key: '/orders/fruit', label: '\u6C34\u679C\u91C7\u8D2D' }, { key: '/orders/material', label: '\u6750\u6599\u91C7\u8D2D' },
    { key: '/orders/carton', label: '\u7EB8\u7BB1\u91C7\u8D2D' },
    { key: '/orders/ai-suggest', label: 'AI\u91C7\u8D2D\u5EFA\u8BAE' },
  ]},
  { key: 'production', icon: <ExperimentOutlined />, label: '\u751F\u4EA7\u7BA1\u7406', children: [
    { key: '/production/assign', label: '\u6279\u6B21\u5206\u914D' }, { key: '/production/request', label: 'SKU \u7533\u8BF7' },
    { key: '/production/audit', label: '\u751F\u4EA7\u5BA1\u6838' },
    { key: '/production/print', label: '\u6807\u7B7E\u6253\u5370' }, { key: '/production/scan', label: '\u626B\u7801\u5DE5\u4F5C\u7AD9' },
    { key: '/production/batch-detail', label: '\u6279\u6B21\u8FFD\u8E2A' },
    { key: '/production/assignment-details', label: '\u6D3E\u5DE5\u8BE6\u60C5' },
    { key: '/production/label-search', label: '\u6807\u7B7E\u641C\u7D22' },
    { key: '/production/failures', label: '\u5931\u8D25\u65E5\u5FD7' }, { key: '/production/weight-check', label: '\u91CD\u91CF\u5F02\u5E38' }, { key: '/production/pipeline', label: '\u751F\u4EA7\u7BA1\u7EBF' }, { key: '/production/screen', label: '\u751F\u4EA7\u5927\u5C4F' }, { key: '/production/scan-screen', label: '\u626B\u7801\u76D1\u63A7' },
  ]},
  { key: 'workers', icon: <TeamOutlined />, label: '\u4EBA\u5458\u7BA1\u7406', children: [
    { key: '/workers/list', label: '\u5DE5\u4EBA\u5217\u8868' }, { key: '/workers/commission', label: '\u5DE5\u4EBA\u4F63\u91D1' },
    { key: '/workers/settlement', label: '\u4F63\u91D1\u7ED3\u7B97\u5355' },
    { key: '/workers/settlement-review', label: '\u7EE9\u6548\u6838\u7B97' },
    { key: '/workers/ranking', label: '\u7EE9\u6548\u6392\u884C' },
    { key: '/workers/performance', label: '\u6211\u7684\u7EE9\u6548' },
    { key: '/workers/comparison', label: '\u4EA7\u91CF\u5BF9\u6BD4' },
  ]},
  { key: 'inventory', icon: <AppstoreOutlined />, label: '\u5E93\u5B58\u7BA1\u7406', children: [
    { key: '/inventory/overview', label: '\u5E93\u5B58\u603B\u89C8' },
    { key: '/inventory/sku', label: 'SKU \u7BA1\u7406' }, { key: '/inventory/fruits', label: '\u6C34\u679C\u7BA1\u7406' },
    { key: '/inventory/carton', label: '\u7EB8\u7BB1\u5E93\u5B58' }, { key: '/inventory/alerts', label: '\u5E93\u5B58\u9884\u8B66' },
    { key: '/inventory/checks', label: '\u5E93\u5B58\u76D8\u70B9' },
    { key: '/inventory/forecast', label: '\u5E93\u5B58\u9884\u6D4B' },
    { key: '/inventory/suppliers', label: '\u4F9B\u5E94\u5546' },
  ]},
  { key: 'reports', icon: <BarChartOutlined />, label: '\u62A5\u8868\u4E2D\u5FC3', children: [
    { key: '/reports/analytics', label: '\u6570\u636E\u5206\u6790' },
    { key: '/reports/finance', label: '\u8D22\u52A1\u62A5\u8868' },
    { key: '/reports/statement', label: '\u4F9B\u5E94\u5546\u5BF9\u8D26' },
    { key: '/reports/outbound', label: '\u51FA\u5E93\u62A5\u8868' }, { key: '/reports/loss', label: '\u635F\u8017\u5206\u6790' },
    { key: '/reports/pricing', label: '\u4EF7\u683C\u8D70\u52BF' }, { key: '/reports/weight', label: '\u91CD\u91CF\u5DEE\u5F02' },
    { key: '/reports/sku-daily', label: 'SKU \u65E5\u62A5' },
    { key: '/reports/inventory-query', label: '\u5165\u5E93\u67E5\u8BE2' },
    { key: '/reports/aging', label: '\u6807\u7B7E\u8001\u5316' },
    { key: '/reports/batch-efficiency', label: '\u6279\u6B21\u6548\u7387' },
    { key: '/reports/sku-efficiency', label: 'SKU \u6548\u7387\u5206\u6790' },
    { key: '/reports/supplier-score', label: '\u4F9B\u5E94\u5546\u8BC4\u5206' },
    { key: '/reports/daily-report', label: '\u6BCF\u65E5\u65E5\u62A5' },
    { key: '/reports/fruit-analytics', label: '\u6C34\u679C\u54C1\u7C7B' },
    { key: '/reports/material-analysis', label: '\u6750\u6599\u5206\u6790' },
    { key: '/reports/box-consumption', label: '\u7eb8\u7bb1\u6d88\u8017' },
    { key: '/reports/ai-report', label: 'AI \u667A\u80FD\u62A5\u8868' },
    { key: '/reports/production-diagnosis', label: '\u751F\u4EA7\u8BCA\u65AD' },
    { key: '/reports/batch-profit', label: '\u6279\u6B21\u5229\u6DA6' },
    { key: '/reports/ai-daily-brief', label: 'AI\u65E5\u62A5' },
  ]},
  { key: '/ai/assistant', icon: <RobotOutlined />, label: 'AI \u52A9\u624B' },
  { key: 'system', icon: <SettingOutlined />, label: '\u7CFB\u7EDF\u7BA1\u7406', children: [
    { key: '/system/users', label: '\u7528\u6237\u7BA1\u7406' },
    { key: '/system/notices', label: '\u901A\u77E5\u7BA1\u7406' }, { key: '/system/logs', label: '\u64CD\u4F5C\u65E5\u5FD7' },
    { key: '/system/login-logs', label: '\u767B\u5F55\u65E5\u5FD7' },
    { key: '/system/recycle', label: '\u56DE\u6536\u7AD9' },
    { key: '/system/health', label: '\u7CFB\u7EDF\u5065\u5EB7' },
    { key: '/system/monitor', label: '\u7CFB\u7EDF\u76D1\u63A7' },
    { key: '/system/api-center', label: '\u63A5\u53E3\u4E2D\u5FC3' },
    { key: '/system/bugs', label: 'BUG\u53CD\u9988' },
  ]},
];

const workerMenu: MI[] = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '\u5DE5\u4F5C\u53F0' },
  { key: '/production/request', icon: <AppstoreOutlined />, label: '\u6211\u7684\u4EFB\u52A1' },
  { key: '/production/input', icon: <ExperimentOutlined />, label: '\u751F\u4EA7\u5F55\u5165' },
  { key: '/messages', icon: <BellOutlined />, label: '\u6D88\u606F' },
  { key: '/workers/performance', icon: <ThunderboltOutlined />, label: '\u6211\u7684\u7EE9\u6548' },
  { key: '/workers/monthly-report', icon: <BarChartOutlined />, label: '\u6708\u5EA6\u62A5\u544A' },
  { key: '/system/bugs', icon: <BugOutlined />, label: '\u95EE\u9898\u53CD\u9988' },
];

function findOpenKeys(pathname: string, items: MI[]): string[] {
  for (const it of items) {
    if (it.children) {
      for (const ch of it.children) {
        if (ch.key === pathname) return [it.key];
      }
    }
  }
  return [];
}

function buildCrumbs(pathname: string, items: MI[]) {
  const r: { title: React.ReactNode; href?: string }[] = [{ title: <HomeOutlined />, href: '/dashboard' }];
  for (const it of items) {
    if (it.key === pathname) { r.push({ title: it.label }); return r; }
    if (it.children) {
      for (const ch of it.children) {
        if (ch.key === pathname) { r.push({ title: it.label }); r.push({ title: ch.label }); return r; }
      }
    }
  }
  return r;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchRes, setSearchRes] = useState<SearchResult[]>([]);
  const [mobile, setMobile] = useState(false);
  const [fs, setFs] = useState(false);
  const { dark: darkMode, toggle: toggleTheme } = useTheme();
  const [noticeCount, setNoticeCount] = useState(0);
  const [printQueueCount, setPrintQueueCount] = useState(0);
  const [noticePanel, setNoticePanel] = useState(false);
  const [notices, setNotices] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [todoItems, setTodoItems] = useState<any[]>([]);
  const [todoTotal, setTodoTotal] = useState(0);
  const [noticePanelTab, setNoticePanelTab] = useState<'todo' | 'notices' | 'activity'>('todo');
  const [noticeLoading, setNoticeLoading] = useState(false);
  const [msgUnread, setMsgUnread] = useState(0);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdForm] = Form.useForm();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();

  useEffect(() => {
    const check = () => setMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => {
    const fetchCounts = async () => {
      try {
        const [nRes, tRes, mRes] = await Promise.all([
          api.get('/system/notices/count').catch(() => ({ data: { data: { count: 0 } } })),
          api.get('/system/todo-items').catch(() => ({ data: { data: { total_count: 0, items: [] } } })),
          api.get('/system/messages/unread-count').catch(() => ({ data: { data: { count: 0 } } })),
        ]);
        setNoticeCount((nRes.data as any)?.data?.count ?? 0);
        const td = (tRes.data as any)?.data;
        setTodoTotal(td?.total_count ?? 0);
        setTodoItems(td?.items ?? []);
        setMsgUnread((mRes.data as any)?.data?.count ?? 0);
      } catch {
        setNoticeCount(0);
        setTodoTotal(0);
      }
    };
    fetchCounts();
    const id = setInterval(fetchCounts, 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (user?.role !== 'admin') return;
    const fetchPrintQueue = async () => {
      try {
        const r = await api.get('/production/print-queue');
        const d = r.data?.data ?? r.data;
        setPrintQueueCount(typeof d?.count === 'number' ? d.count : d?.pending ?? 0);
      } catch { setPrintQueueCount(0); }
    };
    fetchPrintQueue();
    const id = setInterval(fetchPrintQueue, 30000);
    return () => clearInterval(id);
  }, [user?.role]);

  const items = useMemo(() => {
    const base = user?.role === 'admin' ? adminMenu : workerMenu;
    if (user?.role !== 'admin' || printQueueCount <= 0) return base;
    return base.map(item => {
      if (item.key !== 'production' || !item.children) return item;
      return {
        ...item,
        children: item.children.map(ch =>
          ch.key === '/production/print'
            ? { ...ch, label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{'\u6807\u7B7E\u6253\u5370'}<Badge count={printQueueCount} size="small" style={{ boxShadow: 'none' }} /></span> }
            : ch
        ),
      };
    });
  }, [user?.role, printQueueCount]);

  const openKeys = useMemo(() => findOpenKeys(pathname, items), [pathname, items]);
  const crumbs = useMemo(() => buildCrumbs(pathname, items), [pathname, items]);

  const fetchNoticePanel = async () => {
    setNoticeLoading(true);
    try {
      const [nRes, aRes, tRes] = await Promise.all([
        api.get('/system/notices').catch(() => ({ data: { data: [] } })),
        api.get('/dashboard/recent-activity').catch(() => ({ data: { data: [] } })),
        api.get('/system/todo-items').catch(() => ({ data: { data: { items: [], total: 0, total_count: 0 } } })),
      ]);
      setNotices((nRes.data as any)?.data ?? []);
      setActivities((aRes.data as any)?.data ?? []);
      const todoData = (tRes.data as any)?.data;
      setTodoItems(todoData?.items ?? []);
      setTodoTotal(todoData?.total_count ?? 0);
    } catch { /* noop */ }
    finally { setNoticeLoading(false); }
  };

  useEffect(() => {
    if (noticePanel) fetchNoticePanel();
  }, [noticePanel]);

  const onSearch = async (q: string) => {
    setSearchQ(q);
    if (!q.trim()) { setSearchRes([]); return; }
    try { const r = await api.get('/system/search', { params: { q } }); setSearchRes(r.data.data || []); }
    catch { setSearchRes([]); }
  };

  const go = (k: string) => { router.push(k); setDrawer(false); };

  const getSearchPath = (item: SearchResult): string => {
    switch (item.type) {
      case 'worker': return '/workers/list';
      case 'sku': return '/inventory/sku';
      case 'fruit': return '/inventory/fruits';
      case 'supplier': return '/inventory/suppliers';
      case 'ticket': return '/production/print';
      default: return '/dashboard';
    }
  };

  const toggleFs = () => {
    if (!document.fullscreenElement) { document.documentElement.requestFullscreen().catch(() => {}); setFs(true); }
    else { document.exitFullscreen(); setFs(false); }
  };

  const userMenu = {
    items: [
      { key: 'info', label: (
        <div style={{ padding: '6px 0' }}>
          <div style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: 14 }}>{user?.real_name || user?.username}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{user?.role === 'admin' ? '\u7BA1\u7406\u5458' : '\u5DE5\u4EBA'}</div>
        </div>
      ), disabled: true },
      { type: 'divider' as const },
      { key: 'profile', icon: <UserOutlined />, label: '\u4E2A\u4EBA\u8D44\u6599' },
      { key: 'password', icon: <KeyOutlined />, label: '\u4FEE\u6539\u5BC6\u7801' },
      { type: 'divider' as const },
      { key: 'logout', icon: <LogoutOutlined />, label: '\u9000\u51FA\u767B\u5F55', danger: true },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'logout') logout();
      else if (key === 'password') setPwdOpen(true);
      else if (key === 'profile') router.push('/profile');
    },
  };

  const handleChangePassword = async () => {
    const vals = await pwdForm.validateFields();
    if (vals.new_password !== vals.confirm_password) { message.error('\u4E24\u6B21\u5BC6\u7801\u4E0D\u4E00\u81F4'); return; }
    setPwdLoading(true);
    try {
      await api.post('/auth/change-password', { old_password: vals.old_password, new_password: vals.new_password });
      message.success('\u5BC6\u7801\u4FEE\u6539\u6210\u529F\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55');
      setPwdOpen(false);
      pwdForm.resetFields();
      setTimeout(() => logout(), 1500);
    } catch (e: any) { message.error(e?.response?.data?.detail ?? '\u5BC6\u7801\u4FEE\u6539\u5931\u8D25'); }
    finally { setPwdLoading(false); }
  };

  const siderWidth = collapsed ? 60 : 216;

  const siderInner = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="sider-logo" style={{ justifyContent: collapsed ? 'center' : undefined }}>
        <div className="sider-logo-mark">{'\u679C'}</div>
        {!collapsed && <span className="sider-logo-name">{'\u679C\u7BA1\u7CFB\u7EDF'}</span>}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 0' }}>
        <Menu
          mode="inline"
          selectedKeys={[pathname]}
          defaultOpenKeys={openKeys}
          items={items as any}
          onClick={({ key }) => go(key)}
          style={{ border: 0, background: 'transparent' }}
        />
      </div>
      {!collapsed && (
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid rgba(22,119,255,0.06)',
          fontSize: 11, color: 'var(--text-4)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'linear-gradient(135deg, #52c41a, #95de64)',
            boxShadow: '0 0 0 3px rgba(82,196,26,0.15)',
          }} />
          {'v3.0 \u00B7 \u8FD0\u884C\u6B63\u5E38'}
        </div>
      )}
    </div>
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!mobile && (
        <Sider
          className="app-sider"
          trigger={null} collapsible collapsed={collapsed}
          width={216} collapsedWidth={60}
          style={{
            overflow: 'hidden', height: '100vh', position: 'fixed',
            left: 0, top: 0, zIndex: 100,
          }}
        >
          {siderInner}
        </Sider>
      )}

      <Drawer placement="left" open={drawer} onClose={() => setDrawer(false)}
        width={216} styles={{ body: { padding: 0 } }} closable={false}>
        {siderInner}
      </Drawer>

      <Layout style={{
        marginLeft: mobile ? 0 : siderWidth,
        transition: 'margin-left 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div className="app-header" style={{ padding: mobile ? '0 12px' : undefined, position: 'sticky', top: 0, zIndex: 99 }}>
          <Space size={8}>
            <Button type="text" size="small"
              icon={mobile ? <MenuUnfoldOutlined /> : (collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />)}
              onClick={() => mobile ? setDrawer(true) : setCollapsed(!collapsed)}
              style={{ width: 34, height: 34, color: 'var(--text-2)', borderRadius: 8, transition: 'all 0.2s' }}
            />
            {!mobile && crumbs.length > 1 && (
              <Breadcrumb items={crumbs} style={{ fontSize: 13, color: 'var(--text-3)' }} />
            )}
          </Space>

          <Space size={mobile ? 6 : 12}>
            {!mobile && (
              <div onClick={() => setSearchOpen(true)} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px',
                borderRadius: 10, background: 'rgba(22,119,255,0.04)',
                border: '1px solid rgba(22,119,255,0.06)', cursor: 'pointer',
                transition: 'all 0.2s', minWidth: 200, fontSize: 13, color: 'var(--text-3)',
                backdropFilter: 'blur(8px)',
              }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(22,119,255,0.15)'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(22,119,255,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(22,119,255,0.06)'; e.currentTarget.style.boxShadow = 'none'; }}
              >
                <SearchOutlined style={{ fontSize: 12, color: 'var(--brand)' }} />
                <span>{'\u641C\u7D22'}</span>
                <Tag style={{
                  marginLeft: 'auto', fontSize: 10, lineHeight: '16px', padding: '0 6px',
                  borderRadius: 4, background: 'rgba(22,119,255,0.06)', border: '1px solid rgba(22,119,255,0.1)',
                  color: 'var(--brand)',
                }}>{'\u2318K'}</Tag>
              </div>
            )}
            {mobile && <Button type="text" size="small" icon={<SearchOutlined />} onClick={() => setSearchOpen(true)} style={{ width: 34, height: 34, color: 'var(--text-2)', borderRadius: 8 }} />}
            <Tooltip title={darkMode ? '\u5207\u6362\u4eae\u8272\u6a21\u5f0f' : '\u5207\u6362\u6697\u8272\u6a21\u5f0f'}>
              <Button type="text" size="small"
                icon={darkMode ? <BulbOutlined /> : <MoonOutlined />}
                onClick={toggleTheme}
                style={{
                  width: 34, height: 34, borderRadius: 8,
                  color: darkMode ? '#faad14' : 'var(--text-2)',
                  transition: 'all 0.3s',
                }}
              />
            </Tooltip>
            {!mobile && (
              <Tooltip title={fs ? '\u9000\u51FA\u5168\u5C4F' : '\u5168\u5C4F'}>
                <Button type="text" size="small" icon={fs ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                  onClick={toggleFs} style={{ width: 34, height: 34, color: 'var(--text-2)', borderRadius: 8 }} />
              </Tooltip>
            )}
            <Popover
              open={noticePanel}
              onOpenChange={v => setNoticePanel(v)}
              trigger="click"
              placement="bottomRight"
              arrow={false}
              overlayStyle={{ width: 360, padding: 0 }}
              overlayInnerStyle={{
                borderRadius: 16, overflow: 'hidden', padding: 0,
                background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(20px)',
                boxShadow: '0 12px 40px rgba(0,0,0,0.12), 0 0 1px rgba(0,0,0,0.1)',
              }}
              content={
                <div>
                  <div style={{ display: 'flex', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                    {([['todo', '\u5f85\u529e', todoTotal], ['notices', '\u901a\u77e5', noticeCount], ['activity', '\u52a8\u6001', 0]] as const).map(([k, label, badge]) => (
                      <div key={k} onClick={() => setNoticePanelTab(k as any)} style={{
                        flex: 1, padding: '12px 0', textAlign: 'center', cursor: 'pointer',
                        fontSize: 13, fontWeight: noticePanelTab === k ? 600 : 400,
                        color: noticePanelTab === k ? 'var(--brand)' : 'var(--text-3)',
                        borderBottom: noticePanelTab === k ? '2px solid var(--brand)' : '2px solid transparent',
                        transition: 'all 0.2s',
                      }}>
                        {label}
                        {typeof badge === 'number' && badge > 0 && (
                          <span style={{
                            display: 'inline-block', marginLeft: 4, padding: '0 5px',
                            fontSize: 10, lineHeight: '16px', borderRadius: 8,
                            background: k === 'todo' ? 'linear-gradient(135deg, #fa8c16, #ffc53d)' : k === 'notices' ? 'linear-gradient(135deg, #ff4d4f, #ff7875)' : 'rgba(22,119,255,0.1)',
                            color: k === 'todo' || k === 'notices' ? '#fff' : 'var(--brand)',
                          }}>{badge > 99 ? '99+' : badge}</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div style={{ maxHeight: 400, overflow: 'auto', padding: '4px 0' }}>
                    {noticeLoading ? (
                      <div style={{ padding: 40, textAlign: 'center' }}><Spin size="small" /></div>
                    ) : noticePanelTab === 'todo' ? (
                      todoItems.length > 0 ? todoItems.map((item: any) => {
                        const priorityStyles: Record<string, { bg: string; border: string; dot: string }> = {
                          high: { bg: 'rgba(255,77,79,0.04)', border: 'rgba(255,77,79,0.12)', dot: 'linear-gradient(135deg, #ff4d4f, #ff7875)' },
                          medium: { bg: 'rgba(250,140,22,0.04)', border: 'rgba(250,140,22,0.12)', dot: 'linear-gradient(135deg, #fa8c16, #ffc53d)' },
                          low: { bg: 'rgba(22,119,255,0.03)', border: 'rgba(22,119,255,0.08)', dot: 'linear-gradient(135deg, #1677ff, #69b1ff)' },
                        };
                        const ps = priorityStyles[item.priority] || priorityStyles.low;
                        return (
                          <div key={item.id} style={{
                            padding: '10px 14px', margin: '4px 8px', borderRadius: 10,
                            background: ps.bg, border: `1px solid ${ps.border}`,
                            cursor: 'pointer', transition: 'all 0.2s',
                          }}
                            onClick={() => { setNoticePanel(false); router.push(item.link); }}
                            onMouseEnter={e => { e.currentTarget.style.transform = 'translateX(2px)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)'; }}
                            onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = 'none'; }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{
                                width: 28, height: 28, borderRadius: 8, display: 'inline-flex',
                                alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                background: `linear-gradient(135deg, ${item.color}18, ${item.color}08)`,
                                color: item.color, fontSize: 13,
                              }}>
                                {item.count}
                              </span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', lineHeight: 1.4 }}>
                                  {item.title}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {item.description}
                                </div>
                              </div>
                              <span style={{
                                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                                background: ps.dot,
                                boxShadow: `0 0 0 3px ${item.priority === 'high' ? 'rgba(255,77,79,0.15)' : item.priority === 'medium' ? 'rgba(250,140,22,0.12)' : 'rgba(22,119,255,0.1)'}`,
                              }} />
                            </div>
                          </div>
                        );
                      }) : (
                        <div style={{ padding: '40px 0', textAlign: 'center' }}>
                          <div style={{ fontSize: 36, marginBottom: 8 }}>{'\u2705'}</div>
                          <div style={{ fontSize: 13, color: 'var(--text-3)', fontWeight: 500 }}>{'\u6682\u65e0\u5f85\u529e\u4e8b\u9879'}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 4 }}>{'\u6240\u6709\u4efb\u52a1\u5df2\u5904\u7406\u5b8c\u6bd5'}</div>
                        </div>
                      )
                    ) : noticePanelTab === 'notices' ? (
                      notices.length > 0 ? notices.slice(0, 8).map((n: any) => (
                        <div key={n.id} style={{
                          padding: '10px 16px', display: 'flex', alignItems: 'flex-start', gap: 10,
                          transition: 'background 0.15s', cursor: 'pointer',
                          borderBottom: '1px solid rgba(0,0,0,0.03)',
                        }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(22,119,255,0.03)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          onClick={() => { setNoticePanel(false); router.push('/system/notices'); }}
                        >
                          <span style={{
                            width: 8, height: 8, borderRadius: '50%', marginTop: 5, flexShrink: 0,
                            background: n.type === 'urgent'
                              ? 'linear-gradient(135deg, #ff4d4f, #ff7875)'
                              : 'linear-gradient(135deg, #1677ff, #69b1ff)',
                            boxShadow: n.type === 'urgent' ? '0 0 0 3px rgba(255,77,79,0.15)' : '0 0 0 3px rgba(22,119,255,0.1)',
                          }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, color: 'var(--text-1)', lineHeight: 1.5, wordBreak: 'break-all' }}>
                              {n.content}
                            </div>
                          </div>
                        </div>
                      )) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={'\u6682\u65e0\u901a\u77e5'} style={{ padding: '30px 0' }} />
                      )
                    ) : (
                      activities.length > 0 ? activities.slice(0, 8).map((a: any) => (
                        <div key={a.id} style={{
                          padding: '10px 16px', display: 'flex', alignItems: 'flex-start', gap: 10,
                          transition: 'background 0.15s',
                          borderBottom: '1px solid rgba(0,0,0,0.03)',
                        }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(22,119,255,0.03)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <Avatar size={24} style={{
                            background: 'linear-gradient(135deg, #1677ff, #722ed1)',
                            fontSize: 10, fontWeight: 700, flexShrink: 0,
                          }}>{(a.username || '?')[0]}</Avatar>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                              <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{a.username}</span>{' '}
                              <span style={{ color: 'var(--text-2)' }}>{a.action}</span>
                            </div>
                            {a.timestamp && (
                              <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 2 }}>
                                {new Date(a.timestamp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </div>
                            )}
                          </div>
                        </div>
                      )) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={'\u6682\u65e0\u52a8\u6001'} style={{ padding: '30px 0' }} />
                      )
                    )}
                  </div>
                  <div style={{
                    padding: '8px 16px', borderTop: '1px solid rgba(0,0,0,0.05)',
                    textAlign: 'center',
                  }}>
                    <Button type="link" size="small" onClick={() => {
                      setNoticePanel(false);
                      router.push(noticePanelTab === 'notices' ? '/system/notices' : noticePanelTab === 'todo' ? '/dashboard' : '/system/logs');
                    }}
                      style={{ fontSize: 12, color: 'var(--brand)' }}>
                      {noticePanelTab === 'notices' ? '\u67e5\u770b\u5168\u90e8\u901a\u77e5' : noticePanelTab === 'todo' ? '\u8fd4\u56de\u5de5\u4f5c\u53f0' : '\u67e5\u770b\u5168\u90e8\u65e5\u5fd7'}
                    </Button>
                  </div>
                </div>
              }
            >
              <Badge count={todoTotal + noticeCount + msgUnread} size="small" offset={[-2, 2]} overflowCount={99}>
                <Button type="text" size="small" icon={<BellOutlined />}
                  style={{ width: 34, height: 34, color: noticePanel ? 'var(--brand)' : 'var(--text-2)', borderRadius: 8, transition: 'all 0.2s' }} />
              </Badge>
            </Popover>
            <Dropdown menu={userMenu as any} placement="bottomRight" trigger={['click']}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                padding: '4px 10px', borderRadius: 10, transition: 'all 0.2s',
                border: '1px solid transparent',
              }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(22,119,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(22,119,255,0.06)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
              >
                <Avatar size={28} style={{
                  background: 'linear-gradient(135deg, #1677ff, #722ed1)',
                  fontSize: 12, fontWeight: 700,
                  boxShadow: '0 2px 8px rgba(22,119,255,0.2)',
                }}>
                  {(user?.real_name || user?.username || 'U')[0]}
                </Avatar>
                {!mobile && <Text style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 500 }}>{user?.real_name || user?.username}</Text>}
              </div>
            </Dropdown>
          </Space>
        </div>

        <Content style={{ padding: mobile ? 12 : 22, flex: 1, background: 'transparent' }}>
          <div className="page-enter">{children}</div>
          <BackToTop />
          <SpeedDial />
          <AIFloatingChat />
        </Content>
      </Layout>

      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #1677ff, #722ed1)', color: '#fff', fontSize: 13 }}>
              <KeyOutlined />
            </span>
            {'\u4FEE\u6539\u5BC6\u7801'}
          </div>
        }
        open={pwdOpen}
        onOk={handleChangePassword}
        onCancel={() => { setPwdOpen(false); pwdForm.resetFields(); }}
        confirmLoading={pwdLoading}
        okText={'\u786E\u8BA4\u4FEE\u6539'}
        cancelText={'\u53D6\u6D88'}
        destroyOnClose
        width={420}
      >
        <Form form={pwdForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="old_password" label={'\u539F\u5BC6\u7801'} rules={[{ required: true, message: '\u8BF7\u8F93\u5165\u539F\u5BC6\u7801' }]}>
            <Input.Password placeholder={'\u5F53\u524D\u5BC6\u7801'} maxLength={128} />
          </Form.Item>
          <Form.Item name="new_password" label={'\u65B0\u5BC6\u7801'} rules={[{ required: true, message: '\u8BF7\u8F93\u5165\u65B0\u5BC6\u7801' }, { min: 6, message: '\u5BC6\u7801\u81F3\u5C11 6 \u4F4D' }]}>
            <Input.Password placeholder={'6 \u4F4D\u4EE5\u4E0A\u65B0\u5BC6\u7801'} maxLength={128} />
          </Form.Item>
          <Form.Item name="confirm_password" label={'\u786E\u8BA4\u5BC6\u7801'} rules={[{ required: true, message: '\u8BF7\u786E\u8BA4\u65B0\u5BC6\u7801' }]}>
            <Input.Password placeholder={'\u518D\u6B21\u8F93\u5165\u65B0\u5BC6\u7801'} maxLength={128} />
          </Form.Item>
        </Form>
      </Modal>

      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </Layout>
  );
}
