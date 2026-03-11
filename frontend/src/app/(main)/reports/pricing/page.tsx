'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Table, Select, Button, Space, Row, Col, message, Spin, Tag, Tooltip, Empty, Segmented, Drawer, Badge, Alert } from 'antd';
import {
  SearchOutlined, DollarOutlined, RiseOutlined, FallOutlined, ShopOutlined,
  LineChartOutlined, DownloadOutlined, ReloadOutlined, WarningOutlined,
  TeamOutlined, PieChartOutlined, BarChartOutlined, SwapOutlined,
  ArrowUpOutlined, ArrowDownOutlined, MinusOutlined, InfoCircleOutlined,
  FireOutlined, ThunderboltOutlined, SafetyOutlined, FundOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import type { PriceIntelData, PriceIntelFruit, PriceIntelAlert } from '@/types';
import { exportToCsv } from '@/utils/exportCsv';
import dayjs from 'dayjs';
import dynamic from 'next/dynamic';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

const COLORS = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#48b8d0'];

function TrendTag({ trend, rate }: { trend: string; rate: number }) {
  if (trend === 'rising') return <Tag color="red" style={{ borderRadius: 20, fontWeight: 600, fontSize: 11 }}><ArrowUpOutlined /> 上涨 {rate > 0 ? `${rate}%` : ''}</Tag>;
  if (trend === 'falling') return <Tag color="green" style={{ borderRadius: 20, fontWeight: 600, fontSize: 11 }}><ArrowDownOutlined /> 下降 {rate < 0 ? `${Math.abs(rate)}%` : ''}</Tag>;
  return <Tag color="blue" style={{ borderRadius: 20, fontWeight: 600, fontSize: 11 }}><MinusOutlined /> 稳定</Tag>;
}

function VolatilityBar({ value }: { value: number }) {
  const color = value > 30 ? '#ff4d4f' : value > 15 ? '#faad14' : '#52c41a';
  return (
    <Tooltip title={`波动率 ${value}%`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, height: 6, background: 'rgba(0,0,0,0.04)', borderRadius: 3, overflow: 'hidden', minWidth: 50 }}>
          <div style={{ width: `${Math.min(value, 100)}%`, height: '100%', borderRadius: 3, background: color, transition: 'width 0.6s ease' }} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color, minWidth: 38, textAlign: 'right' }}>{value}%</span>
      </div>
    </Tooltip>
  );
}

function MultiLineChart({ data }: { data: PriceIntelData }) {
  const { timeline, fruit_names } = data;
  if (!timeline.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无趋势数据" />;

  const option = {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#333', fontSize: 12 },
    },
    legend: { data: fruit_names, bottom: 0, textStyle: { fontSize: 11, color: '#8a919f' }, type: 'scroll' },
    grid: { top: 20, right: 20, bottom: 40, left: 50 },
    xAxis: {
      type: 'category',
      data: timeline.map(t => dayjs(t.date as string).format('MM-DD')),
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#e8e8e8' } },
      axisTick: { show: false },
      axisLabel: { color: '#8a919f', fontSize: 10, rotate: timeline.length > 20 ? 30 : 0 },
    },
    yAxis: {
      type: 'value',
      name: '元/kg',
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: '#f0f0f0', type: 'dashed' } },
      axisLabel: { color: '#8a919f', fontSize: 10, formatter: (v: number) => `¥${v}` },
      nameTextStyle: { color: '#8a919f', fontSize: 10 },
    },
    dataZoom: timeline.length > 30 ? [{ type: 'inside', start: 0, end: 100 }, { type: 'slider', bottom: 26, height: 16 }] : undefined,
    series: fruit_names.map((fn, i) => ({
      name: fn,
      type: 'line',
      smooth: true,
      symbol: 'circle',
      symbolSize: 5,
      connectNulls: true,
      data: timeline.map(t => t[fn] ?? null),
      lineStyle: { width: 2.5, color: COLORS[i % COLORS.length] },
      itemStyle: { color: COLORS[i % COLORS.length] },
      emphasis: { itemStyle: { shadowBlur: 10 } },
    })),
    animationDuration: 1200,
    animationEasing: 'cubicOut',
  };

  return <ReactECharts option={option} style={{ height: 340 }} notMerge />;
}

