'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Tooltip, message } from 'antd';
import {
  ThunderboltOutlined, ShoppingCartOutlined, ExperimentOutlined,
  PrinterOutlined, AuditOutlined, TeamOutlined, BarChartOutlined,
  AppstoreOutlined, QuestionCircleOutlined, CloseOutlined,
} from '@ant-design/icons';
import { useAuth } from '@/stores/useAuth';

interface DialAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  glow: string;
  path: string;
  shortcut?: string;
}

export default function SpeedDial() {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [showHints, setShowHints] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { isAdmin } = useAuth();

  const admin = isAdmin();

  const ADMIN_ACTIONS: DialAction[] = [
    { key: 'fruit-order', label: '新建水果采购', icon: <ShoppingCartOutlined />, color: '#1677ff', glow: 'rgba(22,119,255,0.3)', path: '/orders/fruit', shortcut: 'G F' },
    { key: 'assign', label: '批次分配', icon: <AppstoreOutlined />, color: '#00b96b', glow: 'rgba(0,185,107,0.3)', path: '/production/assign', shortcut: 'G A' },
    { key: 'print', label: '标签打印', icon: <PrinterOutlined />, color: '#fa8c16', glow: 'rgba(250,140,22,0.3)', path: '/production/print', shortcut: 'G P' },
    { key: 'audit', label: '生产审核', icon: <AuditOutlined />, color: '#ff4d4f', glow: 'rgba(255,77,79,0.3)', path: '/production/audit', shortcut: 'G U' },
    { key: 'workers', label: '工人管理', icon: <TeamOutlined />, color: '#722ed1', glow: 'rgba(114,46,209,0.3)', path: '/workers/list', shortcut: 'G W' },
    { key: 'analytics', label: '数据分析', icon: <BarChartOutlined />, color: '#eb2f96', glow: 'rgba(235,47,150,0.3)', path: '/reports/analytics', shortcut: 'G R' },
  ];

  const WORKER_ACTIONS: DialAction[] = [
    { key: 'input', label: '生产录入', icon: <ExperimentOutlined />, color: '#1677ff', glow: 'rgba(22,119,255,0.3)', path: '/production/input', shortcut: 'G I' },
    { key: 'performance', label: '我的绩效', icon: <ThunderboltOutlined />, color: '#eb2f96', glow: 'rgba(235,47,150,0.3)', path: '/workers/performance', shortcut: 'G P' },
    { key: 'ranking', label: '绩效排行', icon: <BarChartOutlined />, color: '#faad14', glow: 'rgba(250,173,20,0.3)', path: '/workers/ranking', shortcut: 'G R' },
  ];

  const actions = admin ? ADMIN_ACTIONS : WORKER_ACTIONS;

  const handleNav = useCallback((path: string) => {
    router.push(path);
    setOpen(false);
  }, [router]);

  // Keyboard shortcut: G + letter for quick nav
  useEffect(() => {
    let gPressed = false;
    let gTimer: ReturnType<typeof setTimeout>;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'g' || e.key === 'G') {
        if (!gPressed) {
          gPressed = true;
          gTimer = setTimeout(() => { gPressed = false; }, 800);
          return;
        }
      }

      if (gPressed) {
        gPressed = false;
        clearTimeout(gTimer);
        const k = e.key.toLowerCase();
        const shortcutMap: Record<string, string> = {};
        actions.forEach(a => {
          if (a.shortcut) {
            const letter = a.shortcut.split(' ')[1]?.toLowerCase();
            if (letter) shortcutMap[letter] = a.path;
          }
        });
        if (shortcutMap[k]) {
          e.preventDefault();
          router.push(shortcutMap[k]);
        }
      }

      if (e.key === '?') {
        e.preventDefault();
        setShowHints(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(gTimer);
    };
  }, [actions, router]);

  if (pathname === '/login') return null;

  return (
    <>
      {/* Keyboard shortcuts hint overlay */}
      {showHints && (
        <div className="kbd-overlay" onClick={() => setShowHints(false)}>
          <div className="kbd-panel" onClick={e => e.stopPropagation()}>
            <div className="kbd-header">
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <QuestionCircleOutlined style={{ color: 'var(--brand)' }} />
                键盘快捷键
              </span>
              <span className="kbd-close" onClick={() => setShowHints(false)}>
                <CloseOutlined />
              </span>
            </div>
            <div className="kbd-body">
              <div className="kbd-section">
                <div className="kbd-section-title">全局</div>
                <div className="kbd-row"><span className="kbd-desc">命令面板</span><span className="kbd-keys"><kbd>⌘</kbd><kbd>K</kbd></span></div>
                <div className="kbd-row"><span className="kbd-desc">快捷键帮助</span><span className="kbd-keys"><kbd>?</kbd></span></div>
              </div>
              <div className="kbd-section">
                <div className="kbd-section-title">快速导航（先按 G，再按字母）</div>
                {actions.map(a => (
                  <div className="kbd-row" key={a.key}>
                    <span className="kbd-desc">{a.label}</span>
                    <span className="kbd-keys">
                      {a.shortcut?.split(' ').map((k, i) => <kbd key={i}>{k}</kbd>)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="kbd-section">
                <div className="kbd-section-title">页面内</div>
                <div className="kbd-row"><span className="kbd-desc">搜索 / 筛选</span><span className="kbd-keys"><kbd>/</kbd></span></div>
                <div className="kbd-row"><span className="kbd-desc">回到顶部</span><span className="kbd-keys"><kbd>T</kbd></span></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Speed Dial Overlay */}
      {open && <div className="speed-dial-overlay" onClick={() => setOpen(false)} />}

      {/* Speed Dial Actions */}
      <div className="speed-dial-container">
        {actions.map((action, i) => (
          <div
            key={action.key}
            className={`speed-dial-action ${open ? 'speed-dial-action-open' : ''}`}
            style={{
              transitionDelay: open ? `${i * 40}ms` : `${(actions.length - i) * 20}ms`,
            }}
            onMouseEnter={() => setHovered(action.key)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => handleNav(action.path)}
          >
            {hovered === action.key && (
              <div className="speed-dial-label">
                {action.label}
                {action.shortcut && <kbd className="speed-dial-kbd">{action.shortcut}</kbd>}
              </div>
            )}
            <div
              className="speed-dial-btn"
              style={{
                background: `linear-gradient(135deg, ${action.color}, ${action.color}cc)`,
                boxShadow: hovered === action.key ? `0 4px 16px ${action.glow}` : `0 2px 8px ${action.glow}`,
              }}
            >
              {action.icon}
            </div>
          </div>
        ))}

        {/* Main FAB */}
        <div
          className={`speed-dial-fab ${open ? 'speed-dial-fab-open' : ''}`}
          onClick={() => setOpen(!open)}
        >
          <div className="speed-dial-fab-inner">
            {open ? <CloseOutlined /> : <ThunderboltOutlined />}
          </div>
        </div>
      </div>

      {/* Keyboard shortcut badge */}
      <div className="kbd-hint-badge" onClick={() => setShowHints(true)}>
        <kbd>?</kbd> 快捷键
      </div>
    </>
  );
}
