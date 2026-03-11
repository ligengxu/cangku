'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, Tag, Space, message,
  Row, Col, Tooltip, Badge, Empty, Avatar,
} from 'antd';
import {
  BugOutlined, PlusOutlined, CheckCircleOutlined, ClockCircleOutlined,
  ToolOutlined, CloseCircleOutlined, ReloadOutlined, DeleteOutlined,
  ExclamationCircleOutlined, FireOutlined, EditOutlined, SendOutlined,
  StopOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import { useAuth } from '@/stores/useAuth';
import dayjs from 'dayjs';

const STATUS_MAP: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  open: { label: '待处理', color: 'warning', icon: <ClockCircleOutlined /> },
  fixing: { label: '修复中', color: 'processing', icon: <ToolOutlined /> },
  fixed: { label: '已修复', color: 'success', icon: <CheckCircleOutlined /> },
  closed: { label: '已关闭', color: 'default', icon: <CloseCircleOutlined /> },
  wontfix: { label: '不修复', color: 'default', icon: <StopOutlined /> },
};

const PRIORITY_MAP: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  low: { label: '低', color: '#8c8c8c', icon: <span /> },
  medium: { label: '中', color: '#1677ff', icon: <ExclamationCircleOutlined /> },
  high: { label: '高', color: '#fa8c16', icon: <ExclamationCircleOutlined /> },
  critical: { label: '紧急', color: '#ff4d4f', icon: <FireOutlined /> },
};

