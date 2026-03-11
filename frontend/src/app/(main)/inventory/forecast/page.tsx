'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Button, Table, Tag, Row, Col, Space, Spin, message,
  Tooltip, Empty, Modal, Progress,
} from 'antd';
import {
  InboxOutlined, ReloadOutlined, RobotOutlined,
  WarningOutlined, CheckCircleOutlined, FireOutlined,
  ClockCircleOutlined, DollarOutlined, BarChartOutlined,
  RiseOutlined, FallOutlined, MinusOutlined,
  ThunderboltOutlined, ExclamationCircleOutlined,
  ShoppingCartOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dayjs from 'dayjs';

interface ForecastItem {
  box_id: number; box_type: string; stock: number; threshold: number; price: number;
  daily_rate_7d: number; daily_rate_14d: number; daily_rate_30d: number;
  days_until_empty: number; days_until_threshold: number;
  trend: string; urgency: string;
  suggested_order: number; suggested_cost: number;
}
interface TrendItem { date: string; count: number }
interface ForecastData {
  items: ForecastItem[];
  trend: TrendItem[];
  summary: {
    total_types: number; total_stock: number; total_daily_rate: number;
    critical: number; warning: number; estimated_days: number;
    total_suggested_cost: number;
  };
}

const URGENCY: Record<string, { color: string; label: string; icon: React.ReactNode; tagColor: string }> = {
  critical: { color: '#ff4d4f', label: '紧急', icon: <FireOutlined />, tagColor: 'red' },
  warning: { color: '#faad14', label: '警告', icon: <WarningOutlined />, tagColor: 'orange' },
  attention: { color: '#1677ff', label: '关注', icon: <ClockCircleOutlined />, tagColor: 'blue' },
  safe: { color: '#52c41a', label: '安全', icon: <CheckCircleOutlined />, tagColor: 'green' },
};

const TREND_ICON: Record<string, React.ReactNode> = {
  increasing: <RiseOutlined style={{ color: '#ff4d4f' }} />,
  decreasing: <FallOutlined style={{ color: '#52c41a' }} />,
  stable: <MinusOutlined style={{ color: '#1677ff' }} />,
};

export default function ForecastPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ForecastData | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/inventory/forecast');
      setData(res.data?.data || null);
    } catch { message.error('获取预测数据失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, []);

  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const openAi = async () => {
    setAiContent(''); setAiModalOpen(true); setAiLoading(true);
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
          try { const p = JSON.parse(d); if (p.content) acc += p.content; else if (p.error) acc += `\n⚠️ ${p.error}`; } catch {}
        }
        setAiContent(acc);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') setAiContent('AI分析暂不可用');
    } finally { setAiLoading(false); abortRef.current = null; }
  };

  const formatContent = (c: string) => c.split(/(\*\*.*?\*\*|`[^`]+`|\n)/g).map((p, i) => {
    if (p === '\n') return <br key={i} />;
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
    return <span key={i}>{p}</span>;
  });

  const s = data?.summary;

  const columns = [
    {
      title: '纸箱类型', dataIndex: 'box_type', width: 160, fixed: 'left' as const,
      render: (v: string, r: ForecastItem) => {
        const u = URGENCY[r.urgency] || URGENCY.safe;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: `${u.color}10`, border: `1px solid ${u.color}20`, color: u.color, fontSize: 16,
            }}><InboxOutlined /></div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{v}</div>
              <div style={{ fontSize: 11, color: 'var(--text-4)' }}>¥{r.price}/个</div>
            </div>
          </div>
        );
      },
    },
    {
      title: '状态', dataIndex: 'urgency', width: 80, align: 'center' as const,
      render: (v: string) => {
        const u = URGENCY[v] || URGENCY.safe;
        return <Tag icon={u.icon} color={u.tagColor} style={{ borderRadius: 8, fontWeight: 700 }}>{u.label}</Tag>;
      },
    },
    {
      title: '当前库存', dataIndex: 'stock', width: 100, align: 'right' as const,
      sorter: (a: ForecastItem, b: ForecastItem) => a.stock - b.stock,
      render: (v: number, r: ForecastItem) => (
        <div>
          <span className="num" style={{ fontWeight: 700, fontSize: 15, color: v <= r.threshold ? '#ff4d4f' : 'var(--text-1)' }}>{v}</span>
          <div style={{ fontSize: 10, color: 'var(--text-4)' }}>阈值 {r.threshold}</div>
        </div>
      ),
    },
    {
      title: '日消耗', key: 'rate', width: 100, align: 'center' as const,
      render: (_: any, r: ForecastItem) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
          <span className="num" style={{ fontWeight: 600 }}>{r.daily_rate_7d}</span>
          <span style={{ fontSize: 11, color: 'var(--text-4)' }}>/天</span>
          {TREND_ICON[r.trend]}
        </div>
      ),
    },
    {
      title: '预计耗尽', dataIndex: 'days_until_empty', width: 100, align: 'center' as const,
      sorter: (a: ForecastItem, b: ForecastItem) => a.days_until_empty - b.days_until_empty,
      render: (v: number) => {
        const color = v <= 3 ? '#ff4d4f' : v <= 7 ? '#faad14' : v <= 14 ? '#1677ff' : '#52c41a';
        return <span className="num" style={{ fontWeight: 800, fontSize: 16, color }}>{v >= 999 ? '∞' : `${v}天`}</span>;
      },
    },
    {
      title: '建议补货', key: 'suggest', width: 120,
      render: (_: any, r: ForecastItem) => r.suggested_order > 0 ? (
        <div>
          <div className="num" style={{ fontWeight: 700, color: '#722ed1' }}>{r.suggested_order} 个</div>
          <div style={{ fontSize: 11, color: '#fa8c16' }}>¥{r.suggested_cost.toFixed(0)}</div>
        </div>
      ) : <span style={{ color: 'var(--text-4)', fontSize: 12 }}>暂不需要</span>,
    },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -30, right: -20, width: 150, height: 150, borderRadius: '50%', background: 'rgba(79,172,254,0.08)' }} />
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ width: 48, height: 48, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(79,172,254,0.2)', fontSize: 24 }}>
              <ThunderboltOutlined />
            </span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>库存智能预测</div>
              <div style={{ fontSize: 13, opacity: 0.75, marginTop: 2 }}>纸箱消耗预测 · 补货建议 · AI分析</div>
            </div>
          </div>
          <Space>
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh}
              style={{ borderRadius: 10, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff' }} />
            <Button icon={<RobotOutlined />} onClick={openAi}
              style={{ borderRadius: 10, background: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none', color: '#fff', fontWeight: 600 }}>
              AI补货建议
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
          {/* Stats */}
          <Row gutter={[10, 10]} style={{ marginBottom: 20 }}>
            {[
              { label: '纸箱品类', value: s?.total_types ?? 0, color: '#4facfe', icon: <InboxOutlined />, suffix: '种' },
              { label: '总库存', value: s?.total_stock ?? 0, color: '#43e97b', icon: <BarChartOutlined />, suffix: '个' },
              { label: '日消耗', value: s?.total_daily_rate ?? 0, color: '#fa8c16', icon: <RiseOutlined />, suffix: '个/天' },
              { label: '紧急补货', value: s?.critical ?? 0, color: '#ff4d4f', icon: <FireOutlined />, suffix: '种' },
              { label: '预计可用', value: s?.estimated_days && s.estimated_days < 999 ? s.estimated_days : '∞', color: '#722ed1', icon: <ClockCircleOutlined />, suffix: '天' },
              { label: '建议补货成本', value: `¥${(s?.total_suggested_cost ?? 0).toFixed(0)}`, color: '#667eea', icon: <DollarOutlined />, suffix: '' },
            ].map((c, i) => (
              <Col xs={12} sm={8} md={4} key={i}>
                <div style={{
                  padding: '14px 16px', borderRadius: 12, background: `${c.color}08`, border: `1px solid ${c.color}15`,
                  animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.05}s`,
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                    <span style={{ color: c.color }}>{c.icon}</span> {c.label}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span className="num" style={{ fontSize: 20, fontWeight: 700, color: c.color }}>{c.value}</span>
                    {c.suffix && <span style={{ fontSize: 10, color: 'var(--text-4)' }}>{c.suffix}</span>}
                  </div>
                </div>
              </Col>
            ))}
          </Row>

          {/* Trend */}
          <div className="panel" style={{ marginBottom: 20, padding: '16px 20px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <BarChartOutlined style={{ color: '#4facfe' }} /> 近14天标签消耗趋势
            </div>
            <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 80 }}>
              {data.trend.map((t, i) => {
                const max = Math.max(...data.trend.map(x => x.count), 1);
                return (
                  <Tooltip key={i} title={`${t.date}: ${t.count}`}>
                    <div style={{
                      flex: 1, borderRadius: '3px 3px 0 0', minHeight: 2,
                      background: 'linear-gradient(180deg, #4facfe, #00f2fe)',
                      height: `${(t.count / max) * 100}%`, transition: 'height 0.6s ease',
                    }} />
                  </Tooltip>
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: 'var(--text-4)' }}>
              <span>{data.trend[0]?.date ? dayjs(data.trend[0].date).format('MM/DD') : ''}</span>
              <span>{data.trend[data.trend.length - 1]?.date ? dayjs(data.trend[data.trend.length - 1].date).format('MM/DD') : ''}</span>
            </div>
          </div>

          {/* Table */}
          <div className="panel" style={{ overflow: 'hidden' }}>
            <div className="panel-head">
              <span className="panel-title"><InboxOutlined style={{ color: '#0f3460' }} /> 纸箱库存预测 ({data.items.length})</span>
            </div>
            <Table dataSource={data.items} columns={columns} rowKey="box_id" size="small"
              scroll={{ x: 'max-content' }} pagination={false} locale={{ emptyText: '暂无纸箱数据' }} />
          </div>
        </>
      )}

      {/* AI Modal */}
      <Modal
        title={<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #1a1a2e, #0f3460)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RobotOutlined style={{ color: '#4facfe', fontSize: 14 }} />
          </div>
          <span>AI 补货建议</span>
          {aiLoading && <Spin size="small" />}
        </div>}
        open={aiModalOpen}
        onCancel={() => { setAiModalOpen(false); if (abortRef.current) abortRef.current.abort(); }}
        footer={null} width={560}
      >
        <div style={{ padding: '12px 0', fontSize: 14, lineHeight: 1.8, minHeight: 100 }}>
          {aiContent ? (
            <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(79,172,254,0.04)', border: '1px solid rgba(79,172,254,0.1)' }}>
              {formatContent(aiContent)}
            </div>
          ) : aiLoading ? (
            <div style={{ textAlign: 'center', padding: 30 }}><Spin size="large" /><div style={{ marginTop: 10, color: 'var(--text-3)' }}>AI正在分析库存数据...</div></div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