function CostPieChart({ data }: { data: PriceIntelData }) {
  const { cost_distribution } = data;
  if (!cost_distribution?.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />;

  const option = {
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      formatter: (p: any) => `<b>${p.name}</b><br/>成本: ¥${Number(p.value).toLocaleString()}<br/>占比: ${p.data.percentage}%`,
    },
    legend: { orient: 'vertical', right: 10, top: 'center', textStyle: { fontSize: 11 } },
    series: [{
      type: 'pie',
      radius: ['40%', '70%'],
      center: ['35%', '50%'],
      avoidLabelOverlap: true,
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      label: { show: false },
      emphasis: { label: { show: true, fontSize: 14, fontWeight: 'bold' } },
      data: cost_distribution.map((d, i) => ({ ...d, itemStyle: { color: COLORS[i % COLORS.length] } })),
    }],
    animationDuration: 800,
  };

  return <ReactECharts option={option} style={{ height: 300 }} notMerge />;
}

function FruitDetailChart({ fruit }: { fruit: PriceIntelFruit }) {
  const pts = fruit.price_history;
  if (pts.length < 2) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="历史数据不足" />;

  const option = {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      formatter: (params: any) => {
        const p = params[0];
        const w = params[1];
        return `<div style="font-weight:700;margin-bottom:4px">${p.axisValue}</div>
          <div>价格: ¥${Number(p.value).toFixed(2)}/kg</div>
          ${w ? `<div>采购量: ${Number(w.value).toFixed(1)}kg</div>` : ''}`;
      },
    },
    grid: { top: 30, right: 50, bottom: 30, left: 50 },
    xAxis: {
      type: 'category',
      data: pts.map(p => dayjs(p.date).format('MM-DD')),
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#e8e8e8' } },
      axisTick: { show: false },
      axisLabel: { color: '#8a919f', fontSize: 10 },
    },
    yAxis: [
      {
        type: 'value', name: '元/kg', position: 'left',
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { lineStyle: { color: '#f0f0f0', type: 'dashed' } },
        axisLabel: { color: '#8a919f', fontSize: 10, formatter: (v: number) => `¥${v}` },
      },
      {
        type: 'value', name: '采购量(kg)', position: 'right',
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { color: '#8a919f', fontSize: 10 },
      },
    ],
    series: [
      {
        type: 'line', smooth: true, symbol: 'circle', symbolSize: 6, yAxisIndex: 0,
        data: pts.map(p => p.price),
        lineStyle: { width: 2.5, color: '#5470c6' },
        itemStyle: { color: '#5470c6', borderWidth: 2 },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(84,112,198,0.25)' }, { offset: 1, color: 'rgba(84,112,198,0.01)' }] } },
        markLine: { silent: true, data: [{ type: 'average', name: '均价' }], lineStyle: { color: '#ee6666', type: 'dashed' }, label: { formatter: '均价 ¥{c}', color: '#ee6666', fontSize: 10 } },
        markPoint: { data: [{ type: 'max', name: '最高' }, { type: 'min', name: '最低' }], symbolSize: 40, label: { fontSize: 10 } },
      },
      {
        type: 'bar', yAxisIndex: 1, barWidth: '40%',
        data: pts.map(p => p.weight),
        itemStyle: { color: 'rgba(145,204,117,0.4)', borderRadius: [4, 4, 0, 0] },
      },
    ],
    animationDuration: 1000,
  };

  return <ReactECharts option={option} style={{ height: 280 }} notMerge />;
}

