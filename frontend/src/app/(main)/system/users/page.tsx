'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Input, Button, Table, Tag, Tooltip, Row, Col, Segmented,
  Modal, Form, message, Avatar, Space, Popconfirm, Select,
} from 'antd';
import {
  UserOutlined, SearchOutlined, ReloadOutlined, PlusOutlined,
  EditOutlined, DeleteOutlined, KeyOutlined, CrownOutlined,
  TeamOutlined, SafetyCertificateOutlined, DownloadOutlined,
  PhoneOutlined, WalletOutlined,
} from '@ant-design/icons';
import api from '@/services/api';

interface UserItem {
  id: number; username: string; role: string;
  real_name: string | null; phone: string | null; alipay_account: string | null;
}
interface UsersData {
  items: UserItem[]; total: number; page: number; page_size: number;
  admin_count: number; worker_count: number;
}

const ROLE_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode; gradient: string }> = {
  admin: { label: '管理员', color: 'purple', icon: <CrownOutlined />, gradient: 'linear-gradient(135deg, #722ed1, #b37feb)' },
  worker: { label: '工人', color: 'blue', icon: <TeamOutlined />, gradient: 'linear-gradient(135deg, #1677ff, #69b1ff)' },
};

export default function UsersPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<UsersData | null>(null);
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserItem | null>(null);
  const [createForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async (p?: number) => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page: p ?? page, page_size: 50 };
      if (roleFilter !== 'all') params.role = roleFilter;
      if (keyword.trim()) params.keyword = keyword.trim();
      const res = await api.get('/system/users', { params });
      setData(res.data?.data || null);
    } catch { message.error('加载用户列表失败'); }
    finally { setLoading(false); }
  }, [roleFilter, keyword, page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const handleCreate = async () => {
    const values = await createForm.validateFields();
    setSubmitting(true);
    try {
      await api.post('/system/users', values);
      message.success('管理员创建成功');
      setCreateOpen(false);
      createForm.resetFields();
      fetchData();
    } catch (e: any) { message.error(e?.response?.data?.detail || '创建失败'); }
    finally { setSubmitting(false); }
  };

  const handleEdit = async () => {
    if (!editUser) return;
    const values = await editForm.validateFields();
    setSubmitting(true);
    try {
      await api.put(`/system/users/${editUser.id}`, values);
      message.success('更新成功');
      setEditOpen(false);
      setEditUser(null);
      editForm.resetFields();
      fetchData();
    } catch (e: any) { message.error(e?.response?.data?.detail || '更新失败'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (userId: number) => {
    try {
      await api.delete(`/system/users/${userId}`);
      message.success('删除成功');
      fetchData();
    } catch (e: any) { message.error(e?.response?.data?.detail || '删除失败'); }
  };

  const handleResetPwd = async (userId: number) => {
    try {
      await api.post(`/system/users/${userId}/reset-password`);
      message.success('密码已重置为 123456');
    } catch (e: any) { message.error(e?.response?.data?.detail || '重置失败'); }
  };

  const openEdit = (u: UserItem) => {
    setEditUser(u);
    editForm.setFieldsValue({ real_name: u.real_name, phone: u.phone, alipay_account: u.alipay_account });
    setEditOpen(true);
  };

  const exportCSV = () => {
    if (!data?.items?.length) { message.warning('暂无数据'); return; }
    const headers = ['ID,用户名,角色,真实姓名,手机号,支付宝'];
    const rows = data.items.map(u => `${u.id},${u.username},${u.role === 'admin' ? '管理员' : '工人'},${u.real_name || ''},${u.phone || ''},${u.alipay_account || ''}`);
    const csv = '\uFEFF' + [...headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = '用户列表.csv'; a.click();
    URL.revokeObjectURL(url); message.success('导出成功');
  };

  const columns = [
    {
      title: '用户', key: 'user', width: 200,
      render: (_: unknown, r: UserItem) => {
        const rc = ROLE_CONFIG[r.role] || ROLE_CONFIG.worker;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar size={36} style={{ background: rc.gradient, fontWeight: 700, fontSize: 14 }}>
              {(r.real_name || r.username).charAt(0).toUpperCase()}
            </Avatar>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{r.real_name || r.username}</div>
              <div style={{ fontSize: 11, color: 'var(--text-4)' }}>@{r.username} · ID {r.id}</div>
            </div>
          </div>
        );
      },
    },
    {
      title: '角色', dataIndex: 'role', width: 100, align: 'center' as const,
      render: (v: string) => {
        const rc = ROLE_CONFIG[v] || ROLE_CONFIG.worker;
        return <Tag color={rc.color} icon={rc.icon} style={{ borderRadius: 8, fontWeight: 600, fontSize: 12 }}>{rc.label}</Tag>;
      },
    },
    {
      title: '手机', dataIndex: 'phone', width: 130,
      render: (v: string | null) => v ? <span style={{ fontSize: 12, color: 'var(--text-2)' }}><PhoneOutlined style={{ marginRight: 4 }} />{v}</span> : <span style={{ color: 'var(--text-4)', fontSize: 12 }}>未设置</span>,
    },
    {
      title: '支付宝', dataIndex: 'alipay_account', width: 140, ellipsis: true,
      render: (v: string | null) => v ? <span style={{ fontSize: 12, color: 'var(--text-2)' }}><WalletOutlined style={{ marginRight: 4 }} />{v}</span> : <span style={{ color: 'var(--text-4)', fontSize: 12 }}>未设置</span>,
    },
    {
      title: '操作', key: 'action', width: 150, align: 'center' as const,
      render: (_: unknown, r: UserItem) => (
        <Space size={4}>
          <Tooltip title="编辑">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} style={{ borderRadius: 6, color: '#1677ff' }} />
          </Tooltip>
          <Tooltip title="重置密码">
            <Popconfirm title="确认重置密码为 123456？" onConfirm={() => handleResetPwd(r.id)} okText="确认" cancelText="取消">
              <Button type="text" size="small" icon={<KeyOutlined />} style={{ borderRadius: 6, color: '#fa8c16' }} />
            </Popconfirm>
          </Tooltip>
          <Tooltip title="删除">
            <Popconfirm title={`确认删除用户 ${r.username}？`} onConfirm={() => handleDelete(r.id)} okText="确认" cancelText="取消">
              <Button type="text" size="small" icon={<DeleteOutlined />} danger style={{ borderRadius: 6 }} />
            </Popconfirm>
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #722ed1 0%, #eb2f96 50%, #f5222d 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -40, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{
              width: 44, height: 44, borderRadius: 14,
              background: 'rgba(255,255,255,0.2)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 22,
            }}><SafetyCertificateOutlined /></span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>用户管理</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>管理所有系统用户 · 管理员 + 工人</div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
        {[
          { label: '管理员', value: data?.admin_count ?? 0, icon: <CrownOutlined />, bg: 'linear-gradient(135deg, #722ed1, #b37feb)', glow: 'rgba(114,46,209,0.15)' },
          { label: '工人', value: data?.worker_count ?? 0, icon: <TeamOutlined />, bg: 'linear-gradient(135deg, #1677ff, #69b1ff)', glow: 'rgba(22,119,255,0.15)' },
          { label: '总用户', value: data?.total ?? 0, icon: <UserOutlined />, bg: 'linear-gradient(135deg, #00b96b, #5cdbd3)', glow: 'rgba(0,185,107,0.15)' },
        ].map((s, i) => (
          <Col xs={8} key={i}>
            <div style={{
              padding: '14px 16px', borderRadius: 14, background: s.bg,
              boxShadow: `0 4px 14px ${s.glow}`,
              animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.08}s`,
            }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                {s.icon} {s.label}
              </div>
              <div className="num" style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>{s.value}</div>
            </div>
          </Col>
        ))}
      </Row>

      {/* Filters + Actions */}
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head">
          <span className="panel-title"><SearchOutlined style={{ color: '#722ed1' }} /> 筛选</span>
          <Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}
              style={{ borderRadius: 10, fontWeight: 600, background: 'linear-gradient(135deg, #722ed1, #eb2f96)', border: 'none' }}>
              新增管理员
            </Button>
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 8 }} />
            <Button icon={<DownloadOutlined />} onClick={exportCSV} style={{ borderRadius: 8 }}>导出</Button>
          </Space>
        </div>
        <div style={{ padding: '14px 20px' }}>
          <Row gutter={[12, 12]} align="middle">
            <Col xs={24} sm={8}>
              <Segmented value={roleFilter} onChange={v => { setRoleFilter(v as string); setPage(1); }}
                options={[
                  { value: 'all', label: '全部' },
                  { value: 'admin', label: <span><CrownOutlined style={{ marginRight: 4 }} />管理员</span> },
                  { value: 'worker', label: <span><TeamOutlined style={{ marginRight: 4 }} />工人</span> },
                ]} style={{ borderRadius: 10 }} />
            </Col>
            <Col xs={24} sm={16}>
              <Input prefix={<SearchOutlined style={{ color: 'var(--text-4)' }} />}
                placeholder="搜索用户名或姓名" value={keyword}
                onChange={e => setKeyword(e.target.value)}
                onPressEnter={() => { setPage(1); fetchData(1); }}
                allowClear style={{ borderRadius: 8 }} />
            </Col>
          </Row>
        </div>
      </div>

      {/* Table */}
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title"><UserOutlined style={{ color: '#722ed1' }} /> 用户列表</span>
          <span style={{ fontSize: 12, color: 'var(--text-4)' }}>共 {data?.total ?? 0} 个</span>
        </div>
        <Table
          dataSource={data?.items || []}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{
            current: page, pageSize: 50, total: data?.total ?? 0,
            showTotal: t => `共 ${t} 个`, size: 'small',
            onChange: p => { setPage(p); fetchData(p); },
          }}
          size="small"
        />
      </div>

      {/* Create Modal */}
      <Modal title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #722ed1, #eb2f96)', color: '#fff', fontSize: 13 }}><PlusOutlined /></span>
          新增管理员
        </div>
      } open={createOpen} onOk={handleCreate} onCancel={() => { setCreateOpen(false); createForm.resetFields(); }}
        confirmLoading={submitting} okText="创建" cancelText="取消" width={420}>
        <Form form={createForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
            <Input placeholder="管理员用户名" style={{ borderRadius: 8 }} />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }, { min: 4, message: '密码至少4位' }]}>
            <Input.Password placeholder="设置密码" style={{ borderRadius: 8 }} />
          </Form.Item>
          <Form.Item name="real_name" label="真实姓名">
            <Input placeholder="可选" style={{ borderRadius: 8 }} />
          </Form.Item>
          <Form.Item name="phone" label="手机号">
            <Input placeholder="可选" style={{ borderRadius: 8 }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit Modal */}
      <Modal title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #1677ff, #69b1ff)', color: '#fff', fontSize: 13 }}><EditOutlined /></span>
          编辑用户 · {editUser?.username}
        </div>
      } open={editOpen} onOk={handleEdit} onCancel={() => { setEditOpen(false); setEditUser(null); editForm.resetFields(); }}
        confirmLoading={submitting} okText="保存" cancelText="取消" width={420}>
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="real_name" label="真实姓名">
            <Input placeholder="真实姓名" style={{ borderRadius: 8 }} />
          </Form.Item>
          <Form.Item name="phone" label="手机号">
            <Input placeholder="手机号" style={{ borderRadius: 8 }} />
          </Form.Item>
          <Form.Item name="alipay_account" label="支付宝账号">
            <Input placeholder="支付宝" style={{ borderRadius: 8 }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
