'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Select, Button, Table, Tag, Tooltip, Row, Col,
  Empty, Spin, message, Space, Progress, Avatar, Modal, Segmented,
} from 'antd';
import {
  ExperimentOutlined, SearchOutlined, ReloadOutlined,
  DownloadOutlined, TrophyOutlined, ThunderboltOutlined,
  RiseOutlined, WarningOutlined, TeamOutlined,
  BarChartOutlined, FundOutlined, RobotOutlined,
  PieChartOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dynamic from 'next/dynamic';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

interface TopWorker { worker_id: number; worker_name: string; qty: number }
interface SkuEff {
  sku_id: number; sku_name: string; sku_description: string; fruit_name: string;
  performance: number; total_weight: number;
  total_production: number; total_labels: number; outbound_count: number;
  outbound_rate: number; waste_rate: number; daily_avg: number;
  worker_count: number; per_worker_avg: number; avg_weight_diff: number;
  active_days: number; efficiency_score: number; top_workers: TopWorker[];
}
interface EffData {
  skus: SkuEff[];
  summary: { total_skus: number; total_production: number; total_outbound: number; total_labels: number; avg_outbound_rate: number; avg_efficiency: number; days: number };
  rankings: { top_production: SkuEff[]; top_efficiency: SkuEff[]; worst_outbound: SkuEff[] };
  fruit_options: string[];
}

const STAT_GRADIENTS = [
  { bg: 'linear-gradient(135deg, #1677ff, #69b1ff)', glow: 'rgba(22,119,255,0.15)' },
  { bg: 'linear-gradient(135deg, #00b96b, #5cdbd3)', glow: 'rgba(0,185,107,0.15)' },
  { bg: 'linear-gradient(135deg, #722ed1, #b37feb)', glow: 'rgba(114,46,209,0.15)' },
  { bg: 'linear-gradient(135deg, #fa8c16, #ffc53d)', glow: 'rgba(250,140,22,0.15)' },
  { bg: 'linear-gradient(135deg, #eb2f96, #ff85c0)', glow: 'rgba(235,47,150,0.15)' },
  { bg: 'linear-gradient(135deg, #13c2c2, #5cdbd3)', glow: 'rgba(19,194,194,0.15)' },
];

const FRUIT_ICONS: Record<string, string> = {
  '苹果': '🍎', '梨': '🍐', '橙': '🍊', '柠檬': '🍋', '桃': '🍑', '樱桃': '🍒', '葡萄': '🍇', '西瓜': '🍉', '芒果': '🥭', '猕猴桃': '🥝', '香蕉': '🍌', '菠萝': '🍍', '草莓': '🍓',
};
function getFruitIcon(n: string): string { for (const [k, v] of Object.entries(FRUIT_ICONS)) if (n.includes(k)) return v; return '🍎'; }

function SkuScatterChart({ skus }: { skus: SkuEff[] }) {
  if (!skus.length) return null;
  const option = {
    tooltip: {
      trigger: 'item',
      formatter: (p: any) => `<b>${p.data[3]}</b><br/>出库率: ${p.data[0]}%<br/>效率分: ${p.data[1]}<br/>产量: ${p.data[2]}`,
    },
    grid: { top: 30, right: 20, bottom: 40, left: 50 },
    xAxis: { name: '出库率 %', nameLocation: 'middle', nameGap: 25, type: 'value', min: 0, max: 100, splitLine: { lineStyle: { type: 'dashed', color: '#f0f0f0' } } },
    yAxis: { name: '效率分', nameLocation: 'middle', nameGap: 35, type: 'value', min: 0, splitLine: { lineStyle: { type: 'dashed', color: '#f0f0f0' } } },
    series: [{
      type: 'scatter',
      symbolSize: (d: number[]) => Math.max(Math.sqrt(d[2]) * 2, 8),
      data: skus.map(s => [s.outbound_rate, s.efficiency_score, s.total_production, s.sku_name]),
      itemStyle: {
        color: (p: any) => {
          const score = p.data[1];
          return score >= 70 ? '#52c41a' : score >= 40 ? '#faad14' : '#ff4d4f';
        },
        opacity: 0.75,
      },
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.2)' } },
    }],
  };
  return <ReactECharts option={option} style={{ height: 260 }} />;
}