function SupplierCompareChart({ fruit }: { fruit: PriceIntelFruit }) {
  const sb = fruit.supplier_breakdown;
  if (!sb?.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无供应商数据" />;

  const option = {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
    },
    grid: { top: 20, right: 20, bottom: 30, left: 80 },
    xAxis: {
      type: 'value', name: '元/kg',
      axisLabel: { color: '#8a919f', fontSize: 10, formatter: (v: number) => `¥${v}` },
      splitLine: { lineStyle: { color: '#f0f0f0', type: 'dashed' } },
    },
    yAxis: {
      type: 'category',
      data: sb.map(s => s.supplier_name),
      axisLabel: { color: '#333', fontSize: 11, fontWeight: 500 },
    },
    series: [
      {
        type: 'bar', barWidth: 20,
        data: sb.map((s, i) => ({
          value: s.avg_price,
          itemStyle: {
            color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: COLORS[i % COLORS.length] }, { offset: 1, color: COLORS[(i + 1) % COLORS.length] }] },
            borderRadius: [0, 6, 6, 0],
          },
        })),
        label: { show: true, position: 'right', formatter: (p: any) => `¥${Number(p.value).toFixed(2)}`, fontSize: 11, fontWeight: 600, color: '#333' },
      },
    ],
    animationDuration: 800,
  };

  return <ReactECharts option={option} style={{ height: Math.max(sb.length * 50, 120) }} notMerge />;
}

