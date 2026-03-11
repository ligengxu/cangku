'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Row, Col, DatePicker, Space, message, Tooltip, Tag, Table, Button, Empty, Progress, Select, Statistic,
  Modal, Spin, Avatar,
} from 'antd';
import {
  TrophyOutlined, RiseOutlined, FallOutlined, FireOutlined, CalendarOutlined,
  ThunderboltOutlined, AimOutlined, TeamOutlined, ReloadOutlined, BarChartOutlined,
  CrownOutlined, StarOutlined, ArrowUpOutlined, ArrowDownOutlined, MinusOutlined,
  DownloadOutlined, UserOutlined, PrinterOutlined, ExportOutlined, DollarOutlined,
  LineChartOutlined, SwapOutlined, InfoCircleOutlined, RobotOutlined,
} from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import api from '@/services/api';
import { exportToCsv } from '@/utils/exportCsv';
import { useDevice } from '@/hooks/useDevice';
import { useAuth } from '@/stores/useAuth';

interface DailyItem { date: string; qty: number; records: number; printed?: number; outbound?: number }
interface SkuItem {
  sku_id: number; sku_name: string; fruit_name: string; qty: number;
  print_qty?: number; records: number; outbound?: number; commission?: number; performance?: number;
}
interface PerfData {
  worker_id?: number;
  worker_name?: string;
  daily_production: DailyItem[];
  period_total: number;
  period_printed?: number;
  period_outbound?: number;
  working_days: number;
  avg_daily: number;
  sku_breakdown: SkuItem[];
  rank: number;
  total_workers: number;
  team_avg: number;
  vs_avg: number;
  growth: number | null;
  start_date: string;
  end_date: string;
  total_commission?: number;
  total_outbound?: number;
  worker_options?: { id: number; name: string }[];
}

function getMonthRange(m: Dayjs): [Dayjs, Dayjs] {
  const start = m.startOf('month');
  const end = m.isSame(dayjs(), 'month') ? dayjs() : m.endOf('month');
  return [start, end];
}

