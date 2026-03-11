'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Table, Form, Input, Select, Button, Space, message, Spin, Popconfirm, Modal, Tag, Row, Col,
  Tooltip, Switch, Empty, Badge, Segmented, Card,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, BellOutlined, CheckCircleOutlined, CloseCircleOutlined,
  InfoCircleOutlined, WarningOutlined, ClockCircleOutlined, ReloadOutlined,
  EyeOutlined, FilterOutlined, UserOutlined, ThunderboltOutlined,
  TeamOutlined, FieldTimeOutlined, EditOutlined, PauseCircleOutlined,
  PlayCircleOutlined, NotificationOutlined, DownloadOutlined, RobotOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import { useAuth } from '@/stores/useAuth';
import type { Notice } from '@/types';
import { exportToCsv } from '@/utils/exportCsv';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const TYPE_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string; gradient: string }> = {
  info: { color: '#1677ff', icon: <InfoCircleOutlined />, label: '信息', gradient: 'linear-gradient(135deg, #1677ff, #69b1ff)' },
  warning: { color: '#fa8c16', icon: <WarningOutlined />, label: '警告', gradient: 'linear-gradient(135deg, #fa8c16, #ffc53d)' },
  urgent: { color: '#ff4d4f', icon: <ThunderboltOutlined />, label: '紧急', gradient: 'linear-gradient(135deg, #ff4d4f, #ff7875)' },
  error: { color: '#ff4d4f', icon: <CloseCircleOutlined />, label: '错误', gradient: 'linear-gradient(135deg, #cf1322, #ff4d4f)' },
};

const ROLE_CONFIG: Record<string, { label: string; color: string }> = {
  all: { label: '全员', color: '#722ed1' },
  admin: { label: '管理员', color: '#1677ff' },
  worker: { label: '工人', color: '#00b96b' },
};

interface NoticeStats {
  total: number;
  active: number;
  inactive: number;
  expired: number;
  by_type: Record<string, number>;
}

