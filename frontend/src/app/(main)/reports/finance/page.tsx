'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Row, Col, message, Spin, Table, Tag, Tooltip, Button, Space, Progress, Select, Modal, DatePicker } from 'antd';
import {
  DollarOutlined, CheckCircleOutlined, CloseCircleOutlined, ShopOutlined,
  BarChartOutlined, PieChartOutlined, RiseOutlined, ReloadOutlined,
  ShoppingCartOutlined, DropboxOutlined, ExperimentOutlined,
  DownloadOutlined, FundOutlined, RobotOutlined, CalendarOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dayjs from 'dayjs';
import dynamic from 'next/dynamic';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

interface FinanceData {
  overview: { total: number; paid: number; unpaid: number; paid_rate: number };
  by_category: { name: string; key: string; total: number; paid: number; unpaid: number; count: number; unpaid_count: number }[];
  monthly: { month: string; fruit: number; carton: number; material: number; total: number }[];
  top_suppliers: { name: string; amount: number; count: number }[];
}

const CAT_CONFIG: Record<string, { color: string; icon: React.ReactNode; gradient: string }> = {
  fruit: { color: '#91cc75', icon: <ShoppingCartOutlined />, gradient: 'linear-gradient(135deg, #00b96b, #5cdbd3)' },
  carton: { color: '#73c0de', icon: <DropboxOutlined />, gradient: 'linear-gradient(135deg, #13c2c2, #5cdbd3)' },
  material: { color: '#9a60b4', icon: <ExperimentOutlined />, gradient: 'linear-gradient(135deg, #722ed1, #b37feb)' },
};

function fmt(v: number): string {
  if (v >= 10000) return `${(v / 10000).toFixed(1)}万`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function MonthlyBarChart({ data }: { data: FinanceData['monthly'] }) {
  if (!data?.length) return <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)' }}>暂无数据</div>;
  const option = {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#333', fontSize: 12 },
      formatter: (params: any) => {
        let html = `<div style="font-weight:700;margin-bottom:6px">${params[0].axisValue}</div>`;
        let total = 0;
        params.forEach((p: any) => {
          total += p.value;
          html += `<div style="display:flex;align-items:center;gap:6px;margin:2px 0">${p.marker}<span>${p.seriesName}</span><span style="margin-left:auto;font-weight:600">¥${Number(p.value).toLocaleString()}</span></div>`;
        });
        html += `<div style="border-top:1px solid #eee;margin-top:6px;padding-top:6px;font-weight:700">合计: ¥${total.toLocaleString()}</div>`;
        return html;
      },
    },
    legend: {
      bottom: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8,
      textStyle: { color: '#8a919f', fontSize: 11 },
    },
    grid: { top: 20, right: 20, bottom: 40, left: 55 },
    xAxis: {
      type: 'category',
      data: data.map(d => d.month.slice(5) + '月'),
      axisLine: { lineStyle: { color: '#e8e8e8' } },
      axisTick: { show: false },
      axisLabel: { color: '#8a919f', fontSize: 11 },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { color: '#f0f0f0', type: 'dashed' } },
      axisLabel: {
        color: '#8a919f', fontSize: 11,
        formatter: (v: number) => v >= 10000 ? `${(v / 10000).toFixed(0)}万` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`,
      },
    },
    series: [
      {
        name: '水果', type: 'bar', stack: 'cost', barWidth: '50%',
        data: data.map(d => d.fruit),
        itemStyle: { color: '#91cc75', borderRadius: [0, 0, 0, 0] },
        emphasis: { focus: 'series' },
      },
      {
        name: '纸箱', type: 'bar', stack: 'cost',
        data: data.map(d => d.carton),
        itemStyle: { color: '#73c0de' },
        emphasis: { focus: 'series' },
      },
      {
        name: '材料', type: 'bar', stack: 'cost',
        data: data.map(d => d.material),
        itemStyle: { color: '#9a60b4', borderRadius: [4, 4, 0, 0] },
        emphasis: { focus: 'series' },
      },
    ],
    animationDuration: 1000,
    animationEasing: 'cubicOut',
  };
  return <ReactECharts option={option} style={{ height: 300 }} notMerge />;
}

function CategoryPieChart({ data }: { data: FinanceData['by_category'] }) {
  const total = data.reduce((a, c) => a + c.total, 0) || 1;
  const items = data.filter(c => c.total > 0);
  if (!items.length) return <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)' }}>暂无数据</div>;
  const option = {
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#333', fontSize: 12 },
      formatter: (p: any) => `<div style="font-weight:700;margin-bottom:4px">${p.name}</div><div>金额: ¥${Number(p.value).toLocaleString()}</div><div>占比: ${p.percent}%</div>`,
    },
    legend: {
      bottom: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8,
      textStyle: { color: '#8a919f', fontSize: 11 },
    },
    series: [{
      type: 'pie', radius: ['45%', '72%'], center: ['50%', '45%'],
      padAngle: 2, itemStyle: { borderRadius: 6 },
      label: {
        show: true, position: 'outside', fontSize: 11,
        formatter: '{b}\n{d}%',
      },
      emphasis: { scaleSize: 6 },
      data: items.map(cat => {
        const cfg = CAT_CONFIG[cat.key];
        return { name: cat.name, value: cat.total, itemStyle: { color: cfg?.color || '#5470c6' } };
      }),
      animationType: 'scale',
      animationEasing: 'elasticOut',
    }],
    graphic: [{ type: 'group', left: 'center', top: '40%', children: [
      { type: 'text', style: { text: `¥${fmt(total)}`, x: 0, y: -6, fill: '#1f1f1f', fontSize: 16, fontWeight: 700, textAlign: 'center' } },
      { type: 'text', style: { text: '总额', x: 0, y: 12, fill: '#8a919f', fontSize: 10, textAlign: 'center' } },
    ] }],
  };
  return <ReactECharts option={option} style={{ height: 300 }} notMerge />;
}

function SupplierBarChart({ data }: { data: FinanceData['top_suppliers'] }) {
  if (!data?.length) return <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)' }}>暂无数据</div>;
  const sorted = [...data].reverse();
  const colors = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#48b8d0'];
  const option = {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#333', fontSize: 12 },
      formatter: (params: any) => {
        const p = params[0];
        const d = data.find(s => s.name === p.name);
        return `<div style="font-weight:700;margin-bottom:4px">${p.name}</div><div>金额: ¥${Number(p.value).toLocaleString()}</div><div>订单: ${d?.count || 0}笔</div>`;
      },
    },
    grid: { top: 10, right: 80, bottom: 10, left: 10, containLabel: true },
    xAxis: {
      type: 'value',
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { color: '#f5f5f5', type: 'dashed' } },
      axisLabel: { color: '#8a919f', fontSize: 10, formatter: (v: number) => v >= 10000 ? `${(v / 10000).toFixed(0)}万` : `${v}` },
    },
    yAxis: {
      type: 'category', data: sorted.map(s => s.name),
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: '#525966', fontSize: 11, width: 80, overflow: 'truncate' },
    },
    series: [{
      type: 'bar', barWidth: 18,
      data: sorted.map((s, i) => ({
        value: s.amount,
        itemStyle: {
          borderRadius: [0, 8, 8, 0],
          color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [
            { offset: 0, color: colors[(data.length - 1 - i) % colors.length] },
            { offset: 1, color: colors[(data.length - 1 - i) % colors.length] + '88' },
          ] },
        },
      })),
      label: {
        show: true, position: 'right',
        formatter: (p: any) => `¥${fmt(Number(p.value))}`,
        color: '#525966', fontSize: 11, fontWeight: 600,
      },
      animationDelay: (idx: number) => idx * 60,
    }],
    animationDuration: 1000,
  };
  return <ReactECharts option={option} style={{ height: Math.max(250, data.length * 36) }} notMerge />;
}

const { RangePicker } = DatePicker;

const QUICK_RANGES: { label: string; value: [dayjs.Dayjs, dayjs.Dayjs] }[] = [
  { label: '本月', value: [dayjs().startOf('month'), dayjs()] },
  { label: '上月', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
  { label: '近3个月', value: [dayjs().subtract(3, 'month').startOf('month'), dayjs()] },
  { label: '近6个月', value: [dayjs().subtract(6, 'month').startOf('month'), dayjs()] },
  { label: '近12个月', value: [dayjs().subtract(12, 'month').startOf('month'), dayjs()] },
  { label: '今年', value: [dayjs().startOf('year'), dayjs()] },
  { label: '去年', value: [dayjs().subtract(1, 'year').startOf('year'), dayjs().subtract(1, 'year').endOf('year')] },
];

export default function FinanceReportPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<FinanceData | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(6, 'month').startOf('month'), dayjs(),
  ]);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiAbortRef = useRef<AbortController | null>(null);

  const openAi = async () => {
    if (!data) return;
    setAiContent(''); setAiOpen(true); setAiLoading(true);
    const o = data.overview;
    const cats = data.by_category;
    const rangeLabel = `${dateRange[0].format('YYYY-MM-DD')} ~ ${dateRange[1].format('YYYY-MM-DD')}`;
    const ctx = [`财务报表分析(${rangeLabel}):`, `总支出¥${o.total}, 已付¥${o.paid}, 未付¥${o.unpaid}, 付款率${o.paid_rate}%`];
    cats.forEach(c => ctx.push(`  ${c.name}: ¥${c.total} (已付¥${c.paid} 未付¥${c.unpaid})`));
    const prompt = `分析以下财务数据。\n\n${ctx.join('\n')}\n\n用markdown，含：1.财务概况 2.成本结构 3.风险提示 4.优化建议\n简洁不超250字。`;
    try {
      aiAbortRef.current = new AbortController();
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ message: prompt, history: [], stream: true, context_mode: 'minimal' }),
        signal: aiAbortRef.current.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No reader');
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
    } catch (e: any) {
      if (e.name !== 'AbortError') setAiContent('AI分析暂不可用');
    } finally { setAiLoading(false); aiAbortRef.current = null; }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/reports/finance-summary', {
        params: {
          start_date: dateRange[0].format('YYYY-MM-DD'),
          end_date: dateRange[1].format('YYYY-MM-DD'),
        },
      });
      setData(res.data?.data ?? null);
    } catch { message.error('加载财务数据失败'); }
    finally { setLoading(false); }
  }, [dateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const exportCSV = () => {
    if (!data?.monthly?.length) { message.warning('无数据可导出'); return; }
    const header = '月份,水果采购,纸箱采购,材料采购,合计\n';
    const rows = data.monthly.map(m => `${m.month},${m.fruit},${m.carton},${m.material},${m.total}`).join('\n');
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + header + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `财务汇总_${dayjs().format('YYYY-MM-DD')}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    message.success('导出成功');
  };

  const ov = data?.overview;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22,
        padding: '20px 24px', borderRadius: 'var(--radius-l)',
        background: 'linear-gradient(135deg, rgba(250,140,22,0.06) 0%, rgba(114,46,209,0.03) 100%)',
        border: '1px solid rgba(250,140,22,0.08)',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 32, height: 32, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #fa8c16 0%, #722ed1 100%)', color: '#fff', fontSize: 15,
              boxShadow: '0 3px 10px rgba(250,140,22,0.2)',
            }}><FundOutlined /></span>
            财务报表
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 42 }}>
            <CalendarOutlined style={{ marginRight: 4 }} />
            {dateRange[0].format('YYYY-MM-DD')} ~ {dateRange[1].format('YYYY-MM-DD')} · 采购支出汇总与趋势分析
          </div>
        </div>
        <Space wrap size={8}>
          <RangePicker
            value={dateRange}
            onChange={(dates) => { if (dates && dates[0] && dates[1]) setDateRange([dates[0], dates[1]]); }}
            allowClear={false}
            style={{ borderRadius: 10, height: 38 }}
            presets={QUICK_RANGES.map(r => ({ label: r.label, value: r.value }))}
          />
          <Tooltip title="AI财务分析">
            <Button icon={<RobotOutlined />} onClick={openAi} style={{ borderRadius: 10, height: 38, background: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none', color: '#fff' }}>AI分析</Button>
          </Tooltip>
          <Tooltip title="刷新数据">
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 10, height: 38, width: 38 }} />
          </Tooltip>
          <Tooltip title="导出 CSV">
            <Button icon={<DownloadOutlined />} onClick={exportCSV} disabled={!data?.monthly?.length} style={{ borderRadius: 10, height: 38, width: 38 }} />
          </Tooltip>
        </Space>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>
      ) : data ? (
        <>
          {/* Overview Cards */}
          <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
            {[
              { label: '采购总额', value: `¥${fmt(ov?.total ?? 0)}`, icon: <DollarOutlined />, gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.15)' },
              { label: '已付款', value: `¥${fmt(ov?.paid ?? 0)}`, icon: <CheckCircleOutlined />, gradient: 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: 'rgba(0,185,107,0.15)' },
              { label: '待付款', value: `¥${fmt(ov?.unpaid ?? 0)}`, icon: <CloseCircleOutlined />, gradient: (ov?.unpaid ?? 0) > 0 ? 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)' : 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: (ov?.unpaid ?? 0) > 0 ? 'rgba(255,77,79,0.15)' : 'rgba(0,185,107,0.15)' },
              { label: '付款率', value: `${ov?.paid_rate ?? 0}%`, icon: <RiseOutlined />, gradient: (ov?.paid_rate ?? 0) >= 80 ? 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)' : (ov?.paid_rate ?? 0) >= 50 ? 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)' : 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)', glow: (ov?.paid_rate ?? 0) >= 80 ? 'rgba(0,185,107,0.15)' : 'rgba(250,140,22,0.15)' },
            ].map((s, i) => (
              <Col xs={12} sm={6} key={i}>
                <div style={{
                  padding: '16px 18px', borderRadius: 'var(--radius-m)', background: s.gradient, position: 'relative', overflow: 'hidden',
                  boxShadow: `0 4px 14px ${s.glow}`, transition: 'all 0.3s', cursor: 'default',
                }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
                >
                  <div style={{ position: 'absolute', top: -14, right: -14, width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>{s.icon} {s.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#fff', lineHeight: 1.2 }} className="num">{s.value}</div>
                </div>
              </Col>
            ))}
          </Row>

          {/* Monthly + Category */}
          <Row gutter={[16, 16]} style={{ marginBottom: 18 }}>
            <Col xs={24} lg={14}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head">
                  <span className="panel-title"><BarChartOutlined style={{ color: '#fa8c16' }} />月度采购趋势</span>
                  <Tag color="orange" style={{ borderRadius: 10, fontSize: 11 }}>堆叠柱状图</Tag>
                </div>
                <div className="panel-body">
                  <MonthlyBarChart data={data.monthly} />
                </div>
              </div>
            </Col>
            <Col xs={24} lg={10}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head">
                  <span className="panel-title"><PieChartOutlined style={{ color: '#722ed1' }} />分类占比</span>
                  <Tag color="purple" style={{ borderRadius: 10, fontSize: 11 }}>环形图</Tag>
                </div>
                <div className="panel-body">
                  <CategoryPieChart data={data.by_category} />
                </div>
              </div>
            </Col>
          </Row>

          {/* Category Details Table */}
          <div className="panel" style={{ marginBottom: 18 }}>
            <div className="panel-head">
              <span className="panel-title"><DollarOutlined style={{ color: '#fa8c16' }} />分类付款明细</span>
            </div>
            <Table
              rowKey="key"
              dataSource={data.by_category}
              size="middle"
              pagination={false}
              locale={{ emptyText: '暂无数据' }}
              columns={[
                {
                  title: '类别', dataIndex: 'name', width: 140,
                  render: (v: string, r: any) => {
                    const cfg = CAT_CONFIG[r.key] || {};
                    return (
                      <Space size={8}>
                        <span style={{ width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: cfg.gradient || '#1677ff', color: '#fff', fontSize: 13 }}>{cfg.icon}</span>
                        <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{v}</span>
                      </Space>
                    );
                  },
                },
                { title: '订单数', dataIndex: 'count', width: 90, align: 'center' as const, render: (v: number) => <span className="num" style={{ fontWeight: 600 }}>{v}</span> },
                { title: '总金额', dataIndex: 'total', width: 140, align: 'right' as const, render: (v: number) => <span className="num" style={{ fontWeight: 700, color: '#fa8c16' }}>¥{v.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span> },
                { title: '已付', dataIndex: 'paid', width: 140, align: 'right' as const, render: (v: number) => <span className="num" style={{ fontWeight: 600, color: '#00b96b' }}>¥{v.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span> },
                { title: '待付', dataIndex: 'unpaid', width: 140, align: 'right' as const, render: (v: number) => v > 0 ? <span className="num" style={{ fontWeight: 600, color: '#ff4d4f' }}>¥{v.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span> : <span style={{ color: 'var(--text-4)' }}>-</span> },
                {
                  title: '付款进度', key: 'progress', width: 180,
                  render: (_: any, r: any) => {
                    const pct = r.total > 0 ? Math.round((r.paid / r.total) * 100) : 100;
                    return <Progress percent={pct} size="small" strokeColor={pct >= 80 ? { from: '#00b96b', to: '#5cdbd3' } : pct >= 50 ? { from: '#fa8c16', to: '#ffc53d' } : { from: '#ff4d4f', to: '#ff7875' }} format={p => <span className="num" style={{ fontSize: 12, fontWeight: 600 }}>{p}%</span>} />;
                  },
                },
              ]}
              summary={() => {
                const ov2 = data.overview;
                const pct = ov2.total > 0 ? Math.round((ov2.paid / ov2.total) * 100) : 100;
                return (
                  <Table.Summary fixed>
                    <Table.Summary.Row style={{ background: 'rgba(250,140,22,0.04)' }}>
                      <Table.Summary.Cell index={0}><span style={{ fontWeight: 700, color: 'var(--text-1)' }}>合计</span></Table.Summary.Cell>
                      <Table.Summary.Cell index={1} align="center"><span className="num" style={{ fontWeight: 700 }}>{data.by_category.reduce((a, c) => a + c.count, 0)}</span></Table.Summary.Cell>
                      <Table.Summary.Cell index={2} align="right"><span className="num" style={{ fontWeight: 700, color: '#fa8c16' }}>¥{ov2.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></Table.Summary.Cell>
                      <Table.Summary.Cell index={3} align="right"><span className="num" style={{ fontWeight: 700, color: '#00b96b' }}>¥{ov2.paid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></Table.Summary.Cell>
                      <Table.Summary.Cell index={4} align="right">{ov2.unpaid > 0 ? <span className="num" style={{ fontWeight: 700, color: '#ff4d4f' }}>¥{ov2.unpaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span> : <span style={{ color: 'var(--text-4)' }}>-</span>}</Table.Summary.Cell>
                      <Table.Summary.Cell index={5}><Progress percent={pct} size="small" strokeColor={{ from: '#fa8c16', to: '#ffc53d' }} format={p => <span className="num" style={{ fontSize: 12, fontWeight: 700 }}>{p}%</span>} /></Table.Summary.Cell>
                    </Table.Summary.Row>
                  </Table.Summary>
                );
              }}
            />
          </div>

          {/* Top Suppliers - ECharts Bar */}
          {data.top_suppliers.length > 0 && (
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title"><ShopOutlined style={{ color: '#1677ff' }} />供应商采购排行</span>
                <Tag color="blue" style={{ borderRadius: 10, fontSize: 11 }}>Top {data.top_suppliers.length}</Tag>
              </div>
              <div className="panel-body">
                <SupplierBarChart data={data.top_suppliers} />
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: 80, color: 'var(--text-4)' }}>无数据</div>
      )}

      <Modal
        title={<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #667eea, #764ba2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
          </div>
          <span>AI 财务分析</span>
          {aiLoading && <Spin size="small" />}
        </div>}
        open={aiOpen}
        onCancel={() => { setAiOpen(false); if (aiAbortRef.current) aiAbortRef.current.abort(); }}
        footer={null} width={580}
      >
        <div style={{ padding: '12px 0', fontSize: 14, lineHeight: 1.8, minHeight: 100 }}>
          {aiContent ? (
            <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(102,126,234,0.04)', border: '1px solid rgba(102,126,234,0.1)' }}>
              {aiContent.split(/(\*\*.*?\*\*|\n)/g).map((p, i) => {
                if (p === '\n') return <br key={i} />;
                if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
                return <span key={i}>{p}</span>;
              })}
            </div>
          ) : aiLoading ? (
            <div style={{ textAlign: 'center', padding: 30 }}><Spin size="large" /><div style={{ marginTop: 10, color: 'var(--text-3)' }}>AI正在分析财务数据...</div></div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
