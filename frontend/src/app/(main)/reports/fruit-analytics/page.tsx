'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Select, Button, Table, Tag, Tooltip, Row, Col,
  Empty, Spin, message, Space, Progress, Modal,
} from 'antd';
import {
  PieChartOutlined, SearchOutlined, ReloadOutlined,
  DownloadOutlined, ExportOutlined,
  ThunderboltOutlined, TeamOutlined, ExperimentOutlined,
  FundOutlined, InboxOutlined, DollarOutlined, RobotOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dynamic from 'next/dynamic';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

interface FruitItem {
  fruit_id: number; fruit_name: string; sku_count: number;
  order_count: number; purchase_weight: number; purchase_cost: number; avg_price: number; supplier_count: number;
  total_labels: number; outbound_count: number; outbound_rate: number; outbound_weight: number;
  production_qty: number; worker_count: number; consumed_weight: number; utilization: number; waste_weight: number;
}
interface FruitData {
  fruits: FruitItem[];
  summary: { fruit_count: number; total_weight: number; total_cost: number; total_labels: number; total_outbound: number; total_production: number; avg_utilization: number; avg_outbound_rate: number; days: number };
  daily_trend: { date: string; weight: number; cost: number }[];
}

const FRUIT_ICONS: Record<string, string> = {
  '苹果': '🍎', '梨': '🍐', '橙': '🍊', '柠檬': '🍋', '桃': '🍑', '樱桃': '🍒', '葡萄': '🍇', '西瓜': '🍉', '芒果': '🥭', '猕猴桃': '🥝', '香蕉': '🍌', '菠萝': '🍍', '草莓': '🍓', '蓝莓': '🫐',
};
function getFruitIcon(n: string): string { for (const [k, v] of Object.entries(FRUIT_ICONS)) if (n.includes(k)) return v; return '🍎'; }

const COLORS = ['#1677ff', '#00b96b', '#722ed1', '#fa8c16', '#eb2f96', '#13c2c2', '#f5222d', '#52c41a', '#2f54eb', '#faad14'];

export default function FruitAnalyticsPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FruitData | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [days, setDays] = useState(30);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const openAi = async () => {
    if (!data?.fruits?.length) return;
    setAiContent(''); setAiOpen(true); setAiLoading(true);
    const ctx = [`水果品类分析(${days}天):`, `共${data.fruits.length}种, 总采购${data.summary.total_weight}kg, ¥${data.summary.total_cost}`];
    data.fruits.forEach(f => ctx.push(`  ${f.fruit_name}: ${f.purchase_weight}kg ¥${f.purchase_cost} 出库率${f.outbound_rate}% 利用率${f.utilization}%`));
    const prompt = `分析以下水果品类数据。\n\n${ctx.join('\n')}\n\n用markdown，含：1.品类概况 2.优势品类 3.问题品类 4.采购建议\n简洁不超250字。`;
    try {
      abortRef.current = new AbortController();
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ message: prompt, history: [], stream: true, context_mode: 'minimal' }),
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
      const res = await api.get('/reports/fruit-analytics', { params: { days } });
      setData(res.data?.data || null);
    } catch { message.error('查询失败'); }
    finally { setLoading(false); }
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);
  const handleRefresh = () => { setRefreshSpin(true); fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600)); };

  useEffect(() => {
    if (!data?.fruits?.length || !chartRef.current) return;
    const canvas = chartRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, rect.width, rect.height);

    const fruits = data.fruits;
    const total = fruits.reduce((s, f) => s + f.purchase_weight, 0);
    const cx = rect.width / 2; const cy = rect.height / 2; const r = Math.min(cx, cy) - 30;
    let startAngle = -Math.PI / 2;

    fruits.forEach((f, i) => {
      const pct = f.purchase_weight / total;
      const angle = pct * Math.PI * 2;
      const color = COLORS[i % COLORS.length];

      ctx.fillStyle = color; ctx.beginPath();
      ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, startAngle, startAngle + angle);
      ctx.closePath(); ctx.fill();

      ctx.fillStyle = color + '30'; ctx.beginPath();
      ctx.moveTo(cx, cy); ctx.arc(cx, cy, r + 8, startAngle, startAngle + angle);
      ctx.closePath(); ctx.fill();

      if (pct > 0.05) {
        const midAngle = startAngle + angle / 2;
        const tx = cx + (r * 0.65) * Math.cos(midAngle);
        const ty = cy + (r * 0.65) * Math.sin(midAngle);
        ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(pct * 100)}%`, tx, ty);
        const lx = cx + (r + 22) * Math.cos(midAngle);
        const ly = cy + (r + 22) * Math.sin(midAngle);
        ctx.fillStyle = '#666'; ctx.font = '11px sans-serif';
        ctx.fillText(f.fruit_name, lx, ly);
      }
      startAngle += angle;
    });

    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#333'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${fruits.length}种`, cx, cy - 4);
    ctx.fillStyle = '#888'; ctx.font = '11px sans-serif';
    ctx.fillText('水果品类', cx, cy + 14);
  }, [data]);

  const exportCSV = () => {
    if (!data?.fruits?.length) { message.warning('暂无数据'); return; }
    const headers = ['水果,SKU数,采购批次,采购重量,采购金额,均价,标签数,出库数,出库率,产量,工人数,消耗量,利用率,损耗'];
    const rows = data.fruits.map(f => `${f.fruit_name},${f.sku_count},${f.order_count},${f.purchase_weight},${f.purchase_cost},${f.avg_price},${f.total_labels},${f.outbound_count},${f.outbound_rate}%,${f.production_qty},${f.worker_count},${f.consumed_weight},${f.utilization}%,${f.waste_weight}`);
    const csv = '\uFEFF' + [...headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '水果品类分析.csv'; a.click();
    URL.revokeObjectURL(url); message.success('导出成功');
  };

  const sm = data?.summary;
  const stats = sm ? [
    { label: '水果品类', value: sm.fruit_count, icon: <PieChartOutlined />, bg: 'linear-gradient(135deg, #fa8c16, #ffc53d)', glow: 'rgba(250,140,22,0.15)', suffix: '种' },
    { label: '采购重量', value: `${sm.total_weight}`, icon: <InboxOutlined />, bg: 'linear-gradient(135deg, #722ed1, #b37feb)', glow: 'rgba(114,46,209,0.15)', suffix: 'kg' },
    { label: '采购金额', value: `¥${sm.total_cost >= 10000 ? `${(sm.total_cost / 10000).toFixed(1)}万` : sm.total_cost}`, icon: <DollarOutlined />, bg: 'linear-gradient(135deg, #eb2f96, #ff85c0)', glow: 'rgba(235,47,150,0.15)', suffix: '' },
    { label: '平均利用率', value: `${sm.avg_utilization}%`, icon: <FundOutlined />, bg: 'linear-gradient(135deg, #00b96b, #5cdbd3)', glow: 'rgba(0,185,107,0.15)', suffix: '' },
    { label: '总出库', value: sm.total_outbound.toLocaleString(), icon: <ExportOutlined />, bg: 'linear-gradient(135deg, #1677ff, #69b1ff)', glow: 'rgba(22,119,255,0.15)', suffix: '件' },
    { label: '总产量', value: sm.total_production.toLocaleString(), icon: <ThunderboltOutlined />, bg: 'linear-gradient(135deg, #13c2c2, #5cdbd3)', glow: 'rgba(19,194,194,0.15)', suffix: '件' },
  ] : [];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ background: 'linear-gradient(135deg, #fa541c 0%, #fa8c16 50%, #faad14 100%)', borderRadius: 16, padding: '28px 32px', marginBottom: 24, color: '#fff', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -40, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ width: 44, height: 44, borderRadius: 14, background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}><PieChartOutlined /></span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>水果品类分析</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>按水果品类维度的全链路数据分析</div>
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
          <span className="panel-title"><SearchOutlined style={{ color: '#fa8c16' }} /> 筛选</span>
          <Space>
            <Button icon={<RobotOutlined />} onClick={openAi} style={{ borderRadius: 8, background: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none', color: '#fff' }}>AI分析</Button>
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 8 }} />
            <Button icon={<DownloadOutlined />} onClick={exportCSV} style={{ borderRadius: 8 }}>导出</Button>
          </Space>
        </div>
        <div style={{ padding: '12px 20px' }}>
          <Select value={days} onChange={v => setDays(v)} style={{ width: 200, borderRadius: 8 }}
            options={[{ value: 7, label: '最近7天' }, { value: 14, label: '最近14天' }, { value: 30, label: '最近30天' }, { value: 60, label: '最近60天' }, { value: 90, label: '最近90天' }]} />
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : !data?.fruits?.length ? (
        <div className="panel" style={{ padding: 60, textAlign: 'center' }}><Empty description="暂无数据" /></div>
      ) : (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
            <Col xs={24} md={10}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head"><span className="panel-title"><PieChartOutlined style={{ color: '#fa8c16' }} /> 采购重量分布</span></div>
                <div style={{ padding: 16 }}>
                  <canvas ref={chartRef} style={{ width: '100%', height: 260 }} />
                  <ReactECharts
                    style={{ height: 260, marginTop: 8 }}
                    option={{
                      tooltip: { trigger: 'item', formatter: '{b}: {c}kg ({d}%)' },
                      series: [{
                        type: 'pie', radius: ['35%', '65%'], center: ['50%', '50%'],
                        data: data.fruits.map((f, i) => ({ name: f.fruit_name, value: f.purchase_weight, itemStyle: { color: COLORS[i % COLORS.length] } })),
                        label: { fontSize: 11, formatter: '{b}\n{d}%' },
                        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.15)' } },
                      }],
                    }}
                  />
                </div>
              </div>
            </Col>
            <Col xs={24} md={14}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head"><span className="panel-title"><FundOutlined style={{ color: '#1677ff' }} /> 品类效率对比</span></div>
                <div style={{ padding: '12px 20px' }}>
                  {data.fruits.map((f, i) => {
                    const color = COLORS[i % COLORS.length];
                    return (
                      <div key={f.fruit_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < data.fruits.length - 1 ? '1px solid var(--border-2)' : 'none' }}>
                        <span style={{ fontSize: 22, width: 30, textAlign: 'center' }}>{getFruitIcon(f.fruit_name)}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ fontWeight: 700, fontSize: 13 }}>{f.fruit_name}</span>
                            <Space size={4}>
                              <Tag style={{ borderRadius: 6, fontSize: 10, fontWeight: 600, background: `${color}12`, color, border: `1px solid ${color}30` }}>{f.purchase_weight}kg</Tag>
                              <Tag color={f.utilization >= 70 ? 'success' : f.utilization >= 40 ? 'warning' : 'error'} style={{ borderRadius: 6, fontWeight: 600, fontSize: 10 }}>利用{f.utilization}%</Tag>
                            </Space>
                          </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <Tooltip title={`出库率 ${f.outbound_rate}%`}>
                              <div style={{ flex: 1 }}>
                                <Progress percent={f.outbound_rate} size="small" strokeColor="#00b96b" showInfo={false} />
                              </div>
                            </Tooltip>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Col>
          </Row>

          <div className="panel">
            <div className="panel-head">
              <span className="panel-title"><ExperimentOutlined style={{ color: '#fa541c' }} /> 品类明细表</span>
              <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{data.fruits.length} 种水果</span>
            </div>
            <Table dataSource={data.fruits} rowKey="fruit_id" size="small" scroll={{ x: 1200 }}
              pagination={false} locale={{ emptyText: '暂无数据' }}
              columns={[
                { title: '水果', key: 'fruit', width: 130, fixed: 'left' as const, render: (_: unknown, r: FruitItem) => (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 20 }}>{getFruitIcon(r.fruit_name)}</span>
                    <div><div style={{ fontWeight: 700, fontSize: 14 }}>{r.fruit_name}</div><div style={{ fontSize: 10, color: 'var(--text-4)' }}>{r.sku_count} SKU · {r.supplier_count}供应商</div></div>
                  </div>
                )},
                { title: '采购重量', dataIndex: 'purchase_weight', width: 90, align: 'right' as const, sorter: (a: FruitItem, b: FruitItem) => a.purchase_weight - b.purchase_weight, defaultSortOrder: 'descend' as const, render: (v: number) => <span className="num" style={{ fontWeight: 700 }}>{v}kg</span> },
                { title: '采购金额', dataIndex: 'purchase_cost', width: 100, align: 'right' as const, render: (v: number) => <span className="num" style={{ color: '#722ed1' }}>¥{v >= 10000 ? `${(v/10000).toFixed(1)}万` : v}</span> },
                { title: '均价', dataIndex: 'avg_price', width: 70, align: 'right' as const, render: (v: number) => <span className="num">{v}</span> },
                { title: '标签', dataIndex: 'total_labels', width: 70, align: 'right' as const, render: (v: number) => <span className="num">{v}</span> },
                { title: '出库', dataIndex: 'outbound_count', width: 70, align: 'right' as const, render: (v: number) => <span className="num" style={{ color: '#00b96b', fontWeight: 600 }}>{v}</span> },
                { title: '出库率', dataIndex: 'outbound_rate', width: 100, align: 'center' as const, sorter: (a: FruitItem, b: FruitItem) => a.outbound_rate - b.outbound_rate, render: (v: number) => <Progress percent={v} size="small" strokeColor={v >= 80 ? '#00b96b' : v >= 50 ? '#faad14' : '#f5222d'} format={p => <span style={{ fontSize: 10, fontWeight: 600 }}>{p}%</span>} /> },
                { title: '利用率', dataIndex: 'utilization', width: 80, align: 'center' as const, sorter: (a: FruitItem, b: FruitItem) => a.utilization - b.utilization, render: (v: number) => <Tag color={v >= 70 ? 'success' : v >= 40 ? 'warning' : 'error'} style={{ borderRadius: 8, fontWeight: 700 }}>{v}%</Tag> },
                { title: '产量', dataIndex: 'production_qty', width: 70, align: 'right' as const, render: (v: number) => <span className="num" style={{ fontWeight: 600, color: '#1677ff' }}>{v}</span> },
                { title: '工人', dataIndex: 'worker_count', width: 55, align: 'center' as const, render: (v: number) => <span className="num"><TeamOutlined style={{ marginRight: 2 }} />{v}</span> },
                { title: '损耗', dataIndex: 'waste_weight', width: 80, align: 'right' as const, render: (v: number) => <span className="num" style={{ color: v > 0 ? '#fa8c16' : 'var(--text-4)' }}>{v}kg</span> },
              ]}
            />
          </div>
        </>
      )}

      <Modal
        title={<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #fa541c, #fa8c16)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
          </div>
          <span>AI 水果品类分析</span>
          {aiLoading && <Spin size="small" />}
        </div>}
        open={aiOpen}
        onCancel={() => { setAiOpen(false); if (abortRef.current) abortRef.current.abort(); }}
        footer={null} width={580}
      >
        <div style={{ padding: '12px 0', fontSize: 14, lineHeight: 1.8, minHeight: 100 }}>
          {aiContent ? (
            <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(250,84,28,0.04)', border: '1px solid rgba(250,84,28,0.1)' }}>
              {aiContent.split(/(\*\*.*?\*\*|\n)/g).map((p, i) => {
                if (p === '\n') return <br key={i} />;
                if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
                return <span key={i}>{p}</span>;
              })}
            </div>
          ) : aiLoading ? (
            <div style={{ textAlign: 'center', padding: 30 }}><Spin size="large" /><div style={{ marginTop: 10, color: 'var(--text-3)' }}>AI正在分析品类数据...</div></div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
