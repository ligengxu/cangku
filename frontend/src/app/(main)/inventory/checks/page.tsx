'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Space, Modal, Form, Input, InputNumber, DatePicker, message, Tag,
  Tooltip, Row, Col, Popconfirm, Select, Descriptions, Badge, Empty,
} from 'antd';
import {
  PlusOutlined, AuditOutlined, CheckCircleOutlined, CloseCircleOutlined,
  FileSearchOutlined, DeleteOutlined, ReloadOutlined, ExclamationCircleOutlined,
  ArrowUpOutlined, ArrowDownOutlined, MinusOutlined, SyncOutlined,
  FileDoneOutlined, ClockCircleOutlined, StopOutlined, DownloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '@/services/api';
import type { InventoryCheckItem, InventoryCheckFull, CartonBox } from '@/types';

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string; gradient: string }> = {
  draft: { color: 'processing', icon: <ClockCircleOutlined />, label: '草稿', gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)' },
  confirmed: { color: 'success', icon: <CheckCircleOutlined />, label: '已确认', gradient: 'linear-gradient(135deg, #52c41a 0%, #95de64 100%)' },
  cancelled: { color: 'default', icon: <StopOutlined />, label: '已作废', gradient: 'linear-gradient(135deg, #8c8c8c 0%, #bfbfbf 100%)' },
};

