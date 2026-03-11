'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Select, DatePicker, Button, Table, Tag, Row, Col,
  Empty, Spin, message, Space, Avatar, Modal,
} from 'antd';
import {
  SearchOutlined, ReloadOutlined,
  DownloadOutlined, TrophyOutlined,
  BarChartOutlined, FundOutlined, RobotOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dayjs from 'dayjs';
import dynamic from 'next/dynamic';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

const { RangePicker } = DatePicker;

interface WorkerComp {
  worker_id: number; worker_name: string;
  daily_production: number[]; daily_outbound: number[];
}
interface WorkerSummary {
  worker_id: number; worker_name: string;
  total_production: number; total_outbound: number;
  working_days: number; avg_daily: number; commission: number; max_daily: number;
}
interface CompData {
  workers: { id: number; name: string }[];
  dates: string[];
  comparison: WorkerComp[];
  summary: WorkerSummary[];
  worker_options: { id: number; name: string }[];
  date_range: { start: string; end: string };
}

const COLORS = ['#1677ff', '#00b96b', '#722ed1', '#fa8c16', '#eb2f96', '#13c2c2', '#f5222d', '#52c41a', '#2f54eb', '#faad14'];

export default function WorkerComparisonPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<CompData | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [selectedWorkers, setSelectedWorkers] = useState<number[]>([]);
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().subtract(13, 'day'), dayjs()]);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const openAi = async () => {
    setAiContent(''); setAiOpen(true); setAiLoading(true);
    try {
      abortRef.current = new AbortController();
      const res = await fetch('/api/workers/comparison-ai', {
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
      const params: Record<string, string> = {
        start_date: dateRange[0].format('YYYY-MM-DD'),
        end_date: dateRange[1].format('YYYY-MM-DD'),
      };
      if (selectedWorkers.length) params.worker_ids = selectedWorkers.join(',');
      const res = await api.get('/workers/comparison', { params });
      setData(res.data?.data || null);
    } catch { message.error('查询失败'); }
    finally { setLoading(false); }
  }, [selectedWorkers, dateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  useEffect(() => {
    if (!data?.comparison?.length || !data?.dates?.length || !chartRef.current) return;
    const canvas = chartRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const dates = data.dates;
    const workers = data.comparison;
    const allVals = workers.flatMap(w => w.daily_production);
    const maxVal = Math.max(...allVals, 1);
    const chartH = rect.height - 60;
    const startX = 45;
    const chartW = rect.width - startX - 20;
    const step = chartW / Math.max(dates.length - 1, 1);

    ctx.fillStyle = '#888'; ctx.font = '11px sans-serif'; ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const y = 20 + chartH - (chartH * i / 4);
      ctx.fillText(String(Math.round(maxVal * i / 4)), startX - 8, y + 4);
      ctx.strokeStyle = '#f0f0f0'; ctx.beginPath(); ctx.moveTo(startX, y); ctx.lineTo(rect.width - 10, y); ctx.stroke();
    }

    workers.forEach((w, wi) => {
      const color = COLORS[wi % COLORS.length];
      ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      w.daily_production.forEach((v, i) => {
        const x = startX + i * step;
        const y = 20 + chartH - (v / maxVal) * chartH;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();

      w.daily_production.forEach((v, i) => {
        const x = startX + i * step;
        const y = 20 + chartH - (v / maxVal) * chartH;
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
      });
    });

    ctx.fillStyle = '#888'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    dates.forEach((d, i) => {
      if (i % Math.ceil(dates.length / 10) === 0 || i === dates.length - 1) {
        ctx.fillText(d, startX + i * step, 20 + chartH + 16);
      }
    });

    let legendX = startX;
    workers.forEach((w, wi) => {
      const color = COLORS[wi % COLORS.length];
      ctx.fillStyle = color; ctx.fillRect(legendX, 6, 12, 3);
      ctx.fillStyle = '#666'; ctx.font = '11px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(w.worker_name, legendX + 16, 10);
      legendX += ctx.measureText(w.worker_name).width + 30;
    });
  }, [data]);

  const exportCSV = () => {
    if (!data?.summary?.length) { message.warning('暂无数据'); return; }
    const headers = ['工人,总产量,总出库,出勤天数,日均产量,最高日产,佣金'];
    const rows = data.summary.map(s =>
      `${s.worker_name},${s.total_production},${s.total_outbound},${s.working_days},${s.avg_daily},${s.max_daily},${s.commission}`
    );
    const csv = '\uFEFF' + [...headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = '工人产量对比.csv'; a.click();
    URL.revokeObjectURL(url); message.success('导出成功');
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{
        background: 'linear-gradient(135deg, #2f54eb 0%, #722ed1 50%, #eb2f96 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -40, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{
              width: 44, height: 44, borderRadius: 14,
              background: 'rgba(255,255,255,0.2)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 22,
            }}><FundOutlined /></span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>工人产量对比</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
                多工人产量趋势对比 · 辅助批次分配决策
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head">
          <span className="panel-title"><SearchOutlined style={{ color: '#722ed1' }} /> 筛选</span>
          <Space>
            <Button icon={<RobotOutlined />} onClick={openAi} style={{ borderRadius: 8, background: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none', color: '#fff' }}>AI分析</Button>
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 8 }} />
            <Button icon={<DownloadOutlined />} onClick={exportCSV} style={{ borderRadius: 8 }}>导出</Button>
          </Space>
        </div>
        <div style={{ padding: '14px 20px' }}>
          <Row gutter={[12, 12]}>
            <Col xs={24} sm={10}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>选择工人（可多选）</div>
              <Select mode="multiple" value={selectedWorkers} onChange={v => setSelectedWorkers(v)}
                placeholder="留空则自动选前10名" allowClear maxTagCount={4}
                style={{ width: '100%', borderRadius: 8 }}
                options={(data?.worker_options || []).map(w => ({ value: w.id, label: w.name }))} />
            </Col>
            <Col xs={24} sm={8}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>日期范围</div>
              <RangePicker value={dateRange} onChange={v => v && setDateRange(v as [dayjs.Dayjs, dayjs.Dayjs])}
                style={{ width: '100%', borderRadius: 8 }} />
            </Col>
            <Col xs={24} sm={6}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>&nbsp;</div>
              <Button type="primary" icon={<SearchOutlined />} onClick={fetchData} loading={loading}
                style={{ width: '100%', borderRadius: 10, height: 32, fontWeight: 600, background: 'linear-gradient(135deg, #2f54eb, #722ed1)', border: 'none' }}>
                查询
              </Button>
            </Col>
          </Row>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : !data?.comparison?.length ? (
        <div className="panel" style={{ padding: 60, textAlign: 'center' }}>
          <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      ) : (
        <>
          <div className="panel" style={{ marginBottom: 20 }}>
            <div className="panel-head">
              <span className="panel-title"><BarChartOutlined style={{ color: '#2f54eb' }} /> 产量趋势对比</span>
              <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{data.date_range.start} ~ {data.date_range.end}</span>
            </div>
            <div style={{ padding: '16px 20px' }}>
              <canvas ref={chartRef} style={{ width: '100%', height: 280 }} />
              {data?.comparison?.length > 0 && data?.dates?.length > 0 && (
                <ReactECharts
                  style={{ height: 260, marginTop: 16 }}
                  option={{
                    tooltip: { trigger: 'axis' },
                    legend: { data: data.comparison.map(w => w.worker_name), bottom: 0, textStyle: { fontSize: 11 } },
                    grid: { top: 10, right: 20, bottom: 40, left: 50 },
                    xAxis: { type: 'category', data: data.dates, axisLabel: { fontSize: 10 } },
                    yAxis: { type: 'value', splitLine: { lineStyle: { type: 'dashed', color: '#f0f0f0' } } },
                    series: data.comparison.map((w, i) => ({
                      name: w.worker_name, type: 'line', data: w.daily_outbound, smooth: true,
                      lineStyle: { width: 2.5 }, areaStyle: { opacity: 0.05 },
                      itemStyle: { color: COLORS[i % COLORS.length] },
                    })),
                  }}
                />
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <span className="panel-title"><TrophyOutlined style={{ color: '#fa8c16' }} /> 工人产量汇总</span>
              <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{data.summary.length} 名工人</span>
            </div>
            <Table
              dataSource={data.summary}
              rowKey="worker_id"
              size="small"
              pagination={false}
              locale={{ emptyText: '暂无数据' }}
              columns={[
                {
                  title: '排名', key: 'rank', width: 50, align: 'center' as const,
                  render: (_: unknown, __: unknown, i: number) => {
                    const colors = ['#ffd700', '#c0c0c0', '#cd7f32'];
                    return i < 3 ? (
                      <span style={{ width: 22, height: 22, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', background: colors[i] }}>{i + 1}</span>
                    ) : <span style={{ color: 'var(--text-4)' }}>{i + 1}</span>;
                  },
                },
                {
                  title: '工人', key: 'worker', width: 160,
                  render: (_: unknown, r: WorkerSummary) => {
                    const ci = data.comparison.findIndex(c => c.worker_id === r.worker_id);
                    const color = COLORS[ci >= 0 ? ci % COLORS.length : 0];
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Avatar size={28} style={{ background: color, fontWeight: 700, fontSize: 12 }}>{r.worker_name.charAt(0)}</Avatar>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{r.worker_name}</span>
                      </div>
                    );
                  },
                },
                { title: '总产量', dataIndex: 'total_production', width: 80, align: 'right' as const, defaultSortOrder: 'descend' as const, sorter: (a: WorkerSummary, b: WorkerSummary) => a.total_production - b.total_production, render: (v: number) => <span className="num" style={{ fontWeight: 700, color: '#1677ff' }}>{v}</span> },
                { title: '总出库', dataIndex: 'total_outbound', width: 80, align: 'right' as const, render: (v: number) => <span className="num" style={{ fontWeight: 600, color: '#00b96b' }}>{v}</span> },
                { title: '出勤', dataIndex: 'working_days', width: 60, align: 'center' as const, render: (v: number) => <span className="num">{v}天</span> },
                { title: '日均', dataIndex: 'avg_daily', width: 70, align: 'right' as const, render: (v: number) => <span className="num" style={{ fontWeight: 600, color: '#722ed1' }}>{v}</span> },
                { title: '最高日产', dataIndex: 'max_daily', width: 80, align: 'right' as const, render: (v: number) => <Tag color="processing" style={{ borderRadius: 6, fontWeight: 600 }}>{v}</Tag> },
                { title: '佣金', dataIndex: 'commission', width: 90, align: 'right' as const, render: (v: number) => <span style={{ fontWeight: 600, color: '#fa8c16' }}>¥{v}</span> },
              ]}
            />
          </div>
        </>
      )}

      <Modal
        title={<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #2f54eb, #722ed1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
          </div>
          <span>AI 产量对比分析</span>
          {aiLoading && <Spin size="small" />}
        </div>}
        open={aiOpen}
        onCancel={() => { setAiOpen(false); if (abortRef.current) abortRef.current.abort(); }}
        footer={null} width={520}
      >
        <div style={{ padding: '12px 0', fontSize: 14, lineHeight: 1.8, minHeight: 100 }}>
          {aiContent ? (
            <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(47,84,235,0.04)', border: '1px solid rgba(47,84,235,0.1)' }}>
              {aiContent.split(/(\*\*.*?\*\*|\n)/g).map((p, i) => {
                if (p === '\n') return <br key={i} />;
                if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
                return <span key={i}>{p}</span>;
              })}
            </div>
          ) : aiLoading ? (
            <div style={{ textAlign: 'center', padding: 30 }}><Spin size="large" /><div style={{ marginTop: 10, color: 'var(--text-3)' }}>AI正在分析对比数据...</div></div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
