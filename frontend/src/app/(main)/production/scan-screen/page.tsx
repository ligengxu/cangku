'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Card, Row, Col, Tag, Space, Button, Table, Statistic, Empty, Tooltip, Modal, Input, message, Popconfirm, Form, Select, Progress } from 'antd';
import {
  CheckCircleFilled, CloseCircleFilled, ReloadOutlined,
  DesktopOutlined, CopyOutlined, SoundOutlined,
  DashboardOutlined, PlusOutlined, EditOutlined,
  DeleteOutlined, ExpandOutlined, ApiOutlined, WifiOutlined,
  DisconnectOutlined, ScanOutlined, ThunderboltOutlined, BugOutlined,
} from '@ant-design/icons';
import api from '@/services/api';

interface MachineInfo {
  id: number;
  machine_number: string;
  name: string;
  status: string;
  total_scans: number;
  today_success: number;
  today_fail: number;
  last_active: string | null;
}

interface ScanRecord {
  id: number;
  tickets_num: string;
  weight: number;
  estimated_weight: number;
  sku_name: string;
  is_success: boolean;
  message: string;
  upload_time: string;
  weight_difference: number;
  worker_name: string;
}

export default function ScanScreenPage() {
  const [machines, setMachines] = useState<MachineInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null);
  const [records, setRecords] = useState<ScanRecord[]>([]);
  const [scanCount, setScanCount] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const lastIdRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  

  const [createModal, setCreateModal] = useState(false);
  const [editModal, setEditModal] = useState<MachineInfo | null>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const fetchMachines = useCallback(async () => {
    try {
      const res = await api.get('/device/machines');
      setMachines(res.data?.data || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchMachines(); const t = setInterval(fetchMachines, 8000); return () => clearInterval(t); }, [fetchMachines]);

  const startPolling = useCallback((machine: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    lastIdRef.current = 0;
    setRecords([]);
    setScanCount(0);
    setFailCount(0);
    const poll = async () => {
      try {
        const res = await api.get(`/device/latest-records/${encodeURIComponent(machine)}/${lastIdRef.current}`);
        const data = res.data?.data;
        if (!data) return;
        setScanCount(data.scan_count || 0);
        setFailCount(data.fail_count || 0);
        const nr = (data.records || []) as ScanRecord[];
        if (nr.length > 0) {
          nr.forEach(r => { if (r.id > lastIdRef.current) lastIdRef.current = r.id; });
          setRecords(prev => [...nr.reverse(), ...prev].slice(0, 200));
        }
      } catch { /* ignore */ }
    };
    poll();
    pollRef.current = setInterval(poll, 1000);
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const selectMachine = (m: string) => { setSelectedMachine(m); startPolling(m); };

  const getLink = (mn: string) => `${typeof window !== 'undefined' ? window.location.origin : ''}/api/device/scan-monitor?machine=${encodeURIComponent(mn)}`;
  const copyLink = (mn: string) => {
    const url = getLink(mn);
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(() => message.success('报数链接已复制'));
    } else {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); message.success('报数链接已复制'); }
      catch { message.error('复制失败，请手动复制'); }
      document.body.removeChild(ta);
    }
  };

  const isOnline = (m: MachineInfo) => m.status !== 'disabled' && m.last_active && (Date.now() - new Date(m.last_active).getTime()) < 300000;

  const handleCreate = async () => {
    try {
      const v = await createForm.validateFields();
      setSubmitting(true);
      await api.post('/device/machines', { machine_number: v.machine_number, name: v.name || '' });
      message.success('机器创建成功');
      setCreateModal(false);
      createForm.resetFields();
      fetchMachines();
    } catch (e: any) {
      if (e?.response?.data?.detail) message.error(e.response.data.detail);
    } finally { setSubmitting(false); }
  };

  const handleEdit = async () => {
    if (!editModal) return;
    try {
      const v = await editForm.validateFields();
      setSubmitting(true);
      await api.put(`/device/machines/${editModal.id}`, { machine_number: v.machine_number, name: v.name, status: v.status });
      message.success('修改成功');
      setEditModal(null);
      fetchMachines();
    } catch (e: any) {
      if (e?.response?.data?.detail) message.error(e.response.data.detail);
    } finally { setSubmitting(false); }
  };

  const handleDelete = async (m: MachineInfo) => {
    try {
      await api.delete(`/device/machines/${m.id}`);
      message.success(`机器 ${m.machine_number} 已删除`);
      if (selectedMachine === m.machine_number) { setSelectedMachine(null); if (pollRef.current) clearInterval(pollRef.current); }
      fetchMachines();
    } catch (e: any) { message.error(e?.response?.data?.detail || '删除失败'); }
  };

  const numValidator = (_: any, value: string) => !value || !/^\d+$/.test(value.trim()) ? Promise.reject('机器号必须是纯数字') : Promise.resolve();

  const totalOk = machines.reduce((s, m) => s + m.today_success, 0);
  const totalFail = machines.reduce((s, m) => s + m.today_fail, 0);
  const onlineCount = machines.filter(isOnline).length;

  const columns = [
    { title: '时间', dataIndex: 'upload_time', width: 85, render: (v: string) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v?.split('T')[1]?.substring(0, 8) || ''}</span> },
    { title: '条码', dataIndex: 'tickets_num', width: 105, render: (v: string) => <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{v}</span> },
    { title: 'SKU', dataIndex: 'sku_name', width: 115, ellipsis: true },
    { title: '应有', dataIndex: 'estimated_weight', width: 70, render: (v: number) => v ? `${v.toFixed(2)}` : '-' },
    { title: '实际', dataIndex: 'weight', width: 70, render: (v: number) => v ? `${v.toFixed(2)}` : '-' },
    { title: '差值', dataIndex: 'weight_difference', width: 70, render: (v: number) => { const a = Math.abs(v || 0); return <span style={{ color: a > 0.5 ? '#fa8c16' : 'inherit', fontWeight: a > 0.5 ? 700 : 400 }}>{v >= 0 ? '+' : ''}{(v || 0).toFixed(2)}</span>; } },
    { title: '工人', dataIndex: 'worker_name', width: 75 },
    { title: '状态', dataIndex: 'is_success', width: 66, render: (v: boolean) => v ? <Tag color="success" style={{ borderRadius: 10, fontSize: 11 }}>成功</Tag> : <Tag color="error" style={{ borderRadius: 10, fontSize: 11 }}>失败</Tag> },
    { title: '原因', dataIndex: 'message', ellipsis: true, render: (v: string, r: ScanRecord) => !r.is_success ? <span style={{ color: '#ff4d4f', fontSize: 12 }}>{v}</span> : null },
  ];

  
  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        marginBottom: 20, padding: '20px 24px', borderRadius: 'var(--radius-l)',
        background: 'linear-gradient(135deg, rgba(99,102,241,0.06) 0%, rgba(139,92,246,0.03) 100%)',
        border: '1px solid rgba(99,102,241,0.08)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 34, height: 34, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', fontSize: 16 }}><DashboardOutlined /></span>
            扫码监控中心
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 44 }}>管理称重机 · 实时监控扫码 · 生成报数链接</div>
        </div>
        <Space wrap>
          <Button icon={<ExpandOutlined />} onClick={() => window.open('/api/device/scan-dashboard', '_blank')} style={{ borderRadius: 10 }}>扫码大屏</Button>
          <Button icon={<DesktopOutlined />} onClick={() => window.open('/api/device/scan-monitor-download', '_blank')}
            style={{ borderRadius: 10, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none', color: '#fff' }}
            title="Go版一体化客户端 v4.2 — 单文件7.5MB零依赖">
            Go客户端 v4.2
          </Button>
          <Button icon={<ApiOutlined />} onClick={() => window.open('/api/device/scan-monitor-download-py', '_blank')}
            style={{ borderRadius: 10, background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', color: '#fff' }}
            title="Python GUI版 v8.1 — 双模块并行解码，需Python环境">
            Python客户端 v8.1
          </Button>
          <Button icon={<BugOutlined />} onClick={() => window.open('/api/device/scan-monitor-download-debug', '_blank')}
            style={{ borderRadius: 10, background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none', color: '#fff' }}
            title="条码调试工具 — 千问AI辅助+并行暴力搜索最佳配置">
            调试工具
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); setCreateModal(true); }} style={{ borderRadius: 10 }}>新建机器</Button>
          <Button icon={<ReloadOutlined />} onClick={fetchMachines} style={{ borderRadius: 10 }}>刷新</Button>
        </Space>
      </div>

      {/* 汇总统计 */}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={6}><Card size="small" style={{ borderRadius: 14, background: 'linear-gradient(135deg, rgba(99,102,241,0.06), rgba(99,102,241,0.02))', border: '1px solid rgba(99,102,241,0.1)' }}><Statistic title={<span style={{ fontSize: 11 }}>机器总数</span>} value={machines.length} prefix={<DesktopOutlined />} valueStyle={{ fontWeight: 800 }} /></Card></Col>
        <Col xs={6}><Card size="small" style={{ borderRadius: 14, background: 'linear-gradient(135deg, rgba(16,185,129,0.06), rgba(16,185,129,0.02))', border: '1px solid rgba(16,185,129,0.1)' }}><Statistic title={<span style={{ fontSize: 11 }}>在线</span>} value={onlineCount} prefix={<WifiOutlined />} valueStyle={{ color: '#10b981', fontWeight: 800 }} /></Card></Col>
        <Col xs={6}><Card size="small" style={{ borderRadius: 14, background: 'linear-gradient(135deg, rgba(16,185,129,0.06), rgba(16,185,129,0.02))', border: '1px solid rgba(16,185,129,0.1)' }}><Statistic title={<span style={{ fontSize: 11 }}>今日成功</span>} value={totalOk} prefix={<CheckCircleFilled />} valueStyle={{ color: '#10b981', fontWeight: 800 }} /></Card></Col>
        <Col xs={6}><Card size="small" style={{ borderRadius: 14, background: 'linear-gradient(135deg, rgba(239,68,68,0.06), rgba(239,68,68,0.02))', border: '1px solid rgba(239,68,68,0.1)' }}><Statistic title={<span style={{ fontSize: 11 }}>今日失败</span>} value={totalFail} prefix={<CloseCircleFilled />} valueStyle={{ color: '#ef4444', fontWeight: 800 }} /></Card></Col>
      </Row>

      {/* 机器卡片 */}
      <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
        {machines.map(m => {
          const on = isOnline(m);
          const sel = selectedMachine === m.machine_number;
          const total = m.today_success + m.today_fail;
          const rate = total > 0 ? Math.round((m.today_success / total) * 100) : 0;
          return (
            <Col key={m.id} xs={12} sm={8} md={6}>
              <div
                onClick={() => selectMachine(m.machine_number)}
                style={{
                  padding: '16px 18px', borderRadius: 14, cursor: 'pointer', transition: 'all 0.25s',
                  border: sel ? '2px solid var(--brand)' : '1px solid rgba(0,0,0,0.05)',
                  background: sel ? 'linear-gradient(135deg, rgba(99,102,241,0.06), rgba(99,102,241,0.02))' : m.status === 'disabled' ? 'rgba(0,0,0,0.02)' : 'var(--glass-bg, #fff)',
                  opacity: m.status === 'disabled' ? 0.5 : 1,
                  boxShadow: sel ? '0 4px 16px rgba(99,102,241,0.12)' : '0 1px 3px rgba(0,0,0,0.04)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: on ? 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(16,185,129,0.05))' : 'rgba(0,0,0,0.03)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <DesktopOutlined style={{ fontSize: 16, color: on ? '#10b981' : '#9ca3af' }} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 16 }}>#{m.machine_number}</div>
                      {m.name && <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{m.name}</div>}
                    </div>
                  </div>
                  <Tag
                    color={on ? 'success' : m.status === 'disabled' ? 'error' : 'default'}
                    icon={on ? <WifiOutlined /> : m.status === 'disabled' ? <DisconnectOutlined /> : <DisconnectOutlined />}
                    style={{ borderRadius: 10, fontSize: 11, fontWeight: 600, margin: 0 }}
                  >
                    {on ? '在线' : m.status === 'disabled' ? '停用' : '离线'}
                  </Tag>
                </div>

                <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: '#10b981', fontWeight: 700 }}>✓ {m.today_success}</span>
                  <span style={{ fontSize: 13, color: '#ef4444', fontWeight: 700 }}>✗ {m.today_fail}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-4)' }}>共 {m.total_scans.toLocaleString()}</span>
                </div>

                {total > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <Progress percent={rate} size="small" showInfo={false} strokeColor={rate > 95 ? '#10b981' : rate > 80 ? '#f59e0b' : '#ef4444'} style={{ flex: 1 }} />
                    <span style={{ fontSize: 11, color: 'var(--text-3)', minWidth: 30 }}>{rate}%</span>
                  </div>
                )}

                <div style={{ display: 'flex', gap: 4 }}>
                  <Tooltip title="复制报数链接"><Button type="text" size="small" icon={<CopyOutlined />} onClick={e => { e.stopPropagation(); copyLink(m.machine_number); }} style={{ fontSize: 11, height: 26, borderRadius: 6 }}>链接</Button></Tooltip>
                  <Tooltip title="打开报数页面"><Button type="text" size="small" icon={<SoundOutlined />} onClick={e => { e.stopPropagation(); window.open(getLink(m.machine_number), '_blank'); }} style={{ fontSize: 11, height: 26, borderRadius: 6 }}>报数</Button></Tooltip>
                  <Tooltip title="编辑"><Button type="text" size="small" icon={<EditOutlined />} onClick={e => { e.stopPropagation(); setEditModal(m); editForm.setFieldsValue({ machine_number: m.machine_number, name: m.name, status: m.status }); }} style={{ height: 26, borderRadius: 6 }} /></Tooltip>
                  <Popconfirm title={`确定删除 #${m.machine_number}？`} onConfirm={() => handleDelete(m)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={e => e.stopPropagation()} style={{ height: 26, borderRadius: 6 }} />
                  </Popconfirm>
                </div>
              </div>
            </Col>
          );
        })}
        {machines.length === 0 && !loading && (
          <Col span={24}><Empty description="暂无机器，点击「新建机器」添加" style={{ padding: 40 }}><Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); setCreateModal(true); }}>新建机器</Button></Empty></Col>
        )}
      </Row>

      {/* 选中机器详情 */}
      {selectedMachine && (
        <>
          <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
            <Col xs={8} md={6}>
              <Card size="small" style={{ borderRadius: 14, background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(16,185,129,0.02))', border: '1px solid rgba(16,185,129,0.12)' }}>
                <Statistic title={<span style={{ fontSize: 11 }}>今日成功</span>} value={scanCount} valueStyle={{ color: '#10b981', fontWeight: 800, fontSize: 26 }} prefix={<CheckCircleFilled />} />
              </Card>
            </Col>
            <Col xs={8} md={6}>
              <Card size="small" style={{ borderRadius: 14, background: 'linear-gradient(135deg, rgba(239,68,68,0.08), rgba(239,68,68,0.02))', border: '1px solid rgba(239,68,68,0.12)' }}>
                <Statistic title={<span style={{ fontSize: 11 }}>今日失败</span>} value={failCount} valueStyle={{ color: '#ef4444', fontWeight: 800, fontSize: 26 }} prefix={<CloseCircleFilled />} />
              </Card>
            </Col>
            <Col xs={8} md={6}>
              <Card size="small" style={{ borderRadius: 14 }}>
                <Statistic title={<span style={{ fontSize: 11 }}>成功率</span>} value={scanCount + failCount > 0 ? ((scanCount / (scanCount + failCount)) * 100).toFixed(1) : '0'} suffix="%" valueStyle={{ fontWeight: 800, fontSize: 26 }} />
              </Card>
            </Col>
            <Col xs={24} md={6}>
              <Card size="small" style={{ borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                <Button type="primary" icon={<SoundOutlined />} onClick={() => window.open(getLink(selectedMachine), '_blank')} style={{ borderRadius: 8 }}>打开报数页面</Button>
              </Card>
            </Col>
          </Row>
          <Card size="small" style={{ borderRadius: 14 }} title={<Space><ScanOutlined style={{ color: 'var(--brand)' }} /><span style={{ fontWeight: 700 }}>#{selectedMachine} 号机 · 实时扫码流水</span><Tag color="processing" style={{ borderRadius: 10, fontSize: 11 }}>实时</Tag></Space>}>
            <Table dataSource={records} columns={columns} rowKey="id" size="small" pagination={false} scroll={{ y: 380 }} />
          </Card>
        </>
      )}

      {/* 新建机器 */}
      <Modal title="新建称重机" open={createModal} onCancel={() => setCreateModal(false)} onOk={handleCreate} confirmLoading={submitting} okText="创建" cancelText="取消" width={420}>
        <Form form={createForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="machine_number" label="机器编号" rules={[{ required: true, message: '请输入' }, { validator: numValidator }]}>
            <Input placeholder="纯数字，如 1、2、3" maxLength={10} size="large" style={{ fontSize: 18, fontWeight: 700, textAlign: 'center' }} />
          </Form.Item>
          <Form.Item name="name" label="备注名称"><Input placeholder="如：1号流水线" /></Form.Item>
        </Form>
      </Modal>

      {/* 编辑机器 */}
      <Modal title={`编辑 #${editModal?.machine_number || ''}`} open={!!editModal} onCancel={() => setEditModal(null)} onOk={handleEdit} confirmLoading={submitting} okText="保存" cancelText="取消" width={420}>
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="machine_number" label="机器编号" rules={[{ required: true, message: '请输入' }, { validator: numValidator }]}>
            <Input placeholder="纯数字" maxLength={10} size="large" style={{ fontSize: 18, fontWeight: 700, textAlign: 'center' }} />
          </Form.Item>
          <Form.Item name="name" label="备注名称"><Input placeholder="如：1号流水线" /></Form.Item>
          <Form.Item name="status" label="状态"><Select options={[{ value: 'online', label: '🟢 在线' }, { value: 'offline', label: '⚪ 离线' }, { value: 'disabled', label: '🔴 停用' }]} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