export default function WorkerPerformancePage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PerfData | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<Dayjs>(dayjs());
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>(getMonthRange(dayjs()));
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [selectedWorker, setSelectedWorker] = useState<number | undefined>();
  const [isAdmin, setIsAdmin] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<any>(null);
  const compChartRef = useRef<HTMLDivElement>(null);
  const compChartInstance = useRef<any>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const aiAbortRef = useRef<AbortController | null>(null);

  const fetchAIInsight = useCallback(async () => {
    setAiOpen(true);
    setAiContent('');
    setAiLoading(true);
    try {
      aiAbortRef.current = new AbortController();
      const params = selectedWorker ? `?worker_id=${selectedWorker}` : '';
      const response = await fetch(`/api/ai/performance-insight${params}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        signal: aiAbortRef.current.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');
      const decoder = new TextDecoder();
      let acc = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const d = line.slice(6);
          if (d === '[DONE]') break;
          try {
            const parsed = JSON.parse(d);
            if (parsed.content) acc += parsed.content;
            if (parsed.error) acc += `\n\n⚠️ ${parsed.error}`;
          } catch {}
        }
        setAiContent(acc);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') setAiContent('AI 分析暂时不可用，请稍后重试。');
    } finally {
      setAiLoading(false);
    }
  }, [selectedWorker]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {
        start_date: dateRange[0].format('YYYY-MM-DD'),
        end_date: dateRange[1].format('YYYY-MM-DD'),
      };
      if (selectedWorker) params.worker_id = selectedWorker;
      const res = await api.get('/workers/my-performance', { params });
      const d = res.data?.data ?? null;
      setData(d);
      if (d?.worker_options?.length) setIsAdmin(true);
    } catch { message.error('加载绩效数据失败'); setData(null); }
    finally { setLoading(false); }
  }, [dateRange, selectedWorker]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!data?.daily_production?.length || !chartRef.current) return;
    let mounted = true;
    import('echarts').then(echarts => {
      if (!mounted || !chartRef.current) return;
      if (chartInstance.current) chartInstance.current.dispose();
      const chart = echarts.init(chartRef.current);
      chartInstance.current = chart;

      const dates = data.daily_production.map(d => d.date);
      const qty = data.daily_production.map(d => d.qty);
      const printed = data.daily_production.map(d => d.printed || 0);
      const outbound = data.daily_production.map(d => d.outbound || 0);

      chart.setOption({
        tooltip: { trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.96)', borderColor: '#eee', textStyle: { color: '#333', fontSize: 12 } },
        legend: { data: ['审核产量', '打印标签', '出库数'], bottom: 0, textStyle: { fontSize: 11 } },
        grid: { left: 45, right: 15, top: 15, bottom: 35 },
        xAxis: { type: 'category', data: dates, axisLabel: { fontSize: 10, color: '#999', formatter: (v: string) => v.slice(5) }, axisLine: { lineStyle: { color: '#eee' } } },
        yAxis: { type: 'value', splitLine: { lineStyle: { color: '#f5f5f5' } }, axisLabel: { fontSize: 10, color: '#999' } },
        series: [
          {
            name: '审核产量', type: 'bar', data: qty, barMaxWidth: 12,
            itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#722ed1' }, { offset: 1, color: '#b37feb' }] }, borderRadius: [3, 3, 0, 0] },
          },
          {
            name: '打印标签', type: 'line', data: printed, smooth: true, symbol: 'circle', symbolSize: 4,
            lineStyle: { width: 2, color: '#1677ff' }, itemStyle: { color: '#1677ff' },
            areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(22,119,255,0.15)' }, { offset: 1, color: 'rgba(22,119,255,0.02)' }] } },
          },
          {
            name: '出库数', type: 'line', data: outbound, smooth: true, symbol: 'diamond', symbolSize: 4,
            lineStyle: { width: 2, color: '#52c41a' }, itemStyle: { color: '#52c41a' },
            areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(82,196,26,0.12)' }, { offset: 1, color: 'rgba(82,196,26,0.02)' }] } },
          },
        ],
      });

      const ro = new ResizeObserver(() => chart.resize());
      ro.observe(chartRef.current);
      return () => { ro.disconnect(); };
    });
    return () => { mounted = false; };
  }, [data]);

  useEffect(() => {
    if (!data?.sku_breakdown?.length || !compChartRef.current) return;
    let mounted = true;
    import('echarts').then(echarts => {
      if (!mounted || !compChartRef.current) return;
      if (compChartInstance.current) compChartInstance.current.dispose();
      const chart = echarts.init(compChartRef.current);
      compChartInstance.current = chart;

      const items = data.sku_breakdown.slice(0, 10);
      const skuNames = items.map(s => s.sku_name);

      chart.setOption({
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: 'rgba(255,255,255,0.96)', borderColor: '#eee', textStyle: { color: '#333', fontSize: 12 } },
        legend: { data: ['审核', '打印', '出库'], bottom: 0, textStyle: { fontSize: 11 } },
        grid: { left: 90, right: 15, top: 10, bottom: 35 },
        xAxis: { type: 'value', splitLine: { lineStyle: { color: '#f5f5f5' } }, axisLabel: { fontSize: 10, color: '#999' } },
        yAxis: { type: 'category', data: skuNames.reverse(), axisLabel: { fontSize: 11, color: '#666', width: 80, overflow: 'truncate' } },
        series: [
          { name: '审核', type: 'bar', data: items.map(s => s.qty).reverse(), barWidth: 8, itemStyle: { color: '#722ed1', borderRadius: [0, 3, 3, 0] } },
          { name: '打印', type: 'bar', data: items.map(s => s.print_qty || 0).reverse(), barWidth: 8, itemStyle: { color: '#1677ff', borderRadius: [0, 3, 3, 0] } },
          { name: '出库', type: 'bar', data: items.map(s => s.outbound || 0).reverse(), barWidth: 8, itemStyle: { color: '#52c41a', borderRadius: [0, 3, 3, 0] } },
        ],
      });

      const ro = new ResizeObserver(() => chart.resize());
      ro.observe(compChartRef.current);
      return () => { ro.disconnect(); };
    });
    return () => { mounted = false; };
  }, [data]);

  const handleRefresh = () => { setRefreshSpin(true); fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600)); };

  const handleMonthChange = (m: Dayjs | null) => {
    if (!m) return;
    setSelectedMonth(m);
    setDateRange(getMonthRange(m));
  };

  const rankIcon = data?.rank === 1 ? <CrownOutlined /> : data?.rank === 2 ? <StarOutlined /> : data?.rank === 3 ? <TrophyOutlined /> : <AimOutlined />;
  const rankColor = data?.rank === 1 ? '#faad14' : data?.rank === 2 ? '#bfbfbf' : data?.rank === 3 ? '#d48806' : '#722ed1';
  const monthLabel = selectedMonth.format('YYYY年M月');
  const titleText = isAdmin && data?.worker_name ? `${data.worker_name} 的绩效` : '我的绩效';

  const kpiCards = [
    {
      label: '审核产量', value: data?.period_total?.toLocaleString() ?? '-',
      icon: <FireOutlined />,
      gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', glow: 'rgba(114,46,209,0.15)',
      sub: data?.growth != null ? (
        <span style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 2 }}>
          {data.growth > 0 ? <ArrowUpOutlined /> : data.growth < 0 ? <ArrowDownOutlined /> : <MinusOutlined />}
          {Math.abs(data.growth)}% 较上期
        </span>
      ) : null,
    },
    {
      label: '打印标签', value: data?.period_printed?.toLocaleString() ?? '-',
      icon: <PrinterOutlined />,
      gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.15)',
      sub: <span style={{ fontSize: 11 }}>日均 {data?.period_printed && data.working_days ? Math.round(data.period_printed / data.working_days) : 0}</span>,
    },
    {
      label: '出库佣金', value: data?.total_commission != null ? `¥${data.total_commission.toFixed(2)}` : '-',
      icon: <DollarOutlined />,
      gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.15)',
      sub: <span style={{ fontSize: 11 }}>出库 {data?.total_outbound?.toLocaleString() ?? 0} 件</span>,
    },
    {
      label: '团队排名', value: data?.rank ? `#${data.rank}` : '-',
      icon: rankIcon,
      gradient: `linear-gradient(135deg, ${rankColor} 0%, ${rankColor}88 100%)`, glow: `${rankColor}25`,
      sub: <span style={{ fontSize: 11 }}>{data?.total_workers ?? 0}人 · 日均{data?.avg_daily?.toLocaleString() ?? 0} · {data?.working_days ?? 0}天</span>,
    },
  ];

  const columns: any[] = [
    {
      title: '#', key: 'rank', width: 50, align: 'center' as const,
      render: (_: any, __: any, idx: number) => {
        const colors = ['#faad14', '#bfbfbf', '#d48806'];
        const icons = [<CrownOutlined key="1" />, <StarOutlined key="2" />, <TrophyOutlined key="3" />];
        return idx < 3 ? <span style={{ color: colors[idx], fontSize: 16 }}>{icons[idx]}</span> : <span className="num" style={{ color: 'var(--text-4)', fontWeight: 600 }}>{idx + 1}</span>;
      },
    },
    {
      title: 'SKU', dataIndex: 'sku_name', width: 180,
      render: (v: string, r: SkuItem) => (
        <Space size={6}>
          <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 500, background: 'rgba(0,185,107,0.08)', color: '#00b96b', border: '1px solid rgba(0,185,107,0.1)' }}>{r.fruit_name}</span>
          <span style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: 13 }}>{v}</span>
        </Space>
      ),
    },
    {
      title: '审核', dataIndex: 'qty', width: 75, align: 'right' as const,
      render: (v: number) => <span className="num" style={{ fontWeight: 700, color: '#722ed1' }}>{v.toLocaleString()}</span>,
      sorter: (a: SkuItem, b: SkuItem) => a.qty - b.qty,
    },
    {
      title: '打印', dataIndex: 'print_qty', width: 75, align: 'right' as const,
      render: (v: number) => <span className="num" style={{ fontWeight: 600, color: '#1677ff' }}>{(v || 0).toLocaleString()}</span>,
    },
    {
      title: '出库', dataIndex: 'outbound', width: 70, align: 'right' as const,
      render: (v: number) => <span className="num" style={{ fontWeight: 600, color: '#52c41a' }}>{(v || 0).toLocaleString()}</span>,
    },
    {
      title: '佣金', dataIndex: 'commission', width: 85, align: 'right' as const,
      render: (v: number) => v != null ? <span className="num" style={{ fontWeight: 700, color: '#fa8c16' }}>¥{v.toFixed(2)}</span> : '-',
      sorter: (a: SkuItem, b: SkuItem) => (a.commission || 0) - (b.commission || 0),
    },
    {
      title: '系数', dataIndex: 'performance', width: 60, align: 'center' as const,
      render: (v: number) => v ? <Tag color="purple" style={{ borderRadius: 4, fontSize: 11, margin: 0 }}>{v}</Tag> : '-',
    },
    {
      title: '占比', key: 'pct', width: 110,
      render: (_: any, r: SkuItem) => {
        const total = data?.period_total || 1;
        const pct = Math.round((r.qty / total) * 100);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ flex: 1, height: 4, background: 'rgba(0,0,0,0.04)', borderRadius: 2, overflow: 'hidden', minWidth: 30 }}>
              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: 'linear-gradient(90deg, #722ed1, #eb2f96)' }} />
            </div>
            <span className="num" style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', minWidth: 28, textAlign: 'right' }}>{pct}%</span>
          </div>
        );
      },
    },
  ];

  const { isMobile } = useDevice();
  const { user } = useAuth();
  const isWorkerMobile = isMobile && user?.role === 'worker';

  if (isWorkerMobile) {
    return (
      <div className="wm-perf">
        <div className="wm-perf-header">
          <h1>我的绩效</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <DatePicker
              picker="month"
              value={selectedMonth}
              onChange={handleMonthChange}
              allowClear={false}
              disabledDate={(d) => d.isAfter(dayjs(), 'month')}
              style={{ borderRadius: 10, width: 120 }}
              format="YYYY.MM"
              size="small"
            />
            <button className="wm-perf-refresh" onClick={handleRefresh}>
              <ReloadOutlined spin={refreshSpin} />
            </button>
          </div>
        </div>
        <div className="wm-perf-month-label">
          <CalendarOutlined /> {monthLabel}绩效数据
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>
        ) : !data ? (
          <Empty description="暂无绩效数据" />
        ) : (
          <>
            {/* KPI 卡片 */}
            <div className="wm-perf-kpi-grid">
              {kpiCards.map((s, i) => (
                <div key={i} className="wm-perf-kpi" style={{ background: s.gradient, animationDelay: `${i * 0.08}s` }}>
                  <div className="wm-perf-kpi-icon">{s.icon}</div>
                  <div className="wm-perf-kpi-val">{s.value}</div>
                  <div className="wm-perf-kpi-label">{s.label}</div>
                  {s.sub && <div className="wm-perf-kpi-sub">{s.sub}</div>}
                </div>
              ))}
            </div>

            {/* 排名卡片 */}
            {data.rank > 0 && (
              <div className="wm-perf-rank-card">
                <div className="wm-perf-rank-badge" style={{ background: `linear-gradient(135deg, ${rankColor}, ${rankColor}88)` }}>
                  #{data.rank}
                </div>
                <div className="wm-perf-rank-info">
                  <div className="wm-perf-rank-text">{data.total_workers} 位工人中第 {data.rank} 名</div>
                  <div className="wm-perf-rank-bar">
                    <div className="wm-perf-rank-fill" style={{
                      width: `${Math.round(((data.total_workers - data.rank + 1) / data.total_workers) * 100)}%`,
                    }} />
                  </div>
                  <div className="wm-perf-rank-pct">
                    超过 {Math.round(((data.total_workers - data.rank) / data.total_workers) * 100)}% 的工人
                  </div>
                </div>
              </div>
            )}

            {/* 转化率 */}
            <div className="wm-perf-rates">
              <div className="wm-perf-rate">
                <div className="wm-perf-rate-val">
                  {data.period_total > 0 ? Math.round(((data.period_printed || 0) / data.period_total) * 100) : 0}%
                </div>
                <div className="wm-perf-rate-label">审核→打印</div>
              </div>
              <div className="wm-perf-rate-divider" />
              <div className="wm-perf-rate">
                <div className="wm-perf-rate-val">
                  {(data.period_printed || 0) > 0 ? Math.round(((data.period_outbound || 0) / (data.period_printed || 1)) * 100) : 0}%
                </div>
                <div className="wm-perf-rate-label">打印→出库</div>
              </div>
              <div className="wm-perf-rate-divider" />
              <div className="wm-perf-rate">
                <div className="wm-perf-rate-val" style={{ color: data.vs_avg >= 1 ? '#52c41a' : '#ff4d4f' }}>
                  {data.vs_avg}x
                </div>
                <div className="wm-perf-rate-label">对比均值</div>
              </div>
            </div>

            {/* SKU 明细 */}
            <div className="wm-perf-section">
              <div className="wm-perf-section-head">
                <span>SKU 生产明细</span>
                <span className="wm-perf-section-count">{data.sku_breakdown?.length ?? 0} 种</span>
              </div>
              {data.sku_breakdown?.length ? data.sku_breakdown.map((s, i) => (
                <div key={s.sku_id} className="wm-perf-sku-item">
                  <div className="wm-perf-sku-rank">
                    {i < 3 ? ['🥇', '🥈', '🥉'][i] : <span>{i + 1}</span>}
                  </div>
                  <div className="wm-perf-sku-info">
                    <div className="wm-perf-sku-name">{s.sku_name}</div>
                    <div className="wm-perf-sku-fruit">{s.fruit_name}</div>
                  </div>
                  <div className="wm-perf-sku-stats">
                    <div className="wm-perf-sku-qty">{s.qty}</div>
                    <div className="wm-perf-sku-commission">
                      {s.commission != null ? `¥${s.commission.toFixed(0)}` : '-'}
                    </div>
                  </div>
                </div>
              )) : (
                <div className="wm-perf-empty">暂无 SKU 数据</div>
              )}
            </div>

            {/* AI 分析按钮 */}
            <button className="wm-perf-ai-btn" onClick={fetchAIInsight}>
              <RobotOutlined /> AI 绩效分析
            </button>
          </>
        )}

        <Modal
          open={aiOpen}
          onCancel={() => { setAiOpen(false); aiAbortRef.current?.abort(); }}
          footer={null}
          width="92vw"
          style={{ maxWidth: 500 }}
          title={<span style={{ fontWeight: 700 }}><RobotOutlined /> AI 绩效分析</span>}
        >
          <div style={{ padding: '12px 0', minHeight: 150, fontSize: 14, lineHeight: 1.8 }}>
            {aiLoading && !aiContent && (
              <div style={{ textAlign: 'center', padding: 30 }}>
                <Spin size="large" />
                <div style={{ marginTop: 12, color: 'var(--text-3)' }}>正在分析...</div>
              </div>
            )}
            {aiContent && (
              <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-1)' }}>
                {aiContent.split(/(\*\*.*?\*\*|\n)/g).map((part, i) => {
                  if (part === '\n') return <br key={i} />;
                  if (part.startsWith('**') && part.endsWith('**'))
                    return <strong key={i} style={{ color: '#722ed1' }}>{part.slice(2, -2)}</strong>;
                  return <span key={i}>{part}</span>;
                })}
              </div>
            )}
          </div>
        </Modal>

        <style jsx global>{`
          .wm-perf { padding: 16px; }

          .wm-perf-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 4px 0 8px;
          }

          .wm-perf-header h1 {
            font-size: 24px;
            font-weight: 800;
            color: var(--text-1);
            margin: 0;
          }

          .wm-perf-month-label {
            font-size: 13px;
            font-weight: 600;
            color: var(--brand, #1677ff);
            margin-bottom: 14px;
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 6px 12px;
            border-radius: 10px;
            background: rgba(22,119,255,0.06);
            border: 1px solid rgba(22,119,255,0.1);
          }

          .wm-perf-refresh {
            width: 38px;
            height: 38px;
            border-radius: 12px;
            border: 1px solid var(--border-1);
            background: var(--bg-card);
            color: var(--text-3);
            font-size: 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .wm-perf-kpi-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin-bottom: 14px;
          }

          .wm-perf-kpi {
            border-radius: 16px;
            padding: 14px;
            position: relative;
            overflow: hidden;
            animation: wmFadeUp 0.4s ease-out both;
          }

          .wm-perf-kpi::after {
            content: '';
            position: absolute;
            top: -12px;
            right: -12px;
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: rgba(255,255,255,0.12);
          }

          .wm-perf-kpi-icon { font-size: 16px; color: rgba(255,255,255,0.8); margin-bottom: 6px; }
          .wm-perf-kpi-val { font-size: 24px; font-weight: 800; color: #fff; line-height: 1.2; }
          .wm-perf-kpi-label { font-size: 12px; color: rgba(255,255,255,0.7); margin-top: 2px; }
          .wm-perf-kpi-sub { font-size: 11px; color: rgba(255,255,255,0.6); margin-top: 2px; }

          .wm-perf-rank-card {
            display: flex;
            align-items: center;
            gap: 16px;
            padding: 16px 18px;
            border-radius: 16px;
            background: var(--bg-card);
            border: 1px solid var(--border-1);
            margin-bottom: 14px;
          }

          .wm-perf-rank-badge {
            width: 56px;
            height: 56px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
            font-weight: 800;
            color: #fff;
            flex-shrink: 0;
          }

          .wm-perf-rank-info { flex: 1; }
          .wm-perf-rank-text { font-size: 14px; font-weight: 600; color: var(--text-1); margin-bottom: 8px; }

          .wm-perf-rank-bar {
            height: 6px;
            border-radius: 3px;
            background: rgba(0,0,0,0.04);
            overflow: hidden;
            margin-bottom: 6px;
          }

          .wm-perf-rank-fill {
            height: 100%;
            border-radius: 3px;
            background: linear-gradient(90deg, #722ed1, #eb2f96);
            transition: width 0.6s ease;
          }

          .wm-perf-rank-pct { font-size: 12px; color: var(--text-3); }

          .wm-perf-rates {
            display: flex;
            align-items: center;
            background: var(--bg-card);
            border-radius: 16px;
            padding: 16px 0;
            margin-bottom: 14px;
            border: 1px solid var(--border-1);
          }

          .wm-perf-rate { flex: 1; text-align: center; }
          .wm-perf-rate-val { font-size: 22px; font-weight: 700; color: var(--brand); }
          .wm-perf-rate-label { font-size: 11px; color: var(--text-4); margin-top: 4px; }
          .wm-perf-rate-divider { width: 1px; height: 36px; background: var(--border-1); }

          .wm-perf-section {
            background: var(--bg-card);
            border-radius: 16px;
            border: 1px solid var(--border-1);
            margin-bottom: 14px;
            overflow: hidden;
          }

          .wm-perf-section-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 16px;
            font-size: 15px;
            font-weight: 700;
            color: var(--text-1);
          }

          .wm-perf-section-count {
            font-size: 12px;
            font-weight: 500;
            color: var(--text-4);
          }

          .wm-perf-sku-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 16px;
            border-top: 1px solid var(--border-2, rgba(0,0,0,0.04));
          }

          .wm-perf-sku-rank {
            width: 28px;
            text-align: center;
            font-size: 16px;
            color: var(--text-4);
            font-weight: 600;
            flex-shrink: 0;
          }

          .wm-perf-sku-info { flex: 1; min-width: 0; }
          .wm-perf-sku-name { font-size: 14px; font-weight: 600; color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .wm-perf-sku-fruit { font-size: 12px; color: var(--text-3); margin-top: 2px; }

          .wm-perf-sku-stats { text-align: right; flex-shrink: 0; }
          .wm-perf-sku-qty { font-size: 18px; font-weight: 700; color: #722ed1; }
          .wm-perf-sku-commission { font-size: 12px; color: #fa8c16; font-weight: 600; }

          .wm-perf-empty {
            padding: 30px;
            text-align: center;
            color: var(--text-4);
            font-size: 13px;
          }

          .wm-perf-ai-btn {
            width: 100%;
            padding: 14px;
            border-radius: 16px;
            border: none;
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: #fff;
            font-size: 16px;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            box-shadow: 0 4px 16px rgba(102,126,234,0.3);
            margin-bottom: 20px;
            -webkit-tap-highlight-color: transparent;
          }

          .wm-perf-ai-btn:active { transform: scale(0.98); }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* ── 页头 ── */}
      <div className="stagger-in" style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22,
        padding: '20px 24px', borderRadius: 'var(--radius-l)',
        background: 'linear-gradient(135deg, rgba(114,46,209,0.06) 0%, rgba(235,47,150,0.04) 50%, rgba(22,119,255,0.03) 100%)',
        border: '1px solid rgba(114,46,209,0.08)',
        flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 36, height: 36, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #722ed1 0%, #eb2f96 100%)', color: '#fff', fontSize: 17,
              boxShadow: '0 4px 14px rgba(114,46,209,0.25)',
            }}><ThunderboltOutlined /></span>
            {titleText}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 46 }}>
            {monthLabel} · 审核产量 · 打印标签 · 出库佣金 三维对比分析
          </div>
        </div>
        <Space wrap size={8}>
          {isAdmin && data?.worker_options?.length ? (
            <Select
              placeholder="选择工人"
              allowClear
              showSearch
              optionFilterProp="label"
              value={selectedWorker}
              onChange={v => setSelectedWorker(v)}
              style={{ width: 140, borderRadius: 10 }}
              options={data.worker_options.map(w => ({ value: w.id, label: w.name }))}
            />
          ) : null}
          <DatePicker
            picker="month"
            value={selectedMonth}
            onChange={handleMonthChange}
            allowClear={false}
            disabledDate={(d) => d.isAfter(dayjs(), 'month')}
            style={{ borderRadius: 10, width: 140 }}
            format="YYYY年MM月"
          />
          <Tooltip title="导出CSV">
            <Button icon={<DownloadOutlined />} onClick={() => {
              if (!data?.sku_breakdown?.length) { message.warning('暂无数据'); return; }
              exportToCsv(data.sku_breakdown, [
                { key: 'sku_name', title: 'SKU' }, { key: 'fruit_name', title: '水果' },
                { key: 'qty', title: '审核产量' }, { key: 'print_qty', title: '打印数' },
                { key: 'outbound', title: '出库数' }, { key: 'commission', title: '佣金' },
                { key: 'performance', title: '绩效系数' },
              ], `绩效报表_${data.worker_name || ''}_${dateRange[0].format('YYYYMMDD')}_${dateRange[1].format('YYYYMMDD')}`);
            }} style={{ borderRadius: 10, height: 38, width: 38 }} />
          </Tooltip>
          <Tooltip title="AI 绩效分析">
            <Button
              icon={<RobotOutlined />}
              onClick={fetchAIInsight}
              style={{
                borderRadius: 10, height: 38,
                background: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none',
                color: '#fff', boxShadow: '0 3px 10px rgba(102,126,234,0.3)',
              }}
            >AI 分析</Button>
          </Tooltip>
          <Tooltip title="刷新数据">
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 10, height: 38, width: 38 }} />
          </Tooltip>
        </Space>
      </div>

      {/* ── KPI 卡片 ── */}
      <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
        {kpiCards.map((s, i) => (
          <Col xs={12} sm={6} key={i}>
            <div className="stagger-in" style={{
              padding: '16px 18px', borderRadius: 'var(--radius-m)', background: s.gradient, position: 'relative', overflow: 'hidden',
              boxShadow: `0 4px 14px ${s.glow}`, transition: 'all 0.3s', cursor: 'default', animationDelay: `${i * 60}ms`,
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
            >
              <div style={{ position: 'absolute', top: -14, right: -14, width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>{s.icon} {s.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', lineHeight: 1.2, marginBottom: 2 }} className="num">{s.value}</div>
              {s.sub && <div style={{ color: 'rgba(255,255,255,0.7)' }}>{s.sub}</div>}
            </div>
          </Col>
        ))}
      </Row>

      {/* ── 三维对比概览 ── */}
      {data && (
        <div className="panel stagger-in" style={{ padding: '16px 24px', marginBottom: 18, animationDelay: '200ms' }}>
          <Row gutter={24} align="middle">
            <Col xs={24} sm={8}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}><PrinterOutlined /> 审核 → 打印 转化率</div>
                <Progress type="circle" size={70}
                  percent={data.period_total > 0 ? Math.min(100, Math.round(((data.period_printed || 0) / data.period_total) * 100)) : 0}
                  strokeColor={{ '0%': '#722ed1', '100%': '#1677ff' }}
                  format={pct => <span style={{ fontSize: 16, fontWeight: 700 }}>{pct}%</span>}
                />
              </div>
            </Col>
            <Col xs={24} sm={8}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}><ExportOutlined /> 打印 → 出库 转化率</div>
                <Progress type="circle" size={70}
                  percent={(data.period_printed || 0) > 0 ? Math.min(100, Math.round(((data.period_outbound || 0) / (data.period_printed || 1)) * 100)) : 0}
                  strokeColor={{ '0%': '#1677ff', '100%': '#52c41a' }}
                  format={pct => <span style={{ fontSize: 16, fontWeight: 700 }}>{pct}%</span>}
                />
              </div>
            </Col>
            <Col xs={24} sm={8}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}><SwapOutlined /> 对比团队均值</div>
                <Progress type="circle" size={70}
                  percent={Math.min(100, Math.round((data.vs_avg || 0) * 50))}
                  strokeColor={data.vs_avg >= 1 ? { '0%': '#52c41a', '100%': '#95de64' } : { '0%': '#ff4d4f', '100%': '#ff7875' }}
                  format={() => <span style={{ fontSize: 16, fontWeight: 700, color: data.vs_avg >= 1 ? '#52c41a' : '#ff4d4f' }}>{data.vs_avg}x</span>}
                />
              </div>
            </Col>
          </Row>
        </div>
      )}

      {/* ── 趋势图 + 排名 ── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 18 }}>
        <Col xs={24} lg={16}>
          <div className="panel stagger-in" style={{ animationDelay: '250ms' }}>
            <div className="panel-head">
              <span className="panel-title"><LineChartOutlined style={{ color: '#722ed1' }} /> 每日三维趋势</span>
              <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{monthLabel}</span>
            </div>
            <div style={{ padding: '8px 12px 12px' }}>
              <div ref={chartRef} style={{ height: 260, width: '100%' }} />
            </div>
          </div>
        </Col>
        <Col xs={24} lg={8}>
          <div className="panel stagger-in" style={{ height: '100%', animationDelay: '300ms' }}>
            <div className="panel-head">
              <span className="panel-title"><TrophyOutlined style={{ color: '#faad14' }} /> 排名概览</span>
            </div>
            <div style={{ padding: '16px 20px' }}>
              {data && data.rank > 0 ? (
                <>
                  <div style={{ textAlign: 'center', marginBottom: 16 }}>
                    <div style={{
                      width: 72, height: 72, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      background: `linear-gradient(135deg, ${rankColor}, ${rankColor}66)`,
                      boxShadow: `0 4px 20px ${rankColor}33`,
                      fontSize: 26, fontWeight: 800, color: '#fff',
                    }}>#{data.rank}</div>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', textAlign: 'center', marginBottom: 10 }}>
                    {data.total_workers} 位工人中第 {data.rank} 名
                  </div>
                  <Progress
                    percent={Math.round(((data.total_workers - data.rank + 1) / data.total_workers) * 100)}
                    strokeColor={{ from: '#722ed1', to: '#eb2f96' }}
                    trailColor="rgba(0,0,0,0.04)"
                    style={{ marginBottom: 8 }}
                  />
                  <div style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>
                    超过 {Math.round(((data.total_workers - data.rank) / data.total_workers) * 100)}% 的工人
                    {data.vs_avg >= 1 && <Tag color="success" style={{ borderRadius: 6, marginLeft: 6, fontSize: 11 }}>高于均值</Tag>}
                    {data.vs_avg < 1 && data.vs_avg > 0 && <Tag color="warning" style={{ borderRadius: 6, marginLeft: 6, fontSize: 11 }}>低于均值</Tag>}
                  </div>
                  <div style={{ marginTop: 16 }}>
                    <Row gutter={[8, 8]}>
                      <Col span={12}>
                        <div style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(114,46,209,0.04)', textAlign: 'center' }}>
                          <div style={{ fontSize: 11, color: 'var(--text-4)' }}>团队均值</div>
                          <div className="num" style={{ fontSize: 16, fontWeight: 700, color: '#722ed1' }}>{data.team_avg.toLocaleString()}</div>
                        </div>
                      </Col>
                      <Col span={12}>
                        <div style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(250,140,22,0.04)', textAlign: 'center' }}>
                          <div style={{ fontSize: 11, color: 'var(--text-4)' }}>日均产量</div>
                          <div className="num" style={{ fontSize: 16, fontWeight: 700, color: '#fa8c16' }}>{data.avg_daily}</div>
                        </div>
                      </Col>
                    </Row>
                  </div>
                </>
              ) : <Empty description="暂无排名数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            </div>
          </div>
        </Col>
      </Row>

      {/* ── SKU三维对比图 ── */}
      <div className="panel stagger-in" style={{ marginBottom: 18, animationDelay: '350ms' }}>
        <div className="panel-head">
          <span className="panel-title"><BarChartOutlined style={{ color: '#eb2f96' }} /> SKU 三维对比</span>
          <span style={{ fontSize: 12, color: 'var(--text-4)' }}>审核 vs 打印 vs 出库</span>
        </div>
        <div style={{ padding: '8px 12px 12px' }}>
          <div ref={compChartRef} style={{ height: Math.max(200, (data?.sku_breakdown?.length || 0) * 30 + 50), width: '100%' }} />
        </div>
      </div>

      {/* ── SKU 明细表格 ── */}
      <div className="panel stagger-in" style={{ animationDelay: '400ms' }}>
        <div className="panel-head">
          <span className="panel-title"><CalendarOutlined style={{ color: '#1677ff' }} /> SKU 生产明细</span>
          <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{data?.sku_breakdown?.length ?? 0} 种 SKU</span>
        </div>
        <Table
          rowKey="sku_id"
          dataSource={data?.sku_breakdown ?? []}
          loading={loading}
          size="middle"
          pagination={data?.sku_breakdown && data.sku_breakdown.length > 15 ? { pageSize: 15, showTotal: t => `共 ${t} 种` } : false}
          locale={{ emptyText: <Empty description="暂无 SKU 生产数据" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          scroll={{ x: 750 }}
          columns={columns}
          summary={pageData => {
            if (!pageData.length) return null;
            const totalQty = pageData.reduce((a, d) => a + (d.qty || 0), 0);
            const totalPrint = pageData.reduce((a, d) => a + (d.print_qty || 0), 0);
            const totalOutbound = pageData.reduce((a, d) => a + (d.outbound || 0), 0);
            const totalComm = pageData.reduce((a, d) => a + (d.commission || 0), 0);
            return (
              <Table.Summary fixed>
                <Table.Summary.Row style={{ background: 'rgba(114,46,209,0.03)' }}>
                  <Table.Summary.Cell index={0} colSpan={2}><span style={{ fontWeight: 700, color: 'var(--text-1)' }}>合计</span></Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right"><span className="num" style={{ fontWeight: 700, color: '#722ed1' }}>{totalQty.toLocaleString()}</span></Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right"><span className="num" style={{ fontWeight: 700, color: '#1677ff' }}>{totalPrint.toLocaleString()}</span></Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right"><span className="num" style={{ fontWeight: 700, color: '#52c41a' }}>{totalOutbound.toLocaleString()}</span></Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="right"><span className="num" style={{ fontWeight: 700, color: '#fa8c16' }}>¥{totalComm.toFixed(2)}</span></Table.Summary.Cell>
                  <Table.Summary.Cell index={6}></Table.Summary.Cell>
                  <Table.Summary.Cell index={7} align="right"><span className="num" style={{ fontWeight: 700 }}>100%</span></Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            );
          }}
        />
      </div>

      <Modal
        open={aiOpen}
        onCancel={() => { setAiOpen(false); aiAbortRef.current?.abort(); }}
        footer={null}
        width={600}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar size={32} icon={<RobotOutlined />} style={{
              background: 'linear-gradient(135deg, #667eea, #764ba2)',
              boxShadow: '0 3px 10px rgba(102,126,234,0.3)',
            }} />
            <span style={{ fontWeight: 700 }}>AI 绩效分析报告</span>
            <Tag color="purple" style={{ borderRadius: 8, fontSize: 11 }}>Qwen AI</Tag>
          </div>
        }
      >
        <div style={{
          padding: '16px 0', minHeight: 200, fontSize: 14, lineHeight: 1.8,
          color: 'var(--text-1)',
        }}>
          {aiLoading && !aiContent && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <Spin size="large" />
              <div style={{ marginTop: 12, color: 'var(--text-3)' }}>正在分析绩效数据...</div>
            </div>
          )}
          {aiContent && (
            <div style={{ whiteSpace: 'pre-wrap' }}>
              {aiContent.split(/(\*\*.*?\*\*|\n)/g).map((part, i) => {
                if (part === '\n') return <br key={i} />;
                if (part.startsWith('**') && part.endsWith('**'))
                  return <strong key={i} style={{ color: '#722ed1' }}>{part.slice(2, -2)}</strong>;
                return <span key={i}>{part}</span>;
              })}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
