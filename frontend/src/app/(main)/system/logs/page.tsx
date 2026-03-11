'use client';

import { useState, useEffect, useCallback } from 'react';
import { Table, message, Avatar, Space, Row, Col, Tooltip, Button, Input, Select, DatePicker, Form, Tag } from 'antd';
import {
  UnorderedListOutlined, ClockCircleOutlined, UserOutlined, FileTextOutlined,
  ReloadOutlined, SearchOutlined, DownloadOutlined, FireOutlined, CalendarOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import type { ActionLog } from '@/types';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

interface LogStats {
  total: number;
  today: number;
  week: number;
  top_users: { username: string; count: number }[];
  daily_trend: { date: string; count: number }[];
}

export default function LogsPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ActionLog[]>([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [searchForm] = Form.useForm();

  const [filters, setFilters] = useState({
    page: 1, page_size: 20, username: '', keyword: '', start_date: '', end_date: '',
  });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string | number> = { page: filters.page, page_size: filters.page_size };
      if (filters.username) params.username = filters.username;
      if (filters.keyword) params.keyword = filters.keyword;
      if (filters.start_date) params.start_date = filters.start_date;
      if (filters.end_date) params.end_date = filters.end_date;
      const res = await api.get('/system/action-logs', { params });
      const d = res.data;
      setData(Array.isArray(d?.data) ? d.data : []);
      setTotal(d?.total ?? 0);
    } catch { message.error('加载数据失败'); setData([]); setTotal(0); }
    finally { setLoading(false); }
  }, [filters]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get('/system/action-logs/stats');
      setStats(res.data?.data ?? null);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  const handleRefresh = () => {
    setRefreshSpin(true);
    Promise.all([fetchData(), fetchStats()]).finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const handleSearch = (v: any) => {
    const [sd, ed] = v.date_range
      ? [v.date_range[0]?.format('YYYY-MM-DD') ?? '', v.date_range[1]?.format('YYYY-MM-DD') ?? '']
      : ['', ''];
    setFilters(p => ({ ...p, page: 1, username: v.username ?? '', keyword: v.keyword ?? '', start_date: sd, end_date: ed }));
  };

  const handleReset = () => {
    searchForm.resetFields();
    setFilters({ page: 1, page_size: 20, username: '', keyword: '', start_date: '', end_date: '' });
  };

  const exportCSV = () => {
    if (!data.length) { message.warning('没有数据可导出'); return; }
    const header = 'ID,用户,操作,IP地址,时间\n';
    const rows = data.map(r =>
      `${r.id},"${r.username ?? ''}","${(r.action ?? '').replace(/"/g, '""')}",${r.ip_address ?? ''},${r.timestamp ?? ''}`
    ).join('\n');
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + header + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `操作日志_${dayjs().format('YYYY-MM-DD')}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    message.success('导出成功');
  };

  const COLORS = ['#1677ff', '#00b96b', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2'];
  const getColor = (name: string) => COLORS[(name || '').charCodeAt(0) % COLORS.length];

  const trendMax = Math.max(...(stats?.daily_trend?.map(d => d.count) ?? []), 1);

  const columns = [
    {
      title: 'ID', dataIndex: 'id', key: 'id', width: 70,
      render: (v: number) => <span className="num" style={{ color: 'var(--text-4)', fontSize: 12 }}>#{v}</span>,
    },
    {
      title: '用户', dataIndex: 'username', key: 'username', width: 150,
      render: (v: string) => (
        <Space size={8}>
          <Avatar size={28} style={{ background: getColor(v || ''), fontWeight: 700, fontSize: 11, boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}>
            {(v || '?').charAt(0).toUpperCase()}
          </Avatar>
          <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{v ?? '-'}</span>
        </Space>
      ),
    },
    {
      title: '操作', dataIndex: 'action', key: 'action', ellipsis: true,
      render: (v: string) => {
        const isCreate = /新建|添加|创建/.test(v || '');
        const isDelete = /删除/.test(v || '');
        const isEdit = /编辑|修改|更新|确认|审批/.test(v || '');
        const color = isDelete ? '#ff4d4f' : isCreate ? '#00b96b' : isEdit ? '#fa8c16' : 'var(--text-2)';
        return <span style={{ color, fontWeight: isCreate || isDelete ? 600 : 400 }}>{v ?? '-'}</span>;
      },
    },
    {
      title: 'IP 地址', dataIndex: 'ip_address', key: 'ip_address', width: 140,
      render: (v: string) => v ? (
        <span style={{
          display: 'inline-block', padding: '1px 8px', borderRadius: 6, fontSize: 12,
          background: 'linear-gradient(135deg, rgba(22,119,255,0.06) 0%, rgba(22,119,255,0.02) 100%)',
          color: 'var(--text-2)', fontFamily: 'monospace', fontWeight: 500,
        }}>{v}</span>
      ) : <span style={{ color: 'var(--text-4)' }}>-</span>,
    },
    {
      title: '时间', dataIndex: 'timestamp', key: 'timestamp', width: 180,
      render: (v: string) => v ? (
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{dayjs(v).format('YYYY-MM-DD HH:mm:ss')}</div>
          <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{dayjs(v).fromNow()}</div>
        </div>
      ) : '-',
    },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22,
        padding: '20px 24px', borderRadius: 'var(--radius-l)',
        background: 'linear-gradient(135deg, rgba(22,119,255,0.05) 0%, rgba(19,194,194,0.03) 100%)',
        border: '1px solid rgba(22,119,255,0.06)',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 32, height: 32, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #1677ff 0%, #13c2c2 100%)', color: '#fff', fontSize: 15,
              boxShadow: '0 3px 10px rgba(22,119,255,0.2)',
            }}><UnorderedListOutlined /></span>
            操作日志
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 42 }}>系统操作记录追溯与审计分析</div>
        </div>
        <Space>
          <Tooltip title="刷新"><Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 10, height: 38, width: 38 }} /></Tooltip>
          <Tooltip title="导出 CSV"><Button icon={<DownloadOutlined />} onClick={exportCSV} disabled={!data.length} style={{ borderRadius: 10, height: 38, width: 38 }} /></Tooltip>
        </Space>
      </div>

      {/* Stats Cards */}
      <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
        {[
          { label: '日志总数', value: (stats?.total ?? total).toLocaleString(), unit: '条', icon: <FileTextOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.15)' },
          { label: '今日操作', value: (stats?.today ?? 0).toLocaleString(), unit: '条', icon: <CalendarOutlined />, gradient: 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: 'rgba(0,185,107,0.15)' },
          { label: '近7天', value: (stats?.week ?? 0).toLocaleString(), unit: '条', icon: <FireOutlined />, gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.15)' },
          { label: '活跃用户', value: (stats?.top_users?.length ?? 0).toLocaleString(), unit: '人', icon: <UserOutlined />, gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', glow: 'rgba(114,46,209,0.15)' },
        ].map((s, i) => (
          <Col xs={12} sm={6} key={i}>
            <div style={{
              padding: '14px 16px', borderRadius: 'var(--radius-m)', background: s.gradient, position: 'relative', overflow: 'hidden',
              boxShadow: `0 4px 14px ${s.glow}`, transition: 'all 0.3s',
              animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`,
              animationDelay: `${i * 0.08}s`,
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
            >
              <div style={{ position: 'absolute', top: -12, right: -12, width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>{s.icon} {s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', lineHeight: 1.2 }} className="num">
                {s.value}<span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3, opacity: 0.7 }}>{s.unit}</span>
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* Trend + Top Users */}
      <Row gutter={[16, 16]} style={{ marginBottom: 18 }}>
        <Col xs={24} lg={14}>
          <div className="panel" style={{ height: '100%' }}>
            <div className="panel-head">
              <span className="panel-title"><BarChartOutlined style={{ color: '#1677ff' }} />7日操作趋势</span>
            </div>
            <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'flex-end', gap: 8, height: 140 }}>
              {(stats?.daily_trend ?? []).map((item, idx) => {
                const h = trendMax > 0 ? (item.count / trendMax) * 90 : 0;
                return (
                  <Tooltip key={item.date} title={`${item.date}：${item.count} 条操作`}>
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                      <span className="num" style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600 }}>{item.count}</span>
                      <div style={{
                        width: '100%', maxWidth: 36, height: Math.max(h, item.count > 0 ? 4 : 0), minHeight: item.count > 0 ? 4 : 0,
                        background: 'linear-gradient(180deg, #1677ff 0%, #69b1ff88 100%)',
                        borderRadius: '4px 4px 0 0', transition: 'height 0.5s cubic-bezier(0.22,1,0.36,1)',
                        boxShadow: '0 2px 6px rgba(22,119,255,0.15)',
                      }} />
                      <span style={{ fontSize: 10, color: 'var(--text-4)', lineHeight: 1 }}>{item.date}</span>
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          </div>
        </Col>
        <Col xs={24} lg={10}>
          <div className="panel" style={{ height: '100%' }}>
            <div className="panel-head">
              <span className="panel-title"><UserOutlined style={{ color: '#722ed1' }} />活跃用户 Top 5</span>
              <span style={{ fontSize: 12, color: 'var(--text-4)' }}>近7天</span>
            </div>
            <div style={{ padding: '12px 16px' }}>
              {(stats?.top_users ?? []).map((u, i) => {
                const maxCnt = stats?.top_users?.[0]?.count || 1;
                const pct = Math.round((u.count / maxCnt) * 100);
                return (
                  <div key={u.username} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                    <Avatar size={26} style={{ background: getColor(u.username), fontWeight: 700, fontSize: 11, flexShrink: 0 }}>
                      {u.username.charAt(0).toUpperCase()}
                    </Avatar>
                    <span style={{ width: 60, fontSize: 13, fontWeight: 600, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</span>
                    <div style={{ flex: 1, height: 6, background: 'rgba(0,0,0,0.04)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{
                        width: `${pct}%`, height: '100%', borderRadius: 3,
                        background: `linear-gradient(90deg, ${getColor(u.username)}, ${getColor(u.username)}88)`,
                        transition: 'width 0.6s',
                      }} />
                    </div>
                    <Tag style={{ borderRadius: 6, fontSize: 11, fontWeight: 600, minWidth: 42, textAlign: 'center' }}>{u.count}</Tag>
                  </div>
                );
              })}
              {!(stats?.top_users?.length) && <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-4)', fontSize: 13 }}>暂无数据</div>}
            </div>
          </div>
        </Col>
      </Row>

      {/* Filter + Table */}
      <div className="panel">
        <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
          <Form form={searchForm} layout="inline" onFinish={handleSearch} style={{ gap: 8, flexWrap: 'wrap' }}>
            <Form.Item name="username" style={{ marginBottom: 0 }}>
              <Input placeholder="用户名" allowClear prefix={<UserOutlined />} style={{ width: 130, borderRadius: 8 }} />
            </Form.Item>
            <Form.Item name="keyword" style={{ marginBottom: 0 }}>
              <Input placeholder="操作关键词" allowClear style={{ width: 150, borderRadius: 8 }} />
            </Form.Item>
            <Form.Item name="date_range" style={{ marginBottom: 0 }}>
              <DatePicker.RangePicker style={{ borderRadius: 8 }} />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Space size={6}>
                <Button type="primary" htmlType="submit" icon={<SearchOutlined />} style={{ borderRadius: 8 }}>搜索</Button>
                <Button onClick={handleReset} icon={<ReloadOutlined />} style={{ borderRadius: 8 }}>重置</Button>
              </Space>
            </Form.Item>
          </Form>
        </div>
        <div className="panel-head" style={{ borderBottom: 'none', paddingBottom: 0 }}>
          <span className="panel-title"><ClockCircleOutlined style={{ color: '#13c2c2' }} />操作记录</span>
          <span style={{ fontSize: 12, color: 'var(--text-4)' }}>共 {total.toLocaleString()} 条</span>
        </div>
        <Table
          dataSource={data} columns={columns} rowKey="id" size="middle" loading={loading}
          pagination={{
            current: filters.page, pageSize: filters.page_size, total,
            showSizeChanger: true, pageSizeOptions: ['10', '20', '50'],
            showTotal: t => `共 ${t} 条`,
            onChange: (p, ps) => setFilters(prev => ({ ...prev, page: p, page_size: ps ?? 20 })),
          }}
          locale={{ emptyText: '暂无日志' }}
        />
      </div>
    </div>
  );
}
