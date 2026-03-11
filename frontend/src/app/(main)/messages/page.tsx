'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Button, Space, Empty, Badge, Spin, Tooltip, message as antMessage, Row, Col,
  Segmented, Modal, Tag, Checkbox, Popconfirm,
} from 'antd';
import {
  MailOutlined, CheckCircleOutlined, BellOutlined, ReloadOutlined,
  AuditOutlined, ExclamationCircleOutlined, SettingOutlined,
  CheckOutlined, ClockCircleOutlined, DeleteOutlined, InboxOutlined,
  EyeOutlined, FilterOutlined, ArrowRightOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import api from '@/services/api';
import { useDevice } from '@/hooks/useDevice';
import { useAuth } from '@/stores/useAuth';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

interface Message {
  id: number;
  title: string;
  content: string;
  msg_type: string;
  is_read: boolean;
  link: string | null;
  created_at: string;
}

const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; gradient: string; label: string }> = {
  audit: { icon: <AuditOutlined />, color: '#1677ff', gradient: 'linear-gradient(135deg, #1677ff, #4096ff)', label: '审核通知' },
  system: { icon: <SettingOutlined />, color: '#722ed1', gradient: 'linear-gradient(135deg, #722ed1, #b37feb)', label: '系统消息' },
  warning: { icon: <ExclamationCircleOutlined />, color: '#fa8c16', gradient: 'linear-gradient(135deg, #fa8c16, #ffc53d)', label: '预警提醒' },
  assignment: { icon: <InboxOutlined />, color: '#13c2c2', gradient: 'linear-gradient(135deg, #13c2c2, #5cdbd3)', label: '批次分配' },
  alert: { icon: <ExclamationCircleOutlined />, color: '#ff4d4f', gradient: 'linear-gradient(135deg, #ff4d4f, #ff7875)', label: '异常预警' },
  production: { icon: <AuditOutlined />, color: '#52c41a', gradient: 'linear-gradient(135deg, #52c41a, #95de64)', label: '生产通知' },
  reminder: { icon: <ClockCircleOutlined />, color: '#faad14', gradient: 'linear-gradient(135deg, #faad14, #ffd666)', label: '积压提醒' },
};

