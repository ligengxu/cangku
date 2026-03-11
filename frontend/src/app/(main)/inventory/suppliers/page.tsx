'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Space, Modal, Form, Input, Select, Tag, message, Popconfirm, Tooltip, Row, Col, Avatar, Progress,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ShopOutlined, PhoneOutlined,
  UserOutlined, ReloadOutlined, FileTextOutlined, InboxOutlined,
  AlipayCircleOutlined, CreditCardOutlined, DollarOutlined,
  RiseOutlined, LinkOutlined, DownloadOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import { useRouter } from 'next/navigation';
import type { Supplier } from '@/types';
import dayjs from 'dayjs';
import { exportToCsv } from '@/utils/exportCsv';

const typeOptions = [
  { value: 'fruit', label: '水果', color: '#00b96b', bg: 'rgba(0,185,107,0.08)', border: 'rgba(0,185,107,0.12)' },
  { value: 'box', label: '纸箱', color: '#1677ff', bg: 'rgba(22,119,255,0.08)', border: 'rgba(22,119,255,0.12)' },
  { value: 'material', label: '材料', color: '#fa8c16', bg: 'rgba(250,140,22,0.08)', border: 'rgba(250,140,22,0.12)' },
];

interface SupplierStat {
  total_amount: number;
  unpaid_amount: number;
  paid_amount: number;
  order_count: number;
  unpaid_count: number;
  last_order_date: string | null;
  payment_rate: number;
}

