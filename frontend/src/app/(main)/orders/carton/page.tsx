'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Table, Button, Modal, Form, Input, InputNumber, Select, Tag, Space,
  message, Popconfirm, Row, Col, Tooltip, DatePicker, Progress,
  Upload, Segmented, Alert, Statistic, Divider, Empty,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, SearchOutlined,
  ReloadOutlined, DollarOutlined, InboxOutlined,
  CheckCircleOutlined, CloseCircleOutlined, FileTextOutlined,
  DropboxOutlined, DownloadOutlined, UploadOutlined,
  BarChartOutlined, ShopOutlined, WarningOutlined,
  RiseOutlined, FallOutlined, LineChartOutlined,
  AppstoreOutlined, UnorderedListOutlined, ExclamationCircleOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import type { CartonPurchase, PaginatedResponse, Supplier, CartonBox } from '@/types';
import dayjs from 'dayjs';

interface CPD extends CartonPurchase { supplier_name?: string; box_type?: string; stock_quantity?: number }

interface StatsData {
  total_records: number;
  total_amount: number;
  total_qty: number;
  supplier_count: number;
  box_type_count: number;
  unpaid_amount: number;
  unpaid_count: number;
  by_box: { box_type: string; qty: number; amount: number; avg_price: number; stock_quantity: number; low_stock_threshold: number }[];
  by_supplier: { supplier_name: string; qty: number; amount: number; order_count: number }[];
  stock_overview: { id: number; box_type: string; stock_quantity: number; low_stock_threshold: number; is_low: boolean; purchase_price: number }[];
}

interface PriceTrend {
  trends: Record<string, { date: string; avg_price: number; qty: number }[]>;
}

type ViewMode = 'orders' | 'analytics';

