'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Space, Modal, Form, Input, InputNumber, message, Tooltip, Row, Col, Tag,
  Popconfirm, Segmented, DatePicker, Select, Empty, Spin, Badge,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, InboxOutlined,
  DropboxOutlined, DollarOutlined, CheckCircleOutlined, WarningOutlined,
  AlertOutlined, DownloadOutlined, SwapOutlined, HistoryOutlined,
  ArrowUpOutlined, ArrowDownOutlined, MinusOutlined, BarChartOutlined,
  CalendarOutlined, FileTextOutlined, SearchOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import { useRouter } from 'next/navigation';
import type { CartonBox } from '@/types';
import { exportToCsv } from '@/utils/exportCsv';
import dayjs from 'dayjs';
import dynamic from 'next/dynamic';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });
const { RangePicker } = DatePicker;

interface InventoryLogItem {
  id: number;
  carton_box_id: number;
  box_type: string;
  original_stock: number;
  change_quantity: number;
  after_stock: number;
  reason: string;
  changed_at: string;
}

interface DailySummary {
  date: string;
  total_in: number;
  total_out: number;
  net_change: number;
  log_count: number;
  total_cost: number;
}

interface LogData {
  items: (InventoryLogItem & { item_cost?: number })[];
  total: number;
  page: number;
  page_size: number;
  daily_summary: DailySummary[];
  box_options: { id: number; name: string }[];
  grand_totals?: { total_in: number; total_out: number; net_change: number; total_cost: number };
}

function StockFlowChart({ daily }: { daily: DailySummary[] }) {
  if (!daily.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无变动数据" />;

  const option = {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#333', fontSize: 12 },
    },
    legend: { data: ['入库', '出库', '净变动'], bottom: 0, textStyle: { fontSize: 11, color: '#8a919f' } },
    grid: { top: 20, right: 20, bottom: 40, left: 50 },
    xAxis: {
      type: 'category',
      data: daily.map(d => dayjs(d.date).format('MM-DD')),
      axisLine: { lineStyle: { color: '#e8e8e8' } },
      axisTick: { show: false },
      axisLabel: { color: '#8a919f', fontSize: 10, rotate: daily.length > 15 ? 30 : 0 },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: '#f0f0f0', type: 'dashed' } },
      axisLabel: { color: '#8a919f', fontSize: 10 },
    },
    series: [
      {
        name: '入库', type: 'bar', stack: 'flow', barWidth: '50%',
        data: daily.map(d => d.total_in),
        itemStyle: { color: '#52c41a', borderRadius: [4, 4, 0, 0] },
      },
      {
        name: '出库', type: 'bar', stack: 'flow', barWidth: '50%',
        data: daily.map(d => -d.total_out),
        itemStyle: { color: '#ff4d4f', borderRadius: [0, 0, 4, 4] },
      },
      {
        name: '净变动', type: 'line', smooth: true, symbol: 'circle', symbolSize: 5,
        data: daily.map(d => d.net_change),
        lineStyle: { width: 2, color: '#1677ff' },
        itemStyle: { color: '#1677ff' },
      },
    ],
    animationDuration: 800,
  };

  return <ReactECharts option={option} style={{ height: 260 }} notMerge />;
}

