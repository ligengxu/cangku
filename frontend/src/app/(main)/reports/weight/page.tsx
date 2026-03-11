'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Table, DatePicker, Button, Space, message, Spin, Tag, Row, Col, Empty, Select, Slider, Tooltip, Modal } from 'antd';
import {
  SearchOutlined, DiffOutlined, WarningOutlined, CheckCircleOutlined,
  BarChartOutlined, DownloadOutlined, ArrowUpOutlined, ArrowDownOutlined,
  SortAscendingOutlined, UserOutlined, FilterOutlined, RobotOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import type { WeightDifferenceRecord } from '@/types';
import { exportToCsv } from '@/utils/exportCsv';
import dayjs from 'dayjs';
import dynamic from 'next/dynamic';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

const { RangePicker } = DatePicker;

interface SummaryData {
  total_count: number;
  avg_diff: number;
  max_diff: number;
  exceed_rate: number;
  exceed_count: number;
  positive_count: number;
  negative_count: number;
  threshold: number;
}
interface DistItem { bucket: number; count: number }
interface WorkerOption { id: number; name: string }
interface SkuOption { id: number; sku_name: string; fruit_name: string }

export default function WeightReportPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<WeightDifferenceRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [distribution, setDistribution] = useState<DistItem[]>([]);
  const [workersList, setWorkersList] = useState<WorkerOption[]>([]);
  const [skuList, setSkuList] = useState<SkuOption[]>([]);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiAbortRef = useRef<AbortController | null>(null);

  const openAi = async () => {
    if (!summary) return;
    setAiContent(''); setAiOpen(true); setAiLoading(true);
    const ctx = [`重量差异分析:`, `总标签${summary.total_count}, 平均差异${summary.avg_diff}g, 最大差异${summary.max_diff}g, 超差${summary.exceed_count}个(${summary.exceed_rate}%)`];
    const prompt = `分析以下重量差异数据。\n\n${ctx.join('\n')}\n\n用markdown，含：1.差异概况 2.异常检测 3.改善建议\n简洁不超200字。`;
    try {
      aiAbortRef.current = new AbortController();
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ message: prompt, history: [], stream: true, context_mode: 'minimal' }),
        signal: aiAbortRef.current.signal,
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
    } finally { setAiLoading(false); aiAbortRef.current = null; }
  };

  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().subtract(7, 'day'), dayjs()]);
  const [workerId, setWorkerId] = useState<number | undefined>(undefined);
  const [skuId, setSkuId] = useState<number | undefined>(undefined);
  const [diffRange, setDiffRange] = useState<[number, number]>([-5, 5]);
  const [diffRangeEnabled, setDiffRangeEnabled] = useState(false);
  const [sortBy, setSortBy] = useState('time');

  const fetchData = async (p?: number) => {
    if (!dateRange?.[0] || !dateRange?.[1]) { message.warning('请选择日期范围'); return; }
    try {
      setLoading(true);
      const params: Record<string, any> = {
        start_date: dateRange[0].format('YYYY-MM-DD'),
        end_date: dateRange[1].format('YYYY-MM-DD'),
        sort_by: sortBy,
        page: p ?? page,
        page_size: pageSize,
      };
      if (workerId) params.worker_id = workerId;
      if (skuId) params.sku_id = skuId;
      if (diffRangeEnabled) {
        params.min_diff = diffRange[0];
        params.max_diff = diffRange[1];
      }
      const res = await api.get('/reports/weight-difference', { params });
      const d = res.data?.data ?? res.data ?? {};
      setData(Array.isArray(d.items) ? d.items : []);
      setTotal(d.total ?? 0);
      setSummary(d.summary ?? null);
      setDistribution(Array.isArray(d.distribution) ? d.distribution : []);
      setWorkersList(Array.isArray(d.workers) ? d.workers : []);
      setSkuList(Array.isArray(d.sku_list) ? d.sku_list : []);
    } catch { message.error('加载数据失败'); setData([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(1); }, []);

  const handleSearch = () => { setPage(1); fetchData(1); };

  const chartOption = useMemo(() => {
    if (!distribution.length) return null;
    return {
      tooltip: { trigger: 'axis' as const, formatter: (p: any) => `差值 ${p[0]?.name}kg<br/>数量: <b>${p[0]?.value}</b>` },
      grid: { left: 50, right: 20, top: 30, bottom: 40 },
      xAxis: { type: 'category' as const, data: distribution.map(d => d.bucket.toFixed(1)), name: '差值(kg)', axisLabel: { fontSize: 10 } },
      yAxis: { type: 'value' as const, name: '数量' },
      series: [{
        type: 'bar',
        data: distribution.map(d => ({
          value: d.count,
          itemStyle: { color: d.bucket >= 0 ? '#00b96b' : '#ff4d4f', borderRadius: [3, 3, 0, 0] },
        })),
        barMaxWidth: 24,
      }],
    };
  }, [distribution]);

  const maxAbsDiff = data.length ? Math.max(...data.map(d => Math.abs(d.diff))) : 1;

  const columns = [
    {
      title: '标签ID', dataIndex: 'label_id', key: 'label_id', width: 90,
      render: (v: any) => (
        <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600, background: 'linear-gradient(135deg, rgba(22,119,255,0.08) 0%, rgba(22,119,255,0.03) 100%)', color: '#1677ff', border: '1px solid rgba(22,119,255,0.12)', fontFamily: 'monospace' }}>#{v}</span>
      ),
    },
    {
      title: 'SKU', key: 'sku', width: 160,
      render: (_: any, row: WeightDifferenceRecord) => (
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{row.sku_name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{row.fruit_name}</div>
        </div>
      ),
    },
    {
      title: '工人', dataIndex: 'worker_name', key: 'worker_name', width: 100,
      render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    {
      title: '预估重量', dataIndex: 'estimated_weight', key: 'estimated_weight', width: 100, align: 'right' as const,
      render: (v: number) => <span className="num" style={{ fontWeight: 500 }}>{v.toFixed(2)} kg</span>,
    },
    {
      title: '实际重量', dataIndex: 'actual_weight', key: 'actual_weight', width: 100, align: 'right' as const,
      render: (v: number) => <span className="num" style={{ fontWeight: 600 }}>{v.toFixed(2)} kg</span>,
    },
    {
      title: '差值', dataIndex: 'diff', key: 'diff', width: 200,
      sorter: (a: WeightDifferenceRecord, b: WeightDifferenceRecord) => a.diff - b.diff,
      render: (v: number) => {
        const isPos = v > 0;
        const isHigh = summary ? Math.abs(v) > summary.threshold : false;
        const pct = maxAbsDiff > 0 ? Math.min(Math.round((Math.abs(v) / maxAbsDiff) * 100), 100) : 0;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, height: 6, background: 'rgba(0,0,0,0.04)', borderRadius: 3, overflow: 'hidden', minWidth: 60 }}>
              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, transition: 'width 0.5s', background: isHigh ? 'linear-gradient(90deg, #ff4d4f, #ff7875)' : isPos ? 'linear-gradient(90deg, #fa8c16, #ffc069)' : 'linear-gradient(90deg, #1677ff, #69b1ff)' }} />
            </div>
            <Tag color={isHigh ? 'error' : isPos ? 'warning' : 'processing'} style={{ borderRadius: 6, fontWeight: 600, fontSize: 12, minWidth: 70, textAlign: 'center' }}>
              {isPos ? '+' : ''}{v.toFixed(3)} kg
            </Tag>
          </div>
        );
      },
    },
    {
      title: '扫码时间', dataIndex: 'scanned_time', key: 'scanned_time', width: 150,
      render: (v: string | null) => v ? <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{dayjs(v).format('MM-DD HH:mm')}</span> : '-',
    },
  ];

  const statCards = summary ? [
    { label: '总记录数', value: summary.total_count, unit: '条', icon: <BarChartOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.15)' },
    { label: '平均差值', value: `${summary.avg_diff > 0 ? '+' : ''}${summary.avg_diff.toFixed(3)}`, unit: 'kg', icon: <DiffOutlined />, gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', glow: 'rgba(114,46,209,0.15)' },
    { label: '最大差值', value: summary.max_diff.toFixed(3), unit: 'kg', icon: <WarningOutlined />, gradient: summary.max_diff > summary.threshold ? 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)' : 'linear-gradient(135deg, #fa8c16 0%, #ffc069 100%)', glow: summary.max_diff > summary.threshold ? 'rgba(255,77,79,0.15)' : 'rgba(250,140,22,0.15)' },
    { label: '超标占比', value: `${summary.exceed_rate}`, unit: '%', icon: <WarningOutlined />, gradient: summary.exceed_rate > 20 ? 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)' : 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: summary.exceed_rate > 20 ? 'rgba(255,77,79,0.15)' : 'rgba(0,185,107,0.15)' },
    { label: '多发（正差）', value: summary.positive_count, unit: '条', icon: <ArrowUpOutlined />, gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc069 100%)', glow: 'rgba(250,140,22,0.15)' },
    { label: '少发（负差）', value: summary.negative_count, unit: '条', icon: <ArrowDownOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.15)' },
  ] : [];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22,
        padding: '20px 24px', borderRadius: 'var(--radius-l)',
        background: 'linear-gradient(135deg, rgba(22,119,255,0.05) 0%, rgba(255,77,79,0.03) 100%)',
        border: '1px solid rgba(22,119,255,0.06)',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 32, height: 32, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #1677ff 0%, #ff4d4f 100%)', color: '#fff', fontSize: 15, boxShadow: '0 3px 10px rgba(22,119,255,0.2)' }}><DiffOutlined /></span>
            重量差异报表
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 42 }}>标签级重量差异分析 · 多维度筛选</div>
        </div>
        <Space size={8}>
          <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch} loading={loading} style={{ borderRadius: 8, fontWeight: 600 }}>查询</Button>
          <Button icon={<RobotOutlined />} onClick={openAi} style={{ borderRadius: 8, background: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none', color: '#fff' }}>AI分析</Button>
          <Button icon={<DownloadOutlined />} onClick={() => exportToCsv(data,
            [
              { key: 'label_id', title: '标签ID', render: v => `#${v}` },
              { key: 'sku_name', title: 'SKU名称' },
              { key: 'fruit_name', title: '水果' },
              { key: 'worker_name', title: '工人' },
              { key: 'estimated_weight', title: '预估重量(kg)', render: v => Number(v ?? 0).toFixed(3) },
              { key: 'actual_weight', title: '实际重量(kg)', render: v => Number(v ?? 0).toFixed(3) },
              { key: 'diff', title: '差值(kg)', render: v => Number(v ?? 0).toFixed(3) },
              { key: 'scanned_time', title: '扫码时间' },
            ],
            '重量差异报表'
          )} disabled={!data.length} style={{ borderRadius: 8 }}>导出 CSV</Button>
        </Space>
      </div>

      {/* Filter Bar */}
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-head">
          <span className="panel-title"><FilterOutlined style={{ color: '#722ed1' }} />筛选条件</span>
        </div>
        <div style={{ padding: '12px 16px 16px', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ minWidth: 240 }}>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>日期范围</div>
            <RangePicker value={dateRange} onChange={dates => dates && setDateRange(dates as [dayjs.Dayjs, dayjs.Dayjs])} format="YYYY-MM-DD" style={{ borderRadius: 8, width: '100%' }} />
          </div>
          <div style={{ minWidth: 160 }}>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>工人</div>
            <Select allowClear placeholder="全部工人" value={workerId} onChange={setWorkerId} style={{ width: '100%', borderRadius: 8 }}
              options={workersList.map(w => ({ value: w.id, label: w.name }))} showSearch optionFilterProp="label" />
          </div>
          <div style={{ minWidth: 200 }}>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>SKU</div>
            <Select allowClear placeholder="全部SKU" value={skuId} onChange={setSkuId} style={{ width: '100%', borderRadius: 8 }}
              options={skuList.map(s => ({ value: s.id, label: `${s.sku_name} (${s.fruit_name})` }))} showSearch optionFilterProp="label" />
          </div>
          <div style={{ minWidth: 220 }}>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              差值范围 (kg)
              <input type="checkbox" checked={diffRangeEnabled} onChange={e => setDiffRangeEnabled(e.target.checked)} style={{ cursor: 'pointer' }} />
            </div>
            <Slider range min={-10} max={10} step={0.1} value={diffRange} onChange={v => setDiffRange(v as [number, number])} disabled={!diffRangeEnabled}
              marks={{ '-10': '-10', 0: '0', 10: '10' }} />
          </div>
          <div style={{ minWidth: 130 }}>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>排序方式</div>
            <Select value={sortBy} onChange={setSortBy} style={{ width: '100%', borderRadius: 8 }}
              options={[{ value: 'time', label: '按时间' }, { value: 'diff', label: '按差值' }, { value: 'weight', label: '按重量' }]} />
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      {summary && (
        <Row gutter={[10, 10]} style={{ marginBottom: 18 }}>
          {statCards.map((s, i) => (
            <Col xs={8} md={4} key={i} className={`stagger-${i + 1}`}>
              <div style={{
                padding: '12px 14px', borderRadius: 'var(--radius-m)', background: s.gradient, position: 'relative', overflow: 'hidden',
                boxShadow: `0 4px 14px ${s.glow}`, transition: 'all 0.3s',
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
              >
                <div style={{ position: 'absolute', top: -12, right: -12, width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.75)', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>{s.icon} {s.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', lineHeight: 1.2 }} className="num">
                  {s.value}{s.unit && <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 3, opacity: 0.7 }}>{s.unit}</span>}
                </div>
              </div>
            </Col>
          ))}
        </Row>
      )}

      {/* Distribution Chart */}
      {chartOption && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-head">
            <span className="panel-title"><BarChartOutlined style={{ color: '#722ed1' }} />差值分布图</span>
            <span style={{ fontSize: 12, color: 'var(--text-4)' }}>
              超标阈值: {summary?.threshold ?? 0.5} kg · 超标 {summary?.exceed_count ?? 0} 条
            </span>
          </div>
          <div style={{ padding: '0 16px 12px' }}>
            <ReactECharts option={chartOption} style={{ height: 260 }} />
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : (
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title"><DiffOutlined style={{ color: '#1677ff' }} />重量差异明细</span>
            <span style={{ fontSize: 12, color: 'var(--text-4)' }}>
              共 {total} 条 · 超标阈值 ±{summary?.threshold ?? 0.5}kg
            </span>
          </div>
          <Table
            dataSource={data} columns={columns} rowKey="label_id" size="middle"
            rowClassName={row => summary && Math.abs(row.diff) > summary.threshold ? 'row-highlight-danger' : ''}
            pagination={{
              current: page, pageSize, total, showSizeChanger: true,
              showTotal: t => `共 ${t} 条`,
              onChange: (p, ps) => { setPage(p); setPageSize(ps); fetchData(p); },
            }}
            locale={{ emptyText: <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          />
        </div>
      )}

      <Modal
        title={<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #667eea, #764ba2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
          </div>
          <span>AI 重量差异分析</span>
          {aiLoading && <Spin size="small" />}
        </div>}
        open={aiOpen}
        onCancel={() => { setAiOpen(false); if (aiAbortRef.current) aiAbortRef.current.abort(); }}
        footer={null} width={560}
      >
        <div style={{ padding: '12px 0', fontSize: 14, lineHeight: 1.8, minHeight: 100 }}>
          {aiContent ? (
            <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(102,126,234,0.04)', border: '1px solid rgba(102,126,234,0.1)' }}>
              {aiContent.split(/(\*\*.*?\*\*|\n)/g).map((p, i) => {
                if (p === '\n') return <br key={i} />;
                if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
                return <span key={i}>{p}</span>;
              })}
            </div>
          ) : aiLoading ? (
            <div style={{ textAlign: 'center', padding: 30 }}><Spin size="large" /><div style={{ marginTop: 10, color: 'var(--text-3)' }}>AI正在分析重量数据...</div></div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
