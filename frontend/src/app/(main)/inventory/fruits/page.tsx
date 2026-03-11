'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Space, Modal, Form, Input, message, Popconfirm, Tooltip, Row, Col, Tag,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, AppleOutlined,
  InboxOutlined, DollarOutlined, ShoppingCartOutlined, RiseOutlined, TeamOutlined,
  BarChartOutlined, DownloadOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import { useRouter } from 'next/navigation';
import type { Fruit } from '@/types';
import { exportToCsv } from '@/utils/exportCsv';

const FRUIT_COLORS = ['#00b96b', '#fa8c16', '#ff4d4f', '#722ed1', '#1677ff', '#eb2f96', '#13c2c2', '#faad14'];

interface FruitStat {
  total_weight: number;
  total_cost: number;
  avg_price: number;
  order_count: number;
  last_date: string | null;
  supplier_count: number;
  sku_count: number;
}

export default function InventoryFruitsPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Fruit[]>([]);
  const [stats, setStats] = useState<Record<number, FruitStat>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const [refreshSpin, setRefreshSpin] = useState(false);
  const router = useRouter();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [fruitsRes, statsRes] = await Promise.all([
        api.get('/inventory/fruits'),
        api.get('/inventory/fruits/stats').catch(() => ({ data: { data: {} } })),
      ]);
      setData(Array.isArray(fruitsRes.data?.data ?? fruitsRes.data) ? (fruitsRes.data?.data ?? fruitsRes.data) : []);
      setStats(statsRes.data?.data ?? {});
    } catch { message.error('加载水果列表失败'); setData([]); }
    finally { setLoading(false); }
  }, []);

  const handleRefresh = () => { setRefreshSpin(true); fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600)); };

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAdd = () => { form.resetFields(); setEditingId(null); setModalOpen(true); };
  const handleEdit = (r: Fruit) => { form.setFieldsValue({ name: r.name }); setEditingId(r.id); setModalOpen(true); };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (editingId) { await api.put(`/inventory/fruits/${editingId}`, values); message.success('更新成功'); }
      else { await api.post('/inventory/fruits', values); message.success('添加成功'); }
      setModalOpen(false); fetchData();
    } catch (e: any) { message.error(e?.response?.data?.detail ?? e?.response?.data?.message ?? '操作失败'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (id: number) => {
    try { await api.delete(`/inventory/fruits/${id}`); message.success('删除成功'); fetchData(); }
    catch (e: any) { message.error(e?.response?.data?.detail ?? e?.response?.data?.message ?? '删除失败'); }
  };

  const handleExport = () => {
    if (!data.length) { message.warning('暂无数据'); return; }
    const rows = data.map(f => {
      const s = stats[f.id];
      return { ...f, total_weight: s?.total_weight ?? 0, total_cost: s?.total_cost ?? 0, avg_price: s?.avg_price ?? 0, order_count: s?.order_count ?? 0, sku_count: s?.sku_count ?? 0 };
    });
    const cols = [
      { key: 'id', title: 'ID' },
      { key: 'name', title: '水果名称' },
      { key: 'order_count', title: '采购次数' },
      { key: 'total_weight', title: '总采购量(kg)' },
      { key: 'total_cost', title: '总花费(¥)' },
      { key: 'avg_price', title: '均价(¥/kg)' },
      { key: 'sku_count', title: '关联SKU数' },
    ];
    exportToCsv(rows, cols, '水果品类');
  };

  const totalWeight = Object.values(stats).reduce((a, s) => a + s.total_weight, 0);
  const totalCost = Object.values(stats).reduce((a, s) => a + s.total_cost, 0);
  const totalOrders = Object.values(stats).reduce((a, s) => a + s.order_count, 0);

  const columns: any[] = [
    {
      title: '水果', dataIndex: 'name', width: 180,
      render: (v: string, r: Fruit) => (
        <Space size={10}>
          <span style={{
            width: 32, height: 32, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: `linear-gradient(135deg, ${FRUIT_COLORS[r.id % FRUIT_COLORS.length]}20, ${FRUIT_COLORS[r.id % FRUIT_COLORS.length]}08)`,
            color: FRUIT_COLORS[r.id % FRUIT_COLORS.length], fontSize: 14, fontWeight: 700,
            border: `1px solid ${FRUIT_COLORS[r.id % FRUIT_COLORS.length]}18`,
          }}>{(v || '?').charAt(0)}</span>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: 14 }}>{v}</div>
            {stats[r.id]?.last_date && (
              <div style={{ fontSize: 10, color: 'var(--text-4)' }}>最近采购 {stats[r.id].last_date}</div>
            )}
          </div>
        </Space>
      ),
    },
    {
      title: '采购量', key: 'weight', width: 120, align: 'right' as const,
      sorter: (a: Fruit, b: Fruit) => (stats[a.id]?.total_weight ?? 0) - (stats[b.id]?.total_weight ?? 0),
      render: (_: any, r: Fruit) => {
        const s = stats[r.id];
        if (!s || s.order_count === 0) return <span style={{ color: 'var(--text-4)', fontSize: 12 }}>-</span>;
        return (
          <div>
            <span className="num" style={{ fontWeight: 700, color: 'var(--text-1)' }}>{s.total_weight.toLocaleString()}</span>
            <span style={{ fontSize: 10, color: 'var(--text-4)', marginLeft: 2 }}>kg</span>
          </div>
        );
      },
    },
    {
      title: '总花费', key: 'cost', width: 130, align: 'right' as const,
      sorter: (a: Fruit, b: Fruit) => (stats[a.id]?.total_cost ?? 0) - (stats[b.id]?.total_cost ?? 0),
      render: (_: any, r: Fruit) => {
        const s = stats[r.id];
        if (!s || s.order_count === 0) return <span style={{ color: 'var(--text-4)', fontSize: 12 }}>-</span>;
        return <span className="num" style={{ fontWeight: 700, color: '#fa8c16' }}>¥{s.total_cost.toLocaleString()}</span>;
      },
    },
    {
      title: '均价', key: 'avg', width: 100, align: 'right' as const,
      sorter: (a: Fruit, b: Fruit) => (stats[a.id]?.avg_price ?? 0) - (stats[b.id]?.avg_price ?? 0),
      render: (_: any, r: Fruit) => {
        const s = stats[r.id];
        if (!s || s.order_count === 0) return <span style={{ color: 'var(--text-4)', fontSize: 12 }}>-</span>;
        return <span className="num" style={{ fontWeight: 600, color: '#1677ff' }}>¥{s.avg_price.toFixed(2)}</span>;
      },
    },
    {
      title: '采购/SKU/供应商', key: 'counts', width: 150, align: 'center' as const,
      render: (_: any, r: Fruit) => {
        const s = stats[r.id];
        if (!s || s.order_count === 0) return <span style={{ color: 'var(--text-4)', fontSize: 12 }}>-</span>;
        return (
          <Space size={4}>
            <Tag color="green" style={{ borderRadius: 6, fontSize: 11, margin: 0 }}>{s.order_count}笔</Tag>
            <Tag color="blue" style={{ borderRadius: 6, fontSize: 11, margin: 0 }}>{s.sku_count}SKU</Tag>
            <Tag color="purple" style={{ borderRadius: 6, fontSize: 11, margin: 0 }}>{s.supplier_count}家</Tag>
          </Space>
        );
      },
    },
    {
      title: '操作', key: 'actions', width: 130, align: 'center' as const, fixed: 'right' as const,
      render: (_: any, r: Fruit) => (
        <Space size={0}>
          <Tooltip title="价格走势">
            <Button type="text" size="small" icon={<RiseOutlined />}
              onClick={() => router.push(`/reports/pricing?fruit_name=${r.name}`)}
              style={{ color: '#13c2c2', borderRadius: 6 }} />
          </Tooltip>
          <Tooltip title="编辑">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)}
              style={{ color: 'var(--brand)', borderRadius: 6 }} />
          </Tooltip>
          <Popconfirm title="确定删除？" description="已被SKU引用的水果无法删除" onConfirm={() => handleDelete(r.id)} okButtonProps={{ danger: true }}>
            <Tooltip title="删除"><Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ borderRadius: 6 }} /></Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22,
        padding: '20px 24px', borderRadius: 'var(--radius-l)',
        background: 'linear-gradient(135deg, rgba(0,185,107,0.06) 0%, rgba(250,140,22,0.03) 100%)',
        border: '1px solid rgba(0,185,107,0.08)',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 32, height: 32, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #00b96b 0%, #fa8c16 100%)', color: '#fff', fontSize: 15,
              boxShadow: '0 3px 10px rgba(0,185,107,0.2)',
            }}><AppleOutlined /></span>
            水果管理
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 42 }}>管理水果品类 · 采购统计 · 价格追踪</div>
        </div>
        <Space>
          <Tooltip title="导出"><Button icon={<DownloadOutlined />} onClick={handleExport} disabled={!data.length} style={{ borderRadius: 10, height: 38, width: 38 }} /></Tooltip>
          <Tooltip title="刷新"><Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 10, height: 38, width: 38 }} /></Tooltip>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}
            style={{ height: 38, borderRadius: 10, fontWeight: 600, paddingInline: 20 }}>添加水果</Button>
        </Space>
      </div>

      {/* Stats */}
      <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
        {[
          { label: '水果品类', value: data.length, unit: '种', icon: <AppleOutlined />, gradient: 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: 'rgba(0,185,107,0.15)' },
          { label: '总采购量', value: `${(totalWeight / 1000).toFixed(1)}吨`, unit: '', icon: <InboxOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.15)' },
          { label: '总采购额', value: `¥${(totalCost / 10000).toFixed(1)}万`, unit: '', icon: <DollarOutlined />, gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.15)' },
          { label: '采购笔数', value: totalOrders.toLocaleString(), unit: '笔', icon: <ShoppingCartOutlined />, gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', glow: 'rgba(114,46,209,0.15)' },
        ].map((s, i) => (
          <Col xs={12} sm={6} key={i}>
            <div style={{
              padding: '14px 16px', borderRadius: 'var(--radius-m)', background: s.gradient,
              position: 'relative', overflow: 'hidden',
              boxShadow: `0 4px 14px ${s.glow}`, transition: 'all 0.3s',
              animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`,
              animationDelay: `${i * 0.08}s`,
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
            >
              <div style={{ position: 'absolute', top: -12, right: -12, width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>{s.icon} {s.label}</div>
              <div className="num" style={{ fontSize: 22, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>
                {s.value}{s.unit && <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3, opacity: 0.7 }}>{s.unit}</span>}
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* Table */}
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title"><AppleOutlined style={{ color: '#00b96b' }} />水果列表</span>
          <span style={{ fontSize: 12, color: 'var(--text-4)' }}>共 {data.length} 种</span>
        </div>
        <Table rowKey="id" dataSource={data} columns={columns} loading={loading} size="middle"
          pagination={{ pageSize: 15, showSizeChanger: true, showTotal: t => `共 ${t} 条` }}
          scroll={{ x: 800 }}
          locale={{ emptyText: '暂无水果数据' }}
        />
      </div>

      {/* Modal */}
      <Modal title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: editingId ? 'linear-gradient(135deg, #fa8c16, #ffc53d)' : 'linear-gradient(135deg, #00b96b, #5cdbd3)', color: '#fff', fontSize: 13 }}>
            {editingId ? <EditOutlined /> : <PlusOutlined />}
          </span>
          {editingId ? '编辑水果' : '添加水果'}
        </div>
      } open={modalOpen} onOk={handleSubmit} onCancel={() => setModalOpen(false)}
        confirmLoading={submitting} destroyOnClose okText="保存" cancelText="取消"
        styles={{ body: { paddingTop: 20 } }}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="水果名称" rules={[{ required: true, message: '请输入水果名称' }]}>
            <Input placeholder="如：苹果、香蕉" maxLength={50} style={{ borderRadius: 10, height: 42 }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
