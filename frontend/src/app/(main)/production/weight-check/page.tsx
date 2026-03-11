'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, Tag, Space, Row, Col, Button, Tooltip, Empty, Avatar, message, Select,
} from 'antd';
import {
  WarningOutlined, CheckCircleOutlined, ReloadOutlined, SwapOutlined,
  ExperimentOutlined, ExclamationCircleOutlined, DownloadOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import { exportToCsv } from '@/utils/exportCsv';

interface WeightItem {
  id: number;
  worker_id: number;
  worker_name: string;
  sku_id: number;
  sku_name: string;
  batch_id: number;
  estimated_weight: number;
  actual_weight: number;
  weight_difference: number;
  scanned_time: string | null;
  weight_fixed: boolean;
  weight_fixed_time: string | null;
  suspect_swapped: boolean;
  swap_label_id: number | null;
}

interface Stats {
  total_abnormal: number;
  unfixed: number;
  fixed: number;
  suspect_swapped: number;
}

const COLORS = ['#1677ff', '#00b96b', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2'];

export default function WeightCheckPage() {
  const [data, setData] = useState<WeightItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('all');
  const [days, setDays] = useState(30);
  const [refreshSpin, setRefreshSpin] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/production/outbound/weight-abnormal', {
        params: { page, page_size: 20, status: filter, days },
      });
      const d = res.data?.data;
      setData(d?.items || []);
      setTotal(d?.total || 0);
      setStats(d?.stats || null);
    } catch { message.error('加载失败'); }
    finally { setLoading(false); }
  }, [page, filter, days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 500));
  };

  const handleExport = () => {
    if (!data.length) return;
    exportToCsv(data, [
      { key: 'id', title: '标签号' },
      { key: 'worker_name', title: '工人' },
      { key: 'sku_name', title: 'SKU' },
      { key: 'batch_id', title: '批次ID' },
      { key: 'estimated_weight', title: '预估重量(kg)', render: (v: unknown) => Number(v).toFixed(2) },
      { key: 'actual_weight', title: '实际重量(kg)', render: (v: unknown) => Number(v).toFixed(2) },
      { key: 'weight_difference', title: '差值(kg)', render: (v: unknown) => Number(v).toFixed(2) },
      { key: 'scanned_time', title: '出库时间' },
      { key: 'weight_fixed', title: '状态', render: (v: unknown) => v ? '已修正' : '未修正' },
      { key: 'suspect_swapped', title: '疑似换码', render: (v: unknown) => v ? '是' : '否' },
      { key: 'swap_label_id', title: '换码标签号', render: (v: unknown) => v ? `#${v}` : '' },
    ], '重量异常记录');
  };

  const statCards = [
    { label: '总异常', value: stats?.total_abnormal ?? 0, icon: <ExperimentOutlined />, gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.15)' },
    { label: '未修正', value: stats?.unfixed ?? 0, icon: <WarningOutlined />, gradient: 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)', glow: 'rgba(255,77,79,0.15)' },
    { label: '已修正', value: stats?.fixed ?? 0, icon: <CheckCircleOutlined />, gradient: 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: 'rgba(0,185,107,0.15)' },
    { label: '疑似换码', value: stats?.suspect_swapped ?? 0, icon: <SwapOutlined />, gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', glow: 'rgba(114,46,209,0.15)' },
  ];

  const columns: any[] = [
    {
      title: '标签', dataIndex: 'id', width: 80, fixed: 'left',
      render: (v: number) => <span style={{ fontWeight: 700, color: 'var(--brand)' }}>#{v}</span>,
    },
    {
      title: '工人', dataIndex: 'worker_name', width: 120,
      render: (v: string) => (
        <Space size={6}>
          <Avatar size={24} style={{ background: COLORS[(v || '').charCodeAt(0) % COLORS.length], fontWeight: 700, fontSize: 10 }}>
            {(v || '?')[0]}
          </Avatar>
          <span style={{ fontWeight: 600, fontSize: 13 }}>{v}</span>
        </Space>
      ),
    },
    {
      title: 'SKU', dataIndex: 'sku_name', width: 150, ellipsis: true,
      render: (v: string) => (
        <span style={{
          display: 'inline-block', padding: '1px 8px', borderRadius: 6, fontSize: 12, fontWeight: 500,
          background: 'linear-gradient(135deg, rgba(22,119,255,0.08), rgba(22,119,255,0.03))',
          color: '#1677ff', border: '1px solid rgba(22,119,255,0.12)',
        }}>{v}</span>
      ),
    },
    {
      title: '批次', dataIndex: 'batch_id', width: 70, align: 'center' as const,
      render: (v: number) => <span style={{ color: 'var(--text-3)', fontSize: 12 }}>#{v}</span>,
    },
    {
      title: '预估', dataIndex: 'estimated_weight', width: 85, align: 'right' as const,
      render: (v: number) => <span className="num" style={{ color: 'var(--text-2)' }}>{v?.toFixed(2)}kg</span>,
    },
    {
      title: '实际', dataIndex: 'actual_weight', width: 85, align: 'right' as const,
      render: (v: number) => <span className="num" style={{ fontWeight: 700 }}>{v?.toFixed(2)}kg</span>,
    },
    {
      title: '差值', dataIndex: 'weight_difference', width: 100, align: 'right' as const,
      render: (v: number) => (
        <Tag color={Math.abs(v) > 1 ? 'error' : 'warning'} style={{ borderRadius: 6, fontWeight: 700, fontSize: 12 }}>
          {v > 0 ? '+' : ''}{v?.toFixed(2)}kg
        </Tag>
      ),
      sorter: (a: WeightItem, b: WeightItem) => Math.abs(b.weight_difference) - Math.abs(a.weight_difference),
    },
    {
      title: '出库时间', dataIndex: 'scanned_time', width: 145,
      render: (v: string) => v ? <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{v.replace('T', ' ').slice(0, 16)}</span> : '-',
      sorter: (a: WeightItem, b: WeightItem) => (a.scanned_time || '').localeCompare(b.scanned_time || ''),
    },
    {
      title: '修正状态', key: 'status', width: 110, align: 'center' as const,
      render: (_: any, r: WeightItem) => r.weight_fixed ? (
        <Tooltip title={`修正时间: ${r.weight_fixed_time?.replace('T', ' ')?.slice(0, 16) || '-'}`}>
          <Tag icon={<CheckCircleOutlined />} color="success" style={{ borderRadius: 8, fontWeight: 600 }}>已修正</Tag>
        </Tooltip>
      ) : (
        <Tag icon={<WarningOutlined />} color="error" style={{ borderRadius: 8, fontWeight: 600 }}>未修正</Tag>
      ),
    },
    {
      title: '换码检测', key: 'swap', width: 130, align: 'center' as const,
      render: (_: any, r: WeightItem) => {
        if (r.weight_fixed) return <Tag style={{ borderRadius: 6, fontSize: 11 }} color="default">无需检测</Tag>;
        if (r.suspect_swapped) return (
          <Tooltip title={`疑似用标签 #${r.swap_label_id} 替代出库`}>
            <Tag icon={<ExclamationCircleOutlined />} color="purple" style={{ borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
              疑似换码 #{r.swap_label_id}
            </Tag>
          </Tooltip>
        );
        return <Tag style={{ borderRadius: 6, fontSize: 11 }} color="default">正常</Tag>;
      },
    },
  ];

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #fa8c16 0%, #ff4d4f 40%, #cf1322 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -30, right: -20, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
        <div style={{ position: 'absolute', bottom: -40, left: '30%', width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{
              width: 48, height: 48, borderRadius: 14,
              background: 'rgba(255,255,255,0.2)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 24,
              backdropFilter: 'blur(10px)',
            }}><ExperimentOutlined /></span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>重量异常追踪</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
                追踪所有重量不符的出库标签 · 检测是否已修正或疑似换码出库
              </div>
            </div>
          </div>
          <Space>
            <Select value={days} onChange={v => { setDays(v); setPage(1); }}
              options={[
                { value: 7, label: '近7天' },
                { value: 14, label: '近14天' },
                { value: 30, label: '近30天' },
                { value: 90, label: '近90天' },
              ]}
              style={{ width: 100, borderRadius: 10 }}
            />
            <Tooltip title="导出">
              <Button icon={<DownloadOutlined />} onClick={handleExport} disabled={!data.length}
                style={{ borderRadius: 10, background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none' }} />
            </Tooltip>
            <Tooltip title="刷新">
              <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh}
                style={{ borderRadius: 10, background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none' }} />
            </Tooltip>
          </Space>
        </div>
      </div>

      {/* Stat Cards */}
      <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
        {statCards.map((s, i) => (
          <Col xs={12} sm={6} key={i}>
            <div style={{
              padding: '14px 16px', borderRadius: 'var(--radius-m, 12px)',
              background: s.gradient, position: 'relative', overflow: 'hidden',
              boxShadow: `0 4px 14px ${s.glow}`, transition: 'all 0.3s', cursor: 'pointer',
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
            >
              <div style={{ position: 'absolute', top: -12, right: -12, width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                {s.icon} {s.label}
              </div>
              <div className="num" style={{ fontSize: 24, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>
                {s.value}
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* Filter + Table */}
      <div className="panel">
        <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {[
            { key: 'all', label: '全部', color: '#1677ff', count: stats?.total_abnormal },
            { key: 'unfixed', label: '未修正', color: '#ff4d4f', count: stats?.unfixed },
            { key: 'fixed', label: '已修正', color: '#52c41a', count: stats?.fixed },
            { key: 'swapped', label: '疑似换码', color: '#722ed1', count: stats?.suspect_swapped },
          ].map(f => (
            <div key={f.key}
              onClick={() => { setFilter(f.key); setPage(1); }}
              style={{
                padding: '5px 16px', borderRadius: 20, fontSize: 13, fontWeight: 600,
                background: filter === f.key ? f.color : 'rgba(0,0,0,0.04)',
                color: filter === f.key ? '#fff' : 'var(--text-3)',
                cursor: 'pointer', transition: 'all 0.2s',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
              {f.label}
              {f.count != null && f.count > 0 && (
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '0 6px', borderRadius: 10,
                  background: filter === f.key ? 'rgba(255,255,255,0.25)' : `${f.color}15`,
                  color: filter === f.key ? '#fff' : f.color,
                }}>{f.count}</span>
              )}
            </div>
          ))}
        </div>

        <Table
          rowKey="id"
          columns={columns}
          dataSource={data}
          loading={loading}
          size="middle"
          pagination={{
            current: page, pageSize: 20, total,
            showTotal: t => `共 ${t} 条`,
            onChange: p => setPage(p),
          }}
          scroll={{ x: 1200 }}
          locale={{ emptyText: <Empty description="暂无重量异常记录" /> }}
          rowClassName={(r: WeightItem) => r.suspect_swapped ? 'row-suspect' : ''}
        />
      </div>

      <style jsx global>{`
        .row-suspect td { background: rgba(114,46,209,0.03) !important; }
        .row-suspect:hover td { background: rgba(114,46,209,0.06) !important; }
      `}</style>
    </div>
  );
}