export default function SkuEfficiencyPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<EffData | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [fruitFilter, setFruitFilter] = useState<string | undefined>(undefined);
  const [days, setDays] = useState(30);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const openAi = async () => {
    setAiContent(''); setAiOpen(true); setAiLoading(true);
    try {
      abortRef.current = new AbortController();
      const res = await fetch(`/api/reports/sku-efficiency-ai?days=${days}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        signal: abortRef.current.signal,
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
    } finally { setAiLoading(false); abortRef.current = null; }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { days };
      if (fruitFilter) params.fruit_name = fruitFilter;
      const res = await api.get('/reports/sku-efficiency', { params });
      setData(res.data?.data || null);
    } catch { message.error('查询失败'); }
    finally { setLoading(false); }
  }, [fruitFilter, days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const exportCSV = () => {
    if (!data?.skus?.length) { message.warning('暂无数据'); return; }
    const headers = ['SKU,水果,效率分,产量,标签数,出库数,出库率%,损耗率%,日均,工人数,人均,重量差异,活跃天数'];
    const rows = data.skus.map(s => `${s.sku_name},${s.fruit_name},${s.efficiency_score},${s.total_production},${s.total_labels},${s.outbound_count},${s.outbound_rate},${s.waste_rate},${s.daily_avg},${s.worker_count},${s.per_worker_avg},${s.avg_weight_diff},${s.active_days}`);
    const csv = '\uFEFF' + [...headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'SKU效率分析.csv'; a.click();
    URL.revokeObjectURL(url); message.success('导出成功');
  };

  const sm = data?.summary;
  const stats = sm ? [
    { label: 'SKU总数', value: sm.total_skus, icon: <ExperimentOutlined />, ...STAT_GRADIENTS[0], suffix: '种' },
    { label: '总产量', value: sm.total_production.toLocaleString(), icon: <BarChartOutlined />, ...STAT_GRADIENTS[1], suffix: '件' },
    { label: '总出库', value: sm.total_outbound.toLocaleString(), icon: <RiseOutlined />, ...STAT_GRADIENTS[2], suffix: '件' },
    { label: '出库率', value: `${sm.avg_outbound_rate}%`, icon: <ThunderboltOutlined />, ...STAT_GRADIENTS[3], suffix: '' },
    { label: '总标签', value: sm.total_labels.toLocaleString(), icon: <FundOutlined />, ...STAT_GRADIENTS[4], suffix: '个' },
    { label: '平均效率', value: `${sm.avg_efficiency}`, icon: <TrophyOutlined />, ...STAT_GRADIENTS[5], suffix: '分' },
  ] : [];

  const getScoreColor = (v: number) => v >= 70 ? '#00b96b' : v >= 40 ? '#faad14' : '#f5222d';
  const getScoreTag = (v: number) => v >= 70 ? 'success' : v >= 40 ? 'warning' : 'error';

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{
        background: 'linear-gradient(135deg, #13c2c2 0%, #1677ff 50%, #722ed1 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -40, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ width: 44, height: 44, borderRadius: 14, background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}><ExperimentOutlined /></span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>SKU 生产效率分析</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>产量 · 损耗率 · 出库效率 · 工人偏好</div>
            </div>
          </div>
        </div>
      </div>

      {data && (
        <Row gutter={[10, 10]} style={{ marginBottom: 20 }}>
          {stats.map((s, i) => (
            <Col xs={12} sm={8} md={4} key={i}>
              <div style={{ padding: '14px 16px', borderRadius: 14, background: s.bg, boxShadow: `0 4px 16px ${s.glow}`, animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.06}s` }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)', display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>{s.icon} {s.label}</div>
                <div className="num" style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{s.value}</div>
                {s.suffix && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)' }}>{s.suffix}</span>}
              </div>
            </Col>
          ))}
        </Row>
      )}

      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head">
          <span className="panel-title"><SearchOutlined style={{ color: '#1677ff' }} /> 筛选</span>
          <Space>
            <Button icon={<RobotOutlined />} onClick={openAi} style={{ borderRadius: 8, background: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none', color: '#fff' }}>AI分析</Button>
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 8 }} />
            <Button icon={<DownloadOutlined />} onClick={exportCSV} style={{ borderRadius: 8 }}>导出</Button>
          </Space>
        </div>
        <div style={{ padding: '12px 20px' }}>
          <Row gutter={[12, 12]}>
            <Col xs={24} sm={12}>
              <Select value={fruitFilter} onChange={v => setFruitFilter(v)} allowClear placeholder="筛选水果" style={{ width: '100%', borderRadius: 8 }}
                options={(data?.fruit_options || []).map(n => ({ value: n, label: `${getFruitIcon(n)} ${n}` }))} />
            </Col>
            <Col xs={24} sm={12}>
              <Select value={days} onChange={v => setDays(v)} style={{ width: '100%', borderRadius: 8 }}
                options={[{ value: 7, label: '最近7天' }, { value: 14, label: '最近14天' }, { value: 30, label: '最近30天' }, { value: 60, label: '最近60天' }, { value: 90, label: '最近90天' }]} />
            </Col>
          </Row>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : !data?.skus?.length ? (
        <div className="panel" style={{ padding: 60, textAlign: 'center' }}><Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} /></div>
      ) : (
        <>
          {/* Scatter Chart */}
          <div className="panel" style={{ marginBottom: 20 }}>
            <div className="panel-head">
              <span className="panel-title"><PieChartOutlined style={{ color: '#13c2c2' }} /> SKU效率分布（气泡大小=产量）</span>
            </div>
            <div style={{ padding: '8px 16px' }}>
              <SkuScatterChart skus={data.skus} />
            </div>
          </div>

          <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
            {[
              { title: '产量TOP5', icon: <BarChartOutlined style={{ color: '#1677ff' }} />, list: data.rankings.top_production, valueKey: 'total_production' as const, color: '#1677ff', suffix: '件' },
              { title: '效率TOP5', icon: <TrophyOutlined style={{ color: '#00b96b' }} />, list: data.rankings.top_efficiency, valueKey: 'efficiency_score' as const, color: '#00b96b', suffix: '分' },
              { title: '出库最慢', icon: <WarningOutlined style={{ color: '#f5222d' }} />, list: data.rankings.worst_outbound, valueKey: 'outbound_rate' as const, color: '#f5222d', suffix: '%' },
            ].map((panel, pi) => (
              <Col xs={24} md={8} key={pi}>
                <div className="panel" style={{ height: '100%' }}>
                  <div className="panel-head"><span className="panel-title">{panel.icon} {panel.title}</span></div>
                  <div style={{ padding: '8px 16px' }}>
                    {panel.list.map((s, i) => (
                      <div key={s.sku_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: i < panel.list.length - 1 ? '1px solid var(--border-2)' : 'none' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 20, height: 20, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: i < 3 ? '#fff' : 'var(--text-3)', background: i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : 'var(--gray-3)' }}>{i + 1}</span>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 12 }}>{s.sku_name}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-4)' }}>{getFruitIcon(s.fruit_name)} {s.fruit_name}</div>
                          </div>
                        </div>
                        <span className="num" style={{ fontWeight: 700, color: panel.color, fontSize: 13 }}>{(s as any)[panel.valueKey]}{panel.suffix}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </Col>
            ))}
          </Row>

          <div className="panel">
            <div className="panel-head">
              <span className="panel-title"><ExperimentOutlined style={{ color: '#13c2c2' }} /> SKU效率明细</span>
              <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{data.skus.length} 种</span>
            </div>
            <Table dataSource={data.skus} rowKey="sku_id" size="small" scroll={{ x: 1100 }}
              pagination={{ pageSize: 15, showTotal: t => `共 ${t} 条`, size: 'small' }}
              locale={{ emptyText: '暂无数据' }}
              columns={[
                { title: 'SKU', key: 'sku', width: 180, fixed: 'left' as const, render: (_: unknown, r: SkuEff) => (
                  <div><span style={{ fontWeight: 600, fontSize: 13, color: '#1677ff' }}>{r.sku_name}</span><div style={{ fontSize: 11, color: 'var(--text-4)' }}>{getFruitIcon(r.fruit_name)} {r.fruit_name}{r.sku_description ? ` · ${r.sku_description}` : ''}</div></div>
                )},
                { title: '效率分', dataIndex: 'efficiency_score', width: 80, align: 'center' as const, defaultSortOrder: 'descend' as const, sorter: (a: SkuEff, b: SkuEff) => a.efficiency_score - b.efficiency_score, render: (v: number) => <Tag color={getScoreTag(v)} style={{ borderRadius: 8, fontWeight: 700, fontSize: 13 }}>{v}</Tag> },
                { title: '产量', dataIndex: 'total_production', width: 80, align: 'right' as const, sorter: (a: SkuEff, b: SkuEff) => a.total_production - b.total_production, render: (v: number) => <span className="num" style={{ fontWeight: 600 }}>{v}</span> },
                { title: '出库率', dataIndex: 'outbound_rate', width: 100, align: 'center' as const, sorter: (a: SkuEff, b: SkuEff) => a.outbound_rate - b.outbound_rate, render: (v: number) => <Progress percent={v} size="small" strokeColor={v >= 80 ? '#00b96b' : v >= 50 ? '#faad14' : '#f5222d'} format={p => <span style={{ fontSize: 10, fontWeight: 600 }}>{p}%</span>} /> },
                { title: '损耗率', dataIndex: 'waste_rate', width: 80, align: 'right' as const, sorter: (a: SkuEff, b: SkuEff) => a.waste_rate - b.waste_rate, render: (v: number) => <span style={{ fontWeight: 600, color: v > 10 ? '#f5222d' : v > 5 ? '#faad14' : '#00b96b' }}>{v}%</span> },
                { title: '日均', dataIndex: 'daily_avg', width: 60, align: 'right' as const, render: (v: number) => <span className="num">{v}</span> },
                { title: '工人', dataIndex: 'worker_count', width: 55, align: 'center' as const, render: (v: number) => <span className="num"><TeamOutlined style={{ marginRight: 2 }} />{v}</span> },
                { title: '人均', dataIndex: 'per_worker_avg', width: 60, align: 'right' as const, render: (v: number) => <span className="num" style={{ color: '#722ed1', fontWeight: 600 }}>{v}</span> },
                { title: '重量差', dataIndex: 'avg_weight_diff', width: 70, align: 'right' as const, render: (v: number) => <span className="num" style={{ color: v > 0.3 ? '#f5222d' : 'var(--text-2)' }}>{v}kg</span> },
                { title: '产量王', key: 'top', width: 130, render: (_: unknown, r: SkuEff) => r.top_workers.length ? (
                  <Tooltip title={r.top_workers.map(w => `${w.worker_name}: ${w.qty}件`).join('、')}>
                    <div style={{ display: 'flex', gap: 2 }}>
                      {r.top_workers.slice(0, 3).map((w, i) => (
                        <Avatar key={w.worker_id} size={22} style={{ background: ['#ffd700', '#c0c0c0', '#cd7f32'][i], fontWeight: 700, fontSize: 10 }}>{w.worker_name.charAt(0)}</Avatar>
                      ))}
                    </div>
                  </Tooltip>
                ) : <span style={{ color: 'var(--text-4)', fontSize: 11 }}>-</span> },
              ]}
            />
          </div>

          <div style={{ marginTop: 16, padding: '10px 16px', borderRadius: 10, background: 'linear-gradient(135deg, rgba(19,194,194,0.04), rgba(22,119,255,0.03))', border: '1px solid rgba(19,194,194,0.08)', fontSize: 12, color: 'var(--text-4)', lineHeight: 1.8 }}>
            <ExperimentOutlined style={{ color: '#13c2c2', marginRight: 6 }} />
            效率分说明：满分100 = 出库率(30分) + 低损耗(20分) + 产量规模(20分) + 质量/重量精度(30分)。分析范围：最近{data.summary.days}天。
          </div>
        </>
      )}

      <Modal
        title={<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #13c2c2, #1677ff)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
          </div>
          <span>AI SKU效率分析</span>
          {aiLoading && <Spin size="small" />}
        </div>}
        open={aiOpen}
        onCancel={() => { setAiOpen(false); if (abortRef.current) abortRef.current.abort(); }}
        footer={null} width={580}
      >
        <div style={{ padding: '12px 0', fontSize: 14, lineHeight: 1.8, minHeight: 100 }}>
          {aiContent ? (
            <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(19,194,194,0.04)', border: '1px solid rgba(19,194,194,0.1)' }}>
              {aiContent.split(/(\*\*.*?\*\*|\n)/g).map((p, i) => {
                if (p === '\n') return <br key={i} />;
                if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
                return <span key={i}>{p}</span>;
              })}
            </div>
          ) : aiLoading ? (
            <div style={{ textAlign: 'center', padding: 30 }}><Spin size="large" /><div style={{ marginTop: 10, color: 'var(--text-3)' }}>AI正在分析SKU效率...</div></div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