export default function CartonOrdersPage() {
  const [data, setData] = useState<CPD[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form] = Form.useForm();
  const [searchForm] = Form.useForm();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [cartonBoxes, setCartonBoxes] = useState<CartonBox[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);
  const [qsOpen, setQsOpen] = useState(false);
  const [qsName, setQsName] = useState('');
  const [qsSaving, setQsSaving] = useState(false);

  const handleQuickSupplier = async () => {
    if (!qsName.trim()) return;
    setQsSaving(true);
    try {
      const res = await api.post('/inventory/suppliers', { name: qsName.trim(), type: 'box' });
      const s = (res.data as any)?.data;
      if (s) { setSuppliers(prev => [...prev, s]); form.setFieldsValue({ supplier_id: s.id }); message.success(`供应商「${s.name}」已创建`); }
      setQsName(''); setQsOpen(false);
    } catch (e: any) { message.error(e?.response?.data?.detail || '创建失败'); }
    finally { setQsSaving(false); }
  };
  const [viewMode, setViewMode] = useState<ViewMode>('orders');
  const [stats, setStats] = useState<StatsData | null>(null);
  const [priceTrend, setPriceTrend] = useState<PriceTrend | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<any>(null);

  const [filters, setFilters] = useState({
    page: 1, page_size: 20, payment_status: '',
    start_date: '', end_date: '', supplier_id: '', carton_box_id: '',
  });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string | number> = { page: filters.page, page_size: filters.page_size };
      if (filters.payment_status) params.payment_status = filters.payment_status;
      if (filters.start_date) params.start_date = filters.start_date;
      if (filters.end_date) params.end_date = filters.end_date;
      if (filters.supplier_id) params.supplier_id = filters.supplier_id;
      if (filters.carton_box_id) params.carton_box_id = filters.carton_box_id;
      const res = await api.get<PaginatedResponse<CPD>>('/orders/carton', { params });
      setData(res.data.data ?? []); setTotal(res.data.total ?? 0);
    } catch { message.error('加载失败'); setData([]); }
    finally { setLoading(false); }
  }, [filters]);

  const fetchOptions = useCallback(async () => {
    try {
      const [supRes, boxRes] = await Promise.all([
        api.get('/inventory/suppliers', { params: { type: 'box' } }).catch(() => ({ data: { data: [] } })),
        api.get('/inventory/carton-boxes').catch(() => ({ data: { data: [] } })),
      ]);
      setSuppliers((supRes.data as any)?.data ?? []);
      setCartonBoxes((boxRes.data as any)?.data ?? []);
    } catch { /* ignore */ }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const [statsRes, trendRes] = await Promise.all([
        api.get('/orders/carton/stats'),
        api.get('/orders/carton/price-trend', { params: { days: 90 } }),
      ]);
      setStats(statsRes.data);
      setPriceTrend(trendRes.data);
    } catch { /* ignore */ }
    finally { setStatsLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchOptions(); }, [fetchOptions]);
  useEffect(() => { if (viewMode === 'analytics') fetchStats(); }, [viewMode, fetchStats]);

  useEffect(() => {
    if (viewMode !== 'analytics' || !priceTrend || !chartRef.current) return;
    let mounted = true;
    import('echarts').then(echarts => {
      if (!mounted || !chartRef.current) return;
      if (chartInstance.current) chartInstance.current.dispose();
      const chart = echarts.init(chartRef.current);
      chartInstance.current = chart;

      const colors = ['#13c2c2', '#1677ff', '#fa8c16', '#52c41a', '#722ed1', '#eb2f96'];
      const series: any[] = [];
      const legendData: string[] = [];
      let idx = 0;
      for (const [boxType, points] of Object.entries(priceTrend.trends)) {
        legendData.push(boxType);
        series.push({
          name: boxType, type: 'line', smooth: true, symbol: 'circle', symbolSize: 6,
          lineStyle: { width: 2.5 },
          itemStyle: { color: colors[idx % colors.length] },
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
            { offset: 0, color: colors[idx % colors.length] + '30' },
            { offset: 1, color: colors[idx % colors.length] + '05' },
          ] } },
          data: points.map(p => [p.date, p.avg_price]),
        });
        idx++;
      }

      chart.setOption({
        tooltip: { trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.95)', borderColor: '#eee', textStyle: { color: '#333' } },
        legend: { data: legendData, bottom: 0, textStyle: { fontSize: 12 } },
        grid: { left: 50, right: 20, top: 20, bottom: 40 },
        xAxis: { type: 'time', axisLine: { lineStyle: { color: '#e5e5e5' } }, axisLabel: { color: '#999', fontSize: 11 } },
        yAxis: { type: 'value', name: '¥/个', nameTextStyle: { color: '#999', fontSize: 11 }, splitLine: { lineStyle: { color: '#f5f5f5' } }, axisLabel: { color: '#999', fontSize: 11 } },
        series,
      });

      const ro = new ResizeObserver(() => chart.resize());
      ro.observe(chartRef.current);
      return () => { ro.disconnect(); };
    });
    return () => { mounted = false; };
  }, [priceTrend, viewMode]);

  const handleSearch = (v: any) => {
    const [sd, ed] = v.date_range ? [v.date_range[0]?.format('YYYY-MM-DD') ?? '', v.date_range[1]?.format('YYYY-MM-DD') ?? ''] : ['', ''];
    setFilters(p => ({
      ...p, page: 1,
      payment_status: v.payment_status ?? '',
      supplier_id: v.supplier_id ?? '',
      carton_box_id: v.carton_box_id ?? '',
      start_date: sd, end_date: ed,
    }));
  };

  const handleReset = () => {
    searchForm.resetFields();
    setFilters({ page: 1, page_size: 20, payment_status: '', start_date: '', end_date: '', supplier_id: '', carton_box_id: '' });
  };

  const exportCSV = () => {
    if (!data.length) { message.warning('没有数据可导出'); return; }
    const header = '供应商,纸箱规格,单价,数量,总额,付款状态,采购日期\n';
    const rows = data.map(r => {
      const name = r.supplier_name || '';
      const box = r.box_type || '';
      const amt = (Number(r.purchase_price) || 0) * (Number(r.purchase_quantity) || 0);
      const dt = r.created_at ? dayjs(r.created_at).format('YYYY-MM-DD') : '';
      return `${name},${box},${Number(r.purchase_price) || 0},${Number(r.purchase_quantity) || 0},${amt.toFixed(2)},${r.payment_status === 'paid' ? '已付' : '未付'},${dt}`;
    }).join('\n');
    const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `纸箱采购_${dayjs().format('YYYY-MM-DD')}.csv`;
    link.click(); URL.revokeObjectURL(link.href);
    message.success('导出成功');
  };

  const handleAdd = () => { setEditingId(null); form.resetFields(); setModalOpen(true); };

  const handleEdit = (r: CPD) => {
    setEditingId(r.id);
    form.setFieldsValue({
      supplier_id: r.supplier_id, carton_box_id: r.carton_box_id,
      purchase_price: r.purchase_price, purchase_quantity: r.purchase_quantity,
    });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const v = await form.validateFields();
      const payload = {
        supplier_id: v.supplier_id, carton_box_id: v.carton_box_id,
        purchase_price: v.purchase_price, purchase_quantity: v.purchase_quantity,
      };
      if (editingId) { await api.put(`/orders/carton/${editingId}`, payload); message.success('更新成功'); }
      else { await api.post('/orders/carton', payload); message.success('添加成功'); }
      setModalOpen(false); fetchData();
    } catch (err: any) { if (err?.errorFields) return; message.error(err?.response?.data?.detail || err?.message || '操作失败'); }
  };

  const handleDelete = async (id: number) => {
    try { await api.delete(`/orders/carton/${id}`); message.success('已移入回收站'); fetchData(); }
    catch { message.error('删除失败'); }
  };

  const batchDelete = () => {
    if (!selectedKeys.length) return;
    Modal.confirm({
      title: `批量删除 ${selectedKeys.length} 条采购记录`,
      content: '删除后将移入回收站，可在系统管理→回收站中恢复。',
      okText: '确定删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await api.post('/orders/batch-delete', { order_type: 'carton', order_ids: selectedKeys });
          message.success(res.data?.message || '批量删除成功');
          setSelectedKeys([]); fetchData();
        } catch (e: any) { message.error(e?.response?.data?.detail || '批量删除失败'); }
      },
    });
  };

  const handleImport = async (file: File) => {
    setImporting(true);
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await api.post('/orders/carton/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      const d = res.data?.data || res.data;
      if (d.created > 0) {
        message.success(`成功导入 ${d.created} 条纸箱采购记录`);
        fetchData();
      }
      if (d.error_count > 0) {
        Modal.warning({ title: `${d.error_count} 条记录导入失败`, content: (d.errors || []).join('\n'), width: 500 });
      }
      if (d.created > 0) setImportModalOpen(false);
    } catch (e: any) { message.error(e?.response?.data?.detail || '导入失败'); }
    finally { setImporting(false); }
  };

  const pageAmt = data.reduce((a, r) => a + (Number(r.purchase_price) || 0) * (Number(r.purchase_quantity) || 0), 0);
  const pageQty = data.reduce((a, r) => a + (Number(r.purchase_quantity) || 0), 0);
  const unpaidCount = data.filter(r => r.payment_status !== 'paid').length;

  const statCards = [
    { label: '总记录', value: total, unit: '条', icon: <FileTextOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.15)' },
    { label: '本页金额', value: `¥${pageAmt.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`, icon: <DollarOutlined />, gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.15)' },
    { label: '本页数量', value: pageQty.toLocaleString(), unit: '个', icon: <InboxOutlined />, gradient: 'linear-gradient(135deg, #13c2c2 0%, #5cdbd3 100%)', glow: 'rgba(19,194,194,0.15)' },
    { label: '未付款', value: unpaidCount, unit: '条', icon: <CloseCircleOutlined />, gradient: 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)', glow: 'rgba(255,77,79,0.15)' },
  ];

  const columns: any[] = [
    { title: 'ID', dataIndex: 'id', width: 60, fixed: 'left', render: (v: number) => <span className="num" style={{ color: 'var(--text-4)', fontSize: 12 }}>#{v}</span> },
    {
      title: '供应商', dataIndex: 'supplier_name', width: 130, ellipsis: true,
      render: (v: string) => <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{v || '-'}</span>,
    },
    {
      title: '纸箱规格', dataIndex: 'box_type', width: 120,
      render: (v: string, r: CPD) => (
        <span style={{
          display: 'inline-block', padding: '1px 8px', borderRadius: 6, fontSize: 12, fontWeight: 500,
          background: 'linear-gradient(135deg, rgba(19,194,194,0.08) 0%, rgba(19,194,194,0.03) 100%)',
          color: '#13c2c2', border: '1px solid rgba(19,194,194,0.12)',
        }}>{v ?? `#${r.carton_box_id}`}</span>
      ),
    },
    {
      title: '单价 (¥)', dataIndex: 'purchase_price', width: 100, align: 'right' as const,
      render: (v: any) => v != null ? <span className="num" style={{ fontWeight: 500 }}>{Number(v).toFixed(2)}</span> : '-',
      sorter: (a: any, b: any) => (Number(a.purchase_price) || 0) - (Number(b.purchase_price) || 0),
    },
    {
      title: '数量', dataIndex: 'purchase_quantity', width: 80, align: 'right' as const,
      render: (v: any) => <span className="num" style={{ fontWeight: 500 }}>{(Number(v) || 0).toLocaleString()}</span>,
      sorter: (a: any, b: any) => (Number(a.purchase_quantity) || 0) - (Number(b.purchase_quantity) || 0),
    },
    {
      title: '总额 (¥)', key: 'amount', width: 120, align: 'right' as const,
      render: (_: any, r: CPD) => {
        const amt = (Number(r.purchase_price) || 0) * (Number(r.purchase_quantity) || 0);
        return <span className="num" style={{ fontWeight: 700, color: '#fa8c16' }}>¥{amt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
      },
      sorter: (a: any, b: any) => ((Number(a.purchase_price) || 0) * (Number(a.purchase_quantity) || 0)) - ((Number(b.purchase_price) || 0) * (Number(b.purchase_quantity) || 0)),
    },
    {
      title: '库存', dataIndex: 'stock_quantity', width: 90, align: 'right' as const,
      render: (v: any, r: CPD) => {
        const qty = Number(v) || 0;
        const box = cartonBoxes.find(b => b.id === r.carton_box_id);
        const threshold = box?.low_stock_threshold || 50;
        const isLow = qty < threshold;
        return (
          <span className="num" style={{ fontWeight: 500, color: isLow ? '#ff4d4f' : 'var(--text-2)' }}>
            {qty.toLocaleString()}
            {isLow && <WarningOutlined style={{ marginLeft: 4, fontSize: 11 }} />}
          </span>
        );
      },
    },
    {
      title: '付款', dataIndex: 'payment_status', width: 80, align: 'center' as const,
      render: (_: any, r: CPD) => (
        <Tag
          color={r.payment_status === 'paid' ? 'success' : 'error'}
          style={{ borderRadius: 6, fontWeight: 500, fontSize: 12, padding: '1px 10px', boxShadow: r.payment_status === 'paid' ? '0 1px 4px rgba(82,196,26,0.15)' : '0 1px 4px rgba(255,77,79,0.15)' }}
          icon={r.payment_status === 'paid' ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
        >
          {r.payment_status === 'paid' ? '已付' : '未付'}
        </Tag>
      ),
    },
    {
      title: '日期', dataIndex: 'created_at', width: 100,
      render: (v: string) => v ? <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{dayjs(v).format('MM-DD HH:mm')}</span> : '-',
      sorter: (a: any, b: any) => dayjs(a.created_at || 0).unix() - dayjs(b.created_at || 0).unix(),
    },
    {
      title: '操作', key: 'actions', width: 100, fixed: 'right' as const, align: 'center' as const,
      render: (_: any, r: CPD) => (
        <Space size={0}>
          <Tooltip title="编辑"><Button type="text" size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)} style={{ color: 'var(--brand)', borderRadius: 6 }} /></Tooltip>
          <Popconfirm title="确定移入回收站？" description="可在系统管理→回收站中恢复" onConfirm={() => handleDelete(r.id)} okText="移入回收站" cancelText="取消" okButtonProps={{ danger: true }}>
            <Tooltip title="删除"><Button type="text" size="small" danger icon={<DeleteOutlined />} style={{ borderRadius: 6 }} /></Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const summaryRow = () => {
    if (!data.length) return null;
    const totalAmt = data.reduce((a, r) => a + (Number(r.purchase_price) || 0) * (Number(r.purchase_quantity) || 0), 0);
    const totalQty = data.reduce((a, r) => a + (Number(r.purchase_quantity) || 0), 0);
    return (
      <Table.Summary fixed>
        <Table.Summary.Row>
          <Table.Summary.Cell index={0} colSpan={1}><span style={{ fontWeight: 700, color: 'var(--text-2)' }}>合计</span></Table.Summary.Cell>
          <Table.Summary.Cell index={1} colSpan={3}></Table.Summary.Cell>
          <Table.Summary.Cell index={4} align="right"><span className="num" style={{ fontWeight: 700 }}>{totalQty.toLocaleString()}</span></Table.Summary.Cell>
          <Table.Summary.Cell index={5} align="right"><span className="num" style={{ fontWeight: 700, color: '#fa8c16' }}>¥{totalAmt.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></Table.Summary.Cell>
          <Table.Summary.Cell index={6} colSpan={4}></Table.Summary.Cell>
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
        background: 'linear-gradient(135deg, rgba(19,194,194,0.06) 0%, rgba(250,140,22,0.04) 50%, rgba(114,46,209,0.03) 100%)',
        border: '1px solid rgba(19,194,194,0.08)',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 36, height: 36, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #13c2c2 0%, #36cfc9 50%, #87e8de 100%)', color: '#fff', fontSize: 17,
              boxShadow: '0 4px 14px rgba(19,194,194,0.25)',
            }}><DropboxOutlined /></span>
            纸箱采购中心
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 46 }}>采购管理 · 价格分析 · 库存联动</div>
        </div>
        <Space size={8}>
          <Segmented
            value={viewMode}
            onChange={v => setViewMode(v as ViewMode)}
            options={[
              { label: <Space size={4}><UnorderedListOutlined />订单</Space>, value: 'orders' },
              { label: <Space size={4}><BarChartOutlined />分析</Space>, value: 'analytics' },
            ]}
            style={{ borderRadius: 10 }}
          />
          <Tooltip title="AI 分析">
            <Button icon={<RobotOutlined />} onClick={async () => {
              setAiOpen(true); setAiContent(''); setAiLoading(true);
              try {
                const response = await fetch('/api/ai/chat', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                  body: JSON.stringify({ message: `请基于以下纸箱采购数据进行分析，给出库存建议和采购优化方案。注意：仅基于提供的数据分析，不要编造。\n\n纸箱采购数据(共${data.length}条，展示前20条):\n${data.slice(0, 20).map(d => `${d.box_type||'-'} | 供应商:${d.supplier_name||'-'} | 单价:${d.purchase_price ?? '-'}元 | 数量:${d.purchase_quantity ?? '-'} | 金额:${((Number(d.purchase_price)||0)*(Number(d.purchase_quantity)||0)).toFixed(2)}元 | 库存:${d.stock_quantity ?? '-'} | 付款:${d.payment_status === 'paid' ? '已付' : '未付'}`).join('\n')}`, history: [], stream: true }),
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
          <Tooltip title="导入 CSV"><Button icon={<UploadOutlined />} onClick={() => setImportModalOpen(true)} style={{ borderRadius: 10, height: 38, width: 38 }} /></Tooltip>
          <Tooltip title="导出 CSV"><Button icon={<DownloadOutlined />} onClick={exportCSV} style={{ borderRadius: 10, height: 38, width: 38 }} /></Tooltip>
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
        <>
          {/* ── 筛选 + 表格 ── */}
          <div className="panel stagger-in" style={{ animationDelay: '200ms' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
              <Form form={searchForm} layout="inline" onFinish={handleSearch} style={{ gap: 8, flexWrap: 'wrap' }}>
                <Form.Item name="supplier_id" style={{ marginBottom: 6 }}>
                  <Select placeholder="供应商" allowClear style={{ width: 130 }} showSearch optionFilterProp="label"
                    options={suppliers.map(s => ({ value: s.id, label: s.name }))} />
                </Form.Item>
                <Form.Item name="carton_box_id" style={{ marginBottom: 6 }}>
                  <Select placeholder="纸箱规格" allowClear style={{ width: 130 }} showSearch optionFilterProp="label"
                    options={cartonBoxes.map(b => ({ value: b.id, label: b.box_type }))} />
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
                padding: '8px 20px',
                background: 'linear-gradient(135deg, rgba(19,194,194,0.06) 0%, rgba(19,194,194,0.02) 100%)',
                borderBottom: '1px solid rgba(19,194,194,0.08)',
                display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, flexWrap: 'wrap',
              }}>
                <span>已选 <b style={{ color: '#13c2c2' }}>{selectedKeys.length}</b> 条</span>
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
              scroll={{ x: 1080 }}
              locale={{ emptyText: '暂无纸箱采购记录' }}
            />
          </div>
        </>
      ) : (
        /* ── 分析视图 ── */
        <Row gutter={[16, 16]}>
          {/* 全局统计 */}
          <Col span={24}>
            <div className="panel stagger-in" style={{ padding: 20 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <BarChartOutlined style={{ color: '#1677ff' }} /> 采购总览
              </div>
              {stats ? (
                <Row gutter={[24, 16]}>
                  <Col xs={12} sm={6}>
                    <Statistic title="总采购额" prefix="¥" value={stats.total_amount} precision={0}
                      valueStyle={{ fontWeight: 700, color: '#fa8c16', fontSize: 22 }} />
                  </Col>
                  <Col xs={12} sm={6}>
                    <Statistic title="总采购量" value={stats.total_qty} suffix="个"
                      valueStyle={{ fontWeight: 700, color: '#13c2c2', fontSize: 22 }} />
                  </Col>
                  <Col xs={12} sm={6}>
                    <Statistic title="未付金额" prefix="¥" value={stats.unpaid_amount} precision={0}
                      valueStyle={{ fontWeight: 700, color: '#ff4d4f', fontSize: 22 }} />
                    <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 2 }}>{stats.unpaid_count} 笔未付</div>
                  </Col>
                  <Col xs={12} sm={6}>
                    <Statistic title="供应商/规格" value={`${stats.supplier_count} / ${stats.box_type_count}`}
                      valueStyle={{ fontWeight: 700, color: '#722ed1', fontSize: 22 }} />
                  </Col>
                </Row>
              ) : <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-4)' }}>加载中...</div>}
            </div>
          </Col>

          {/* 价格趋势图 */}
          <Col xs={24} lg={14}>
            <div className="panel stagger-in" style={{ padding: 20, animationDelay: '100ms' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <LineChartOutlined style={{ color: '#13c2c2' }} /> 90天价格趋势
              </div>
              <div ref={chartRef} style={{ height: 280, width: '100%' }} />
              {priceTrend && Object.keys(priceTrend.trends).length === 0 && (
                <Empty description="暂无价格数据" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: -240 }} />
              )}
            </div>
          </Col>

          {/* 库存状态 */}
          <Col xs={24} lg={10}>
            <div className="panel stagger-in" style={{ padding: 20, animationDelay: '150ms' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <AppstoreOutlined style={{ color: '#52c41a' }} /> 纸箱库存状态
              </div>
              {stats?.stock_overview?.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {stats.stock_overview.map(box => {
                    const pct = box.low_stock_threshold > 0 ? Math.min(100, (box.stock_quantity / box.low_stock_threshold) * 100) : 100;
                    return (
                      <div key={box.id} style={{
                        padding: '10px 14px', borderRadius: 10,
                        background: box.is_low
                          ? 'linear-gradient(135deg, rgba(255,77,79,0.06) 0%, rgba(255,77,79,0.02) 100%)'
                          : 'linear-gradient(135deg, rgba(82,196,26,0.06) 0%, rgba(82,196,26,0.02) 100%)',
                        border: `1px solid ${box.is_low ? 'rgba(255,77,79,0.1)' : 'rgba(82,196,26,0.1)'}`,
                        transition: 'all 0.3s',
                      }}
                        onMouseEnter={e => { e.currentTarget.style.transform = 'translateX(3px)'; }}
                        onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: 13 }}>{box.box_type}</span>
                          <Space size={8}>
                            <span className="num" style={{ fontWeight: 700, fontSize: 15, color: box.is_low ? '#ff4d4f' : '#52c41a' }}>
                              {box.stock_quantity.toLocaleString()}
                            </span>
                            {box.is_low && <Tag color="error" style={{ borderRadius: 4, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>低库存</Tag>}
                          </Space>
                        </div>
                        <Progress
                          percent={Math.round(pct)}
                          size="small"
                          strokeColor={box.is_low ? '#ff4d4f' : pct < 150 ? '#faad14' : '#52c41a'}
                          trailColor="rgba(0,0,0,0.04)"
                          showInfo={false}
                          style={{ marginBottom: 0 }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-4)', marginTop: 2 }}>
                          <span>阈值: {box.low_stock_threshold}</span>
                          <span>参考价: ¥{box.purchase_price.toFixed(2)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : <Empty description="暂无库存数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            </div>
          </Col>

          {/* 按规格分析 */}
          <Col xs={24} lg={12}>
            <div className="panel stagger-in" style={{ padding: 20, animationDelay: '200ms' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <InboxOutlined style={{ color: '#fa8c16' }} /> 规格采购分布
              </div>
              {stats?.by_box?.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {stats.by_box.map((b, i) => {
                    const maxAmt = Math.max(...stats.by_box.map(x => x.amount));
                    const pct = maxAmt > 0 ? (b.amount / maxAmt) * 100 : 0;
                    const colors = ['#13c2c2', '#1677ff', '#fa8c16', '#52c41a', '#722ed1', '#eb2f96'];
                    const color = colors[i % colors.length];
                    return (
                      <div key={b.box_type} style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.015)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{b.box_type}</span>
                          <span className="num" style={{ fontWeight: 700, color, fontSize: 14 }}>¥{b.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.04)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', borderRadius: 3, background: color, width: `${pct}%`, transition: 'width 0.6s ease' }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-4)', marginTop: 3 }}>
                          <span>{b.qty.toLocaleString()} 个</span>
                          <span>均价 ¥{b.avg_price}</span>
                          <span>库存 {b.stock_quantity.toLocaleString()}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            </div>
          </Col>

          {/* 供应商排行 */}
          <Col xs={24} lg={12}>
            <div className="panel stagger-in" style={{ padding: 20, animationDelay: '250ms' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShopOutlined style={{ color: '#722ed1' }} /> 供应商排行
              </div>
              {stats?.by_supplier?.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {stats.by_supplier.slice(0, 8).map((s, i) => {
                    const medals = ['🥇', '🥈', '🥉'];
                    return (
                      <div key={s.supplier_name} style={{
                        padding: '10px 12px', borderRadius: 8,
                        background: i < 3 ? `linear-gradient(135deg, rgba(114,46,209,${0.06 - i * 0.015}) 0%, rgba(114,46,209,0.01) 100%)` : 'rgba(0,0,0,0.015)',
                        border: i < 3 ? '1px solid rgba(114,46,209,0.08)' : '1px solid transparent',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        transition: 'all 0.3s',
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
                          <div className="num" style={{ fontWeight: 700, color: '#722ed1', fontSize: 14 }}>¥{s.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{s.qty.toLocaleString()} 个 · {s.order_count} 笔</div>
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
          <span style={{
            width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: editingId ? 'linear-gradient(135deg, #fa8c16, #ffc53d)' : 'linear-gradient(135deg, #13c2c2, #5cdbd3)',
            color: '#fff', fontSize: 13,
          }}>{editingId ? <EditOutlined /> : <PlusOutlined />}</span>
          {editingId ? '编辑纸箱采购' : '新建纸箱采购'}
        </div>
      } open={modalOpen}
        onOk={handleSubmit} onCancel={() => setModalOpen(false)} width={520} destroyOnClose okText="保存" cancelText="取消"
        styles={{ body: { paddingTop: 20 } }}>
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="supplier_id" label="供应商" rules={[{ required: true, message: '请选择' }]}>
                <Select placeholder="选择供应商" showSearch optionFilterProp="label"
                  options={suppliers.map(s => ({ value: s.id, label: s.name }))}
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
            </Col>
            <Col span={12}>
              <Form.Item name="carton_box_id" label="纸箱规格" rules={[{ required: true, message: '请选择' }]}>
                <Select placeholder="选择纸箱" showSearch optionFilterProp="label"
                  onChange={(v: number) => {
                    const box = cartonBoxes.find(b => b.id === v);
                    if (box) form.setFieldValue('purchase_price', Number(box.purchase_price));
                  }}
                  options={cartonBoxes.map(b => ({
                    value: b.id,
                    label: `${b.box_type} (¥${Number(b.purchase_price).toFixed(2)} · 库存${b.stock_quantity || 0})`,
                  }))} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="purchase_price" label="单价 (¥)" rules={[{ required: true, message: '请输入' }]}>
                <InputNumber min={0.01} step={0.01} style={{ width: '100%' }} placeholder="0.00" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="purchase_quantity" label="数量" rules={[{ required: true, message: '请输入' }]}>
                <InputNumber min={1} style={{ width: '100%' }} placeholder="0" />
              </Form.Item>
            </Col>
          </Row>
          {form.getFieldValue('purchase_price') && form.getFieldValue('purchase_quantity') ? (
            <Alert type="info" showIcon
              message={`预计总额: ¥${((Number(form.getFieldValue('purchase_price')) || 0) * (Number(form.getFieldValue('purchase_quantity')) || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              style={{ borderRadius: 8, marginBottom: 0 }}
            />
          ) : null}
        </Form>
      </Modal>

      {/* ── 导入弹窗 ── */}
      <Modal title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg, #52c41a, #95de64)', color: '#fff', fontSize: 13,
          }}><UploadOutlined /></span>
          批量导入纸箱采购
        </div>
      } open={importModalOpen} onCancel={() => setImportModalOpen(false)} footer={null} width={500} destroyOnClose>
        <div style={{ marginBottom: 16 }}>
          <Alert type="info" showIcon style={{ borderRadius: 8, marginBottom: 12 }}
            message="CSV 格式要求"
            description={
              <div style={{ fontSize: 12 }}>
                <div>表头: 供应商名称, 纸箱规格, 采购单价, 采购数量, 付款状态</div>
                <div style={{ marginTop: 4, color: 'var(--text-3)' }}>供应商名称和纸箱规格必须与系统中已有的一致</div>
              </div>
            }
          />
        </div>
        <Upload.Dragger
          accept=".csv,.xlsx,.xls"
          maxCount={1}
          showUploadList={false}
          disabled={importing}
          beforeUpload={file => { handleImport(file); return false; }}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined style={{ color: '#52c41a', fontSize: 40 }} /></p>
          <p className="ant-upload-text" style={{ fontWeight: 600 }}>{importing ? '导入中...' : '点击或拖拽文件到此区域'}</p>
          <p className="ant-upload-hint">支持 CSV / Excel 格式</p>
        </Upload.Dragger>
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
