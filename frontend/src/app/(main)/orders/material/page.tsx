'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Table, Button, Modal, Form, Input, InputNumber, DatePicker, Select,
  Tag, Space, message, Popconfirm, Row, Col, Tooltip, Upload, Alert, Progress,
  Segmented, Statistic, Empty,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined,
  ReloadOutlined, DollarOutlined, ExperimentOutlined, DownloadOutlined,
  CheckCircleOutlined, CloseCircleOutlined, InboxOutlined, FileTextOutlined,
  UploadOutlined, CloudUploadOutlined, WarningOutlined,
  BarChartOutlined, ShopOutlined, LineChartOutlined, UnorderedListOutlined,
  AppstoreOutlined, PieChartOutlined, RobotOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import type { MaterialPurchase, PaginatedResponse, Supplier } from '@/types';
import dayjs from 'dayjs';

type ViewMode = 'orders' | 'analytics';

interface StatsData {
  total_records: number;
  total_amount: number;
  supplier_count: number;
  unpaid_amount: number;
  unpaid_count: number;
  by_type: { type: string; count: number; amount: number }[];
  by_supplier: { supplier_name: string; count: number; amount: number }[];
  monthly: { month: string; amount: number; count: number }[];
}

export default function MaterialOrdersPage() {
  const [data, setData] = useState<MaterialPurchase[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form] = Form.useForm();
  const [searchForm] = Form.useForm();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);
  const [qsOpen, setQsOpen] = useState(false);
  const [qsName, setQsName] = useState('');
  const [qsSaving, setQsSaving] = useState(false);

  const handleQuickSupplier = async () => {
    if (!qsName.trim()) return;
    setQsSaving(true);
    try {
      const res = await api.post('/inventory/suppliers', { name: qsName.trim(), type: 'material' });
      const s = (res.data as any)?.data;
      if (s) { setSuppliers(prev => [...prev, s]); form.setFieldsValue({ supplier_id: s.id }); message.success(`供应商「${s.name}」已创建`); }
      setQsName(''); setQsOpen(false);
    } catch (e: any) { message.error(e?.response?.data?.detail || '创建失败'); }
    finally { setQsSaving(false); }
  };
  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; errors: string[]; total_rows: number; error_count: number } | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('orders');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const trendChartRef = useRef<HTMLDivElement>(null);
  const trendChartInst = useRef<any>(null);
  const pieChartRef = useRef<HTMLDivElement>(null);
  const pieChartInst = useRef<any>(null);

  const [filters, setFilters] = useState({
    page: 1, page_size: 20, material_name: '', supplier_name: '', payment_status: '', start_date: '', end_date: '',
  });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string | number> = { page: filters.page, page_size: filters.page_size };
      if (filters.material_name) params.material_name = filters.material_name;
      if (filters.supplier_name) params.supplier_name = filters.supplier_name;
      if (filters.payment_status) params.payment_status = filters.payment_status;
      if (filters.start_date) params.start_date = filters.start_date;
      if (filters.end_date) params.end_date = filters.end_date;
      const res = await api.get<PaginatedResponse<MaterialPurchase>>('/orders/material', { params });
      setData(res.data.data ?? []); setTotal(res.data.total ?? 0);
    } catch { message.error('加载失败'); setData([]); }
    finally { setLoading(false); }
  }, [filters]);

  const fetchSuppliers = useCallback(async () => {
    try {
      const res = await api.get('/inventory/suppliers', { params: { type: 'material' } }).catch(() => ({ data: { data: [] } }));
      setSuppliers((res.data as any)?.data ?? []);
    } catch { /* optional */ }
  }, []);

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await api.get('/orders/material/stats');
      setStats(res.data);
    } catch { /* ignore */ }
    finally { setStatsLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchSuppliers(); }, [fetchSuppliers]);
  useEffect(() => { if (viewMode === 'analytics') fetchStats(); }, [viewMode, fetchStats]);

  useEffect(() => {
    if (viewMode !== 'analytics' || !stats?.monthly?.length || !trendChartRef.current) return;
    let mounted = true;
    import('echarts').then(echarts => {
      if (!mounted || !trendChartRef.current) return;
      if (trendChartInst.current) trendChartInst.current.dispose();
      const chart = echarts.init(trendChartRef.current);
      trendChartInst.current = chart;

      chart.setOption({
        tooltip: { trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.96)', borderColor: '#eee', textStyle: { color: '#333', fontSize: 12 } },
        grid: { left: 55, right: 15, top: 20, bottom: 30 },
        xAxis: { type: 'category', data: stats.monthly.map(m => m.month), axisLabel: { fontSize: 10, color: '#999' }, axisLine: { lineStyle: { color: '#eee' } } },
        yAxis: [
          { type: 'value', name: '金额 ¥', nameTextStyle: { color: '#999', fontSize: 10 }, splitLine: { lineStyle: { color: '#f5f5f5' } }, axisLabel: { fontSize: 10, color: '#999' } },
          { type: 'value', name: '笔数', nameTextStyle: { color: '#999', fontSize: 10 }, splitLine: { show: false }, axisLabel: { fontSize: 10, color: '#999' } },
        ],
        series: [
          {
            name: '金额', type: 'bar', yAxisIndex: 0, data: stats.monthly.map(m => m.amount), barMaxWidth: 20,
            itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#722ed1' }, { offset: 1, color: '#b37feb' }] }, borderRadius: [4, 4, 0, 0] },
          },
          {
            name: '笔数', type: 'line', yAxisIndex: 1, data: stats.monthly.map(m => m.count),
            smooth: true, symbol: 'circle', symbolSize: 5,
            lineStyle: { width: 2, color: '#fa8c16' }, itemStyle: { color: '#fa8c16' },
          },
        ],
      });

      const ro = new ResizeObserver(() => chart.resize());
      ro.observe(trendChartRef.current);
      return () => { ro.disconnect(); };
    });
    return () => { mounted = false; };
  }, [stats, viewMode]);

  useEffect(() => {
    if (viewMode !== 'analytics' || !stats?.by_type?.length || !pieChartRef.current) return;
    let mounted = true;
    import('echarts').then(echarts => {
      if (!mounted || !pieChartRef.current) return;
      if (pieChartInst.current) pieChartInst.current.dispose();
      const chart = echarts.init(pieChartRef.current);
      pieChartInst.current = chart;

      const colors = ['#722ed1', '#1677ff', '#fa8c16', '#52c41a', '#eb2f96', '#13c2c2', '#faad14', '#ff4d4f'];
      chart.setOption({
        tooltip: { trigger: 'item', backgroundColor: 'rgba(255,255,255,0.96)', borderColor: '#eee', textStyle: { color: '#333', fontSize: 12 } },
        series: [{
          type: 'pie', radius: ['45%', '70%'], center: ['50%', '50%'],
          data: stats.by_type.map((t, i) => ({ name: t.type, value: t.amount, itemStyle: { color: colors[i % colors.length] } })),
          label: { fontSize: 11, color: '#666' },
          emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.1)' } },
        }],
      });

      const ro = new ResizeObserver(() => chart.resize());
      ro.observe(pieChartRef.current);
      return () => { ro.disconnect(); };
    });
    return () => { mounted = false; };
  }, [stats, viewMode]);

  const handleSearch = (v: any) => {
    const [sd, ed] = v.date_range ? [v.date_range[0]?.format('YYYY-MM-DD') ?? '', v.date_range[1]?.format('YYYY-MM-DD') ?? ''] : ['', ''];
    setFilters(p => ({ ...p, page: 1, material_name: v.material_name ?? '', supplier_name: v.supplier_name ?? '', payment_status: v.payment_status ?? '', start_date: sd, end_date: ed }));
  };
  const handleReset = () => { searchForm.resetFields(); setFilters({ page: 1, page_size: 20, material_name: '', supplier_name: '', payment_status: '', start_date: '', end_date: '' }); };
  const handleRefresh = () => { setRefreshSpin(true); fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600)); };

  const handleImport = async (file: any) => {
    setImportLoading(true); setImportResult(null);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post('/orders/material/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setImportResult(res.data?.data ?? null);
      if ((res.data?.data?.created ?? 0) > 0) fetchData();
    } catch (e: any) { message.error(e?.response?.data?.detail ?? '导入失败'); }
    finally { setImportLoading(false); }
    return false;
  };

  const exportCSV = () => {
    if (!data.length) { message.warning('没有数据可导出'); return; }
    const header = '供应商,类型,材料名称,金额,采购日期,付款状态\n';
    const rows = data.map(r => `${r.supplier_name ?? ''},${r.material_type ?? ''},${r.material_name ?? ''},${Number(r.purchase_amount) || 0},${r.purchase_date ?? ''},${r.payment_status === 'paid' ? '已付' : '未付'}`).join('\n');
    const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `材料采购_${dayjs().format('YYYY-MM-DD')}.csv`;
    link.click(); URL.revokeObjectURL(link.href);
    message.success('导出成功');
  };

  const handleAdd = () => { setEditingId(null); form.resetFields(); setModalOpen(true); };
  const handleEdit = (r: MaterialPurchase) => {
    setEditingId(r.id);
    form.setFieldsValue({
      supplier_id: r.supplier_id, supplier_name: r.supplier_name,
      material_type: r.material_type, material_name: r.material_name,
      purchase_amount: r.purchase_amount,
      purchase_date: r.purchase_date ? dayjs(r.purchase_date) : null,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const v = await form.validateFields();
      const payload: any = {
        material_type: v.material_type, material_name: v.material_name,
        purchase_amount: v.purchase_amount,
        purchase_date: v.purchase_date ? dayjs(v.purchase_date).format('YYYY-MM-DD') : undefined,
      };
      if (suppliers.length > 0) payload.supplier_id = v.supplier_id;
      else payload.supplier_name = v.supplier_name;
      if (editingId) { await api.put(`/orders/material/${editingId}`, payload); message.success('更新成功'); }
      else { await api.post('/orders/material', payload); message.success('添加成功'); }
      setModalOpen(false); fetchData();
    } catch (err: any) { if (err?.errorFields) return; message.error(err?.response?.data?.detail || err?.message || '操作失败'); }
  };

  const handleDelete = async (id: number) => {
    try { await api.delete(`/orders/material/${id}`); message.success('已移入回收站'); fetchData(); }
    catch { message.error('删除失败'); }
  };

  const batchDelete = () => {
    if (!selectedKeys.length) return;
    Modal.confirm({
      title: `批量删除 ${selectedKeys.length} 条采购记录`, content: '删除后将移入回收站。',
      okText: '确定删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await api.post('/orders/batch-delete', { order_type: 'material', order_ids: selectedKeys });
          message.success(res.data?.message || '批量删除成功');
          setSelectedKeys([]); fetchData();
        } catch (e: any) { message.error(e?.response?.data?.detail || '批量删除失败'); }
      },
    });
  };

  const pageAmt = data.reduce((a, r) => a + (Number(r.purchase_amount) || 0), 0);
  const unpaidCount = data.filter(r => r.payment_status !== 'paid').length;

  const statCards = [
    { label: '总记录', value: total, unit: '条', icon: <FileTextOutlined />, gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', glow: 'rgba(114,46,209,0.15)' },
    { label: '本页金额', value: `¥${pageAmt.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`, icon: <DollarOutlined />, gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.15)' },
    { label: '本页记录', value: data.length, unit: '条', icon: <InboxOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.15)' },
    { label: '未付款', value: unpaidCount, unit: '条', icon: <CloseCircleOutlined />, gradient: 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)', glow: 'rgba(255,77,79,0.15)' },
  ];

  const columns: any[] = [
    { title: 'ID', dataIndex: 'id', width: 60, fixed: 'left', render: (v: number) => <span className="num" style={{ color: 'var(--text-4)', fontSize: 12 }}>#{v}</span> },
    { title: '供应商', dataIndex: 'supplier_name', width: 130, ellipsis: true, render: (v: string) => <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{v || '-'}</span> },
    {
      title: '类型', dataIndex: 'material_type', width: 90, ellipsis: true,
      render: (v: string) => v ? <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 6, fontSize: 12, fontWeight: 500, background: 'linear-gradient(135deg, rgba(114,46,209,0.08), rgba(114,46,209,0.03))', color: '#722ed1', border: '1px solid rgba(114,46,209,0.12)' }}>{v}</span> : '-',
    },
    { title: '材料', dataIndex: 'material_name', width: 140, ellipsis: true, render: (v: string) => <span style={{ fontWeight: 500 }}>{v || '-'}</span> },
    {
      title: '金额 (¥)', dataIndex: 'purchase_amount', width: 120, align: 'right' as const,
      render: (v: any) => v != null ? <span className="num" style={{ fontWeight: 700, color: '#fa8c16' }}>¥{Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> : '-',
      sorter: (a: any, b: any) => (Number(a.purchase_amount) || 0) - (Number(b.purchase_amount) || 0),
    },
    {
      title: '日期', dataIndex: 'purchase_date', width: 100,
      render: (v: string) => v ? <span style={{ color: 'var(--text-2)', fontSize: 12 }}>{dayjs(v).format('YYYY-MM-DD')}</span> : '-',
      sorter: (a: any, b: any) => dayjs(a.purchase_date || 0).unix() - dayjs(b.purchase_date || 0).unix(),
    },
    {
      title: '付款', dataIndex: 'payment_status', width: 80, align: 'center' as const,
      render: (_: any, r: MaterialPurchase) => (
        <Tag color={r.payment_status === 'paid' ? 'success' : 'error'}
          style={{ borderRadius: 6, fontWeight: 500, fontSize: 12, padding: '1px 10px' }}
          icon={r.payment_status === 'paid' ? <CheckCircleOutlined /> : <CloseCircleOutlined />}>
          {r.payment_status === 'paid' ? '已付' : '未付'}
        </Tag>
      ),
    },
    {
      title: '操作', key: 'actions', width: 100, fixed: 'right' as const, align: 'center' as const,
      render: (_: any, r: MaterialPurchase) => (
        <Space size={0}>
          <Tooltip title="编辑"><Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)} style={{ color: 'var(--brand)', borderRadius: 6 }} /></Tooltip>
          <Popconfirm title="确定移入回收站？" onConfirm={() => handleDelete(r.id)} okText="删除" cancelText="取消" okButtonProps={{ danger: true }}>
            <Tooltip title="删除"><Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ borderRadius: 6 }} /></Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const summaryRow = () => {
    if (!data.length) return null;
    const totalAmt = data.reduce((a, r) => a + (Number(r.purchase_amount) || 0), 0);
    return (
      <Table.Summary fixed>
        <Table.Summary.Row>
          <Table.Summary.Cell index={0} colSpan={1}><span style={{ fontWeight: 700, color: 'var(--text-2)' }}>合计</span></Table.Summary.Cell>
          <Table.Summary.Cell index={1} colSpan={3}></Table.Summary.Cell>
          <Table.Summary.Cell index={4} align="right"><span className="num" style={{ fontWeight: 700, color: '#fa8c16' }}>¥{totalAmt.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></Table.Summary.Cell>
          <Table.Summary.Cell index={5} colSpan={3}></Table.Summary.Cell>
        </Table.Summary.Row>
      </Table.Summary>
    );
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* ── 页头 ── */}
      <div className="stagger-in" style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22,
        padding: '20px 24px', borderRadius: 'var(--radius-l)',
        background: 'linear-gradient(135deg, rgba(114,46,209,0.06) 0%, rgba(250,140,22,0.04) 50%, rgba(22,119,255,0.03) 100%)',
        border: '1px solid rgba(114,46,209,0.08)', flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 36, height: 36, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #722ed1 0%, #b37feb 50%, #d3adf7 100%)', color: '#fff', fontSize: 17,
              boxShadow: '0 4px 14px rgba(114,46,209,0.25)',
            }}><ExperimentOutlined /></span>
            材料采购中心
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 46 }}>采购管理 · 分类统计 · 月度分析</div>
        </div>
        <Space size={8} wrap>
          <Segmented value={viewMode} onChange={v => setViewMode(v as ViewMode)} options={[
            { label: <Space size={4}><UnorderedListOutlined />订单</Space>, value: 'orders' },
            { label: <Space size={4}><BarChartOutlined />分析</Space>, value: 'analytics' },
          ]} style={{ borderRadius: 10 }} />
          <Tooltip title="AI 分析">
            <Button icon={<RobotOutlined />} onClick={async () => {
              setAiOpen(true); setAiContent(''); setAiLoading(true);
              try {
                const response = await fetch('/api/ai/chat', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                  body: JSON.stringify({ message: `请基于以下材料采购数据进行分析，给出采购频率和成本优化建议。注意：仅基于提供的数据分析，不要编造。\n\n材料采购数据(共${data.length}条，展示前20条):\n${data.slice(0, 20).map(d => `${d.material_name||'-'} | 供应商:${d.supplier_name||'-'} | 金额:${d.purchase_amount ?? '-'}元 | 日期:${d.purchase_date||'-'} | 付款:${d.payment_status === 'paid' ? '已付' : '未付'}`).join('\n')}`, history: [], stream: true }),
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
          <Tooltip title="刷新"><Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 10, height: 38, width: 38 }} /></Tooltip>
          <Tooltip title="导出"><Button icon={<DownloadOutlined />} onClick={exportCSV} style={{ borderRadius: 10, height: 38, width: 38 }} /></Tooltip>
          <Button icon={<UploadOutlined />} onClick={() => { setImportOpen(true); setImportResult(null); }} style={{ height: 38, borderRadius: 10, fontWeight: 600 }}>导入</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}
            style={{ height: 38, borderRadius: 10, fontWeight: 600, paddingInline: 20, boxShadow: '0 3px 12px rgba(22,119,255,0.2)' }}>
            新建采购
          </Button>
        </Space>
      </div>

      {/* ── 统计卡片 ── */}
      <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
        {statCards.map((s, i) => (
          <Col xs={12} sm={6} key={i}>
            <div className="stagger-in" style={{
              padding: '14px 16px', borderRadius: 'var(--radius-m)', background: s.gradient, position: 'relative', overflow: 'hidden',
              boxShadow: `0 4px 14px ${s.glow}`, transition: 'all 0.3s', animationDelay: `${i * 60}ms`,
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
            >
              <div style={{ position: 'absolute', top: -12, right: -12, width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>{s.icon} {s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', lineHeight: 1.2 }} className="num">
                {s.value}{typeof s.unit === 'string' && <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3, opacity: 0.7 }}>{s.unit}</span>}
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {viewMode === 'orders' ? (
        <div className="panel stagger-in" style={{ animationDelay: '200ms' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <Form form={searchForm} layout="inline" onFinish={handleSearch} style={{ gap: 8, flexWrap: 'wrap' }}>
              <Form.Item name="material_name" style={{ marginBottom: 6 }}>
                <Input placeholder="材料名称" allowClear style={{ width: 130, borderRadius: 8 }} />
              </Form.Item>
              <Form.Item name="supplier_name" style={{ marginBottom: 6 }}>
                <Input placeholder="供应商" allowClear style={{ width: 130, borderRadius: 8 }} />
              </Form.Item>
              <Form.Item name="payment_status" style={{ marginBottom: 6 }}>
                <Select placeholder="付款状态" allowClear style={{ width: 110 }}>
                  <Select.Option value="paid">已付款</Select.Option>
                  <Select.Option value="unpaid">未付款</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item name="date_range" style={{ marginBottom: 6 }}>
                <DatePicker.RangePicker style={{ borderRadius: 8 }} />
              </Form.Item>
              <Form.Item style={{ marginBottom: 6 }}>
                <Space size={6}>
                  <Button type="primary" htmlType="submit" icon={<SearchOutlined />} style={{ borderRadius: 8 }}>搜索</Button>
                  <Button onClick={handleReset} icon={<ReloadOutlined />} style={{ borderRadius: 8 }}>重置</Button>
                </Space>
              </Form.Item>
            </Form>
          </div>

          {selectedKeys.length > 0 && (
            <div style={{
              padding: '8px 20px', background: 'linear-gradient(135deg, rgba(114,46,209,0.06), rgba(114,46,209,0.02))',
              borderBottom: '1px solid rgba(114,46,209,0.08)',
              display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, flexWrap: 'wrap',
            }}>
              <span>已选 <b style={{ color: '#722ed1' }}>{selectedKeys.length}</b> 条</span>
              <Button size="small" type="link" danger onClick={batchDelete} icon={<DeleteOutlined />}>批量删除</Button>
              <Button size="small" type="link" onClick={() => setSelectedKeys([])} style={{ color: 'var(--text-3)' }}>取消</Button>
            </div>
          )}

          <Table rowKey="id" columns={columns} dataSource={data} loading={loading} size="middle"
            rowSelection={{ selectedRowKeys: selectedKeys, onChange: keys => setSelectedKeys(keys as number[]) }}
            summary={summaryRow}
            pagination={{
              current: filters.page, pageSize: filters.page_size, total,
              showSizeChanger: true, pageSizeOptions: ['10', '20', '50'],
              showTotal: t => `共 ${t} 条`,
              onChange: (p, ps) => setFilters(prev => ({ ...prev, page: p, page_size: ps ?? 20 })),
            }}
            scroll={{ x: 920 }}
            locale={{ emptyText: '暂无材料采购记录' }}
          />
        </div>
      ) : (
        <Row gutter={[16, 16]}>
          <Col span={24}>
            <div className="panel stagger-in" style={{ padding: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <BarChartOutlined style={{ color: '#722ed1' }} /> 采购总览
              </div>
              {stats ? (
                <Row gutter={[24, 16]}>
                  <Col xs={12} sm={6}>
                    <Statistic title="总采购额" prefix="¥" value={stats.total_amount} precision={0} valueStyle={{ fontWeight: 700, color: '#fa8c16', fontSize: 22 }} />
                  </Col>
                  <Col xs={12} sm={6}>
                    <Statistic title="总记录" value={stats.total_records} suffix="笔" valueStyle={{ fontWeight: 700, color: '#722ed1', fontSize: 22 }} />
                  </Col>
                  <Col xs={12} sm={6}>
                    <Statistic title="未付金额" prefix="¥" value={stats.unpaid_amount} precision={0} valueStyle={{ fontWeight: 700, color: '#ff4d4f', fontSize: 22 }} />
                    <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 2 }}>{stats.unpaid_count} 笔未付</div>
                  </Col>
                  <Col xs={12} sm={6}>
                    <Statistic title="供应商数" value={stats.supplier_count} valueStyle={{ fontWeight: 700, color: '#1677ff', fontSize: 22 }} />
                  </Col>
                </Row>
              ) : <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-4)' }}>加载中...</div>}
            </div>
          </Col>

          <Col xs={24} lg={14}>
            <div className="panel stagger-in" style={{ padding: 20, animationDelay: '100ms' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <LineChartOutlined style={{ color: '#722ed1' }} /> 月度采购趋势
              </div>
              <div ref={trendChartRef} style={{ height: 260, width: '100%' }} />
              {stats && !stats.monthly?.length && <Empty description="暂无月度数据" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: -200 }} />}
            </div>
          </Col>

          <Col xs={24} lg={10}>
            <div className="panel stagger-in" style={{ padding: 20, animationDelay: '150ms' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <PieChartOutlined style={{ color: '#eb2f96' }} /> 分类金额分布
              </div>
              <div ref={pieChartRef} style={{ height: 260, width: '100%' }} />
              {stats && !stats.by_type?.length && <Empty description="暂无分类数据" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: -200 }} />}
            </div>
          </Col>

          <Col xs={24} lg={12}>
            <div className="panel stagger-in" style={{ padding: 20, animationDelay: '200ms' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <AppstoreOutlined style={{ color: '#fa8c16' }} /> 材料类型明细
              </div>
              {stats?.by_type?.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {stats.by_type.map((t, i) => {
                    const maxAmt = Math.max(...stats.by_type.map(x => x.amount));
                    const pct = maxAmt > 0 ? (t.amount / maxAmt) * 100 : 0;
                    const colors = ['#722ed1', '#1677ff', '#fa8c16', '#52c41a', '#eb2f96', '#13c2c2'];
                    const c = colors[i % colors.length];
                    return (
                      <div key={t.type} style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.015)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{t.type}</span>
                          <span className="num" style={{ fontWeight: 700, color: c }}>¥{t.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.04)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: 3, background: c, width: `${pct}%`, transition: 'width 0.6s ease' }} />
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 3 }}>{t.count} 笔</div>
                      </div>
                    );
                  })}
                </div>
              ) : <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            </div>
          </Col>

          <Col xs={24} lg={12}>
            <div className="panel stagger-in" style={{ padding: 20, animationDelay: '250ms' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShopOutlined style={{ color: '#1677ff' }} /> 供应商排行
              </div>
              {stats?.by_supplier?.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {stats.by_supplier.slice(0, 8).map((s, i) => {
                    const medals = ['🥇', '🥈', '🥉'];
                    return (
                      <div key={s.supplier_name} style={{
                        padding: '10px 12px', borderRadius: 8,
                        background: i < 3 ? `linear-gradient(135deg, rgba(22,119,255,${0.06 - i * 0.015}), rgba(22,119,255,0.01))` : 'rgba(0,0,0,0.015)',
                        border: i < 3 ? '1px solid rgba(22,119,255,0.08)' : '1px solid transparent',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.3s',
                      }}
                        onMouseEnter={e => { e.currentTarget.style.transform = 'translateX(3px)'; }}
                        onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 24, textAlign: 'center', fontSize: i < 3 ? 16 : 12, fontWeight: 700, color: 'var(--text-3)' }}>
                            {i < 3 ? medals[i] : `${i + 1}`}
                          </span>
                          <span style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: 13 }}>{s.supplier_name}</span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div className="num" style={{ fontWeight: 700, color: '#1677ff', fontSize: 14 }}>¥{s.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{s.count} 笔</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            </div>
          </Col>
        </Row>
      )}

      {/* ── 新建/编辑弹窗 ── */}
      <Modal title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: editingId ? 'linear-gradient(135deg, #fa8c16, #ffc53d)' : 'linear-gradient(135deg, #722ed1, #b37feb)', color: '#fff', fontSize: 13 }}>
            {editingId ? <EditOutlined /> : <PlusOutlined />}
          </span>
          {editingId ? '编辑材料采购' : '新建材料采购'}
        </div>
      } open={modalOpen} onOk={handleSubmit} onCancel={() => setModalOpen(false)} width={520} destroyOnClose okText="保存" cancelText="取消" styles={{ body: { paddingTop: 20 } }}>
        <Form form={form} layout="vertical">
          {suppliers.length > 0 ? (
            <Form.Item name="supplier_id" label="供应商" rules={[{ required: true, message: '请选择' }]}>
              <Select placeholder="选择供应商" showSearch optionFilterProp="label" options={suppliers.map(s => ({ value: s.id, label: s.name }))}
                dropdownRender={(menu) => (
                  <>
                    {menu}
                    <div style={{ padding: '4px 8px', borderTop: '1px solid #f0f0f0' }}>
                      {qsOpen ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <Input size="small" placeholder="供应商名称" value={qsName} onChange={e => setQsName(e.target.value)}
                            onPressEnter={handleQuickSupplier} style={{ flex: 1, borderRadius: 6 }} autoFocus />
                          <Button size="small" type="primary" loading={qsSaving} onClick={handleQuickSupplier} style={{ borderRadius: 6 }}>添加</Button>
                          <Button size="small" onClick={() => { setQsOpen(false); setQsName(''); }} style={{ borderRadius: 6 }}>取消</Button>
                        </div>
                      ) : (
                        <Button type="text" icon={<PlusOutlined />} block size="small" onClick={() => setQsOpen(true)}
                          style={{ textAlign: 'left', color: '#1677ff', borderRadius: 6 }}>新建供应商</Button>
                      )}
                    </div>
                  </>
                )}
              />
            </Form.Item>
          ) : (
            <Form.Item name="supplier_name" label="供应商" rules={[{ required: true }]}>
              <Input placeholder="供应商名称" />
            </Form.Item>
          )}
          <Row gutter={16}>
            <Col span={12}><Form.Item name="material_type" label="类型"><Input placeholder="如：包装材料" /></Form.Item></Col>
            <Col span={12}><Form.Item name="material_name" label="名称" rules={[{ required: true }]}><Input placeholder="材料名称" /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="purchase_amount" label="金额 (¥)" rules={[{ required: true }]}><InputNumber min={0} step={0.01} style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={12}><Form.Item name="purchase_date" label="日期" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>

      {/* ── 导入弹窗 ── */}
      <Modal title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #13c2c2, #5cdbd3)', color: '#fff', fontSize: 13 }}><CloudUploadOutlined /></span>
          批量导入材料采购
        </div>
      } open={importOpen} onCancel={() => setImportOpen(false)} footer={null} width={520}>
        <Alert type="info" showIcon style={{ borderRadius: 10, marginBottom: 16 }}
          message="CSV 格式要求"
          description={<div style={{ fontSize: 12 }}><div>表头：<b>材料名称</b>、<b>供应商名称</b>、<b>采购日期</b>、<b>采购金额</b></div><div style={{ marginTop: 4, color: 'var(--text-3)' }}>可选：材料类型、付款状态（paid/unpaid）、备注</div></div>}
        />
        <Upload.Dragger accept=".csv,.xlsx,.xls" showUploadList={false} beforeUpload={handleImport} disabled={importLoading} style={{ borderRadius: 12, borderColor: 'rgba(19,194,194,0.3)' }}>
          {importLoading ? (
            <div style={{ padding: 20 }}><Progress type="circle" percent={99} size={48} status="active" /><div style={{ marginTop: 12, color: 'var(--text-2)' }}>正在导入...</div></div>
          ) : (
            <div style={{ padding: 20 }}><p><CloudUploadOutlined style={{ fontSize: 32, color: '#13c2c2' }} /></p><p style={{ fontWeight: 600 }}>点击或拖拽文件到此处</p><p style={{ color: 'var(--text-3)', fontSize: 12 }}>支持 .csv / .xlsx / .xls</p></div>
          )}
        </Upload.Dragger>
        {importResult && (
          <div style={{ marginTop: 16 }}>
            <Alert type={importResult.error_count > 0 ? 'warning' : 'success'} showIcon style={{ borderRadius: 10 }}
              message={`导入完成：成功 ${importResult.created} 条，失败 ${importResult.error_count} 条`} />
            {importResult.errors.length > 0 && (
              <div style={{ marginTop: 8, maxHeight: 120, overflow: 'auto', fontSize: 12, color: '#ff4d4f', padding: '8px 12px', background: 'rgba(255,77,79,0.04)', borderRadius: 8 }}>
                {importResult.errors.map((e, i) => <div key={i}><WarningOutlined style={{ marginRight: 4 }} />{e}</div>)}
              </div>
            )}
          </div>
        )}
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
    </div>
  );
}
