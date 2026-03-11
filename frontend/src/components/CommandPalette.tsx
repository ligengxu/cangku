'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Tag, message } from 'antd';
import {
  SearchOutlined, DashboardOutlined, ShoppingCartOutlined, AppstoreOutlined,
  TeamOutlined, BarChartOutlined, SettingOutlined, ExperimentOutlined,
  FileTextOutlined, TrophyOutlined, ThunderboltOutlined,
  FundOutlined, DeleteOutlined, BulbOutlined, MoonOutlined,
  PrinterOutlined, AuditOutlined, UserOutlined, InboxOutlined,
  FullscreenOutlined, PieChartOutlined, DollarOutlined, ReconciliationOutlined,
  HeartOutlined, RocketOutlined, ArrowRightOutlined, ClockCircleOutlined,
  StarOutlined, FireOutlined, EnterOutlined,
} from '@ant-design/icons';
import { useAuth } from '@/stores/useAuth';
import { useTheme } from '@/stores/useTheme';
import { logout } from '@/services/auth';
import api from '@/services/api';

interface CmdItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  category: 'navigate' | 'action' | 'search' | 'recent';
  keywords?: string[];
  action: () => void;
  color?: string;
  shortcut?: string;
}

function fuzzyMatch(text: string, query: string): boolean {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let qi = 0;
  let last = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) {
      if (i > last) parts.push(<span key={`t-${last}`}>{text.slice(last, i)}</span>);
      parts.push(<span key={`h-${i}`} style={{ color: 'var(--brand)', fontWeight: 700 }}>{text[i]}</span>);
      last = i + 1;
      qi++;
    }
  }
  if (last < text.length) parts.push(<span key={`t-${last}`}>{text.slice(last)}</span>);
  return <>{parts}</>;
}

