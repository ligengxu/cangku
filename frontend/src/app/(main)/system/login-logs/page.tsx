'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Input, DatePicker, Button, Table, Tag, Tooltip, Row, Col,
  Space, Empty, message, Avatar, Statistic,
} from 'antd';
import {
  LoginOutlined, SearchOutlined, ReloadOutlined, UserOutlined,
  LaptopOutlined, MobileOutlined, TabletOutlined,
  ChromeOutlined, GlobalOutlined, SafetyCertificateOutlined,
  ClockCircleOutlined, EnvironmentOutlined, CalendarOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dayjs from 'dayjs';

interface LoginLog {
  id: number;
  user_id: number;
  username: string;
  action: string;
  ip: string;
  is_internal: boolean;
  browser: string;
  os: string;
  device: string;
  timestamp: string;
}

interface LogsData {
  items: LoginLog[];
  total: number;
  page: number;
  page_size: number;
  today_count: number;
}

const DEVICE_ICONS: Record<string, React.ReactNode> = {
  desktop: <LaptopOutlined />,
  mobile: <MobileOutlined />,
  tablet: <TabletOutlined />,
};

const OS_COLORS: Record<string, string> = {
  Windows: '#0078d7',
  macOS: '#333',
  Linux: '#e95420',
  Android: '#3ddc84',
  iOS: '#333',
};

const BROWSER_COLORS: Record<string, string> = {
  Chrome: '#4285f4',
  Firefox: '#ff9400',
  Edge: '#0078d7',
  Safari: '#006cff',
};

export default function LoginLogsPage() {
  const [search, setSearch] = useState('');
  const [logDate, setLogDate] = useState<dayjs.Dayjs | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<LogsData | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);

  const fetchLogs = useCallback(async (p?: number) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page: p ?? page, page_size: pageSize };
      if (search.trim()) params.search = search.trim();
      if (logDate) params.log_date = logDate.format('YYYY-MM-DD');

      const res = await api.get('/system/login-logs', { params });
      setData(res.data?.data || null);
    } catch { message.error('查询失败'); }
    finally { setLoading(false); }
  }, [search, logDate, page, pageSize]);

  useEffect(() => { fetchLogs(); }, []);

  const handleSearch = () => { setPage(1); fetchLogs(1); };
  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchLogs().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };
  const handleClear = () => {
    setSearch('');
    setLogDate(null);
    setPage(1);
    setTimeout(() => fetchLogs(1), 0);
  };

  const columns = [
    {
      title: '用户', dataIndex: 'username', width: 140,
      render: (v: string, r: LoginLog) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Avatar size={30} style={{
            background: `hsl(${r.user_id * 47 % 360}, 60%, 55%)`,
            fontWeight: 700, fontSize: 12,
          }}>{v.charAt(0).toUpperCase()}</Avatar>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{v}</div>
            <div style={{ fontSize: 10, color: 'var(--text-4)' }}>ID: {r.user_id}</div>
          </div>
        </div>
      ),
    },
    {
      title: '操作', dataIndex: 'action', width: 130,
      render: (v: string) => (
        <Tag icon={<LoginOutlined />} color="blue" style={{ borderRadius: 6, fontSize: 11, fontWeight: 500 }}>{v}</Tag>
      ),
    },
    {
      title: 'IP地址', dataIndex: 'ip', width: 160,
      render: (v: string, r: LoginLog) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-2)' }}>{v || '未知'}</span>
          {r.is_internal && (
            <Tag style={{
              borderRadius: 10, fontSize: 10, fontWeight: 600, padding: '0 6px',
              background: 'rgba(250,173,20,0.1)', color: '#d48806', border: '1px solid rgba(250,173,20,0.3)',
            }}>内网</Tag>
          )}
          {v === 'UNKNOWN' && (
            <Tag style={{
              borderRadius: 10, fontSize: 10, fontWeight: 600, padding: '0 6px',
              background: 'rgba(255,77,79,0.08)', color: '#ff4d4f', border: '1px solid rgba(255,77,79,0.2)',
            }}>未知</Tag>
          )}
        </div>
      ),
    },
    {
      title: '浏览器/设备', key: 'browser', width: 180,
      render: (_: unknown, r: LoginLog) => {
        const browserColor = Object.entries(BROWSER_COLORS).find(([k]) => r.browser.includes(k))?.[1] || 'var(--text-3)';
        const osColor = OS_COLORS[r.os] || 'var(--text-3)';
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <ChromeOutlined style={{ color: browserColor, fontSize: 13 }} />
              <span style={{ fontSize: 12, fontWeight: 500, color: browserColor }}>{r.browser}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              {DEVICE_ICONS[r.device] || <LaptopOutlined />}
              <span style={{ fontSize: 11, color: osColor }}>{r.os}</span>
            </div>
          </div>
        );
      },
    },
    {
      title: '时间', dataIndex: 'timestamp', width: 160,
      render: (v: string) => (
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-2)', fontWeight: 500 }}>{v ? dayjs(v).format('YYYY-MM-DD') : '-'}</div>
          <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{v ? dayjs(v).format('HH:mm:ss') : ''}</div>
        </div>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #13c2c2 0%, #1677ff 50%, #722ed1 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: -30, right: -20, width: 160, height: 160,
          borderRadius: '50%', background: 'rgba(255,255,255,0.08)',
        }} />
        <div style={{
          position: 'absolute', bottom: -30, left: '30%', width: 100, height: 100,
          borderRadius: '50%', background: 'rgba(255,255,255,0.06)',
        }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
            <span style={{
              width: 44, height: 44, borderRadius: 14,
              background: 'rgba(255,255,255,0.2)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 22,
              backdropFilter: 'blur(10px)',
            }}><SafetyCertificateOutlined /></span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>登录日志</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>安全审计 · 用户登录记录追踪</div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
        {[
          { label: '总记录', value: data?.total ?? 0, icon: <GlobalOutlined />, bg: 'linear-gradient(135deg, #1677ff, #69b1ff)', glow: 'rgba(22,119,255,0.15)' },
          { label: '今日登录', value: data?.today_count ?? 0, icon: <ClockCircleOutlined />, bg: 'linear-gradient(135deg, #00b96b, #5cdbd3)', glow: 'rgba(0,185,107,0.15)' },
          { label: '当前页', value: `${data?.page ?? 1} / ${Math.ceil((data?.total ?? 0) / (data?.page_size ?? 15)) || 1}`, icon: <CalendarOutlined />, bg: 'linear-gradient(135deg, #722ed1, #b37feb)', glow: 'rgba(114,46,209,0.15)' },
        ].map((s, i) => (
          <Col xs={8} key={i}>
            <div style={{
              padding: '14px 16px', borderRadius: 14, background: s.bg,
              boxShadow: `0 4px 14px ${s.glow}`,
              animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.08}s`,
            }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                {s.icon} {s.label}
              </div>
              <div className="num" style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{s.value}</div>
            </div>
          </Col>
        ))}
      </Row>

      {/* Filter */}
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head">
          <span className="panel-title"><SearchOutlined style={{ color: '#1677ff' }} /> 筛选条件</span>
          <Space>
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 8 }} />
          </Space>
        </div>
        <div style={{ padding: '14px 20px' }}>
          <Row gutter={[12, 12]} align="bottom">
            <Col xs={24} sm={8}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>用户名 / IP</div>
              <Input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="搜索用户名或IP地址"
                prefix={<SearchOutlined style={{ color: 'var(--text-4)' }} />}
                onPressEnter={handleSearch}
                allowClear
                style={{ borderRadius: 8 }}
              />
            </Col>
            <Col xs={24} sm={8}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>日期</div>
              <DatePicker
                value={logDate} onChange={v => setLogDate(v)}
                style={{ width: '100%', borderRadius: 8 }}
                placeholder="选择日期"
                allowClear
              />
            </Col>
            <Col xs={24} sm={8}>
              <Space style={{ width: '100%' }}>
                <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}
                  style={{ borderRadius: 10, fontWeight: 600, flex: 1, background: 'linear-gradient(135deg, #13c2c2, #1677ff)', border: 'none' }}>
                  搜索
                </Button>
                <Button onClick={handleClear} style={{ borderRadius: 10 }}>清除</Button>
              </Space>
            </Col>
          </Row>
        </div>
      </div>

      {/* Table */}
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title"><LoginOutlined style={{ color: '#13c2c2' }} /> 登录记录</span>
          <span style={{ fontSize: 12, color: 'var(--text-4)' }}>共 {data?.total ?? 0} 条</span>
        </div>
        <Table
          dataSource={data?.items || []}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{
            current: page,
            pageSize: pageSize,
            total: data?.total ?? 0,
            showTotal: t => `共 ${t} 条`,
            showSizeChanger: true,
            pageSizeOptions: ['10', '15', '20', '50'],
            size: 'small',
            onChange: (p, ps) => { setPage(p); setPageSize(ps); setTimeout(() => fetchLogs(p), 0); },
          }}
          size="small"
          locale={{ emptyText: <Empty description="暂无登录记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          rowClassName={(_, i) => i % 2 === 0 ? '' : 'row-striped'}
        />
      </div>

      <style>{`
        .row-striped td { background: rgba(0,0,0,0.015) !important; }
      `}</style>
    </div>
  );
}
