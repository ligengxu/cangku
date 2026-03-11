'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Tag, Space, Typography, Row, Col, DatePicker,
  Button, Select, Tooltip, Empty, message,
} from 'antd';
import {
  WarningOutlined, CopyOutlined, ExclamationCircleOutlined,
  InboxOutlined, BugOutlined,
  ReloadOutlined, FilterOutlined, DownloadOutlined,
  AlertOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import api from '@/services/api';
import { exportToCsv } from '@/utils/exportCsv';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

interface FailureLog {
  id: number;
  tickets_num: number;
  worker_id: number;
  worker_name: string;
  sku_id: number;
  sku_name: string;
  fruit_name: string;
  failure_reason: string;
  failure_time: string;
  scanned_weight: number | null;
}

interface Stats {
  total: number;
  duplicate: number;
  weight: number;
  stock: number;
  mismatch: number;
  other: number;
  weight_not_shipped: number;
}

const CATEGORIES = [
  { key: '', label: '全部', icon: <AlertOutlined />, color: '#1677ff', gradient: 'linear-gradient(135deg, #1677ff, #69b1ff)' },
  { key: 'duplicate', label: '重复扫码', icon: <CopyOutlined />, color: '#1677ff', gradient: 'linear-gradient(135deg, #1677ff, #4096ff)' },
  { key: 'weight', label: '重量误差', icon: <WarningOutlined />, color: '#ff4d4f', gradient: 'linear-gradient(135deg, #ff4d4f, #ff7875)' },
  { key: 'stock', label: '库存不足', icon: <InboxOutlined />, color: '#fa8c16', gradient: 'linear-gradient(135deg, #fa8c16, #ffc53d)' },
  { key: 'mismatch', label: '数据不匹配', icon: <ExclamationCircleOutlined />, color: '#13c2c2', gradient: 'linear-gradient(135deg, #13c2c2, #5cdbd3)' },
  { key: 'other', label: '其他', icon: <BugOutlined />, color: '#722ed1', gradient: 'linear-gradient(135deg, #722ed1, #b37feb)' },
];

export default function FailureLogsPage() {
  const [logs, setLogs] = useState<FailureLog[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [category, setCategory] = useState('');
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([dayjs(), dayjs()]);
  const [workers, setWorkers] = useState<{id: number; name: string}[]>([]);
  const [selectedWorker, setSelectedWorker] = useState<number | undefined>();
  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, page_size: pageSize };
      if (category) params.category = category;
      if (dateRange[0]) params.start_date = dateRange[0].format('YYYY-MM-DD');
      if (dateRange[1]) params.end_date = dateRange[1].format('YYYY-MM-DD');
      if (selectedWorker) params.worker_id = selectedWorker;

      const r = await api.get('/production/failure-logs', { params });
      setLogs(r.data?.data || []);
      setTotal(r.data?.total || 0);
    } catch {
      message.error('加载失败日志失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, category, dateRange, selectedWorker]);

  const fetchStats = useCallback(async () => {
    try {
      const params: any = {};
      if (dateRange[0]) params.start_date = dateRange[0].format('YYYY-MM-DD');
      if (dateRange[1]) params.end_date = dateRange[1].format('YYYY-MM-DD');
      const r = await api.get('/production/failure-logs/stats', { params });
      setStats(r.data?.data);
    } catch { /* ignore */ }
  }, [dateRange]);

  const fetchWorkers = useCallback(async () => {
    try {
      const r = await api.get('/workers', { params: { page_size: 200 } });
      const data = r.data?.data || [];
      setWorkers(data.map((w: any) => ({ id: w.id, name: w.real_name || w.username })));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchWorkers(); }, [fetchWorkers]);
  useEffect(() => { fetchLogs(); fetchStats(); }, [fetchLogs, fetchStats]);

  const handleExport = () => {
    if (!logs.length) { message.warning('暂无数据可导出'); return; }
    exportToCsv(
      logs,
      [
        { key: 'id', title: 'ID' },
        { key: 'tickets_num', title: '标签号' },
        { key: 'worker_name', title: '工人' },
        { key: 'sku_name', title: 'SKU' },
        { key: 'fruit_name', title: '水果' },
        { key: 'failure_reason', title: '失败原因' },
        { key: 'scanned_weight', title: '称重(kg)', render: (v: unknown) => v ? `${Number(v).toFixed(2)}` : '' },
        { key: 'failure_time', title: '时间' },
      ],
      `失败日志_${dateRange[0]?.format('YYYYMMDD')}_${dateRange[1]?.format('YYYYMMDD')}`,
    );
  };

  const getCategoryTag = (reason: string) => {
    if (reason.includes('已经扫码') || reason.includes('重复扫码')) return { label: '重复扫码', color: 'blue', icon: <CopyOutlined /> };
    if (reason.includes('重量差值过大') || reason.includes('重量相差过大')) return { label: '重量误差', color: 'red', icon: <WarningOutlined /> };
    if (reason.includes('库存不足') || reason.includes('库存:-') || reason.includes('库存:0')) return { label: '库存不足', color: 'orange', icon: <InboxOutlined /> };
    if (reason.includes('不存在') || reason.includes('未找到')) return { label: '数据不匹配', color: 'cyan', icon: <ExclamationCircleOutlined /> };
    return { label: '其他', color: 'purple', icon: <BugOutlined /> };
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 70, render: (v: number) => <Text style={{ color: 'var(--text-3)', fontSize: 12 }}>#{v}</Text> },
    { title: '标签号', dataIndex: 'tickets_num', width: 90, render: (v: number) => <Text strong style={{ color: 'var(--brand)' }}>#{v}</Text> },
    {
      title: '分类', dataIndex: 'failure_reason', width: 110, key: 'cat',
      render: (v: string) => {
        const cat = getCategoryTag(v);
        return <Tag icon={cat.icon} color={cat.color} style={{ borderRadius: 6, fontSize: 11 }}>{cat.label}</Tag>;
      },
    },
    {
      title: '工人', dataIndex: 'worker_name', width: 90,
      render: (v: string) => <Tag color="blue" style={{ borderRadius: 6 }}>{v}</Tag>,
    },
    {
      title: 'SKU', dataIndex: 'sku_name', width: 150,
      render: (v: string, r: FailureLog) => (
        <div>
          <div style={{ fontWeight: 500, fontSize: 13 }}>{v}</div>
          {r.fruit_name && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{r.fruit_name}</div>}
        </div>
      ),
    },
    {
      title: '失败原因', dataIndex: 'failure_reason', width: 280,
      render: (v: string) => (
        <Tooltip title={v}>
          <Text style={{ fontSize: 12, color: 'var(--text-2)' }} ellipsis>{v}</Text>
        </Tooltip>
      ),
    },
    {
      title: '称重', dataIndex: 'scanned_weight', width: 80,
      render: (v: number | null) => v ? `${Number(v).toFixed(2)}kg` : '-',
    },
    {
      title: '时间', dataIndex: 'failure_time', width: 150,
      render: (v: string) => v ? dayjs(v).format('MM-DD HH:mm:ss') : '-',
    },
  ];

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Page header */}
      <div style={{
        background: 'linear-gradient(135deg, #ff4d4f 0%, #cf1322 40%, #a8071a 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: -30, right: -20, width: 180, height: 180,
          borderRadius: '50%', background: 'rgba(255,255,255,0.06)',
        }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{
                width: 42, height: 42, borderRadius: 12,
                background: 'rgba(255,255,255,0.2)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 20,
              }}>
                <CloseCircleOutlined />
              </span>
              <Title level={3} style={{ margin: 0, color: '#fff' }}>失败日志查询</Title>
            </div>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14 }}>
              分类查看扫码失败记录 · 重量误差追踪 · 异常分析
            </Text>
          </div>
          <Space>
            <Button icon={<DownloadOutlined />} onClick={handleExport}
              style={{ borderRadius: 10, background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none' }}>
              导出
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => { fetchLogs(); fetchStats(); }}
              style={{ borderRadius: 10, background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none' }}>
              刷新
            </Button>
          </Space>
        </div>
      </div>

      {/* Stats cards */}
      <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
        {CATEGORIES.map((cat, i) => {
          const count = cat.key === ''
            ? (stats?.total ?? 0)
            : (stats as any)?.[cat.key === 'duplicate' ? 'duplicate' : cat.key] ?? 0;
          const isActive = category === cat.key;
          return (
            <Col xs={8} sm={4} key={cat.key || 'all'}>
              <div
                onClick={() => { setCategory(cat.key); setPage(1); }}
                style={{
                  padding: '14px 10px', borderRadius: 14, textAlign: 'center',
                  cursor: 'pointer', transition: 'all 0.3s',
                  background: isActive ? cat.gradient : 'var(--bg-card)',
                  border: isActive ? 'none' : '1px solid var(--border-2)',
                  boxShadow: isActive ? `0 4px 16px ${cat.color}40` : 'var(--shadow-1)',
                  color: isActive ? '#fff' : 'var(--text-1)',
                  transform: isActive ? 'scale(1.02)' : 'scale(1)',
                  animation: `fadeSlideUp 0.4s ease ${i * 0.06}s both`,
                }}
              >
                <div style={{ fontSize: 18, marginBottom: 4 }}>{cat.icon}</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{count}</div>
                <div style={{ fontSize: 11, opacity: isActive ? 0.9 : 0.6 }}>{cat.label}</div>
              </div>
            </Col>
          );
        })}
        <Col xs={8} sm={4}>
          <div style={{
            padding: '14px 10px', borderRadius: 14, textAlign: 'center',
            background: 'linear-gradient(135deg, rgba(255,77,79,0.08), rgba(255,77,79,0.02))',
            border: '1px solid rgba(255,77,79,0.15)',
            animation: 'fadeSlideUp 0.4s ease 0.36s both',
          }}>
            <div style={{ fontSize: 18, marginBottom: 4, color: '#ff4d4f' }}><WarningOutlined /></div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#ff4d4f' }}>{stats?.weight_not_shipped ?? 0}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>重量异常未出库</div>
          </div>
        </Col>
      </Row>

      {/* Filters */}
      <Card style={{
        borderRadius: 14, marginBottom: 20, border: '1px solid var(--border-2)',
        boxShadow: 'var(--shadow-1)',
      }} styles={{ body: { padding: '14px 20px' } }}>
        <Space wrap size={12} style={{ width: '100%' }}>
          <FilterOutlined style={{ color: 'var(--brand)', fontSize: 14 }} />
          <RangePicker
            value={dateRange}
            onChange={(v) => { if (v) setDateRange(v as [Dayjs, Dayjs]); setPage(1); }}
            style={{ borderRadius: 10 }}
            format="YYYY-MM-DD"
          />
          <Select
            allowClear
            placeholder="选择工人"
            value={selectedWorker}
            onChange={(v) => { setSelectedWorker(v); setPage(1); }}
            style={{ width: 140, borderRadius: 10 }}
            options={workers.map(w => ({ value: w.id, label: w.name }))}
            showSearch
            filterOption={(input, opt) => (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
          />
        </Space>
      </Card>

      {/* Table */}
      <Card style={{
        borderRadius: 16, border: '1px solid var(--border-2)',
        boxShadow: 'var(--shadow-1)', overflow: 'hidden',
      }} styles={{ body: { padding: 0 } }}>
        <Table
          dataSource={logs}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{
            current: page,
            pageSize: pageSize,
            total: total,
            showSizeChanger: true,
            showTotal: t => `共 ${t} 条`,
            onChange: (p, ps) => { setPage(p); setPageSize(ps); },
            pageSizeOptions: ['20', '50', '100'],
            style: { padding: '12px 16px', margin: 0 },
          }}
          scroll={{ x: 960 }}
          size="small"
          locale={{ emptyText: <Empty description="暂无失败记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        />
      </Card>

      <style jsx global>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
