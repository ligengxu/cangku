'use client';

import { useEffect, useState, useRef } from 'react';
import { Table, Spin, Row, Col, Select, Space, Avatar, Button, Tooltip, Segmented, Modal, Tag } from 'antd';
import { TrophyOutlined, CrownOutlined, StarOutlined, FireOutlined, SyncOutlined, AimOutlined, RobotOutlined, DollarOutlined } from '@ant-design/icons';
import api from '@/services/api';
import type { ApiResponse } from '@/types';

interface ProductionItem {
  rank: number; worker_id: number; worker_name?: string; username?: string;
  real_name?: string; total_qty: number;
}

interface WeightDiffItem {
  rank: number; worker_id: number; worker_name?: string; username?: string;
  real_name?: string; total_count: number; total_actual_weight: number;
  total_abs_diff: number; diff_pct: number;
  overshoot_count: number; undershoot_count: number;
  overshoot_pct: number; undershoot_pct: number;
  overshoot_weight: number; undershoot_weight: number;
}

interface CommissionItem {
  rank: number; worker_id: number; worker_name?: string;
  printed: number; outbound: number; commission: number; outbound_rate: number;
}

type RankMode = 'production' | 'weight_diff' | 'commission';

const PODIUM_PRODUCTION = [
  { gradient: 'linear-gradient(135deg, #ffd700 0%, #ffb700 100%)', glow: 'rgba(255,215,0,0.25)', icon: <CrownOutlined />, iconSize: 32, text: '#b8860b' },
  { gradient: 'linear-gradient(135deg, #c0c0c0 0%, #a8a8a8 100%)', glow: 'rgba(192,192,192,0.2)', icon: <StarOutlined />, iconSize: 26, text: '#6b6b6b' },
  { gradient: 'linear-gradient(135deg, #cd7f32 0%, #b87333 100%)', glow: 'rgba(205,127,50,0.2)', icon: <FireOutlined />, iconSize: 26, text: '#8b5a2b' },
];

const PODIUM_ACCURACY = [
  { gradient: 'linear-gradient(135deg, #13c2c2 0%, #36cfc9 100%)', glow: 'rgba(19,194,194,0.25)', icon: <AimOutlined />, iconSize: 32, text: '#006d75' },
  { gradient: 'linear-gradient(135deg, #1890ff 0%, #69c0ff 100%)', glow: 'rgba(24,144,255,0.2)', icon: <AimOutlined />, iconSize: 26, text: '#0050b3' },
  { gradient: 'linear-gradient(135deg, #52c41a 0%, #95de64 100%)', glow: 'rgba(82,196,26,0.2)', icon: <AimOutlined />, iconSize: 26, text: '#237804' },
];

