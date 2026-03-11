'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Table, DatePicker, Button, Space, Row, Col, message, Spin, Select, Input, Segmented, Modal, Empty, Tag, Tooltip } from 'antd';
import {
  SearchOutlined, BarChartOutlined, ExportOutlined, CalendarOutlined,
  FileTextOutlined, DownloadOutlined, UserOutlined, InboxOutlined,
  TeamOutlined, AppstoreOutlined, EyeOutlined, RobotOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import api from '@/services/api';
import { exportToCsv } from '@/utils/exportCsv';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

interface WorkerOption { id: number; name: string }
interface SkuOption { id: number; sku_name: string; fruit_name: string }
interface StatsData {
  total_count: number; total_weight: number; active_days: number;
  daily_avg: number; worker_count: number; sku_count: number;
}
interface OutboundItem {
  date?: string; count: number; weight: number;
  worker_id?: number; worker_name?: string;
  sku_id?: number; sku_name?: string; fruit_name?: string;
}
interface FruitSummary { fruit_name: string; count: number; sku_count: number }

type GroupBy = 'date' | 'worker' | 'sku';

export default function OutboundReportPage() {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<OutboundItem[]>([]);
  const [stats, setStats] = useState<StatsData>({ total_count: 0, total_weight: 0, active_days: 0, daily_avg: 0, worker_count: 0, sku_count: 0 });
  const [fruitSummary, setFruitSummary] = useState<FruitSummary[]>([]);
  const [workers, setWorkers] = useState<WorkerOption[]>([]);
  const [skuList, setSkuList] = useState<SkuOption[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiAbortRef = useRef<AbortController | null>(null);

  const openAi = async () => {
    setAiContent(''); setAiOpen(true); setAiLoading(true);
    const ctx = [`出库报表分析:`, `总出库${stats.total_count}件, 总重量${stats.total_weight}kg, 日均${stats.daily_avg}件, ${stats.worker_count}工人, ${stats.sku_count}SKU`];
    fruitSummary.slice(0, 5).forEach(f => ctx.push(`  ${f.fruit_name}: ${f.count}件 ${f.sku_count}SKU`));
    const prompt = `分析以下出库数据。\n\n${ctx.join('\n')}\n\n用markdown，含：1.出库概况 2.品类分析 3.效率建议\n简洁不超200字。`;
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
  const [workerId, setWorkerId] = useState<number | undefined>();
  const [skuId, setSkuId] = useState<number | undefined>();
  const [search, setSearch] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('date');
  const [detailModal, setDetailModal] = useState<{ visible: boolean; title: string; labels: any[] }>({ visible: false, title: '', labels: [] });
  const [detailLoading, setDetailLoading] = useState(false);
  const chartRef = useRef<any>(null);

  const fetchData = useCallback(async (p = page) => {
    if (!dateRange?.[0] || !dateRange?.[1]) { message.warning('请选择日期范围'); return; }
    try {
      setLoading(true);
      const res = await api.get('/reports/daily-outbound', {
        params: {
          start_date: dateRange[0].format('YYYY-MM-DD'),
          end_date: dateRange[1].format('YYYY-MM-DD'),
          worker_id: workerId, sku_id: skuId, search: search || undefined,
          group_by: groupBy, page: p, page_size: pageSize,
        },
      });
      const d = res.data?.data ?? res.data ?? {};
      setItems(d.items ?? []);
      setStats(d.stats ?? { total_count: 0, total_weight: 0, active_days: 0, daily_avg: 0, worker_count: 0, sku_count: 0 });
      setFruitSummary(d.fruit_summary ?? []);
      setWorkers(d.workers ?? []);
      setSkuList(d.sku_list ?? []);
      setTotal(d.total ?? 0);
      setPage(d.page ?? p);
    } catch { message.error('加载数据失败'); setItems([]); }
    finally { setLoading(false); }
  }, [dateRange, workerId, skuId, search, groupBy, page, pageSize]);

  useEffect(() => { fetchData(1); }, [groupBy]);
  useEffect(() => { fetchData(1); }, []);

  const handleSearch = () => { setPage(1); fetchData(1); };

  const showDetail = async (row: OutboundItem) => {
    setDetailLoading(true);
    setDetailModal({ visible: true, title: '标签明细', labels: [] });
    try {
      const params: any = {
        start_date: dateRange[0].format('YYYY-MM-DD'),
        end_date: dateRange[1].format('YYYY-MM-DD'),
        scanned_outbound: 1, page_size: 200,
      };
      if (row.worker_id) params.worker_id = row.worker_id;
      if (row.sku_id) params.sku_id = row.sku_id;
      if (row.date) { params.start_date = row.date; params.end_date = row.date; }
      const res = await api.get('/production/printed-labels', { params });
      const labels = res.data?.data?.items ?? res.data?.data ?? [];
      const title = row.date ? `${row.date} 标签明细` : row.worker_name ? `${row.worker_name} 标签明细` : row.sku_name ? `${row.sku_name} 标签明细` : '标签明细';
      setDetailModal({ visible: true, title, labels: Array.isArray(labels) ? labels : [] });
    } catch { message.error('加载明细失败'); }
    finally { setDetailLoading(false); }
  };

  const getChartOption = () => {
    if (!items.length) return {};
    if (groupBy === 'date') {
      return {
        tooltip: { trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.95)', borderColor: '#e8e8e8',
          textStyle: { color: '#333' }, formatter: (p: any) => {
            const d = p[0]; return `<b>${d.name}</b><br/>数量: <b>${d.data.toLocaleString()}</b> 件<br/>重量: <b>${items[d.dataIndex]?.weight?.toLocaleString()} kg</b>`;
          }},
        grid: { top: 30, bottom: 30, left: 50, right: 20 },
        xAxis: { type: 'category', data: items.map(i => dayjs(i.date).format('MM-DD')), axisLabel: { fontSize: 11, color: '#999' }, axisLine: { lineStyle: { color: '#eee' } } },
        yAxis: { type: 'value', axisLabel: { fontSize: 11, color: '#999' }, splitLine: { lineStyle: { color: '#f5f5f5' } } },
        series: [{
          type: 'bar', data: items.map(i => i.count), barMaxWidth: 32,
          itemStyle: { borderRadius: [4, 4, 0, 0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#1677ff' }, { offset: 1, color: '#69b1ff' }] } },
        }],
      };
    }
    const names = items.map(i => groupBy === 'worker' ? (i.worker_name || `#${i.worker_id}`) : (i.sku_name || `#${i.sku_id}`)).slice(0, 15);
    const counts = items.map(i => i.count).slice(0, 15);
    return {
      tooltip: { trigger: 'axis' },
      grid: { top: 10, bottom: 30, left: 100, right: 30 },
      xAxis: { type: 'value', axisLabel: { fontSize: 11, color: '#999' }, splitLine: { lineStyle: { color: '#f5f5f5' } } },
      yAxis: { type: 'category', data: names.reverse(), axisLabel: { fontSize: 11, color: '#666', width: 80, overflow: 'truncate' } },
      series: [{
        type: 'bar', data: counts.reverse(), barMaxWidth: 24,
        itemStyle: { borderRadius: [0, 4, 4, 0], color: groupBy === 'worker' ? '#00b96b' : '#fa8c16' },
      }],
    };
  };

  const getColumns = () => {
    const viewCol = {
      title: '', key: 'action', width: 50,
      render: (_: any, r: OutboundItem) => (
        <Tooltip title="查看明细"><Button type="text" size="small" icon={<EyeOutlined />} onClick={() => showDetail(r)} /></Tooltip>
      ),
    };
    const countCol = {
      title: '出库数量', dataIndex: 'count', key: 'count', align: 'right' as const, width: 120,
      sorter: (a: OutboundItem, b: OutboundItem) => a.count - b.count,
      render: (v: number) => <span className="num" style={{ fontWeight: 700, color: '#1677ff' }}>{(v || 0).toLocaleString()}</span>,
    };
    const maxW = items.length ? Math.max(...items.map(i => i.weight || 0)) : 1;
    const weightCol = {
      title: '出库重量 (kg)', dataIndex: 'weight', key: 'weight', width: 220,
      sorter: (a: OutboundItem, b: OutboundItem) => a.weight - b.weight,
      render: (v: number) => {
        const w = v || 0;
        const pct = maxW > 0 ? Math.round((w / maxW) * 100) : 0;
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 6, background: 'rgba(0,0,0,0.04)', borderRadius: 3, overflow: 'hidden', minWidth: 80 }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #fa8c16, #ffc53d)', borderRadius: 3, transition: 'width 0.5s' }} />
            </div>
            <span className="num" style={{ fontWeight: 600, color: '#fa8c16', minWidth: 70, textAlign: 'right' }}>{w.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
        );
      },
    };

    if (groupBy === 'worker') return [
      { title: '工人', key: 'worker_name', render: (_: any, r: OutboundItem) => <span style={{ fontWeight: 600 }}>{r.worker_name || `#${r.worker_id}`}</span> },
      countCol, weightCol, viewCol,
    ];
    if (groupBy === 'sku') return [
      { title: 'SKU', key: 'sku_name', render: (_: any, r: OutboundItem) => (<div><div style={{ fontWeight: 600 }}>{r.sku_name || `#${r.sku_id}`}</div>{r.fruit_name && <div style={{ fontSize: 12, color: 'var(--text-4)' }}>{r.fruit_name}</div>}</div>) },
      countCol, weightCol, viewCol,
    ];
    return [
      { title: '日期', dataIndex: 'date', key: 'date', width: 130, render: (v: string) => <span style={{ fontWeight: 500 }}>{v ? dayjs(v).format('YYYY-MM-DD') : '-'}</span> },
      countCol, weightCol, viewCol,
    ];
  };

  const handleExport = () => {
    if (!items.length) return;
    const cols: any[] = groupBy === 'date'
      ? [{ key: 'date', title: '日期' }, { key: 'count', title: '出库数量' }, { key: 'weight', title: '出库重量(kg)' }]
      : groupBy === 'worker'
        ? [{ key: 'worker_name', title: '工人' }, { key: 'count', title: '出库数量' }, { key: 'weight', title: '出库重量(kg)' }]
        : [{ key: 'sku_name', title: 'SKU' }, { key: 'fruit_name', title: '水果' }, { key: 'count', title: '出库数量' }, { key: 'weight', title: '出库重量(kg)' }];
    exportToCsv(items, cols, `出库报表_${groupBy}`);
  };

  const statCards = [
    { label: '出库天数', value: stats.active_days, unit: '天', icon: <CalendarOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.15)' },
    { label: '出库总量', value: stats.total_count.toLocaleString(), unit: '件', icon: <ExportOutlined />, gradient: 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: 'rgba(0,185,107,0.15)' },
    { label: '出库总重', value: `${(stats.total_weight / 1000).toFixed(1)}t`, icon: <BarChartOutlined />, gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.15)' },
    { label: '日均出库', value: stats.daily_avg.toLocaleString(), unit: '件/天', icon: <InboxOutlined />, gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', glow: 'rgba(114,46,209,0.15)' },
    { label: '涉及工人', value: stats.worker_count, unit: '人', icon: <TeamOutlined />, gradient: 'linear-gradient(135deg, #eb2f96 0%, #ff85c0 100%)', glow: 'rgba(235,47,150,0.15)' },
    { label: '涉及SKU', value: stats.sku_count, unit: '个', icon: <AppstoreOutlined />, gradient: 'linear-gradient(135deg, #13c2c2 0%, #5cdbd3 100%)', glow: 'rgba(19,194,194,0.15)' },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22,
        padding: '20px 24px', borderRadius: 'var(--radius-l)',
        background: 'linear-gradient(135deg, rgba(0,185,107,0.05) 0%, rgba(250,140,22,0.03) 100%)',
        border: '1px solid rgba(0,185,107,0.06)',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 32, height: 32, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #00b96b 0%, #fa8c16 100%)', color: '#fff', fontSize: 15,
              boxShadow: '0 3px 10px rgba(0,185,107,0.2)',
            }}><ExportOutlined /></span>
            出库报表
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 42 }}>多维度出库数据分析</div>
        </div>
        <Space>
          <Button icon={<RobotOutlined />} onClick={openAi} style={{ borderRadius: 8, background: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none', color: '#fff' }}>AI分析</Button>
          <Button icon={<DownloadOutlined />} onClick={handleExport} disabled={!items.length} style={{ borderRadius: 8 }}>导出 CSV</Button>
        </Space>
      </div>

      {/* Filter bar */}
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-body" style={{ padding: '14px 16px' }}>
          <Row gutter={[12, 12]} align="middle">
            <Col flex="auto">
              <Space wrap size={8}>
                <RangePicker value={dateRange} onChange={dates => dates && setDateRange(dates as [dayjs.Dayjs, dayjs.Dayjs])} format="YYYY-MM-DD" style={{ borderRadius: 8 }} />
                <Select placeholder="工人" allowClear value={workerId} onChange={setWorkerId} style={{ width: 130, borderRadius: 8 }}
                  options={workers.map(w => ({ value: w.id, label: w.name }))} showSearch optionFilterProp="label" />
                <Select placeholder="SKU" allowClear value={skuId} onChange={setSkuId} style={{ width: 160, borderRadius: 8 }}
                  options={skuList.map(s => ({ value: s.id, label: `${s.sku_name} (${s.fruit_name})` }))} showSearch optionFilterProp="label" />
                <Input placeholder="搜索标签/SKU ID" value={search} onChange={e => setSearch(e.target.value)} onPressEnter={handleSearch}
                  prefix={<SearchOutlined style={{ color: '#ccc' }} />} style={{ width: 170, borderRadius: 8 }} allowClear />
                <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch} loading={loading} style={{ borderRadius: 8, fontWeight: 600 }}>查询</Button>
              </Space>
            </Col>
            <Col>
              <Segmented value={groupBy} onChange={v => { setGroupBy(v as GroupBy); setPage(1); }}
                options={[
                  { value: 'date', label: '按日期' },
                  { value: 'worker', label: '按工人' },
                  { value: 'sku', label: '按SKU' },
                ]} />
            </Col>
          </Row>
        </div>
      </div>

      {/* Stat cards */}
      <Row gutter={[10, 10]} style={{ marginBottom: 18 }}>
        {statCards.map((s, i) => (
          <Col xs={12} sm={8} md={4} key={i} className={`stagger-${(i % 5) + 1}`}>
            <div style={{
              padding: '12px 14px', borderRadius: 'var(--radius-m)', background: s.gradient, position: 'relative', overflow: 'hidden',
              boxShadow: `0 4px 14px ${s.glow}`, transition: 'all 0.3s',
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
            >
              <div style={{ position: 'absolute', top: -12, right: -12, width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>{s.icon} {s.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', lineHeight: 1.2 }} className="num">
                {s.value}{s.unit && <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 3, opacity: 0.7 }}>{s.unit}</span>}
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : (
        <>
          {/* Chart */}
          {items.length > 0 && (
            <div className="panel" style={{ marginBottom: 18 }}>
              <div className="panel-head">
                <span className="panel-title"><BarChartOutlined style={{ color: '#1677ff' }} />
                  {groupBy === 'date' ? '出库趋势' : groupBy === 'worker' ? '工人出库分布' : 'SKU出库分布'}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{dateRange[0].format('MM-DD')} ~ {dateRange[1].format('MM-DD')}</span>
              </div>
              <div className="panel-body" style={{ padding: '8px 12px' }}>
                <ReactECharts ref={chartRef} option={getChartOption()} style={{ height: groupBy === 'date' ? 220 : Math.max(200, Math.min(items.length, 15) * 30) }} notMerge />
              </div>
            </div>
          )}

          {/* Table */}
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title"><FileTextOutlined style={{ color: '#00b96b' }} />明细数据</span>
              <span style={{ fontSize: 12, color: 'var(--text-4)' }}>共 {total} 条</span>
            </div>
            <Table
              dataSource={items} columns={getColumns()} rowKey={(r, i) => r.date || `${r.worker_id || r.sku_id}-${i}`} size="middle"
              pagination={{
                current: page, pageSize, total, showSizeChanger: true, showTotal: t => `共 ${t} 条`,
                onChange: (p, ps) => { setPage(p); setPageSize(ps); fetchData(p); },
              }}
              locale={{ emptyText: <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            />
          </div>
        </>
      )}

      {/* Detail modal */}
      <Modal title={detailModal.title} open={detailModal.visible} onCancel={() => setDetailModal({ visible: false, title: '', labels: [] })}
        footer={null} width={800} styles={{ body: { maxHeight: 500, overflow: 'auto' } }}>
        {detailLoading ? <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div> : (
          <Table dataSource={detailModal.labels} rowKey="id" size="small" pagination={{ pageSize: 50, showTotal: t => `共 ${t} 条` }}
            columns={[
              { title: 'ID', dataIndex: 'id', width: 70 },
              { title: 'SKU', dataIndex: 'sku_name', width: 140, render: (v: any, r: any) => v || r.s || '-' },
              { title: '预估重量', dataIndex: 'estimated_weight', width: 100, render: (v: any) => `${Number(v || 0).toFixed(2)} kg` },
              { title: '实际重量', dataIndex: 'actual_weight', width: 100, render: (v: any) => `${Number(v || 0).toFixed(2)} kg` },
              { title: '差值', key: 'diff', width: 100, render: (_: any, r: any) => {
                const diff = (Number(r.actual_weight) || 0) - (Number(r.estimated_weight) || 0);
                return <span style={{ color: diff > 0 ? '#fa8c16' : diff < 0 ? '#ff4d4f' : '#999' }}>{diff > 0 ? '+' : ''}{diff.toFixed(2)} kg</span>;
              }},
              { title: '出库时间', dataIndex: 'scanned_time', width: 160, render: (v: any) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-' },
            ]}
          />
        )}
      </Modal>

      <Modal
        title={<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #667eea, #764ba2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RobotOutlined style={{ color: '#fff', fontSize: 14 }} />
          </div>
          <span>AI 出库分析</span>
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
            <div style={{ textAlign: 'center', padding: 30 }}><Spin size="large" /><div style={{ marginTop: 10, color: 'var(--text-3)' }}>AI正在分析出库数据...</div></div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
