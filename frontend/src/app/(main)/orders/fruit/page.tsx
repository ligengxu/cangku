'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Modal, Form, Input, InputNumber, DatePicker, Select,
  Tag, Space, message, Popconfirm, Row, Col, Tooltip, Upload, Progress, Alert,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined,
  ReloadOutlined, DollarOutlined, ShoppingCartOutlined,
  FilterOutlined, DownloadOutlined, FileTextOutlined,
  CheckCircleOutlined, CloseCircleOutlined, InboxOutlined,
  UploadOutlined, CloudUploadOutlined, WarningOutlined,
  RobotOutlined, HistoryOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import { useAuth } from '@/stores/useAuth';
import type { FruitPurchase, PaginatedResponse, Supplier, Fruit } from '@/types';
import { exportToCsv } from '@/utils/exportCsv';
import dayjs from 'dayjs';

export default function FruitOrdersPage() {
  const { isAdmin } = useAuth();
  const [data, setData] = useState<FruitPurchase[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form] = Form.useForm();
  const [searchForm] = Form.useForm();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [fruits, setFruits] = useState<Fruit[]>([]);
  const [quickSupplierOpen, setQuickSupplierOpen] = useState(false);
  const [quickFruitOpen, setQuickFruitOpen] = useState(false);
  const [quickName, setQuickName] = useState('');
  const [quickSaving, setQuickSaving] = useState(false);
  const [supMgrOpen, setSupMgrOpen] = useState(false);
  const [supEditId, setSupEditId] = useState<number | null>(null);
  const [supEditName, setSupEditName] = useState('');
  const [supEditPhone, setSupEditPhone] = useState('');
  const [supEditContact, setSupEditContact] = useState('');
  const [supSaving, setSupSaving] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; errors: string[]; total_rows: number; error_count: number } | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<Record<number, any>>({});
  const [migrateModalOpen, setMigrateModalOpen] = useState(false);
  const [migrateLoading, setMigrateLoading] = useState(false);

  const [filters, setFilters] = useState({
    page: 1, page_size: 20,
    fruit_name: '', supplier_name: '',
    start_date: '', end_date: '', payment_status: '',
  });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string | number> = { page: filters.page, page_size: filters.page_size };
      if (filters.fruit_name) params.fruit_name = filters.fruit_name;
      if (filters.supplier_name) params.supplier_name = filters.supplier_name;
      if (filters.start_date) params.start_date = filters.start_date;
      if (filters.end_date) params.end_date = filters.end_date;
      if (filters.payment_status) params.payment_status = filters.payment_status;
      const res = await api.get<PaginatedResponse<FruitPurchase>>('/orders/fruit', { params });
      setData(res.data.data ?? []);
      setTotal(res.data.total ?? 0);
    } catch { message.error('加载失败'); setData([]); }
    finally { setLoading(false); }
  }, [filters]);

  const fetchProgress = useCallback(async () => {
    try {
      const res = await api.get('/orders/fruit/batch-progress', { params: { page: filters.page, page_size: filters.page_size } });
      const items = res.data?.data?.items || [];
      const map: Record<number, any> = {};
      items.forEach((it: any) => { map[it.id] = it; });
      setBatchProgress(map);
    } catch { /* non-critical */ }
  }, [filters.page, filters.page_size]);

  const fetchOptions = useCallback(async () => {
    try {
      const [supRes, frRes] = await Promise.all([
        api.get('/inventory/suppliers').catch(() => ({ data: { data: [] } })),
        api.get('/inventory/fruits').catch(() => ({ data: { data: [] } })),
      ]);
      setSuppliers((supRes.data as any)?.data ?? []);
      setFruits((frRes.data as any)?.data ?? []);
    } catch { /* optional */ }
  }, []);

  useEffect(() => { fetchData(); fetchProgress(); }, [fetchData, fetchProgress]);
  useEffect(() => { fetchOptions(); }, [fetchOptions]);

  const handleQuickAddSupplier = async () => {
    if (!quickName.trim()) { message.warning('请输入供应商名称'); return; }
    setQuickSaving(true);
    try {
      const res = await api.post('/inventory/suppliers', { name: quickName.trim(), type: 'fruit' });
      const newSup = (res.data as any)?.data;
      if (newSup) {
        setSuppliers(prev => [...prev, newSup]);
        form.setFieldsValue({ supplier_id: newSup.id });
        message.success(`供应商「${newSup.name}」已创建`);
      }
      setQuickName('');
      setQuickSupplierOpen(false);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '创建失败');
    } finally { setQuickSaving(false); }
  };

  const handleQuickAddFruit = async () => {
    if (!quickName.trim()) { message.warning('请输入水果名称'); return; }
    setQuickSaving(true);
    try {
      const res = await api.post('/inventory/fruits', { name: quickName.trim() });
      const newFr = (res.data as any)?.data;
      if (newFr) {
        setFruits(prev => [...prev, newFr]);
        form.setFieldsValue({ fruit_id: newFr.id });
        message.success(`水果「${newFr.name}」已创建`);
      }
      setQuickName('');
      setQuickFruitOpen(false);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '创建失败');
    } finally { setQuickSaving(false); }
  };

  const startEditSupplier = (s: Supplier) => {
    setSupEditId(s.id); setSupEditName(s.name); setSupEditPhone(s.phone || ''); setSupEditContact(s.contact_person || '');
  };

  const handleSaveSupplier = async () => {
    if (!supEditName.trim()) { message.warning('名称不能为空'); return; }
    setSupSaving(true);
    try {
      if (supEditId) {
        await api.put(`/inventory/suppliers/${supEditId}`, { name: supEditName.trim(), phone: supEditPhone, contact_person: supEditContact });
        setSuppliers(prev => prev.map(s => s.id === supEditId ? { ...s, name: supEditName.trim(), phone: supEditPhone, contact_person: supEditContact } : s));
        message.success('供应商已更新');
      } else {
        const res = await api.post('/inventory/suppliers', { name: supEditName.trim(), type: 'fruit', phone: supEditPhone, contact_person: supEditContact });
        const ns = (res.data as any)?.data;
        if (ns) setSuppliers(prev => [...prev, ns]);
        message.success('供应商已创建');
      }
      setSupEditId(null); setSupEditName(''); setSupEditPhone(''); setSupEditContact('');
    } catch (e: any) { message.error(e?.response?.data?.detail || '操作失败'); }
    finally { setSupSaving(false); }
  };

  const handleDeleteSupplier = async (id: number) => {
    try {
      await api.delete(`/inventory/suppliers/${id}`);
      setSuppliers(prev => prev.filter(s => s.id !== id));
      message.success('已删除');
    } catch (e: any) { message.error(e?.response?.data?.detail || '删除失败'); }
  };

  const handleSearch = (v: any) => {
    setFilters(p => ({
      ...p, page: 1,
      fruit_name: v.fruit_name ?? '', supplier_name: v.supplier_name ?? '',
      start_date: v.date_range?.[0] ? dayjs(v.date_range[0]).format('YYYY-MM-DD') : '',
      end_date: v.date_range?.[1] ? dayjs(v.date_range[1]).format('YYYY-MM-DD') : '',
      payment_status: v.payment_status ?? '',
    }));
  };

  const handleReset = () => {
    searchForm.resetFields();
    setFilters({ page: 1, page_size: 20, fruit_name: '', supplier_name: '', start_date: '', end_date: '', payment_status: '' });
  };

  const handleRefresh = async () => {
    setRefreshSpin(true);
    await fetchData();
    setTimeout(() => setRefreshSpin(false), 400);
  };

  const handleAdd = () => { setEditingId(null); form.resetFields(); setModalOpen(true); };

  const handleEdit = (r: FruitPurchase) => {
    setEditingId(r.id);
    form.setFieldsValue({
      supplier_id: r.supplier_id, fruit_id: r.fruit_id,
      supplier_name: r.supplier_name, fruit_name: r.fruit_name,
      purchase_date: r.purchase_date ? dayjs(r.purchase_date) : null,
      purchase_price: r.purchase_price, purchase_weight: r.purchase_weight,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const v = await form.validateFields();
      const hasOpts = suppliers.length > 0 && fruits.length > 0;
      const payload: any = {
        purchase_date: v.purchase_date ? dayjs(v.purchase_date).format('YYYY-MM-DD') : undefined,
        purchase_price: v.purchase_price, purchase_weight: v.purchase_weight,
      };
      if (hasOpts) { payload.supplier_id = v.supplier_id; payload.fruit_id = v.fruit_id; }
      else { payload.supplier_name = v.supplier_name; payload.fruit_name = v.fruit_name; }
      if (editingId) { await api.put(`/orders/fruit/${editingId}`, payload); message.success('更新成功'); }
      else {
        const res = await api.post('/orders/fruit', payload);
        const serverMsg = res.data?.message;
        if (serverMsg && serverMsg !== '创建成功' && serverMsg.includes('历史均价')) {
          message.warning(serverMsg, 6);
        } else {
          message.success('添加成功');
        }
      }
      setModalOpen(false); fetchData();
    } catch (err: any) {
      if (err?.errorFields) return;
      const detail = err?.response?.data?.detail || err?.response?.data?.message || err?.message || '操作失败';
      if (err?.response?.status === 409) { message.warning(detail, 6); }
      else { message.error(detail); }
    }
  };

  const handleDelete = async (id: number) => {
    try { await api.delete(`/orders/fruit/${id}`); message.success('已移入回收站'); fetchData(); }
    catch { message.error('删除失败'); }
  };

  const handleMigrateAllPaid = () => {
    setMigrateModalOpen(true);
  };

  const confirmMigrateAllPaid = async () => {
    setMigrateLoading(true);
    try {
      await api.post('/orders/migrate-all-paid');
      message.success('历史订单已全部标记为已付');
      setMigrateModalOpen(false);
      fetchData();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '操作失败');
    } finally {
      setMigrateLoading(false);
    }
  };

  const batchDelete = () => {
    if (!selectedKeys.length) return;
    Modal.confirm({
      title: `批量删除 ${selectedKeys.length} 条采购记录`,
      content: '删除后将移入回收站，可在系统管理→回收站中恢复。',
      okText: '确定删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await api.post('/orders/batch-delete', { order_type: 'fruit', order_ids: selectedKeys });
          message.success(res.data?.message || '批量删除成功');
          setSelectedKeys([]); fetchData();
        } catch (e: any) { message.error(e?.response?.data?.detail || '批量删除失败'); }
      },
    });
  };

  const handleImport = async (file: File) => {
    setImportLoading(true);
    setImportResult(null);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post('/orders/fruit/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const result = res.data?.data;
      setImportResult(result);
      if (result?.created > 0) {
        message.success(`成功导入 ${result.created} 条记录`);
        fetchData();
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '导入失败');
    } finally {
      setImportLoading(false);
    }
    return false;
  };

  const downloadTemplate = () => {
    const BOM = '\uFEFF';
    const header = '水果名称,供应商名称,采购日期,采购单价,采购重量,付款状态\n';
    const example = '芒果,张三水果批发,2025-03-01,5.50,100,unpaid\n';
    const blob = new Blob([BOM + header + example], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = '水果采购导入模板.csv';
    link.click();
    URL.revokeObjectURL(link.href);
    message.success('模板已下载');
  };

  const pageTotal = data.reduce((a, r) => a + (Number(r.purchase_price) || 0) * (Number(r.purchase_weight) || 0), 0);
  const unpaidCount = data.filter(r => r.payment_status !== 'paid').length;
  const paidCount = data.filter(r => r.payment_status === 'paid').length;
  const hasOpts = suppliers.length > 0 && fruits.length > 0;

  const statCards = [
    { label: '本页记录', value: data.length, unit: '条', icon: <FileTextOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.15)' },
    { label: '总记录', value: total, unit: '条', icon: <InboxOutlined />, gradient: 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: 'rgba(0,185,107,0.15)' },
    { label: '本页金额', value: `¥${pageTotal.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`, icon: <DollarOutlined />, gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.15)' },
    { label: '未付款', value: unpaidCount, unit: '条', icon: <CloseCircleOutlined />, gradient: 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)', glow: 'rgba(255,77,79,0.15)' },
  ];

  const columns: any[] = [
    {
      title: 'ID', dataIndex: 'id', width: 60, fixed: 'left',
      render: (v: number) => <span className="num" style={{ color: 'var(--text-4)', fontSize: 12 }}>#{v}</span>,
    },
    {
      title: '供应商', dataIndex: 'supplier_name', width: 120, ellipsis: true,
      render: (v: string) => <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{v || '-'}</span>,
    },
    {
      title: '水果', dataIndex: 'fruit_name', width: 100, ellipsis: true,
      render: (v: string) => (
        <span style={{
          display: 'inline-block', padding: '1px 8px', borderRadius: 6, fontSize: 12, fontWeight: 500,
          background: 'linear-gradient(135deg, rgba(0,185,107,0.08) 0%, rgba(0,185,107,0.03) 100%)',
          color: '#00b96b', border: '1px solid rgba(0,185,107,0.12)',
        }}>{v || '-'}</span>
      ),
    },
    {
      title: '采购日期', dataIndex: 'purchase_date', width: 110,
      render: (v: string) => v ? <span style={{ color: 'var(--text-2)' }}>{dayjs(v).format('YYYY-MM-DD')}</span> : '-',
      sorter: (a: any, b: any) => dayjs(a.purchase_date).unix() - dayjs(b.purchase_date).unix(),
    },
    {
      title: '单价 (¥/kg)', dataIndex: 'purchase_price', width: 110, align: 'right' as const,
      render: (v: any) => v != null ? <span className="num" style={{ color: 'var(--text-1)', fontWeight: 500 }}>{Number(v).toFixed(2)}</span> : '-',
      sorter: (a: any, b: any) => (Number(a.purchase_price) || 0) - (Number(b.purchase_price) || 0),
    },
    {
      title: '重量 (kg)', dataIndex: 'purchase_weight', width: 100, align: 'right' as const,
      render: (v: any) => v != null ? <span className="num" style={{ fontWeight: 500 }}>{Number(v).toLocaleString()}</span> : '-',
      sorter: (a: any, b: any) => (Number(a.purchase_weight) || 0) - (Number(b.purchase_weight) || 0),
    },
    {
      title: '总额 (¥)', key: 'amount', width: 120, align: 'right' as const,
      render: (_: any, r: FruitPurchase) => {
        const amt = (Number(r.purchase_price) || 0) * (Number(r.purchase_weight) || 0);
        return <span className="num" style={{ fontWeight: 700, color: '#fa8c16' }}>¥{amt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
      },
      sorter: (a: any, b: any) => ((Number(a.purchase_price) || 0) * (Number(a.purchase_weight) || 0)) - ((Number(b.purchase_price) || 0) * (Number(b.purchase_weight) || 0)),
    },
    {
      title: '付款', dataIndex: 'payment_status', width: 80, align: 'center' as const,
      render: (_: any, r: FruitPurchase) => (
        <Tag
          color={r.payment_status === 'paid' ? 'success' : 'error'}
          style={{
            borderRadius: 6, fontWeight: 500, fontSize: 12,
            padding: '1px 10px',
            boxShadow: r.payment_status === 'paid' ? '0 1px 4px rgba(82,196,26,0.15)' : '0 1px 4px rgba(255,77,79,0.15)',
          }}
          icon={r.payment_status === 'paid' ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
        >
          {r.payment_status === 'paid' ? '已付' : '未付'}
        </Tag>
      ),
      filters: [{ text: '已付款', value: 'paid' }, { text: '未付款', value: 'unpaid' }],
      onFilter: (v: string, r: any) => r.payment_status === v,
    },
    {
      title: '生产进度', key: 'progress', width: 140, align: 'center' as const,
      render: (_: any, r: FruitPurchase) => {
        const bp = batchProgress[r.id];
        if (!bp) return <span style={{ fontSize: 11, color: 'var(--text-4)' }}>-</span>;
        const stageLabels: Record<string, { text: string; color: string }> = {
          new: { text: '新建', color: '#8c8c8c' },
          assigned: { text: '已分配', color: '#1677ff' },
          producing: { text: '生产中', color: '#fa8c16' },
          shipping: { text: '出库中', color: '#722ed1' },
          completed: { text: '已完成', color: '#52c41a' },
        };
        const st = stageLabels[bp.stage] || stageLabels.new;
        return (
          <Tooltip title={`标签: ${bp.total_labels} · 出库: ${bp.outbound_labels} · 工人: ${bp.assigned_workers}`}>
            <div>
              <Tag style={{ borderRadius: 6, fontWeight: 600, fontSize: 10, margin: 0, color: st.color, background: `${st.color}10`, border: `1px solid ${st.color}20` }}>
                {st.text}
              </Tag>
              {bp.total_labels > 0 && (
                <Progress percent={bp.outbound_rate} size="small" showInfo={false}
                  strokeColor={st.color} trailColor="rgba(0,0,0,0.04)"
                  style={{ margin: '4px 0 0', lineHeight: 1 }} />
              )}
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: '操作', key: 'actions', width: 100, fixed: 'right' as const, align: 'center' as const,
      render: (_: any, r: FruitPurchase) => (
        <Space size={0}>
          <Tooltip title="编辑">
            <Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)}
              style={{ color: 'var(--brand)', borderRadius: 6 }} />
          </Tooltip>
          <Popconfirm title="确定移入回收站？" description="可在系统管理→回收站中恢复" onConfirm={() => handleDelete(r.id)} okText="移入回收站" cancelText="取消"
            okButtonProps={{ danger: true }}>
            <Tooltip title="删除">
              <Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ borderRadius: 6 }} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* ── 页头 ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22,
        padding: '20px 24px', borderRadius: 'var(--radius-l)',
        background: 'linear-gradient(135deg, rgba(22,119,255,0.05) 0%, rgba(250,140,22,0.03) 100%)',
        border: '1px solid rgba(22,119,255,0.06)',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 32, height: 32, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', color: '#fff', fontSize: 15,
              boxShadow: '0 3px 10px rgba(22,119,255,0.2)',
            }}><ShoppingCartOutlined /></span>
            水果采购
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 42 }}>管理水果采购订单，跟踪付款状态</div>
        </div>
        <Space size={8}>
          {/* 历史迁移按钮已完成使命，移除 */}
          <Tooltip title="AI 采购分析">
            <Button icon={<RobotOutlined />} onClick={async () => {
              setAiOpen(true); setAiContent(''); setAiLoading(true);
              try {
                const response = await fetch('/api/ai/chat', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                  body: JSON.stringify({ message: `请基于以下水果采购数据进行分析，给出价格走势、供应商推荐和采购建议。注意：仅基于提供的数据分析，不要编造不存在的数据。\n\n采购数据(共${data.length}条，展示前20条):\n${data.slice(0, 20).map(d => `${d.fruit_name||'-'} | 供应商:${d.supplier_name||'-'} | 单价:${d.purchase_price ?? '-'}元/kg | 重量:${d.purchase_weight ?? '-'}kg | 日期:${d.purchase_date||'-'} | 付款:${d.payment_status === 'paid' ? '已付' : '未付'}`).join('\n')}`, history: [], stream: true }),
                });
                const reader = response.body?.getReader();
                if (!reader) return;
                const decoder = new TextDecoder();
                let acc = '';
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  for (const line of decoder.decode(value, { stream: true }).split('\n')) {
                    if (!line.startsWith('data: ')) continue;
                    const d = line.slice(6);
                    if (d === '[DONE]') break;
                    try { const p = JSON.parse(d); if (p.content) acc += p.content; } catch {}
                  }
                  setAiContent(acc);
                }
              } catch { setAiContent('AI 分析暂时不可用'); }
              finally { setAiLoading(false); }
            }} style={{
              borderRadius: 10, height: 38,
              background: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none', color: '#fff',
              boxShadow: '0 3px 10px rgba(102,126,234,0.3)',
            }}>AI分析</Button>
          </Tooltip>
          <Tooltip title="刷新">
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh}
              style={{ borderRadius: 10, height: 38 }} />
          </Tooltip>
          <Tooltip title="批量导入">
            <Button icon={<UploadOutlined />} onClick={() => { setImportOpen(true); setImportResult(null); }}
              style={{ borderRadius: 10, height: 38 }}>导入</Button>
          </Tooltip>
          <Button icon={<DownloadOutlined />} onClick={() => exportToCsv(data,
            [
              { key: 'id', title: 'ID' },
              { key: 'supplier_name', title: '供应商', render: v => String(v ?? '-') },
              { key: 'fruit_name', title: '水果', render: v => String(v ?? '-') },
              { key: 'purchase_date', title: '采购日期', render: v => v ? dayjs(v as string).format('YYYY-MM-DD') : '-' },
              { key: 'purchase_price', title: '单价(元/kg)', render: v => v != null ? Number(v).toFixed(2) : '-' },
              { key: 'purchase_weight', title: '重量(kg)', render: v => v != null ? String(Number(v)) : '-' },
              { key: 'payment_status', title: '付款状态', render: v => v === 'paid' ? '已付' : '未付' },
            ],
            '水果采购'
          )} disabled={!data.length} style={{ borderRadius: 10, height: 38 }}>导出</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}
            style={{ height: 38, borderRadius: 10, fontWeight: 600, paddingInline: 20, boxShadow: '0 3px 12px rgba(22,119,255,0.2)' }}>
            新建采购
          </Button>
        </Space>
      </div>

      {/* ── 统计卡片 ── */}
      <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
        {statCards.map((s, i) => (
          <Col xs={12} sm={6} key={i} className={`stagger-${i + 1}`}>
            <div style={{
              padding: '14px 16px', borderRadius: 'var(--radius-m)',
              background: s.gradient, position: 'relative', overflow: 'hidden',
              boxShadow: `0 4px 14px ${s.glow}`,
              transition: 'all 0.3s',
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 6px 20px ${s.glow}`; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = `0 4px 14px ${s.glow}`; }}
            >
              <div style={{ position: 'absolute', top: -12, right: -12, width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                {s.icon} {s.label}
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', lineHeight: 1.2 }} className="num">
                {s.value}{s.unit && <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3, opacity: 0.7 }}>{s.unit}</span>}
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* ── 筛选 + 表格 ── */}
      <div className="panel">
        <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
          <Form form={searchForm} layout="inline" onFinish={handleSearch}
            style={{ gap: 8, flexWrap: 'wrap' }}>
            <Form.Item name="fruit_name" style={{ marginBottom: 0 }}>
              <Input placeholder="水果名称" allowClear style={{ width: 120, borderRadius: 8 }} />
            </Form.Item>
            <Form.Item name="supplier_name" style={{ marginBottom: 0 }}>
              <Input placeholder="供应商" allowClear style={{ width: 120, borderRadius: 8 }} />
            </Form.Item>
            <Form.Item name="date_range" style={{ marginBottom: 0 }}>
              <DatePicker.RangePicker style={{ width: 220, borderRadius: 8 }} placeholder={['开始日期', '结束日期']} />
            </Form.Item>
            <Form.Item name="payment_status" style={{ marginBottom: 0 }}>
              <Select placeholder="付款状态" allowClear style={{ width: 110 }}>
                <Select.Option value="paid">已付款</Select.Option>
                <Select.Option value="unpaid">未付款</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Space size={6}>
                <Button type="primary" htmlType="submit" icon={<SearchOutlined />} style={{ borderRadius: 8 }}>搜索</Button>
                <Button onClick={handleReset} icon={<ReloadOutlined />} style={{ borderRadius: 8 }}>重置</Button>
              </Space>
            </Form.Item>
          </Form>
        </div>

        {selectedKeys.length > 0 && (
          <div style={{
            padding: '8px 20px',
            background: 'linear-gradient(135deg, rgba(22,119,255,0.06) 0%, rgba(22,119,255,0.02) 100%)',
            borderBottom: '1px solid rgba(22,119,255,0.08)',
            display: 'flex', alignItems: 'center', gap: 12, fontSize: 13,
          }}>
            <span>已选 <b style={{ color: 'var(--brand)' }}>{selectedKeys.length}</b> 条</span>
            <Button size="small" type="link" danger onClick={batchDelete} icon={<DeleteOutlined />}>批量删除</Button>
            <Button size="small" type="link" onClick={() => setSelectedKeys([])} style={{ color: 'var(--text-3)' }}>取消选择</Button>
          </div>
        )}

        <Table
          rowKey="id"
          columns={columns}
          dataSource={data}
          loading={loading}
          size="middle"
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: (keys) => setSelectedKeys(keys as number[]),
          }}
          pagination={{
            current: filters.page, pageSize: filters.page_size, total,
            showSizeChanger: true, pageSizeOptions: ['10', '20', '50'],
            showTotal: t => `共 ${t} 条`,
            onChange: (p, ps) => setFilters(prev => ({ ...prev, page: p, page_size: ps ?? 20 })),
          }}
          scroll={{ x: 1000 }}
          style={{ margin: 0 }}
          locale={{ emptyText: '暂无水果采购记录' }}
        />
      </div>

      {/* ── 新建/编辑弹窗 ── */}
      <Modal title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: editingId ? 'linear-gradient(135deg, #fa8c16, #ffc53d)' : 'linear-gradient(135deg, #1677ff, #69b1ff)',
            color: '#fff', fontSize: 13,
          }}>{editingId ? <EditOutlined /> : <PlusOutlined />}</span>
          {editingId ? '编辑采购' : '新建采购'}
        </div>
      } open={modalOpen}
        onOk={handleSubmit} onCancel={() => setModalOpen(false)}
        width={520} destroyOnClose okText="保存" cancelText="取消"
        styles={{ body: { paddingTop: 20 } }}>
        <Form form={form} layout="vertical">
          {hasOpts ? (
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="supplier_id" label="供应商" rules={[{ required: true, message: '请选择供应商' }]}>
                  <Select placeholder="选择供应商" showSearch optionFilterProp="label"
                    options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                    dropdownRender={(menu) => (
                      <>
                        {menu}
                        <div style={{ padding: '4px 8px', borderTop: '1px solid #f0f0f0', display: 'flex', gap: 4 }}>
                          {quickSupplierOpen ? (
                            <div style={{ display: 'flex', gap: 6, width: '100%' }}>
                              <Input size="small" placeholder="供应商名称" value={quickName}
                                onChange={e => setQuickName(e.target.value)}
                                onPressEnter={handleQuickAddSupplier}
                                style={{ flex: 1, borderRadius: 6 }} autoFocus />
                              <Button size="small" type="primary" loading={quickSaving}
                                onClick={handleQuickAddSupplier} style={{ borderRadius: 6 }}>添加</Button>
                              <Button size="small" onClick={() => { setQuickSupplierOpen(false); setQuickName(''); }}
                                style={{ borderRadius: 6 }}>取消</Button>
                            </div>
                          ) : (
                            <>
                              <Button type="text" icon={<PlusOutlined />} size="small"
                                onClick={() => setQuickSupplierOpen(true)}
                                style={{ flex: 1, textAlign: 'left', color: '#1677ff', borderRadius: 6 }}>
                                新建
                              </Button>
                              <Button type="text" icon={<EditOutlined />} size="small"
                                onClick={() => setSupMgrOpen(true)}
                                style={{ color: '#fa8c16', borderRadius: 6 }}>
                                管理
                              </Button>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="fruit_id" label="水果" rules={[{ required: true, message: '请选择水果' }]}>
                  <Select placeholder="选择水果" showSearch optionFilterProp="label"
                    options={fruits.map(f => ({ value: f.id, label: f.name }))}
                    dropdownRender={(menu) => (
                      <>
                        {menu}
                        <div style={{ padding: '4px 8px', borderTop: '1px solid #f0f0f0' }}>
                          {quickFruitOpen ? (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <Input size="small" placeholder="水果名称" value={quickName}
                                onChange={e => setQuickName(e.target.value)}
                                onPressEnter={handleQuickAddFruit}
                                style={{ flex: 1, borderRadius: 6 }} autoFocus />
                              <Button size="small" type="primary" loading={quickSaving}
                                onClick={handleQuickAddFruit} style={{ borderRadius: 6 }}>添加</Button>
                              <Button size="small" onClick={() => { setQuickFruitOpen(false); setQuickName(''); }}
                                style={{ borderRadius: 6 }}>取消</Button>
                            </div>
                          ) : (
                            <Button type="text" icon={<PlusOutlined />} block size="small"
                              onClick={() => setQuickFruitOpen(true)}
                              style={{ textAlign: 'left', color: '#1677ff', borderRadius: 6 }}>
                              新建水果
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  />
                </Form.Item>
              </Col>
            </Row>
          ) : (
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="supplier_name" label="供应商" rules={[{ required: true }]}>
                  <Input placeholder="供应商名称" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="fruit_name" label="水果" rules={[{ required: true }]}>
                  <Input placeholder="水果名称" />
                </Form.Item>
              </Col>
            </Row>
          )}
          <Form.Item name="purchase_date" label="采购日期" rules={[{ required: true, message: '请选择日期' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="purchase_price" label="单价 (¥/kg)" rules={[{ required: true, message: '请输入' }]}>
                <InputNumber min={0} step={0.1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="purchase_weight" label="重量 (kg)" rules={[{ required: true, message: '请输入' }]}>
                <InputNumber min={0} step={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>

      {/* ── 导入弹窗 ── */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #722ed1, #b37feb)', color: '#fff', fontSize: 13,
            }}><CloudUploadOutlined /></span>
            批量导入水果采购
          </div>
        }
        open={importOpen}
        onCancel={() => { setImportOpen(false); setImportResult(null); }}
        footer={null}
        width={560}
        destroyOnClose
      >
        <div style={{ padding: '16px 0' }}>
          <div style={{
            padding: '24px', borderRadius: 14, marginBottom: 16,
            background: 'linear-gradient(135deg, rgba(114,46,209,0.04) 0%, rgba(22,119,255,0.03) 100%)',
            border: '1px dashed rgba(114,46,209,0.2)',
            textAlign: 'center',
          }}>
            <Upload.Dragger
              accept=".csv,.xlsx,.xls"
              showUploadList={false}
              beforeUpload={(file) => { handleImport(file); return false; }}
              disabled={importLoading}
              style={{ border: 'none', background: 'transparent' }}
            >
              <p style={{ marginBottom: 8 }}>
                <CloudUploadOutlined style={{ fontSize: 36, color: '#722ed1' }} />
              </p>
              <p style={{ fontSize: 14, color: 'var(--text-1)', fontWeight: 600, marginBottom: 4 }}>
                点击或拖拽文件到此处上传
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-3)' }}>
                支持 CSV、Excel（.xlsx/.xls）格式
              </p>
            </Upload.Dragger>
          </div>

          {importLoading && (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <Progress type="circle" percent={99} size={60} strokeColor={{ '0%': '#722ed1', '100%': '#1677ff' }}
                format={() => <span style={{ fontSize: 12 }}>导入中</span>} />
              <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-3)' }}>正在解析并导入数据...</div>
            </div>
          )}

          {importResult && (
            <div style={{
              padding: '16px', borderRadius: 12, marginBottom: 12,
              background: importResult.error_count > 0
                ? 'linear-gradient(135deg, rgba(250,140,22,0.06) 0%, rgba(250,140,22,0.02) 100%)'
                : 'linear-gradient(135deg, rgba(0,185,107,0.06) 0%, rgba(0,185,107,0.02) 100%)',
              border: `1px solid ${importResult.error_count > 0 ? 'rgba(250,140,22,0.15)' : 'rgba(0,185,107,0.15)'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                {importResult.created > 0 ? (
                  <CheckCircleOutlined style={{ color: '#00b96b', fontSize: 18 }} />
                ) : (
                  <WarningOutlined style={{ color: '#fa8c16', fontSize: 18 }} />
                )}
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>导入完成</span>
              </div>
              <Row gutter={16}>
                <Col span={8}>
                  <div style={{ textAlign: 'center', padding: '8px 0' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>总行数</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)' }} className="num">{importResult.total_rows}</div>
                  </div>
                </Col>
                <Col span={8}>
                  <div style={{ textAlign: 'center', padding: '8px 0' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>成功导入</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#00b96b' }} className="num">{importResult.created}</div>
                  </div>
                </Col>
                <Col span={8}>
                  <div style={{ textAlign: 'center', padding: '8px 0' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>失败</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: importResult.error_count > 0 ? '#ff4d4f' : 'var(--text-4)' }} className="num">{importResult.error_count}</div>
                  </div>
                </Col>
              </Row>
              {importResult.errors.length > 0 && (
                <div style={{ marginTop: 12, maxHeight: 160, overflow: 'auto' }}>
                  {importResult.errors.map((err, i) => (
                    <div key={i} style={{
                      fontSize: 12, color: '#ff4d4f', padding: '4px 0',
                      borderBottom: i < importResult.errors.length - 1 ? '1px solid rgba(255,77,79,0.06)' : 'none',
                    }}>
                      <WarningOutlined style={{ marginRight: 4, fontSize: 11 }} />{err}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 16px', borderRadius: 10,
            background: 'rgba(22,119,255,0.04)', border: '1px solid rgba(22,119,255,0.08)',
          }}>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
              <div style={{ fontWeight: 600, color: 'var(--text-2)', marginBottom: 2 }}>CSV 格式要求</div>
              列名：水果名称、供应商名称、采购日期、采购单价、采购重量、付款状态
            </div>
            <Button size="small" type="link" onClick={downloadTemplate} icon={<DownloadOutlined />}>
              下载模板
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={aiOpen} onCancel={() => setAiOpen(false)} footer={null} width={600}
        title={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <RobotOutlined style={{ color: '#667eea' }} />
          <span style={{ fontWeight: 700 }}>AI 采购分析</span>
          <Tag color="purple" style={{ borderRadius: 8, fontSize: 11 }}>Qwen AI</Tag>
        </div>}
      >
        <div style={{ padding: '12px 0', minHeight: 180, fontSize: 14, lineHeight: 1.8, color: 'var(--text-1)' }}>
          {aiLoading && !aiContent && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <div style={{ marginBottom: 12 }}><RobotOutlined style={{ fontSize: 32, color: '#764ba2', opacity: 0.4 }} /></div>
              <div style={{ color: 'var(--text-3)', fontSize: 13 }}>正在分析采购数据...</div>
            </div>
          )}
          {aiContent && (
            <div style={{ whiteSpace: 'pre-wrap' }}>
              {aiContent.split(/(\*\*.*?\*\*|\n)/g).map((p, i) => {
                if (p === '\n') return <br key={i} />;
                if (p.startsWith('**') && p.endsWith('**'))
                  return <strong key={i} style={{ color: '#667eea' }}>{p.slice(2, -2)}</strong>;
                return <span key={i}>{p}</span>;
              })}
            </div>
          )}
        </div>
      </Modal>

      {/* 历史迁移弹窗已移除 */}

      {/* 供应商管理弹窗 */}
      <Modal
        title={<span><EditOutlined style={{ marginRight: 8, color: '#fa8c16' }} />管理供应商</span>}
        open={supMgrOpen}
        onCancel={() => { setSupMgrOpen(false); setSupEditId(null); setSupEditName(''); }}
        footer={null}
        width={560}
        styles={{ body: { maxHeight: 500, overflowY: 'auto' } }}
      >
        {/* 新建/编辑表单 */}
        <div style={{ padding: '12px 0 16px', borderBottom: '1px solid #f0f0f0', marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-2)' }}>
            {supEditId ? '编辑供应商' : '新建供应商'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Input placeholder="名称 *" value={supEditName} onChange={e => setSupEditName(e.target.value)}
              style={{ flex: 2, minWidth: 120, borderRadius: 8 }} />
            <Input placeholder="联系人" value={supEditContact} onChange={e => setSupEditContact(e.target.value)}
              style={{ flex: 1, minWidth: 80, borderRadius: 8 }} />
            <Input placeholder="电话" value={supEditPhone} onChange={e => setSupEditPhone(e.target.value)}
              style={{ flex: 1, minWidth: 100, borderRadius: 8 }} />
            <Button type="primary" loading={supSaving} onClick={handleSaveSupplier} style={{ borderRadius: 8 }}>
              {supEditId ? '保存' : '添加'}
            </Button>
            {supEditId && (
              <Button onClick={() => { setSupEditId(null); setSupEditName(''); setSupEditPhone(''); setSupEditContact(''); }}
                style={{ borderRadius: 8 }}>取消</Button>
            )}
          </div>
        </div>

        {/* 供应商列表 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {suppliers.filter(s => s.type === 'fruit' || !s.type).length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-4)' }}>暂无水果供应商</div>
          ) : (
            suppliers.filter(s => s.type === 'fruit' || !s.type).map(s => (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                borderRadius: 8, border: '1px solid #f0f0f0',
                background: supEditId === s.id ? 'rgba(22,119,255,0.04)' : 'transparent',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-4)' }}>
                    {s.contact_person && `${s.contact_person} `}{s.phone && `· ${s.phone}`}
                  </div>
                </div>
                <Space size={4}>
                  <Tooltip title="编辑">
                    <Button type="text" size="small" icon={<EditOutlined />}
                      onClick={() => startEditSupplier(s)}
                      style={{ color: '#1677ff' }} />
                  </Tooltip>
                  <Popconfirm title="确定删除？" onConfirm={() => handleDeleteSupplier(s.id)} okText="删除" cancelText="取消">
                    <Tooltip title="删除">
                      <Button type="text" size="small" icon={<DeleteOutlined />}
                        style={{ color: '#ff4d4f' }} />
                    </Tooltip>
                  </Popconfirm>
                </Space>
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}
