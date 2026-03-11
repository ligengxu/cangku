'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Spin, Avatar, Tag, Tooltip, Row, Col, Empty, Progress } from 'antd';
import {
  UserOutlined, PhoneOutlined, AlipayOutlined, TrophyOutlined,
  FireOutlined, RiseOutlined,
  StarOutlined, ThunderboltOutlined, CrownOutlined,
} from '@ant-design/icons';
import api from '@/services/api';

interface WorkerProfile {
  worker: { id: number; username: string; real_name: string | null; phone: string | null; alipay_account: string | null };
  production: { total_qty: number; month_qty: number; today_qty: number; daily_avg: number; working_days_30d: number; total_labels: number; trend: { date: string; qty: number }[]; sku_breakdown: { sku_id: number; name: string; fruit: string; qty: number }[] };
  ranking: { rank: number; total_workers: number };
}


function MiniLineChart({ data, height = 60 }: { data: { date: string; qty: number }[]; height?: number }) {
  if (!data?.length) return null;
  const mx = Math.max(...data.map(d => d.qty), 1);
  const w = 100, h = height;
  const pad = { top: 4, bottom: 4, left: 2, right: 2 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const pts = data.map((d, i) => ({
    x: pad.left + (i / Math.max(data.length - 1, 1)) * plotW,
    y: pad.top + plotH - (d.qty / mx) * plotH,
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
        <linearGradient id="profile-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1677ff" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#1677ff" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#profile-area)" />
      <path d={line} fill="none" stroke="#1677ff" strokeWidth="0.5" strokeLinecap="round" />
      {pts.filter((_, i) => i === pts.length - 1).map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="1.5" fill="#1677ff" stroke="#fff" strokeWidth="0.5" />
      ))}
    </svg>
  );
}

function BarChartIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ verticalAlign: '-2px', marginRight: 4 }}>
      <rect x="1" y="6" width="3" height="7" rx="1" fill="#1677ff" opacity="0.6" />
      <rect x="5.5" y="3" width="3" height="10" rx="1" fill="#1677ff" opacity="0.8" />
      <rect x="10" y="1" width="3" height="12" rx="1" fill="#1677ff" />
    </svg>
  );
}