export default function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { user, isAdmin } = useAuth();
  const { dark, toggle: toggleTheme } = useTheme();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [apiResults, setApiResults] = useState<CmdItem[]>([]);
  const [recentPages, setRecentPages] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = JSON.parse(localStorage.getItem('cmd_recent') || '[]');
        setRecentPages(Array.isArray(saved) ? saved.slice(0, 5) : []);
      } catch { setRecentPages([]); }
    }
  }, [open]);

  const pushRecent = useCallback((path: string) => {
    const updated = [path, ...recentPages.filter(p => p !== path)].slice(0, 5);
    setRecentPages(updated);
    if (typeof window !== 'undefined') localStorage.setItem('cmd_recent', JSON.stringify(updated));
  }, [recentPages]);

  const nav = useCallback((path: string) => {
    pushRecent(path);
    router.push(path);
    onClose();
  }, [router, onClose, pushRecent]);

  const admin = isAdmin();

  const PAGES: CmdItem[] = useMemo(() => {
    const all: CmdItem[] = [
      { id: 'nav-dashboard', label: '工作台', description: '仪表盘总览', icon: <DashboardOutlined />, category: 'navigate', keywords: ['dashboard', '首页', '工作台', '仪表盘'], action: () => nav('/dashboard'), color: '#1677ff' },
    ];
    if (admin) {
      all.push(
        { id: 'nav-fruit-orders', label: '水果采购', description: '管理水果采购订单', icon: <ShoppingCartOutlined />, category: 'navigate', keywords: ['fruit', 'purchase', '采购', '水果', '订单'], action: () => nav('/orders/fruit'), color: '#1677ff' },
        { id: 'nav-material-orders', label: '材料采购', description: '管理材料采购订单', icon: <ShoppingCartOutlined />, category: 'navigate', keywords: ['material', '材料', '采购'], action: () => nav('/orders/material'), color: '#722ed1' },
        { id: 'nav-carton-orders', label: '纸箱采购', description: '管理纸箱采购订单', icon: <ShoppingCartOutlined />, category: 'navigate', keywords: ['carton', '纸箱', '采购'], action: () => nav('/orders/carton'), color: '#fa8c16' },
        { id: 'nav-assign', label: '批次分配', description: '生产批次分配管理', icon: <AppstoreOutlined />, category: 'navigate', keywords: ['assign', 'batch', '批次', '分配'], action: () => nav('/production/assign'), color: '#00b96b' },
        { id: 'nav-assignment-details', label: '派工详情', description: '按日期查看派工消耗详情', icon: <AppstoreOutlined />, category: 'navigate', keywords: ['assignment', 'detail', '派工', '详情', '消耗'], action: () => nav('/production/assignment-details'), color: '#fa8c16' },
        { id: 'nav-audit', label: '生产审核', description: '审核工人生产记录', icon: <AuditOutlined />, category: 'navigate', keywords: ['audit', '审核', '生产'], action: () => nav('/production/audit'), color: '#ff4d4f' },
        { id: 'nav-print', label: '标签打印', description: '打印 SKU 标签', icon: <PrinterOutlined />, category: 'navigate', keywords: ['print', 'label', '打印', '标签'], action: () => nav('/production/print'), color: '#fa8c16' },
        { id: 'nav-screen', label: '生产大屏', description: '实时生产数据大屏', icon: <ThunderboltOutlined />, category: 'navigate', keywords: ['screen', '大屏', '实时', '生产'], action: () => nav('/production/screen'), color: '#eb2f96' },
        { id: 'nav-workers', label: '工人列表', description: '管理工人账号', icon: <TeamOutlined />, category: 'navigate', keywords: ['worker', '工人', '人员'], action: () => nav('/workers/list'), color: '#722ed1' },
        { id: 'nav-ranking', label: '绩效排行', description: '工人绩效排名', icon: <TrophyOutlined />, category: 'navigate', keywords: ['ranking', 'performance', '排行', '绩效'], action: () => nav('/workers/ranking'), color: '#faad14' },
        { id: 'nav-inventory-overview', label: '库存总览', description: 'SKU预估库存概览', icon: <AppstoreOutlined />, category: 'navigate', keywords: ['inventory', 'overview', '库存', '总览', '预估'], action: () => nav('/inventory/overview'), color: '#6B73FF' },
        { id: 'nav-sku', label: 'SKU 管理', description: '管理 SKU 品项', icon: <BarChartOutlined />, category: 'navigate', keywords: ['sku', '品项', '商品'], action: () => nav('/inventory/sku'), color: '#13c2c2' },
        { id: 'nav-fruits', label: '水果管理', description: '管理水果品种', icon: <InboxOutlined />, category: 'navigate', keywords: ['fruit', '水果', '品种'], action: () => nav('/inventory/fruits'), color: '#00b96b' },
        { id: 'nav-carton-inv', label: '纸箱库存', description: '纸箱库存管理', icon: <InboxOutlined />, category: 'navigate', keywords: ['carton', 'inventory', '纸箱', '库存'], action: () => nav('/inventory/carton'), color: '#fa8c16' },
        { id: 'nav-checks', label: '库存盘点', description: '库存盘点记录', icon: <FileTextOutlined />, category: 'navigate', keywords: ['check', 'inventory', '盘点', '库存'], action: () => nav('/inventory/checks'), color: '#722ed1' },
        { id: 'nav-suppliers', label: '供应商', description: '供应商信息管理', icon: <UserOutlined />, category: 'navigate', keywords: ['supplier', '供应商'], action: () => nav('/inventory/suppliers'), color: '#1677ff' },
        { id: 'nav-analytics', label: '数据分析', description: '多维度数据分析中心', icon: <FundOutlined />, category: 'navigate', keywords: ['analytics', '分析', '数据', '报表'], action: () => nav('/reports/analytics'), color: '#eb2f96' },
        { id: 'nav-finance', label: '财务报表', description: '采购财务汇总', icon: <DollarOutlined />, category: 'navigate', keywords: ['finance', '财务', '报表', '付款'], action: () => nav('/reports/finance'), color: '#faad14' },
        { id: 'nav-statement', label: '供应商对账', description: '供应商账目对账', icon: <ReconciliationOutlined />, category: 'navigate', keywords: ['statement', '对账', '供应商'], action: () => nav('/reports/statement'), color: '#13c2c2' },
        { id: 'nav-outbound', label: '出库报表', description: '出库数据统计', icon: <BarChartOutlined />, category: 'navigate', keywords: ['outbound', '出库', '报表'], action: () => nav('/reports/outbound'), color: '#00b96b' },
        { id: 'nav-loss', label: '损耗分析', description: '水果损耗率分析', icon: <PieChartOutlined />, category: 'navigate', keywords: ['loss', '损耗', '分析'], action: () => nav('/reports/loss'), color: '#ff4d4f' },
        { id: 'nav-pricing', label: '价格走势', description: '采购价格历史', icon: <DollarOutlined />, category: 'navigate', keywords: ['price', 'pricing', '价格', '走势'], action: () => nav('/reports/pricing'), color: '#fa8c16' },
        { id: 'nav-inventory-query', label: '入库查询', description: '入库数据按工人分组查询', icon: <BarChartOutlined />, category: 'navigate', keywords: ['inventory', 'query', '入库', '查询', '审核'], action: () => nav('/reports/inventory-query'), color: '#4A6CF7' },
        { id: 'nav-notices', label: '通知管理', description: '系统通知公告', icon: <SettingOutlined />, category: 'navigate', keywords: ['notice', '通知', '公告'], action: () => nav('/system/notices'), color: '#1677ff' },
        { id: 'nav-logs', label: '操作日志', description: '系统操作审计日志', icon: <FileTextOutlined />, category: 'navigate', keywords: ['log', '日志', '操作', '审计'], action: () => nav('/system/logs'), color: '#722ed1' },
        { id: 'nav-login-logs', label: '登录日志', description: '用户登录安全审计', icon: <FileTextOutlined />, category: 'navigate', keywords: ['login', '登录', '日志', '安全', '审计'], action: () => nav('/system/login-logs'), color: '#13c2c2' },
        { id: 'nav-users', label: '用户管理', description: '管理所有系统用户', icon: <UserOutlined />, category: 'navigate', keywords: ['user', 'admin', '用户', '管理员', '管理'], action: () => nav('/system/users'), color: '#722ed1' },
        { id: 'nav-recycle', label: '回收站', description: '已删除数据恢复', icon: <DeleteOutlined />, category: 'navigate', keywords: ['recycle', '回收', '删除', '恢复'], action: () => nav('/system/recycle'), color: '#ff4d4f' },
        { id: 'nav-health', label: '系统健康', description: '检查系统运行状态', icon: <HeartOutlined />, category: 'navigate', keywords: ['health', '健康', '系统', '状态'], action: () => nav('/system/health'), color: '#00b96b' },
      );
    } else {
      all.push(
        { id: 'nav-input', label: '生产录入', description: '记录今日包装数量', icon: <ExperimentOutlined />, category: 'navigate', keywords: ['input', 'production', '录入', '生产'], action: () => nav('/production/input'), color: '#1677ff' },
        { id: 'nav-perf', label: '我的绩效', description: '查看个人绩效', icon: <ThunderboltOutlined />, category: 'navigate', keywords: ['performance', '绩效', '我的'], action: () => nav('/workers/performance'), color: '#eb2f96' },
        { id: 'nav-ranking', label: '绩效排行', description: '工人绩效排名', icon: <TrophyOutlined />, category: 'navigate', keywords: ['ranking', '排行', '绩效'], action: () => nav('/workers/ranking'), color: '#faad14' },
      );
    }
    return all;
  }, [admin, nav]);

  const ACTIONS: CmdItem[] = useMemo(() => [
    { id: 'act-theme', label: dark ? '切换亮色模式' : '切换暗色模式', description: '更改界面主题', icon: dark ? <BulbOutlined /> : <MoonOutlined />, category: 'action', keywords: ['theme', 'dark', 'light', '主题', '暗色', '亮色', '切换'], action: () => { toggleTheme(); onClose(); }, color: dark ? '#faad14' : '#722ed1', shortcut: '' },
    { id: 'act-fullscreen', label: '切换全屏', description: '进入/退出全屏模式', icon: <FullscreenOutlined />, category: 'action', keywords: ['fullscreen', '全屏'], action: () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen(); else document.exitFullscreen(); onClose(); }, color: '#1677ff' },
    { id: 'act-logout', label: '退出登录', description: '安全退出当前账号', icon: <RocketOutlined />, category: 'action', keywords: ['logout', '退出', '登录', '注销'], action: () => { logout(); onClose(); }, color: '#ff4d4f' },
    { id: 'act-refresh', label: '刷新页面', description: '重新加载当前页面', icon: <FireOutlined />, category: 'action', keywords: ['refresh', 'reload', '刷新'], action: () => { window.location.reload(); }, color: '#00b96b' },
  ], [dark, toggleTheme, onClose]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    setApiResults([]);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    if (!query.trim() || query.length < 2) { setApiResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const r = await api.get('/system/search', { params: { q: query.trim() } });
        const results: CmdItem[] = (r.data?.data || []).map((item: any) => ({
          id: `api-${item.type}-${item.id}`,
          label: item.label,
          description: item.description,
          icon: <SearchOutlined />,
          category: 'search' as const,
          action: () => {
            const pathMap: Record<string, string> = { worker: '/workers/list', sku: '/inventory/sku', fruit: '/inventory/fruits', supplier: '/inventory/suppliers', ticket: '/production/print' };
            nav(pathMap[item.type] || '/dashboard');
          },
          color: '#1677ff',
        }));
        setApiResults(results);
      } catch { setApiResults([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, nav]);

  const LABEL_MAP: Record<string, string> = useMemo(() => {
    const m: Record<string, string> = {};
    PAGES.forEach(p => { const path = p.id.replace('nav-', '/').replace(/-/g, '/'); m[path] = p.label; });
    return m;
  }, [PAGES]);

  const filteredItems = useMemo(() => {
    const q = query.trim();

    if (!q) {
      const recentItems: CmdItem[] = recentPages.slice(0, 3).map(path => {
        const page = PAGES.find(p => {
          const test = p.id.replace('nav-', '');
          return path.includes(test) || p.keywords?.some(k => path.includes(k));
        });
        return {
          id: `recent-${path}`,
          label: page?.label || path,
          description: '最近访问',
          icon: <ClockCircleOutlined />,
          category: 'recent' as const,
          action: () => nav(path),
          color: '#8a919f',
        };
      });

      const topPages = PAGES.slice(0, 6);
      const topActions = ACTIONS.slice(0, 2);
      return [...recentItems, ...topPages, ...topActions];
    }

    const matchedPages = PAGES.filter(p =>
      fuzzyMatch(p.label, q) ||
      (p.description && fuzzyMatch(p.description, q)) ||
      p.keywords?.some(k => fuzzyMatch(k, q))
    );

    const matchedActions = ACTIONS.filter(a =>
      fuzzyMatch(a.label, q) ||
      (a.description && fuzzyMatch(a.description, q)) ||
      a.keywords?.some(k => fuzzyMatch(k, q))
    );

    return [...matchedPages, ...matchedActions, ...apiResults];
  }, [query, PAGES, ACTIONS, apiResults, recentPages, nav]);

  useEffect(() => { setActiveIndex(0); }, [query]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev + 1) % Math.max(filteredItems.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev - 1 + filteredItems.length) % Math.max(filteredItems.length, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[activeIndex]) filteredItems[activeIndex].action();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }, [filteredItems, activeIndex, onClose]);

  useEffect(() => {
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex]);

  if (!open) return null;

  const categoryLabels: Record<string, string> = { recent: '最近访问', navigate: '页面导航', action: '快捷操作', search: '搜索结果' };

  let lastCategory = '';

  return (
    <div
      className="cmd-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="cmd-palette">
        {/* Input */}
        <div className="cmd-input-wrap">
          <SearchOutlined className="cmd-input-icon" />
          <input
            ref={inputRef}
            className="cmd-input"
            placeholder="搜索页面、执行操作..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="cmd-input-hint">
            <kbd>↑↓</kbd> 选择 <kbd>↵</kbd> 确认 <kbd>esc</kbd> 关闭
          </div>
        </div>

        {/* Results */}
        <div className="cmd-list" ref={listRef}>
          {filteredItems.length === 0 ? (
            <div className="cmd-empty">
              <SearchOutlined style={{ fontSize: 28, color: 'var(--text-4)', marginBottom: 8 }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)' }}>未找到匹配结果</div>
              <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 4 }}>试试其他关键词</div>
            </div>
          ) : (
            filteredItems.map((item, i) => {
              const showCategory = item.category !== lastCategory;
              lastCategory = item.category;
              return (
                <React.Fragment key={item.id}>
                  {showCategory && (
                    <div className="cmd-category">{categoryLabels[item.category] || item.category}</div>
                  )}
                  <div
                    className={`cmd-item ${i === activeIndex ? 'cmd-item-active' : ''}`}
                    onClick={() => item.action()}
                    onMouseEnter={() => setActiveIndex(i)}
                  >
                    <div className="cmd-item-icon" style={{ color: item.color || 'var(--brand)' }}>
                      {item.icon}
                    </div>
                    <div className="cmd-item-text">
                      <div className="cmd-item-label">{highlightMatch(item.label, query)}</div>
                      {item.description && <div className="cmd-item-desc">{item.description}</div>}
                    </div>
                    <div className="cmd-item-right">
                      {item.shortcut && <kbd className="cmd-kbd">{item.shortcut}</kbd>}
                      {i === activeIndex && <EnterOutlined style={{ fontSize: 11, color: 'var(--brand)', opacity: 0.6 }} />}
                    </div>
                  </div>
                </React.Fragment>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="cmd-footer">
          <span><RocketOutlined style={{ marginRight: 4 }} />命令面板</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>{filteredItems.length} 个结果</span>
            <span><kbd>⌘K</kbd> 打开</span>
          </span>
        </div>
      </div>
    </div>
  );
}
