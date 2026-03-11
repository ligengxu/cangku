'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Select, Button, Table, Tag, Tooltip, Row, Col,
  Empty, Spin, message, Space, Progress, Avatar, Segmented, Modal,
} from 'antd';
import {
  TrophyOutlined, SearchOutlined, ReloadOutlined,
  DownloadOutlined, CrownOutlined, StarOutlined,
  PhoneOutlined, UserOutlined, RiseOutlined,
  FallOutlined, DashOutlined, SafetyCertificateOutlined,
  FundOutlined, ThunderboltOutlined, DollarOutlined,
  CheckCircleOutlined, RobotOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dynamic from 'next/dynamic';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

interface ScoreBreakdown { volume: number; stability: number; quality: number; payment: number }
interface SupplierPerf {
  id: number; name: string; type: string; contact_person: string; phone: string;
  order_count: number; total_weight: number; total_cost: number; avg_price: number;
  price_variance: number; paid_rate: number; avg_utilization: number; avg_weight_diff: number;
  score: number; grade: string; trend: string; score_breakdown: ScoreBreakdown;
}
interface GradeDist { S: number; A: number; B: number; C: number; D: number; 'N/A': number }
interface PerfData {
  suppliers: SupplierPerf[];
  summary: { total_suppliers: number; avg_score: number; grade_distribution: GradeDist; days: number; date_range: { start: string; end: string } };
}

const GRADE_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  S: { color: '#f5222d', bg: 'linear-gradient(135deg, #ff4d4f, #ff7875)', label: '卓越' },
  A: { color: '#fa8c16', bg: 'linear-gradient(135deg, #fa8c16, #ffc53d)', label: '优秀' },
  B: { color: '#1677ff', bg: 'linear-gradient(135deg, #1677ff, #69b1ff)', label: '良好' },
  C: { color: '#8c8c8c', bg: 'linear-gradient(135deg, #8c8c8c, #bfbfbf)', label: '一般' },
  D: { color: '#595959', bg: 'linear-gradient(135deg, #595959, #8c8c8c)', label: '较差' },
  'N/A': { color: '#d9d9d9', bg: 'linear-gradient(135deg, #d9d9d9, #f0f0f0)', label: '无数据' },
};

const TYPE_LABELS: Record<string, string> = { fruit: '水果', box: '纸箱', material: '材料' };
const TREND_ICONS: Record<string, React.ReactNode> = {
  up: <RiseOutlined style={{ color: '#f5222d' }} />,
  down: <FallOutlined style={{ color: '#00b96b' }} />,
  stable: <DashOutlined style={{ color: '#8c8c8c' }} />,
};

function SupplierRadarChart({ suppliers }: { suppliers: SupplierPerf[] }) {
  const top5 = suppliers.slice(0, 5);
  if (!top5.length) return null;
  const option = {
    tooltip: {},
    legend: { data: top5.map(s => s.name), bottom: 0, textStyle: { fontSize: 11 } },
    radar: {
      indicator: [
        { name: '供货量', max: 100 }, { name: '稳定性', max: 100 },
        { name: '质量', max: 100 }, { name: '付款', max: 100 },
      ],
      radius: '60%',
      splitArea: { areaStyle: { color: ['rgba(22,119,255,0.02)', 'rgba(22,119,255,0.04)'] } },
    },
    series: [{
      type: 'radar',
      data: top5.map((s, i) => ({
        value: [s.score_breakdown.volume, s.score_breakdown.stability, s.score_breakdown.quality, s.score_breakdown.payment],
        name: s.name,
        lineStyle: { width: 2 },
        areaStyle: { opacity: 0.1 },
      })),
    }],
  };
  return <ReactECharts option={option} style={{ height: 300 }} />;
}

