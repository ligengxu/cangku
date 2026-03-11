'use client';

import { useEffect, useState, useCallback } from 'react';
import { Row, Col, Spin, Empty } from 'antd';
import {
  PrinterOutlined, ExperimentOutlined, ClockCircleOutlined, TeamOutlined,
  SyncOutlined, TrophyOutlined, CrownOutlined, FireOutlined,
  FullscreenOutlined, FullscreenExitOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dayjs from 'dayjs';

function AnimNum({ value, duration = 600 }: { value: number; duration?: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!value) { setN(0); return; }
    let start = 0;
    const startTime = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      start = Math.round(eased * value);
      setN(start);
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [value, duration]);
  return <span>{n.toLocaleString()}</span>;
}

const STAT_CARDS = [
  { key: 'printed', label: '已打印', icon: <PrinterOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #4096ff 50%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.3)' },
  { key: 'produced', label: '已生产', icon: <ExperimentOutlined />, gradient: 'linear-gradient(135deg, #00b96b 0%, #52c41a 50%, #95de64 100%)', glow: 'rgba(0,185,107,0.3)' },
  { key: 'pending', label: '待打印', icon: <ClockCircleOutlined />, gradient: 'linear-gradient(135deg, #fa8c16 0%, #faad14 50%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.3)' },
  { key: 'workers', label: '在岗工人', icon: <TeamOutlined />, gradient: 'linear-gradient(135deg, #722ed1 0%, #9254de 50%, #b37feb 100%)', glow: 'rgba(114,46,209,0.3)' },
];

interface FullData {
  stats: Record<string, number>;
  trends: { production: { date: string; value: number }[]; purchases: { date: string; value: number }[]; outbound: { date: string; value: number }[] };
  top_skus: { name: string; count: number }[];
  top_workers: { name: string; qty: number }[];
}

function MiniAreaChart({ data, color, height = 80 }: { data: { date: string; value: number }[]; color: string; height?: number }) {
  if (!data?.length) return null;
  const mx = Math.max(...data.map(d => d.value), 1);
  const w = 300, h = height;
  const pad = { top: 8, bottom: 20, left: 4, right: 4 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const pts = data.map((d, i) => ({
    x: pad.left + (i / Math.max(data.length - 1, 1)) * plotW,
    y: pad.top + plotH - (d.value / mx) * plotH,
    ...d,
  }));

  let line = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const cx = (pts[i].x + pts[i + 1].x) / 2;
    line += ` C ${cx},${pts[i].y} ${cx},${pts[i + 1].y} ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  const area = line + ` L ${pts[pts.length - 1].x},${pad.top + plotH} L ${pts[0].x},${pad.top + plotH} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
      <defs>
        <linearGradient id={`area-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#area-${color.replace('#', '')})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      {pts.map((p, i) => (
        <g key={i}>
          {i === pts.length - 1 && <circle cx={p.x} cy={p.y} r="4" fill={color} stroke="rgba(255,255,255,0.8)" strokeWidth="2" />}
          <text x={p.x} y={h - 4} fill="rgba(255,255,255,0.35)" fontSize="9" textAnchor="middle">{p.date}</text>
        </g>
      ))}
    </svg>
  );
}

function RingProgress({ percent, color, size = 80, label }: { percent: number; color: string; size?: number; label: string }) {
  const r = (size - 10) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - percent / 100);
  return (
    <div style={{ textAlign: 'center' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="6"
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.22,1,0.36,1)' }} />
        <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fill="#fff" fontSize="16" fontWeight="700">{percent}%</text>
        <text x={size / 2} y={size / 2 + 14} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="9">{label}</text>
      </svg>
    </div>
  );
}

function RankList({ items, type }: { items: { name: string; value: number }[]; type: 'sku' | 'worker' }) {
  if (!items?.length) return <div style={{ padding: 20, textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>暂无数据</div>;
  const mx = Math.max(...items.map(i => i.value), 1);
  const medals = ['#ffd700', '#c0c0c0', '#cd7f32'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.slice(0, 5).map((item, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0',
          animation: `screen-card-in 0.5s cubic-bezier(0.22,1,0.36,1) ${i * 0.08}s both`,
        }}>
          <div style={{
            width: 22, height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, flexShrink: 0,
            background: i < 3 ? medals[i] : 'rgba(255,255,255,0.08)',
            color: i < 3 ? '#fff' : 'rgba(255,255,255,0.5)',
            boxShadow: i < 3 ? `0 2px 8px ${medals[i]}50` : 'none',
          }}>
            {i < 3 ? <CrownOutlined style={{ fontSize: 10 }} /> : i + 1}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>
              {item.name}
            </div>
            <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 2,
                width: `${(item.value / mx) * 100}%`,
                background: type === 'sku'
                  ? `linear-gradient(90deg, #1677ff, #69b1ff)`
                  : `linear-gradient(90deg, #722ed1, #b37feb)`,
                transition: 'width 0.8s cubic-bezier(0.22,1,0.36,1)',
              }} />
            </div>
          </div>
          <span style={{
            fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0,
            color: i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : 'rgba(255,255,255,0.6)',
          }}>
            {item.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ProductionScreenPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<FullData | null>(null);
  const [time, setTime] = useState(dayjs());
  const [lastUpdate, setLastUpdate] = useState<dayjs.Dayjs | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const fetchStats = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const [todayRes, fullRes] = await Promise.all([
        api.get('/dashboard/today-stats'),
        api.get('/dashboard/full').catch(() => ({ data: { data: null } })),
      ]);
      const todayStats = todayRes.data?.data ?? {};
      const fullData = (fullRes.data as any)?.data;
      setData({
        stats: {
          printed: todayStats.printed_qty ?? 0,
          produced: todayStats.produced_qty ?? 0,
          pending: todayStats.pending_qty ?? 0,
          workers: todayStats.worker_count ?? 0,
        },
        trends: fullData?.trends ?? { production: [], purchases: [], outbound: [] },
        top_skus: fullData?.top_skus ?? [],
        top_workers: fullData?.top_workers ?? [],
      });
      setLastUpdate(dayjs());
    } catch { setData(null); }
    finally { setRefreshing(false); }
  }, []);

  useEffect(() => { setLoading(true); fetchStats().finally(() => setLoading(false)); }, [fetchStats]);
  useEffect(() => { const id = setInterval(() => fetchStats(true), 30000); return () => clearInterval(id); }, [fetchStats]);
  useEffect(() => { const id = setInterval(() => setTime(dayjs()), 1000); return () => clearInterval(id); }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const h = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  const s = data?.stats || {};
  const totalToday = (s.printed || 0) + (s.produced || 0);
  const targetToday = Math.max(totalToday, 200);
  const completionPct = totalToday > 0 ? Math.min(Math.round((totalToday / targetToday) * 100), 100) : 0;
  const auditRate = (s.produced || 0) > 0 ? Math.round(((s.printed || 0) / Math.max(s.produced || 1, 1)) * 100) : 0;

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#080b14' }}>
      <Spin size="large" />
    </div>
  );

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #080b14 0%, #0f1629 30%, #141e36 60%, #0a0e17 100%)',
      padding: '32px 36px 24px',
      color: '#fff', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: '10%', left: '5%', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(22,119,255,0.06) 0%, transparent 60%)', pointerEvents: 'none', animation: 'orb-float-1 20s ease-in-out infinite' }} />
      <div style={{ position: 'absolute', bottom: '5%', right: '10%', width: 350, height: 350, borderRadius: '50%', background: 'radial-gradient(circle, rgba(114,46,209,0.05) 0%, transparent 60%)', pointerEvents: 'none', animation: 'orb-float-2 25s ease-in-out infinite' }} />
      <div style={{ position: 'absolute', top: '50%', left: '50%', width: 300, height: 300, borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,185,107,0.04) 0%, transparent 60%)', pointerEvents: 'none' }} />

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32, position: 'relative', zIndex: 1 }}>
        <div>
          <div style={{
            fontSize: 30, fontWeight: 800, letterSpacing: 3,
            background: 'linear-gradient(135deg, #fff 0%, rgba(255,255,255,0.7) 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            生产指挥中心
          </div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 4, letterSpacing: 1 }}>
            PRODUCTION COMMAND CENTER
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', fontWeight: 300 }}>
              {time.format('YYYY年MM月DD日')}
            </div>
            <div style={{
              fontSize: 28, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums',
              textShadow: '0 0 20px rgba(22,119,255,0.3)',
            }}>
              {time.format('HH:mm:ss')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div
              style={{
                width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                cursor: 'pointer', transition: 'all 0.25s', fontSize: 14, color: 'rgba(255,255,255,0.6)',
              }}
              onClick={toggleFullscreen}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(22,119,255,0.15)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
            >
              {isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
            </div>
            <div
              style={{
                width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                cursor: 'pointer', transition: 'all 0.25s', fontSize: 14,
                color: refreshing ? '#69b1ff' : 'rgba(255,255,255,0.6)',
              }}
              onClick={() => fetchStats()}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(22,119,255,0.15)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
            >
              <SyncOutlined spin={refreshing} />
            </div>
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24, position: 'relative', zIndex: 1 }}>
        {STAT_CARDS.map((c, i) => (
          <Col xs={12} sm={12} lg={6} key={c.key}>
            <div style={{
              animation: `screen-card-in 0.6s cubic-bezier(0.22,1,0.36,1) ${i * 0.1}s both`,
              background: c.gradient, borderRadius: 16,
              padding: '24px 22px', textAlign: 'center',
              position: 'relative', overflow: 'hidden',
              boxShadow: `0 6px 24px ${c.glow}`,
              transition: 'all 0.4s',
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px) scale(1.02)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
            >
              <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', pointerEvents: 'none' }} />
              <div style={{ fontSize: 32, color: 'rgba(255,255,255,0.25)', marginBottom: 8 }}>{c.icon}</div>
              <div style={{ fontSize: 42, fontWeight: 800, color: '#fff', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', textShadow: '0 2px 8px rgba(0,0,0,0.15)' }}>
                <AnimNum value={(s as any)[c.key] || 0} />
              </div>
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.65)', marginTop: 6, fontWeight: 500, letterSpacing: 1 }}>{c.label}</div>
            </div>
          </Col>
        ))}
      </Row>

      {/* Second Row: Trends + Rankings + Progress */}
      <Row gutter={[16, 16]} style={{ position: 'relative', zIndex: 1 }}>
        {/* Trend Chart */}
        <Col xs={24} lg={10}>
          <div style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 16, padding: '20px 20px 8px', height: '100%',
            backdropFilter: 'blur(10px)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.8)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              <FireOutlined style={{ color: '#fa8c16' }} />
              7日产量趋势
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginLeft: 'auto' }}>标签打印量</span>
            </div>
            <MiniAreaChart data={data?.trends?.production || []} color="#1677ff" height={90} />
            <div style={{ height: 12 }} />
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 3, borderRadius: 2, background: '#fac858', display: 'inline-block' }} />
              出库趋势
            </div>
            <MiniAreaChart data={data?.trends?.outbound || []} color="#fac858" height={70} />
          </div>
        </Col>

        {/* Rankings */}
        <Col xs={24} lg={8}>
          <Row gutter={[0, 16]} style={{ height: '100%' }}>
            <Col span={24}>
              <div style={{
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 16, padding: '16px 18px',
                backdropFilter: 'blur(10px)',
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.8)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TrophyOutlined style={{ color: '#ffd700' }} />
                  SKU 热度 Top 5
                </div>
                <RankList items={(data?.top_skus || []).map(s => ({ name: s.name, value: s.count }))} type="sku" />
              </div>
            </Col>
            <Col span={24}>
              <div style={{
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 16, padding: '16px 18px',
                backdropFilter: 'blur(10px)',
              }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.8)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <TeamOutlined style={{ color: '#b37feb' }} />
                  工人产量 Top 5
                </div>
                <RankList items={(data?.top_workers || []).map(w => ({ name: w.name, value: w.qty }))} type="worker" />
              </div>
            </Col>
          </Row>
        </Col>

        {/* Progress Rings */}
        <Col xs={24} lg={6}>
          <div style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 16, padding: '20px 16px', height: '100%',
            backdropFilter: 'blur(10px)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-around',
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.8)', marginBottom: 8, textAlign: 'center' }}>
              今日指标
            </div>
            <RingProgress percent={completionPct} color="#1677ff" size={90} label="产量完成" />
            <RingProgress percent={Math.min(auditRate, 100)} color="#00b96b" size={90} label="打印/生产比" />
            <RingProgress percent={s.workers ? Math.min(Math.round((s.workers / Math.max(s.workers, 10)) * 100), 100) : 0} color="#722ed1" size={90} label="在岗率" />
            <div style={{
              marginTop: 8, padding: '8px 14px', borderRadius: 10,
              background: 'rgba(22,119,255,0.08)', border: '1px solid rgba(22,119,255,0.12)',
              fontSize: 12, color: 'rgba(255,255,255,0.5)', textAlign: 'center',
            }}>
              今日总产出 <span style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>{totalToday.toLocaleString()}</span>
            </div>
          </div>
        </Col>
      </Row>

      {/* Footer */}
      <div style={{
        textAlign: 'center', marginTop: 24, color: 'rgba(255,255,255,0.2)', fontSize: 12,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
        position: 'relative', zIndex: 1,
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <SyncOutlined /> 每 30 秒自动刷新
        </span>
        {lastUpdate && <span>· 上次更新 {lastUpdate.format('HH:mm:ss')}</span>}
        <span>· 果管系统 v3.0</span>
      </div>

      <style jsx global>{`
        @keyframes screen-card-in {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (max-width: 576px) {
          .screen-header { display: flex; flex-direction: column; align-items: center; }
        }
      `}</style>
    </div>
  );
}
