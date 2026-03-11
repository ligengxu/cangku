'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Select, Button, Tag, Row, Col,
  Empty, Spin, message, Space, Progress, Modal,
} from 'antd';
import {
  ShoppingOutlined, SearchOutlined, ReloadOutlined,
  DownloadOutlined, DollarOutlined, TeamOutlined,
  BarChartOutlined, PieChartOutlined,
  CheckCircleOutlined, ClockCircleOutlined, RobotOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dynamic from 'next/dynamic';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

interface TypeBreakdown { type: string; count: number; amount: number; material_names: string[] }
interface SupplierRank { name: string; supplier_id: number; count: number; amount: number }
interface MonthlyTrend { month: string; amount: number; count: number }
interface MatData {
  summary: { total_orders: number; total_amount: number; paid_count: number; unpaid_count: number; unpaid_amount: number; paid_rate: number; type_count: number; supplier_count: number; days: number };
  type_breakdown: TypeBreakdown[];
  supplier_ranking: SupplierRank[];
  monthly_trend: MonthlyTrend[];
  type_options: string[];
}

const COLORS = ['#1677ff', '#00b96b', '#722ed1', '#fa8c16', '#eb2f96', '#13c2c2', '#f5222d', '#52c41a'];

export default function MaterialAnalysisPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<MatData | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [days, setDays] = useState(90);
  const [typeFilter, setTypeFilter] = useState<string | undefined>(undefined);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const openAi = async () => {
    if (!data) return;
    setAiContent(''); setAiOpen(true); setAiLoading(true);
    const ctx = [`材料采购分析(${days}天):`, `总订单${data.summary.total_orders}笔, 总金额¥${data.summary.total_amount}, 付款率${data.summary.paid_rate}%`];
    data.type_breakdown.forEach(t => ctx.push(`  ${t.type}: ${t.count}笔 ¥${t.amount}`));
    data.supplier_ranking.slice(0, 5).forEach(s => ctx.push(`  供应商${s.name}: ${s.count}笔 ¥${s.amount}`));
    const prompt = `分析以下材料采购数据，给出优化建议。\n\n${ctx.join('\n')}\n\n用markdown，含：1.采购概况 2.成本优化建议 3.供应商建议\n简洁不超200字。`;
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
          try { const p = JSON.parse(d); if (p.content) acc += p.content; else if (p.reasoning) {} } catch {}
        }
        setAiContent(acc);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') setAiContent('AI分析暂不可用');
    } finally { setAiLoading(false); abortRef.current = null; }
  };
  const chartRef = useRef<HTMLCanvasElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { days };
      if (typeFilter) params.material_type = typeFilter;
      const res = await api.get('/reports/material-analysis', { params });
      setData(res.data?.data || null);
    } catch { message.error('查询失败'); }
    finally { setLoading(false); }
  }, [days, typeFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);
  const handleRefresh = () => { setRefreshSpin(true); fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600)); };

  useEffect(() => {
    if (!data?.monthly_trend?.length || !chartRef.current) return;
    const canvas = chartRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, rect.width, rect.height);

    const trend = data.monthly_trend;
    const maxVal = Math.max(...trend.map(d => d.amount), 1);
    const barW = Math.min(50, (rect.width - 60) / trend.length - 10);
    const chartH = rect.height - 50;
    const startX = 55;

    ctx.fillStyle = '#888'; ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const y = 10 + chartH - (chartH * i / 4);
      const val = maxVal * i / 4;
      ctx.fillText(val >= 10000 ? `${(val/10000).toFixed(0)}万` : `${Math.round(val)}`, startX - 8, y + 4);
      ctx.strokeStyle = '#f0f0f0'; ctx.beginPath(); ctx.moveTo(startX, y); ctx.lineTo(rect.width - 10, y); ctx.stroke();
    }

    trend.forEach((d, i) => {
      const x = startX + 8 + i * (barW + 10);
      const h = (d.amount / maxVal) * chartH;
      const y = 10 + chartH - h;
      const color = '#722ed1';
      const grad = ctx.createLinearGradient(x, y, x, 10 + chartH);
      grad.addColorStop(0, color); grad.addColorStop(1, color + '30');
      ctx.fillStyle = grad;
      ctx.beginPath();
      const r = Math.min(5, barW / 3);
      ctx.moveTo(x + r, y); ctx.lineTo(x + barW - r, y);
      ctx.arcTo(x + barW, y, x + barW, y + r, r);
      ctx.lineTo(x + barW, 10 + chartH); ctx.lineTo(x, 10 + chartH);
      ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
      ctx.fill();

      ctx.fillStyle = '#666'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(d.month, x + barW / 2, 10 + chartH + 16);
      if (d.amount > 0) {
        ctx.fillStyle = '#333'; ctx.font = 'bold 11px sans-serif';
        ctx.fillText(`¥${d.amount >= 10000 ? `${(d.amount/10000).toFixed(1)}万` : d.amount}`, x + barW / 2, y - 6);
      }
    });
  }, [data]);

  const exportCSV = () => {
    if (!data?.type_breakdown?.length) { message.warning('暂无数据'); return; }
    const headers = ['类型,订单数,总金额,具体材料'];
    const rows = data.type_breakdown.map(t => `${t.type},${t.count},${t.amount},${t.material_names.join('/')}`);
    const csv = '\uFEFF' + [...headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '材料采购分析.csv'; a.click();
    URL.revokeObjectURL(url); message.success('导出成功');
  };

  const sm = data?.summary;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ background: 'linear-gradient(135deg, #722ed1 0%, #2f54eb 50%, #1677ff 100%)', borderRadius: 16, padding: '28px 32px', marginBottom: 24, color: '#fff', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -40, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ width: 44, height: 44, borderRadius: 14, background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}><ShoppingOutlined /></span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>材料采购分析</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>材料采购趋势 · 类型分布 · 供应商排名</div>
            </div>
          </div>
        </div>
      </div>

      {sm && (
        <Row gutter={[10, 10]} style={{ marginBottom: 20 }}>
          {[
            { label: '总订单', value: sm.total_orders, icon: <ShoppingOutlined />, bg: 'linear-gradient(135deg, #722ed1, #b37feb)', glow: 'rgba(114,46,209,0.15)', suffix: '笔' },
            { label: '总金额', value: `¥${sm.total_amount >= 10000 ? `${(sm.total_amount / 10000).toFixed(1)}万` : sm.total_amount}`, icon: <DollarOutlined />, bg: 'linear-gradient(135deg, #fa8c16, #ffc53d)', glow: 'rgba(250,140,22,0.15)', suffix: '' },
            { label: '付款率', value: `${sm.paid_rate}%`, icon: <CheckCircleOutlined />, bg: 'linear-gradient(135deg, #00b96b, #5cdbd3)', glow: 'rgba(0,185,107,0.15)', suffix: '' },
            { label: '未付金额', value: `¥${sm.unpaid_amount}`, icon: <ClockCircleOutlined />, bg: 'linear-gradient(135deg, #f5222d, #ff7875)', glow: 'rgba(245,34,45,0.15)', suffix: '' },
            { label: '材料类型', value: sm.type_count, icon: <PieChartOutlined />, bg: 'linear-gradient(135deg, #1677ff, #69b1ff)', glow: 'rgba(22,119,255,0.15)', suffix: '种' },
            { label: '供应商', value: sm.supplier_count, icon: <TeamOutlined />, bg: 'linear-gradient(135deg, #13c2c2, #5cdbd3)', glow: 'rgba(19,194,194,0.15)', suffix: '家' },
          ].map((s, i) => (
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
          <span className="panel-title"><SearchOutlined style={{ color: '#722ed1' }} /> 筛选</span>
          <Space>
            <Button icon={<RobotOutlined />} onClick={openAi} style={{ borderRadius: 8, background: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none', color: '#fff' }}>AI分析</Button>
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 8 }} />
            <Button icon={<DownloadOutlined />} onClick={exportCSV} style={{ borderRadius: 8 }}>导出</Button>
          </Space>
        </div>
        <div style={{ padding: '12px 20px' }}>
          <Row gutter={[12, 12]}>
            <Col xs={24} sm={12}>
              <Select value={typeFilter} onChange={v => setTypeFilter(v)} allowClear placeholder="筛选材料类型"
                style={{ width: '100%', borderRadius: 8 }} options={(data?.type_options || []).map(t => ({ value: t, label: t }))} />
            </Col>
            <Col xs={24} sm={12}>
              <Select value={days} onChange={v => setDays(v)} style={{ width: '100%', borderRadius: 8 }}
                options={[{ value: 30, label: '最近30天' }, { value: 60, label: '最近60天' }, { value: 90, label: '最近90天' }, { value: 180, label: '最近半年' }, { value: 365, label: '最近一年' }]} />
            </Col>
          </Row>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : !data ? (
        <div className="panel" style={{ padding: 60, textAlign: 'center' }}><Empty description="暂无数据" /></div>
      ) : (
        <>
          {data.monthly_trend.length > 0 && (
            <div className="panel" style={{ marginBottom: 20 }}>
              <div className="panel-head"><span className="panel-title"><BarChartOutlined style={{ color: '#722ed1' }} /> 月度采购趋势</span></div>
              <div style={{ padding: '16px 20px' }}><canvas ref={chartRef} style={{ width: '100%', height: 220 }} /></div>
            </div>
          )}

          <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
            <Col xs={24} md={12}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head"><span className="panel-title"><PieChartOutlined style={{ color: '#fa8c16' }} /> 材料类型分布</span></div>
                <div style={{ padding: '8px 16px' }}>
                  {data.type_breakdown.map((t, i) => {
                    const color = COLORS[i % COLORS.length];
                    const pct = sm && sm.total_amount > 0 ? Math.round(t.amount / sm.total_amount * 100) : 0;
                    return (
                      <div key={t.type} style={{ padding: '10px 0', borderBottom: i < data.type_breakdown.length - 1 ? '1px solid var(--border-2)' : 'none' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span style={{ fontWeight: 700, fontSize: 13, color }}>{t.type}</span>
                          <Space size={4}>
                            <Tag style={{ borderRadius: 6, fontSize: 10 }}>{t.count}笔</Tag>
                            <span className="num" style={{ fontWeight: 700, color }}>¥{t.amount}</span>
                          </Space>
                        </div>
                        <Progress percent={pct} size="small" strokeColor={color} showInfo={false} />
                        {t.material_names.length > 0 && (
                          <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 4 }}>{t.material_names.join('、')}</div>
                        )}
                      </div>
                    );
                  })}
                  {!data.type_breakdown.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />}
                </div>
              </div>
            </Col>
            <Col xs={24} md={12}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head"><span className="panel-title"><TeamOutlined style={{ color: '#1677ff' }} /> 供应商排名</span></div>
                <div style={{ padding: '8px 16px' }}>
                  {data.supplier_ranking.slice(0, 10).map((s, i) => (
                    <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i < Math.min(data.supplier_ranking.length, 10) - 1 ? '1px solid var(--border-2)' : 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 22, height: 22, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: i < 3 ? '#fff' : 'var(--text-3)', background: i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : 'var(--gray-3)' }}>{i + 1}</span>
                        <div><div style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</div><div style={{ fontSize: 10, color: 'var(--text-4)' }}>{s.count} 笔订单</div></div>
                      </div>
                      <span className="num" style={{ fontWeight: 700, color: '#722ed1', fontSize: 14 }}>¥{s.amount}</span>
                    </div>
                  ))}
                  {!data.supplier_ranking.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />}
                </div>
              </div>
            </Col>
          </Row>
          {/* Monthly Trend Chart */}
          {data.monthly_trend.length > 0 && (
            <div className="panel" style={{ marginTop: 16 }}>
              <div className="panel-head">
                <span className="panel-title"><BarChartOutlined style={{ color: '#1677ff' }} /> 月度采购趋势</span>
              </div>
              <div style={{ padding: '8px 16px' }}>
                <ReactECharts
                  style={{ height: 250 }}
                  option={{
                    tooltip: { trigger: 'axis', formatter: (p: any) => `${p[0].name}<br/>金额: ¥${p[0].value}<br/>订单: ${p[1]?.value || 0}笔` },
                    grid: { top: 20, right: 50, bottom: 30, left: 60 },
                    xAxis: { type: 'category', data: data.monthly_trend.map(t => t.month), axisLabel: { fontSize: 11 } },
                    yAxis: [
                      { type: 'value', name: '金额(¥)', splitLine: { lineStyle: { type: 'dashed', color: '#f0f0f0' } } },
                      { type: 'value', name: '订单数', splitLine: { show: false } },
                    ],
                    series: [
                      { type: 'bar', data: data.monthly_trend.map(t => t.amount), yAxisIndex: 0, itemStyle: { color: 'rgba(22,119,255,0.6)', borderRadius: [4, 4, 0, 0] }, barWidth: '40%' },
                      { type: 'line', data: data.monthly_trend.map(t => t.count), yAxisIndex: 1, smooth: true, lineStyle: { color: '#fa8c16', width: 2 }, itemStyle: { color: '#fa8c16' } },
                    ],
                  }}
                />
              </div>
            </div>
          )}
        </>
      )}

      <Modal
        title={<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #667eea, #764ba2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
          </div>
          <span>AI 材料采购分析</span>
          {aiLoading && <Spin size="small" />}
        </div>}
        open={aiOpen}
        onCancel={() => { setAiOpen(false); if (abortRef.current) abortRef.current.abort(); }}
        footer={null} width={560}
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
            <div style={{ textAlign: 'center', padding: 30 }}><Spin size="large" /><div style={{ marginTop: 10, color: 'var(--text-3)' }}>AI正在分析材料数据...</div></div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
