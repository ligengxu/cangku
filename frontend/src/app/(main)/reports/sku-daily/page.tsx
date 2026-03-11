'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Table, DatePicker, Button, Space, message, Row, Col, Empty, Tag,
  Segmented, Tooltip, Typography, Badge, Avatar,
} from 'antd';
import {
  SearchOutlined, FileTextOutlined, BarChartOutlined, TagOutlined,
  InboxOutlined, DownloadOutlined, TeamOutlined, AppstoreOutlined,
  CheckCircleOutlined, DollarOutlined, ThunderboltOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import { exportToCsv } from '@/utils/exportCsv';
import dayjs, { Dayjs } from 'dayjs';

const { Text } = Typography;
const { RangePicker } = DatePicker;

interface SkuViewItem {
  sku_id: number; sku_name: string; fruit_name: string; performance: number;
  printed: number; outbound: number; actual_production: number; commission: number;
  workers: { worker_id: number; worker_name: string; printed: number; outbound: number; actual_production: number; commission: number }[];
}

interface WorkerViewItem {
  worker_id: number; worker_name: string;
  printed: number; outbound: number; actual_production: number; commission: number;
  skus: { sku_id: number; sku_name: string; fruit_name: string; printed: number; outbound: number; actual_production: number; commission: number; performance: number }[];
}

export default function SkuDailyReportPage() {
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'sku' | 'worker'>('sku');
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([dayjs(), dayjs()]);
  const [skuData, setSkuData] = useState<SkuViewItem[]>([]);
  const [workerData, setWorkerData] = useState<WorkerViewItem[]>([]);
  const [totals, setTotals] = useState<any>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/reports/sku-report-enhanced', {
        params: {
          start_date: dateRange[0].format('YYYY-MM-DD'),
          end_date: dateRange[1].format('YYYY-MM-DD'),
          view,
        },
      });
      const d = r.data?.data;
      if (view === 'sku') {
        setSkuData(d?.items || []);
      } else {
        setWorkerData(d?.items || []);
      }
      setTotals(d?.totals || {});
    } catch {
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  }, [dateRange, view]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const statCards = [
    { label: '打印总量', value: totals.printed || 0, icon: <TagOutlined />, color: '#1677ff', gradient: 'linear-gradient(135deg, #1677ff, #69b1ff)' },
    { label: '出库总量', value: totals.outbound || 0, icon: <CheckCircleOutlined />, color: '#52c41a', gradient: 'linear-gradient(135deg, #52c41a, #95de64)' },
    { label: '实际产量', value: totals.actual_production || 0, icon: <InboxOutlined />, color: '#fa8c16', gradient: 'linear-gradient(135deg, #fa8c16, #ffc53d)' },
    { label: '总佣金', value: totals.commission || 0, icon: <DollarOutlined />, color: '#eb2f96', gradient: 'linear-gradient(135deg, #eb2f96, #f759ab)' },
  ];

  const handleExport = () => {
    const items = view === 'sku' ? skuData : workerData;
    if (!items.length) { message.warning('暂无数据'); return; }
    if (view === 'sku') {
      exportToCsv(skuData, [
        { key: 'sku_name', title: 'SKU' },
        { key: 'fruit_name', title: '水果' },
        { key: 'performance', title: '绩效系数' },
        { key: 'printed', title: '打印数' },
        { key: 'outbound', title: '出库数' },
        { key: 'actual_production', title: '实际产量' },
        { key: 'commission', title: '佣金' },
      ], `SKU日报_${dateRange[0].format('YYYYMMDD')}`);
    } else {
      exportToCsv(workerData, [
        { key: 'worker_name', title: '工人' },
        { key: 'printed', title: '打印数' },
        { key: 'outbound', title: '出库数' },
        { key: 'actual_production', title: '实际产量' },
        { key: 'commission', title: '佣金' },
      ], `工人日报_${dateRange[0].format('YYYYMMDD')}`);
    }
  };

  const skuColumns = [
    {
      title: 'SKU', dataIndex: 'sku_name', width: 160,
      render: (v: string, r: SkuViewItem) => (
        <div>
          <Text strong style={{ color: 'var(--brand)', fontSize: 13 }}>{v}</Text>
          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{r.fruit_name}</div>
        </div>
      ),
    },
    { title: '绩效', dataIndex: 'performance', width: 70, render: (v: number) => <Tag color="purple" style={{ borderRadius: 6 }}>{v}</Tag> },
    { title: '打印', dataIndex: 'printed', width: 70, sorter: (a: SkuViewItem, b: SkuViewItem) => a.printed - b.printed, render: (v: number) => <Text style={{ fontWeight: 600 }}>{v}</Text> },
    {
      title: '出库', dataIndex: 'outbound', width: 70,
      sorter: (a: SkuViewItem, b: SkuViewItem) => a.outbound - b.outbound,
      render: (v: number) => <Text style={{ fontWeight: 600, color: '#52c41a' }}>{v}</Text>,
    },
    { title: '产量', dataIndex: 'actual_production', width: 70, render: (v: number) => <Text style={{ fontWeight: 500 }}>{v}</Text> },
    {
      title: '佣金', dataIndex: 'commission', width: 90,
      sorter: (a: SkuViewItem, b: SkuViewItem) => a.commission - b.commission,
      render: (v: number) => <Text style={{ fontWeight: 700, color: '#eb2f96' }}>{Number(v).toFixed(1)}</Text>,
    },
    { title: '工人数', key: 'wc', width: 70, render: (_: any, r: SkuViewItem) => <Badge count={r.workers?.length || 0} style={{ backgroundColor: '#1677ff' }} /> },
  ];

  const workerColumns = [
    {
      title: '工人', dataIndex: 'worker_name', width: 130,
      render: (v: string) => (
        <Space size={8}>
          <Avatar size={28} style={{ background: 'linear-gradient(135deg, #1677ff, #722ed1)', fontSize: 11, fontWeight: 700 }}>{v[0]}</Avatar>
          <Text strong>{v}</Text>
        </Space>
      ),
    },
    { title: '打印', dataIndex: 'printed', width: 70, sorter: (a: WorkerViewItem, b: WorkerViewItem) => a.printed - b.printed, render: (v: number) => <Text style={{ fontWeight: 600 }}>{v}</Text> },
    { title: '出库', dataIndex: 'outbound', width: 70, sorter: (a: WorkerViewItem, b: WorkerViewItem) => a.outbound - b.outbound, render: (v: number) => <Text style={{ color: '#52c41a', fontWeight: 600 }}>{v}</Text> },
    { title: '产量', dataIndex: 'actual_production', width: 70, render: (v: number) => <Text style={{ fontWeight: 500 }}>{v}</Text> },
    { title: '佣金', dataIndex: 'commission', width: 90, sorter: (a: WorkerViewItem, b: WorkerViewItem) => a.commission - b.commission, render: (v: number) => <Text style={{ fontWeight: 700, color: '#eb2f96' }}>{Number(v).toFixed(1)}</Text> },
    { title: 'SKU数', key: 'sc', width: 70, render: (_: any, r: WorkerViewItem) => <Badge count={r.skus?.length || 0} style={{ backgroundColor: '#722ed1' }} /> },
  ];

  const expandedSkuRow = (record: SkuViewItem) => (
    <Table
      dataSource={record.workers}
      rowKey="worker_id"
      pagination={false}
      size="small"
      columns={[
        { title: '工人', dataIndex: 'worker_name', render: (v: string) => <Tag color="blue" style={{ borderRadius: 6 }}>{v}</Tag> },
        { title: '打印', dataIndex: 'printed' },
        { title: '出库', dataIndex: 'outbound', render: (v: number) => <Text style={{ color: '#52c41a', fontWeight: 600 }}>{v}</Text> },
        { title: '产量', dataIndex: 'actual_production' },
        { title: '佣金', dataIndex: 'commission', render: (v: number) => <Text style={{ color: '#eb2f96', fontWeight: 600 }}>{Number(v).toFixed(1)}</Text> },
      ]}
    />
  );

  const expandedWorkerRow = (record: WorkerViewItem) => (
    <Table
      dataSource={record.skus}
      rowKey="sku_id"
      pagination={false}
      size="small"
      columns={[
        { title: 'SKU', dataIndex: 'sku_name', render: (v: string, r: any) => <div><Text strong style={{ color: 'var(--brand)' }}>{v}</Text><div style={{ fontSize: 11, color: 'var(--text-3)' }}>{r.fruit_name}</div></div> },
        { title: '绩效', dataIndex: 'performance', render: (v: number) => <Tag color="purple" style={{ borderRadius: 6 }}>{v}</Tag> },
        { title: '打印', dataIndex: 'printed' },
        { title: '出库', dataIndex: 'outbound', render: (v: number) => <Text style={{ color: '#52c41a', fontWeight: 600 }}>{v}</Text> },
        { title: '产量', dataIndex: 'actual_production' },
        { title: '佣金', dataIndex: 'commission', render: (v: number) => <Text style={{ color: '#eb2f96', fontWeight: 600 }}>{Number(v).toFixed(1)}</Text> },
      ]}
    />
  );

  const summaryRow = () => {
    if ((view === 'sku' ? skuData : workerData).length === 0) return null;
    return (
      <Table.Summary.Row style={{ background: 'rgba(22,119,255,0.03)', fontWeight: 700 }}>
        <Table.Summary.Cell index={0}>合计</Table.Summary.Cell>
        {view === 'sku' && <Table.Summary.Cell index={1}>-</Table.Summary.Cell>}
        <Table.Summary.Cell index={view === 'sku' ? 2 : 1}>{totals.printed}</Table.Summary.Cell>
        <Table.Summary.Cell index={view === 'sku' ? 3 : 2}><Text style={{ color: '#52c41a' }}>{totals.outbound}</Text></Table.Summary.Cell>
        <Table.Summary.Cell index={view === 'sku' ? 4 : 3}>{totals.actual_production}</Table.Summary.Cell>
        <Table.Summary.Cell index={view === 'sku' ? 5 : 4}><Text style={{ color: '#eb2f96' }}>{Number(totals.commission || 0).toFixed(1)}</Text></Table.Summary.Cell>
        <Table.Summary.Cell index={view === 'sku' ? 6 : 5}>-</Table.Summary.Cell>
      </Table.Summary.Row>
    );
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #1677ff 0%, #722ed1 50%, #eb2f96 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: -30, right: -20, width: 180, height: 180,
          borderRadius: '50%', background: 'rgba(255,255,255,0.06)',
        }} />
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{
                width: 42, height: 42, borderRadius: 12,
                background: 'rgba(255,255,255,0.2)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 20,
              }}><BarChartOutlined /></span>
              <span style={{ fontSize: 22, fontWeight: 700 }}>SKU 综合日报</span>
            </div>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14 }}>
              多维度生产报表 · 打印/出库/产量/佣金一览
            </Text>
          </div>
          <Space>
            <Button icon={<DownloadOutlined />} onClick={handleExport}
              style={{ borderRadius: 10, background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none' }}>导出</Button>
            <Button icon={<ReloadOutlined />} onClick={fetchData}
              style={{ borderRadius: 10, background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none' }}>刷新</Button>
          </Space>
        </div>
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 18, flexWrap: 'wrap', gap: 12,
      }}>
        <Space wrap size={12}>
          <RangePicker
            value={dateRange}
            onChange={v => { if (v) setDateRange(v as [Dayjs, Dayjs]); }}
            style={{ borderRadius: 10 }}
            format="YYYY-MM-DD"
          />
          <Button size="small" onClick={() => setDateRange([dayjs(), dayjs()])}>今天</Button>
          <Button size="small" onClick={() => setDateRange([dayjs().subtract(6, 'day'), dayjs()])}>近7天</Button>
          <Button size="small" onClick={() => setDateRange([dayjs().startOf('month'), dayjs()])}>本月</Button>
        </Space>
        <Segmented
          value={view}
          onChange={v => setView(v as 'sku' | 'worker')}
          options={[
            { label: <Space><AppstoreOutlined />SKU 视图</Space>, value: 'sku' },
            { label: <Space><TeamOutlined />工人视图</Space>, value: 'worker' },
          ]}
          style={{ borderRadius: 10 }}
        />
      </div>

      {/* Stats */}
      <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
        {statCards.map((c, i) => (
          <Col xs={12} sm={6} key={i}>
            <div style={{
              background: 'var(--bg-card)', borderRadius: 14, padding: '18px 16px',
              border: '1px solid var(--border-2)', boxShadow: 'var(--shadow-1)',
              display: 'flex', alignItems: 'center', gap: 12,
              animation: `fadeSlideUp 0.4s ease ${i * 0.06}s both`,
            }}>
              <div style={{
                width: 44, height: 44, borderRadius: 12, background: c.gradient,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 20, color: '#fff', boxShadow: `0 4px 14px ${c.color}30`, flexShrink: 0,
              }}>{c.icon}</div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{c.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)' }}>
                  {typeof c.value === 'number' ? (c.label === '总佣金' ? Number(c.value).toFixed(1) : c.value.toLocaleString()) : c.value}
                </div>
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* Table */}
      <div style={{
        borderRadius: 16, border: '1px solid var(--border-2)',
        boxShadow: 'var(--shadow-1)', overflow: 'hidden', background: 'var(--bg-card)',
      }}>
        <Table
          dataSource={(view === 'sku' ? skuData : workerData) as any[]}
          columns={(view === 'sku' ? skuColumns : workerColumns) as any[]}
          rowKey={view === 'sku' ? 'sku_id' : 'worker_id'}
          loading={loading}
          size="middle"
          pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `共 ${t} 条`, style: { padding: '12px 16px', margin: 0 } }}
          expandable={{
            expandedRowRender: (r: any) => view === 'sku' ? expandedSkuRow(r) : expandedWorkerRow(r),
            rowExpandable: (r: any) => view === 'sku' ? r.workers?.length > 0 : r.skus?.length > 0,
          }}
          locale={{ emptyText: <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          summary={summaryRow}
          scroll={{ x: 600 }}
        />
      </div>

      <style jsx global>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