export default function MessagesPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(1);
  const [filterType, setFilterType] = useState<string>('all');
  const [filterRead, setFilterRead] = useState<string>('all');
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({});
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [previewMsg, setPreviewMsg] = useState<Message | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const router = useRouter();

  const fetchMessages = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page: p, page_size: 20 };
      if (filterType !== 'all') params.msg_type = filterType;
      if (filterRead === 'unread') params.unread_only = true;
      const r = await api.get('/system/messages', { params });
      setMessages(r.data?.data || []);
      setTotal(r.data?.total || 0);
      setUnreadCount(r.data?.unread || 0);
      if (r.data?.type_counts) setTypeCounts(r.data.type_counts);
    } catch { antMessage.error('加载消息失败'); }
    finally { setLoading(false); }
  }, [page, filterType, filterRead]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  const markRead = async (id: number) => {
    try {
      await api.post(`/system/messages/${id}/read`);
      setMessages(prev => prev.map(m => m.id === id ? { ...m, is_read: true } : m));
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch { /* ignore */ }
  };

  const markAllRead = async () => {
    try {
      await api.post('/system/messages/read-all');
      setMessages(prev => prev.map(m => ({ ...m, is_read: true })));
      setUnreadCount(0);
      antMessage.success('全部标为已读');
    } catch { antMessage.error('操作失败'); }
  };

  const deleteMessage = async (id: number) => {
    try {
      await api.delete(`/system/messages/${id}`);
      antMessage.success('删除成功');
      fetchMessages();
    } catch { antMessage.error('删除失败'); }
  };

  const batchDelete = async () => {
    if (!selectedIds.length) return;
    try {
      await api.post('/system/messages/batch-delete', { ids: selectedIds });
      antMessage.success(`删除了 ${selectedIds.length} 条消息`);
      setSelectedIds([]);
      fetchMessages();
    } catch { antMessage.error('批量删除失败'); }
  };

  const handleClick = (msg: Message) => {
    if (!msg.is_read) markRead(msg.id);
    if (msg.link) router.push(msg.link);
    else setPreviewMsg(msg);
  };

  const handleRefresh = () => { setRefreshSpin(true); fetchMessages().finally(() => setTimeout(() => setRefreshSpin(false), 600)); };

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const selectAll = () => {
    if (selectedIds.length === messages.length) setSelectedIds([]);
    else setSelectedIds(messages.map(m => m.id));
  };

  const { isMobile } = useDevice();
  const { user } = useAuth();
  const isWorkerMobile = isMobile && user?.role === 'worker';

  const totalPages = Math.ceil(total / 20);
  const readCount = total - unreadCount;

  if (isWorkerMobile) {
    return (
      <div className="wm-messages">
        <div className="wm-msg-header">
          <h1>消息</h1>
          <div className="wm-msg-header-actions">
            {unreadCount > 0 && (
              <button className="wm-msg-readall" onClick={markAllRead}>全部已读</button>
            )}
            <button className="wm-msg-refresh" onClick={handleRefresh}>
              <ReloadOutlined spin={refreshSpin} />
            </button>
          </div>
        </div>

        {unreadCount > 0 && (
          <div className="wm-msg-unread-badge">
            <BellOutlined /> {unreadCount} 条未读消息
          </div>
        )}

        <div className="wm-msg-filter">
          {['all', 'unread'].map(f => (
            <button key={f}
              className={`wm-msg-filter-btn ${filterRead === f ? 'active' : ''}`}
              onClick={() => { setFilterRead(f); setPage(1); }}
            >
              {f === 'all' ? '全部' : '未读'}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>
        ) : messages.length === 0 ? (
          <div className="wm-msg-empty">
            <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-2)' }}>暂无消息</div>
            <div style={{ fontSize: 13, color: 'var(--text-4)', marginTop: 4 }}>新消息会实时推送到这里</div>
          </div>
        ) : (
          <div className="wm-msg-list">
            {messages.map(msg => {
              const tc = TYPE_CONFIG[msg.msg_type] || TYPE_CONFIG.system;
              return (
                <div key={msg.id} className={`wm-msg-item ${!msg.is_read ? 'unread' : ''}`}
                  onClick={() => handleClick(msg)}>
                  <div className="wm-msg-icon" style={{ background: tc.gradient }}>
                    {tc.icon}
                  </div>
                  <div className="wm-msg-content">
                    <div className="wm-msg-title-row">
                      {!msg.is_read && <span className="wm-msg-dot" />}
                      <span className="wm-msg-title">{msg.title}</span>
                    </div>
                    {msg.content && (
                      <div className="wm-msg-text">{msg.content}</div>
                    )}
                    <div className="wm-msg-meta">
                      <span className="wm-msg-type" style={{ color: tc.color, background: `${tc.color}12` }}>{tc.label}</span>
                      <span className="wm-msg-time">{msg.created_at ? dayjs(msg.created_at).fromNow() : ''}</span>
                    </div>
                  </div>
                  {msg.link && <ArrowRightOutlined className="wm-msg-arrow" />}
                </div>
              );
            })}

            {totalPages > 1 && (
              <div className="wm-msg-pager">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
                <span>{page} / {totalPages}</span>
                <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</button>
              </div>
            )}
          </div>
        )}

        <Modal
          title={null}
          open={!!previewMsg}
          onCancel={() => setPreviewMsg(null)}
          footer={
            previewMsg?.link ? (
              <Button type="primary" icon={<ArrowRightOutlined />} block
                onClick={() => { setPreviewMsg(null); router.push(previewMsg.link!); }}
                style={{ borderRadius: 12, height: 44, fontWeight: 600 }}>查看详情</Button>
            ) : null
          }
          width="90vw"
          style={{ maxWidth: 400 }}
        >
          {previewMsg && (() => {
            const tc = TYPE_CONFIG[previewMsg.msg_type] || TYPE_CONFIG.system;
            return (
              <div>
                <div style={{
                  padding: '16px', margin: '-20px -24px 16px', borderRadius: '12px 12px 0 0',
                  background: tc.gradient, color: '#fff',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 22 }}>{tc.icon}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>{previewMsg.title}</div>
                      <div style={{ opacity: 0.8, fontSize: 12, marginTop: 2 }}>{tc.label}</div>
                    </div>
                  </div>
                </div>
                {previewMsg.content && (
                  <div style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--text-1)', whiteSpace: 'pre-wrap' }}>
                    {previewMsg.content}
                  </div>
                )}
                <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 12 }}>
                  {previewMsg.created_at ? dayjs(previewMsg.created_at).format('YYYY-MM-DD HH:mm') : '-'}
                </div>
              </div>
            );
          })()}
        </Modal>

        <style jsx global>{`
          .wm-messages { padding: 16px; }

          .wm-msg-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 4px 0 16px;
          }

          .wm-msg-header h1 {
            font-size: 24px;
            font-weight: 800;
            color: var(--text-1);
            margin: 0;
          }

          .wm-msg-header-actions {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .wm-msg-readall {
            padding: 6px 14px;
            border-radius: 10px;
            border: 1px solid var(--brand);
            background: rgba(22,119,255,0.06);
            color: var(--brand);
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            -webkit-tap-highlight-color: transparent;
          }

          .wm-msg-refresh {
            width: 36px;
            height: 36px;
            border-radius: 10px;
            border: 1px solid var(--border-1);
            background: var(--bg-card);
            color: var(--text-3);
            font-size: 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            -webkit-tap-highlight-color: transparent;
          }

          .wm-msg-unread-badge {
            padding: 10px 16px;
            border-radius: 12px;
            background: linear-gradient(135deg, rgba(255,77,79,0.08), rgba(255,77,79,0.03));
            border: 1px solid rgba(255,77,79,0.12);
            color: #ff4d4f;
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 14px;
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .wm-msg-filter {
            display: flex;
            gap: 8px;
            margin-bottom: 14px;
          }

          .wm-msg-filter-btn {
            padding: 8px 20px;
            border-radius: 20px;
            border: 1px solid var(--border-1);
            background: var(--bg-card);
            color: var(--text-3);
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            -webkit-tap-highlight-color: transparent;
            transition: all 0.2s;
          }

          .wm-msg-filter-btn.active {
            background: var(--brand);
            color: #fff;
            border-color: var(--brand);
            box-shadow: 0 2px 8px rgba(22,119,255,0.2);
          }

          .wm-msg-empty {
            text-align: center;
            padding: 60px 20px;
            border-radius: 18px;
            background: var(--bg-card);
            border: 1px solid var(--border-1);
          }

          .wm-msg-list {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }

          .wm-msg-item {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            padding: 14px 16px;
            border-radius: 16px;
            background: var(--bg-card);
            border: 1px solid var(--border-1);
            cursor: pointer;
            -webkit-tap-highlight-color: transparent;
            transition: all 0.2s;
          }

          .wm-msg-item:active {
            transform: scale(0.98);
          }

          .wm-msg-item.unread {
            background: rgba(22,119,255,0.03);
            border-color: rgba(22,119,255,0.1);
          }

          .wm-msg-icon {
            width: 38px;
            height: 38px;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
            font-size: 16px;
            flex-shrink: 0;
          }

          .wm-msg-content {
            flex: 1;
            min-width: 0;
          }

          .wm-msg-title-row {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 4px;
          }

          .wm-msg-dot {
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: #ff4d4f;
            flex-shrink: 0;
            box-shadow: 0 0 0 3px rgba(255,77,79,0.15);
          }

          .wm-msg-title {
            font-size: 15px;
            font-weight: 600;
            color: var(--text-1);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .wm-msg-text {
            font-size: 13px;
            color: var(--text-3);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            margin-bottom: 6px;
          }

          .wm-msg-meta {
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .wm-msg-type {
            font-size: 11px;
            font-weight: 600;
            padding: 1px 8px;
            border-radius: 6px;
          }

          .wm-msg-time {
            font-size: 11px;
            color: var(--text-4);
          }

          .wm-msg-arrow {
            color: var(--text-4);
            font-size: 12px;
            margin-top: 12px;
            flex-shrink: 0;
          }

          .wm-msg-pager {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 16px;
            padding: 16px 0 8px;
          }

          .wm-msg-pager button {
            padding: 8px 16px;
            border-radius: 10px;
            border: 1px solid var(--border-1);
            background: var(--bg-card);
            color: var(--text-2);
            font-size: 13px;
            cursor: pointer;
          }

          .wm-msg-pager button:disabled {
            opacity: 0.4;
            cursor: not-allowed;
          }

          .wm-msg-pager span {
            font-size: 13px;
            color: var(--text-3);
            font-weight: 600;
          }
        `}</style>
      </div>
    );
  }

  const STATS = [
    { label: '全部消息', value: total, icon: <MailOutlined />, gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', glow: 'rgba(114,46,209,0.18)' },
    { label: '未读消息', value: unreadCount, icon: <BellOutlined />, gradient: unreadCount > 0 ? 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)' : 'linear-gradient(135deg, #8c8c8c, #bfbfbf)', glow: unreadCount > 0 ? 'rgba(255,77,79,0.18)' : 'rgba(140,140,140,0.18)' },
    { label: '已读消息', value: readCount, icon: <CheckCircleOutlined />, gradient: 'linear-gradient(135deg, #52c41a 0%, #95de64 100%)', glow: 'rgba(82,196,26,0.18)' },
    { label: '消息类型', value: Object.keys(typeCounts).length, icon: <FilterOutlined />, gradient: 'linear-gradient(135deg, #13c2c2 0%, #5cdbd3 100%)', glow: 'rgba(19,194,194,0.18)', suffix: '种' },
  ];

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #722ed1 0%, #1677ff 50%, #13c2c2 100%)',
        borderRadius: 'var(--radius-l)', padding: '24px 28px', marginBottom: 20,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -30, right: -20, width: 160, height: 160, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
        <div style={{ position: 'absolute', bottom: -20, left: '30%', width: 100, height: 100, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
              <span style={{
                width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
                backdropFilter: 'blur(10px)',
              }}><MailOutlined /></span>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>消息中心</div>
                <div style={{ fontSize: 13, opacity: 0.85 }}>审核通知 · 系统消息 · 实时提醒</div>
              </div>
              {unreadCount > 0 && <Badge count={unreadCount} style={{ boxShadow: '0 0 0 2px rgba(255,255,255,0.3)' }} />}
            </div>
          </div>
          <Space size={8} wrap>
            {unreadCount > 0 && (
              <Button icon={<CheckOutlined />} onClick={markAllRead}
                style={{ borderRadius: 10, background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', fontWeight: 600 }}>
                全部已读
              </Button>
            )}
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh}
              style={{ borderRadius: 10, background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none' }} />
          </Space>
        </div>
      </div>

      {/* Stats */}
      <Row gutter={[10, 10]} style={{ marginBottom: 16 }}>
        {STATS.map((s, i) => (
          <Col xs={12} sm={6} key={i}>
            <div className="stagger-item" style={{
              padding: '12px 14px', borderRadius: 'var(--radius-m)', background: s.gradient,
              position: 'relative', overflow: 'hidden', boxShadow: `0 4px 14px ${s.glow}`,
              transition: 'all 0.3s', animationDelay: `${i * 60}ms`,
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
            >
              <div style={{ position: 'absolute', top: -10, right: -10, width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>{s.icon} {s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }} className="num">
                {s.value}{s.suffix && <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 2, opacity: 0.7 }}>{s.suffix}</span>}
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* Filters & batch actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <Space size={8} wrap>
          <Segmented
            value={filterType}
            onChange={v => { setFilterType(v as string); setPage(1); }}
            options={[
              { label: <span>全部 <Badge count={total} size="small" style={{ marginLeft: 2 }} /></span>, value: 'all' },
              ...Object.entries(TYPE_CONFIG).map(([k, v]) => ({
                label: <span>{v.icon} {v.label} {typeCounts[k] ? <Badge count={typeCounts[k]} size="small" style={{ marginLeft: 2, backgroundColor: v.color }} /> : null}</span>,
                value: k,
              })),
            ]}
            style={{ fontWeight: 600 }}
          />
          <Segmented
            value={filterRead}
            onChange={v => { setFilterRead(v as string); setPage(1); }}
            options={[
              { label: '全部', value: 'all' },
              { label: <span style={{ color: unreadCount > 0 ? '#ff4d4f' : undefined }}>未读</span>, value: 'unread' },
            ]}
            size="small"
          />
        </Space>
        {selectedIds.length > 0 && (
          <Space size={8}>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>已选 {selectedIds.length} 条</span>
            <Popconfirm title={`确定删除 ${selectedIds.length} 条消息？`} onConfirm={batchDelete} okButtonProps={{ danger: true }}>
              <Button size="small" danger icon={<DeleteOutlined />} style={{ borderRadius: 8 }}>批量删除</Button>
            </Popconfirm>
          </Space>
        )}
      </div>

      {/* Messages list */}
      <div className="panel" style={{ overflow: 'hidden' }}>
        {messages.length > 0 && (
          <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border-2)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Checkbox checked={selectedIds.length === messages.length && messages.length > 0} indeterminate={selectedIds.length > 0 && selectedIds.length < messages.length}
              onChange={selectAll}>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>全选</span>
            </Checkbox>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>
        ) : messages.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center' }}>
            <Empty description={filterType !== 'all' || filterRead !== 'all' ? '当前筛选条件下无消息' : '暂无消息'} image={Empty.PRESENTED_IMAGE_SIMPLE} />
          </div>
        ) : (
          <>
            {messages.map((msg, i) => {
              const tc = TYPE_CONFIG[msg.msg_type] || TYPE_CONFIG.system;
              const isSelected = selectedIds.includes(msg.id);
              return (
                <div
                  key={msg.id}
                  className={i === 0 ? '' : ''}
                  style={{
                    padding: '14px 16px',
                    borderBottom: i < messages.length - 1 ? '1px solid rgba(0,0,0,0.04)' : 'none',
                    transition: 'all 0.2s',
                    background: isSelected ? 'rgba(22,119,255,0.04)' : !msg.is_read ? 'rgba(22,119,255,0.02)' : 'transparent',
                    display: 'flex', gap: 12, alignItems: 'flex-start',
                  }}
                  onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(22,119,255,0.03)'; }}
                  onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = !msg.is_read ? 'rgba(22,119,255,0.02)' : 'transparent'; }}
                >
                  <Checkbox checked={isSelected} onChange={() => toggleSelect(msg.id)} style={{ marginTop: 6 }} />

                  <div
                    onClick={() => handleClick(msg)}
                    style={{ display: 'flex', gap: 12, flex: 1, cursor: 'pointer', minWidth: 0 }}
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, background: tc.gradient,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontSize: 15, flexShrink: 0,
                      boxShadow: `0 3px 10px ${tc.color}25`,
                    }}>
                      {tc.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                        {!msg.is_read && (
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff4d4f', flexShrink: 0, boxShadow: '0 0 0 3px rgba(255,77,79,0.15)' }} />
                        )}
                        <span style={{ fontWeight: msg.is_read ? 500 : 700, fontSize: 14, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {msg.title}
                        </span>
                        <Tag color={tc.color} style={{ borderRadius: 10, fontSize: 10, lineHeight: '16px', marginLeft: 'auto', flexShrink: 0 }}>{tc.label}</Tag>
                      </div>
                      {msg.content && (
                        <div style={{ fontSize: 13, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>{msg.content}</div>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-4)' }}>
                        <ClockCircleOutlined />
                        <span>{msg.created_at ? dayjs(msg.created_at).fromNow() : ''}</span>
                        {msg.is_read && <Tag style={{ borderRadius: 4, fontSize: 9, padding: '0 4px', color: '#52c41a' }}><CheckCircleOutlined /> 已读</Tag>}
                        {msg.link && <Tag style={{ borderRadius: 4, fontSize: 9, padding: '0 4px', color: '#1677ff' }}><ArrowRightOutlined /> 可跳转</Tag>}
                      </div>
                    </div>
                  </div>

                  <Space size={2} style={{ flexShrink: 0, marginTop: 4 }}>
                    {!msg.is_read && (
                      <Tooltip title="标为已读">
                        <Button type="text" size="small" icon={<CheckOutlined />}
                          onClick={e => { e.stopPropagation(); markRead(msg.id); }}
                          style={{ color: '#52c41a', borderRadius: 6 }} />
                      </Tooltip>
                    )}
                    <Tooltip title="预览">
                      <Button type="text" size="small" icon={<EyeOutlined />}
                        onClick={e => { e.stopPropagation(); setPreviewMsg(msg); }}
                        style={{ color: '#1677ff', borderRadius: 6 }} />
                    </Tooltip>
                    <Popconfirm title="删除此消息？" onConfirm={() => deleteMessage(msg.id)} okButtonProps={{ danger: true }}>
                      <Tooltip title="删除">
                        <Button type="text" size="small" danger icon={<DeleteOutlined />}
                          onClick={e => e.stopPropagation()} style={{ borderRadius: 6 }} />
                      </Tooltip>
                    </Popconfirm>
                  </Space>
                </div>
              );
            })}

            {totalPages > 1 && (
              <div style={{ padding: '12px 16px', textAlign: 'center', borderTop: '1px solid var(--border-2)', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12 }}>
                <Button size="small" disabled={page <= 1} onClick={() => { setPage(p => p - 1); setSelectedIds([]); }}
                  style={{ borderRadius: 8 }}>上一页</Button>
                <span style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 600 }}>{page} / {totalPages}</span>
                <Button size="small" disabled={page >= totalPages} onClick={() => { setPage(p => p + 1); setSelectedIds([]); }}
                  style={{ borderRadius: 8 }}>下一页</Button>
                <span style={{ fontSize: 11, color: 'var(--text-4)' }}>共 {total} 条</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Preview modal */}
      <Modal
        title={null}
        open={!!previewMsg}
        onCancel={() => setPreviewMsg(null)}
        footer={
          previewMsg?.link ? (
            <Button type="primary" icon={<ArrowRightOutlined />} onClick={() => { setPreviewMsg(null); router.push(previewMsg.link!); }}
              style={{ borderRadius: 8, fontWeight: 600 }}>查看详情</Button>
          ) : null
        }
        width={480}
      >
        {previewMsg && (() => {
          const tc = TYPE_CONFIG[previewMsg.msg_type] || TYPE_CONFIG.system;
          return (
            <div>
              <div style={{
                padding: '20px', margin: '-20px -24px 20px', borderRadius: '12px 12px 0 0',
                background: tc.gradient, color: '#fff', position: 'relative', overflow: 'hidden',
              }}>
                <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
                  <span style={{ fontSize: 24 }}>{tc.icon}</span>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 17 }}>{previewMsg.title}</div>
                    <div style={{ opacity: 0.8, fontSize: 12, marginTop: 2 }}>{tc.label}</div>
                  </div>
                </div>
              </div>
              {previewMsg.content && (
                <div style={{ fontSize: 14, lineHeight: 1.8, color: 'var(--text-1)', whiteSpace: 'pre-wrap', marginBottom: 16 }}>
                  {previewMsg.content}
                </div>
              )}
              <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-4)', borderTop: '1px solid rgba(0,0,0,0.06)', paddingTop: 12 }}>
                <span><ClockCircleOutlined style={{ marginRight: 3 }} />{previewMsg.created_at ? dayjs(previewMsg.created_at).format('YYYY-MM-DD HH:mm') : '-'}</span>
                {previewMsg.is_read
                  ? <Tag color="green" style={{ borderRadius: 8 }}><CheckCircleOutlined /> 已读</Tag>
                  : <Tag color="red" style={{ borderRadius: 8 }}>未读</Tag>}
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