const STAT_CARDS_META = [
  { key: 'total_cost', label: '总采购成本', icon: <DollarOutlined />, prefix: '¥', gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.18)' },
  { key: 'total_weight', label: '总采购量', icon: <BarChartOutlined />, suffix: 'kg', gradient: 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: 'rgba(0,185,107,0.18)' },
  { key: 'avg_price_per_kg', label: '综合均价', icon: <FundOutlined />, prefix: '¥', suffix: '/kg', gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', glow: 'rgba(114,46,209,0.18)' },
  { key: 'fruit_count', label: '水果种类', icon: <PieChartOutlined />, suffix: '种', gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.18)' },
  { key: 'batch_count', label: '采购批次', icon: <ShopOutlined />, suffix: '批', gradient: 'linear-gradient(135deg, #13c2c2 0%, #87e8de 100%)', glow: 'rgba(19,194,194,0.18)' },
  { key: 'supplier_count', label: '供应商数', icon: <TeamOutlined />, suffix: '家', gradient: 'linear-gradient(135deg, #eb2f96 0%, #ff85c0 100%)', glow: 'rgba(235,47,150,0.18)' },
];

export default function PricingReportPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PriceIntelData | null>(null);
  const [days, setDays] = useState(90);
  const [viewMode, setViewMode] = useState<string>('overview');
  const [drawerFruit, setDrawerFruit] = useState<PriceIntelFruit | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/reports/price-intelligence', { params: { days } });
      const d = res.data?.data ?? res.data ?? {};
      setData(d as PriceIntelData);
    } catch {
      message.error('加载价格数据失败');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const alertIcons: Record<string, React.ReactNode> = {
    high_volatility: <ThunderboltOutlined style={{ color: '#faad14' }} />,
    price_rising: <FireOutlined style={{ color: '#ff4d4f' }} />,
    price_falling: <SafetyOutlined style={{ color: '#52c41a' }} />,
  };

  const fruitColumns = useMemo(() => [
    {
      title: '水果', dataIndex: 'fruit_name', key: 'fruit_name', width: 120, fixed: 'left' as const,
      render: (v: string, r: PriceIntelFruit) => (
        <a onClick={() => setDrawerFruit(r)} style={{ fontWeight: 600, color: 'var(--brand)' }}>
          {v}
        </a>
      ),
    },
    {
      title: '趋势', dataIndex: 'trend', key: 'trend', width: 110,
      render: (_: unknown, r: PriceIntelFruit) => <TrendTag trend={r.trend} rate={r.change_rate} />,
    },
    {
      title: '最新价', dataIndex: 'latest_price', key: 'latest_price', width: 100, sorter: (a: PriceIntelFruit, b: PriceIntelFruit) => a.latest_price - b.latest_price,
      render: (v: number) => <span className="num" style={{ fontWeight: 700, color: '#1677ff' }}>¥{Number(v).toFixed(2)}</span>,
    },
    {
      title: '均价', dataIndex: 'avg_price', key: 'avg_price', width: 100, sorter: (a: PriceIntelFruit, b: PriceIntelFruit) => a.avg_price - b.avg_price,
      render: (v: number) => <span className="num" style={{ fontWeight: 600 }}>¥{Number(v).toFixed(2)}</span>,
    },
    {
      title: '价格区间', key: 'range', width: 140,
      render: (_: unknown, r: PriceIntelFruit) => (
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          ¥{Number(r.min_price).toFixed(2)} ~ ¥{Number(r.max_price).toFixed(2)}
        </span>
      ),
    },
    {
      title: '波动率', dataIndex: 'volatility', key: 'volatility', width: 130, sorter: (a: PriceIntelFruit, b: PriceIntelFruit) => a.volatility - b.volatility,
      render: (v: number) => <VolatilityBar value={v} />,
    },
    {
      title: '总成本', dataIndex: 'total_cost', key: 'total_cost', width: 120, sorter: (a: PriceIntelFruit, b: PriceIntelFruit) => a.total_cost - b.total_cost,
      render: (v: number) => <span className="num" style={{ fontWeight: 600 }}>¥{Number(v).toLocaleString()}</span>,
    },
    {
      title: '总重量', dataIndex: 'total_weight', key: 'total_weight', width: 110, sorter: (a: PriceIntelFruit, b: PriceIntelFruit) => a.total_weight - b.total_weight,
      render: (v: number) => <span className="num">{Number(v).toLocaleString()}kg</span>,
    },
    {
      title: '批次/供应商', key: 'counts', width: 100,
      render: (_: unknown, r: PriceIntelFruit) => (
        <Space direction="vertical" size={0} style={{ fontSize: 12 }}>
          <span>{r.batch_count}批</span>
          <span style={{ color: 'var(--text-4)' }}>{r.supplier_count}家</span>
        </Space>
      ),
    },
    {
      title: '操作', key: 'action', width: 80, fixed: 'right' as const,
      render: (_: unknown, r: PriceIntelFruit) => (
        <Button type="link" size="small" icon={<LineChartOutlined />} onClick={() => setDrawerFruit(r)}>详情</Button>
      ),
    },
  ], []);

  const supplierColumns = [
    { title: '供应商', dataIndex: 'supplier_name', key: 'supplier_name', width: 140, render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
    {
      title: '总成本', dataIndex: 'total_cost', key: 'total_cost', width: 130,
      sorter: (a: any, b: any) => a.total_cost - b.total_cost, defaultSortOrder: 'descend' as const,
      render: (v: number) => <span className="num" style={{ fontWeight: 700, color: '#1677ff' }}>¥{Number(v).toLocaleString()}</span>,
    },
    { title: '总重量', dataIndex: 'total_weight', key: 'total_weight', width: 110, render: (v: number) => <span className="num">{Number(v).toLocaleString()}kg</span> },
    { title: '均价', dataIndex: 'avg_price', key: 'avg_price', width: 100, render: (v: number) => <span className="num">¥{Number(v).toFixed(2)}</span> },
    { title: '批次', dataIndex: 'batch_count', key: 'batch_count', width: 80 },
    { title: '品种数', dataIndex: 'fruit_count', key: 'fruit_count', width: 80 },
    {
      title: '供应品种', dataIndex: 'fruits', key: 'fruits', ellipsis: true,
      render: (v: string[]) => v?.map((f, i) => <Tag key={i} style={{ borderRadius: 12, fontSize: 11, marginBottom: 2 }}>{f}</Tag>),
    },
  ];

  const handleExport = () => {
    if (!data?.fruits.length) return;
    exportToCsv(
      data.fruits,
      [
        { key: 'fruit_name', title: '水果' },
        { key: 'trend', title: '趋势' },
        { key: 'latest_price', title: '最新价', render: v => Number(v).toFixed(2) },
        { key: 'avg_price', title: '均价', render: v => Number(v).toFixed(2) },
        { key: 'min_price', title: '最低价', render: v => Number(v).toFixed(2) },
        { key: 'max_price', title: '最高价', render: v => Number(v).toFixed(2) },
        { key: 'volatility', title: '波动率%', render: v => String(v) },
        { key: 'change_rate', title: '变动率%', render: v => String(v) },
        { key: 'total_cost', title: '总成本', render: v => Number(v).toFixed(2) },
        { key: 'total_weight', title: '总重量(kg)', render: v => Number(v).toFixed(1) },
        { key: 'batch_count', title: '批次数', render: v => String(v) },
        { key: 'supplier_count', title: '供应商数', render: v => String(v) },
      ],
      `价格智能分析_${days}天`,
    );
  };

  const summary = data?.summary;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Page header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20,
        padding: '20px 24px', borderRadius: 'var(--radius-l)',
        background: 'linear-gradient(135deg, rgba(22,119,255,0.06) 0%, rgba(114,46,209,0.04) 50%, rgba(235,47,150,0.03) 100%)',
        border: '1px solid rgba(22,119,255,0.06)',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 34, height: 34, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #1677ff 0%, #722ed1 100%)', color: '#fff', fontSize: 16,
              boxShadow: '0 4px 12px rgba(22,119,255,0.25)',
            }}><FundOutlined /></span>
            价格智能分析
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 44 }}>
            多维度价格对比 · 波动预警 · 供应商分析 · 成本洞察
          </div>
        </div>
        <Space size={8} wrap>
          <Select value={days} onChange={setDays} style={{ width: 120 }} options={[
            { label: '近30天', value: 30 }, { label: '近60天', value: 60 },
            { label: '近90天', value: 90 }, { label: '近180天', value: 180 },
            { label: '近365天', value: 365 },
          ]} />
          <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading} style={{ borderRadius: 8 }}>刷新</Button>
          <Button icon={<DownloadOutlined />} onClick={handleExport} disabled={!data?.fruits.length} style={{ borderRadius: 8 }}>导出</Button>
        </Space>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>
      ) : !data || !data.fruits.length ? (
        <div className="panel" style={{ padding: 80, textAlign: 'center' }}>
          <Empty description="暂无采购价格数据" />
        </div>
      ) : (
        <>
          {/* Summary stats */}
          <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
            {STAT_CARDS_META.map((c, i) => {
              const val = (summary as any)?.[c.key] ?? 0;
              const display = c.prefix
                ? `${c.prefix}${typeof val === 'number' && val >= 1000 ? Number(val).toLocaleString() : Number(val).toFixed(2)}`
                : String(val);
              return (
                <Col xs={12} sm={8} md={4} key={i}>
                  <div className="stagger-item" style={{
                    background: c.gradient, borderRadius: 'var(--radius-l)',
                    padding: '16px 14px', position: 'relative', overflow: 'hidden',
                    boxShadow: `0 6px 20px ${c.glow}`, transition: 'all 0.3s', cursor: 'default',
                    animationDelay: `${i * 60}ms`,
                  }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px) scale(1.02)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
                  >
                    <div style={{ position: 'absolute', top: -15, right: -15, width: 60, height: 60, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                      <span style={{ width: 26, height: 26, borderRadius: 7, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: 13 }}>{c.icon}</span>
                      <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: 600 }}>{c.label}</span>
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.08)' }} className="num">{display}</div>
                    {c.suffix && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 1 }}>{c.suffix}</div>}
                  </div>
                </Col>
              );
            })}
          </Row>

          {/* Alerts */}
          {data.alerts.length > 0 && (
            <div style={{ marginBottom: 18 }}>
              <Row gutter={[10, 10]}>
                {data.alerts.map((a, i) => (
                  <Col xs={24} sm={12} md={8} key={i}>
                    <Alert
                      type={a.type === 'price_falling' ? 'success' : a.type === 'high_volatility' ? 'warning' : 'error'}
                      showIcon
                      icon={alertIcons[a.type]}
                      message={<span style={{ fontWeight: 600, fontSize: 13 }}>{a.message}</span>}
                      style={{ borderRadius: 'var(--radius-m)', background: 'var(--glass-bg)', backdropFilter: 'blur(10px)' }}
                      banner
                    />
                  </Col>
                ))}
              </Row>
            </div>
          )}

          {/* View mode selector */}
          <div style={{ marginBottom: 16 }}>
            <Segmented
              value={viewMode}
              onChange={v => setViewMode(v as string)}
              options={[
                { label: <span><LineChartOutlined /> 趋势对比</span>, value: 'overview' },
                { label: <span><PieChartOutlined /> 成本分布</span>, value: 'cost' },
                { label: <span><TeamOutlined /> 供应商分析</span>, value: 'supplier' },
              ]}
              style={{ fontWeight: 600 }}
            />
          </div>

          {/* Charts section */}
          {viewMode === 'overview' && (
            <div className="panel" style={{ marginBottom: 18 }}>
              <div className="panel-head">
                <span className="panel-title"><RiseOutlined style={{ color: '#722ed1' }} /> 多水果价格走势对比</span>
                <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{data.fruit_names.length} 种水果 · {data.timeline.length} 个采购日</span>
              </div>
              <div className="panel-body">
                <MultiLineChart data={data} />
              </div>
            </div>
          )}

          {viewMode === 'cost' && (
            <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
              <Col xs={24} md={12}>
                <div className="panel" style={{ height: '100%' }}>
                  <div className="panel-head">
                    <span className="panel-title"><PieChartOutlined style={{ color: '#fa8c16' }} /> 采购成本分布</span>
                  </div>
                  <div className="panel-body">
                    <CostPieChart data={data} />
                  </div>
                </div>
              </Col>
              <Col xs={24} md={12}>
                <div className="panel" style={{ height: '100%' }}>
                  <div className="panel-head">
                    <span className="panel-title"><BarChartOutlined style={{ color: '#1677ff' }} /> 成本排名 TOP</span>
                  </div>
                  <div className="panel-body">
                    {data.cost_distribution.slice(0, 8).map((d, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < 7 ? '1px solid rgba(0,0,0,0.04)' : 'none' }}>
                        <span style={{
                          width: 22, height: 22, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          background: i < 3 ? ['linear-gradient(135deg,#ff6b6b,#ee5a24)', 'linear-gradient(135deg,#ffa502,#ff6348)', 'linear-gradient(135deg,#1dd1a1,#10ac84)'][i] : '#f0f0f0',
                          color: i < 3 ? '#fff' : '#999', fontSize: 11, fontWeight: 700,
                        }}>{i + 1}</span>
                        <span style={{ flex: 1, fontWeight: 500 }}>{d.name}</span>
                        <span className="num" style={{ fontWeight: 700, color: '#1677ff' }}>¥{Number(d.value).toLocaleString()}</span>
                        <Tag color={i < 3 ? 'red' : 'default'} style={{ borderRadius: 12, marginRight: 0 }}>{d.percentage}%</Tag>
                      </div>
                    ))}
                  </div>
                </div>
              </Col>
            </Row>
          )}

          {viewMode === 'supplier' && (
            <div className="panel" style={{ marginBottom: 18 }}>
              <div className="panel-head">
                <span className="panel-title"><TeamOutlined style={{ color: '#eb2f96' }} /> 供应商采购排名</span>
                <span style={{ fontSize: 12, color: 'var(--text-4)' }}>共 {data.supplier_ranking.length} 家供应商</span>
              </div>
              <Table
                dataSource={data.supplier_ranking}
                columns={supplierColumns}
                rowKey="supplier_name"
                size="middle"
                pagination={false}
                locale={{ emptyText: '暂无供应商数据' }}
              />
            </div>
          )}

          {/* Fruit detail table */}
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title"><SwapOutlined style={{ color: '#1677ff' }} /> 水果价格对比明细</span>
              <Space size={8}>
                <span style={{ fontSize: 12, color: 'var(--text-4)' }}>共 {data.fruits.length} 种</span>
                <Tooltip title="点击水果名称查看详细分析">
                  <InfoCircleOutlined style={{ color: 'var(--text-4)', fontSize: 13 }} />
                </Tooltip>
              </Space>
            </div>
            <Table
              dataSource={data.fruits}
              columns={fruitColumns}
              rowKey="fruit_name"
              size="middle"
              scroll={{ x: 1100 }}
              pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `共 ${t} 种` }}
              locale={{ emptyText: '暂无价格数据' }}
            />
          </div>
        </>
      )}

      {/* Fruit detail drawer */}
      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 32, height: 32, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #1677ff, #722ed1)', color: '#fff', fontSize: 15,
            }}><LineChartOutlined /></span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{drawerFruit?.fruit_name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', fontWeight: 400 }}>价格详细分析</div>
            </div>
          </div>
        }
        open={!!drawerFruit}
        onClose={() => setDrawerFruit(null)}
        width={Math.min(680, typeof window !== 'undefined' ? window.innerWidth - 20 : 680)}
        styles={{ body: { padding: '16px 20px' } }}
      >
        {drawerFruit && (
          <>
            {/* KPI cards */}
            <Row gutter={[10, 10]} style={{ marginBottom: 16 }}>
              {[
                { label: '最新价', value: `¥${Number(drawerFruit.latest_price).toFixed(2)}`, color: '#1677ff' },
                { label: '均价', value: `¥${Number(drawerFruit.avg_price).toFixed(2)}`, color: '#722ed1' },
                { label: '最低', value: `¥${Number(drawerFruit.min_price).toFixed(2)}`, color: '#52c41a' },
                { label: '最高', value: `¥${Number(drawerFruit.max_price).toFixed(2)}`, color: '#ff4d4f' },
              ].map((c, i) => (
                <Col span={6} key={i}>
                  <div style={{
                    textAlign: 'center', padding: '12px 8px', borderRadius: 'var(--radius-m)',
                    background: `${c.color}08`, border: `1px solid ${c.color}15`,
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{c.label}</div>
                    <div className="num" style={{ fontSize: 18, fontWeight: 800, color: c.color }}>{c.value}</div>
                  </div>
                </Col>
              ))}
            </Row>

            <Row gutter={[10, 10]} style={{ marginBottom: 16 }}>
              <Col span={8}>
                <div style={{ textAlign: 'center', padding: '10px 8px', borderRadius: 'var(--radius-m)', background: 'rgba(0,0,0,0.02)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>趋势</div>
                  <TrendTag trend={drawerFruit.trend} rate={drawerFruit.change_rate} />
                </div>
              </Col>
              <Col span={8}>
                <div style={{ textAlign: 'center', padding: '10px 8px', borderRadius: 'var(--radius-m)', background: 'rgba(0,0,0,0.02)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>波动率</div>
                  <div className="num" style={{ fontWeight: 700, color: drawerFruit.volatility > 30 ? '#ff4d4f' : drawerFruit.volatility > 15 ? '#faad14' : '#52c41a' }}>{drawerFruit.volatility}%</div>
                </div>
              </Col>
              <Col span={8}>
                <div style={{ textAlign: 'center', padding: '10px 8px', borderRadius: 'var(--radius-m)', background: 'rgba(0,0,0,0.02)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>总成本</div>
                  <div className="num" style={{ fontWeight: 700, color: '#1677ff' }}>¥{Number(drawerFruit.total_cost).toLocaleString()}</div>
                </div>
              </Col>
            </Row>

            {/* Price chart */}
            <div className="panel" style={{ marginBottom: 14 }}>
              <div className="panel-head">
                <span className="panel-title"><RiseOutlined style={{ color: '#722ed1' }} /> 价格走势 + 采购量</span>
              </div>
              <div className="panel-body" style={{ padding: '8px 0' }}>
                <FruitDetailChart fruit={drawerFruit} />
              </div>
            </div>

            {/* Supplier comparison */}
            {drawerFruit.supplier_breakdown.length > 0 && (
              <div className="panel" style={{ marginBottom: 14 }}>
                <div className="panel-head">
                  <span className="panel-title"><TeamOutlined style={{ color: '#eb2f96' }} /> 供应商价格对比</span>
                  <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{drawerFruit.supplier_breakdown.length} 家</span>
                </div>
                <div className="panel-body" style={{ padding: '8px 0' }}>
                  <SupplierCompareChart fruit={drawerFruit} />
                </div>
                <Table
                  dataSource={drawerFruit.supplier_breakdown}
                  columns={[
                    { title: '供应商', dataIndex: 'supplier_name', key: 'supplier_name', render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span> },
                    { title: '均价', dataIndex: 'avg_price', key: 'avg_price', render: (v: number) => <span className="num" style={{ fontWeight: 700, color: '#1677ff' }}>¥{Number(v).toFixed(2)}</span> },
                    { title: '最低', dataIndex: 'min_price', key: 'min_price', render: (v: number) => <span className="num">¥{Number(v).toFixed(2)}</span> },
                    { title: '最高', dataIndex: 'max_price', key: 'max_price', render: (v: number) => <span className="num">¥{Number(v).toFixed(2)}</span> },
                    { title: '批次', dataIndex: 'batch_count', key: 'batch_count' },
                    { title: '总量(kg)', dataIndex: 'total_weight', key: 'total_weight', render: (v: number) => <span className="num">{Number(v).toFixed(1)}</span> },
                  ]}
                  rowKey="supplier_name"
                  size="small"
                  pagination={false}
                />
              </div>
            )}

            {/* Price history table */}
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title"><LineChartOutlined style={{ color: '#1677ff' }} /> 历史明细</span>
                <Button size="small" icon={<DownloadOutlined />} onClick={() => exportToCsv(
                  drawerFruit.price_history,
                  [
                    { key: 'date', title: '日期', render: v => v ? dayjs(v as string).format('YYYY-MM-DD') : '-' },
                    { key: 'price', title: '价格(元/kg)', render: v => Number(v).toFixed(2) },
                    { key: 'weight', title: '采购量(kg)', render: v => Number(v).toFixed(1) },
                  ],
                  `${drawerFruit.fruit_name}_价格历史`,
                )} style={{ borderRadius: 6 }}>导出</Button>
              </div>
              <Table
                dataSource={drawerFruit.price_history}
                columns={[
                  { title: '日期', dataIndex: 'date', key: 'date', render: (v: string) => <span style={{ fontWeight: 500 }}>{v ? dayjs(v).format('YYYY-MM-DD') : '-'}</span> },
                  { title: '价格', dataIndex: 'price', key: 'price', render: (v: number) => <span className="num" style={{ fontWeight: 700, color: '#1677ff' }}>¥{Number(v).toFixed(2)}</span> },
                  { title: '采购量', dataIndex: 'weight', key: 'weight', render: (v: number) => <span className="num">{Number(v).toFixed(1)}kg</span> },
                  { title: '成本', key: 'cost', render: (_: unknown, r: any) => <span className="num">¥{(Number(r.price) * Number(r.weight)).toFixed(2)}</span> },
                ]}
                rowKey={(_, i) => String(i)}
                size="small"
                pagination={{ pageSize: 10, showTotal: t => `共 ${t} 条` }}
              />
            </div>
          </>
        )}
      </Drawer>
    </div>
  );
}
