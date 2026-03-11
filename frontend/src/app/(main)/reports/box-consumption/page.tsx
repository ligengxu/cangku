'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Select, Button, Tag, Row, Col,
  Empty, Spin, message, Space, Progress, Tooltip, Modal,
} from 'antd';
import {
  DropboxOutlined, SearchOutlined, ReloadOutlined,
  DownloadOutlined, WarningOutlined, InboxOutlined,
  ThunderboltOutlined, DollarOutlined, ClockCircleOutlined,
  CheckCircleOutlined, AlertOutlined, StopOutlined, RobotOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dynamic from 'next/dynamic';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

interface SkuRef { sku_id: number; sku_name: string; fruit_name: string }
interface BoxItem {
  box_id: number; box_type: string; stock: number; threshold: number; price: number;
  stock_value: number; health: string; sku_count: number; skus: SkuRef[];
  consumed: number; outbound_consumed: number; daily_rate: number; days_remaining: number;
  purchased: number; purchase_cost: number; net_change: number;
}
interface BoxData {
  boxes: BoxItem[];
  summary: { total_types: number; total_stock: number; total_consumed: number; total_purchase_cost: number; total_daily_rate: number; days: number };
}

const HC: Record<string, { color: string; label: string; icon: React.ReactNode; tagColor: string }> = {
  critical: { color: '#f5222d', label: '已耗尽', icon: <StopOutlined />, tagColor: 'error' },
  danger: { color: '#fa8c16', label: '库存紧急', icon: <AlertOutlined />, tagColor: 'warning' },
  warning: { color: '#faad14', label: '库存偏低', icon: <WarningOutlined />, tagColor: 'gold' },
  healthy: { color: '#00b96b', label: '正常', icon: <CheckCircleOutlined />, tagColor: 'success' },
};

export default function BoxConsumptionPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<BoxData | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [days, setDays] = useState(30);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const openAi = async () => {
    setAiContent(''); setAiOpen(true); setAiLoading(true);
    try {
      abortRef.current = new AbortController();
      const res = await fetch('/api/inventory/forecast-ai', {
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
      const res = await api.get('/reports/box-consumption-analysis', { params: { days } });
      setData(res.data?.data || null);
    } catch { message.error('查询失败'); }
    finally { setLoading(false); }
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);
  const handleRefresh = () => { setRefreshSpin(true); fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600)); };

  const exportCSV = () => {
    if (!data?.boxes?.length) { message.warning('暂无数据'); return; }
    const h = ['纸箱类型,库存,阈值,已消耗,日消耗,剩余天数,采购量,采购金额,净变动,SKU数'];
    const r = data.boxes.map(b => `${b.box_type},${b.stock},${b.threshold},${b.consumed},${b.daily_rate},${b.days_remaining >= 999 ? '∞' : b.days_remaining},${b.purchased},${b.purchase_cost},${b.net_change},${b.sku_count}`);
    const csv = '\uFEFF' + [...h, ...r].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '纸箱消耗分析.csv'; a.click();
    URL.revokeObjectURL(url); message.success('导出成功');
  };

  const sm = data?.summary;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ background: 'linear-gradient(135deg, #13c2c2 0%, #1677ff 50%, #2f54eb 100%)', borderRadius: 16, padding: '28px 32px', marginBottom: 24, color: '#fff', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: -40, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ width: 44, height: 44, borderRadius: 14, background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}><DropboxOutlined /></span>
            <div><div style={{ fontSize: 22, fontWeight: 700 }}>纸箱消耗分析</div><div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>纸箱消耗追踪 · SKU关联 · 补货建议</div></div>
          </div>
        </div>
      </div>

      {sm && (
        <Row gutter={[10, 10]} style={{ marginBottom: 20 }}>
          {[
            { label: '纸箱品类', value: sm.total_types, icon: <DropboxOutlined />, bg: 'linear-gradient(135deg, #13c2c2, #5cdbd3)', glow: 'rgba(19,194,194,0.15)', suffix: '种' },
            { label: '总库存', value: sm.total_stock.toLocaleString(), icon: <InboxOutlined />, bg: 'linear-gradient(135deg, #1677ff, #69b1ff)', glow: 'rgba(22,119,255,0.15)', suffix: '个' },
            { label: '已消耗', value: sm.total_consumed.toLocaleString(), icon: <ThunderboltOutlined />, bg: 'linear-gradient(135deg, #fa8c16, #ffc53d)', glow: 'rgba(250,140,22,0.15)', suffix: '个' },
            { label: '日消耗率', value: `${sm.total_daily_rate}`, icon: <ClockCircleOutlined />, bg: 'linear-gradient(135deg, #722ed1, #b37feb)', glow: 'rgba(114,46,209,0.15)', suffix: '个/天' },
            { label: '采购成本', value: `¥${sm.total_purchase_cost >= 10000 ? `${(sm.total_purchase_cost / 10000).toFixed(1)}万` : sm.total_purchase_cost}`, icon: <DollarOutlined />, bg: 'linear-gradient(135deg, #eb2f96, #ff85c0)', glow: 'rgba(235,47,150,0.15)', suffix: '' },
          ].map((s, i) => (
            <Col xs={12} sm={8} md={i < 3 ? 8 : 12} key={i}>
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
          <span className="panel-title"><SearchOutlined style={{ color: '#13c2c2' }} /> 筛选</span>
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
      ) : !data?.boxes?.length ? (
        <div className="panel" style={{ padding: 60, textAlign: 'center' }}><Empty description="暂无纸箱数据" /></div>
      ) : (
        <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {data.boxes.map((box, bi) => {
            const hc = HC[box.health] || HC.healthy;
            const stockPct = box.threshold > 0 ? Math.min(Math.round(box.stock / box.threshold * 100), 200) : 100;
            return (
              <div key={box.box_id} className="panel" style={{
                border: `1px solid ${hc.color}15`, overflow: 'hidden',
                animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${bi * 0.06}s`,
              }}>
                <div style={{ padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, borderBottom: '1px solid var(--border-2)', background: `${hc.color}04` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ width: 40, height: 40, borderRadius: 12, background: `${hc.color}12`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: hc.color }}><DropboxOutlined /></span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>{box.box_type}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{box.sku_count} 种SKU使用</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Tag color={hc.tagColor} icon={hc.icon} style={{ borderRadius: 8, fontWeight: 600 }}>{hc.label}</Tag>
                    <Tag style={{ borderRadius: 8, fontWeight: 600, background: 'rgba(22,119,255,0.08)', color: '#1677ff', border: '1px solid rgba(22,119,255,0.2)' }}>库存 {box.stock}/{box.threshold}</Tag>
                    <Tag style={{ borderRadius: 8, fontWeight: 600, color: box.days_remaining < 7 ? '#f5222d' : '#00b96b', background: box.days_remaining < 7 ? 'rgba(245,34,45,0.08)' : 'rgba(0,185,107,0.08)', border: `1px solid ${box.days_remaining < 7 ? 'rgba(245,34,45,0.2)' : 'rgba(0,185,107,0.2)'}` }}>
                      {box.days_remaining >= 999 ? '充足' : `${box.days_remaining}天`}
                    </Tag>
                  </div>
                </div>
                <div style={{ padding: '14px 20px' }}>
                  <Row gutter={[16, 12]}>
                    <Col xs={24} sm={8}>
                      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>库存状态</div>
                      <Progress percent={Math.min(stockPct, 100)} strokeColor={hc.color} format={() => <span style={{ fontWeight: 700, fontSize: 12 }}>{box.stock}</span>} />
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-4)', marginTop: 4 }}>
                        <span>日消耗: <b style={{ color: '#fa8c16' }}>{box.daily_rate}</b>/天</span>
                        <span>价值: ¥{box.stock_value}</span>
                      </div>
                    </Col>
                    <Col xs={24} sm={8}>
                      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>消耗 vs 采购</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                        <span>消耗: <b style={{ color: '#f5222d' }}>{box.consumed}</b></span>
                        <span>采购: <b style={{ color: '#00b96b' }}>{box.purchased}</b></span>
                      </div>
                      <div style={{ fontSize: 12, color: box.net_change >= 0 ? '#00b96b' : '#f5222d', fontWeight: 600 }}>
                        净变动: {box.net_change >= 0 ? '+' : ''}{box.net_change}
                      </div>
                    </Col>
                    <Col xs={24} sm={8}>
                      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>采购成本</div>
                      <div className="num" style={{ fontSize: 18, fontWeight: 700, color: '#722ed1' }}>¥{box.purchase_cost}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 2 }}>单价 ¥{box.price}/个</div>
                    </Col>
                  </Row>
                  {box.skus.length > 0 && (
                    <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {box.skus.map(s => (
                        <Tag key={s.sku_id} style={{ borderRadius: 6, fontSize: 11 }}>{s.fruit_name} · {s.sku_name}</Tag>
                      ))}
                      {box.sku_count > 5 && <Tag style={{ borderRadius: 6, fontSize: 11, color: 'var(--text-4)' }}>+{box.sku_count - 5}更多</Tag>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {/* Consumption Chart */}
        {data.boxes.length > 0 && (
            <div className="panel" style={{ marginTop: 16 }}>
              <div className="panel-head">
                <span className="panel-title"><BarChartOutlined style={{ color: '#722ed1' }} /> 纸箱消耗对比</span>
              </div>
              <div style={{ padding: '8px 16px' }}>
                <ReactECharts
                  style={{ height: 260 }}
                  option={{
                    tooltip: { trigger: 'axis' },
                    grid: { top: 20, right: 20, bottom: 60, left: 60 },
                    xAxis: { type: 'category', data: data.boxes.map(b => b.box_type), axisLabel: { fontSize: 10, rotate: 30 } },
                    yAxis: [
                      { type: 'value', name: '数量', splitLine: { lineStyle: { type: 'dashed', color: '#f0f0f0' } } },
                    ],
                    series: [
                      { name: '库存', type: 'bar', data: data.boxes.map(b => b.stock), itemStyle: { color: 'rgba(22,119,255,0.7)', borderRadius: [4, 4, 0, 0] }, barWidth: '25%' },
                      { name: '消耗', type: 'bar', data: data.boxes.map(b => b.consumed), itemStyle: { color: 'rgba(250,140,22,0.7)', borderRadius: [4, 4, 0, 0] }, barWidth: '25%' },
                      { name: '采购', type: 'bar', data: data.boxes.map(b => b.purchased), itemStyle: { color: 'rgba(82,196,26,0.7)', borderRadius: [4, 4, 0, 0] }, barWidth: '25%' },
                    ],
                    legend: { data: ['库存', '消耗', '采购'], bottom: 0, textStyle: { fontSize: 11 } },
                  }}
                />
              </div>
            </div>
          )}
        </>
      )}

      <Modal
        title={<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #1a1a2e, #0f3460)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RobotOutlined style={{ color: '#4facfe', fontSize: 14 }} />
          </div>
          <span>AI 纸箱消耗分析</span>
          {aiLoading && <Spin size="small" />}
        </div>}
        open={aiOpen}
        onCancel={() => { setAiOpen(false); if (abortRef.current) abortRef.current.abort(); }}
        footer={null} width={560}
      >
        <div style={{ padding: '12px 0', fontSize: 14, lineHeight: 1.8, minHeight: 100 }}>
          {aiContent ? (
            <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(79,172,254,0.04)', border: '1px solid rgba(79,172,254,0.1)' }}>
              {aiContent.split(/(\*\*.*?\*\*|\n)/g).map((p, i) => {
                if (p === '\n') return <br key={i} />;
                if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
                return <span key={i}>{p}</span>;
              })}
            </div>
          ) : aiLoading ? (
            <div style={{ textAlign: 'center', padding: 30 }}><Spin size="large" /><div style={{ marginTop: 10, color: 'var(--text-3)' }}>AI正在分析纸箱数据...</div></div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
