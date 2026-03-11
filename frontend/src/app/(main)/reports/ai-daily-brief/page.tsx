'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  DatePicker, Button, Row, Col, Space, Spin, message, Tag,
  Tooltip, Empty, Avatar,
} from 'antd';
import {
  CalendarOutlined, ReloadOutlined, RobotOutlined,
  PrinterOutlined, ScanOutlined, TeamOutlined,
  ShoppingCartOutlined, AuditOutlined, WarningOutlined,
  RiseOutlined, FallOutlined, MinusOutlined,
  TrophyOutlined, BarChartOutlined, ThunderboltOutlined,
  FileTextOutlined, CrownOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dayjs from 'dayjs';

interface DayStats {
  printed: number; outbound: number; approved: number; pending: number;
  rejected: number; purchases: number; purchase_weight: number;
  purchase_amount: number; assignments: number; failures: number;
  active_workers: number;
}
interface BriefData {
  date: string; yesterday: string; today: DayStats; yesterday_stats: DayStats;
  changes: { printed: number; outbound: number; active_workers: number };
  outbound_rate: number;
  top_workers: { name: string; printed: number; outbound: number }[];
  top_skus: { name: string; printed: number; outbound: number }[];
}

function ChangeTag({ value }: { value: number }) {
  if (value > 0) return <Tag color="green" style={{ borderRadius: 10, fontSize: 11, fontWeight: 600 }}><RiseOutlined /> +{value}%</Tag>;
  if (value < 0) return <Tag color="red" style={{ borderRadius: 10, fontSize: 11, fontWeight: 600 }}><FallOutlined /> {value}%</Tag>;
  return <Tag style={{ borderRadius: 10, fontSize: 11 }}><MinusOutlined /> 持平</Tag>;
}

export default function AIDailyBriefPage() {
  const [selectedDate, setSelectedDate] = useState(dayjs());
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<BriefData | null>(null);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/reports/daily-brief', { params: { target_date: selectedDate.format('YYYY-MM-DD') } });
      setData(res.data?.data || null);
    } catch { message.error('获取日报数据失败'); }
    finally { setLoading(false); }
  }, [selectedDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const generateAiReport = async () => {
    setAiContent(''); setAiLoading(true);
    try {
      abortRef.current = new AbortController();
      const res = await fetch(`/api/reports/daily-brief-ai?target_date=${selectedDate.format('YYYY-MM-DD')}`, {
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
          try { const p = JSON.parse(d); if (p.content) acc += p.content; else if (p.error) acc += `\n⚠️ ${p.error}`; } catch {}
        }
        setAiContent(acc);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') setAiContent('AI日报生成失败，请稍后重试。');
    } finally { setAiLoading(false); abortRef.current = null; }
  };

  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const formatContent = (content: string) => {
    return content.split(/(\*\*.*?\*\*|`[^`]+`|\n)/g).map((part, i) => {
      if (part === '\n') return <br key={i} />;
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('`') && part.endsWith('`'))
        return <code key={i} style={{ background: 'rgba(22,119,255,0.08)', padding: '1px 6px', borderRadius: 4, color: 'var(--brand)' }}>{part.slice(1, -1)}</code>;
      return <span key={i}>{part}</span>;
    });
  };

  const t = data?.today;
  const WORKER_COLORS = ['#ffd700', '#c0c0c0', '#cd7f32', '#1677ff', '#722ed1'];

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #0f2027 0%, #203a43 40%, #2c5364 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -30, right: -20, width: 150, height: 150, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{
              width: 48, height: 48, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(10px)', fontSize: 24,
            }}><FileTextOutlined /></span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>AI 运营日报</div>
              <div style={{ fontSize: 13, opacity: 0.75, marginTop: 2 }}>
                {data ? `${data.date} 运营数据总览` : '每日运营数据 · AI智能分析'}
              </div>
            </div>
          </div>
          <Space>
            <DatePicker value={selectedDate} onChange={v => v && setSelectedDate(v)}
              allowClear={false} style={{ borderRadius: 10 }} />
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh}
              style={{ borderRadius: 10, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff' }} />
            <Button icon={<RobotOutlined />} onClick={generateAiReport} loading={aiLoading}
              style={{ borderRadius: 10, background: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none', color: '#fff', fontWeight: 600 }}>
              生成AI日报
            </Button>
          </Space>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>
      ) : !data ? (
        <div className="panel" style={{ padding: 60, textAlign: 'center' }}><Empty /></div>
      ) : (
        <>
          {/* KPI Cards */}
          <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
            {[
              { label: '打印标签', value: t?.printed ?? 0, icon: <PrinterOutlined />, color: '#4facfe', change: data.changes.printed },
              { label: '出库标签', value: t?.outbound ?? 0, icon: <ScanOutlined />, color: '#43e97b', change: data.changes.outbound },
              { label: '出库率', value: `${data.outbound_rate}%`, icon: <ThunderboltOutlined />, color: data.outbound_rate >= 70 ? '#43e97b' : '#faad14' },
              { label: '活跃工人', value: t?.active_workers ?? 0, icon: <TeamOutlined />, color: '#667eea', change: data.changes.active_workers, suffix: '人' },
              { label: '审核通过', value: t?.approved ?? 0, icon: <AuditOutlined />, color: '#52c41a' },
              { label: '待审核', value: t?.pending ?? 0, icon: <WarningOutlined />, color: (t?.pending ?? 0) > 10 ? '#ff4d4f' : '#faad14' },
              { label: '采购入库', value: t?.purchases ?? 0, icon: <ShoppingCartOutlined />, color: '#fa8c16', suffix: '笔' },
              { label: '扫码失败', value: t?.failures ?? 0, icon: <WarningOutlined />, color: (t?.failures ?? 0) > 0 ? '#ff4d4f' : '#52c41a' },
            ].map((c, i) => (
              <Col xs={12} sm={6} md={3} key={i}>
                <div style={{
                  padding: '14px 16px', borderRadius: 12,
                  background: `${c.color}08`, border: `1px solid ${c.color}15`,
                  animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.04}s`,
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                    <span style={{ color: c.color }}>{c.icon}</span> {c.label}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span className="num" style={{ fontSize: 22, fontWeight: 700, color: c.color }}>{c.value}</span>
                    {c.suffix && <span style={{ fontSize: 11, color: 'var(--text-4)' }}>{c.suffix}</span>}
                  </div>
                  {c.change !== undefined && <div style={{ marginTop: 4 }}><ChangeTag value={c.change} /></div>}
                </div>
              </Col>
            ))}
          </Row>

          {/* Yesterday Comparison */}
          <div className="panel" style={{ marginBottom: 20, padding: '16px 20px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
              <CalendarOutlined style={{ color: '#667eea' }} /> 昨日对比 ({data.yesterday})
            </div>
            <Row gutter={[16, 8]}>
              {[
                { label: '打印', today: t?.printed, yesterday: data.yesterday_stats.printed },
                { label: '出库', today: t?.outbound, yesterday: data.yesterday_stats.outbound },
                { label: '审核通过', today: t?.approved, yesterday: data.yesterday_stats.approved },
                { label: '工人数', today: t?.active_workers, yesterday: data.yesterday_stats.active_workers },
              ].map((c, i) => (
                <Col xs={12} sm={6} key={i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border-2)' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{c.label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="num" style={{ fontWeight: 700, fontSize: 14 }}>{c.today ?? 0}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-4)' }}>vs {c.yesterday ?? 0}</span>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>
          </div>

          {/* Rankings */}
          <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
            <Col xs={24} md={12}>
              <div className="panel" style={{ padding: '16px 20px' }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <TrophyOutlined style={{ color: '#ffd700' }} /> 工人出库排行
                </div>
                {data.top_workers.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="今日暂无数据" />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {data.top_workers.map((w, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px',
                        borderRadius: 10, background: i === 0 ? 'rgba(255,215,0,0.06)' : 'transparent',
                        border: i === 0 ? '1px solid rgba(255,215,0,0.15)' : '1px solid transparent',
                      }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: WORKER_COLORS[i], color: '#fff', fontSize: 12, fontWeight: 700,
                        }}>
                          {i < 3 ? <CrownOutlined /> : i + 1}
                        </div>
                        <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{w.name}</span>
                        <div style={{ textAlign: 'right' }}>
                          <div className="num" style={{ fontWeight: 700, color: '#43e97b' }}>{w.outbound}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-4)' }}>打印 {w.printed}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Col>
            <Col xs={24} md={12}>
              <div className="panel" style={{ padding: '16px 20px' }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <BarChartOutlined style={{ color: '#722ed1' }} /> SKU产量排行
                </div>
                {data.top_skus.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="今日暂无数据" />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {data.top_skus.map((s, i) => {
                      const maxPrinted = Math.max(...data.top_skus.map(x => x.printed), 1);
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0' }}>
                          <span style={{ width: 20, textAlign: 'center', fontSize: 12, fontWeight: 600, color: 'var(--text-3)' }}>{i + 1}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{s.name}</div>
                            <div style={{ height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.04)', overflow: 'hidden' }}>
                              <div style={{
                                height: '100%', borderRadius: 3, transition: 'width 0.8s ease',
                                background: 'linear-gradient(90deg, #722ed1, #b37feb)',
                                width: `${(s.printed / maxPrinted) * 100}%`,
                              }} />
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', minWidth: 60 }}>
                            <span className="num" style={{ fontWeight: 700, fontSize: 14 }}>{s.printed}</span>
                            <div style={{ fontSize: 10, color: 'var(--text-4)' }}>出库 {s.outbound}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </Col>
          </Row>

          {/* AI Report */}
          <div className="panel" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 8,
                  background: 'linear-gradient(135deg, #667eea, #764ba2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
                </div>
                AI 运营简报
              </div>
              {!aiContent && !aiLoading && (
                <Button size="small" type="primary" icon={<ThunderboltOutlined />} onClick={generateAiReport}
                  style={{ borderRadius: 8, background: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none' }}>
                  一键生成
                </Button>
              )}
            </div>
            {aiLoading ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <Spin size="large" />
                <div style={{ marginTop: 12, color: 'var(--text-3)', fontSize: 13 }}>AI 正在分析运营数据，生成日报...</div>
              </div>
            ) : aiContent ? (
              <div style={{
                padding: '16px 20px', borderRadius: 12, fontSize: 14, lineHeight: 1.8,
                background: 'linear-gradient(135deg, rgba(102,126,234,0.03), rgba(118,75,162,0.03))',
                border: '1px solid rgba(102,126,234,0.08)',
              }}>
                {formatContent(aiContent)}
              </div>
            ) : (
              <div style={{
                textAlign: 'center', padding: '30px 20px', color: 'var(--text-4)',
                background: 'rgba(0,0,0,0.01)', borderRadius: 12, border: '1px dashed var(--border-2)',
              }}>
                <RobotOutlined style={{ fontSize: 32, marginBottom: 8, opacity: 0.3 }} />
                <div style={{ fontSize: 13 }}>点击「生成AI日报」按钮，AI将自动分析今日运营数据</div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
