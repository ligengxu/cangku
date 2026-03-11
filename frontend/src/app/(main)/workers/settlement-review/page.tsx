'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  DatePicker, Button, Table, Tag, Tooltip, Row, Col, Space, Spin, message,
  InputNumber, Input, Modal, Card, Statistic, Popconfirm, Alert,
} from 'antd';
import {
  DollarOutlined, ReloadOutlined, CheckCircleOutlined, SendOutlined,
  DeleteOutlined, FileTextOutlined, TeamOutlined, ExclamationCircleOutlined,
  EditOutlined, ClockCircleOutlined, CloseCircleOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dayjs from 'dayjs';

const GRADIENT_CARDS = [
  { bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', glow: 'rgba(102,126,234,0.2)' },
  { bg: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', glow: 'rgba(245,87,108,0.2)' },
  { bg: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', glow: 'rgba(79,172,254,0.2)' },
  { bg: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', glow: 'rgba(67,233,123,0.2)' },
];

const STATUS_MAP: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft: { label: '草稿', color: 'default', icon: <EditOutlined /> },
  submitted: { label: '已提交', color: 'processing', icon: <SendOutlined /> },
  finance_approved: { label: '财务审核通过', color: 'success', icon: <CheckCircleOutlined /> },
  finance_rejected: { label: '财务驳回', color: 'error', icon: <CloseCircleOutlined /> },
  paid: { label: '已付款', color: 'green', icon: <DollarOutlined /> },
};

interface SettlementItem {
  id: number;
  worker_id: number;
  worker_name: string;
  phone: string;
  alipay_account: string;
  settlement_month: string;
  system_amount: number;
  adjusted_amount: number;
  adjustment_reason: string | null;
  status: string;
  submitted_at: string | null;
  paid_at: string | null;
  finance_payment_id: number | null;
  created_at: string | null;
}

interface SummaryData {
  total: number;
  total_system_amount: number;
  total_adjusted_amount: number;
  by_status: Record<string, { count: number; amount: number }>;
  available_months: string[];
}

export default function SettlementReviewPage() {
  const [month, setMonth] = useState(dayjs().subtract(1, 'month').format('YYYY-MM'));
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SettlementItem[]>([]);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [total, setTotal] = useState(0);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState<number>(0);
  const [editReason, setEditReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [generating, setGenerating] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, summaryRes] = await Promise.all([
        api.get('/worker-settlements', { params: { month, page: 1, page_size: 200 } }),
        api.get('/worker-settlements/summary', { params: { month } }),
      ]);
      setData(listRes.data?.data || []);
      setTotal(listRes.data?.total || 0);
      setSummary(summaryRes.data?.data || null);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await api.post(`/worker-settlements/generate?month=${month}`);
      message.success(res.data?.message || '生成成功');
      fetchData();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const handleDeleteMonth = async () => {
    try {
      const res = await api.delete(`/worker-settlements/batch/${month}`);
      message.success(res.data?.message || '删除成功');
      fetchData();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '删除失败');
    }
  };

  const startEdit = (record: SettlementItem) => {
    setEditingId(record.id);
    setEditAmount(record.adjusted_amount);
    setEditReason(record.adjustment_reason || '');
  };

  const saveEdit = async () => {
    if (editingId === null) return;
    try {
      await api.put(`/worker-settlements/${editingId}`, {
        adjusted_amount: editAmount,
        adjustment_reason: editReason || null,
      });
      message.success('修改成功');
      setEditingId(null);
      fetchData();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '修改失败');
    }
  };

  const handleSubmit = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请选择要提交的结算记录');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post('/worker-settlements/submit', { settlement_ids: selectedRowKeys });
      message.success(res.data?.message || '提交成功');
      setSelectedRowKeys([]);
      fetchData();
    } catch (err: any) {
      message.error(err?.response?.data?.detail || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const draftItems = data.filter(d => d.status === 'draft' || d.status === 'finance_rejected');
  const canSubmit = selectedRowKeys.length > 0 && selectedRowKeys.every(id => {
    const item = data.find(d => d.id === id);
    return item && (item.status === 'draft' || item.status === 'finance_rejected');
  });

  const columns = [
    {
      title: '工人',
      key: 'worker',
      width: 140,
      render: (_: any, r: SettlementItem) => (
        <div>
          <div style={{ fontWeight: 600 }}>{r.worker_name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{r.phone}</div>
        </div>
      ),
    },
    {
      title: '支付宝',
      dataIndex: 'alipay_account',
      width: 140,
      render: (v: string) => v || <span style={{ color: 'var(--text-4)' }}>未设置</span>,
    },
    {
      title: '系统金额',
      dataIndex: 'system_amount',
      width: 110,
      align: 'right' as const,
      render: (v: number) => <span style={{ color: 'var(--text-3)' }}>¥{v.toFixed(2)}</span>,
    },
    {
      title: '核算金额',
      dataIndex: 'adjusted_amount',
      width: 130,
      align: 'right' as const,
      render: (v: number, r: SettlementItem) => {
        if (editingId === r.id) {
          return (
            <Space size={4}>
              <InputNumber
                value={editAmount}
                onChange={v => setEditAmount(v || 0)}
                min={0}
                step={0.01}
                style={{ width: 100 }}
                size="small"
              />
            </Space>
          );
        }
        const diff = v - r.system_amount;
        return (
          <Space size={4}>
            <span style={{ fontWeight: 700, color: 'var(--brand)', fontSize: 15 }}>¥{v.toFixed(2)}</span>
            {diff !== 0 && (
              <Tag color={diff > 0 ? 'green' : 'red'} style={{ fontSize: 11 }}>
                {diff > 0 ? '+' : ''}{diff.toFixed(2)}
              </Tag>
            )}
          </Space>
        );
      },
    },
    {
      title: '调整原因',
      dataIndex: 'adjustment_reason',
      width: 150,
      ellipsis: true,
      render: (v: string | null, r: SettlementItem) => {
        if (editingId === r.id) {
          return (
            <Input
              value={editReason}
              onChange={e => setEditReason(e.target.value)}
              placeholder="调整原因"
              size="small"
              style={{ width: 130 }}
            />
          );
        }
        return v || '-';
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 130,
      render: (s: string) => {
        const info = STATUS_MAP[s] || { label: s, color: 'default', icon: null };
        return <Tag icon={info.icon} color={info.color}>{info.label}</Tag>;
      },
    },
    {
      title: '提交时间',
      dataIndex: 'submitted_at',
      width: 130,
      render: (v: string | null) => v ? dayjs(v).format('MM-DD HH:mm') : '-',
    },
    {
      title: '付款时间',
      dataIndex: 'paid_at',
      width: 130,
      render: (v: string | null) => v ? dayjs(v).format('MM-DD HH:mm') : '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_: any, r: SettlementItem) => {
        if (editingId === r.id) {
          return (
            <Space size={4}>
              <Button size="small" type="primary" onClick={saveEdit}>保存</Button>
              <Button size="small" onClick={() => setEditingId(null)}>取消</Button>
            </Space>
          );
        }
        if (r.status === 'draft' || r.status === 'finance_rejected') {
          return (
            <Button size="small" icon={<EditOutlined />} onClick={() => startEdit(r)}>
              核算
            </Button>
          );
        }
        return null;
      },
    },
  ];

  const byStatus = summary?.by_status || {};

  return (
    <div style={{ padding: '0 2px' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        borderRadius: 'var(--radius-xl)',
        padding: '28px 32px',
        marginBottom: 24,
        color: '#fff',
      }}>
        <Row align="middle" justify="space-between">
          <Col>
            <h2 style={{ margin: 0, color: '#fff', fontSize: 22, fontWeight: 700 }}>
              <ClockCircleOutlined style={{ marginRight: 10 }} />
              工人绩效核算
            </h2>
            <p style={{ margin: '6px 0 0', opacity: 0.85, fontSize: 14 }}>
              每月15号结算上月工人绩效 · 库管核算后提交财务系统审核付款
            </p>
          </Col>
          <Col>
            <Space>
              <DatePicker
                picker="month"
                value={dayjs(month, 'YYYY-MM')}
                onChange={v => v && setMonth(v.format('YYYY-MM'))}
                allowClear={false}
                style={{ background: 'rgba(255,255,255,0.2)', borderColor: 'rgba(255,255,255,0.3)' }}
              />
              <Button icon={<ReloadOutlined />} onClick={fetchData} style={{ background: 'rgba(255,255,255,0.2)', borderColor: 'rgba(255,255,255,0.3)', color: '#fff' }}>
                刷新
              </Button>
            </Space>
          </Col>
        </Row>
      </div>

      {/* Summary Cards */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        {[
          { title: '总人数', value: summary?.total || 0, icon: <TeamOutlined />, idx: 0 },
          { title: '系统总额', value: summary?.total_system_amount || 0, prefix: '¥', icon: <FileTextOutlined />, idx: 1 },
          { title: '核算总额', value: summary?.total_adjusted_amount || 0, prefix: '¥', icon: <DollarOutlined />, idx: 2 },
          { title: '已付款', value: byStatus.paid?.amount || 0, prefix: '¥', icon: <CheckCircleOutlined />, idx: 3 },
        ].map(item => (
          <Col xs={12} sm={6} key={item.title}>
            <div style={{
              background: GRADIENT_CARDS[item.idx].bg,
              borderRadius: 'var(--radius-lg)',
              padding: '20px 24px',
              color: '#fff',
              boxShadow: `0 8px 24px ${GRADIENT_CARDS[item.idx].glow}`,
            }}>
              <div style={{ opacity: 0.85, fontSize: 13, marginBottom: 8 }}>
                {item.icon} {item.title}
              </div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>
                {item.prefix}{typeof item.value === 'number' ? item.value.toLocaleString('zh-CN', { minimumFractionDigits: item.prefix ? 2 : 0 }) : item.value}
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* Status Summary */}
      {summary && Object.keys(byStatus).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Space wrap>
            {Object.entries(byStatus).map(([status, info]) => {
              const s = STATUS_MAP[status];
              return (
                <Tag key={status} icon={s?.icon} color={s?.color || 'default'} style={{ padding: '4px 12px', fontSize: 13 }}>
                  {s?.label || status}: {info.count}条 ¥{info.amount.toFixed(2)}
                </Tag>
              );
            })}
          </Space>
        </div>
      )}

      {/* Actions */}
      <div className="panel" style={{ padding: '16px 20px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <Space wrap>
          {data.length === 0 && (
            <Button
              type="primary"
              icon={<FileTextOutlined />}
              onClick={handleGenerate}
              loading={generating}
              style={{ background: 'var(--gradient-brand)', border: 'none' }}
            >
              生成 {month} 结算单
            </Button>
          )}
          {draftItems.length > 0 && (
            <>
              <Popconfirm
                title={`确定提交选中的 ${selectedRowKeys.length} 条结算记录到财务系统？`}
                description="提交后将推送至财务系统等待审核付款"
                onConfirm={handleSubmit}
                okText="确定提交"
                cancelText="取消"
                disabled={!canSubmit}
              >
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  disabled={!canSubmit}
                  loading={submitting}
                  style={canSubmit ? { background: 'var(--gradient-brand)', border: 'none' } : {}}
                >
                  提交财务系统 ({selectedRowKeys.length})
                </Button>
              </Popconfirm>
            </>
          )}
          {data.length > 0 && data.every(d => d.status === 'draft') && (
            <Popconfirm
              title={`确定删除 ${month} 的所有草稿结算单？`}
              description="删除后可重新生成"
              onConfirm={handleDeleteMonth}
              okText="确定删除"
              cancelText="取消"
            >
              <Button icon={<DeleteOutlined />} danger>
                删除本月草稿
              </Button>
            </Popconfirm>
          )}
        </Space>
        <div style={{ color: 'var(--text-3)', fontSize: 13 }}>
          {draftItems.length > 0 && `${draftItems.length} 条待核算`}
          {selectedRowKeys.length > 0 && ` · 已选 ${selectedRowKeys.length} 条`}
        </div>
      </div>

      {/* Info Alert */}
      {data.length > 0 && data.some(d => d.status === 'draft') && (
        <Alert
          type="info"
          showIcon
          icon={<ExclamationCircleOutlined />}
          message="核算说明"
          description="系统金额仅供参考（基于扫码出库数据自动计算），库管需逐个核对并调整实际金额后再提交财务系统。点击「核算」按钮可修改金额。"
          style={{ marginBottom: 16, borderRadius: 'var(--radius-lg)' }}
        />
      )}

      {/* Table */}
      <div className="panel" style={{ padding: 0, overflow: 'hidden', borderRadius: 'var(--radius-lg)' }}>
        <Spin spinning={loading}>
          <Table
            dataSource={data}
            columns={columns}
            rowKey="id"
            pagination={false}
            scroll={{ x: 1100 }}
            size="middle"
            rowSelection={draftItems.length > 0 ? {
              selectedRowKeys,
              onChange: keys => setSelectedRowKeys(keys as number[]),
              getCheckboxProps: (record: SettlementItem) => ({
                disabled: record.status !== 'draft' && record.status !== 'finance_rejected',
              }),
            } : undefined}
            locale={{ emptyText: (
              <div style={{ padding: 40, textAlign: 'center' }}>
                <FileTextOutlined style={{ fontSize: 48, color: 'var(--text-4)', marginBottom: 16 }} />
                <div style={{ color: 'var(--text-3)', marginBottom: 16 }}>
                  {month} 暂无结算记录
                </div>
                <Button type="primary" icon={<FileTextOutlined />} onClick={handleGenerate} loading={generating}
                  style={{ background: 'var(--gradient-brand)', border: 'none' }}>
                  生成结算单
                </Button>
              </div>
            )}}
          />
        </Spin>
      </div>
    </div>
  );
}