export default function SupplierScorePage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PerfData | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [days, setDays] = useState(90);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const openAi = async () => {
    setAiContent(''); setAiOpen(true); setAiLoading(true);
    try {
      abortRef.current = new AbortController();
      const res = await fetch(`/api/reports/supplier-performance-ai?days=${days}`, {
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
      const params: Record<string, string | number> = { days };
      if (typeFilter !== 'all') params.supplier_type = typeFilter;
      const res = await api.get('/reports/supplier-performance', { params });
      setData(res.data?.data || null);
    } catch { message.error('查询失败'); }
    finally { setLoading(false); }
  }, [typeFilter, days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const exportCSV = () => {
    if (!data?.suppliers?.length) { message.warning('暂无数据'); return; }
    const headers = ['供应商,类型,评分,等级,订单数,总金额,均价,付款率,利用率,重量差异,价格趋势'];
    const rows = data.suppliers.map(s =>
      `${s.name},${TYPE_LABELS[s.type] || s.type},${s.score},${s.grade},${s.order_count},${s.total_cost},${s.avg_price},${s.paid_rate}%,${s.avg_utilization}%,${s.avg_weight_diff},${s.trend === 'up' ? '上涨' : s.trend === 'down' ? '下降' : '稳定'}`
    );
    const csv = '\uFEFF' + [...headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = '供应商绩效评分.csv'; a.click();
    URL.revokeObjectURL(url); message.success('导出成功');
  };

  const gd = data?.summary?.grade_distribution;
  const gradeCards = gd ? Object.entries(GRADE_CONFIG).filter(([k]) => k !== 'N/A').map(([grade, cfg]) => ({
    grade, ...cfg, count: (gd as any)[grade] || 0,
  })) : [];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{
        background: 'linear-gradient(135deg, #faad14 0%, #fa8c16 40%, #f5222d 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -40, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'absolute', bottom: -20, left: '40%', width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{
              width: 44, height: 44, borderRadius: 14,
              background: 'rgba(255,255,255,0.2)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 22,
            }}><TrophyOutlined /></span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>供应商绩效评分</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
                多维度评估供应商表现 · 采购量 · 价格稳定 · 质量 · 付款
              </div>
            </div>
          </div>
        </div>
      </div>

      {data && (
        <Row gutter={[10, 10]} style={{ marginBottom: 20 }}>
          <Col xs={12} sm={6}>
            <div style={{
              padding: '16px 18px', borderRadius: 14,
              background: 'linear-gradient(135deg, #722ed1, #b37feb)',
              boxShadow: '0 4px 16px rgba(114,46,209,0.15)',
              animation: 'stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both',
            }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', marginBottom: 3 }}>
                <UserOutlined /> 供应商数
              </div>
              <div className="num" style={{ fontSize: 24, fontWeight: 700, color: '#fff' }}>{data.summary.total_suppliers}</div>
            </div>
          </Col>
          <Col xs={12} sm={6}>
            <div style={{
              padding: '16px 18px', borderRadius: 14,
              background: 'linear-gradient(135deg, #fa8c16, #ffc53d)',
              boxShadow: '0 4px 16px rgba(250,140,22,0.15)',
              animation: 'stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both', animationDelay: '0.06s',
            }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', marginBottom: 3 }}>
                <StarOutlined /> 平均评分
              </div>
              <div className="num" style={{ fontSize: 24, fontWeight: 700, color: '#fff' }}>{data.summary.avg_score}</div>
            </div>
          </Col>
          {gradeCards.slice(0, 2).map((g, i) => (
            <Col xs={12} sm={6} key={g.grade}>
              <div style={{
                padding: '16px 18px', borderRadius: 14, background: g.bg,
                boxShadow: `0 4px 16px ${g.color}25`,
                animation: 'stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both', animationDelay: `${(i + 2) * 0.06}s`,
              }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', marginBottom: 3 }}>
                  <CrownOutlined /> {g.grade}级 · {g.label}
                </div>
                <div className="num" style={{ fontSize: 24, fontWeight: 700, color: '#fff' }}>{g.count}</div>
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
        <div style={{ padding: '14px 20px' }}>
          <Row gutter={[12, 12]} align="middle">
            <Col xs={24} sm={12}>
              <Segmented value={typeFilter} onChange={v => setTypeFilter(v as string)}
                options={[
                  { value: 'all', label: '全部' },
                  { value: 'fruit', label: '水果' },
                  { value: 'box', label: '纸箱' },
                  { value: 'material', label: '材料' },
                ]} style={{ borderRadius: 10 }} />
            </Col>
            <Col xs={24} sm={12}>
              <Select value={days} onChange={v => setDays(v)} style={{ width: '100%', borderRadius: 8 }}
                options={[
                  { value: 30, label: '最近30天' },
                  { value: 60, label: '最近60天' },
                  { value: 90, label: '最近90天' },
                  { value: 180, label: '最近半年' },
                  { value: 365, label: '最近一年' },
                ]} />
            </Col>
          </Row>
        </div>
      </div>

      {data && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-head">
            <span className="panel-title"><SafetyCertificateOutlined style={{ color: '#722ed1' }} /> 等级分布</span>
          </div>
          <div style={{ padding: '16px 20px', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {Object.entries(GRADE_CONFIG).filter(([k]) => k !== 'N/A').map(([grade, cfg], i) => {
              const count = (gd as any)?.[grade] || 0;
              const pct = data.summary.total_suppliers > 0 ? Math.round(count / data.summary.total_suppliers * 100) : 0;
              return (
                <div key={grade} style={{
                  flex: '1 1 80px', padding: '14px 16px', borderRadius: 12, textAlign: 'center',
                  border: `2px solid ${cfg.color}20`, background: `${cfg.color}06`,
                  animation: `stagger-in 0.4s ease both`, animationDelay: `${i * 0.06}s`,
                }}>
                  <div style={{ fontSize: 28, fontWeight: 900, color: cfg.color }}>{grade}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 2 }}>{cfg.label}</div>
                  <div className="num" style={{ fontSize: 20, fontWeight: 700, color: cfg.color, marginTop: 4 }}>{count}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-4)' }}>{pct}%</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : !data?.suppliers?.length ? (
        <div className="panel" style={{ padding: 60, textAlign: 'center' }}>
          <Empty description="暂无供应商数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      ) : (
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title"><TrophyOutlined style={{ color: '#fa8c16' }} /> 供应商排名</span>
            <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{data.suppliers.length} 家</span>
          </div>
          <Table
            dataSource={data.suppliers}
            rowKey="id"
            size="small"
            scroll={{ x: 1000 }}
            pagination={{ pageSize: 15, showTotal: t => `共 ${t} 条`, size: 'small' }}
            locale={{ emptyText: '暂无数据' }}
            columns={[
              {
                title: '排名', key: 'rank', width: 50, align: 'center' as const,
                render: (_: unknown, __: unknown, i: number) => {
                  const colors = ['#ffd700', '#c0c0c0', '#cd7f32'];
                  return i < 3 ? (
                    <span style={{
                      width: 22, height: 22, borderRadius: 6, display: 'inline-flex',
                      alignItems: 'center', justifyContent: 'center', fontSize: 11,
                      fontWeight: 700, color: '#fff', background: colors[i],
                    }}>{i + 1}</span>
                  ) : <span style={{ color: 'var(--text-4)', fontSize: 12 }}>{i + 1}</span>;
                },
              },
              {
                title: '供应商', key: 'info', width: 180,
                render: (_: unknown, r: SupplierPerf) => (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar size={32} style={{
                      background: GRADE_CONFIG[r.grade]?.bg || '#d9d9d9',
                      fontWeight: 700, fontSize: 14,
                    }}>{r.name.charAt(0)}</Avatar>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-4)' }}>
                        <Tag style={{ fontSize: 10, borderRadius: 4, padding: '0 4px' }}>{TYPE_LABELS[r.type] || r.type}</Tag>
                        {r.contact_person && <span style={{ marginLeft: 4 }}>{r.contact_person}</span>}
                      </div>
                    </div>
                  </div>
                ),
              },
              {
                title: '评分', dataIndex: 'score', width: 80, align: 'center' as const,
                defaultSortOrder: 'descend' as const,
                sorter: (a: SupplierPerf, b: SupplierPerf) => a.score - b.score,
                render: (v: number) => <span className="num" style={{ fontWeight: 800, fontSize: 16, color: v >= 70 ? '#00b96b' : v >= 50 ? '#faad14' : '#f5222d' }}>{v}</span>,
              },
              {
                title: '等级', dataIndex: 'grade', width: 70, align: 'center' as const,
                render: (v: string) => {
                  const cfg = GRADE_CONFIG[v] || GRADE_CONFIG['N/A'];
                  return <Tag style={{ borderRadius: 8, fontWeight: 800, fontSize: 14, color: cfg.color, background: `${cfg.color}12`, border: `1px solid ${cfg.color}30` }}>{v}</Tag>;
                },
              },
              {
                title: '评分明细', key: 'breakdown', width: 200,
                render: (_: unknown, r: SupplierPerf) => {
                  const bd = r.score_breakdown;
                  const items = [
                    { label: '量', value: bd.volume, max: 25, color: '#1677ff' },
                    { label: '稳', value: bd.stability, max: 25, color: '#00b96b' },
                    { label: '质', value: bd.quality, max: 25, color: '#722ed1' },
                    { label: '付', value: bd.payment, max: 25, color: '#fa8c16' },
                  ];
                  return (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      {items.map(it => (
                        <Tooltip key={it.label} title={`${it.label === '量' ? '采购量' : it.label === '稳' ? '价格稳定' : it.label === '质' ? '质量' : '付款率'}：${it.value}/${it.max}`}>
                          <div style={{ flex: 1, textAlign: 'center' }}>
                            <div style={{ fontSize: 9, color: 'var(--text-4)' }}>{it.label}</div>
                            <Progress percent={Math.round(it.value / it.max * 100)} size="small"
                              strokeColor={it.color} showInfo={false} style={{ margin: 0 }} />
                          </div>
                        </Tooltip>
                      ))}
                    </div>
                  );
                },
              },
              {
                title: '订单', dataIndex: 'order_count', width: 60, align: 'right' as const,
                sorter: (a: SupplierPerf, b: SupplierPerf) => a.order_count - b.order_count,
                render: (v: number) => <span className="num" style={{ fontWeight: 600 }}>{v}</span>,
              },
              {
                title: '总额', dataIndex: 'total_cost', width: 100, align: 'right' as const,
                sorter: (a: SupplierPerf, b: SupplierPerf) => a.total_cost - b.total_cost,
                render: (v: number) => <span className="num" style={{ fontWeight: 600, color: '#722ed1' }}>¥{v >= 10000 ? `${(v / 10000).toFixed(1)}万` : v.toLocaleString()}</span>,
              },
              {
                title: '付款率', dataIndex: 'paid_rate', width: 80, align: 'center' as const,
                render: (v: number) => (
                  <Tag color={v >= 90 ? 'success' : v >= 60 ? 'warning' : 'error'}
                    style={{ borderRadius: 6, fontWeight: 600 }}>
                    {v}%
                  </Tag>
                ),
              },
              {
                title: '趋势', dataIndex: 'trend', width: 60, align: 'center' as const,
                render: (v: string) => (
                  <Tooltip title={v === 'up' ? '价格上涨' : v === 'down' ? '价格下降' : '价格稳定'}>
                    <span style={{ fontSize: 16 }}>{TREND_ICONS[v] || TREND_ICONS.stable}</span>
                  </Tooltip>
                ),
              },
            ]}
          />
        </div>
      )}

      {/* Radar Chart */}
      {data?.suppliers && data.suppliers.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-head">
            <span className="panel-title"><FundOutlined style={{ color: '#722ed1' }} /> 供应商能力雷达图（TOP5）</span>
          </div>
          <div style={{ padding: '8px 16px' }}>
            <SupplierRadarChart suppliers={data.suppliers} />
          </div>
        </div>
      )}

      <div style={{
        marginTop: 16, padding: '10px 16px', borderRadius: 10,
        background: 'linear-gradient(135deg, rgba(250,140,22,0.04), rgba(245,34,45,0.03))',
        border: '1px solid rgba(250,140,22,0.08)',
        fontSize: 12, color: 'var(--text-4)', lineHeight: 1.8,
      }}>
        <TrophyOutlined style={{ color: '#fa8c16', marginRight: 6 }} />
        评分说明：总分100分 = 采购量(25分) + 价格稳定性(25分) + 质量(25分，基于重量差异) + 付款率(25分)。
        S级(≥85) · A级(≥70) · B级(≥50) · C级(≥30) · D级(&lt;30)。
        评分范围：最近{data?.summary?.days || 90}天。
      </div>

      <Modal
        title={<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #fa8c16, #f5222d)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
          </div>
          <span>AI 供应商分析</span>
          {aiLoading && <Spin size="small" />}
        </div>}
        open={aiOpen}
        onCancel={() => { setAiOpen(false); if (abortRef.current) abortRef.current.abort(); }}
        footer={null} width={580}
      >
        <div style={{ padding: '12px 0', fontSize: 14, lineHeight: 1.8, minHeight: 100 }}>
          {aiContent ? (
            <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(250,140,22,0.04)', border: '1px solid rgba(250,140,22,0.1)' }}>
              {aiContent.split(/(\*\*.*?\*\*|\n)/g).map((p, i) => {
                if (p === '\n') return <br key={i} />;
                if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
                return <span key={i}>{p}</span>;
              })}
            </div>
          ) : aiLoading ? (
            <div style={{ textAlign: 'center', padding: 30 }}><Spin size="large" /><div style={{ marginTop: 10, color: 'var(--text-3)' }}>AI正在分析供应商数据...</div></div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
