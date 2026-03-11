'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Button, Table, Tag, Row, Col, Space, Spin, message,
  Tooltip, Empty, Modal, Progress,
} from 'antd';
import {
  ShoppingCartOutlined, ReloadOutlined, RobotOutlined,
  ThunderboltOutlined, WarningOutlined, CheckCircleOutlined,
  ClockCircleOutlined, DollarOutlined, BarChartOutlined,
  RiseOutlined, FallOutlined, FireOutlined,
  ExclamationCircleOutlined, CalendarOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dayjs from 'dayjs';

interface FruitSuggest {
  fruit_id: number; fruit_name: string; purchase_count: number;
  total_weight: number; total_cost: number; avg_price: number;
  last_purchase: string | null; days_since_last: number;
  monthly_labels: number; monthly_outbound: number;
  daily_consumption: number; urgency: string;
  recent_prices: { price: number; date: string }[];
}

interface SupplierItem { name: string; count: number; avg_price: number; total_weight: number }

interface SuggestData {
  fruits: FruitSuggest[];
  suppliers: SupplierItem[];
  summary: { total_fruits: number; high_urgency: number; medium_urgency: number; total_suppliers: number };
}

const URGENCY_CONFIG: Record<string, { color: string; label: string; icon: React.ReactNode }> = {
  high: { color: '#ff4d4f', label: '紧急', icon: <FireOutlined /> },
  medium: { color: '#faad14', label: '建议', icon: <WarningOutlined /> },
  low: { color: '#52c41a', label: '充足', icon: <CheckCircleOutlined /> },
};

const FRUIT_ICONS: Record<string, string> = {
  '苹果': '🍎', '梨': '🍐', '橙': '🍊', '柠檬': '🍋', '桃': '🍑',
  '樱桃': '🍒', '葡萄': '🍇', '西瓜': '🍉', '芒果': '🥭', '猕猴桃': '🥝',
  '香蕉': '🍌', '菠萝': '🍍', '草莓': '🍓', '蓝莓': '🫐',
};
function getFruitIcon(name: string): string {
  for (const [k, v] of Object.entries(FRUIT_ICONS)) if (name.includes(k)) return v;
  return '🍎';
}

export default function AISuggestPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SuggestData | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/orders/purchase-intelligence');
      setData(res.data?.data || null);
    } catch { message.error('获取数据失败'); }
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
      const res = await fetch('/api/orders/purchase-ai-suggest', {
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
      if (e.name !== 'AbortError') setAiContent('AI建议暂不可用');
    } finally { setAiLoading(false); abortRef.current = null; }
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

  const s = data?.summary;

  const columns = [
    {
      title: '水果', key: 'fruit', width: 160, fixed: 'left' as const,
      render: (_: any, r: FruitSuggest) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 28 }}>{getFruitIcon(r.fruit_name)}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{r.fruit_name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-4)' }}>
              {r.last_purchase ? `上次: ${dayjs(r.last_purchase).format('MM-DD')}` : '从未采购'}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: '采购紧急度', dataIndex: 'urgency', width: 100, align: 'center' as const,
      sorter: (a: FruitSuggest, b: FruitSuggest) => ({ high: 0, medium: 1, low: 2 }[a.urgency] ?? 3) - ({ high: 0, medium: 1, low: 2 }[b.urgency] ?? 3),
      render: (v: string) => {
        const cfg = URGENCY_CONFIG[v] || URGENCY_CONFIG.low;
        return <Tag icon={cfg.icon} color={v === 'high' ? 'red' : v === 'medium' ? 'orange' : 'green'}
          style={{ borderRadius: 8, fontWeight: 700, fontSize: 12, padding: '2px 12px' }}>{cfg.label}</Tag>;
      },
    },
    {
      title: '距上次采购', dataIndex: 'days_since_last', width: 100, align: 'center' as const,
      sorter: (a: FruitSuggest, b: FruitSuggest) => a.days_since_last - b.days_since_last,
      render: (v: number) => (
        <span style={{ fontWeight: 600, color: v > 14 ? '#ff4d4f' : v > 7 ? '#faad14' : 'var(--text-2)' }}>
          {v >= 999 ? '从未' : `${v}天`}
        </span>
      ),
    },
    {
      title: '月消耗', key: 'consumption', width: 110,
      render: (_: any, r: FruitSuggest) => (
        <div style={{ fontSize: 12 }}>
          <div>出库: <span className="num" style={{ fontWeight: 700, color: '#43e97b' }}>{r.monthly_outbound}</span></div>
          <div style={{ color: 'var(--text-4)' }}>日均: {r.daily_consumption}</div>
        </div>
      ),
    },
    {
      title: '近期均价', dataIndex: 'avg_price', width: 90, align: 'right' as const,
      sorter: (a: FruitSuggest, b: FruitSuggest) => a.avg_price - b.avg_price,
      render: (v: number) => v > 0 ? <span style={{ fontWeight: 600, color: '#fa8c16' }}>¥{v.toFixed(2)}/kg</span> : <span style={{ color: 'var(--text-4)' }}>-</span>,
    },
    {
      title: '近期采购', key: 'recent', width: 100,
      render: (_: any, r: FruitSuggest) => (
        <div style={{ fontSize: 12 }}>
          <div>{r.purchase_count}笔</div>
          <div style={{ color: 'var(--text-4)' }}>{r.total_weight}kg</div>
        </div>
      ),
    },
    {
      title: '价格趋势', key: 'trend', width: 120,
      render: (_: any, r: FruitSuggest) => {
        if (!r.recent_prices.length) return <span style={{ color: 'var(--text-4)', fontSize: 12 }}>无数据</span>;
        const prices = r.recent_prices.map(p => p.price);
        const max = Math.max(...prices, 0.01);
        const min = Math.min(...prices);
        const trend = prices.length >= 2 ? (prices[0] > prices[prices.length - 1] ? 'up' : prices[0] < prices[prices.length - 1] ? 'down' : 'flat') : 'flat';
        return (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 30 }}>
            {prices.reverse().map((p, i) => (
              <Tooltip key={i} title={`¥${p}`}>
                <div style={{
                  width: 14, borderRadius: '3px 3px 0 0',
                  background: trend === 'up' ? 'linear-gradient(180deg, #ff4d4f, #ff7875)' : trend === 'down' ? 'linear-gradient(180deg, #52c41a, #95de64)' : 'linear-gradient(180deg, #1677ff, #69b1ff)',
                  height: `${Math.max(((p - min) / (max - min || 1)) * 100, 15)}%`,
                  transition: 'height 0.5s ease',
                }} />
              </Tooltip>
            ))}
          </div>
        );
      },
    },
  ];

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -30, right: -20, width: 150, height: 150, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{
              width: 48, height: 48, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(10px)', fontSize: 24,
            }}><ShoppingCartOutlined /></span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>AI 采购建议</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>基于历史数据和消耗速度的智能采购推荐</div>
            </div>
          </div>
          <Space>
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh}
              style={{ borderRadius: 10, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff' }} />
            <Button icon={<RobotOutlined />} onClick={openAi}
              style={{ borderRadius: 10, background: 'rgba(255,255,255,0.25)', border: 'none', color: '#fff', fontWeight: 600 }}>
              AI采购建议
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
          {/* Summary Cards */}
          <Row gutter={[10, 10]} style={{ marginBottom: 20 }}>
            {[
              { label: '水果品类', value: s?.total_fruits ?? 0, color: '#11998e', icon: <BarChartOutlined />, suffix: '种' },
              { label: '紧急采购', value: s?.high_urgency ?? 0, color: '#ff4d4f', icon: <FireOutlined />, suffix: '种' },
              { label: '建议采购', value: s?.medium_urgency ?? 0, color: '#faad14', icon: <WarningOutlined />, suffix: '种' },
              { label: '合作供应商', value: s?.total_suppliers ?? 0, color: '#722ed1', icon: <ShoppingCartOutlined />, suffix: '家' },
            ].map((c, i) => (
              <Col xs={12} sm={6} key={i}>
                <div style={{
                  padding: '16px 18px', borderRadius: 12,
                  background: `${c.color}08`, border: `1px solid ${c.color}15`,
                  animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.06}s`,
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                    <span style={{ color: c.color }}>{c.icon}</span> {c.label}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span className="num" style={{ fontSize: 24, fontWeight: 700, color: c.color }}>{c.value}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-4)' }}>{c.suffix}</span>
                  </div>
                </div>
              </Col>
            ))}
          </Row>

          {/* Fruit Table */}
          <div className="panel" style={{ marginBottom: 20, overflow: 'hidden' }}>
            <div className="panel-head">
              <span className="panel-title"><ThunderboltOutlined style={{ color: '#11998e' }} /> 水果采购分析</span>
            </div>
            <Table
              dataSource={data.fruits}
              columns={columns}
              rowKey="fruit_id"
              size="small"
              scroll={{ x: 'max-content' }}
              pagination={data.fruits.length > 15 ? { pageSize: 15 } : false}
              locale={{ emptyText: '暂无水果数据' }}
            />
          </div>

          {/* Suppliers */}
          {data.suppliers.length > 0 && (
            <div className="panel">
              <div className="panel-head">
                <span className="panel-title"><ShoppingCartOutlined style={{ color: '#722ed1' }} /> 供应商概况</span>
              </div>
              <div style={{ padding: '12px 20px', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {data.suppliers.map((sp, i) => (
                  <div key={i} style={{
                    padding: '10px 16px', borderRadius: 10,
                    background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
                    minWidth: 160, flex: '1 1 160px',
                  }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{sp.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', gap: 12 }}>
                      <span>{sp.count}笔</span>
                      <span>均价 ¥{sp.avg_price}</span>
                      <span>{sp.total_weight}kg</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* AI Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: 'linear-gradient(135deg, #11998e, #38ef7d)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <RobotOutlined style={{ color: '#fff', fontSize: 16 }} />
            </div>
            <span>AI 采购建议</span>
            {aiLoading && <Spin size="small" />}
          </div>
        }
        open={aiModalOpen}
        onCancel={() => { setAiModalOpen(false); if (abortRef.current) abortRef.current.abort(); }}
        footer={null} width={620}
      >
        <div style={{ padding: '16px 0', fontSize: 14, lineHeight: 1.8, minHeight: 120 }}>
          {aiContent ? (
            <div style={{
              padding: '16px 20px', borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(17,153,142,0.04), rgba(56,239,125,0.04))',
              border: '1px solid rgba(17,153,142,0.1)',
            }}>
              {formatContent(aiContent)}
            </div>
          ) : aiLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin size="large" />
              <div style={{ marginTop: 12, color: 'var(--text-3)' }}>AI 正在分析采购数据...</div>
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
