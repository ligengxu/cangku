'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  DatePicker, Button, Table, Tag, Tooltip, Row, Col,
  Empty, Spin, message, Space, Progress, Select, Modal,
} from 'antd';
import {
  ThunderboltOutlined, SearchOutlined, ReloadOutlined,
  DownloadOutlined, ExperimentOutlined, RiseOutlined,
  FundOutlined, InboxOutlined, ExportOutlined,
  CalendarOutlined, TeamOutlined, RobotOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dayjs from 'dayjs';
import dynamic from 'next/dynamic';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

const { RangePicker } = DatePicker;

interface BatchItem {
  purchase_id: number; fruit_name: string; supplier_name: string;
  purchase_date: string; purchase_weight: number; purchase_price: number;
  total_labels: number; outbound_count: number; outbound_rate: number;
  consumed_weight: number; utilization: number;
  worker_count: number; per_worker_output: number;
  days_to_complete: number | null;
  estimated_weight: number; actual_weight: number;
}
interface Summary {
  batch_count: number; total_purchase_weight: number; total_consumed: number;
  total_labels: number; total_outbound: number;
  avg_utilization: number; avg_outbound_rate: number;
  date_range: { start: string; end: string };
}
interface EffDist { bucket: string; count: number }
interface EffData {
  batches: BatchItem[];
  summary: Summary;
  efficiency_distribution: EffDist[];
  top_batches: BatchItem[];
  slow_batches: BatchItem[];
}

const STAT_GRADIENTS = [
  { bg: 'linear-gradient(135deg, #fa8c16, #ffc53d)', glow: 'rgba(250,140,22,0.15)' },
  { bg: 'linear-gradient(135deg, #722ed1, #b37feb)', glow: 'rgba(114,46,209,0.15)' },
  { bg: 'linear-gradient(135deg, #00b96b, #5cdbd3)', glow: 'rgba(0,185,107,0.15)' },
  { bg: 'linear-gradient(135deg, #1677ff, #69b1ff)', glow: 'rgba(22,119,255,0.15)' },
  { bg: 'linear-gradient(135deg, #eb2f96, #ff85c0)', glow: 'rgba(235,47,150,0.15)' },
  { bg: 'linear-gradient(135deg, #13c2c2, #5cdbd3)', glow: 'rgba(19,194,194,0.15)' },
];

export default function BatchEfficiencyPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<EffData | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().subtract(30, 'day'), dayjs()]);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const openAi = async () => {
    if (!data?.batches?.length) return;
    setAiContent(''); setAiOpen(true); setAiLoading(true);
    const ctx = [`批次效率分析:`, `共${data.batches.length}个批次`];
    data.batches.slice(0, 8).forEach(b => ctx.push(`  ${b.fruit_name}(${b.supplier_name}): 标签${b.total_labels} 出库${b.outbound_count} 出库率${b.outbound_rate}% 利用率${b.utilization}%`));
    const prompt = `分析以下批次效率数据。\n\n${ctx.join('\n')}\n\n用markdown，含：1.效率概况 2.问题批次 3.改善建议\n简洁不超200字。`;
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
      const params: Record<string, string> = {
        start_date: dateRange[0].format('YYYY-MM-DD'),
        end_date: dateRange[1].format('YYYY-MM-DD'),
      };
      const res = await api.get('/reports/batch-efficiency', { params });
      setData(res.data?.data || null);
    } catch { message.error('查询失败'); }
    finally { setLoading(false); }
  }, [dateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const exportCSV = () => {
    if (!data?.batches?.length) { message.warning('暂无数据'); return; }
    const headers = ['批次ID,水果,供应商,采购日期,采购重量,标签数,出库数,出库率%,消耗重量,利用率%,工人数,人均产出,完成天数'];
    const rows = data.batches.map(b =>
      `${b.purchase_id},${b.fruit_name},${b.supplier_name},${b.purchase_date},${b.purchase_weight},${b.total_labels},${b.outbound_count},${b.outbound_rate},${b.consumed_weight},${b.utilization},${b.worker_count},${b.per_worker_output},${b.days_to_complete ?? '-'}`
    );
    const csv = '\uFEFF' + [...headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = '批次效率分析.csv'; a.click();
    URL.revokeObjectURL(url); message.success('导出成功');
  };

  const sm = data?.summary;
  const stats = sm ? [
    { label: '采购批次', value: sm.batch_count, icon: <CalendarOutlined />, ...STAT_GRADIENTS[0], suffix: '批' },
    { label: '采购重量', value: `${sm.total_purchase_weight}`, icon: <InboxOutlined />, ...STAT_GRADIENTS[1], suffix: 'kg' },
    { label: '平均利用率', value: `${sm.avg_utilization}%`, icon: <FundOutlined />, ...STAT_GRADIENTS[2], suffix: '' },
    { label: '平均出库率', value: `${sm.avg_outbound_rate}%`, icon: <ExportOutlined />, ...STAT_GRADIENTS[3], suffix: '' },
    { label: '总标签数', value: sm.total_labels.toLocaleString(), icon: <ThunderboltOutlined />, ...STAT_GRADIENTS[4], suffix: '个' },
    { label: '已出库', value: sm.total_outbound.toLocaleString(), icon: <RiseOutlined />, ...STAT_GRADIENTS[5], suffix: '个' },
  ] : [];

  const getUtilColor = (v: number) => v >= 80 ? '#00b96b' : v >= 50 ? '#faad14' : '#f5222d';
  const getUtilTag = (v: number) => v >= 80 ? 'success' : v >= 50 ? 'warning' : 'error';
  const getOutboundColor = (v: number) => v >= 90 ? '#00b96b' : v >= 60 ? '#1677ff' : v >= 30 ? '#faad14' : '#f5222d';

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{
        background: 'linear-gradient(135deg, #fa541c 0%, #f5222d 50%, #eb2f96 100%)',
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
            }}><ExperimentOutlined /></span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>批次效率分析</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
                追踪采购批次从入库到出库的全链路效率
              </div>
            </div>
          </div>
        </div>
      </div>

      {data && (
        <Row gutter={[10, 10]} style={{ marginBottom: 20 }}>
          {stats.map((s, i) => (
            <Col xs={12} sm={8} md={4} key={i}>
              <div style={{
                padding: '14px 16px', borderRadius: 14, background: s.bg,
                boxShadow: `0 4px 16px ${s.glow}`,
                animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.06}s`,
              }}>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)', display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>
                  {s.icon} {s.label}
                </div>
                <div className="num" style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{s.value}</div>
                {s.suffix && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)' }}>{s.suffix}</span>}
              </div>
            </Col>
          ))}
        </Row>
      )}

      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head">
          <span className="panel-title"><SearchOutlined style={{ color: '#1677ff' }} /> 筛选</span>
          <Space>
            <Button icon={<RobotOutlined />} onClick={openAi} style={{ borderRadius: 8, background: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none', color: '#fff' }}>AI分析</Button>
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 8 }} />
            <Button icon={<DownloadOutlined />} onClick={exportCSV} style={{ borderRadius: 8 }}>导出</Button>
          </Space>
        </div>
        <div style={{ padding: '12px 20px' }}>
          <Row gutter={[12, 12]} align="bottom">
            <Col xs={24} sm={16}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>采购日期范围</div>
              <RangePicker value={dateRange} onChange={v => v && setDateRange(v as [dayjs.Dayjs, dayjs.Dayjs])}
                style={{ width: '100%', borderRadius: 8 }} />
            </Col>
            <Col xs={24} sm={8}>
              <Button type="primary" icon={<SearchOutlined />} onClick={fetchData} loading={loading}
                style={{ width: '100%', borderRadius: 10, height: 40, fontWeight: 600, background: 'linear-gradient(135deg, #fa541c, #f5222d)', border: 'none' }}>
                查询
              </Button>
            </Col>
          </Row>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : !data?.batches?.length ? (
        <div className="panel" style={{ padding: 60, textAlign: 'center' }}>
          <Empty description="所选范围内暂无采购批次" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      ) : (
        <>
          {data.efficiency_distribution.some(d => d.count > 0) && (
            <div className="panel" style={{ marginBottom: 20 }}>
              <div className="panel-head">
                <span className="panel-title"><FundOutlined style={{ color: '#fa8c16' }} /> 利用率分布</span>
              </div>
              <div style={{ padding: '16px 20px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {data.efficiency_distribution.map((d, i) => {
                  const colors = ['#f5222d', '#fa8c16', '#faad14', '#52c41a', '#00b96b', '#1677ff'];
                  const color = colors[i] || '#1677ff';
                  const maxCount = Math.max(...data.efficiency_distribution.map(dd => dd.count), 1);
                  const pct = Math.round((d.count / maxCount) * 100);
                  return (
                    <div key={d.bucket} style={{
                      flex: '1 1 100px', minWidth: 80, padding: '12px 14px', borderRadius: 12,
                      border: `1px solid ${color}20`, background: `${color}06`, textAlign: 'center',
                      animation: `stagger-in 0.4s ease both`, animationDelay: `${i * 0.06}s`,
                    }}>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>{d.bucket}</div>
                      <div className="num" style={{ fontSize: 22, fontWeight: 800, color }}>{d.count}</div>
                      <Progress percent={pct} showInfo={false} strokeColor={color} size="small" style={{ marginTop: 6 }} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
            <Col xs={24} md={12}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head">
                  <span className="panel-title"><RiseOutlined style={{ color: '#00b96b' }} /> 效率最高批次</span>
                </div>
                <div style={{ padding: '8px 16px' }}>
                  {(data.top_batches || []).map((b, i) => (
                    <div key={b.purchase_id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '10px 0', borderBottom: i < data.top_batches.length - 1 ? '1px solid var(--border-2)' : 'none',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{
                          width: 24, height: 24, borderRadius: 8,
                          background: i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : 'var(--gray-3)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700, color: i < 3 ? '#fff' : 'var(--text-3)',
                        }}>{i + 1}</span>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{b.fruit_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{b.supplier_name} · {b.purchase_date}</div>
                        </div>
                      </div>
                      <Tag color="success" style={{ borderRadius: 8, fontWeight: 700 }}>{b.utilization}%</Tag>
                    </div>
                  ))}
                  {!data.top_batches?.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />}
                </div>
              </div>
            </Col>
            <Col xs={24} md={12}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head">
                  <span className="panel-title"><ExportOutlined style={{ color: '#f5222d' }} /> 出库最慢批次</span>
                </div>
                <div style={{ padding: '8px 16px' }}>
                  {(data.slow_batches || []).map((b, i) => (
                    <div key={b.purchase_id} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '10px 0', borderBottom: i < data.slow_batches.length - 1 ? '1px solid var(--border-2)' : 'none',
                    }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{b.fruit_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{b.supplier_name} · {b.purchase_date}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <Tag color="error" style={{ borderRadius: 8, fontWeight: 700 }}>{b.outbound_rate}%</Tag>
                        <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 2 }}>{b.outbound_count}/{b.total_labels}</div>
                      </div>
                    </div>
                  ))}
                  {!data.slow_batches?.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />}
                </div>
              </div>
            </Col>
          </Row>

          <div className="panel">
            <div className="panel-head">
              <span className="panel-title"><ThunderboltOutlined style={{ color: '#fa541c' }} /> 批次明细</span>
              <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{data.batches.length} 批次</span>
            </div>
            <Table
              dataSource={data.batches}
              rowKey="purchase_id"
              size="small"
              scroll={{ x: 1100 }}
              pagination={{ pageSize: 15, showTotal: t => `共 ${t} 条`, size: 'small' }}
              locale={{ emptyText: '暂无数据' }}
              columns={[
                {
                  title: '水果/供应商', key: 'info', width: 160, fixed: 'left' as const,
                  render: (_: unknown, r: BatchItem) => (
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#fa541c' }}>{r.fruit_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{r.supplier_name} · {r.purchase_date}</div>
                    </div>
                  ),
                },
                { title: '采购重量', dataIndex: 'purchase_weight', width: 90, align: 'right' as const,
                  render: (v: number) => <span className="num">{v}kg</span> },
                { title: '标签数', dataIndex: 'total_labels', width: 80, align: 'right' as const,
                  sorter: (a: BatchItem, b: BatchItem) => a.total_labels - b.total_labels,
                  render: (v: number) => <span className="num" style={{ fontWeight: 600 }}>{v}</span> },
                { title: '出库数', dataIndex: 'outbound_count', width: 80, align: 'right' as const,
                  sorter: (a: BatchItem, b: BatchItem) => a.outbound_count - b.outbound_count,
                  render: (v: number) => <span className="num" style={{ fontWeight: 600, color: '#00b96b' }}>{v}</span> },
                {
                  title: '出库率', dataIndex: 'outbound_rate', width: 120, align: 'center' as const,
                  sorter: (a: BatchItem, b: BatchItem) => a.outbound_rate - b.outbound_rate,
                  render: (v: number) => (
                    <div>
                      <Progress percent={v} size="small" strokeColor={getOutboundColor(v)}
                        format={p => <span style={{ fontSize: 11, fontWeight: 600 }}>{p}%</span>} />
                    </div>
                  ),
                },
                {
                  title: '利用率', dataIndex: 'utilization', width: 100, align: 'center' as const,
                  defaultSortOrder: 'descend' as const,
                  sorter: (a: BatchItem, b: BatchItem) => a.utilization - b.utilization,
                  render: (v: number) => (
                    <Tag color={getUtilTag(v)} style={{ borderRadius: 8, fontWeight: 700, fontSize: 12 }}>{v}%</Tag>
                  ),
                },
                { title: '工人', dataIndex: 'worker_count', width: 60, align: 'center' as const,
                  render: (v: number) => <span className="num"><TeamOutlined style={{ marginRight: 3 }} />{v}</span> },
                { title: '人均', dataIndex: 'per_worker_output', width: 70, align: 'right' as const,
                  render: (v: number) => <span className="num" style={{ color: '#722ed1', fontWeight: 600 }}>{v}</span> },
                {
                  title: '周期', dataIndex: 'days_to_complete', width: 80, align: 'center' as const,
                  sorter: (a: BatchItem, b: BatchItem) => (a.days_to_complete ?? 999) - (b.days_to_complete ?? 999),
                  render: (v: number | null) => v != null
                    ? <span className="num" style={{ fontWeight: 600, color: v > 7 ? '#f5222d' : v > 3 ? '#fa8c16' : '#00b96b' }}>{v}天</span>
                    : <span style={{ color: 'var(--text-4)', fontSize: 11 }}>进行中</span>,
                },
              ]}
            />
          </div>

          <div style={{
            marginTop: 16, padding: '10px 16px', borderRadius: 10,
            background: 'linear-gradient(135deg, rgba(250,84,28,0.04), rgba(245,34,45,0.03))',
            border: '1px solid rgba(250,84,28,0.08)',
            fontSize: 12, color: 'var(--text-4)', lineHeight: 1.8,
          }}>
            <ExperimentOutlined style={{ color: '#fa541c', marginRight: 6 }} />
            效率说明：利用率 = 出库消耗重量 / 采购重量（表示水果的实际利用程度）。出库率 = 已出库标签 / 总标签（表示订单完成进度）。
            周期 = 首个标签打印到最后一个标签出库的天数。
          </div>
          {/* Scatter Chart */}
          {data.batches.length > 0 && (
            <div className="panel" style={{ marginTop: 16 }}>
              <div className="panel-head">
                <span className="panel-title"><FundOutlined style={{ color: '#722ed1' }} /> 批次效率分布</span>
              </div>
              <div style={{ padding: '8px 16px' }}>
                <ReactECharts
                  style={{ height: 260 }}
                  option={{
                    tooltip: { trigger: 'item', formatter: (p: any) => `<b>${p.data[3]}</b><br/>出库率: ${p.data[0]}%<br/>利用率: ${p.data[1]}%<br/>标签: ${p.data[2]}` },
                    grid: { top: 20, right: 20, bottom: 40, left: 50 },
                    xAxis: { name: '出库率 %', type: 'value', min: 0, max: 100, splitLine: { lineStyle: { type: 'dashed', color: '#f0f0f0' } } },
                    yAxis: { name: '利用率 %', type: 'value', min: 0, splitLine: { lineStyle: { type: 'dashed', color: '#f0f0f0' } } },
                    series: [{ type: 'scatter', symbolSize: (d: number[]) => Math.max(Math.sqrt(d[2]) * 1.5, 6),
                      data: data.batches.map(b => [b.outbound_rate, b.utilization, b.total_labels, `${b.fruit_name}(${b.supplier_name})`]),
                      itemStyle: { color: (p: any) => p.data[1] >= 70 ? '#52c41a' : p.data[1] >= 40 ? '#faad14' : '#ff4d4f', opacity: 0.7 },
                    }],
                  }}
                />
              </div>
            </div>
          )}
        </>
      )}

      <Modal
        title={<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #fa541c, #ff7a45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
          </div>
          <span>AI 批次效率分析</span>
          {aiLoading && <Spin size="small" />}
        </div>}
        open={aiOpen}
        onCancel={() => { setAiOpen(false); if (abortRef.current) abortRef.current.abort(); }}
        footer={null} width={560}
      >
        <div style={{ padding: '12px 0', fontSize: 14, lineHeight: 1.8, minHeight: 100 }}>
          {aiContent ? (
            <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(250,84,28,0.04)', border: '1px solid rgba(250,84,28,0.1)' }}>
              {aiContent.split(/(\*\*.*?\*\*|\n)/g).map((p, i) => {
                if (p === '\n') return <br key={i} />;
                if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
                return <span key={i}>{p}</span>;
              })}
            </div>
          ) : aiLoading ? (
            <div style={{ textAlign: 'center', padding: 30 }}><Spin size="large" /><div style={{ marginTop: 10, color: 'var(--text-3)' }}>AI正在分析批次效率...</div></div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
