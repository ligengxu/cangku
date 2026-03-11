'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Table, Button, Space, Modal, Form, Input, InputNumber, Select, Row, Col, message,
  Popconfirm, Tooltip, Tag, Badge, Segmented, Progress, Empty,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, AppstoreOutlined,
  TagOutlined, InboxOutlined, DownloadOutlined, PrinterOutlined, ExportOutlined,
  FireOutlined, DatabaseOutlined, ShoppingCartOutlined, DashboardOutlined,
  WarningOutlined, CheckCircleOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import type { Sku, Fruit, CartonBox } from '@/types';
import { exportToCsv } from '@/utils/exportCsv';

interface SkuStat {
  total_labels: number;
  outbound_count: number;
  outbound_weight: number;
  outbound_rate: number;
  week_labels: number;
}

interface InventoryItem {
  sku_id: number;
  sku_name: string;
  sku_description: string;
  fruit_name: string;
  estimated_weight: number;
  inbound: number;
  outbound: number;
  stock: number;
  outbound_7d: number;
  outbound_30d: number;
  daily_rate: number;
  days_remaining: number;
}

interface InventoryGroup {
  fruit_name: string;
  total_stock: number;
  sku_count: number;
  items: InventoryItem[];
}

interface InventorySummary {
  total_sku_count: number;
  total_stock: number;
  total_inbound: number;
  total_outbound: number;
  stock_rate: number;
}

function getStockHealth(item: InventoryItem): { label: string; color: string; bg: string } {
  if (item.stock <= 0) return { label: '缺货', color: '#ff4d4f', bg: 'rgba(255,77,79,0.08)' };
  if (item.days_remaining <= 3) return { label: '紧急', color: '#fa8c16', bg: 'rgba(250,140,22,0.08)' };
  if (item.days_remaining <= 7) return { label: '偏低', color: '#faad14', bg: 'rgba(250,173,20,0.08)' };
  return { label: '正常', color: '#52c41a', bg: 'rgba(82,196,26,0.08)' };
}

