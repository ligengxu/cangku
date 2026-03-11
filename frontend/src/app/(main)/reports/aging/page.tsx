'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Select, Button, Table, Tag, Tooltip, Row, Col,
  Empty, Spin, message, Space, Progress,
} from 'antd';
import {
  ClockCircleOutlined, SearchOutlined, ReloadOutlined,
  WarningOutlined, DownloadOutlined, ExportOutlined,
  InboxOutlined, FireOutlined, ThunderboltOutlined,
  FieldTimeOutlined, AppstoreOutlined,
} from '@ant-design/icons';
import api from '@/services/api';

interface AgeSummary {
  total_in_warehouse: number;
  avg_age_hours: number;
  avg_age_days: number;
  max_age_days: number;
  total_weight: number;
  sku_count: number;
  fruit_count: number;
  warning_count: number;
  danger_count: number;
  outbound_today: number;
}
interface AgeBucket { bucket: string; count: number }
interface SkuAging {
  sku_id: number; sku_name: string; sku_description: string; fruit_name: string;
  count: number; avg_age_days: number; max_age_days: number; total_weight: number; health: string;
}
interface FruitAging { fruit_name: string; count: number; total_weight: number; avg_age_days: number }
interface DailyTrend { date: string; new_printed: number; shipped: number }
interface OldestLabel {
  id: number; sku_id: number; sku_name: string; worker_id: number; worker_name: string;
  age_days: number; created_at: string; estimated_weight: number;
}
interface AgingData {
  summary: AgeSummary;
  age_distribution: AgeBucket[];
  sku_breakdown: SkuAging[];
  fruit_breakdown: FruitAging[];
  daily_trend: DailyTrend[];
  oldest_labels: OldestLabel[];
}

const BUCKET_COLORS = ['#00b96b', '#52c41a', '#faad14', '#fa8c16', '#f5222d', '#a8071a'];
const STAT_CARDS = [
  { key: 'total', bg: 'linear-gradient(135deg, #fa8c16, #ffc53d)', glow: 'rgba(250,140,22,0.15)' },
  { key: 'avg', bg: 'linear-gradient(135deg, #1677ff, #69b1ff)', glow: 'rgba(22,119,255,0.15)' },
  { key: 'max', bg: 'linear-gradient(135deg, #f5222d, #ff7875)', glow: 'rgba(245,34,45,0.15)' },
  { key: 'weight', bg: 'linear-gradient(135deg, #722ed1, #b37feb)', glow: 'rgba(114,46,209,0.15)' },
  { key: 'warning', bg: 'linear-gradient(135deg, #faad14, #ffd666)', glow: 'rgba(250,173,20,0.15)' },
  { key: 'today', bg: 'linear-gradient(135deg, #00b96b, #5cdbd3)', glow: 'rgba(0,185,107,0.15)' },
];

const FRUIT_ICONS: Record<string, string> = {
  '苹果': '🍎', '梨': '🍐', '橙': '🍊', '柠檬': '🍋', '桃': '🍑',
  '樱桃': '🍒', '葡萄': '🍇', '西瓜': '🍉', '芒果': '🥭', '猕猴桃': '🥝',
  '香蕉': '🍌', '菠萝': '🍍', '草莓': '🍓', '蓝莓': '🫐',
};
function getFruitIcon(name: string): string {
  for (const [k, v] of Object.entries(FRUIT_ICONS)) if (name.includes(k)) return v;
  return '🍎';
}