export default function InventoryChecksPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<InventoryCheckItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailData, setDetailData] = useState<InventoryCheckFull | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cartonBoxes, setCartonBoxes] = useState<CartonBox[]>([]);
  const [form] = Form.useForm();
  const [checkRows, setCheckRows] = useState<{ carton_box_id: number; actual_quantity: number }[]>([]);
  const [refreshSpin, setRefreshSpin] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/inventory/checks', { params: { page, page_size: pageSize, status: statusFilter } });
      setData(res.data?.data ?? []);
      setTotal(res.data?.total ?? 0);
    } catch {
      message.error('加载盘点列表失败');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, statusFilter]);

  const fetchCartonBoxes = async () => {
    try {
      const res = await api.get('/inventory/carton-boxes');
      setCartonBoxes(Array.isArray(res.data?.data ?? res.data) ? (res.data?.data ?? res.data) : []);
    } catch { setCartonBoxes([]); }
  };

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchCartonBoxes(); }, []);

  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const openNewCheck = () => {
    form.resetFields();
    form.setFieldValue('check_date', dayjs());
    const rows = cartonBoxes.map(b => ({ carton_box_id: b.id, actual_quantity: Number(b.stock_quantity) || 0 }));
    setCheckRows(rows);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (checkRows.length === 0) { message.warning('请至少添加一项盘点明细'); return; }
    setSubmitting(true);
    try {
      await api.post('/inventory/checks', {
        check_date: values.check_date.format('YYYY-MM-DD'),
        check_note: values.check_note || null,
        details: checkRows.map(r => ({ carton_box_id: r.carton_box_id, actual_quantity: r.actual_quantity })),
      });
      message.success('盘点单创建成功');
      setModalOpen(false);
      fetchData();
    } catch (e: any) { message.error(e?.response?.data?.detail ?? '创建失败'); }
    finally { setSubmitting(false); }
  };

  const handleViewDetail = async (id: number) => {
    setDetailLoading(true);
    setDetailOpen(true);
    try {
      const res = await api.get(`/inventory/checks/${id}`);
      setDetailData(res.data?.data ?? null);
    } catch { message.error('获取详情失败'); }
    finally { setDetailLoading(false); }
  };

  const handleConfirm = async (id: number) => {
    try {
      const res = await api.put(`/inventory/checks/${id}/confirm`);
      message.success(res.data?.message ?? '确认成功');
      fetchData();
      if (detailData?.id === id) handleViewDetail(id);
    } catch (e: any) { message.error(e?.response?.data?.detail ?? '确认失败'); }
  };

  const handleCancel = async (id: number) => {
    try {
      await api.put(`/inventory/checks/${id}/cancel`);
      message.success('已作废');
      fetchData();
      if (detailData?.id === id) handleViewDetail(id);
    } catch (e: any) { message.error(e?.response?.data?.detail ?? '操作失败'); }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/inventory/checks/${id}`);
      message.success('删除成功');
      fetchData();
    } catch (e: any) { message.error(e?.response?.data?.detail ?? '删除失败'); }
  };

  const exportCSV = () => {
    if (!detailData) return;
    const header = '纸箱类型,系统数量,实际数量,差异\n';
    const rows = (detailData.details || []).map(d =>
      `${d.box_type ?? ''},${d.system_quantity ?? 0},${d.actual_quantity ?? 0},${d.difference ?? 0}`
    ).join('\n');
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + header + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `盘点单_${detailData.id}_${detailData.check_date}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    message.success('导出成功');
  };

  const updateCheckRow = (idx: number, qty: number) => {
    setCheckRows(prev => prev.map((r, i) => i === idx ? { ...r, actual_quantity: qty } : r));
  };

  const stats = {
    total: total,
    draft: data.filter(d => d.status === 'draft').length,
    confirmed: data.filter(d => d.status === 'confirmed').length,
    withDiff: data.filter(d => d.total_difference !== 0).length,
  };

  const columns: any[] = [
    {
      title: '编号', dataIndex: 'id', width: 80,
      render: (v: number) => (
        <span style={{ fontWeight: 700, color: 'var(--brand)', fontSize: 13 }}>#{v}</span>
      ),
    },
    {
      title: '盘点日期', dataIndex: 'check_date', width: 120,
      render: (v: string) => (
        <span style={{ fontWeight: 500, color: 'var(--text-1)' }}>{v}</span>
      ),
    },
    {
      title: '盘点人', dataIndex: 'check_user_name', width: 100,
      render: (v: string) => v ? (
        <Space size={6}>
          <span style={{
            width: 24, height: 24, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg, #722ed1, #eb2f96)', color: '#fff', fontSize: 10, fontWeight: 700,
          }}>{v[0]}</span>
          <span style={{ fontSize: 13 }}>{v}</span>
        </Space>
      ) : <span style={{ color: 'var(--text-4)' }}>-</span>,
    },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (v: string) => {
        const cfg = STATUS_CONFIG[v] || STATUS_CONFIG.draft;
        return <Tag color={cfg.color} icon={cfg.icon} style={{ borderRadius: 6, fontWeight: 600 }}>{cfg.label}</Tag>;
      },
    },
    {
      title: '明细项', dataIndex: 'detail_count', width: 80, align: 'center' as const,
      render: (v: number) => <Badge count={v} showZero style={{ backgroundColor: 'var(--brand)' }} overflowCount={999} />,
    },
    {
      title: '差异总计', dataIndex: 'total_difference', width: 110, align: 'right' as const,
      render: (v: number) => {
        if (v === 0) return <Tag icon={<MinusOutlined />} style={{ borderRadius: 6, fontWeight: 600 }}>无差异</Tag>;
        const isPositive = v > 0;
        return (
          <Tag
            color={isPositive ? 'success' : 'error'}
            icon={isPositive ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
            style={{ borderRadius: 6, fontWeight: 700, fontSize: 13 }}
          >
            {isPositive ? '+' : ''}{v}
          </Tag>
        );
      },
    },
    {
      title: '备注', dataIndex: 'check_note', width: 150, ellipsis: true,
      render: (v: string) => <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{v || '-'}</span>,
    },
    {
      title: '创建时间', dataIndex: 'created_at', width: 150,
      render: (v: string) => <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'}</span>,
    },
    {
      title: '操作', width: 200, fixed: 'right' as const,
      render: (_: any, record: InventoryCheckItem) => (
        <Space size={4}>
          <Tooltip title="查看详情">
            <Button type="link" size="small" icon={<FileSearchOutlined />} onClick={() => handleViewDetail(record.id)} />
          </Tooltip>
          {record.status === 'draft' && (
            <>
              <Popconfirm title="确认此盘点单？" description="确认后将调整纸箱库存数量" onConfirm={() => handleConfirm(record.id)} okText="确认" cancelText="取消">
                <Tooltip title="确认盘点">
                  <Button type="link" size="small" icon={<CheckCircleOutlined />} style={{ color: '#52c41a' }} />
                </Tooltip>
              </Popconfirm>
              <Popconfirm title="作废此盘点单？" onConfirm={() => handleCancel(record.id)} okText="作废" cancelText="取消">
                <Tooltip title="作废">
                  <Button type="link" size="small" icon={<CloseCircleOutlined />} style={{ color: '#faad14' }} />
                </Tooltip>
              </Popconfirm>
            </>
          )}
          {record.status !== 'confirmed' && (
            <Popconfirm title="删除此盘点单？" description="删除后不可恢复" onConfirm={() => handleDelete(record.id)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
              <Tooltip title="删除">
                <Button type="link" size="small" danger icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const detailColumns: any[] = [
    {
      title: '纸箱类型', dataIndex: 'box_type', width: 180,
      render: (v: string) => (
        <Space size={8}>
          <span style={{
            width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg, rgba(114,46,209,0.12), rgba(114,46,209,0.04))',
            color: '#722ed1', fontSize: 13,
          }}><AuditOutlined /></span>
          <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{v || '未知'}</span>
        </Space>
      ),
    },
    {
      title: '系统数量', dataIndex: 'system_quantity', width: 110, align: 'right' as const,
      render: (v: any) => <span className="num" style={{ fontWeight: 600, color: 'var(--text-2)' }}>{Number(v ?? 0).toLocaleString()}</span>,
    },
    {
      title: '实际数量', dataIndex: 'actual_quantity', width: 110, align: 'right' as const,
      render: (v: any) => <span className="num" style={{ fontWeight: 700, color: 'var(--brand)' }}>{Number(v ?? 0).toLocaleString()}</span>,
    },
    {
      title: '差异', dataIndex: 'difference', width: 120, align: 'right' as const,
      render: (v: any) => {
        const diff = Number(v ?? 0);
        if (diff === 0) return <Tag style={{ borderRadius: 6 }}>0</Tag>;
        return (
          <Tag
            color={diff > 0 ? 'success' : 'error'}
            icon={diff > 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
            style={{ borderRadius: 6, fontWeight: 700, fontSize: 13 }}
          >
            {diff > 0 ? '+' : ''}{diff}
          </Tag>
        );
      },
    },
  ];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* ── 页头 ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22,
        padding: '20px 24px', borderRadius: 'var(--radius-l)',
        background: 'linear-gradient(135deg, rgba(114,46,209,0.06) 0%, rgba(22,119,255,0.03) 100%)',
        border: '1px solid rgba(114,46,209,0.08)',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 32, height: 32, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #722ed1 0%, #eb2f96 100%)', color: '#fff', fontSize: 15,
              boxShadow: '0 3px 10px rgba(114,46,209,0.2)',
            }}><AuditOutlined /></span>
            库存盘点
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 42 }}>创建盘点单，核实纸箱实际库存与系统库存差异</div>
        </div>
        <Space>
          <Tooltip title="刷新数据">
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh}
              style={{ borderRadius: 10, height: 38, width: 38, transition: 'all 0.3s' }}
              className="refresh-btn" />
          </Tooltip>
          <Button type="primary" icon={<PlusOutlined />} onClick={openNewCheck}
            style={{ height: 38, borderRadius: 10, fontWeight: 600, paddingInline: 20 }}>新建盘点</Button>
        </Space>
      </div>

      {/* ── 统计卡片 ── */}
      <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
        {[
          { label: '盘点总数', value: stats.total, icon: <AuditOutlined />, gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', glow: 'rgba(114,46,209,0.15)' },
          { label: '草稿', value: stats.draft, icon: <ClockCircleOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.15)' },
          { label: '已确认', value: stats.confirmed, icon: <CheckCircleOutlined />, gradient: 'linear-gradient(135deg, #52c41a 0%, #95de64 100%)', glow: 'rgba(82,196,26,0.15)' },
          { label: '有差异', value: stats.withDiff, icon: <ExclamationCircleOutlined />, gradient: stats.withDiff > 0 ? 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)' : 'linear-gradient(135deg, #52c41a 0%, #95de64 100%)', glow: stats.withDiff > 0 ? 'rgba(250,140,22,0.15)' : 'rgba(82,196,26,0.15)' },
        ].map((s, i) => (
          <Col xs={12} sm={6} key={i}>
            <div style={{
              padding: '14px 16px', borderRadius: 'var(--radius-m)', background: s.gradient, position: 'relative', overflow: 'hidden',
              boxShadow: `0 4px 14px ${s.glow}`, transition: 'all 0.3s', cursor: 'default',
              animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`,
              animationDelay: `${i * 0.08}s`,
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
            >
              <div style={{ position: 'absolute', top: -12, right: -12, width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>{s.icon} {s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', lineHeight: 1.2 }} className="num">{s.value}</div>
            </div>
          </Col>
        ))}
      </Row>

      {/* ── 筛选 ── */}
      <div style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Select
          allowClear
          placeholder="筛选状态"
          value={statusFilter}
          onChange={v => { setStatusFilter(v); setPage(1); }}
          style={{ width: 140, borderRadius: 8 }}
          options={[
            { value: 'draft', label: '草稿' },
            { value: 'confirmed', label: '已确认' },
            { value: 'cancelled', label: '已作废' },
          ]}
        />
      </div>

      {/* ── 表格 ── */}
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title"><FileDoneOutlined style={{ color: '#722ed1' }} />盘点记录</span>
          <span style={{ fontSize: 12, color: 'var(--text-4)' }}>共 {total} 条</span>
        </div>
        <Table
          rowKey="id" columns={columns} dataSource={data} loading={loading} size="middle"
          scroll={{ x: 1000 }}
          pagination={{
            current: page, pageSize, total, showTotal: t => `共 ${t} 条`,
            onChange: p => setPage(p), showSizeChanger: false,
          }}
          locale={{ emptyText: <Empty description="暂无盘点记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
        />
      </div>

      {/* ── 新建盘点弹窗 ── */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #722ed1, #eb2f96)', color: '#fff', fontSize: 13,
            }}><PlusOutlined /></span>
            新建盘点单
          </div>
        }
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        okText="提交盘点"
        cancelText="取消"
        width={720}
        styles={{ body: { paddingTop: 20 } }}
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="check_date" label="盘点日期" rules={[{ required: true, message: '请选择日期' }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="check_note" label="备注">
                <Input.TextArea rows={1} maxLength={500} placeholder="可选备注" showCount />
              </Form.Item>
            </Col>
          </Row>
        </Form>

        <div style={{ marginTop: 8 }}>
          <div style={{
            fontSize: 14, fontWeight: 600, color: 'var(--text-1)', marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{
              width: 6, height: 18, borderRadius: 3,
              background: 'linear-gradient(180deg, #722ed1, #eb2f96)',
            }} />
            盘点明细
            <Tag style={{ borderRadius: 6, fontSize: 11 }}>{checkRows.length} 项</Tag>
          </div>

          {checkRows.length === 0 ? (
            <Empty description="暂无纸箱品种" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: 24 }} />
          ) : (
            <div style={{ maxHeight: 360, overflow: 'auto', borderRadius: 10, border: '1px solid var(--border-1)', padding: 2 }}>
              {checkRows.map((row, idx) => {
                const box = cartonBoxes.find(b => b.id === row.carton_box_id);
                const sysQty = Number(box?.stock_quantity ?? 0);
                const diff = row.actual_quantity - sysQty;
                return (
                  <div key={row.carton_box_id} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px',
                    borderBottom: idx < checkRows.length - 1 ? '1px solid var(--border-1)' : 'none',
                    transition: 'background 0.2s',
                    borderRadius: idx === 0 ? '10px 10px 0 0' : idx === checkRows.length - 1 ? '0 0 10px 10px' : 0,
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(114,46,209,0.02)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{
                      width: 30, height: 30, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: 'linear-gradient(135deg, rgba(114,46,209,0.1), rgba(114,46,209,0.03))',
                      color: '#722ed1', fontSize: 12, fontWeight: 700, flexShrink: 0,
                    }}>{idx + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{box?.box_type ?? `纸箱 #${row.carton_box_id}`}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-4)' }}>系统库存：{sysQty}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <InputNumber
                        min={0}
                        value={row.actual_quantity}
                        onChange={v => updateCheckRow(idx, Number(v) || 0)}
                        style={{ width: 100 }}
                        size="small"
                      />
                      {diff !== 0 ? (
                        <Tag
                          color={diff > 0 ? 'success' : 'error'}
                          icon={diff > 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                          style={{ borderRadius: 6, fontWeight: 700, minWidth: 55, textAlign: 'center', fontSize: 12 }}
                        >
                          {diff > 0 ? '+' : ''}{diff}
                        </Tag>
                      ) : (
                        <Tag style={{ borderRadius: 6, minWidth: 55, textAlign: 'center', fontSize: 12 }}>0</Tag>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>

      {/* ── 详情弹窗 ── */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #722ed1, #1677ff)', color: '#fff', fontSize: 13,
            }}><FileSearchOutlined /></span>
            盘点详情 #{detailData?.id}
          </div>
        }
        open={detailOpen}
        onCancel={() => { setDetailOpen(false); setDetailData(null); }}
        footer={
          detailData ? (
            <Space>
              <Button icon={<DownloadOutlined />} onClick={exportCSV}>导出 CSV</Button>
              {detailData.status === 'draft' && (
                <>
                  <Popconfirm title="确认此盘点单？" description="确认后将调整纸箱库存" onConfirm={() => handleConfirm(detailData.id)} okText="确认">
                    <Button type="primary" icon={<CheckCircleOutlined />} style={{ background: 'linear-gradient(135deg, #52c41a, #95de64)', border: 'none' }}>确认盘点</Button>
                  </Popconfirm>
                  <Popconfirm title="作废此盘点单？" onConfirm={() => handleCancel(detailData.id)}>
                    <Button icon={<CloseCircleOutlined />}>作废</Button>
                  </Popconfirm>
                </>
              )}
            </Space>
          ) : null
        }
        width={750}
        styles={{ body: { paddingTop: 16 } }}
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}><SyncOutlined spin style={{ fontSize: 24, color: 'var(--brand)' }} /></div>
        ) : detailData ? (
          <>
            <Descriptions
              bordered size="small" column={{ xs: 1, sm: 2 }}
              style={{ marginBottom: 16 }}
              labelStyle={{ background: 'rgba(114,46,209,0.03)', fontWeight: 600, fontSize: 13 }}
            >
              <Descriptions.Item label="盘点日期">{detailData.check_date}</Descriptions.Item>
              <Descriptions.Item label="盘点人">{detailData.check_user_name ?? '-'}</Descriptions.Item>
              <Descriptions.Item label="状态">
                {(() => {
                  const cfg = STATUS_CONFIG[detailData.status] || STATUS_CONFIG.draft;
                  return <Tag color={cfg.color} icon={cfg.icon} style={{ borderRadius: 6, fontWeight: 600 }}>{cfg.label}</Tag>;
                })()}
              </Descriptions.Item>
              <Descriptions.Item label="差异总计">
                {detailData.total_difference === 0 ? (
                  <Tag style={{ borderRadius: 6 }}>无差异</Tag>
                ) : (
                  <Tag
                    color={detailData.total_difference > 0 ? 'success' : 'error'}
                    style={{ borderRadius: 6, fontWeight: 700, fontSize: 14 }}
                  >
                    {detailData.total_difference > 0 ? '+' : ''}{detailData.total_difference}
                  </Tag>
                )}
              </Descriptions.Item>
              {detailData.check_note && (
                <Descriptions.Item label="备注" span={2}>{detailData.check_note}</Descriptions.Item>
              )}
            </Descriptions>

            <Table
              rowKey="id" columns={detailColumns} dataSource={detailData.details || []}
              size="small" pagination={false}
              locale={{ emptyText: '无明细' }}
              summary={pageData => {
                const totalSys = pageData.reduce((a, d) => a + Number(d.system_quantity ?? 0), 0);
                const totalActual = pageData.reduce((a, d) => a + Number(d.actual_quantity ?? 0), 0);
                const totalDiff = pageData.reduce((a, d) => a + Number(d.difference ?? 0), 0);
                return (
                  <Table.Summary fixed>
                    <Table.Summary.Row style={{ background: 'rgba(114,46,209,0.03)' }}>
                      <Table.Summary.Cell index={0}><span style={{ fontWeight: 700, color: 'var(--text-1)' }}>合计</span></Table.Summary.Cell>
                      <Table.Summary.Cell index={1} align="right"><span className="num" style={{ fontWeight: 700 }}>{totalSys.toLocaleString()}</span></Table.Summary.Cell>
                      <Table.Summary.Cell index={2} align="right"><span className="num" style={{ fontWeight: 700, color: 'var(--brand)' }}>{totalActual.toLocaleString()}</span></Table.Summary.Cell>
                      <Table.Summary.Cell index={3} align="right">
                        <Tag
                          color={totalDiff === 0 ? undefined : totalDiff > 0 ? 'success' : 'error'}
                          style={{ borderRadius: 6, fontWeight: 700, fontSize: 13 }}
                        >
                          {totalDiff > 0 ? '+' : ''}{totalDiff}
                        </Tag>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  </Table.Summary>
                );
              }}
            />
          </>
        ) : null}
      </Modal>
    </div>
  );
}