export default function WorkerProfileModal({
  workerId,
  open,
  onClose,
}: {
  workerId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<WorkerProfile | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!workerId) return;
    setLoading(true);
    try {
      const r = await api.get(`/workers/${workerId}/profile`);
      setProfile(r.data?.data || null);
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, [workerId]);

  useEffect(() => {
    if (open && workerId) fetchProfile();
  }, [open, workerId, fetchProfile]);

  const w = profile?.worker;
  const prod = profile?.production;
  const rank = profile?.ranking;

  const avatarColors = ['#1677ff', '#00b96b', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2'];
  const avatarBg = w ? avatarColors[(w.id || 0) % avatarColors.length] : '#1677ff';

  const rankPct = rank && rank.total_workers > 0 ? Math.round((1 - (rank.rank - 1) / rank.total_workers) * 100) : 0;

  const skuMax = prod?.sku_breakdown?.length ? Math.max(...prod.sku_breakdown.map(s => s.qty)) : 1;
  const skuColors = ['#1677ff', '#00b96b', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2', '#faad14', '#2f54eb'];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={680}
      destroyOnClose
      styles={{
        content: {
          borderRadius: 20,
          overflow: 'hidden',
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(20px)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.12), 0 0 1px rgba(0,0,0,0.1)',
          padding: 0,
        },
        mask: { backdropFilter: 'blur(8px)' },
      }}
      closable={false}
    >
      {loading ? (
        <div style={{ padding: 60, textAlign: 'center' }}>
          <Spin size="large" />
          <div style={{ marginTop: 16, color: 'var(--text-3)', fontSize: 13 }}>{'\u52a0\u8f7d\u5de5\u4eba\u6863\u6848\u4e2d...'}</div>
        </div>
      ) : !profile ? (
        <div style={{ padding: 40 }}><Empty description={'\u65e0\u6cd5\u52a0\u8f7d\u5de5\u4eba\u6863\u6848'} /></div>
      ) : (
        <div>
          {/* Header Card */}
          <div style={{
            background: `linear-gradient(135deg, ${avatarBg} 0%, ${avatarBg}cc 100%)`,
            padding: '28px 28px 24px',
            position: 'relative',
            overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute', top: -30, right: -30, width: 120, height: 120, borderRadius: '50%',
              background: 'rgba(255,255,255,0.08)', pointerEvents: 'none',
            }} />
            <div style={{
              position: 'absolute', bottom: -20, left: '30%', width: 80, height: 80, borderRadius: '50%',
              background: 'rgba(255,255,255,0.06)', pointerEvents: 'none',
            }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Avatar size={60} style={{
                background: 'rgba(255,255,255,0.2)',
                backdropFilter: 'blur(8px)',
                fontSize: 24, fontWeight: 700, color: '#fff',
                border: '3px solid rgba(255,255,255,0.3)',
              }}>
                {(w?.real_name || w?.username || 'U')[0]}
              </Avatar>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {w?.real_name || w?.username}
                  {rank && rank.rank <= 3 && (
                    <Tag style={{
                      background: rank.rank === 1 ? 'linear-gradient(135deg, #faad14, #ffc53d)' : rank.rank === 2 ? 'linear-gradient(135deg, #bfbfbf, #d9d9d9)' : 'linear-gradient(135deg, #cd7f32, #daa520)',
                      color: '#fff', border: 'none', borderRadius: 10, fontSize: 11, padding: '0 8px',
                    }}>
                      <CrownOutlined style={{ marginRight: 3 }} />
                      {rank.rank === 1 ? '\u51a0\u519b' : rank.rank === 2 ? '\u4e9a\u519b' : '\u5b63\u519b'}
                    </Tag>
                  )}
                </div>
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span><UserOutlined style={{ marginRight: 4 }} />{w?.username}</span>
                  {w?.phone && <span><PhoneOutlined style={{ marginRight: 4 }} />{w.phone}</span>}
                </div>
              </div>
              {rank && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#fff', lineHeight: 1 }}>
                    #{rank.rank}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>
                    / {rank.total_workers}{'\u4eba'}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: '20px 24px 24px' }}>
            {/* KPI Row */}
            <Row gutter={[10, 10]} style={{ marginBottom: 20 }}>
              {[
                { label: '\u7d2f\u8ba1\u4ea7\u91cf', value: prod?.total_qty?.toLocaleString() || '0', icon: <FireOutlined />, color: '#1677ff', bg: 'rgba(22,119,255,0.06)' },
                { label: '\u672c\u6708\u4ea7\u91cf', value: prod?.month_qty?.toLocaleString() || '0', icon: <RiseOutlined />, color: '#00b96b', bg: 'rgba(0,185,107,0.06)' },
                { label: '\u65e5\u5747\u4ea7\u91cf', value: String(prod?.daily_avg || 0), icon: <ThunderboltOutlined />, color: '#fa8c16', bg: 'rgba(250,140,22,0.06)' },
                { label: '\u4eca\u65e5\u4ea7\u91cf', value: prod?.today_qty?.toLocaleString() || '0', icon: <StarOutlined />, color: '#722ed1', bg: 'rgba(114,46,209,0.06)' },
              ].map((item, i) => (
                <Col span={6} key={i}>
                  <div style={{
                    padding: '12px 10px', borderRadius: 12, background: item.bg,
                    textAlign: 'center', transition: 'all 0.3s',
                  }}>
                    <div style={{ color: item.color, fontSize: 16, marginBottom: 4 }}>{item.icon}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>{item.value}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{item.label}</div>
                  </div>
                </Col>
              ))}
            </Row>

            {/* Production Trend */}
            <div style={{
              marginBottom: 20, padding: '14px 16px', borderRadius: 14,
              background: 'linear-gradient(180deg, rgba(22,119,255,0.03) 0%, rgba(22,119,255,0.008) 100%)',
              border: '1px solid rgba(22,119,255,0.06)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
                  <BarChartIcon /> {'\u8fd130\u5929\u4ea7\u91cf\u8d8b\u52bf'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
                  {'\u6d3b\u8dc3'} {prod?.working_days_30d || 0} {'\u5929'}
                </span>
              </div>
              <MiniLineChart data={prod?.trend || []} height={70} />
            </div>

            {/* Two columns: SKU breakdown + outbound stats */}
            <Row gutter={[14, 14]}>
              <Col xs={24} md={12}>
                <div style={{
                  padding: '14px 16px', borderRadius: 14,
                  background: 'rgba(0,0,0,0.015)', border: '1px solid rgba(0,0,0,0.04)',
                  height: '100%',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <TrophyOutlined style={{ color: '#faad14' }} /> {'SKU \u4ea7\u91cf\u5206\u5e03'}
                  </div>
                  {prod?.sku_breakdown?.length ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {prod.sku_breakdown.slice(0, 6).map((s, i) => (
                        <div key={s.sku_id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{
                            width: 18, height: 18, borderRadius: 5, fontSize: 10, fontWeight: 700,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                            background: i < 3 ? `linear-gradient(135deg, ${skuColors[i]}, ${skuColors[i]}88)` : 'rgba(0,0,0,0.04)',
                            color: i < 3 ? '#fff' : 'var(--text-3)',
                          }}>{i + 1}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                            <div style={{ height: 4, borderRadius: 2, background: 'rgba(0,0,0,0.04)', overflow: 'hidden', marginTop: 3 }}>
                              <div style={{
                                height: '100%', borderRadius: 2,
                                width: `${(s.qty / skuMax) * 100}%`,
                                background: `linear-gradient(90deg, ${skuColors[i % skuColors.length]}, ${skuColors[i % skuColors.length]}66)`,
                                transition: 'width 0.6s',
                              }} />
                            </div>
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: skuColors[i % skuColors.length], fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{s.qty}</span>
                        </div>
                      ))}
                    </div>
                  ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={'\u6682\u65e0\u6570\u636e'} style={{ padding: '10px 0' }} />}
                </div>
              </Col>
              <Col xs={24} md={12}>
                <div style={{
                  padding: '14px 16px', borderRadius: 14,
                  background: 'rgba(0,0,0,0.015)', border: '1px solid rgba(0,0,0,0.04)',
                  height: '100%',
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <RiseOutlined style={{ color: '#00b96b' }} /> {'出库统计'}
                  </div>
                  <Row gutter={[8, 8]} style={{ marginBottom: 12 }}>
                    {[
                      { label: '标签总数', value: prod?.total_labels?.toLocaleString() || '0', color: '#1677ff' },
                      { label: '出库率', value: prod?.total_qty && prod?.total_labels ? `${Math.round(prod.total_qty / prod.total_labels * 100)}%` : '0%', color: '#00b96b' },
                      { label: '活跃天数', value: prod?.working_days_30d || 0, color: '#fa8c16' },
                      { label: '排名', value: rankPct >= 80 ? `前${100 - rankPct}%` : rankPct >= 50 ? `前${100 - rankPct}%` : `前${100 - rankPct}%`, color: rankPct >= 80 ? '#00b96b' : rankPct >= 50 ? '#fa8c16' : '#ff4d4f' },
                    ].map((item, i) => (
                      <Col span={12} key={i}>
                        <div style={{
                          padding: '6px 8px', borderRadius: 8,
                          background: `${item.color}08`, textAlign: 'center',
                        }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: item.color }}>{item.value}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-4)' }}>{item.label}</div>
                        </div>
                      </Col>
                    ))}
                  </Row>
                  {rank && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-4)' }}>综合排名百分比</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: rankPct >= 80 ? '#00b96b' : rankPct >= 50 ? '#fa8c16' : '#ff4d4f' }}>{rankPct}%</span>
                      </div>
                      <Progress
                        percent={rankPct}
                        showInfo={false}
                        strokeColor={rankPct >= 80 ? { '0%': '#00b96b', '100%': '#52c41a' } : rankPct >= 50 ? { '0%': '#fa8c16', '100%': '#ffc53d' } : { '0%': '#ff4d4f', '100%': '#ff7875' }}
                        trailColor="rgba(0,0,0,0.04)"
                        size="small"
                      />
                    </div>
                  )}
                </div>
              </Col>
            </Row>

            {/* Footer stats */}
            <div style={{
              marginTop: 16, padding: '12px 16px', borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(22,119,255,0.04) 0%, rgba(114,46,209,0.03) 100%)',
              border: '1px solid rgba(22,119,255,0.06)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
              fontSize: 12,
            }}>
              <span style={{ color: 'var(--text-3)' }}>
                {'标签总数'} <b style={{ color: 'var(--text-1)' }}>{prod?.total_labels?.toLocaleString() || 0}</b>
              </span>
              <span style={{ color: 'var(--text-3)' }}>
                {'日均产量'} <b style={{ color: 'var(--text-1)' }}>{prod?.daily_avg || 0}</b>
              </span>
              {rank && (
                <span style={{ color: 'var(--text-3)' }}>
                  {'\u6392\u540d'} <b style={{ color: rankPct >= 80 ? '#00b96b' : rankPct >= 50 ? '#fa8c16' : '#ff4d4f' }}>{'\u524d'} {100 - rankPct}%</b>
                </span>
              )}
              {w?.alipay_account && (
                <span style={{ color: 'var(--text-3)' }}>
                  <AlipayOutlined style={{ color: '#1677ff', marginRight: 3 }} />{w.alipay_account}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