export default function LabelAgingPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AgingData | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [fruitFilter, setFruitFilter] = useState<string | undefined>(undefined);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const trendRef = useRef<HTMLCanvasElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (fruitFilter) params.fruit_name = fruitFilter;
      const res = await api.get('/reports/label-aging', { params });
      setData(res.data?.data || null);
    } catch { message.error('查询失败'); }
    finally { setLoading(false); }
  }, [fruitFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  useEffect(() => {
    if (!data?.age_distribution || !chartRef.current) return;
    const canvas = chartRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const dist = data.age_distribution;
    const maxVal = Math.max(...dist.map(d => d.count), 1);
    const barW = Math.min(60, (rect.width - 60) / dist.length - 12);
    const chartH = rect.height - 50;
    const startX = 40;

    ctx.fillStyle = '#888';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const y = 10 + chartH - (chartH * i / 4);
      const val = Math.round(maxVal * i / 4);
      ctx.fillText(String(val), startX - 8, y + 4);
      ctx.strokeStyle = '#f0f0f0';
      ctx.beginPath(); ctx.moveTo(startX, y); ctx.lineTo(rect.width - 10, y); ctx.stroke();
    }

    dist.forEach((d, i) => {
      const x = startX + 12 + i * (barW + 12);
      const h = (d.count / maxVal) * chartH;
      const y = 10 + chartH - h;
      const color = BUCKET_COLORS[i] || '#1677ff';
      const grad = ctx.createLinearGradient(x, y, x, 10 + chartH);
      grad.addColorStop(0, color); grad.addColorStop(1, color + '40');
      ctx.fillStyle = grad;
      ctx.beginPath();
      const r = Math.min(6, barW / 3);
      ctx.moveTo(x + r, y); ctx.lineTo(x + barW - r, y);
      ctx.arcTo(x + barW, y, x + barW, y + r, r);
      ctx.lineTo(x + barW, 10 + chartH); ctx.lineTo(x, 10 + chartH);
      ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
      ctx.fill();

      if (d.count > 0) {
        ctx.fillStyle = '#333'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(String(d.count), x + barW / 2, y - 6);
      }
      ctx.fillStyle = '#666'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(d.bucket, x + barW / 2, 10 + chartH + 16);
    });
  }, [data]);

  useEffect(() => {
    if (!data?.daily_trend || !trendRef.current) return;
    const canvas = trendRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const trend = data.daily_trend;
    const maxVal = Math.max(...trend.map(d => Math.max(d.new_printed, d.shipped)), 1);
    const chartH = rect.height - 50;
    const startX = 45;
    const chartW = rect.width - startX - 20;
    const step = chartW / Math.max(trend.length - 1, 1);

    ctx.fillStyle = '#888'; ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const y = 10 + chartH - (chartH * i / 4);
      ctx.fillText(String(Math.round(maxVal * i / 4)), startX - 8, y + 4);
      ctx.strokeStyle = '#f0f0f0'; ctx.beginPath(); ctx.moveTo(startX, y); ctx.lineTo(rect.width - 10, y); ctx.stroke();
    }

    const drawLine = (key: 'new_printed' | 'shipped', color: string) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      trend.forEach((d, i) => {
        const x = startX + i * step;
        const y = 10 + chartH - (d[key] / maxVal) * chartH;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();

      const fillGrad = ctx.createLinearGradient(0, 10, 0, 10 + chartH);
      fillGrad.addColorStop(0, color + '30'); fillGrad.addColorStop(1, color + '05');
      ctx.fillStyle = fillGrad; ctx.beginPath();
      trend.forEach((d, i) => {
        const x = startX + i * step;
        const y = 10 + chartH - (d[key] / maxVal) * chartH;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.lineTo(startX + (trend.length - 1) * step, 10 + chartH);
      ctx.lineTo(startX, 10 + chartH); ctx.closePath(); ctx.fill();

      trend.forEach((d, i) => {
        const x = startX + i * step;
        const y = 10 + chartH - (d[key] / maxVal) * chartH;
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
      });
    };

    drawLine('new_printed', '#1677ff');
    drawLine('shipped', '#00b96b');

    ctx.fillStyle = '#888'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    trend.forEach((d, i) => {
      if (i % 2 === 0 || trend.length <= 7) {
        ctx.fillText(d.date, startX + i * step, 10 + chartH + 16);
      }
    });

    const legendX = startX + 10;
    const legendY = 6;
    ctx.fillStyle = '#1677ff'; ctx.fillRect(legendX, legendY, 10, 3);
    ctx.fillStyle = '#666'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText('新打印', legendX + 14, legendY + 4);
    ctx.fillStyle = '#00b96b'; ctx.fillRect(legendX + 65, legendY, 10, 3);
    ctx.fillStyle = '#666'; ctx.fillText('已出库', legendX + 79, legendY + 4);
  }, [data]);

  const fruitOptions = Array.from(new Set(data?.sku_breakdown?.map(s => s.fruit_name) || [])).map(n => ({ value: n, label: n }));

  const exportCSV = () => {
    if (!data?.sku_breakdown?.length) { message.warning('暂无数据'); return; }
    const headers = ['SKU,描述,水果,在库数量,平均天数,最大天数,总重量,状态'];
    const rows = data.sku_breakdown.map(s =>
      `${s.sku_name},${s.sku_description},${s.fruit_name},${s.count},${s.avg_age_days},${s.max_age_days},${s.total_weight},${s.health}`
    );
    const csv = '\uFEFF' + [...headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = '标签老化分析.csv'; a.click();
    URL.revokeObjectURL(url); message.success('导出成功');
  };

  const sm = data?.summary;
  const stats = sm ? [
    { label: '仓库滞留', value: sm.total_in_warehouse.toLocaleString(), icon: <InboxOutlined />, ...STAT_CARDS[0], suffix: '件' },
    { label: '平均滞留', value: `${sm.avg_age_days}`, icon: <FieldTimeOutlined />, ...STAT_CARDS[1], suffix: '天' },
    { label: '最长滞留', value: `${sm.max_age_days}`, icon: <FireOutlined />, ...STAT_CARDS[2], suffix: '天' },
    { label: '滞留重量', value: `${sm.total_weight}`, icon: <ThunderboltOutlined />, ...STAT_CARDS[3], suffix: 'kg' },
    { label: '异常SKU', value: `${sm.warning_count + sm.danger_count}`, icon: <WarningOutlined />, ...STAT_CARDS[4], suffix: '种' },
    { label: '今日出库', value: `${sm.outbound_today}`, icon: <ExportOutlined />, ...STAT_CARDS[5], suffix: '件' },
  ] : [];

  const getHealthColor = (h: string) => h === 'danger' ? '#f5222d' : h === 'warning' ? '#fa8c16' : '#00b96b';
  const getHealthLabel = (h: string) => h === 'danger' ? '严重滞留' : h === 'warning' ? '轻度滞留' : '正常';
  const getHealthTag = (h: string) => h === 'danger' ? 'error' : h === 'warning' ? 'warning' : 'success';

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{
        background: 'linear-gradient(135deg, #fa8c16 0%, #f5222d 50%, #eb2f96 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -40, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'absolute', bottom: -20, left: '40%', width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
            <span style={{
              width: 44, height: 44, borderRadius: 14,
              background: 'rgba(255,255,255,0.2)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 22,
            }}><ClockCircleOutlined /></span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>标签老化分析</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
                追踪标签在仓库的滞留时间，识别积压风险
              </div>
            </div>
          </div>
        </div>
      </div>

      {data && (
        <Row gutter={[10, 10]} style={{ marginBottom: 20 }}>
          {stats.map((s, i) => (
            <Col xs={12} sm={8} md={4} key={i}>
              <div style={{
                padding: '14px 16px', borderRadius: 14, background: s.bg,
                boxShadow: `0 4px 16px ${s.glow}`,
                animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.06}s`,
              }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)', display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
                  {s.icon} {s.label}
                </div>
                <div className="num" style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{s.value}</div>
                <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)' }}>{s.suffix}</span>
              </div>
            </Col>
          ))}
        </Row>
      )}

      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head">
          <span className="panel-title"><SearchOutlined style={{ color: '#1677ff' }} /> 筛选</span>
          <Space>
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 8 }} />
            <Button icon={<DownloadOutlined />} onClick={exportCSV} style={{ borderRadius: 8 }}>导出</Button>
          </Space>
        </div>
        <div style={{ padding: '12px 20px' }}>
          <Select value={fruitFilter} onChange={v => setFruitFilter(v)} allowClear
            placeholder="筛选水果类型" style={{ width: '100%', maxWidth: 300, borderRadius: 8 }} options={fruitOptions} />
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : !data ? (
        <div className="panel" style={{ padding: 60, textAlign: 'center' }}>
          <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      ) : (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
            <Col xs={24} md={12}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head">
                  <span className="panel-title"><ClockCircleOutlined style={{ color: '#fa8c16' }} /> 滞留时间分布</span>
                </div>
                <div style={{ padding: '16px 20px' }}>
                  <canvas ref={chartRef} style={{ width: '100%', height: 220 }} />
                </div>
              </div>
            </Col>
            <Col xs={24} md={12}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head">
                  <span className="panel-title"><AppstoreOutlined style={{ color: '#00b96b' }} /> 水果库存占比</span>
                </div>
                <div style={{ padding: '12px 20px' }}>
                  {data.fruit_breakdown.map((f, i) => {
                    const maxCount = Math.max(...data.fruit_breakdown.map(ff => ff.count), 1);
                    const pct = Math.round(f.count / data.summary.total_in_warehouse * 100);
                    const colors = ['#1677ff', '#00b96b', '#722ed1', '#fa8c16', '#eb2f96', '#13c2c2', '#f5222d'];
                    const color = colors[i % colors.length];
                    return (
                      <div key={f.fruit_name} style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                        borderBottom: i < data.fruit_breakdown.length - 1 ? '1px solid var(--border-2)' : 'none',
                      }}>
                        <span style={{ fontSize: 20, width: 28, textAlign: 'center' }}>{getFruitIcon(f.fruit_name)}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontWeight: 600, fontSize: 13 }}>{f.fruit_name}</span>
                            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                              <span className="num" style={{ fontWeight: 700, color, fontSize: 14 }}>{f.count}</span> 件 · 均{f.avg_age_days}天
                            </span>
                          </div>
                          <Progress percent={pct} showInfo={false} strokeColor={color} trailColor="rgba(0,0,0,0.04)" size="small" />
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 36, textAlign: 'right' }}>{pct}%</span>
                      </div>
                    );
                  })}
                  {!data.fruit_breakdown.length && <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                </div>
              </div>
            </Col>
          </Row>

          <div className="panel" style={{ marginBottom: 20 }}>
            <div className="panel-head">
              <span className="panel-title"><ThunderboltOutlined style={{ color: '#1677ff' }} /> 打印/出库趋势（14天）</span>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <canvas ref={trendRef} style={{ width: '100%', height: 200 }} />
            </div>
          </div>

          <div className="panel" style={{ marginBottom: 20 }}>
            <div className="panel-head">
              <span className="panel-title"><WarningOutlined style={{ color: '#f5222d' }} /> SKU 滞留明细</span>
              <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{data.sku_breakdown.length} 种 SKU</span>
            </div>
            <Table
              dataSource={data.sku_breakdown}
              rowKey="sku_id"
              size="small"
              pagination={{ pageSize: 15, showTotal: t => `共 ${t} 条`, size: 'small' }}
              locale={{ emptyText: '暂无数据' }}
              columns={[
                {
                  title: 'SKU', dataIndex: 'sku_name', width: 180, ellipsis: true,
                  render: (v: string, r: SkuAging) => (
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 13, color: getHealthColor(r.health) }}>{v}</span>
                      <div style={{ fontSize: 11, color: 'var(--text-4)' }}>
                        {getFruitIcon(r.fruit_name)} {r.fruit_name}{r.sku_description ? ` · ${r.sku_description}` : ''}
                      </div>
                    </div>
                  ),
                },
                {
                  title: '在库数量', dataIndex: 'count', width: 90, align: 'right' as const,
                  defaultSortOrder: 'descend' as const,
                  sorter: (a: SkuAging, b: SkuAging) => a.count - b.count,
                  render: (v: number) => <span className="num" style={{ fontWeight: 700, color: '#fa8c16' }}>{v}</span>,
                },
                {
                  title: '平均天数', dataIndex: 'avg_age_days', width: 100, align: 'right' as const,
                  sorter: (a: SkuAging, b: SkuAging) => a.avg_age_days - b.avg_age_days,
                  render: (v: number, r: SkuAging) => (
                    <span className="num" style={{ fontWeight: 700, color: getHealthColor(r.health) }}>{v}</span>
                  ),
                },
                {
                  title: '最长天数', dataIndex: 'max_age_days', width: 90, align: 'right' as const,
                  sorter: (a: SkuAging, b: SkuAging) => a.max_age_days - b.max_age_days,
                  render: (v: number) => <span className="num" style={{ fontWeight: 600, color: v > 7 ? '#f5222d' : v > 3 ? '#fa8c16' : 'var(--text-2)' }}>{v}</span>,
                },
                {
                  title: '总重量', dataIndex: 'total_weight', width: 90, align: 'right' as const,
                  render: (v: number) => <span className="num">{v}kg</span>,
                },
                {
                  title: '状态', dataIndex: 'health', width: 100, align: 'center' as const,
                  filters: [
                    { text: '正常', value: 'normal' },
                    { text: '轻度滞留', value: 'warning' },
                    { text: '严重滞留', value: 'danger' },
                  ],
                  onFilter: (v: any, r: SkuAging) => r.health === v,
                  render: (v: string) => (
                    <Tag color={getHealthTag(v)} style={{ borderRadius: 8, fontWeight: 600 }}>
                      {v === 'danger' && <WarningOutlined style={{ marginRight: 3 }} />}
                      {getHealthLabel(v)}
                    </Tag>
                  ),
                },
              ]}
            />
          </div>

          {data.oldest_labels.length > 0 && (
            <div className="panel" style={{ marginBottom: 20 }}>
              <div className="panel-head">
                <span className="panel-title"><FireOutlined style={{ color: '#f5222d' }} /> 长期滞留标签（&gt;5天）</span>
                <span style={{ fontSize: 12, color: 'var(--text-4)' }}>前 {Math.min(data.oldest_labels.length, 50)} 条</span>
              </div>
              <Table
                dataSource={data.oldest_labels}
                rowKey="id"
                size="small"
                pagination={{ pageSize: 10, showTotal: t => `共 ${t} 条`, size: 'small' }}
                locale={{ emptyText: '暂无滞留标签' }}
                columns={[
                  {
                    title: '标签ID', dataIndex: 'id', width: 80,
                    render: (v: number) => <span className="num" style={{ fontWeight: 600, color: '#1677ff' }}>#{v}</span>,
                  },
                  {
                    title: 'SKU', dataIndex: 'sku_name', width: 160, ellipsis: true,
                    render: (v: string) => <span style={{ fontWeight: 600 }}>{v}</span>,
                  },
                  {
                    title: '工人', dataIndex: 'worker_name', width: 100,
                    render: (v: string) => <span style={{ color: 'var(--text-2)' }}>{v}</span>,
                  },
                  {
                    title: '滞留天数', dataIndex: 'age_days', width: 100, align: 'right' as const,
                    defaultSortOrder: 'descend' as const,
                    sorter: (a: OldestLabel, b: OldestLabel) => a.age_days - b.age_days,
                    render: (v: number) => (
                      <Tag color={v > 14 ? 'error' : v > 7 ? 'warning' : 'processing'}
                        style={{ borderRadius: 8, fontWeight: 700 }}>
                        {v} 天 {v > 14 ? <FireOutlined /> : ''}
                      </Tag>
                    ),
                  },
                  {
                    title: '重量', dataIndex: 'estimated_weight', width: 80, align: 'right' as const,
                    render: (v: number) => <span className="num">{v}kg</span>,
                  },
                  {
                    title: '打印时间', dataIndex: 'created_at', width: 140,
                    render: (v: string) => <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{v ? v.slice(0, 16).replace('T', ' ') : '-'}</span>,
                  },
                ]}
              />
            </div>
          )}

          <div style={{
            padding: '10px 16px', borderRadius: 10,
            background: 'linear-gradient(135deg, rgba(250,140,22,0.04), rgba(245,34,45,0.03))',
            border: '1px solid rgba(250,140,22,0.08)',
            fontSize: 12, color: 'var(--text-4)', lineHeight: 1.8,
          }}>
            <WarningOutlined style={{ color: '#fa8c16', marginRight: 6 }} />
            标签老化说明：标签打印后在仓库等待出库的时间。平均滞留 &le; 3天为正常，3-7天为轻度滞留，&gt;7天为严重滞留需关注。
            当前共 {sm?.sku_count} 种 SKU 在库，涉及 {sm?.fruit_count} 种水果。
          </div>
        </>
      )}
    </div>
  );
}
