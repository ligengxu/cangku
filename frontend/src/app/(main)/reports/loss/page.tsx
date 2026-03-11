'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Table, message, Spin, Tag, Row, Col, Button, Space, Tooltip, Select,
  DatePicker, Modal, Tabs, Progress, Empty, Segmented,
} from 'antd';
import {
  FallOutlined, WarningOutlined, CheckCircleOutlined, FireOutlined,
  SyncOutlined, DownloadOutlined, SearchOutlined, EyeOutlined,
  DollarOutlined, ShoppingCartOutlined, ExportOutlined,
  TeamOutlined, AppstoreOutlined, CalendarOutlined,
  ArrowUpOutlined, ArrowDownOutlined, RobotOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import { exportToCsv } from '@/utils/exportCsv';
import dayjs from 'dayjs';
import dynamic from 'next/dynamic';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

const { RangePicker } = DatePicker;

interface LossRecord {
  fruit_name: string;
  purchased: number;
  outbound: number;
  loss: number;
  loss_rate: number;
  purchase_count: number;
  outbound_count: number;
  actual_weight: number;
  cost: number;
}

interface BatchRecord {
  purchase_id: number;
  fruit_name: string;
  supplier_name: string;
  purchase_date: string;
  purchase_weight: number;
  purchase_price: number;
  consumed: number;
  remaining: number;
  loss_rate: number;
  outbound_count: number;
}

interface TrendItem {
  month: string;
  purchased: number;
  consumed: number;
  loss_rate: number;
}

interface FruitOption { id: number; name: string; }

interface Summary {
  total_purchased: number;
  total_consumed: number;
  total_remaining: number;
  total_cost: number;
  total_loss_rate: number;
  fruit_count: number;
}

interface BatchDetail {
  purchase_id: number;
  fruit_name: string;
  supplier_name: string;
  purchase_date: string;
  purchase_weight: number;
  purchase_price: number;
  total_consumed: number;
  remaining: number;
  loss_rate: number;
  outbound_count: number;
  details: { sku_name: string; date: string; worker_name: string; quantity: number; consumed: number }[];
  sku_summary: { sku_name: string; quantity: number; consumed: number }[];
  worker_summary: { worker_name: string; quantity: number; consumed: number }[];
}

function getLossColor(rate: number) {
  if (rate < 5) return { tag: 'success' as const, hex: '#00b96b' };
  if (rate <= 10) return { tag: 'warning' as const, hex: '#fa8c16' };
  if (rate <= 20) return { tag: 'error' as const, hex: '#ff4d4f' };
  return { tag: 'error' as const, hex: '#cf1322' };
}

export default function LossReportPage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [data, setData] = useState<LossRecord[]>([]);
  const [batches, setBatches] = useState<BatchRecord[]>([]);
  const [trend, setTrend] = useState<TrendItem[]>([]);
  const [fruitList, setFruitList] = useState<FruitOption[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);

  const [fruitId, setFruitId] = useState<number | undefined>();
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [batchDetail, setBatchDetail] = useState<BatchDetail | null>(null);
  const [detailTab, setDetailTab] = useState('detail');

  const [viewMode, setViewMode] = useState<string>('fruit');

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const params: Record<string, string> = {};
      if (fruitId) params.fruit_id = String(fruitId);
      if (dateRange?.[0]) params.start_date = dateRange[0].format('YYYY-MM-DD');
      if (dateRange?.[1]) params.end_date = dateRange[1].format('YYYY-MM-DD');
      const res = await api.get('/reports/fruit-loss-rates', { params });
      const d = res.data?.data ?? {};
      setData(Array.isArray(d.items) ? d.items : []);
      setBatches(Array.isArray(d.batches) ? d.batches : []);
      setTrend(Array.isArray(d.trend) ? d.trend : []);
      setFruitList(Array.isArray(d.fruit_list) ? d.fruit_list : []);
      setSummary(d.summary ?? null);
    } catch {
      message.error('加载数据失败');
    } finally { setLoading(false); setRefreshing(false); }
  }, [fruitId, dateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openBatchDetail = async (purchaseId: number) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailTab('detail');
    try {
      const res = await api.get(`/reports/batch-loss-detail/${purchaseId}`);
      setBatchDetail(res.data?.data ?? null);
    } catch {
      message.error('加载批次详情失败');
    } finally { setDetailLoading(false); }
  };

  const maxLoss = useMemo(() => Math.max(...data.map(d => d.loss_rate || 0), 1), [data]);

  const trendOption = useMemo(() => {
    if (!trend.length) return null;
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(255,255,255,0.96)',
        borderColor: 'rgba(0,0,0,0.08)',
        borderWidth: 1,
        textStyle: { color: '#333', fontSize: 12 },
      },
      legend: { data: ['采购量', '消耗量', '损耗率'], textStyle: { fontSize: 11 }, bottom: 0 },
      grid: { top: 30, right: 50, bottom: 40, left: 60 },
      xAxis: { type: 'category', data: trend.map(t => t.month), axisLabel: { fontSize: 11 } },
      yAxis: [
        { type: 'value', name: '重量(kg)', axisLabel: { fontSize: 10 }, splitLine: { lineStyle: { type: 'dashed', color: '#f0f0f0' } } },
        { type: 'value', name: '损耗率%', axisLabel: { fontSize: 10, formatter: '{value}%' }, max: 100 },
      ],
      series: [
        {
          name: '采购量', type: 'bar', barWidth: 20, yAxisIndex: 0,
          data: trend.map(t => t.purchased),
          itemStyle: { color: '#1677ff', borderRadius: [4, 4, 0, 0] },
        },
        {
          name: '消耗量', type: 'bar', barWidth: 20, yAxisIndex: 0,
          data: trend.map(t => t.consumed),
          itemStyle: { color: '#00b96b', borderRadius: [4, 4, 0, 0] },
        },
        {
          name: '损耗率', type: 'line', yAxisIndex: 1, smooth: true,
          data: trend.map(t => t.loss_rate),
          lineStyle: { width: 3, color: '#ff4d4f' },
          itemStyle: { color: '#ff4d4f' },
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(255,77,79,0.15)' }, { offset: 1, color: 'rgba(255,77,79,0)' }] } },
          symbol: 'circle', symbolSize: 8,
        },
      ],
    };
  }, [trend]);

  const barOption = useMemo(() => {
    if (!data.length) return null;
    const sorted = [...data].sort((a, b) => b.loss_rate - a.loss_rate).slice(0, 15);
    const rev = [...sorted].reverse();
    return {
      tooltip: {
        trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.96)',
        borderColor: 'rgba(0,0,0,0.08)', borderWidth: 1,
        formatter: (params: any) => {
          const p = params[0];
          const d = sorted.find(s => s.fruit_name === p.name);
          return `<div style="font-weight:700;margin-bottom:4px">${p.name}</div>
            <div>损耗率: ${Number(p.value).toFixed(1)}%</div>
            <div>采购: ${d ? d.purchased.toLocaleString() : 0}kg</div>
            <div>消耗: ${d ? d.outbound.toLocaleString() : 0}kg</div>`;
        },
      },
      grid: { top: 10, right: 60, bottom: 10, left: 10, containLabel: true },
      xAxis: {
        type: 'value', axisLine: { show: false }, axisTick: { show: false },
        splitLine: { lineStyle: { color: '#f5f5f5', type: 'dashed' } },
        axisLabel: { color: '#8a919f', fontSize: 10, formatter: '{value}%' },
      },
      yAxis: {
        type: 'category', data: rev.map(d => d.fruit_name),
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { color: '#525966', fontSize: 11, width: 70, overflow: 'truncate' },
      },
      visualMap: {
        show: false, dimension: 0,
        pieces: [{ lt: 5, color: '#91cc75' }, { gte: 5, lt: 10, color: '#fac858' }, { gte: 10, color: '#ee6666' }],
      },
      series: [{
        type: 'bar', barWidth: 16,
        data: rev.map(d => d.loss_rate || 0),
        itemStyle: { borderRadius: [0, 8, 8, 0] },
        label: { show: true, position: 'right', formatter: (p: any) => `${Number(p.value).toFixed(1)}%`, color: '#525966', fontSize: 11, fontWeight: 600 },
        animationDelay: (idx: number) => idx * 60,
      }],
    };
  }, [data]);

  const batchDetailSkuChart = useMemo(() => {
    if (!batchDetail?.sku_summary?.length) return null;
    return {
      tooltip: { trigger: 'item', formatter: '{b}: {c}kg ({d}%)' },
      series: [{
        type: 'pie', radius: ['40%', '70%'],
        data: batchDetail.sku_summary.map(s => ({ name: s.sku_name, value: s.consumed })),
        label: { fontSize: 11 },
        itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.1)' } },
      }],
    };
  }, [batchDetail]);

  const fruitColumns = [
    {
      title: '水果', dataIndex: 'fruit_name', width: 130,
      render: (v: string) => (
        <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 6, fontSize: 13, fontWeight: 600, background: 'linear-gradient(135deg, rgba(0,185,107,0.08), rgba(0,185,107,0.03))', color: '#00b96b', border: '1px solid rgba(0,185,107,0.12)' }}>{v}</span>
      ),
    },
    {
      title: '采购重量', key: 'pw', align: 'right' as const, width: 110,
      sorter: (a: LossRecord, b: LossRecord) => a.purchased - b.purchased,
      render: (_: any, r: LossRecord) => <span className="num" style={{ fontWeight: 500 }}>{r.purchased ? `${r.purchased.toLocaleString()}kg` : '-'}</span>,
    },
    {
      title: '消耗重量', key: 'cw', align: 'right' as const, width: 110,
      sorter: (a: LossRecord, b: LossRecord) => a.outbound - b.outbound,
      render: (_: any, r: LossRecord) => <span className="num" style={{ fontWeight: 500 }}>{r.outbound ? `${r.outbound.toLocaleString()}kg` : '-'}</span>,
    },
    {
      title: '采购花费', key: 'cost', align: 'right' as const, width: 110,
      sorter: (a: LossRecord, b: LossRecord) => (a.cost || 0) - (b.cost || 0),
      render: (_: any, r: LossRecord) => <span className="num" style={{ fontWeight: 500, color: '#722ed1' }}>¥{(r.cost || 0).toLocaleString()}</span>,
    },
    {
      title: '损耗', dataIndex: 'loss', align: 'right' as const, width: 100,
      sorter: (a: LossRecord, b: LossRecord) => a.loss - b.loss,
      render: (v: number) => <span className="num" style={{ fontWeight: 600, color: '#ff4d4f' }}>{v ? `${v.toLocaleString()}kg` : '-'}</span>,
    },
    {
      title: '损耗率', dataIndex: 'loss_rate', width: 200,
      defaultSortOrder: 'descend' as const,
      sorter: (a: LossRecord, b: LossRecord) => a.loss_rate - b.loss_rate,
      render: (v: number) => {
        const rate = v || 0;
        const c = getLossColor(rate);
        const pct = Math.min((rate / maxLoss) * 100, 100);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, height: 6, background: 'rgba(0,0,0,0.04)', borderRadius: 3, overflow: 'hidden', minWidth: 60 }}>
              <div style={{ width: `${pct}%`, height: '100%', background: `linear-gradient(90deg, ${c.hex}, ${c.hex}88)`, borderRadius: 3, transition: 'width 0.5s' }} />
            </div>
            <Tag color={c.tag} style={{ borderRadius: 6, fontWeight: 600, fontSize: 12, minWidth: 55, textAlign: 'center' }}>{rate.toFixed(1)}%</Tag>
          </div>
        );
      },
    },
  ];

  const batchColumns = [
    {
      title: '批次', key: 'id', width: 80,
      render: (_: any, r: BatchRecord) => <Tag color="blue" style={{ borderRadius: 6, fontWeight: 600 }}>#{r.purchase_id}</Tag>,
    },
    { title: '水果', dataIndex: 'fruit_name', width: 100 },
    { title: '供应商', dataIndex: 'supplier_name', width: 100, ellipsis: true },
    { title: '采购日期', dataIndex: 'purchase_date', width: 100, render: (v: string) => v ? dayjs(v).format('MM-DD') : '-' },
    {
      title: '采购重量', dataIndex: 'purchase_weight', align: 'right' as const, width: 100,
      sorter: (a: BatchRecord, b: BatchRecord) => a.purchase_weight - b.purchase_weight,
      render: (v: number) => <span className="num">{v ? `${v.toLocaleString()}kg` : '-'}</span>,
    },
    {
      title: '消耗', dataIndex: 'consumed', align: 'right' as const, width: 90,
      render: (v: number) => <span className="num" style={{ fontWeight: 500 }}>{v ? `${v.toLocaleString()}kg` : '-'}</span>,
    },
    {
      title: '损耗率', dataIndex: 'loss_rate', width: 120,
      defaultSortOrder: 'descend' as const,
      sorter: (a: BatchRecord, b: BatchRecord) => a.loss_rate - b.loss_rate,
      render: (v: number) => {
        const c = getLossColor(v || 0);
        return <Tag color={c.tag} style={{ borderRadius: 6, fontWeight: 600 }}>{(v || 0).toFixed(1)}%</Tag>;
      },
    },
    {
      title: '操作', key: 'action', width: 80, align: 'center' as const,
      render: (_: any, r: BatchRecord) => (
        <Tooltip title="查看损耗明细">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => openBatchDetail(r.purchase_id)}>详情</Button>
        </Tooltip>
      ),
    },
  ];

  const statCards = summary ? [
    { label: '总采购', value: `${(summary.total_purchased / 1000).toFixed(1)}t`, icon: <ShoppingCartOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.15)' },
    { label: '总消耗', value: `${(summary.total_consumed / 1000).toFixed(1)}t`, icon: <ExportOutlined />, gradient: 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: 'rgba(0,185,107,0.15)' },
    { label: '总损耗率', value: `${summary.total_loss_rate.toFixed(1)}%`, icon: <WarningOutlined />, gradient: summary.total_loss_rate > 10 ? 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)' : summary.total_loss_rate > 5 ? 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)' : 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: summary.total_loss_rate > 10 ? 'rgba(255,77,79,0.15)' : 'rgba(0,185,107,0.15)' },
    { label: '采购花费', value: `¥${(summary.total_cost / 10000).toFixed(1)}万`, icon: <DollarOutlined />, gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', glow: 'rgba(114,46,209,0.15)' },
    { label: '剩余库存', value: `${(summary.total_remaining / 1000).toFixed(1)}t`, icon: <CheckCircleOutlined />, gradient: 'linear-gradient(135deg, #13c2c2 0%, #87e8de 100%)', glow: 'rgba(19,194,194,0.15)' },
    { label: '高损耗品', value: `${data.filter(d => d.loss_rate > 10).length}种`, icon: <FireOutlined />, gradient: 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)', glow: 'rgba(255,77,79,0.15)' },
  ] : [];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22,
        padding: '20px 24px', borderRadius: 'var(--radius-l)',
        background: 'linear-gradient(135deg, rgba(255,77,79,0.06) 0%, rgba(250,140,22,0.03) 100%)',
        border: '1px solid rgba(255,77,79,0.08)',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 36, height: 36, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #ff4d4f 0%, #fa8c16 100%)', color: '#fff', fontSize: 17,
              boxShadow: '0 4px 14px rgba(255,77,79,0.25)',
            }}><FallOutlined /></span>
            水果损耗分析
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 46 }}>
            采购重量 vs 出库消耗 · 批次穿透 · 趋势监控
          </div>
        </div>
        <Space size={8}>
          <Tag color="success" style={{ borderRadius: 6, fontSize: 11 }}>&lt;5% 正常</Tag>
          <Tag color="warning" style={{ borderRadius: 6, fontSize: 11 }}>5-10% 偏高</Tag>
          <Tag color="error" style={{ borderRadius: 6, fontSize: 11 }}>&gt;10% 严重</Tag>
        </Space>
      </div>

      {/* Filters */}
      <div className="panel" style={{ marginBottom: 18 }}>
        <div style={{ padding: '14px 18px', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <Select
            allowClear placeholder="全部水果" style={{ width: 160 }}
            value={fruitId} onChange={v => setFruitId(v)}
            options={fruitList.map(f => ({ value: f.id, label: f.name }))}
            suffixIcon={<SearchOutlined />}
          />
          <RangePicker
            value={dateRange}
            onChange={v => setDateRange(v as [dayjs.Dayjs, dayjs.Dayjs] | null)}
            style={{ width: 260 }}
            placeholder={['开始日期', '结束日期']}
          />
          <Button icon={<SearchOutlined />} type="primary" onClick={() => fetchData()}
            style={{ borderRadius: 8, fontWeight: 600 }}>
            查询
          </Button>
          <div style={{ flex: 1 }} />
          <Tooltip title="AI 损耗诊断">
            <Button icon={<RobotOutlined />} onClick={async () => {
              setAiOpen(true); setAiContent(''); setAiLoading(true);
              if (!data.length) { setAiContent('当前没有损耗数据可供分析，请先查询损耗数据。'); setAiLoading(false); return; }
              const summary = data.map(d => `${d.fruit_name}: 采购${d.purchased}kg, 出库${d.outbound}kg, 损耗率${d.loss_rate}%`).join('; ');
              try {
                const response = await fetch('/api/ai/chat', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                  body: JSON.stringify({ message: `分析以下损耗数据，找出异常高损耗品种，给出改善建议和原因分析：${summary}`, history: [], stream: true }),
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
              borderRadius: 8, background: 'linear-gradient(135deg, #667eea, #764ba2)',
              border: 'none', color: '#fff', boxShadow: '0 3px 10px rgba(102,126,234,0.3)',
            }}>AI诊断</Button>
          </Tooltip>
          <Tooltip title="刷新数据">
            <Button icon={<SyncOutlined spin={refreshing} />} onClick={() => fetchData(true)} style={{ borderRadius: 8 }} />
          </Tooltip>
          <Button icon={<DownloadOutlined />} onClick={() => {
            const exportData = viewMode === 'fruit' ? data : batches;
            const cols = viewMode === 'fruit'
              ? [
                  { key: 'fruit_name', title: '水果名称', render: (v: unknown) => String(v ?? '-') },
                  { key: 'purchased', title: '采购重量(kg)', render: (v: unknown) => String(Number(v) || 0) },
                  { key: 'outbound', title: '消耗重量(kg)', render: (v: unknown) => String(Number(v) || 0) },
                  { key: 'cost', title: '采购花费(元)', render: (v: unknown) => String(Number(v) || 0) },
                  { key: 'loss', title: '损耗(kg)', render: (v: unknown) => String(Number(v) || 0) },
                  { key: 'loss_rate', title: '损耗率(%)', render: (v: unknown) => v != null ? Number(v).toFixed(1) : '-' },
                ]
              : [
                  { key: 'purchase_id', title: '批次号', render: (v: unknown) => String(v) },
                  { key: 'fruit_name', title: '水果', render: (v: unknown) => String(v ?? '-') },
                  { key: 'supplier_name', title: '供应商', render: (v: unknown) => String(v ?? '-') },
                  { key: 'purchase_date', title: '采购日期', render: (v: unknown) => String(v ?? '-') },
                  { key: 'purchase_weight', title: '采购重量(kg)', render: (v: unknown) => String(Number(v) || 0) },
                  { key: 'consumed', title: '消耗(kg)', render: (v: unknown) => String(Number(v) || 0) },
                  { key: 'loss_rate', title: '损耗率(%)', render: (v: unknown) => v != null ? Number(v).toFixed(1) : '-' },
                ];
            exportToCsv(exportData as any, cols as any, viewMode === 'fruit' ? '水果损耗分析' : '批次损耗明细');
          }} disabled={!data.length && !batches.length} style={{ borderRadius: 8 }}>
            导出 CSV
          </Button>
        </div>
      </div>

      {/* Stat Cards */}
      {!loading && statCards.length > 0 && (
        <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
          {statCards.map((s, i) => (
            <Col xs={12} sm={8} md={4} key={i}>
              <div style={{
                padding: '14px 16px', borderRadius: 'var(--radius-m)', background: s.gradient,
                position: 'relative', overflow: 'hidden',
                boxShadow: `0 4px 14px ${s.glow}`, transition: 'all 0.3s',
                animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.06}s`,
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
              >
                <div style={{ position: 'absolute', top: -12, right: -12, width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>{s.icon} {s.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', lineHeight: 1.2 }} className="num">{s.value}</div>
              </div>
            </Col>
          ))}
        </Row>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : (
        <>
          {/* Trend Chart */}
          {trendOption && (
            <div className="panel" style={{ marginBottom: 18 }}>
              <div className="panel-head">
                <span className="panel-title"><CalendarOutlined style={{ color: '#1677ff' }} />月度损耗趋势</span>
                <Tag style={{ borderRadius: 10, fontSize: 11 }}>近6个月 · 采购/消耗/损耗率</Tag>
              </div>
              <div className="panel-body">
                <ReactECharts option={trendOption} style={{ height: 280 }} notMerge />
              </div>
            </div>
          )}

          {/* View Mode Switch */}
          <div style={{ marginBottom: 16 }}>
            <Segmented
              value={viewMode}
              onChange={v => setViewMode(v as string)}
              options={[
                { value: 'fruit', label: <span><AppstoreOutlined style={{ marginRight: 4 }} />按水果品类</span> },
                { value: 'batch', label: <span><ShoppingCartOutlined style={{ marginRight: 4 }} />按采购批次</span> },
              ]}
              style={{ borderRadius: 10 }}
            />
          </div>

          {/* Fruit View */}
          {viewMode === 'fruit' && (
            <>
              {data.length > 0 && barOption && (
                <div className="panel" style={{ marginBottom: 18 }}>
                  <div className="panel-head">
                    <span className="panel-title"><WarningOutlined style={{ color: '#ff4d4f' }} />损耗率对比</span>
                    <span style={{ fontSize: 12, color: 'var(--text-4)' }}>颜色编码 · 按损耗率排序</span>
                  </div>
                  <div className="panel-body">
                    <ReactECharts option={barOption} style={{ height: Math.max(260, Math.min(data.length, 15) * 32) }} notMerge />
                  </div>
                </div>
              )}
              <div className="panel">
                <div className="panel-head">
                  <span className="panel-title"><FallOutlined style={{ color: '#ff4d4f' }} />水果损耗明细</span>
                  <span style={{ fontSize: 12, color: 'var(--text-4)' }}>共 {data.length} 种</span>
                </div>
                <Table dataSource={data} columns={fruitColumns} rowKey="fruit_name" size="middle"
                  pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `共 ${t} 条` }}
                  locale={{ emptyText: '暂无数据' }} />
              </div>
            </>
          )}

          {/* Batch View */}
          {viewMode === 'batch' && (
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title"><ShoppingCartOutlined style={{ color: '#1677ff' }} />批次损耗列表</span>
                <span style={{ fontSize: 12, color: 'var(--text-4)' }}>共 {batches.length} 批 · 点击详情穿透查看</span>
              </div>
              <Table dataSource={batches} columns={batchColumns} rowKey="purchase_id" size="middle"
                pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `共 ${t} 条` }}
                locale={{ emptyText: '暂无数据' }}
                rowClassName={(r: BatchRecord) => r.loss_rate > 20 ? 'row-rejected' : ''} />
            </div>
          )}
        </>
      )}

      {/* Batch Detail Modal */}
      <Modal
        open={detailOpen}
        onCancel={() => { setDetailOpen(false); setBatchDetail(null); }}
        footer={null}
        width={800}
        title={
          batchDetail ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{
                width: 32, height: 32, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'linear-gradient(135deg, #ff4d4f, #fa8c16)', color: '#fff', fontSize: 14,
              }}><EyeOutlined /></span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{batchDetail.fruit_name} · 批次 #{batchDetail.purchase_id}</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 400 }}>
                  {batchDetail.supplier_name} · {batchDetail.purchase_date}
                </div>
              </div>
            </div>
          ) : '批次损耗详情'
        }
        styles={{ body: { paddingTop: 16, maxHeight: '70vh', overflow: 'auto' } }}
      >
        {detailLoading ? (
          <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>
        ) : batchDetail ? (
          <>
            {/* Summary Cards */}
            <Row gutter={[10, 10]} style={{ marginBottom: 16 }}>
              {[
                { label: '采购重量', value: `${batchDetail.purchase_weight}kg`, color: '#1677ff' },
                { label: '消耗重量', value: `${batchDetail.total_consumed}kg`, color: '#00b96b' },
                { label: '剩余重量', value: `${batchDetail.remaining}kg`, color: '#13c2c2' },
                { label: '损耗率', value: `${batchDetail.loss_rate}%`, color: getLossColor(batchDetail.loss_rate).hex },
                { label: '出库标签数', value: `${batchDetail.outbound_count}`, color: '#722ed1' },
                { label: '采购单价', value: `¥${batchDetail.purchase_price}/kg`, color: '#fa8c16' },
              ].map((c, i) => (
                <Col xs={8} key={i}>
                  <div style={{ padding: '10px 12px', borderRadius: 10, border: `1px solid ${c.color}20`, background: `${c.color}06` }}>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 2 }}>{c.label}</div>
                    <div className="num" style={{ fontSize: 16, fontWeight: 700, color: c.color }}>{c.value}</div>
                  </div>
                </Col>
              ))}
            </Row>

            {/* Loss Progress */}
            <div style={{ marginBottom: 16, padding: '12px 16px', borderRadius: 10, background: 'var(--gray-2)' }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>消耗 / 采购 进度</div>
              <Progress
                percent={batchDetail.purchase_weight > 0 ? Math.min((batchDetail.total_consumed / batchDetail.purchase_weight) * 100, 100) : 0}
                strokeColor={getLossColor(batchDetail.loss_rate).hex}
                format={pct => `${(pct || 0).toFixed(1)}%`}
              />
            </div>

            {/* Detail Tabs */}
            <Tabs activeKey={detailTab} onChange={setDetailTab} items={[
              {
                key: 'detail', label: <span><CalendarOutlined /> 明细记录</span>,
                children: (
                  <Table
                    dataSource={batchDetail.details} rowKey={(_, i) => String(i)} size="small"
                    pagination={{ pageSize: 10, showTotal: t => `共 ${t} 条` }}
                    locale={{ emptyText: '暂无出库记录' }}
                    columns={[
                      { title: 'SKU', dataIndex: 'sku_name', width: 140 },
                      { title: '日期', dataIndex: 'date', width: 100 },
                      { title: '工人', dataIndex: 'worker_name', width: 100 },
                      { title: '数量', dataIndex: 'quantity', width: 70, align: 'right' as const, render: (v: number) => <span className="num" style={{ fontWeight: 600 }}>{v}</span> },
                      { title: '消耗(kg)', dataIndex: 'consumed', width: 100, align: 'right' as const, render: (v: number) => <span className="num" style={{ fontWeight: 600, color: '#00b96b' }}>{v.toFixed(2)}</span> },
                    ]}
                  />
                ),
              },
              {
                key: 'sku', label: <span><AppstoreOutlined /> 按SKU</span>,
                children: (
                  <Row gutter={16}>
                    <Col xs={24} sm={12}>
                      <Table
                        dataSource={batchDetail.sku_summary} rowKey="sku_name" size="small"
                        pagination={false}
                        columns={[
                          { title: 'SKU', dataIndex: 'sku_name', width: 140 },
                          { title: '数量', dataIndex: 'quantity', width: 70, align: 'right' as const, render: (v: number) => <span className="num" style={{ fontWeight: 600 }}>{v}</span> },
                          { title: '消耗(kg)', dataIndex: 'consumed', align: 'right' as const, render: (v: number) => <span className="num" style={{ fontWeight: 600, color: '#00b96b' }}>{v.toFixed(2)}</span> },
                        ]}
                      />
                    </Col>
                    <Col xs={24} sm={12}>
                      {batchDetailSkuChart && <ReactECharts option={batchDetailSkuChart} style={{ height: 220 }} notMerge />}
                    </Col>
                  </Row>
                ),
              },
              {
                key: 'worker', label: <span><TeamOutlined /> 按工人</span>,
                children: (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {batchDetail.worker_summary.map((w, i) => {
                      const pct = batchDetail.total_consumed > 0 ? (w.consumed / batchDetail.total_consumed * 100) : 0;
                      const colors = ['#1677ff', '#00b96b', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2'];
                      const color = colors[i % colors.length];
                      return (
                        <div key={w.worker_name} style={{
                          display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10,
                          border: '1px solid var(--border-2)', background: 'var(--bg-card)',
                        }}>
                          <div style={{
                            width: 36, height: 36, borderRadius: 10,
                            background: `linear-gradient(135deg, ${color}, ${color}88)`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0,
                          }}>{w.worker_name.charAt(0)}</div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{w.worker_name}</div>
                            <div style={{ display: 'flex', gap: 12, marginTop: 2 }}>
                              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>标签: {w.quantity}</span>
                              <span style={{ fontSize: 11, color: color, fontWeight: 600 }}>消耗: {w.consumed.toFixed(1)}kg</span>
                              <span style={{ fontSize: 11, color: 'var(--text-4)' }}>占比: {pct.toFixed(1)}%</span>
                            </div>
                          </div>
                          <div style={{ width: 60 }}>
                            <Progress percent={Math.round(pct)} size="small" strokeColor={color} showInfo={false} />
                          </div>
                        </div>
                      );
                    })}
                    {batchDetail.worker_summary.length === 0 && <Empty description="暂无工人数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                  </div>
                ),
              },
            ]} />
          </>
        ) : (
          <Empty description="无数据" />
        )}
      </Modal>

      <style>{`
        .row-rejected td { background: rgba(255,77,79,0.02) !important; }
        .row-rejected:hover td { background: rgba(255,77,79,0.05) !important; }
      `}</style>

      <Modal
        open={aiOpen} onCancel={() => setAiOpen(false)} footer={null} width={600}
        title={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <RobotOutlined style={{ color: '#667eea' }} /><span style={{ fontWeight: 700 }}>AI 损耗诊断</span>
          <Tag color="purple" style={{ borderRadius: 8, fontSize: 11 }}>Qwen AI</Tag>
        </div>}
      >
        <div style={{ padding: '12px 0', minHeight: 180, fontSize: 14, lineHeight: 1.8, color: 'var(--text-1)' }}>
          {aiLoading && !aiContent ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <RobotOutlined style={{ fontSize: 32, color: '#764ba2', opacity: 0.4 }} />
              <div style={{ color: 'var(--text-3)', fontSize: 13, marginTop: 12 }}>正在分析损耗数据...</div>
            </div>
          ) : aiContent ? (
            <div style={{ whiteSpace: 'pre-wrap' }}>
              {aiContent.split(/(\*\*.*?\*\*|\n)/g).map((p, i) => {
                if (p === '\n') return <br key={i} />;
                if (p.startsWith('**') && p.endsWith('**')) return <strong key={i} style={{ color: '#667eea' }}>{p.slice(2, -2)}</strong>;
                return <span key={i}>{p}</span>;
              })}
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