export default function InventoryCartonPage() {
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const [data, setData] = useState<CartonBox[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [viewMode, setViewMode] = useState<string>('stock');

  const [logLoading, setLogLoading] = useState(false);
  const [logData, setLogData] = useState<LogData | null>(null);
  const [logDateRange, setLogDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().subtract(30, 'day'), dayjs()]);
  const [logBoxId, setLogBoxId] = useState<number | undefined>(undefined);
  const [logPage, setLogPage] = useState(1);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.get('/inventory/carton-boxes');
      setData(Array.isArray(res.data?.data ?? res.data) ? (res.data?.data ?? res.data) : []);
    } catch { message.error('加载纸箱库存失败'); setData([]); }
    finally { setLoading(false); }
  };

  const fetchLogs = useCallback(async (page = 1) => {
    setLogLoading(true);
    try {
      const res = await api.get('/inventory/carton-inventory-logs', {
        params: {
          start_date: logDateRange[0].format('YYYY-MM-DD'),
          end_date: logDateRange[1].format('YYYY-MM-DD'),
          ...(logBoxId ? { carton_box_id: logBoxId } : {}),
          page,
          page_size: 20,
        },
      });
      setLogData(res.data?.data ?? null);
      setLogPage(page);
    } catch { message.error('加载变动日志失败'); }
    finally { setLogLoading(false); }
  }, [logDateRange, logBoxId]);

  const handleRefresh = () => {
    setRefreshSpin(true);
    const p = viewMode === 'stock' ? fetchData() : fetchLogs();
    p.finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  useEffect(() => { fetchData(); }, []);

  useEffect(() => {
    if (viewMode === 'logs') fetchLogs(1);
  }, [viewMode, fetchLogs]);

  const handleAdd = () => { form.resetFields(); setEditingId(null); setModalOpen(true); };
  const handleEdit = (r: CartonBox) => {
    form.setFieldsValue({ box_type: r.box_type, purchase_price: Number(r.purchase_price), low_stock_threshold: r.low_stock_threshold ?? 50 });
    setEditingId(r.id); setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (editingId) {
        await api.put(`/inventory/carton-boxes/${editingId}`, { box_type: values.box_type, purchase_price: Number(values.purchase_price) });
        if (values.low_stock_threshold !== undefined) {
          await api.put(`/inventory/carton-boxes/${editingId}/threshold?threshold=${values.low_stock_threshold}`).catch(() => {});
        }
        message.success('更新成功');
      } else {
        await api.post('/inventory/carton-boxes', { box_type: values.box_type, purchase_price: Number(values.purchase_price), stock_quantity: Number(values.stock_quantity) ?? 0 });
        message.success('添加成功');
      }
      setModalOpen(false); form.resetFields(); fetchData();
    } catch (e: any) { message.error(e?.response?.data?.detail ?? e?.response?.data?.message ?? '操作失败'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (id: number) => {
    try { await api.delete(`/inventory/carton-boxes/${id}`); message.success('删除成功'); fetchData(); }
    catch (e: any) { message.error(e?.response?.data?.detail ?? e?.response?.data?.message ?? '删除失败'); }
  };

  const totalStock = data.reduce((a, d) => a + (Number(d.stock_quantity) || 0), 0);
  const totalValue = data.reduce((a, d) => a + (Number(d.stock_quantity) || 0) * (Number(d.purchase_price) || 0), 0);
  const lowStockCount = data.filter(d => (Number(d.stock_quantity) || 0) <= (d.low_stock_threshold ?? 50)).length;
  const maxStock = Math.max(...data.map(d => Number(d.stock_quantity) || 0), 1);

  const STATS = [
    { label: '纸箱规格', value: data.length, unit: '种', icon: <DropboxOutlined />, gradient: 'linear-gradient(135deg, #13c2c2 0%, #5cdbd3 100%)', glow: 'rgba(19,194,194,0.15)' },
    { label: '库存总量', value: totalStock.toLocaleString(), unit: '个', icon: <InboxOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.15)' },
    { label: '库存总值', value: `¥${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, unit: '', icon: <DollarOutlined />, gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.15)' },
    { label: '库存预警', value: lowStockCount, unit: '种', icon: <WarningOutlined />, gradient: lowStockCount > 0 ? 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)' : 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: lowStockCount > 0 ? 'rgba(255,77,79,0.15)' : 'rgba(0,185,107,0.15)' },
  ];

  const stockColumns: any[] = [
    {
      title: '纸箱类型', dataIndex: 'box_type', width: 180,
      render: (v: string) => (
        <Space size={8}>
          <span style={{
            width: 30, height: 30, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg, rgba(19,194,194,0.12), rgba(19,194,194,0.04))',
            color: '#13c2c2', fontSize: 14,
          }}><DropboxOutlined /></span>
          <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{v}</span>
        </Space>
      ),
    },
    {
      title: '采购单价', dataIndex: 'purchase_price', width: 110, align: 'right' as const,
      sorter: (a: CartonBox, b: CartonBox) => Number(a.purchase_price) - Number(b.purchase_price),
      render: (v: any) => <span className="num" style={{ fontWeight: 600, color: '#fa8c16' }}>¥{Number(v).toFixed(2)}</span>,
    },
    {
      title: '库存数量', dataIndex: 'stock_quantity', width: 200,
      sorter: (a: CartonBox, b: CartonBox) => Number(a.stock_quantity) - Number(b.stock_quantity),
      render: (v: any, r: CartonBox) => {
        const qty = Number(v) || 0;
        const threshold = r.low_stock_threshold ?? 50;
        const pct = maxStock > 0 ? Math.round((qty / maxStock) * 100) : 0;
        const isDanger = qty === 0;
        const isLow = qty > 0 && qty <= threshold;
        const bg = isDanger ? 'linear-gradient(90deg, #ff4d4f, #ff7875)' : isLow ? 'linear-gradient(90deg, #fa8c16, #ffc53d)' : 'linear-gradient(90deg, #00b96b, #5cdbd3)';
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 6, background: 'rgba(0,0,0,0.04)', borderRadius: 3, overflow: 'hidden', minWidth: 60 }}>
              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, transition: 'width 0.5s', background: bg }} />
            </div>
            <Tag color={isDanger ? 'error' : isLow ? 'warning' : 'success'}
              style={{ borderRadius: 6, fontWeight: 600, fontSize: 12, minWidth: 55, textAlign: 'center' }}
              icon={isDanger ? <WarningOutlined /> : isLow ? <WarningOutlined /> : <CheckCircleOutlined />}>
              {qty.toLocaleString()}
            </Tag>
          </div>
        );
      },
    },
    {
      title: '库存价值', key: 'value', width: 110, align: 'right' as const,
      sorter: (a: CartonBox, b: CartonBox) => (Number(a.stock_quantity) * Number(a.purchase_price)) - (Number(b.stock_quantity) * Number(b.purchase_price)),
      render: (_: any, r: CartonBox) => {
        const val = (Number(r.stock_quantity) || 0) * (Number(r.purchase_price) || 0);
        return <span className="num" style={{ fontWeight: 600, color: '#722ed1' }}>¥{val.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>;
      },
    },
    {
      title: '预警阈值', dataIndex: 'low_stock_threshold', width: 90, align: 'center' as const,
      render: (v: number) => <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{v ?? 50}</span>,
    },
    {
      title: '操作', key: 'actions', width: 120, align: 'center' as const, fixed: 'right' as const,
      render: (_: any, r: CartonBox) => (
        <Space size={2}>
          <Tooltip title="查看变动日志"><Button type="text" size="small" icon={<HistoryOutlined />}
            onClick={() => { setLogBoxId(r.id); setViewMode('logs'); }} style={{ color: '#13c2c2', borderRadius: 6 }} /></Tooltip>
          <Tooltip title="编辑"><Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)} style={{ color: 'var(--brand)', borderRadius: 6 }} /></Tooltip>
          <Popconfirm title="确定删除该纸箱类型？" description="已被 SKU 引用的纸箱无法删除" onConfirm={() => handleDelete(r.id)} okButtonProps={{ danger: true }}>
            <Tooltip title="删除"><Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ borderRadius: 6 }} /></Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const logColumns = [
    {
      title: '时间', dataIndex: 'changed_at', width: 150,
      render: (v: string) => <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{v ? dayjs(v).format('MM-DD HH:mm:ss') : '-'}</span>,
    },
    {
      title: '纸箱类型', dataIndex: 'box_type', width: 140,
      render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span>,
    },
    {
      title: '变动前', dataIndex: 'original_stock', width: 90, align: 'right' as const,
      render: (v: number) => <span className="num" style={{ color: 'var(--text-3)' }}>{v}</span>,
    },
    {
      title: '变动量', dataIndex: 'change_quantity', width: 110, align: 'center' as const,
      render: (v: number) => {
        const isIn = v > 0;
        return (
          <Tag color={isIn ? 'success' : v < 0 ? 'error' : 'default'}
            icon={isIn ? <ArrowUpOutlined /> : v < 0 ? <ArrowDownOutlined /> : <MinusOutlined />}
            style={{ borderRadius: 20, fontWeight: 700, fontSize: 12 }}>
            {isIn ? '+' : ''}{v}
          </Tag>
        );
      },
    },
    {
      title: '变动后', dataIndex: 'after_stock', width: 90, align: 'right' as const,
      render: (v: number) => <span className="num" style={{ fontWeight: 700, color: '#1677ff' }}>{v}</span>,
    },
    {
      title: '出库成本', dataIndex: 'item_cost', width: 100, align: 'right' as const,
      render: (v: number) => v > 0 ? <span className="num" style={{ fontWeight: 600, color: '#fa8c16' }}>¥{Number(v).toFixed(2)}</span> : <span style={{ color: 'var(--text-4)' }}>-</span>,
    },
    {
      title: '原因', dataIndex: 'reason', ellipsis: true,
      render: (v: string) => {
        let color = 'default';
        let icon = <FileTextOutlined />;
        if (v?.includes('盘点')) { color = 'purple'; icon = <SwapOutlined />; }
        else if (v?.includes('采购') || v?.includes('入库')) { color = 'green'; icon = <ArrowUpOutlined />; }
        else if (v?.includes('出库') || v?.includes('消耗')) { color = 'red'; icon = <ArrowDownOutlined />; }
        return <Tag color={color} icon={icon} style={{ borderRadius: 8, fontSize: 11 }}>{v || '-'}</Tag>;
      },
    },
  ];

  const handleExportStock = () => {
    if (!data.length) return;
    exportToCsv(data, [
      { key: 'id', title: 'ID' }, { key: 'box_type', title: '纸箱类型' },
      { key: 'purchase_price', title: '采购单价' }, { key: 'stock_quantity', title: '库存数量' },
      { key: 'low_stock_threshold', title: '预警阈值' },
    ], '纸箱库存');
  };

  const handleExportLogs = () => {
    if (!logData?.items.length) return;
    exportToCsv(logData.items, [
      { key: 'changed_at', title: '时间', render: v => v ? dayjs(v as string).format('YYYY-MM-DD HH:mm:ss') : '-' },
      { key: 'box_type', title: '纸箱类型' },
      { key: 'original_stock', title: '变动前' },
      { key: 'change_quantity', title: '变动量' },
      { key: 'after_stock', title: '变动后' },
      { key: 'reason', title: '原因' },
    ], `纸箱变动日志_${logDateRange[0].format('YYYYMMDD')}_${logDateRange[1].format('YYYYMMDD')}`);
  };

  const logTotalIn = logData?.grand_totals?.total_in ?? logData?.daily_summary?.reduce((a, d) => a + d.total_in, 0) ?? 0;
  const logTotalOut = logData?.grand_totals?.total_out ?? logData?.daily_summary?.reduce((a, d) => a + d.total_out, 0) ?? 0;
  const logTotalCost = logData?.grand_totals?.total_cost ?? logData?.daily_summary?.reduce((a, d) => a + (d.total_cost || 0), 0) ?? 0;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Page header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20,
        padding: '20px 24px', borderRadius: 'var(--radius-l)',
        background: 'linear-gradient(135deg, rgba(19,194,194,0.06) 0%, rgba(22,119,255,0.03) 100%)',
        border: '1px solid rgba(19,194,194,0.08)',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 34, height: 34, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #13c2c2 0%, #1677ff 100%)', color: '#fff', fontSize: 16,
              boxShadow: '0 4px 12px rgba(19,194,194,0.25)',
            }}><InboxOutlined /></span>
            纸箱库存管理
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 44 }}>
            库存监控 · 变动追踪 · 进出分析
          </div>
        </div>
        <Space size={8} wrap>
          <Tooltip title="库存预警中心">
            <Button icon={<AlertOutlined />} onClick={() => router.push('/inventory/alerts')}
              style={{ borderRadius: 10, height: 38, width: 38, color: lowStockCount > 0 ? '#ff4d4f' : '#fa8c16' }} />
          </Tooltip>
          <Button icon={<DownloadOutlined />} onClick={viewMode === 'stock' ? handleExportStock : handleExportLogs}
            disabled={viewMode === 'stock' ? !data.length : !logData?.items.length}
            style={{ borderRadius: 10, height: 38, width: 38 }} />
          <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 10, height: 38, width: 38 }} />
          {viewMode === 'stock' && (
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}
              style={{ height: 38, borderRadius: 10, fontWeight: 600, paddingInline: 20 }}>添加纸箱</Button>
          )}
        </Space>
      </div>

      {/* Stats row */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {STATS.map((s, i) => (
          <Col xs={12} sm={6} key={i}>
            <div className="stagger-item" style={{
              padding: '14px 16px', borderRadius: 'var(--radius-m)', background: s.gradient,
              position: 'relative', overflow: 'hidden', boxShadow: `0 4px 14px ${s.glow}`,
              transition: 'all 0.3s', animationDelay: `${i * 60}ms`,
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
            >
              <div style={{ position: 'absolute', top: -12, right: -12, width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>{s.icon} {s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', lineHeight: 1.2 }} className="num">
                {s.value}{s.unit && <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3, opacity: 0.7 }}>{s.unit}</span>}
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* View mode selector */}
      <div style={{ marginBottom: 16 }}>
        <Segmented
          value={viewMode}
          onChange={v => setViewMode(v as string)}
          options={[
            { label: <span><DropboxOutlined /> 库存管理</span>, value: 'stock' },
            { label: <span><HistoryOutlined /> 变动日志 {logData?.total ? <Badge count={logData.total} size="small" style={{ marginLeft: 4 }} /> : null}</span>, value: 'logs' },
          ]}
          style={{ fontWeight: 600 }}
        />
      </div>

      {/* Stock management view */}
      {viewMode === 'stock' && (
        <>
          {/* Stock cards for visual overview */}
          {data.length > 0 && data.length <= 12 && (
            <Row gutter={[10, 10]} style={{ marginBottom: 16 }}>
              {data.map((box, i) => {
                const qty = Number(box.stock_quantity) || 0;
                const threshold = box.low_stock_threshold ?? 50;
                const isDanger = qty === 0;
                const isLow = qty > 0 && qty <= threshold;
                const statusColor = isDanger ? '#ff4d4f' : isLow ? '#fa8c16' : '#52c41a';
                const val = qty * (Number(box.purchase_price) || 0);
                return (
                  <Col xs={12} sm={8} md={6} key={box.id}>
                    <div className="stagger-item" style={{
                      padding: '14px 16px', borderRadius: 'var(--radius-m)',
                      background: 'var(--glass-bg)', border: `1px solid ${statusColor}20`,
                      backdropFilter: 'blur(10px)', cursor: 'pointer', transition: 'all 0.3s',
                      animationDelay: `${i * 40}ms`,
                    }}
                      onClick={() => handleEdit(box)}
                      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 6px 20px ${statusColor}15`; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{box.box_type}</span>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, boxShadow: `0 0 6px ${statusColor}60` }} />
                      </div>
                      <div className="num" style={{ fontSize: 24, fontWeight: 800, color: statusColor, marginBottom: 4 }}>{qty.toLocaleString()}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-4)' }}>
                        <span>¥{Number(box.purchase_price).toFixed(2)}/个</span>
                        <span>值 ¥{val.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                      </div>
                    </div>
                  </Col>
                );
              })}
            </Row>
          )}

          <div className="panel">
            <div className="panel-head">
              <span className="panel-title"><DropboxOutlined style={{ color: '#13c2c2' }} /> 纸箱列表</span>
              <span style={{ fontSize: 12, color: 'var(--text-4)' }}>共 {data.length} 种</span>
            </div>
            <Table rowKey="id" columns={stockColumns} dataSource={data} loading={loading} size="middle"
              scroll={{ x: 900 }}
              pagination={{ pageSize: 15, showSizeChanger: true, showTotal: t => `共 ${t} 条` }}
              locale={{ emptyText: '暂无纸箱数据' }}
              summary={() => data.length > 1 ? (
                <Table.Summary fixed>
                  <Table.Summary.Row style={{ background: 'var(--gray-2)', fontWeight: 700 }}>
                    <Table.Summary.Cell index={0}>合计</Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right"><span className="num" style={{ color: '#fa8c16' }}>-</span></Table.Summary.Cell>
                    <Table.Summary.Cell index={2}><span className="num" style={{ fontWeight: 700, color: '#1677ff' }}>{totalStock.toLocaleString()} 个</span></Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right"><span className="num" style={{ fontWeight: 700, color: '#722ed1' }}>¥{totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></Table.Summary.Cell>
                    <Table.Summary.Cell index={4} />
                    <Table.Summary.Cell index={5} />
                  </Table.Summary.Row>
                </Table.Summary>
              ) : null}
            />
          </div>
        </>
      )}

      {/* Inventory change logs view */}
      {viewMode === 'logs' && (
        <>
          {/* Filters */}
          <div className="panel" style={{ marginBottom: 16 }}>
            <div style={{ padding: '14px 20px' }}>
              <Row gutter={[12, 12]} align="bottom">
                <Col xs={24} sm={8}>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>
                    <CalendarOutlined style={{ marginRight: 4 }} />日期范围
                  </div>
                  <RangePicker value={logDateRange} onChange={v => v && setLogDateRange(v as [dayjs.Dayjs, dayjs.Dayjs])}
                    style={{ width: '100%', borderRadius: 8 }} />
                </Col>
                <Col xs={24} sm={8}>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>
                    <DropboxOutlined style={{ marginRight: 4 }} />纸箱类型
                  </div>
                  <Select value={logBoxId} onChange={setLogBoxId} allowClear placeholder="全部纸箱"
                    style={{ width: '100%' }}
                    options={logData?.box_options?.map(b => ({ value: b.id, label: b.name })) ?? []} />
                </Col>
                <Col xs={24} sm={8}>
                  <Button type="primary" icon={<SearchOutlined />} onClick={() => fetchLogs(1)} loading={logLoading}
                    style={{ width: '100%', borderRadius: 10, height: 38, fontWeight: 600 }}>
                    查询日志
                  </Button>
                </Col>
              </Row>
            </div>
          </div>

          {/* Log summary stats */}
          {logData && logData.daily_summary.length > 0 && (
            <Row gutter={[10, 10]} style={{ marginBottom: 16 }}>
              {[
                { label: '总入库', value: logTotalIn, icon: <ArrowUpOutlined />, color: '#52c41a', fmt: (v: number) => v.toLocaleString() },
                { label: '总出库', value: logTotalOut, icon: <ArrowDownOutlined />, color: '#ff4d4f', fmt: (v: number) => v.toLocaleString() },
                { label: '净变动', value: logTotalIn - logTotalOut, icon: <SwapOutlined />, color: '#1677ff', fmt: (v: number) => v.toLocaleString() },
                { label: '出库成本', value: logTotalCost, icon: <DollarOutlined />, color: '#fa8c16', fmt: (v: number) => `¥${v.toLocaleString()}` },
                { label: '操作次数', value: logData.total, icon: <HistoryOutlined />, color: '#722ed1', fmt: (v: number) => v.toLocaleString() },
              ].map((s, i) => (
                <Col xs={12} sm={i < 4 ? 6 : 24} key={i}>
                  <div style={{
                    padding: '12px 16px', borderRadius: 'var(--radius-m)',
                    background: `${s.color}08`, border: `1px solid ${s.color}15`,
                    textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                      {s.icon} {s.label}
                    </div>
                    <div className="num" style={{ fontSize: 20, fontWeight: 800, color: s.color }}>{s.fmt(s.value)}</div>
                  </div>
                </Col>
              ))}
            </Row>
          )}

          {/* Flow chart */}
          {logData && logData.daily_summary.length > 1 && (
            <div className="panel" style={{ marginBottom: 16 }}>
              <div className="panel-head">
                <span className="panel-title"><BarChartOutlined style={{ color: '#1677ff' }} /> 日进出库趋势</span>
                <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{logData.daily_summary.length} 天数据</span>
              </div>
              <div className="panel-body">
                <StockFlowChart daily={logData.daily_summary} />
              </div>
            </div>
          )}

          {/* Daily cost summary table */}
          {logData && logData.daily_summary.length > 0 && (
            <div className="panel" style={{ marginBottom: 16 }}>
              <div className="panel-head">
                <span className="panel-title"><DollarOutlined style={{ color: '#fa8c16' }} /> 日成本汇总</span>
              </div>
              <Table
                dataSource={logData.daily_summary.map((d, i) => ({ ...d, _k: i }))}
                rowKey="_k"
                size="small"
                pagination={false}
                scroll={{ x: 'max-content' }}
                columns={[
                  { title: '日期', dataIndex: 'date', width: 110, render: (v: string) => <span style={{ fontWeight: 600 }}>{dayjs(v).format('MM-DD (ddd)')}</span> },
                  { title: '入库', dataIndex: 'total_in', width: 80, align: 'right' as const, render: (v: number) => v > 0 ? <Tag color="success" style={{ borderRadius: 6, fontWeight: 600 }}>+{v}</Tag> : <span style={{ color: 'var(--text-4)' }}>0</span> },
                  { title: '出库', dataIndex: 'total_out', width: 80, align: 'right' as const, render: (v: number) => v > 0 ? <Tag color="error" style={{ borderRadius: 6, fontWeight: 600 }}>-{v}</Tag> : <span style={{ color: 'var(--text-4)' }}>0</span> },
                  { title: '净变动', dataIndex: 'net_change', width: 80, align: 'right' as const, render: (v: number) => <span className="num" style={{ fontWeight: 700, color: v > 0 ? '#52c41a' : v < 0 ? '#ff4d4f' : 'var(--text-3)' }}>{v > 0 ? '+' : ''}{v}</span> },
                  { title: '出库成本', dataIndex: 'total_cost', width: 110, align: 'right' as const, render: (v: number) => v > 0 ? <span className="num" style={{ fontWeight: 700, color: '#fa8c16' }}>¥{Number(v).toFixed(2)}</span> : <span style={{ color: 'var(--text-4)' }}>-</span> },
                  { title: '操作数', dataIndex: 'log_count', width: 70, align: 'right' as const },
                ]}
                summary={() => {
                  const gt = logData.grand_totals;
                  if (!gt) return null;
                  return (
                    <Table.Summary fixed>
                      <Table.Summary.Row style={{ background: 'rgba(22,119,255,0.04)' }}>
                        <Table.Summary.Cell index={0}><span style={{ fontWeight: 700 }}>合计</span></Table.Summary.Cell>
                        <Table.Summary.Cell index={1} align="right"><span className="num" style={{ fontWeight: 700, color: '#52c41a' }}>+{gt.total_in}</span></Table.Summary.Cell>
                        <Table.Summary.Cell index={2} align="right"><span className="num" style={{ fontWeight: 700, color: '#ff4d4f' }}>-{gt.total_out}</span></Table.Summary.Cell>
                        <Table.Summary.Cell index={3} align="right"><span className="num" style={{ fontWeight: 700, color: '#1677ff' }}>{gt.net_change}</span></Table.Summary.Cell>
                        <Table.Summary.Cell index={4} align="right"><span className="num" style={{ fontWeight: 800, color: '#fa8c16', fontSize: 14 }}>¥{gt.total_cost.toFixed(2)}</span></Table.Summary.Cell>
                        <Table.Summary.Cell index={5} align="right"><span className="num">{logData.total}</span></Table.Summary.Cell>
                      </Table.Summary.Row>
                    </Table.Summary>
                  );
                }}
              />
            </div>
          )}

          {/* Log table */}
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title"><HistoryOutlined style={{ color: '#13c2c2' }} /> 变动记录</span>
              <span style={{ fontSize: 12, color: 'var(--text-4)' }}>共 {logData?.total ?? 0} 条</span>
            </div>
            {logLoading ? (
              <div style={{ textAlign: 'center', padding: 60 }}><Spin /></div>
            ) : !logData?.items.length ? (
              <div style={{ padding: 50, textAlign: 'center' }}>
                <Empty description="所选范围内暂无变动记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              </div>
            ) : (
              <Table
                dataSource={logData.items}
                columns={logColumns}
                rowKey="id"
                size="middle"
                pagination={{
                  current: logPage,
                  total: logData.total,
                  pageSize: logData.page_size,
                  onChange: p => fetchLogs(p),
                  showTotal: t => `共 ${t} 条`,
                  showSizeChanger: false,
                }}
                locale={{ emptyText: '暂无变动记录' }}
              />
            )}
          </div>
        </>
      )}

      {/* Add/Edit modal */}
      <Modal title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: editingId ? 'linear-gradient(135deg, #fa8c16, #ffc53d)' : 'linear-gradient(135deg, #13c2c2, #1677ff)', color: '#fff', fontSize: 13 }}>
            {editingId ? <EditOutlined /> : <PlusOutlined />}
          </span>
          {editingId ? '编辑纸箱类型' : '添加纸箱类型'}
        </div>
      } open={modalOpen} onOk={handleSubmit} onCancel={() => setModalOpen(false)}
        confirmLoading={submitting} destroyOnClose okText="保存" cancelText="取消"
        styles={{ body: { paddingTop: 20 } }}>
        <Form form={form} layout="vertical">
          <Form.Item name="box_type" label="纸箱类型" rules={[{ required: true, message: '请输入纸箱类型' }]}>
            <Input placeholder="如：5kg 箱、10kg 箱" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={editingId ? 12 : 8}>
              <Form.Item name="purchase_price" label="采购单价" rules={[{ required: true, message: '请输入单价' }]}>
                <InputNumber min={0} step={0.01} style={{ width: '100%' }} prefix="¥" />
              </Form.Item>
            </Col>
            {!editingId && (
              <Col span={8}>
                <Form.Item name="stock_quantity" label="库存数量">
                  <InputNumber min={0} style={{ width: '100%' }} defaultValue={0} />
                </Form.Item>
              </Col>
            )}
            <Col span={editingId ? 12 : 8}>
              <Form.Item name="low_stock_threshold" label="预警阈值" initialValue={50}
                tooltip="库存低于此值时触发预警">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