export default function NoticesPage() {
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Notice[]>([]);
  const [stats, setStats] = useState<NoticeStats | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [previewNotice, setPreviewNotice] = useState<Notice | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [viewMode, setViewMode] = useState<string>('cards');
  const [filterType, setFilterType] = useState<string | undefined>(undefined);
  const [filterRole, setFilterRole] = useState<string | undefined>(undefined);
  const [showAll, setShowAll] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [noticesRes, statsRes] = await Promise.all([
        api.get('/system/notices', { params: { show_all: showAll, notice_type: filterType, target_role: filterRole, page_size: 100 } }),
        api.get('/system/notices/stats').catch(() => ({ data: null })),
      ]);
      setData(Array.isArray(noticesRes.data?.data ?? noticesRes.data) ? (noticesRes.data?.data ?? noticesRes.data) : []);
      if (statsRes.data?.data) setStats(statsRes.data.data);
    } catch { message.error('加载数据失败'); setData([]); }
    finally { setLoading(false); }
  }, [showAll, filterType, filterRole]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = () => { setRefreshSpin(true); fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600)); };

  const handleCreate = async (values: any) => {
    try {
      setSubmitting(true);
      await api.post('/system/notices', values);
      message.success('创建成功'); setModalOpen(false); form.resetFields(); fetchData();
    } catch (e: any) { message.error(e?.response?.data?.message ?? '创建失败'); }
    finally { setSubmitting(false); }
  };

  const handleToggle = async (id: number) => {
    try {
      await api.put(`/system/notices/${id}/toggle`);
      message.success('状态已更新'); fetchData();
    } catch { message.error('操作失败'); }
  };

  const handleDelete = async (id: number) => {
    try { await api.delete(`/system/notices/${id}`); message.success('删除成功'); fetchData(); }
    catch { message.error('删除失败'); }
  };

  if (!isAdmin()) {
    return <div className="panel" style={{ padding: 40, textAlign: 'center' }}><span style={{ color: 'var(--text-3)' }}>无权限访问</span></div>;
  }

  const STAT_CARDS = [
    { label: '全部通知', value: stats?.total ?? data.length, icon: <BellOutlined />, gradient: 'linear-gradient(135deg, #eb2f96 0%, #ff85c0 100%)', glow: 'rgba(235,47,150,0.18)' },
    { label: '当前有效', value: stats?.active ?? 0, icon: <CheckCircleOutlined />, gradient: 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: 'rgba(0,185,107,0.18)' },
    { label: '已过期', value: stats?.expired ?? 0, icon: <ClockCircleOutlined />, gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.18)' },
    { label: '已停用', value: stats?.inactive ?? 0, icon: <PauseCircleOutlined />, gradient: 'linear-gradient(135deg, #8c8c8c 0%, #bfbfbf 100%)', glow: 'rgba(140,140,140,0.18)' },
  ];

  const columns: any[] = [
    {
      title: '通知', key: 'notice', ellipsis: true,
      render: (_: unknown, r: Notice) => {
        const cfg = TYPE_CONFIG[r.type || 'info'] || TYPE_CONFIG.info;
        return (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={{
              width: 30, height: 30, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: cfg.gradient, color: '#fff', fontSize: 13, flexShrink: 0, marginTop: 2,
            }}>{cfg.icon}</span>
            <div style={{ minWidth: 0 }}>
              {r.title && <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-1)', marginBottom: 2 }}>{r.title}</div>}
              <div style={{ fontSize: 13, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.content}</div>
            </div>
          </div>
        );
      },
    },
    {
      title: '类型', dataIndex: 'type', width: 90, filters: Object.entries(TYPE_CONFIG).map(([k, v]) => ({ text: v.label, value: k })),
      onFilter: (v: string, r: Notice) => (r.type || 'info') === v,
      render: (v: string) => {
        const cfg = TYPE_CONFIG[v || 'info'] || TYPE_CONFIG.info;
        return <Tag color={cfg.color} icon={cfg.icon} style={{ borderRadius: 12, fontWeight: 600, fontSize: 11 }}>{cfg.label}</Tag>;
      },
    },
    {
      title: '目标', dataIndex: 'target_role', width: 90,
      render: (v: string) => {
        const rc = ROLE_CONFIG[v || 'all'] || ROLE_CONFIG.all;
        return <Tag color={rc.color} style={{ borderRadius: 12, fontSize: 11 }}>{rc.label}</Tag>;
      },
    },
    {
      title: '状态', key: 'status', width: 100, align: 'center' as const,
      render: (_: unknown, r: Notice) => {
        const expired = r.is_expired || (r.expires_at && dayjs(r.expires_at).isBefore(dayjs()));
        if (!r.is_active) return <Tag color="default" icon={<PauseCircleOutlined />} style={{ borderRadius: 12 }}>已停用</Tag>;
        if (expired) return <Tag color="orange" icon={<ClockCircleOutlined />} style={{ borderRadius: 12 }}>已过期</Tag>;
        return <Tag color="success" icon={<CheckCircleOutlined />} style={{ borderRadius: 12 }}>有效</Tag>;
      },
    },
    {
      title: '创建', key: 'meta', width: 130,
      render: (_: unknown, r: Notice) => (
        <div style={{ fontSize: 12 }}>
          <div style={{ color: 'var(--text-2)' }}>{r.creator_name ?? '系统'}</div>
          <div style={{ color: 'var(--text-4)', fontSize: 11 }}>{r.created_at ? dayjs(r.created_at).fromNow() : '-'}</div>
        </div>
      ),
    },
    {
      title: '操作', key: 'action', width: 120, align: 'center' as const, fixed: 'right' as const,
      render: (_: unknown, r: Notice) => (
        <Space size={2}>
          <Tooltip title="预览"><Button type="text" size="small" icon={<EyeOutlined />} onClick={() => setPreviewNotice(r)} style={{ color: '#1677ff', borderRadius: 6 }} /></Tooltip>
          <Tooltip title={r.is_active ? '停用' : '启用'}>
            <Button type="text" size="small" icon={r.is_active ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
              onClick={() => handleToggle(r.id)} style={{ color: r.is_active ? '#fa8c16' : '#52c41a', borderRadius: 6 }} />
          </Tooltip>
          <Popconfirm title="确定删除此通知？" onConfirm={() => handleDelete(r.id)} okButtonProps={{ danger: true }}>
            <Tooltip title="删除"><Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ borderRadius: 6 }} /></Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const handleExport = () => {
    if (!data.length) return;
    exportToCsv(data, [
      { key: 'id', title: 'ID' },
      { key: 'title', title: '标题', render: v => String(v || '') },
      { key: 'content', title: '内容' },
      { key: 'type', title: '类型' },
      { key: 'target_role', title: '目标' },
      { key: 'is_active', title: '状态', render: v => v ? '有效' : '停用' },
      { key: 'creator_name', title: '创建者', render: v => String(v || '系统') },
      { key: 'created_at', title: '创建时间', render: v => v ? dayjs(v as string).format('YYYY-MM-DD HH:mm') : '-' },
    ], '通知列表');
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20,
        padding: '20px 24px', borderRadius: 'var(--radius-l)',
        background: 'linear-gradient(135deg, rgba(235,47,150,0.06) 0%, rgba(22,119,255,0.03) 100%)',
        border: '1px solid rgba(235,47,150,0.06)',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 34, height: 34, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #eb2f96 0%, #1677ff 100%)', color: '#fff', fontSize: 16,
              boxShadow: '0 4px 12px rgba(235,47,150,0.25)',
            }}><NotificationOutlined /></span>
            通知公告管理
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 44 }}>
            创建、管理和发布系统通知
          </div>
        </div>
        <Space size={8} wrap>
          <Tooltip title="AI 智能巡检">
            <Button icon={<RobotOutlined />} onClick={async () => {
              try {
                message.loading({ content: 'AI 巡检中...', key: 'inspect' });
                const res = await api.post('/ai/auto-inspect');
                const cnt = res.data?.data?.alerts_generated || 0;
                message.success({ content: cnt > 0 ? `巡检完成，生成${cnt}条预警通知` : '巡检完成，一切正常', key: 'inspect' });
                fetchData();
              } catch { message.error({ content: '巡检失败', key: 'inspect' }); }
            }} style={{
              borderRadius: 10, height: 38,
              background: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none', color: '#fff',
              boxShadow: '0 3px 10px rgba(102,126,234,0.3)',
            }}>巡检</Button>
          </Tooltip>
          <Button icon={<DownloadOutlined />} onClick={handleExport} disabled={!data.length} style={{ borderRadius: 10, height: 38, width: 38 }} />
          <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 10, height: 38, width: 38 }} />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}
            style={{ height: 38, borderRadius: 10, fontWeight: 600, paddingInline: 20 }}>新建通知</Button>
        </Space>
      </div>

      {/* Stats */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {STAT_CARDS.map((s, i) => (
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
              <div style={{ fontSize: 22, fontWeight: 800, color: '#fff' }} className="num">{s.value}</div>
            </div>
          </Col>
        ))}
      </Row>

      {/* Filters + View mode */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <Space size={8} wrap>
          <Segmented
            value={viewMode}
            onChange={v => setViewMode(v as string)}
            options={[
              { label: <span><BellOutlined /> 卡片</span>, value: 'cards' },
              { label: <span><FilterOutlined /> 表格</span>, value: 'table' },
            ]}
            style={{ fontWeight: 600 }}
          />
          <Select value={filterType} onChange={setFilterType} allowClear placeholder="类型筛选" style={{ width: 110 }}
            options={Object.entries(TYPE_CONFIG).map(([k, v]) => ({ value: k, label: v.label }))} />
          <Select value={filterRole} onChange={setFilterRole} allowClear placeholder="目标角色" style={{ width: 110 }}
            options={Object.entries(ROLE_CONFIG).map(([k, v]) => ({ value: k, label: v.label }))} />
        </Space>
        <Space size={8}>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>显示全部</span>
          <Switch size="small" checked={showAll} onChange={setShowAll} />
        </Space>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : !data.length ? (
        <div className="panel" style={{ padding: 60, textAlign: 'center' }}>
          <Empty description="暂无通知" />
        </div>
      ) : viewMode === 'cards' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.map((notice, i) => {
            const cfg = TYPE_CONFIG[notice.type || 'info'] || TYPE_CONFIG.info;
            const rc = ROLE_CONFIG[notice.target_role || 'all'] || ROLE_CONFIG.all;
            const expired = notice.is_expired || (notice.expires_at && dayjs(notice.expires_at).isBefore(dayjs()));
            const inactive = !notice.is_active;

            return (
              <div key={notice.id} className="stagger-item" style={{
                padding: '16px 20px', borderRadius: 'var(--radius-l)',
                background: inactive ? 'rgba(0,0,0,0.02)' : 'var(--glass-bg)',
                border: `1px solid ${inactive ? 'rgba(0,0,0,0.06)' : `${cfg.color}15`}`,
                backdropFilter: 'blur(10px)', transition: 'all 0.3s',
                opacity: inactive ? 0.6 : 1,
                animationDelay: `${i * 40}ms`,
              }}
                onMouseEnter={e => { if (!inactive) e.currentTarget.style.boxShadow = `0 6px 20px ${cfg.color}10`; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = ''; }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ display: 'flex', gap: 12, flex: 1, minWidth: 0 }}>
                    <span style={{
                      width: 36, height: 36, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: cfg.gradient, color: '#fff', fontSize: 16, flexShrink: 0,
                      boxShadow: `0 3px 10px ${cfg.color}30`,
                    }}>{cfg.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                        {notice.title && <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-1)' }}>{notice.title}</span>}
                        <Tag color={cfg.color} style={{ borderRadius: 12, fontSize: 10, lineHeight: '18px' }}>{cfg.label}</Tag>
                        <Tag style={{ borderRadius: 12, fontSize: 10, lineHeight: '18px', color: rc.color, borderColor: `${rc.color}40`, background: `${rc.color}08` }}>
                          <TeamOutlined style={{ marginRight: 2 }} />{rc.label}
                        </Tag>
                        {expired && <Tag color="orange" style={{ borderRadius: 12, fontSize: 10, lineHeight: '18px' }}><ClockCircleOutlined /> 已过期</Tag>}
                        {inactive && <Tag style={{ borderRadius: 12, fontSize: 10, lineHeight: '18px' }}><PauseCircleOutlined /> 已停用</Tag>}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{notice.content}</div>
                      <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: 'var(--text-4)', flexWrap: 'wrap' }}>
                        <span><UserOutlined style={{ marginRight: 3 }} />{notice.creator_name ?? '系统'}</span>
                        <span><ClockCircleOutlined style={{ marginRight: 3 }} />{notice.created_at ? dayjs(notice.created_at).fromNow() : '-'}</span>
                        {notice.expires_at && (
                          <span><FieldTimeOutlined style={{ marginRight: 3 }} />到期 {dayjs(notice.expires_at).format('MM-DD HH:mm')}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Space size={2} style={{ flexShrink: 0 }}>
                    <Tooltip title={notice.is_active ? '停用' : '启用'}>
                      <Button type="text" size="small" icon={notice.is_active ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                        onClick={() => handleToggle(notice.id)}
                        style={{ color: notice.is_active ? '#fa8c16' : '#52c41a', borderRadius: 6 }} />
                    </Tooltip>
                    <Popconfirm title="确定删除？" onConfirm={() => handleDelete(notice.id)} okButtonProps={{ danger: true }}>
                      <Tooltip title="删除"><Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ borderRadius: 6 }} /></Tooltip>
                    </Popconfirm>
                  </Space>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title"><BellOutlined style={{ color: '#eb2f96' }} /> 通知列表</span>
            <span style={{ fontSize: 12, color: 'var(--text-4)' }}>共 {data.length} 条</span>
          </div>
          <Table dataSource={data} columns={columns} rowKey="id" size="middle"
            scroll={{ x: 800 }}
            pagination={{ pageSize: 15, showSizeChanger: true, showTotal: t => `共 ${t} 条` }}
            locale={{ emptyText: '暂无通知' }}
          />
        </div>
      )}

      {/* Create modal */}
      <Modal title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #eb2f96, #1677ff)', color: '#fff', fontSize: 13 }}><PlusOutlined /></span>
          新建通知
        </div>
      } open={modalOpen} onCancel={() => setModalOpen(false)} footer={null} width={560}
        styles={{ body: { paddingTop: 20 } }}>
        <Form form={form} layout="vertical" onFinish={handleCreate}
          initialValues={{ type: 'info', target_role: 'all', expires_hours: 24 }}>
          <Form.Item name="title" label="标题（可选）">
            <Input placeholder="输入通知标题，留空则无标题" maxLength={100} showCount />
          </Form.Item>
          <Form.Item name="content" label="通知内容" rules={[{ required: true, message: '请输入通知内容' }]}>
            <Input.TextArea rows={4} placeholder="请输入通知内容" maxLength={500} showCount />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="type" label="类型" rules={[{ required: true }]}>
                <Select options={Object.entries(TYPE_CONFIG).map(([k, v]) => ({
                  value: k, label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{v.icon} {v.label}</span>,
                }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="target_role" label="目标角色">
                <Select options={Object.entries(ROLE_CONFIG).map(([k, v]) => ({
                  value: k, label: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><TeamOutlined style={{ color: v.color }} /> {v.label}</span>,
                }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="expires_hours" label="有效时长(h)" tooltip="留空或0表示永久有效">
                <Input type="number" placeholder="24" min={0} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setModalOpen(false)}>取消</Button>
              <Button type="primary" htmlType="submit" loading={submitting}
                style={{ borderRadius: 8, fontWeight: 600, background: 'linear-gradient(135deg, #eb2f96, #1677ff)', border: 'none' }}>发布通知</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Preview modal */}
      <Modal
        title={null}
        open={!!previewNotice}
        onCancel={() => setPreviewNotice(null)}
        footer={null}
        width={500}
      >
        {previewNotice && (() => {
          const cfg = TYPE_CONFIG[previewNotice.type || 'info'] || TYPE_CONFIG.info;
          const rc = ROLE_CONFIG[previewNotice.target_role || 'all'] || ROLE_CONFIG.all;
          return (
            <div>
              <div style={{
                padding: '20px', margin: '-20px -24px 20px', borderRadius: '12px 12px 0 0',
                background: cfg.gradient, color: '#fff', position: 'relative', overflow: 'hidden',
              }}>
                <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 24 }}>{cfg.icon}</span>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 18 }}>{previewNotice.title || cfg.label + '通知'}</div>
                    <div style={{ opacity: 0.8, fontSize: 12 }}>{cfg.label} · {rc.label}</div>
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--text-1)', whiteSpace: 'pre-wrap', marginBottom: 16 }}>
                {previewNotice.content}
              </div>
              <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-4)', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 12 }}>
                <span><UserOutlined style={{ marginRight: 3 }} />{previewNotice.creator_name ?? '系统'}</span>
                <span><ClockCircleOutlined style={{ marginRight: 3 }} />{previewNotice.created_at ? dayjs(previewNotice.created_at).format('YYYY-MM-DD HH:mm') : '-'}</span>
                {previewNotice.expires_at && <span><FieldTimeOutlined style={{ marginRight: 3 }} />到期 {dayjs(previewNotice.expires_at).format('YYYY-MM-DD HH:mm')}</span>}
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