const COLORS = ['#1677ff', '#00b96b', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2', '#ff4d4f', '#2f54eb'];

export default function InventorySkuPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Sku[]>([]);
  const [stats, setStats] = useState<Record<number, SkuStat>>({});
  const [fruits, setFruits] = useState<Fruit[]>([]);
  const [cartonBoxes, setCartonBoxes] = useState<CartonBox[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [fruitFilter, setFruitFilter] = useState<string | undefined>();
  const [viewMode, setViewMode] = useState<string>('manage');

  const [invLoading, setInvLoading] = useState(false);
  const [invItems, setInvItems] = useState<InventoryItem[]>([]);
  const [invGroups, setInvGroups] = useState<InventoryGroup[]>([]);
  const [invSummary, setInvSummary] = useState<InventorySummary | null>(null);
  const [invView, setInvView] = useState<string>('card');

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [skuRes, fruitRes, boxRes, statsRes] = await Promise.all([
        api.get('/inventory/sku'),
        api.get('/inventory/fruits').catch(() => ({ data: { data: [] } })),
        api.get('/inventory/carton-boxes').catch(() => ({ data: { data: [] } })),
        api.get('/inventory/sku/stats').catch(() => ({ data: { data: {} } })),
      ]);
      setData(Array.isArray(skuRes.data?.data ?? skuRes.data) ? (skuRes.data?.data ?? skuRes.data) : []);
      setFruits(Array.isArray(fruitRes.data?.data ?? fruitRes.data) ? (fruitRes.data?.data ?? fruitRes.data) : []);
      setCartonBoxes(Array.isArray(boxRes.data?.data ?? boxRes.data) ? (boxRes.data?.data ?? boxRes.data) : []);
      setStats(statsRes.data?.data ?? {});
    } catch { message.error('加载 SKU 失败'); setData([]); }
    finally { setLoading(false); }
  }, []);

  const fetchInventory = useCallback(async () => {
    setInvLoading(true);
    try {
      const params: Record<string, string> = {};
      if (fruitFilter) params.fruit_name = fruitFilter;
      const res = await api.get('/inventory/sku/inventory', { params });
      const d = res.data?.data ?? {};
      setInvItems(d.items ?? []);
      setInvGroups(d.groups ?? []);
      setInvSummary(d.summary ?? null);
    } catch {
      message.error('加载库存数据失败');
    } finally { setInvLoading(false); }
  }, [fruitFilter]);

  const handleRefresh = () => {
    setRefreshSpin(true);
    const p = viewMode === 'manage' ? fetchAll() : fetchInventory();
    p.finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => { if (viewMode === 'inventory') fetchInventory(); }, [viewMode, fetchInventory]);

  const handleAdd = () => { form.resetFields(); setEditingId(null); setModalOpen(true); };
  const handleEdit = (r: Sku) => {
    form.setFieldsValue({ fruit_id: r.fruit_id, sku_name: r.sku_name, sku_description: r.sku_description ?? '', fruit_weight: r.fruit_weight, material_weight: r.material_weight, production_performance: r.production_performance, carton_box_id: r.carton_box_id ?? undefined });
    setEditingId(r.id); setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      const payload = { fruit_id: values.fruit_id, sku_name: values.sku_name, sku_description: values.sku_description, fruit_weight: Number(values.fruit_weight), material_weight: Number(values.material_weight), production_performance: Number(values.production_performance), carton_box_id: values.carton_box_id || undefined };
      if (editingId) { await api.put(`/inventory/sku/${editingId}`, payload); message.success('更新成功'); }
      else { await api.post('/inventory/sku', payload); message.success('添加成功'); }
      setModalOpen(false); fetchAll();
    } catch (e: any) { message.error(e?.response?.data?.message ?? '操作失败'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (id: number) => {
    try { await api.delete(`/inventory/sku/${id}`); message.success('删除成功'); fetchAll(); }
    catch (e: any) { message.error(e?.response?.data?.message ?? '删除失败'); }
  };

  const filteredData = fruitFilter ? data.filter(d => d.fruit_name === fruitFilter) : data;
  const fruitNames = Array.from(new Set(data.map(d => d.fruit_name)));
  const totalLabels = Object.values(stats).reduce((a, s) => a + s.total_labels, 0);
  const totalOutbound = Object.values(stats).reduce((a, s) => a + s.outbound_count, 0);
  const weekLabels = Object.values(stats).reduce((a, s) => a + s.week_labels, 0);

  const handleExport = () => {
    if (viewMode === 'manage') {
      if (!filteredData.length) { message.warning('暂无数据'); return; }
      const rows = filteredData.map(s => ({ ...s, total_labels: stats[s.id]?.total_labels ?? 0, outbound_count: stats[s.id]?.outbound_count ?? 0, outbound_rate: stats[s.id]?.outbound_rate ?? 0 }));
      exportToCsv(rows, [
        { key: 'id', title: 'ID' }, { key: 'fruit_name', title: '水果' }, { key: 'sku_name', title: 'SKU名称' },
        { key: 'fruit_weight', title: '果重(kg)' }, { key: 'material_weight', title: '料重(kg)' },
        { key: 'total_weight', title: '总重(kg)' }, { key: 'production_performance', title: '产出率' },
        { key: 'total_labels', title: '总标签数' }, { key: 'outbound_count', title: '出库数' },
        { key: 'outbound_rate', title: '出库率%' },
      ], 'SKU列表');
    } else {
      if (!invItems.length) { message.warning('暂无数据'); return; }
      exportToCsv(invItems as any, [
        { key: 'sku_name', title: 'SKU名称', render: (v: unknown) => String(v ?? '-') },
        { key: 'fruit_name', title: '水果', render: (v: unknown) => String(v ?? '-') },
        { key: 'inbound', title: '入库总数', render: (v: unknown) => String(Number(v) || 0) },
        { key: 'outbound', title: '出库总数', render: (v: unknown) => String(Number(v) || 0) },
        { key: 'stock', title: '当前库存', render: (v: unknown) => String(Number(v) || 0) },
        { key: 'daily_rate', title: '日均消耗', render: (v: unknown) => String(Number(v) || 0) },
        { key: 'days_remaining', title: '预计可用天数', render: (v: unknown) => Number(v) >= 999 ? '充足' : String(v) },
      ] as any, 'SKU实时库存');
    }
  };

  const lowStockCount = useMemo(() => invItems.filter(i => i.days_remaining <= 3 && i.stock > 0).length, [invItems]);
  const outOfStockCount = useMemo(() => invItems.filter(i => i.stock <= 0).length, [invItems]);

  const manageColumns: any[] = [
    { title: 'ID', dataIndex: 'id', width: 55, render: (v: number) => <span className="num" style={{ color: 'var(--text-4)', fontSize: 12 }}>#{v}</span> },
    {
      title: '水果', dataIndex: 'fruit_name', width: 90,
      render: (v: string) => <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 6, fontSize: 12, fontWeight: 500, background: 'linear-gradient(135deg, rgba(0,185,107,0.08), rgba(0,185,107,0.03))', color: '#00b96b', border: '1px solid rgba(0,185,107,0.12)' }}>{v || '-'}</span>,
    },
    {
      title: 'SKU', dataIndex: 'sku_name', width: 160,
      render: (v: string, r: Sku) => (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text-1)' }}>{v}</div>
          {r.sku_description && <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 1 }}>{r.sku_description}</div>}
        </div>
      ),
    },
    {
      title: '重量', key: 'weights', width: 130,
      render: (_: any, r: Sku) => (
        <Space size={4}>
          <Tag style={{ borderRadius: 6, fontSize: 11, margin: 0 }}>{Number(r.fruit_weight).toFixed(1)}+{Number(r.material_weight).toFixed(1)}</Tag>
          <span className="num" style={{ fontWeight: 700, color: '#1677ff', fontSize: 13 }}>{Number(r.total_weight).toFixed(2)}kg</span>
        </Space>
      ),
    },
    {
      title: '产出率', dataIndex: 'production_performance', width: 80, align: 'center' as const,
      render: (v: any) => {
        const pf = Number(v) || 0;
        return <span className="num" style={{ fontWeight: 600, color: pf >= 0.85 ? '#00b96b' : pf >= 0.7 ? '#fa8c16' : '#ff4d4f' }}>{(pf * 100).toFixed(0)}%</span>;
      },
    },
    {
      title: '标签/出库', key: 'production', width: 140, align: 'center' as const,
      sorter: (a: Sku, b: Sku) => (stats[a.id]?.total_labels ?? 0) - (stats[b.id]?.total_labels ?? 0),
      render: (_: any, r: Sku) => {
        const s = stats[r.id];
        if (!s || s.total_labels === 0) return <span style={{ color: 'var(--text-4)', fontSize: 12 }}>暂无</span>;
        return (
          <Space size={6}>
            <Tooltip title={`共 ${s.total_labels} 个标签`}>
              <Badge count={s.total_labels} showZero overflowCount={99999} style={{ background: '#1677ff', fontSize: 10 }} />
            </Tooltip>
            <span style={{ color: 'var(--text-4)' }}>/</span>
            <Tooltip title={`已出库 ${s.outbound_count} 个`}>
              <Badge count={s.outbound_count} showZero overflowCount={99999} style={{ background: '#52c41a', fontSize: 10 }} />
            </Tooltip>
            <Tag color={s.outbound_rate >= 80 ? 'green' : s.outbound_rate >= 50 ? 'orange' : 'red'}
              style={{ borderRadius: 6, fontSize: 10, margin: 0, padding: '0 4px' }}>
              {s.outbound_rate}%
            </Tag>
          </Space>
        );
      },
    },
    {
      title: '近7天', key: 'week', width: 80, align: 'center' as const,
      sorter: (a: Sku, b: Sku) => (stats[a.id]?.week_labels ?? 0) - (stats[b.id]?.week_labels ?? 0),
      render: (_: any, r: Sku) => {
        const wk = stats[r.id]?.week_labels ?? 0;
        return wk > 0
          ? <span className="num" style={{ fontWeight: 600, color: '#fa8c16' }}>{wk}<span style={{ fontSize: 10, fontWeight: 400, marginLeft: 1 }}>个</span></span>
          : <span style={{ color: 'var(--text-4)', fontSize: 12 }}>-</span>;
      },
    },
    {
      title: '操作', key: 'actions', width: 90, fixed: 'right' as const, align: 'center' as const,
      render: (_: any, r: Sku) => (
        <Space size={0}>
          <Tooltip title="编辑"><Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)} style={{ color: 'var(--brand)', borderRadius: 6 }} /></Tooltip>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(r.id)} okButtonProps={{ danger: true }}>
            <Tooltip title="删除"><Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ borderRadius: 6 }} /></Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const invColumns: any[] = [
    {
      title: 'SKU', key: 'name', width: 180,
      render: (_: any, r: InventoryItem) => (
        <div>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{r.sku_name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{r.fruit_name}{r.sku_description ? ` · ${r.sku_description}` : ''}</div>
        </div>
      ),
    },
    {
      title: '入库', dataIndex: 'inbound', width: 80, align: 'right' as const,
      sorter: (a: InventoryItem, b: InventoryItem) => a.inbound - b.inbound,
      render: (v: number) => <span className="num" style={{ fontWeight: 500 }}>{v.toLocaleString()}</span>,
    },
    {
      title: '出库', dataIndex: 'outbound', width: 80, align: 'right' as const,
      sorter: (a: InventoryItem, b: InventoryItem) => a.outbound - b.outbound,
      render: (v: number) => <span className="num" style={{ fontWeight: 500, color: '#00b96b' }}>{v.toLocaleString()}</span>,
    },
    {
      title: '在库', dataIndex: 'stock', width: 80, align: 'right' as const,
      defaultSortOrder: 'descend' as const,
      sorter: (a: InventoryItem, b: InventoryItem) => a.stock - b.stock,
      render: (v: number) => <span className="num" style={{ fontWeight: 700, fontSize: 15, color: v > 0 ? '#1677ff' : '#ff4d4f' }}>{v.toLocaleString()}</span>,
    },
    {
      title: '7日出库', dataIndex: 'outbound_7d', width: 80, align: 'right' as const,
      render: (v: number) => <span className="num" style={{ fontSize: 12, color: 'var(--text-3)' }}>{v}</span>,
    },
    {
      title: '日均消耗', dataIndex: 'daily_rate', width: 80, align: 'right' as const,
      render: (v: number) => <span className="num" style={{ fontSize: 12, color: '#fa8c16', fontWeight: 600 }}>{v}/天</span>,
    },
    {
      title: '可用天数', dataIndex: 'days_remaining', width: 100,
      sorter: (a: InventoryItem, b: InventoryItem) => a.days_remaining - b.days_remaining,
      render: (v: number, r: InventoryItem) => {
        const h = getStockHealth(r);
        return (
          <Tag color={v >= 999 ? 'default' : v <= 3 ? 'error' : v <= 7 ? 'warning' : 'success'}
            style={{ borderRadius: 6, fontWeight: 600, fontSize: 12 }}>
            {v >= 999 ? '充足' : `${v}天`}
          </Tag>
        );
      },
    },
    {
      title: '状态', key: 'health', width: 70, align: 'center' as const,
      render: (_: any, r: InventoryItem) => {
        const h = getStockHealth(r);
        return <Tag style={{ borderRadius: 6, fontWeight: 600, fontSize: 11, color: h.color, background: h.bg, border: `1px solid ${h.color}20` }}>{h.label}</Tag>;
      },
    },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22,
        padding: '20px 24px', borderRadius: 'var(--radius-l)',
        background: 'linear-gradient(135deg, rgba(22,119,255,0.05) 0%, rgba(114,46,209,0.03) 100%)',
        border: '1px solid rgba(22,119,255,0.06)',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 36, height: 36, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #1677ff 0%, #722ed1 100%)', color: '#fff', fontSize: 17,
              boxShadow: '0 4px 14px rgba(22,119,255,0.25)',
            }}><AppstoreOutlined /></span>
            SKU 管理
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 46 }}>管理产品SKU · 实时库存 · 产量追踪</div>
        </div>
        <Space>
          <Tooltip title="导出"><Button icon={<DownloadOutlined />} onClick={handleExport} style={{ borderRadius: 10, height: 38, width: 38 }} /></Tooltip>
          <Tooltip title="刷新"><Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 10, height: 38, width: 38 }} /></Tooltip>
          {viewMode === 'manage' && (
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}
              style={{ height: 38, borderRadius: 10, fontWeight: 600, paddingInline: 20 }}>添加 SKU</Button>
          )}
        </Space>
      </div>

      {/* View Mode Switch */}
      <div style={{ marginBottom: 16 }}>
        <Segmented
          value={viewMode}
          onChange={v => setViewMode(v as string)}
          options={[
            { value: 'manage', label: <span><TagOutlined style={{ marginRight: 4 }} />SKU 管理</span> },
            { value: 'inventory', label: <span><DatabaseOutlined style={{ marginRight: 4 }} />实时库存</span> },
          ]}
          style={{ borderRadius: 10 }}
        />
      </div>

      {/* ═══ MANAGE VIEW ═══ */}
      {viewMode === 'manage' && (
        <>
          <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
            {[
              { label: 'SKU 总数', value: data.length, unit: '个', icon: <TagOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.15)' },
              { label: '累计标签', value: totalLabels.toLocaleString(), unit: '个', icon: <PrinterOutlined />, gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', glow: 'rgba(114,46,209,0.15)' },
              { label: '累计出库', value: totalOutbound.toLocaleString(), unit: '个', icon: <ExportOutlined />, gradient: 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: 'rgba(0,185,107,0.15)' },
              { label: '近7天产量', value: weekLabels.toLocaleString(), unit: '个', icon: <FireOutlined />, gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.15)' },
            ].map((s, i) => (
              <Col xs={12} sm={6} key={i}>
                <div style={{
                  padding: '14px 16px', borderRadius: 'var(--radius-m)', background: s.gradient,
                  position: 'relative', overflow: 'hidden',
                  boxShadow: `0 4px 14px ${s.glow}`, transition: 'all 0.3s',
                  animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.08}s`,
                }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
                >
                  <div style={{ position: 'absolute', top: -12, right: -12, width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>{s.icon} {s.label}</div>
                  <div className="num" style={{ fontSize: 22, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>
                    {s.value}<span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3, opacity: 0.7 }}>{s.unit}</span>
                  </div>
                </div>
              </Col>
            ))}
          </Row>

          <div className="panel">
            <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {[undefined, ...fruitNames].map(name => (
                <div key={name ?? 'all'} style={{
                  padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500,
                  background: fruitFilter === name ? 'linear-gradient(135deg, #1677ff, #69b1ff)' : 'rgba(0,0,0,0.04)',
                  color: fruitFilter === name ? '#fff' : 'var(--text-3)',
                  cursor: 'pointer', transition: 'all 0.2s',
                }} onClick={() => setFruitFilter(name)}>
                  {name ?? '全部'} ({name ? data.filter(d => d.fruit_name === name).length : data.length})
                </div>
              ))}
            </div>
            <Table rowKey="id" columns={manageColumns} dataSource={filteredData} loading={loading} size="middle"
              pagination={{ pageSize: 15, showSizeChanger: true, pageSizeOptions: ['10', '15', '30'], showTotal: t => `共 ${t} 条` }}
              scroll={{ x: 950 }} locale={{ emptyText: '暂无 SKU 数据' }} />
          </div>
        </>
      )}

      {/* ═══ INVENTORY VIEW ═══ */}
      {viewMode === 'inventory' && (
        <>
          {/* Inventory Stats */}
          {invSummary && (
            <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
              {[
                { label: '在库 SKU', value: invSummary.total_sku_count, unit: '种', icon: <DatabaseOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.15)' },
                { label: '库存总量', value: invSummary.total_stock.toLocaleString(), unit: '件', icon: <InboxOutlined />, gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', glow: 'rgba(114,46,209,0.15)' },
                { label: '库存率', value: `${invSummary.stock_rate}%`, icon: <DashboardOutlined />, gradient: invSummary.stock_rate > 30 ? 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)' : 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: 'rgba(250,140,22,0.15)' },
                { label: '紧急/缺货', value: `${lowStockCount}/${outOfStockCount}`, icon: <WarningOutlined />, gradient: lowStockCount + outOfStockCount > 0 ? 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)' : 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: 'rgba(255,77,79,0.15)' },
              ].map((s, i) => (
                <Col xs={12} sm={6} key={i}>
                  <div style={{
                    padding: '14px 16px', borderRadius: 'var(--radius-m)', background: s.gradient,
                    position: 'relative', overflow: 'hidden',
                    boxShadow: `0 4px 14px ${s.glow}`, transition: 'all 0.3s',
                    animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.06}s`,
                  }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
                  >
                    <div style={{ position: 'absolute', top: -12, right: -12, width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>{s.icon} {s.label}</div>
                    <div className="num" style={{ fontSize: 22, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>
                      {s.value}{s.unit && <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3, opacity: 0.7 }}>{s.unit}</span>}
                    </div>
                  </div>
                </Col>
              ))}
            </Row>
          )}

          {/* Sub-view switch */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <Segmented
              value={invView} onChange={v => setInvView(v as string)}
              options={[
                { value: 'card', label: <span><AppstoreOutlined style={{ marginRight: 4 }} />分组卡片</span> },
                { value: 'table', label: <span><TagOutlined style={{ marginRight: 4 }} />列表视图</span> },
              ]}
              size="small" style={{ borderRadius: 8 }}
            />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[undefined, ...fruitNames].map(name => (
                <div key={name ?? 'all'} style={{
                  padding: '3px 10px', borderRadius: 16, fontSize: 11, fontWeight: 500,
                  background: fruitFilter === name ? 'linear-gradient(135deg, #1677ff, #69b1ff)' : 'rgba(0,0,0,0.04)',
                  color: fruitFilter === name ? '#fff' : 'var(--text-3)',
                  cursor: 'pointer', transition: 'all 0.2s',
                }} onClick={() => setFruitFilter(name)}>
                  {name ?? '全部'}
                </div>
              ))}
            </div>
          </div>

          {invLoading ? (
            <div style={{ textAlign: 'center', padding: 80 }}><span className="ant-spin-dot ant-spin-dot-spin" /></div>
          ) : invItems.length === 0 ? (
            <div className="panel" style={{ padding: 60, textAlign: 'center' }}>
              <Empty description="暂无库存数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
          ) : invView === 'card' ? (
            /* Card View - Grouped by fruit */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {invGroups.map((group, gi) => (
                <div key={group.fruit_name} className="panel" style={{
                  animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`,
                  animationDelay: `${gi * 0.08}s`,
                }}>
                  <div className="panel-head" style={{ borderBottom: `2px solid ${COLORS[gi % COLORS.length]}20` }}>
                    <span className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        width: 28, height: 28, borderRadius: 8,
                        background: `linear-gradient(135deg, ${COLORS[gi % COLORS.length]}, ${COLORS[gi % COLORS.length]}88)`,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontWeight: 700, fontSize: 13,
                      }}>{group.fruit_name.charAt(0)}</span>
                      {group.fruit_name}
                    </span>
                    <Space size={8}>
                      <Tag style={{ borderRadius: 6, fontSize: 11 }}>{group.sku_count} 种 SKU</Tag>
                      <Tag color="blue" style={{ borderRadius: 6, fontWeight: 700, fontSize: 12 }}>
                        库存 {group.total_stock.toLocaleString()}
                      </Tag>
                    </Space>
                  </div>
                  <div style={{ padding: '12px 16px' }}>
                    <Row gutter={[10, 10]}>
                      {group.items.map((item, ii) => {
                        const health = getStockHealth(item);
                        const maxStock = Math.max(...group.items.map(i => i.stock), 1);
                        const stockPct = Math.min((item.stock / maxStock) * 100, 100);
                        return (
                          <Col xs={24} sm={12} md={8} key={item.sku_id}>
                            <div style={{
                              padding: '14px 16px', borderRadius: 12,
                              border: `1px solid ${health.color}20`,
                              background: health.bg, transition: 'all 0.3s',
                            }}
                              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 4px 14px ${health.color}15`; }}
                              onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                                <div>
                                  <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{item.sku_name}</div>
                                  {item.sku_description && <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 1 }}>{item.sku_description}</div>}
                                </div>
                                <Tag style={{ borderRadius: 6, fontSize: 10, fontWeight: 600, color: health.color, background: '#fff', border: `1px solid ${health.color}30`, margin: 0 }}>
                                  {health.label}
                                </Tag>
                              </div>
                              <div style={{ marginBottom: 8 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>库存</span>
                                  <span className="num" style={{ fontSize: 18, fontWeight: 700, color: health.color }}>{item.stock.toLocaleString()}</span>
                                </div>
                                <Progress percent={stockPct} showInfo={false} strokeColor={health.color} trailColor="rgba(0,0,0,0.06)" size="small" />
                              </div>
                              <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-3)' }}>
                                <span>入库 <span className="num" style={{ fontWeight: 600 }}>{item.inbound}</span></span>
                                <span>出库 <span className="num" style={{ fontWeight: 600, color: '#00b96b' }}>{item.outbound}</span></span>
                                <span>日均 <span className="num" style={{ fontWeight: 600, color: '#fa8c16' }}>{item.daily_rate}</span></span>
                              </div>
                              {item.days_remaining < 999 && (
                                <div style={{ fontSize: 11, color: health.color, fontWeight: 600, marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <ClockCircleOutlined />
                                  预计可用 {item.days_remaining} 天
                                </div>
                              )}
                            </div>
                          </Col>
                        );
                      })}
                    </Row>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Table View */
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title"><DatabaseOutlined style={{ color: '#1677ff' }} />SKU 实时库存</span>
                <span style={{ fontSize: 12, color: 'var(--text-4)' }}>共 {invItems.length} 种 · 库存 {invSummary?.total_stock?.toLocaleString()} 件</span>
              </div>
              <Table dataSource={invItems} columns={invColumns} rowKey="sku_id" size="middle"
                loading={invLoading}
                pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `共 ${t} 条` }}
                locale={{ emptyText: '暂无库存数据' }}
                rowClassName={(r: InventoryItem) => r.stock <= 0 ? 'row-rejected' : r.days_remaining <= 3 ? 'row-warning' : ''} />
            </div>
          )}
        </>
      )}

      {/* Modal */}
      <Modal title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: editingId ? 'linear-gradient(135deg, #fa8c16, #ffc53d)' : 'linear-gradient(135deg, #1677ff, #722ed1)', color: '#fff', fontSize: 13 }}>
            {editingId ? <EditOutlined /> : <PlusOutlined />}
          </span>
          {editingId ? '编辑 SKU' : '添加 SKU'}
        </div>
      } open={modalOpen} onOk={handleSubmit} onCancel={() => setModalOpen(false)}
        confirmLoading={submitting} destroyOnClose width={520} okText="保存" cancelText="取消"
        styles={{ body: { paddingTop: 20 } }}>
        <Form form={form} layout="vertical">
          <Form.Item name="fruit_id" label="水果" rules={[{ required: true, message: '请选择水果' }]}>
            <Select placeholder="选择水果" showSearch optionFilterProp="label" style={{ borderRadius: 10 }}>
              {fruits.map(f => <Select.Option key={f.id} value={f.id} label={f.name}>{f.name}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="sku_name" label="SKU 名称" rules={[{ required: true, message: '请输入SKU名称' }]}>
            <Input placeholder="SKU 名称" maxLength={100} style={{ borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="sku_description" label="描述">
            <Input.TextArea rows={2} placeholder="SKU 描述" style={{ borderRadius: 10 }} />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}><Form.Item name="fruit_weight" label="果重(kg)" rules={[{ required: true }]}><InputNumber min={0} step={0.01} style={{ width: '100%', borderRadius: 10 }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="material_weight" label="料重(kg)" rules={[{ required: true }]}><InputNumber min={0} step={0.01} style={{ width: '100%', borderRadius: 10 }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="production_performance" label="产出率" rules={[{ required: true }]}><InputNumber min={0} step={0.01} style={{ width: '100%', borderRadius: 10 }} placeholder="0.85" /></Form.Item></Col>
          </Row>
          <Form.Item name="carton_box_id" label="纸箱类型">
            <Select placeholder="选择纸箱" allowClear style={{ borderRadius: 10 }}>
              {cartonBoxes.map(b => <Select.Option key={b.id} value={b.id}>{b.box_type}</Select.Option>)}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      <style>{`
        .row-rejected td { background: rgba(255,77,79,0.03) !important; }
        .row-rejected:hover td { background: rgba(255,77,79,0.06) !important; }
        .row-warning td { background: rgba(250,140,22,0.03) !important; }
        .row-warning:hover td { background: rgba(250,140,22,0.06) !important; }
      `}</style>
    </div>
  );
}
