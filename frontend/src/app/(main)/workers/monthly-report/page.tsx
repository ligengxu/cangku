'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  DatePicker, Button, Row, Col, Space, Spin, message,
  Tag, Empty, Avatar, Progress,
} from 'antd';
import {
  CalendarOutlined, ReloadOutlined, RobotOutlined,
  DollarOutlined, PrinterOutlined, ScanOutlined,
  TrophyOutlined, RiseOutlined, FallOutlined,
  BarChartOutlined, ThunderboltOutlined, CrownOutlined,
  CheckCircleOutlined, StarOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import { useAuth } from '@/stores/useAuth';
import dayjs from 'dayjs';

interface SkuItem {
  sku_id: number; sku_name: string; fruit_name: string;
  performance: number; printed: number; outbound: number; commission: number;
}

interface CommissionData {
  start_date: string; end_date: string;
  summary: { total_commission: number; total_outbound: number; total_printed: number; worker_count: number };
  workers: {
    worker_id: number; worker_name: string;
    total_printed: number; total_outbound: number; total_commission: number;
    sku_details: SkuItem[];
  }[];
}

export default function MonthlyReportPage() {
  const { user } = useAuth();
  const [month, setMonth] = useState(dayjs());
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CommissionData | null>(null);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const myData = data?.workers?.[0];

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const start = month.startOf('month').format('YYYY-MM-DD');
      const end = month.isSame(dayjs(), 'month') ? dayjs().format('YYYY-MM-DD') : month.endOf('month').format('YYYY-MM-DD');
      const res = await api.get('/workers/commission', { params: { start_date: start, end_date: end } });
      setData(res.data?.data || null);
    } catch { message.error('获取数据失败'); }
    finally { setLoading(false); }
  }, [month]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const generateAiReport = async () => {
    setAiContent(''); setAiLoading(true);
    try {
      abortRef.current = new AbortController();
      const wid = user?.role === 'admin' && myData ? `?worker_id=${myData.worker_id}` : '';
      const res = await fetch(`/api/ai/performance-insight${wid}`, {
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
      if (e.name !== 'AbortError') setAiContent('AI报告暂不可用');
    } finally { setAiLoading(false); abortRef.current = null; }
  };

  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const formatContent = (c: string) => c.split(/(\*\*.*?\*\*|`[^`]+`|\n)/g).map((p, i) => {
    if (p === '\n') return <br key={i} />;
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i} style={{ color: '#722ed1' }}>{p.slice(2, -2)}</strong>;
    return <span key={i}>{p}</span>;
  });

  const outboundRate = myData ? (myData.total_printed > 0 ? Math.round(myData.total_outbound / myData.total_printed * 100) : 0) : 0;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -30, right: -20, width: 150, height: 150, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ width: 48, height: 48, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.2)', fontSize: 24 }}>
              <StarOutlined />
            </span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>月度绩效报告</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
                {myData ? `${myData.worker_name} · ${data?.start_date} ~ ${data?.end_date}` : '查看您的月度绩效数据'}
              </div>
            </div>
          </div>
          <Space>
            <DatePicker.MonthPicker value={month} onChange={v => v && setMonth(v)} allowClear={false} style={{ borderRadius: 10 }} />
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh}
              style={{ borderRadius: 10, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff' }} />
          </Space>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>
      ) : !myData ? (
        <div className="panel" style={{ padding: 60, textAlign: 'center' }}><Empty description="本月暂无绩效数据" /></div>
      ) : (
        <>
          {/* KPI Cards */}
          <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
            {[
              { label: '本月佣金', value: `¥${myData.total_commission.toFixed(2)}`, color: '#722ed1', icon: <DollarOutlined /> },
              { label: '出库标签', value: myData.total_outbound, color: '#52c41a', icon: <ScanOutlined />, suffix: '个' },
              { label: '打印标签', value: myData.total_printed, color: '#1677ff', icon: <PrinterOutlined />, suffix: '个' },
              { label: '出库率', value: `${outboundRate}%`, color: outboundRate >= 80 ? '#52c41a' : '#faad14', icon: <ThunderboltOutlined /> },
            ].map((c, i) => (
              <Col xs={12} sm={6} key={i}>
                <div style={{
                  padding: '18px 16px', borderRadius: 14,
                  background: `${c.color}08`, border: `1px solid ${c.color}15`,
                  textAlign: 'center',
                  animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.06}s`,
                }}>
                  <div style={{ fontSize: 24, color: c.color, marginBottom: 6 }}>{c.icon}</div>
                  <div className="num" style={{ fontSize: 24, fontWeight: 800, color: c.color }}>{c.value}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{c.label}</div>
                </div>
              </Col>
            ))}
          </Row>

          {/* Outbound Rate Gauge */}
          <div className="panel" style={{ marginBottom: 20, padding: '24px', textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>
              <ThunderboltOutlined style={{ color: '#722ed1', marginRight: 6 }} />出库率仪表盘
            </div>
            <Progress
              type="dashboard"
              percent={outboundRate}
              strokeColor={outboundRate >= 80 ? '#52c41a' : outboundRate >= 50 ? '#faad14' : '#ff4d4f'}
              format={() => (
                <div>
                  <div style={{ fontSize: 36, fontWeight: 800, color: outboundRate >= 80 ? '#52c41a' : '#faad14' }}>{outboundRate}%</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{outboundRate >= 80 ? '优秀' : outboundRate >= 60 ? '良好' : '需提升'}</div>
                </div>
              )}
              size={180}
              strokeWidth={10}
            />
          </div>

          {/* SKU Details */}
          <div className="panel" style={{ marginBottom: 20 }}>
            <div className="panel-head">
              <span className="panel-title"><BarChartOutlined style={{ color: '#722ed1' }} /> SKU明细</span>
              <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{myData.sku_details.length} 个SKU</span>
            </div>
            <div style={{ padding: '12px 16px' }}>
              {myData.sku_details.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无SKU数据" />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {myData.sku_details.map((sku, i) => {
                    const maxComm = Math.max(...myData.sku_details.map(s => s.commission), 0.01);
                    return (
                      <div key={sku.sku_id} style={{
                        padding: '12px 16px', borderRadius: 10,
                        background: i === 0 ? 'rgba(114,46,209,0.04)' : 'transparent',
                        border: i === 0 ? '1px solid rgba(114,46,209,0.1)' : '1px solid transparent',
                        display: 'flex', alignItems: 'center', gap: 14,
                      }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: i === 0 ? 'linear-gradient(135deg, #667eea, #764ba2)' : `hsl(${i * 60},55%,92%)`,
                          color: i === 0 ? '#fff' : `hsl(${i * 60},55%,45%)`, fontSize: 12, fontWeight: 700,
                        }}>{i + 1}</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{sku.sku_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-4)' }}>
                            {sku.fruit_name} · 绩效 {sku.performance}
                          </div>
                          <div style={{ marginTop: 4, height: 4, borderRadius: 2, background: 'rgba(0,0,0,0.04)', overflow: 'hidden' }}>
                            <div style={{
                              height: '100%', borderRadius: 2,
                              background: 'linear-gradient(90deg, #667eea, #764ba2)',
                              width: `${(sku.commission / maxComm) * 100}%`,
                              transition: 'width 0.8s ease',
                            }} />
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div className="num" style={{ fontWeight: 800, color: '#722ed1', fontSize: 15 }}>¥{sku.commission.toFixed(2)}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-4)' }}>出库{sku.outbound} / 打印{sku.printed}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* AI Report */}
          <div className="panel" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #667eea, #764ba2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
                </div>
                AI 绩效分析
              </div>
              {!aiContent && !aiLoading && (
                <Button size="small" type="primary" icon={<ThunderboltOutlined />} onClick={generateAiReport}
                  style={{ borderRadius: 8, background: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none' }}>
                  生成报告
                </Button>
              )}
            </div>
            {aiLoading ? (
              <div style={{ textAlign: 'center', padding: 30 }}>
                <Spin size="large" />
                <div style={{ marginTop: 10, color: 'var(--text-3)' }}>AI正在分析您的绩效数据...</div>
              </div>
            ) : aiContent ? (
              <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(102,126,234,0.04)', border: '1px solid rgba(102,126,234,0.1)', lineHeight: 1.8 }}>
                {formatContent(aiContent)}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-4)', background: 'rgba(0,0,0,0.01)', borderRadius: 12, border: '1px dashed var(--border-2)' }}>
                <RobotOutlined style={{ fontSize: 28, marginBottom: 6, opacity: 0.3 }} />
                <div style={{ fontSize: 13 }}>点击「生成报告」获取AI绩效分析</div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