export default function InventorySuppliersPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Supplier[]>([]);
  const [stats, setStats] = useState<Record<number, SupplierStat>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const [refreshSpin, setRefreshSpin] = useState(false);
  const router = useRouter();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = typeFilter ? { type: typeFilter } : {};
      const [supRes, statsRes] = await Promise.all([
        api.get('/inventory/suppliers', { params }),
        api.get('/inventory/suppliers/stats').catch(() => ({ data: { data: {} } })),
      ]);
      setData(Array.isArray(supRes.data?.data ?? supRes.data) ? (supRes.data?.data ?? supRes.data) : []);
      setStats(statsRes.data?.data ?? {});
    } catch { message.error('加载供应商失败'); setData([]); }
    finally { setLoading(false); }
  }, [typeFilter]);

  const handleRefresh = () => { setRefreshSpin(true); fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600)); };

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAdd = () => { form.resetFields(); setEditingId(null); setModalOpen(true); };
  const handleEdit = (r: Supplier) => {
    form.setFieldsValue({
      name: r.name, type: r.type, contact: r.contact ?? '', contact_person: r.contact_person ?? '',
      phone: r.phone ?? '', alipay_account: r.alipay_account ?? '', bank_card: r.bank_card ?? '', notes: r.notes ?? '',
    });
    setEditingId(r.id); setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      if (editingId) { await api.put(`/inventory/suppliers/${editingId}`, values); message.success('更新成功'); }
      else { await api.post('/inventory/suppliers', values); message.success('添加成功'); }
      setModalOpen(false); fetchData();
    } catch (e: any) { message.error(e?.response?.data?.detail ?? e?.response?.data?.message ?? '操作失败'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (id: number) => {
    try { await api.delete(`/inventory/suppliers/${id}`); message.success('已移入回收站'); fetchData(); }
    catch (e: any) { message.error(e?.response?.data?.detail ?? e?.response?.data?.message ?? '删除失败'); }
  };

  const handleExport = () => {
    if (!data.length) { message.warning('暂无数据'); return; }
    const csvCols = [
      { key: 'id', title: 'ID' },
      { key: 'name', title: '供应商' },
      { key: 'type', title: '类型', render: (v: unknown) => typeOptions.find(o => o.value === v)?.label ?? String(v) },
      { key: 'contact_person', title: '联系人' },
      { key: 'phone', title: '电话' },
      { key: 'alipay_account', title: '支付宝' },
      { key: 'bank_card', title: '银行卡' },
      { key: 'notes', title: '备注' },
    ];
    exportToCsv(data, csvCols, '供应商列表');
  };

  const filteredData = typeFilter ? data.filter(d => d.type === typeFilter) : data;
  const COLORS = ['#1677ff', '#00b96b', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2'];

  const totalAmt = Object.values(stats).reduce((a, s) => a + s.total_amount, 0);
  const totalUnpaid = Object.values(stats).reduce((a, s) => a + s.unpaid_amount, 0);
  const totalOrders = Object.values(stats).reduce((a, s) => a + s.order_count, 0);

  const columns: any[] = [
    {
      title: '供应商', dataIndex: 'name', width: 180, fixed: 'left' as const,
      render: (v: string, r: Supplier) => (
        <Space size={10}>
          <Avatar size={30} style={{ background: COLORS[r.id % COLORS.length], fontWeight: 700, fontSize: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}>
            {(v || '?').charAt(0)}
          </Avatar>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: 13 }}>{v}</div>
            {stats[r.id]?.last_order_date && (
              <div style={{ fontSize: 10, color: 'var(--text-4)' }}>最近交易 {stats[r.id].last_order_date}</div>
            )}
          </div>
        </Space>
      ),
    },
    {
      title: '类型', dataIndex: 'type', width: 80,
      render: (t: string) => {
        const opt = typeOptions.find(o => o.value === t);
        return opt ? (
          <span style={{
            display: 'inline-block', padding: '1px 10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
            background: `linear-gradient(135deg, ${opt.bg} 0%, transparent 100%)`,
            color: opt.color, border: `1px solid ${opt.border}`,
          }}>{opt.label}</span>
        ) : <Tag>{t}</Tag>;
      },
    },
    {
      title: '交易总额', key: 'total_amount', width: 130, align: 'right' as const,
      sorter: (a: Supplier, b: Supplier) => (stats[a.id]?.total_amount ?? 0) - (stats[b.id]?.total_amount ?? 0),
      render: (_: any, r: Supplier) => {
        const s = stats[r.id];
        if (!s || s.order_count === 0) return <span style={{ color: 'var(--text-4)', fontSize: 12 }}>暂无交易</span>;
        return (
          <div>
            <span className="num" style={{ fontWeight: 700, color: 'var(--text-1)', fontSize: 14 }}>
              ¥{s.total_amount.toLocaleString()}
            </span>
            <div style={{ fontSize: 10, color: 'var(--text-4)' }}>{s.order_count} 笔</div>
          </div>
        );
      },
    },
    {
      title: '付款状况', key: 'payment', width: 150,
      sorter: (a: Supplier, b: Supplier) => (stats[a.id]?.unpaid_amount ?? 0) - (stats[b.id]?.unpaid_amount ?? 0),
      render: (_: any, r: Supplier) => {
        const s = stats[r.id];
        if (!s || s.order_count === 0) return <span style={{ color: 'var(--text-4)', fontSize: 12 }}>-</span>;
        const color = s.payment_rate >= 80 ? '#52c41a' : s.payment_rate >= 50 ? '#faad14' : '#ff4d4f';
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
              <span style={{ color: s.unpaid_amount > 0 ? '#ff4d4f' : '#52c41a', fontWeight: 600 }}>
                {s.unpaid_amount > 0 ? `欠 ¥${s.unpaid_amount.toLocaleString()}` : '已结清'}
              </span>
              <span className="num" style={{ color, fontWeight: 600 }}>{s.payment_rate}%</span>
            </div>
            <Progress percent={s.payment_rate} size="small" showInfo={false} strokeColor={color}
              trailColor="rgba(0,0,0,0.04)" style={{ marginBottom: 0 }} />
          </div>
        );
      },
    },
    {
      title: '联系人', dataIndex: 'contact_person', width: 100,
      render: (v: string) => v ? <span style={{ fontWeight: 500 }}>{v}</span> : <span style={{ color: 'var(--text-4)' }}>-</span>,
    },
    {
      title: '电话', dataIndex: 'phone', width: 120,
      render: (v: string) => v ? <Space size={4}><PhoneOutlined style={{ fontSize: 11, color: '#00b96b' }} /><span style={{ fontWeight: 500, fontSize: 12 }}>{v}</span></Space> : <span style={{ color: 'var(--text-4)' }}>-</span>,
    },
    {
      title: '操作', key: 'actions', width: 130, fixed: 'right' as const, align: 'center' as const,
      render: (_: any, r: Supplier) => (
        <Space size={0}>
          <Tooltip title="查看对账">
            <Button type="text" size="small" icon={<LinkOutlined />}
              onClick={() => router.push(`/reports/statement?supplier_id=${r.id}`)}
              style={{ color: '#13c2c2', borderRadius: 6 }} />
          </Tooltip>
          <Tooltip title="编辑">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)}
              style={{ color: 'var(--brand)', borderRadius: 6 }} />
          </Tooltip>
          <Popconfirm title="确定移入回收站？" description="可在系统管理→回收站中恢复" onConfirm={() => handleDelete(r.id)} okText="移入回收站" cancelText="取消" okButtonProps={{ danger: true }}>
            <Tooltip title="删除"><Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ borderRadius: 6 }} /></Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22,
        padding: '20px 24px', borderRadius: 'var(--radius-l)',
        background: 'linear-gradient(135deg, rgba(22,119,255,0.05) 0%, rgba(0,185,107,0.03) 100%)',
        border: '1px solid rgba(22,119,255,0.06)',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 32, height: 32, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #1677ff 0%, #00b96b 100%)', color: '#fff', fontSize: 15,
              boxShadow: '0 3px 10px rgba(22,119,255,0.2)',
            }}><ShopOutlined /></span>
            供应商管理
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 42 }}>管理供应商信息 · 交易统计 · 对账中心</div>
        </div>
        <Space>
          <Tooltip title="导出 CSV"><Button icon={<DownloadOutlined />} onClick={handleExport} disabled={!data.length} style={{ borderRadius: 10, height: 38, width: 38 }} /></Tooltip>
          <Tooltip title="刷新数据"><Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 10, height: 38, width: 38 }} /></Tooltip>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}
            style={{ height: 38, borderRadius: 10, fontWeight: 600, paddingInline: 20 }}>添加供应商</Button>
        </Space>
      </div>

      {/* Stats Cards */}
      <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
        {[
          { label: '供应商总数', value: data.length, unit: '家', icon: <ShopOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.15)' },
          { label: '交易总额', value: `¥${(totalAmt / 10000).toFixed(1)}万`, unit: '', icon: <RiseOutlined />, gradient: 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: 'rgba(0,185,107,0.15)' },
          { label: '未付总额', value: `¥${(totalUnpaid / 10000).toFixed(1)}万`, unit: '', icon: <DollarOutlined />, gradient: 'linear-gradient(135deg, #ff4d4f 0%, #ff85c0 100%)', glow: 'rgba(255,77,79,0.15)' },
          { label: '总订单数', value: totalOrders.toLocaleString(), unit: '笔', icon: <FileTextOutlined />, gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', glow: 'rgba(114,46,209,0.15)' },
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
              <div className="num" style={{ fontSize: 22, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>
                {s.value}{s.unit && <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3, opacity: 0.7 }}>{s.unit}</span>}
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* Table */}
      <div className="panel">
        <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {[undefined, ...typeOptions.map(o => o.value)].map(v => (
            <div key={v ?? 'all'} style={{
              padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 500,
              background: typeFilter === v ? 'linear-gradient(135deg, #1677ff, #69b1ff)' : 'rgba(0,0,0,0.04)',
              color: typeFilter === v ? '#fff' : 'var(--text-3)',
              cursor: 'pointer', transition: 'all 0.2s',
            }} onClick={() => setTypeFilter(v)}>
              {v ? typeOptions.find(o => o.value === v)?.label : '全部'}
              <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.8 }}>
                ({v ? data.filter(d => d.type === v).length : data.length})
              </span>
            </div>
          ))}
        </div>
        <Table rowKey="id" columns={columns} dataSource={filteredData} loading={loading} size="middle"
          pagination={{ pageSize: 15, showSizeChanger: true, pageSizeOptions: ['10', '15', '30'], showTotal: t => `共 ${t} 条` }}
          scroll={{ x: 1000 }}
          locale={{ emptyText: '暂无供应商数据' }}
        />
      </div>

      {/* Modal */}
      <Modal title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: editingId ? 'linear-gradient(135deg, #fa8c16, #ffc53d)' : 'linear-gradient(135deg, #1677ff, #00b96b)', color: '#fff', fontSize: 13 }}>
            {editingId ? <EditOutlined /> : <PlusOutlined />}
          </span>
          {editingId ? '编辑供应商' : '添加供应商'}
        </div>
      } open={modalOpen} onOk={handleSubmit} onCancel={() => setModalOpen(false)}
        confirmLoading={submitting} destroyOnClose width={520} okText="保存" cancelText="取消"
        styles={{ body: { paddingTop: 20 } }}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="供应商名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="名称" maxLength={100} style={{ borderRadius: 10 }} />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true, message: '请选择类型' }]}>
            <Select placeholder="选择类型" style={{ borderRadius: 10 }}>
              {typeOptions.map(o => <Select.Option key={o.value} value={o.value}>{o.label}供应商</Select.Option>)}
            </Select>
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="contact_person" label="联系人">
                <Input placeholder="联系人" prefix={<UserOutlined />} style={{ borderRadius: 10 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="phone" label="电话">
                <Input placeholder="联系电话" prefix={<PhoneOutlined />} style={{ borderRadius: 10 }} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="alipay_account" label="支付宝账号">
                <Input placeholder="支付宝账号" prefix={<AlipayCircleOutlined style={{ color: '#1677ff' }} />} style={{ borderRadius: 10 }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="bank_card" label="银行卡号">
                <Input placeholder="银行卡号" prefix={<CreditCardOutlined style={{ color: '#fa8c16' }} />} style={{ borderRadius: 10 }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} placeholder="备注" style={{ borderRadius: 10 }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