export default function BugsPage() {
  const user = useAuth(s => s.user);
  const isAdmin = user?.role === 'admin';
  const [data, setData] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [form] = Form.useForm();
  const [fixOpen, setFixOpen] = useState(false);
  const [fixTarget, setFixTarget] = useState<any>(null);
  const [fixForm] = Form.useForm();
  const [fixLoading, setFixLoading] = useState(false);
  const [refreshSpin, setRefreshSpin] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, page_size: 20 };
      if (statusFilter) params.status = statusFilter;
      if (!isAdmin) params.mine = true;
      const res = await api.get('/bugs', { params });
      setData(res.data?.data?.items || []);
      setTotal(res.data?.data?.total || 0);
    } catch { message.error('加载失败'); }
    finally { setLoading(false); }
  }, [page, statusFilter, isAdmin]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get('/bugs/stats');
      setStats(res.data?.data || null);
    } catch {}
  }, []);

  useEffect(() => { fetchData(); fetchStats(); }, [fetchData, fetchStats]);

  const handleSubmit = async () => {
    try {
      const v = await form.validateFields();
      setSubmitLoading(true);
      await api.post('/bugs', v);
      message.success('BUG已提交，感谢反馈！');
      setSubmitOpen(false);
      form.resetFields();
      fetchData(); fetchStats();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.response?.data?.detail || '提交失败');
    } finally { setSubmitLoading(false); }
  };

  const handleFix = async () => {
    if (!fixTarget) return;
    try {
      const v = await fixForm.validateFields();
      setFixLoading(true);
      await api.put(`/bugs/${fixTarget.id}`, v);
      message.success('状态已更新');
      setFixOpen(false);
      fixForm.resetFields();
      fetchData(); fetchStats();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.response?.data?.detail || '操作失败');
    } finally { setFixLoading(false); }
  };

  const handleDelete = (id: number) => {
    Modal.confirm({
      title: '确定删除这条BUG记录？',
      okText: '删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.delete(`/bugs/${id}`);
          message.success('已删除');
          fetchData(); fetchStats();
        } catch { message.error('删除失败'); }
      },
    });
  };

  const openFixModal = (record: any) => {
    setFixTarget(record);
    fixForm.setFieldsValue({
      status: record.status === 'open' ? 'fixed' : record.status,
      fix_note: record.fix_note || '',
      priority: record.priority,
    });
    setFixOpen(true);
  };

  const statCards = [
    { label: '待处理', value: stats?.open ?? 0, icon: <ClockCircleOutlined />, gradient: 'linear-gradient(135deg, #fa8c16, #ffc53d)', glow: 'rgba(250,140,22,0.15)' },
    { label: '修复中', value: stats?.fixing ?? 0, icon: <ToolOutlined />, gradient: 'linear-gradient(135deg, #1677ff, #69b1ff)', glow: 'rgba(22,119,255,0.15)' },
    { label: '已修复', value: stats?.fixed ?? 0, icon: <CheckCircleOutlined />, gradient: 'linear-gradient(135deg, #00b96b, #5cdbd3)', glow: 'rgba(0,185,107,0.15)' },
    { label: '总计', value: stats?.total ?? 0, icon: <BugOutlined />, gradient: 'linear-gradient(135deg, #722ed1, #b37feb)', glow: 'rgba(114,46,209,0.15)' },
  ];

  const columns: any[] = [
    {
      title: 'ID', dataIndex: 'id', width: 60,
      render: (v: number) => <span className="num" style={{ color: 'var(--text-4)', fontSize: 12 }}>#{v}</span>,
    },
    {
      title: '优先级', dataIndex: 'priority', width: 80, align: 'center' as const,
      render: (v: string) => {
        const p = PRIORITY_MAP[v] || PRIORITY_MAP.medium;
        return <Tag style={{ borderRadius: 6, fontWeight: 700, fontSize: 11, color: p.color, background: `${p.color}10`, border: `1px solid ${p.color}20` }}>{p.icon} {p.label}</Tag>;
      },
    },
    {
      title: '标题', dataIndex: 'title', ellipsis: true,
      render: (v: string, r: any) => (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--text-1)' }}>{v}</div>
          {r.page_url && <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 2 }}>{r.page_url}</div>}
        </div>
      ),
    },
    {
      title: '提交人', dataIndex: 'submitted_name', width: 100,
      render: (v: string) => (
        <Space size={6}>
          <Avatar size={22} style={{ background: `hsl(${(v || '').charCodeAt(0) * 47 % 360},55%,55%)`, fontSize: 10 }}>{(v || '?')[0]}</Avatar>
          <span style={{ fontSize: 12 }}>{v}</span>
        </Space>
      ),
    },
    {
      title: '状态', dataIndex: 'status', width: 100, align: 'center' as const,
      render: (v: string) => {
        const s = STATUS_MAP[v] || STATUS_MAP.open;
        return <Tag color={s.color} icon={s.icon} style={{ borderRadius: 6, fontWeight: 600, fontSize: 12 }}>{s.label}</Tag>;
      },
    },
    {
      title: '提交时间', dataIndex: 'created_at', width: 140,
      render: (v: string) => v ? <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{dayjs(v).format('MM-DD HH:mm')}</span> : '-',
    },
    ...(isAdmin ? [{
      title: '修复信息', key: 'fix_info', width: 160,
      render: (_: any, r: any) => r.fixed_name ? (
        <div style={{ fontSize: 12 }}>
          <div style={{ color: '#00b96b', fontWeight: 600 }}>{r.fixed_name}</div>
          {r.fixed_at && <div style={{ color: 'var(--text-4)', fontSize: 11 }}>{dayjs(r.fixed_at).format('MM-DD HH:mm')}</div>}
          {r.fix_note && <Tooltip title={r.fix_note}><div style={{ color: 'var(--text-3)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>{r.fix_note}</div></Tooltip>}
        </div>
      ) : <span style={{ color: 'var(--text-4)', fontSize: 12 }}>-</span>,
    }] : []),
    ...(isAdmin ? [{
      title: '操作', key: 'actions', width: 120, fixed: 'right' as const, align: 'center' as const,
      render: (_: any, r: any) => (
        <Space size={4}>
          <Tooltip title="处理">
            <Button type="primary" size="small" icon={<EditOutlined />}
              onClick={() => openFixModal(r)}
              style={{ borderRadius: 6, fontSize: 12 }} />
          </Tooltip>
          <Tooltip title="删除">
            <Button type="text" size="small" danger icon={<DeleteOutlined />}
              onClick={() => handleDelete(r.id)}
              style={{ borderRadius: 6 }} />
          </Tooltip>
        </Space>
      ),
    }] : []),
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22,
        padding: '20px 24px', borderRadius: 'var(--radius-l, 16px)',
        background: 'linear-gradient(135deg, rgba(114,46,209,0.05), rgba(255,77,79,0.03))',
        border: '1px solid rgba(114,46,209,0.06)',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 32, height: 32, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #722ed1, #ff4d4f)', color: '#fff', fontSize: 15,
              boxShadow: '0 3px 10px rgba(114,46,209,0.2)',
            }}><BugOutlined /></span>
            BUG反馈
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 42 }}>
            {isAdmin ? '管理所有BUG反馈 · 标记修复状态' : '提交BUG · 追踪修复进度'}
          </div>
        </div>
        <Space size={8}>
          <Tooltip title="刷新">
            <Button icon={<ReloadOutlined spin={refreshSpin} />}
              onClick={() => { setRefreshSpin(true); Promise.all([fetchData(), fetchStats()]).finally(() => setTimeout(() => setRefreshSpin(false), 400)); }}
              style={{ borderRadius: 10, height: 38 }} />
          </Tooltip>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); setSubmitOpen(true); }}
            style={{
              height: 38, borderRadius: 10, fontWeight: 600, paddingInline: 20,
              background: 'linear-gradient(135deg, #722ed1, #ff4d4f)', border: 'none',
              boxShadow: '0 3px 12px rgba(114,46,209,0.2)',
            }}>
            提交BUG
          </Button>
        </Space>
      </div>

      {/* Stats */}
      <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
        {statCards.map((s, i) => (
          <Col xs={12} sm={6} key={i}>
            <div style={{
              padding: '14px 16px', borderRadius: 'var(--radius-m, 12px)', background: s.gradient,
              position: 'relative', overflow: 'hidden',
              boxShadow: `0 4px 14px ${s.glow}`, transition: 'all 0.3s',
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
            >
              <div style={{ position: 'absolute', top: -12, right: -12, width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>{s.icon} {s.label}</div>
              <div className="num" style={{ fontSize: 22, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>{s.value}</div>
            </div>
          </Col>
        ))}
      </Row>

      {/* Filter + Table */}
      <div className="panel">
        <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { key: '', label: '全部', count: stats?.total },
            { key: 'open', label: '待处理', count: stats?.open },
            { key: 'fixing', label: '修复中', count: stats?.fixing },
            { key: 'fixed', label: '已修复', count: stats?.fixed },
            { key: 'closed', label: '已关闭', count: stats?.closed },
          ].map(f => {
            const gradients: Record<string, string> = {
              '': 'linear-gradient(135deg, #722ed1, #b37feb)',
              open: 'linear-gradient(135deg, #fa8c16, #ffc53d)',
              fixing: 'linear-gradient(135deg, #1677ff, #69b1ff)',
              fixed: 'linear-gradient(135deg, #00b96b, #5cdbd3)',
              closed: 'linear-gradient(135deg, #8c8c8c, #bfbfbf)',
            };
            return (
              <div key={f.key} onClick={() => { setStatusFilter(f.key); setPage(1); }}
                style={{
                  padding: '5px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500,
                  background: statusFilter === f.key ? (gradients[f.key] || gradients['']) : 'rgba(0,0,0,0.04)',
                  color: statusFilter === f.key ? '#fff' : 'var(--text-3)',
                  cursor: 'pointer', transition: 'all 0.2s',
                }}>
                {f.label}
                {f.count != null && f.count > 0 && statusFilter === f.key && <span style={{ marginLeft: 4, fontSize: 11 }}>({f.count})</span>}
              </div>
            );
          })}
        </div>

        <Table
          rowKey="id" columns={columns} dataSource={data} loading={loading} size="middle"
          pagination={{
            current: page, pageSize: 20, total,
            showTotal: t => `共 ${t} 条`,
            onChange: p => setPage(p),
          }}
          scroll={{ x: 800 }}
          locale={{ emptyText: <Empty description={isAdmin ? '暂无BUG反馈' : '暂无提交记录，点击右上角提交BUG'} /> }}
          expandable={{
            expandedRowRender: (r: any) => (
              <div style={{ padding: '8px 0', fontSize: 13, lineHeight: 1.8, color: 'var(--text-2)' }}>
                <div style={{ whiteSpace: 'pre-wrap' }}>{r.description}</div>
                {r.fix_note && (
                  <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'rgba(0,185,107,0.04)', border: '1px solid rgba(0,185,107,0.1)' }}>
                    <div style={{ fontSize: 11, color: '#00b96b', fontWeight: 600, marginBottom: 4 }}>修复说明</div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{r.fix_note}</div>
                  </div>
                )}
              </div>
            ),
          }}
        />
      </div>

      {/* Submit Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #722ed1, #ff4d4f)', color: '#fff', fontSize: 13,
            }}><BugOutlined /></span>
            提交BUG
          </div>
        }
        open={submitOpen} onCancel={() => setSubmitOpen(false)}
        onOk={handleSubmit} okText="提交" cancelText="取消"
        confirmLoading={submitLoading} width={560} destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="title" label="BUG标题" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="简要描述BUG" maxLength={200} showCount />
          </Form.Item>
          <Form.Item name="description" label="详细描述" rules={[{ required: true, message: '请描述BUG详情' }]}>
            <Input.TextArea placeholder="描述BUG的具体表现、复现步骤、期望行为等" rows={5} maxLength={5000} showCount />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="page_url" label="发生页面">
                <Input placeholder="如：/production/audit" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="priority" label="优先级" initialValue="medium">
                <Select options={[
                  { value: 'low', label: '低 - 不影响使用' },
                  { value: 'medium', label: '中 - 有影响但可绕过' },
                  { value: 'high', label: '高 - 严重影响使用' },
                  { value: 'critical', label: '紧急 - 系统无法使用' },
                ]} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* Fix Modal (Admin) */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #00b96b, #5cdbd3)', color: '#fff', fontSize: 13,
            }}><ToolOutlined /></span>
            处理BUG #{fixTarget?.id}
          </div>
        }
        open={fixOpen} onCancel={() => setFixOpen(false)}
        onOk={handleFix} okText="保存" cancelText="取消"
        confirmLoading={fixLoading} width={500} destroyOnClose
      >
        {fixTarget && (
          <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 10, background: 'rgba(114,46,209,0.04)', border: '1px solid rgba(114,46,209,0.08)' }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{fixTarget.title}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>提交人: {fixTarget.submitted_name} · {fixTarget.created_at ? dayjs(fixTarget.created_at).format('YYYY-MM-DD HH:mm') : ''}</div>
          </div>
        )}
        <Form form={fixForm} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="status" label="状态" rules={[{ required: true }]}>
                <Select options={[
                  { value: 'open', label: '待处理' },
                  { value: 'fixing', label: '修复中' },
                  { value: 'fixed', label: '已修复' },
                  { value: 'closed', label: '已关闭' },
                  { value: 'wontfix', label: '不修复' },
                ]} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="priority" label="优先级">
                <Select options={[
                  { value: 'low', label: '低' },
                  { value: 'medium', label: '中' },
                  { value: 'high', label: '高' },
                  { value: 'critical', label: '紧急' },
                ]} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="fix_note" label="修复说明">
            <Input.TextArea placeholder="描述修复内容或不修复原因" rows={3} maxLength={2000} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