export default function WorkersRankingPage() {
  const [loading, setLoading] = useState(true);
  const [prodData, setProdData] = useState<ProductionItem[]>([]);
  const [diffData, setDiffData] = useState<WeightDiffItem[]>([]);
  const [commData, setCommData] = useState<CommissionItem[]>([]);
  const [period, setPeriod] = useState('month');
  const [mode, setMode] = useState<RankMode>('production');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.get('/workers/ranking', { params: { period, mode } });
      const list = res.data?.data ?? res.data ?? [];
      if (mode === 'weight_diff') {
        setDiffData(Array.isArray(list) ? list : []);
      } else if (mode === 'commission') {
        setCommData(Array.isArray(list) ? list : []);
      } else {
        setProdData(Array.isArray(list) ? list : []);
      }
    } catch {
      if (mode === 'weight_diff') setDiffData([]);
      else if (mode === 'commission') setCommData([]);
      else setProdData([]);
    }
    finally { setLoading(false); }
  };

  const openAiReview = async () => {
    setAiContent(''); setAiOpen(true); setAiLoading(true);
    try {
      abortRef.current = new AbortController();
      const res = await fetch(`/api/workers/ranking-ai-review?mode=${mode}`, {
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
      if (e.name !== 'AbortError') setAiContent('AI点评暂不可用');
    } finally { setAiLoading(false); abortRef.current = null; }
  };

  useEffect(() => { fetchData(); }, [period, mode]);

  const getName = (r: { worker_name?: string; real_name?: string; username?: string; worker_id: number }) =>
    r.worker_name || r.real_name || r.username || `#${r.worker_id}`;

  const PODIUM = mode === 'production' ? PODIUM_PRODUCTION : PODIUM_ACCURACY;

  // --- Production mode ---
  const renderProductionMode = () => {
    const top3 = prodData.slice(0, 3);
    const max = top3[0]?.total_qty || 1;
    const tableMax = prodData[0]?.total_qty || 1;

    return (
      <>
        {top3.length > 0 && (
          <Row gutter={[14, 14]} style={{ marginBottom: 22 }}>
            {top3.map((item, idx) => {
              const p = PODIUM[idx];
              const pct = Math.round((item.total_qty / max) * 100);
              return (
                <Col xs={24} sm={8} key={item.worker_id}>
                  <div className={`stagger-${idx + 1}`} style={{
                    background: p.gradient, borderRadius: 'var(--radius-l)',
                    padding: '24px 16px', textAlign: 'center', position: 'relative', overflow: 'hidden',
                    boxShadow: `0 6px 20px ${p.glow}`, transition: 'all 0.3s',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = `0 10px 30px ${p.glow}`; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = `0 6px 20px ${p.glow}`; }}
                  >
                    <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', bottom: -15, left: -15, width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
                    <div style={{ marginBottom: 10, fontSize: p.iconSize, color: '#fff', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))' }}>{p.icon}</div>
                    <Avatar size={44} style={{
                      background: 'rgba(255,255,255,0.3)', fontWeight: 700, fontSize: 16, color: '#fff',
                      boxShadow: '0 3px 12px rgba(0,0,0,0.1)', marginBottom: 8, backdropFilter: 'blur(4px)',
                    }}>{getName(item).charAt(0)}</Avatar>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#fff', marginBottom: 4, textShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>{getName(item)}</div>
                    <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', lineHeight: 1.1, textShadow: '0 2px 4px rgba(0,0,0,0.1)' }} className="num">{item.total_qty.toLocaleString()}</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>件</div>
                    <div style={{ marginTop: 12, height: 5, background: 'rgba(255,255,255,0.2)', borderRadius: 3 }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: 'rgba(255,255,255,0.6)', borderRadius: 3, transition: 'width 0.8s cubic-bezier(0.22, 1, 0.36, 1)' }} />
                    </div>
                  </div>
                </Col>
              );
            })}
          </Row>
        )}

        <div className="panel">
          <div className="panel-head">
            <span className="panel-title"><TrophyOutlined style={{ color: '#faad14' }} />完整排名</span>
            <span style={{ fontSize: 12, color: 'var(--text-4)' }}>共 {prodData.length} 人</span>
          </div>
          <Table rowKey="worker_id" dataSource={prodData} pagination={false} size="middle"
            locale={{ emptyText: '暂无排行数据' }}
            columns={[
              {
                title: '排名', key: 'rank', width: 70, align: 'center' as const,
                render: (_: any, r: ProductionItem) => {
                  if (r.rank <= 3) {
                    const p = PODIUM_PRODUCTION[r.rank - 1];
                    return (
                      <div style={{
                        width: 28, height: 28, borderRadius: 8, background: p.gradient,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700, fontSize: 12, color: '#fff', boxShadow: `0 2px 8px ${p.glow}`,
                      }}>{r.rank}</div>
                    );
                  }
                  return <span className="num" style={{ color: 'var(--text-4)', fontSize: 13 }}>{r.rank}</span>;
                },
              },
              {
                title: '工人', key: 'worker_name', width: 180,
                render: (_: any, r: ProductionItem) => {
                  const name = getName(r);
                  const colors = ['#1677ff', '#00b96b', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2'];
                  return (
                    <Space size={10}>
                      <Avatar size={30} style={{
                        background: r.rank <= 3 ? PODIUM_PRODUCTION[r.rank - 1].gradient : colors[r.worker_id % colors.length],
                        fontSize: 12, fontWeight: 700, boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
                      }}>{name.charAt(0)}</Avatar>
                      <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{name}</span>
                    </Space>
                  );
                },
              },
              {
                title: '产量', dataIndex: 'total_qty', align: 'right' as const,
                render: (v: number, r: ProductionItem) => {
                  const pct = Math.round((v / tableMax) * 100);
                  const barColor = r.rank === 1 ? 'linear-gradient(90deg, #ffd700, #ffb700)' :
                    r.rank === 2 ? 'linear-gradient(90deg, #c0c0c0, #a8a8a8)' :
                    r.rank === 3 ? 'linear-gradient(90deg, #cd7f32, #b87333)' :
                    'linear-gradient(90deg, var(--brand), #69b1ff)';
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'flex-end' }}>
                      <div style={{ width: 120, height: 6, background: 'rgba(0,0,0,0.04)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 3, transition: 'width 0.6s cubic-bezier(0.22, 1, 0.36, 1)' }} />
                      </div>
                      <span className="num" style={{ fontWeight: 700, minWidth: 55, textAlign: 'right', color: r.rank <= 3 ? PODIUM_PRODUCTION[r.rank - 1].text : 'var(--text-1)' }}>
                        {v.toLocaleString()}
                      </span>
                      <span style={{ color: 'var(--text-4)', fontSize: 12 }}>件</span>
                    </div>
                  );
                },
              },
            ]}
          />
        </div>
      </>
    );
  };

  // --- Weight diff mode ---
  const renderWeightDiffMode = () => {
    const top3 = diffData.slice(0, 3);
    const maxDiff = diffData.length ? Math.max(...diffData.map(d => d.diff_pct)) : 1;

    return (
      <>
        {top3.length > 0 && (
          <Row gutter={[14, 14]} style={{ marginBottom: 22 }}>
            {top3.map((item, idx) => {
              const p = PODIUM_ACCURACY[idx];
              return (
                <Col xs={24} sm={8} key={item.worker_id}>
                  <div className={`stagger-${idx + 1}`} style={{
                    background: p.gradient, borderRadius: 'var(--radius-l)',
                    padding: '24px 16px', textAlign: 'center', position: 'relative', overflow: 'hidden',
                    boxShadow: `0 6px 20px ${p.glow}`, transition: 'all 0.3s',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = `0 10px 30px ${p.glow}`; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = `0 6px 20px ${p.glow}`; }}
                  >
                    <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', bottom: -15, left: -15, width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
                    <div style={{ marginBottom: 10, fontSize: p.iconSize, color: '#fff', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))' }}>{p.icon}</div>
                    <Avatar size={44} style={{
                      background: 'rgba(255,255,255,0.3)', fontWeight: 700, fontSize: 16, color: '#fff',
                      boxShadow: '0 3px 12px rgba(0,0,0,0.1)', marginBottom: 8, backdropFilter: 'blur(4px)',
                    }}>{getName(item).charAt(0)}</Avatar>
                    <div style={{ fontWeight: 700, fontSize: 15, color: '#fff', marginBottom: 4, textShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>{getName(item)}</div>
                    <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', lineHeight: 1.1, textShadow: '0 2px 4px rgba(0,0,0,0.1)' }} className="num">{item.diff_pct}%</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>差值占比 · 最精准</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 6 }}>
                      出库 {item.total_count} 件 · {item.total_actual_weight.toLocaleString()} kg
                    </div>
                  </div>
                </Col>
              );
            })}
          </Row>
        )}

        <div className="panel">
          <div className="panel-head">
            <span className="panel-title"><AimOutlined style={{ color: '#13c2c2' }} />重量差排行</span>
            <span style={{ fontSize: 12, color: 'var(--text-4)' }}>共 {diffData.length} 人 · 差值占比从低到高</span>
          </div>
          <Table rowKey="worker_id" dataSource={diffData} pagination={false} size="middle"
            locale={{ emptyText: '暂无排行数据' }}
            columns={[
              {
                title: '排名', key: 'rank', width: 70, align: 'center' as const,
                render: (_: any, r: WeightDiffItem) => {
                  if (r.rank <= 3) {
                    const p = PODIUM_ACCURACY[r.rank - 1];
                    return (
                      <div style={{
                        width: 28, height: 28, borderRadius: 8, background: p.gradient,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 700, fontSize: 12, color: '#fff', boxShadow: `0 2px 8px ${p.glow}`,
                      }}>{r.rank}</div>
                    );
                  }
                  return <span className="num" style={{ color: 'var(--text-4)', fontSize: 13 }}>{r.rank}</span>;
                },
              },
              {
                title: '工人', key: 'worker_name', width: 160,
                render: (_: any, r: WeightDiffItem) => {
                  const name = getName(r);
                  const colors = ['#13c2c2', '#1890ff', '#52c41a', '#722ed1', '#eb2f96', '#fa8c16'];
                  return (
                    <Space size={10}>
                      <Avatar size={30} style={{
                        background: r.rank <= 3 ? PODIUM_ACCURACY[r.rank - 1].gradient : colors[r.worker_id % colors.length],
                        fontSize: 12, fontWeight: 700, boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
                      }}>{name.charAt(0)}</Avatar>
                      <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{name}</span>
                    </Space>
                  );
                },
              },
              {
                title: '总出库重量', dataIndex: 'total_actual_weight', align: 'right' as const, width: 120,
                render: (v: number) => <span className="num" style={{ fontWeight: 600 }}>{v.toLocaleString()} <span style={{ color: 'var(--text-4)', fontSize: 12 }}>kg</span></span>,
              },
              {
                title: '重量差', dataIndex: 'total_abs_diff', align: 'right' as const, width: 110,
                render: (v: number) => <span className="num" style={{ fontWeight: 600, color: '#fa8c16' }}>{v.toLocaleString()} <span style={{ fontSize: 12 }}>kg</span></span>,
              },
              {
                title: '差值占比', dataIndex: 'diff_pct', align: 'right' as const, width: 180,
                render: (v: number, r: WeightDiffItem) => {
                  const pct = maxDiff > 0 ? Math.round((v / maxDiff) * 100) : 0;
                  const isGood = v < 3;
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                      <div style={{ width: 100, height: 6, background: 'rgba(0,0,0,0.04)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          width: `${pct}%`, height: '100%', borderRadius: 3,
                          background: isGood ? 'linear-gradient(90deg, #52c41a, #95de64)' : 'linear-gradient(90deg, #ff4d4f, #ff7a45)',
                          transition: 'width 0.6s cubic-bezier(0.22, 1, 0.36, 1)',
                        }} />
                      </div>
                      <span className="num" style={{ fontWeight: 700, minWidth: 50, textAlign: 'right', color: isGood ? '#52c41a' : '#ff4d4f' }}>{v}%</span>
                    </div>
                  );
                },
              },
              {
                title: '多发', key: 'overshoot', align: 'center' as const, width: 90,
                render: (_: any, r: WeightDiffItem) => (
                  <Tooltip title={`多发重量: ${r.overshoot_weight} kg`}>
                    <span style={{ color: '#fa8c16', fontWeight: 600 }}>{r.overshoot_count}<span style={{ fontSize: 11, color: 'var(--text-4)', marginLeft: 2 }}>次</span></span>
                  </Tooltip>
                ),
              },
              {
                title: '少发', key: 'undershoot', align: 'center' as const, width: 90,
                render: (_: any, r: WeightDiffItem) => (
                  <Tooltip title={`少发重量: ${r.undershoot_weight} kg`}>
                    <span style={{ color: '#ff4d4f', fontWeight: 600 }}>{r.undershoot_count}<span style={{ fontSize: 11, color: 'var(--text-4)', marginLeft: 2 }}>次</span></span>
                  </Tooltip>
                ),
              },
            ]}
          />
        </div>
      </>
    );
  };

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22,
        padding: '20px 24px', borderRadius: 'var(--radius-l)',
        background: mode === 'production'
          ? 'linear-gradient(135deg, rgba(250,173,20,0.06) 0%, rgba(255,77,79,0.03) 100%)'
          : 'linear-gradient(135deg, rgba(19,194,194,0.06) 0%, rgba(24,144,255,0.03) 100%)',
        border: mode === 'production' ? '1px solid rgba(250,173,20,0.08)' : '1px solid rgba(19,194,194,0.08)',
        transition: 'all 0.3s',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 32, height: 32, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: mode === 'production'
                ? 'linear-gradient(135deg, #faad14 0%, #ffc53d 100%)'
                : 'linear-gradient(135deg, #13c2c2 0%, #36cfc9 100%)',
              color: '#fff', fontSize: 15,
              boxShadow: mode === 'production' ? '0 3px 10px rgba(250,173,20,0.25)' : '0 3px 10px rgba(19,194,194,0.25)',
              transition: 'all 0.3s',
            }}>{mode === 'production' ? <TrophyOutlined /> : <AimOutlined />}</span>
            {mode === 'production' ? '业绩排行' : '重量差排行'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 42 }}>
            {mode === 'production' ? '工人生产产量排名' : '出库重量精准度排名 · 差值占比越低越精准'}
          </div>
        </div>
        <Space>
          <Tooltip title="刷新排行">
            <Button icon={<SyncOutlined spin={loading} />} onClick={fetchData}
              style={{ borderRadius: 10, borderColor: mode === 'production' ? 'rgba(250,173,20,0.3)' : 'rgba(19,194,194,0.3)' }} />
          </Tooltip>
          <Tooltip title="AI点评">
            <Button icon={<RobotOutlined />} onClick={openAiReview}
              style={{ borderRadius: 10, background: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none', color: '#fff' }} />
          </Tooltip>
          <Select value={period} onChange={setPeriod} style={{ width: 110 }}
            options={[{ value: 'week', label: '本周' }, { value: 'month', label: '本月' }, { value: 'all', label: '全部' }]} />
          <Segmented value={mode} onChange={v => setMode(v as RankMode)}
            options={[
              { value: 'production', label: '业绩排行' },
              { value: 'commission', label: '佣金排行' },
              { value: 'weight_diff', label: '重量差排行' },
            ]} />
        </Space>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : mode === 'production' ? renderProductionMode() : mode === 'weight_diff' ? renderWeightDiffMode() : (
        /* Commission mode */
        <>
          {commData.slice(0, 3).length > 0 && (
            <Row gutter={[14, 14]} style={{ marginBottom: 22 }}>
              {commData.slice(0, 3).map((item, idx) => {
                const gradients = [
                  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
                  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
                ];
                const glows = ['rgba(102,126,234,0.25)', 'rgba(245,87,108,0.2)', 'rgba(79,172,254,0.2)'];
                return (
                  <Col xs={24} sm={8} key={item.worker_id}>
                    <div className={`stagger-${idx + 1}`} style={{
                      background: gradients[idx], borderRadius: 'var(--radius-l)',
                      padding: '24px 16px', textAlign: 'center', position: 'relative', overflow: 'hidden',
                      boxShadow: `0 6px 20px ${glows[idx]}`, transition: 'all 0.3s',
                    }}
                      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
                    >
                      <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.15)' }} />
                      <div style={{ marginBottom: 10, fontSize: idx === 0 ? 32 : 26, color: '#fff' }}>{idx === 0 ? <CrownOutlined /> : <DollarOutlined />}</div>
                      <Avatar size={44} style={{ background: 'rgba(255,255,255,0.3)', fontWeight: 700, fontSize: 16, color: '#fff', marginBottom: 8 }}>
                        {(item.worker_name || `#${item.worker_id}`).charAt(0)}
                      </Avatar>
                      <div style={{ fontWeight: 700, fontSize: 15, color: '#fff', marginBottom: 4 }}>{item.worker_name || `#${item.worker_id}`}</div>
                      <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', lineHeight: 1.1 }} className="num">¥{item.commission.toFixed(2)}</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 4 }}>出库 {item.outbound} · 出库率 {item.outbound_rate}%</div>
                    </div>
                  </Col>
                );
              })}
            </Row>
          )}
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title"><DollarOutlined style={{ color: '#722ed1' }} />佣金排行</span>
              <span style={{ fontSize: 12, color: 'var(--text-4)' }}>共 {commData.length} 人</span>
            </div>
            <Table rowKey="worker_id" dataSource={commData} pagination={false} size="middle"
              locale={{ emptyText: '暂无排行数据' }}
              columns={[
                {
                  title: '排名', key: 'rank', width: 70, align: 'center' as const,
                  render: (_: any, r: CommissionItem) => r.rank <= 3 ? (
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: ['linear-gradient(135deg, #667eea, #764ba2)', 'linear-gradient(135deg, #f093fb, #f5576c)', 'linear-gradient(135deg, #4facfe, #00f2fe)'][r.rank - 1], display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, color: '#fff' }}>{r.rank}</div>
                  ) : <span className="num" style={{ color: 'var(--text-4)' }}>{r.rank}</span>,
                },
                {
                  title: '工人', key: 'worker', width: 160,
                  render: (_: any, r: CommissionItem) => (
                    <Space size={10}>
                      <Avatar size={30} style={{ background: `hsl(${r.worker_id * 47 % 360},55%,55%)`, fontSize: 12, fontWeight: 700 }}>{(r.worker_name || '?').charAt(0)}</Avatar>
                      <span style={{ fontWeight: 600 }}>{r.worker_name}</span>
                    </Space>
                  ),
                },
                { title: '佣金', dataIndex: 'commission', align: 'right' as const, width: 120, render: (v: number) => <span className="num" style={{ fontWeight: 800, color: '#722ed1', fontSize: 15 }}>¥{v.toFixed(2)}</span> },
                { title: '出库', dataIndex: 'outbound', align: 'right' as const, width: 80, render: (v: number) => <span className="num" style={{ fontWeight: 600, color: '#52c41a' }}>{v}</span> },
                { title: '打印', dataIndex: 'printed', align: 'right' as const, width: 80 },
                { title: '出库率', dataIndex: 'outbound_rate', align: 'center' as const, width: 90, render: (v: number) => <Tag color={v >= 80 ? 'green' : v >= 50 ? 'orange' : 'red'} style={{ borderRadius: 6, fontWeight: 600 }}>{v}%</Tag> },
              ]}
            />
          </div>
        </>
      )}

      {/* AI Review Modal */}
      <Modal
        title={<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #667eea, #764ba2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
          </div>
          <span>AI 排行点评</span>
          {aiLoading && <Spin size="small" />}
        </div>}
        open={aiOpen}
        onCancel={() => { setAiOpen(false); if (abortRef.current) abortRef.current.abort(); }}
        footer={null} width={520}
      >
        <div style={{ padding: '12px 0', fontSize: 14, lineHeight: 1.8, minHeight: 100 }}>
          {aiContent ? (
            <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(102,126,234,0.04)', border: '1px solid rgba(102,126,234,0.1)' }}>
              {aiContent.split(/(\*\*.*?\*\*|\n)/g).map((part, i) => {
                if (part === '\n') return <br key={i} />;
                if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
                return <span key={i}>{part}</span>;
              })}
            </div>
          ) : aiLoading ? (
            <div style={{ textAlign: 'center', padding: 30 }}><Spin size="large" /><div style={{ marginTop: 10, color: 'var(--text-3)' }}>AI正在分析排行数据...</div></div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
