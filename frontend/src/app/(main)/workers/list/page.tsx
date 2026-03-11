'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  Table, Button, Space, Modal, Form, Input, message, Popconfirm,
  Tag, Tooltip, Row, Col, Avatar, Segmented, Badge,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, KeyOutlined,
  UserOutlined, PhoneOutlined, AlipayCircleOutlined, SearchOutlined,
  TeamOutlined, ReloadOutlined, AppstoreOutlined, UnorderedListOutlined,
  CalendarOutlined, ThunderboltOutlined, FieldTimeOutlined,
  DownloadOutlined, TrophyOutlined, WarningOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import { useAuth } from '@/stores/useAuth';
import type { WorkerInfo } from '@/types';
import WorkerProfileModal from '@/components/WorkerProfileModal';

interface WorkerStats {
  month_attendance: number;
  month_hours: number;
  month_production: number;
  month_records: number;
  week_production: number;
  month_late: number;
  month_labels: number;
}

export default function WorkersListPage() {
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<WorkerInfo[]>([]);
  const [filtered, setFiltered] = useState<WorkerInfo[]>([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetPwdLoading, setResetPwdLoading] = useState<number | null>(null);
  const [form] = Form.useForm();
  const [batchAddOpen, setBatchAddOpen] = useState(false);
  const [batchAddLoading, setBatchAddLoading] = useState(false);
  const [batchAddText, setBatchAddText] = useState('');
  const [batchPwd, setBatchPwd] = useState('123456');
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchResetOpen, setBatchResetOpen] = useState(false);
  const [batchResetLoading, setBatchResetLoading] = useState(false);
  const [batchResetPwd, setBatchResetPwd] = useState('123456');
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [profileWorkerId, setProfileWorkerId] = useState<number | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [viewMode, setViewMode] = useState<string>('card');
  const [statsMap, setStatsMap] = useState<Record<number, WorkerStats>>({});

  const fetchData = async () => {
    try {
      const res = await api.get('/workers', { params: { page: 1, page_size: 500 } });
      const list = res.data?.data ?? res.data ?? [];
      const arr = Array.isArray(list) ? list : [];
      setData(arr);
      setFiltered(arr);
    } catch { message.error('加载工人列表失败'); setData([]); setFiltered([]); }
    finally { setLoading(false); }
  };

  const fetchStats = async () => {
    try {
      const res = await api.get('/workers/batch-stats');
      setStatsMap(res.data?.data ?? {});
    } catch { /* non-critical */ }
  };

  useEffect(() => {
    if (isAdmin()) { fetchData(); fetchStats(); }
    else setLoading(false);
  }, []);

  useEffect(() => {
    if (!search.trim()) { setFiltered(data); return; }
    const kw = search.toLowerCase();
    setFiltered(data.filter(w =>
      (w.username || '').toLowerCase().includes(kw) ||
      (w.real_name || '').toLowerCase().includes(kw) ||
      (w.phone || '').includes(kw)
    ));
  }, [search, data]);

  const handleRefresh = () => {
    setRefreshSpin(true);
    Promise.all([fetchData(), fetchStats()]).finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const handleAdd = () => { form.resetFields(); setEditingId(null); setModalOpen(true); };
  const handleEdit = (r: WorkerInfo) => {
    form.setFieldsValue({ username: r.username, real_name: r.real_name ?? '', phone: r.phone ?? '', alipay_account: r.alipay_account ?? '' });
    setEditingId(r.id); setModalOpen(true);
  };

  const handleSubmit = async () => {
    const v = await form.validateFields();
    setSubmitting(true);
    try {
      if (editingId) { await api.put(`/workers/${editingId}`, v); message.success('更新成功'); }
      else { await api.post('/workers', v); message.success('添加成功'); }
      setModalOpen(false); fetchData(); fetchStats();
    } catch (e: any) { message.error(e?.response?.data?.detail || e?.response?.data?.message || '操作失败'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (id: number) => {
    try { await api.delete(`/workers/${id}`); message.success('删除成功'); fetchData(); }
    catch (e: any) { message.error(e?.response?.data?.message ?? '删除失败'); }
  };

  const handleResetPassword = (id: number) => {
    Modal.confirm({
      title: '重置密码', content: '确定重置该工人密码为默认密码？',
      okText: '确定', cancelText: '取消',
      onOk: async () => {
        setResetPwdLoading(id);
        try { await api.post(`/workers/${id}/reset-password`); message.success('密码已重置'); }
        catch (e: any) { message.error(e?.response?.data?.message ?? '重置失败'); }
        finally { setResetPwdLoading(null); }
      },
    });
  };

  const exportCSV = () => {
    if (!filtered.length) { message.warning('无数据可导出'); return; }
    const header = '姓名,用户名,手机,支付宝,本月出勤,本月工时,本月产量,7日产量,本月迟到\n';
    const rows = filtered.map(w => {
      const s = statsMap[w.id] || {} as any;
      return `${w.real_name || ''},${w.username},${w.phone || ''},${w.alipay_account || ''},${s.month_attendance || 0},${s.month_hours || 0},${s.month_production || 0},${s.week_production || 0},${s.month_late || 0}`;
    }).join('\n');
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + header + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `工人列表_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    message.success('导出成功');
  };

  const totalMonthProd = useMemo(() => Object.values(statsMap).reduce((a, s) => a + (s.month_production || 0), 0), [statsMap]);
  const totalMonthAtt = useMemo(() => Object.values(statsMap).reduce((a, s) => a + (s.month_attendance || 0), 0), [statsMap]);

  if (!isAdmin()) {
    return (
      <div className="panel" style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>无权限</div>
        <div style={{ color: 'var(--text-3)', fontSize: 13 }}>仅管理员可管理工人列表</div>
      </div>
    );
  }

  const GRADIENTS = [
    'linear-gradient(135deg, #1677ff, #69b1ff)', 'linear-gradient(135deg, #00b96b, #5cdbd3)',
    'linear-gradient(135deg, #fa8c16, #ffc53d)', 'linear-gradient(135deg, #722ed1, #b37feb)',
    'linear-gradient(135deg, #eb2f96, #ff85c0)', 'linear-gradient(135deg, #13c2c2, #5cdbd3)',
  ];
  const getGradient = (id: number) => GRADIENTS[id % GRADIENTS.length];

  const columns: any[] = [
    {
      title: '工人', key: 'worker', width: 220,
      render: (_: any, r: WorkerInfo) => (
        <Space size={12} style={{ cursor: 'pointer' }} onClick={() => { setProfileWorkerId(r.id); setProfileOpen(true); }}>
          <Avatar size={38} style={{
            background: getGradient(r.id), fontWeight: 700, fontSize: 14,
            boxShadow: '0 3px 10px rgba(0,0,0,0.1)',
          }}>
            {(r.real_name || r.username || '?').charAt(0).toUpperCase()}
          </Avatar>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--brand)', transition: 'color 0.2s' }}>{r.real_name || r.username}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>@{r.username}</div>
          </div>
        </Space>
      ),
    },
    {
      title: '手机', dataIndex: 'phone', width: 130,
      render: (v: string) => v ? (
        <Space size={4}><PhoneOutlined style={{ color: '#00b96b', fontSize: 12 }} /><span style={{ fontWeight: 500 }}>{v}</span></Space>
      ) : <span style={{ color: 'var(--text-4)' }}>-</span>,
    },
    {
      title: '本月出勤', key: 'att', width: 90, align: 'center' as const,
      render: (_: any, r: WorkerInfo) => {
        const s = statsMap[r.id];
        return s ? <span className="num" style={{ fontWeight: 600, color: '#00b96b' }}>{s.month_attendance}<span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 2 }}>天</span></span> : <span style={{ color: 'var(--text-4)' }}>-</span>;
      },
    },
    {
      title: '本月产量', key: 'prod', width: 100, align: 'right' as const,
      render: (_: any, r: WorkerInfo) => {
        const s = statsMap[r.id];
        return s?.month_production ? <span className="num" style={{ fontWeight: 700, color: '#1677ff' }}>{s.month_production.toLocaleString()}</span> : <span style={{ color: 'var(--text-4)' }}>-</span>;
      },
      sorter: (a: WorkerInfo, b: WorkerInfo) => (statsMap[a.id]?.month_production || 0) - (statsMap[b.id]?.month_production || 0),
    },
    {
      title: '7日产量', key: 'prod7', width: 90, align: 'right' as const,
      render: (_: any, r: WorkerInfo) => {
        const s = statsMap[r.id];
        return s?.week_production ? <span className="num" style={{ fontWeight: 600, color: '#fa8c16' }}>{s.week_production.toLocaleString()}</span> : <span style={{ color: 'var(--text-4)' }}>-</span>;
      },
    },
    {
      title: '操作', key: 'actions', width: 140, fixed: 'right' as const, align: 'center' as const,
      render: (_: any, r: WorkerInfo) => (
        <Space size={0}>
          <Tooltip title="编辑">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)} style={{ color: 'var(--brand)', borderRadius: 6 }} />
          </Tooltip>
          <Tooltip title="重置密码">
            <Button type="text" size="small" icon={<KeyOutlined />} loading={resetPwdLoading === r.id} onClick={() => handleResetPassword(r.id)} style={{ color: '#fa8c16', borderRadius: 6 }} />
          </Tooltip>
          <Popconfirm title="确定删除此工人？" onConfirm={() => handleDelete(r.id)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
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
        background: 'linear-gradient(135deg, rgba(22,119,255,0.05) 0%, rgba(114,46,209,0.03) 100%)',
        border: '1px solid rgba(22,119,255,0.06)',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 32, height: 32, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #1677ff 0%, #722ed1 100%)', color: '#fff', fontSize: 15,
              boxShadow: '0 3px 10px rgba(22,119,255,0.2)',
            }}><TeamOutlined /></span>
            工人管理
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 42 }}>管理工人账号、查看出勤与产量统计</div>
        </div>
        <Space size={8}>
          {selectedRowKeys.length > 0 && (
            <Button danger onClick={() => setBatchResetOpen(true)} icon={<KeyOutlined />}
              style={{ height: 38, borderRadius: 10, fontWeight: 600 }}>
              重置密码 ({selectedRowKeys.length})
            </Button>
          )}
          <Tooltip title="导出 CSV"><Button icon={<DownloadOutlined />} onClick={exportCSV} disabled={!filtered.length} style={{ borderRadius: 10, height: 38, width: 38 }} /></Tooltip>
          <Tooltip title="刷新"><Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 10, height: 38, width: 38 }} /></Tooltip>
          <Button onClick={() => setBatchAddOpen(true)} icon={<TeamOutlined />}
            style={{ height: 38, borderRadius: 10, fontWeight: 600, paddingInline: 16 }}>
            批量添加
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}
            style={{ height: 38, borderRadius: 10, fontWeight: 600, paddingInline: 20, boxShadow: '0 3px 12px rgba(22,119,255,0.2)' }}>
            添加工人
          </Button>
        </Space>
      </div>

      {/* Stats Cards */}
      <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
        {[
          { label: '工人总数', value: data.length, unit: '人', icon: <TeamOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.15)' },
          { label: '本月总产量', value: totalMonthProd.toLocaleString(), unit: '', icon: <ThunderboltOutlined />, gradient: 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: 'rgba(0,185,107,0.15)' },
          { label: '本月总出勤', value: totalMonthAtt, unit: '人次', icon: <CalendarOutlined />, gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.15)' },
          { label: '当前搜索', value: filtered.length, unit: '人', icon: <SearchOutlined />, gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', glow: 'rgba(114,46,209,0.15)' },
        ].map((s, i) => (
          <Col xs={12} sm={6} key={i}>
            <div style={{
              padding: '14px 16px', borderRadius: 'var(--radius-m)', background: s.gradient,
              position: 'relative', overflow: 'hidden', boxShadow: `0 4px 14px ${s.glow}`, transition: 'all 0.3s',
              animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.08}s`,
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
            >
              <div style={{ position: 'absolute', top: -12, right: -12, width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>{s.icon} {s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', lineHeight: 1.2 }} className="num">
                {s.value}{s.unit && <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3, opacity: 0.7 }}>{s.unit}</span>}
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* Search + View Toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <Input placeholder="搜索工人姓名、用户名或手机号" prefix={<SearchOutlined style={{ color: 'var(--brand)' }} />}
          allowClear value={search} onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 320, borderRadius: 8 }} />
        <Segmented
          value={viewMode}
          onChange={v => setViewMode(v as string)}
          options={[
            { label: <span><AppstoreOutlined /> 卡片</span>, value: 'card' },
            { label: <span><UnorderedListOutlined /> 列表</span>, value: 'table' },
          ]}
          style={{ borderRadius: 8 }}
        />
      </div>

      {/* Card View */}
      {viewMode === 'card' ? (
        <Row gutter={[14, 14]}>
          {filtered.map((w, idx) => {
            const s = statsMap[w.id];
            const isTop3 = s && Object.entries(statsMap)
              .sort(([, a], [, b]) => (b.month_production || 0) - (a.month_production || 0))
              .findIndex(([id]) => Number(id) === w.id) < 3;
            return (
              <Col xs={24} sm={12} md={8} lg={6} key={w.id}>
                <div className="panel" style={{
                  padding: 0, overflow: 'hidden', transition: 'all 0.3s', cursor: 'default',
                  animation: `stagger-in 0.4s cubic-bezier(0.22,1,0.36,1) both`,
                  animationDelay: `${Math.min(idx, 15) * 0.04}s`,
                }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 30px rgba(0,0,0,0.08)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
                >
                  {/* Card Header */}
                  <div style={{
                    padding: '16px 16px 12px', display: 'flex', alignItems: 'center', gap: 12,
                    background: `${getGradient(w.id).replace('linear-gradient', 'linear-gradient').replace(')', ', rgba(255,255,255,0.92))')}`,
                    borderBottom: '1px solid rgba(0,0,0,0.04)',
                  }}>
                    <div style={{ position: 'relative' }}>
                      <Avatar size={44} style={{
                        background: getGradient(w.id), fontWeight: 700, fontSize: 16,
                        boxShadow: '0 3px 12px rgba(0,0,0,0.12)', cursor: 'pointer',
                      }}
                        onClick={() => { setProfileWorkerId(w.id); setProfileOpen(true); }}
                      >
                        {(w.real_name || w.username || '?').charAt(0).toUpperCase()}
                      </Avatar>
                      {isTop3 && (
                        <div style={{
                          position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: '50%',
                          background: 'linear-gradient(135deg, #ffc53d, #fa8c16)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 9, color: '#fff', fontWeight: 700, boxShadow: '0 2px 6px rgba(250,140,22,0.3)',
                        }}><TrophyOutlined /></div>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                        onClick={() => { setProfileWorkerId(w.id); setProfileOpen(true); }}
                      >
                        {w.real_name || w.username}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>@{w.username}</div>
                    </div>
                  </div>

                  {/* Stats Grid */}
                  <div style={{ padding: '10px 12px 8px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                      <CalendarOutlined style={{ color: '#00b96b', fontSize: 11 }} />
                      <span style={{ color: 'var(--text-3)' }}>出勤</span>
                      <span className="num" style={{ marginLeft: 'auto', fontWeight: 700, color: '#00b96b' }}>{s?.month_attendance || 0}<span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-4)' }}>天</span></span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                      <ThunderboltOutlined style={{ color: '#1677ff', fontSize: 11 }} />
                      <span style={{ color: 'var(--text-3)' }}>产量</span>
                      <span className="num" style={{ marginLeft: 'auto', fontWeight: 700, color: '#1677ff' }}>{(s?.month_production || 0).toLocaleString()}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                      <FieldTimeOutlined style={{ color: '#722ed1', fontSize: 11 }} />
                      <span style={{ color: 'var(--text-3)' }}>工时</span>
                      <span className="num" style={{ marginLeft: 'auto', fontWeight: 600, color: '#722ed1' }}>{s?.month_hours || 0}<span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-4)' }}>h</span></span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                      <ThunderboltOutlined style={{ color: '#fa8c16', fontSize: 11 }} />
                      <span style={{ color: 'var(--text-3)' }}>7日</span>
                      <span className="num" style={{ marginLeft: 'auto', fontWeight: 600, color: '#fa8c16' }}>{(s?.week_production || 0).toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Warnings */}
                  {(s?.month_late || 0) > 0 && (
                    <div style={{ padding: '0 12px 6px' }}>
                      <Tag color="warning" style={{ borderRadius: 6, fontSize: 10, margin: 0 }}><WarningOutlined /> 迟到 {s?.month_late} 次</Tag>
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{
                    padding: '8px 12px', borderTop: '1px solid rgba(0,0,0,0.04)',
                    display: 'flex', gap: 4, justifyContent: 'center',
                  }}>
                    <Tooltip title="查看档案">
                      <Button type="text" size="small" icon={<UserOutlined />}
                        onClick={() => { setProfileWorkerId(w.id); setProfileOpen(true); }}
                        style={{ borderRadius: 6, color: '#1677ff', fontSize: 12 }} />
                    </Tooltip>
                    <Tooltip title="编辑">
                      <Button type="text" size="small" icon={<EditOutlined />}
                        onClick={() => handleEdit(w)} style={{ borderRadius: 6, color: '#fa8c16', fontSize: 12 }} />
                    </Tooltip>
                    <Tooltip title="重置密码">
                      <Button type="text" size="small" icon={<KeyOutlined />}
                        loading={resetPwdLoading === w.id} onClick={() => handleResetPassword(w.id)}
                        style={{ borderRadius: 6, color: '#722ed1', fontSize: 12 }} />
                    </Tooltip>
                    <Popconfirm title="确定删除此工人？" onConfirm={() => handleDelete(w.id)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
                      <Tooltip title="删除"><Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ borderRadius: 6, fontSize: 12 }} /></Tooltip>
                    </Popconfirm>
                  </div>
                </div>
              </Col>
            );
          })}
          {!filtered.length && !loading && (
            <Col span={24}><div style={{ textAlign: 'center', padding: 60, color: 'var(--text-4)' }}>暂无工人数据</div></Col>
          )}
        </Row>
      ) : (
        /* Table View */
        <div className="panel">
          <Table rowKey="id" columns={columns} dataSource={filtered} loading={loading} size="middle"
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `共 ${t} 位` }}
            scroll={{ x: 800 }}
            locale={{ emptyText: '暂无工人数据' }}
            rowSelection={{ selectedRowKeys, onChange: keys => setSelectedRowKeys(keys), columnWidth: 40 }}
          />
        </div>
      )}

      {/* Modal */}
      <Modal title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: editingId ? 'linear-gradient(135deg, #fa8c16, #ffc53d)' : 'linear-gradient(135deg, #1677ff, #722ed1)',
            color: '#fff', fontSize: 13,
          }}>{editingId ? <EditOutlined /> : <PlusOutlined />}</span>
          {editingId ? '编辑工人' : '添加工人'}
        </div>
      } open={modalOpen}
        onOk={handleSubmit} onCancel={() => setModalOpen(false)}
        confirmLoading={submitting} destroyOnClose okText="保存" cancelText="取消" width={480}
        styles={{ body: { paddingTop: 20 } }}>
        <Form form={form} layout="vertical">
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input placeholder="登录用户名" disabled={!!editingId} prefix={<UserOutlined />} />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="real_name" label="姓名">
                <Input placeholder="真实姓名" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="phone" label="手机号">
                <Input placeholder="手机号" prefix={<PhoneOutlined />} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="alipay_account" label="支付宝账号">
            <Input placeholder="支付宝收款账号" prefix={<AlipayCircleOutlined />} />
          </Form.Item>
          {!editingId && (
            <Form.Item name="password" label="初始密码" rules={[{ required: true, message: '请输入初始密码' }]}>
              <Input.Password placeholder="初始密码" />
            </Form.Item>
          )}
        </Form>
      </Modal>

      {/* Batch Add Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #52c41a, #95de64)', color: '#fff', fontSize: 13,
            }}><TeamOutlined /></span>
            批量添加工人
          </div>
        }
        open={batchAddOpen}
        onCancel={() => setBatchAddOpen(false)}
        confirmLoading={batchAddLoading}
        okText="创建"
        cancelText="取消"
        width={520}
        onOk={async () => {
          if (!batchAddText.trim()) { message.warning('请输入用户名'); return; }
          setBatchAddLoading(true);
          try {
            const r = await api.post('/workers/batch-create', { usernames: batchAddText, default_password: batchPwd });
            const d = r.data?.data;
            message.success(`成功创建 ${d?.total_created || 0} 名工人${d?.total_skipped ? `，跳过 ${d.total_skipped} 名` : ''}`);
            if (d?.skipped?.length) {
              d.skipped.forEach((s: any) => message.warning(`跳过 ${s.username}：${s.reason}`));
            }
            setBatchAddOpen(false);
            setBatchAddText('');
            fetchData();
          } catch (e: any) { message.error(e?.response?.data?.detail || '批量创建失败'); }
          finally { setBatchAddLoading(false); }
        }}
      >
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)', display: 'block', marginBottom: 6 }}>
              用户名列表（每行一个）
            </label>
            <Input.TextArea
              value={batchAddText}
              onChange={e => setBatchAddText(e.target.value)}
              rows={8}
              placeholder={'张三\n李四\n王五\n...'}
              style={{ borderRadius: 10 }}
            />
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
              每行输入一个用户名，已存在的会自动跳过
            </div>
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)', display: 'block', marginBottom: 6 }}>
              统一初始密码
            </label>
            <Input.Password value={batchPwd} onChange={e => setBatchPwd(e.target.value)} style={{ borderRadius: 10 }} />
          </div>
        </div>
      </Modal>

      {/* Batch Reset Password Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #ff4d4f, #ff7875)', color: '#fff', fontSize: 13,
            }}><KeyOutlined /></span>
            批量重置密码
          </div>
        }
        open={batchResetOpen}
        onCancel={() => setBatchResetOpen(false)}
        confirmLoading={batchResetLoading}
        okText="确认重置"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        width={440}
        onOk={async () => {
          setBatchResetLoading(true);
          try {
            const r = await api.post('/workers/batch-reset-password', {
              worker_ids: selectedRowKeys,
              new_password: batchResetPwd,
            });
            message.success(r.data?.message || '重置成功');
            setBatchResetOpen(false);
            setSelectedRowKeys([]);
          } catch (e: any) { message.error(e?.response?.data?.detail || '重置失败'); }
          finally { setBatchResetLoading(false); }
        }}
      >
        <div style={{ marginTop: 16 }}>
          <div style={{
            padding: '12px 16px', borderRadius: 10, marginBottom: 16,
            background: 'rgba(255,77,79,0.04)', border: '1px solid rgba(255,77,79,0.12)',
          }}>
            <WarningOutlined style={{ color: '#ff4d4f', marginRight: 6 }} />
            将重置 <strong>{selectedRowKeys.length}</strong> 名工人的密码
          </div>
          <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-1)', display: 'block', marginBottom: 6 }}>
            新密码
          </label>
          <Input.Password value={batchResetPwd} onChange={e => setBatchResetPwd(e.target.value)} style={{ borderRadius: 10 }} />
        </div>
      </Modal>

      <WorkerProfileModal
        workerId={profileWorkerId}
        open={profileOpen}
        onClose={() => { setProfileOpen(false); setProfileWorkerId(null); }}
      />
    </div>
  );
}
