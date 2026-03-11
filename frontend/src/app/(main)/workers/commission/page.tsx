'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Table, Row, Col, DatePicker, Button, Space, message, Tag, Tooltip, Avatar,
  Collapse, Spin, Select,
} from 'antd';
import {
  DollarOutlined, ReloadOutlined, DownloadOutlined, TeamOutlined,
  ExportOutlined, PrinterOutlined, TrophyOutlined, RiseOutlined,
  BarChartOutlined, CalendarOutlined, ThunderboltOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import { useAuth } from '@/stores/useAuth';
import dayjs from 'dayjs';
import dynamic from 'next/dynamic';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

interface SkuDetail {
  sku_id: number; sku_name: string; fruit_name: string;
  performance: number; printed: number; outbound: number; commission: number;
}

interface WorkerCommission {
  worker_id: number; worker_name: string;
  total_printed: number; total_outbound: number; total_commission: number;
  sku_details: SkuDetail[];
}

interface CommissionData {
  start_date: string; end_date: string;
  summary: { total_commission: number; total_outbound: number; total_printed: number; worker_count: number };
  workers: WorkerCommission[];
}

function CommissionBarChart({ data }: { data: WorkerCommission[] }) {
  if (!data?.length) return <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)' }}>暂无数据</div>;
  const sorted = [...data].slice(0, 15).reverse();
  const option = {
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const p = params[0];
        const w = data.find(d => d.worker_name === p.name);
        return `<b>${p.name}</b><br/>佣金: ¥${Number(p.value).toFixed(2)}<br/>出库: ${w?.total_outbound ?? 0}<br/>打印: ${w?.total_printed ?? 0}`;
      },
    },
    grid: { top: 10, right: 80, bottom: 10, left: 10, containLabel: true },
    xAxis: {
      type: 'value', axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { color: '#f5f5f5', type: 'dashed' } },
      axisLabel: { color: '#8a919f', fontSize: 10, formatter: (v: number) => `¥${v}` },
    },
    yAxis: {
      type: 'category', data: sorted.map(w => w.worker_name),
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: '#525966', fontSize: 11 },
    },
    series: [{
      type: 'bar', barWidth: 18,
      data: sorted.map((w, i) => ({
        value: w.total_commission,
        itemStyle: {
          borderRadius: [0, 8, 8, 0],
          color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [
            { offset: 0, color: '#fa8c16' }, { offset: 1, color: '#ffc53d88' },
          ] },
        },
      })),
      label: { show: true, position: 'right', formatter: (p: any) => `¥${Number(p.value).toFixed(1)}`, color: '#525966', fontSize: 11, fontWeight: 600 },
      animationDelay: (idx: number) => idx * 50,
    }],
    animationDuration: 800,
  };
  return <ReactECharts option={option} style={{ height: Math.max(280, data.length * 32) }} notMerge />;
}

export default function WorkerCommissionPage() {
  const { user, isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<CommissionData | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().startOf('month'), dayjs()]);
  const [selectedWorker, setSelectedWorker] = useState<number | undefined>();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = {
        start_date: dateRange[0].format('YYYY-MM-DD'),
        end_date: dateRange[1].format('YYYY-MM-DD'),
      };
      if (selectedWorker) params.worker_id = selectedWorker;
      const res = await api.get('/workers/commission', { params });
      setData(res.data?.data ?? null);
    } catch { message.error('加载佣金数据失败'); }
    finally { setLoading(false); }
  }, [dateRange, selectedWorker]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const exportCSV = () => {
    if (!data?.workers?.length) { message.warning('无数据可导出'); return; }
    const header = '工人,打印数,出库数,佣金\n';
    const rows = data.workers.map(w => `${w.worker_name},${w.total_printed},${w.total_outbound},${w.total_commission.toFixed(2)}`).join('\n');
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + header + rows], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `工人佣金_${dateRange[0].format('YYYYMMDD')}-${dateRange[1].format('YYYYMMDD')}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    message.success('导出成功');
  };

  const s = data?.summary;
  const COLORS = ['#1677ff', '#00b96b', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2'];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22,
        padding: '20px 24px', borderRadius: 'var(--radius-l)',
        background: 'linear-gradient(135deg, rgba(250,140,22,0.06) 0%, rgba(114,46,209,0.03) 100%)',
        border: '1px solid rgba(250,140,22,0.08)',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 32, height: 32, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #fa8c16 0%, #722ed1 100%)', color: '#fff', fontSize: 15,
              boxShadow: '0 3px 10px rgba(250,140,22,0.25)',
            }}><DollarOutlined /></span>
            工人佣金
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 42 }}>
            佣金 = 出库数量 × SKU绩效系数 · {dateRange[0].format('YYYY.MM.DD')} - {dateRange[1].format('YYYY.MM.DD')}
          </div>
        </div>
        <Space size={8}>
          <Tooltip title="导出 CSV"><Button icon={<DownloadOutlined />} onClick={exportCSV} disabled={!data?.workers?.length} style={{ borderRadius: 10, height: 38, width: 38 }} /></Tooltip>
          <Tooltip title="刷新"><Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 10, height: 38, width: 38 }} /></Tooltip>
        </Space>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap', alignItems: 'center' }}>
        <DatePicker.RangePicker
          value={dateRange}
          onChange={(v) => { if (v?.[0] && v?.[1]) setDateRange([v[0], v[1]]); }}
          style={{ borderRadius: 8 }}
          presets={[
            { label: '本月', value: [dayjs().startOf('month'), dayjs()] },
            { label: '上月', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
            { label: '近7天', value: [dayjs().subtract(6, 'day'), dayjs()] },
            { label: '近30天', value: [dayjs().subtract(29, 'day'), dayjs()] },
          ]}
        />
        {isAdmin() && (
          <Select
            placeholder="全部工人" allowClear value={selectedWorker}
            onChange={v => setSelectedWorker(v)}
            style={{ width: 140, borderRadius: 8 }}
            options={data?.workers?.map(w => ({ value: w.worker_id, label: w.worker_name })) ?? []}
            showSearch optionFilterProp="label"
          />
        )}
      </div>

      {/* Summary Cards */}
      <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
        {[
          { label: '佣金总额', value: `¥${(s?.total_commission ?? 0).toFixed(2)}`, icon: <DollarOutlined />, gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.15)' },
          { label: '出库总量', value: (s?.total_outbound ?? 0).toLocaleString(), unit: '件', icon: <ExportOutlined />, gradient: 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: 'rgba(0,185,107,0.15)' },
          { label: '打印总量', value: (s?.total_printed ?? 0).toLocaleString(), unit: '件', icon: <PrinterOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.15)' },
          { label: '工人数', value: s?.worker_count ?? 0, unit: '人', icon: <TeamOutlined />, gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', glow: 'rgba(114,46,209,0.15)' },
        ].map((card, i) => (
          <Col xs={12} sm={6} key={i}>
            <div style={{
              padding: '16px 18px', borderRadius: 'var(--radius-m)', background: card.gradient,
              position: 'relative', overflow: 'hidden', boxShadow: `0 4px 14px ${card.glow}`, transition: 'all 0.3s',
              animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.08}s`,
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
            >
              <div style={{ position: 'absolute', top: -14, right: -14, width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>{card.icon} {card.label}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#fff', lineHeight: 1.2 }} className="num">
                {card.value}{'unit' in card && card.unit ? <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3, opacity: 0.7 }}>{card.unit}</span> : null}
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : data ? (
        <>
          {/* Commission Bar Chart */}
          <div className="panel" style={{ marginBottom: 18 }}>
            <div className="panel-head">
              <span className="panel-title"><BarChartOutlined style={{ color: '#fa8c16' }} />佣金排行</span>
              <Tag color="orange" style={{ borderRadius: 10, fontSize: 11 }}>{data.workers.length} 人</Tag>
            </div>
            <div className="panel-body">
              <CommissionBarChart data={data.workers} />
            </div>
          </div>

          {/* Worker Commission Table */}
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title"><TeamOutlined style={{ color: '#1677ff' }} />佣金明细</span>
            </div>
            <Table
              rowKey="worker_id"
              dataSource={data.workers}
              size="middle"
              pagination={{ pageSize: 20, showTotal: t => `共 ${t} 人` }}
              locale={{ emptyText: '暂无佣金数据' }}
              expandable={{
                expandedRowRender: (record: WorkerCommission) => (
                  <Table
                    rowKey="sku_id"
                    dataSource={record.sku_details}
                    size="small"
                    pagination={false}
                    columns={[
                      { title: 'SKU', dataIndex: 'sku_name', width: 160, render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span> },
                      { title: '水果', dataIndex: 'fruit_name', width: 80, render: (v: string) => <Tag style={{ borderRadius: 6 }}>{v}</Tag> },
                      { title: '绩效系数', dataIndex: 'performance', width: 90, align: 'center' as const, render: (v: number) => <span className="num" style={{ fontWeight: 600, color: '#722ed1' }}>{v}</span> },
                      { title: '打印数', dataIndex: 'printed', width: 80, align: 'right' as const, render: (v: number) => <span className="num">{v.toLocaleString()}</span> },
                      { title: '出库数', dataIndex: 'outbound', width: 80, align: 'right' as const, render: (v: number) => <span className="num" style={{ fontWeight: 600, color: '#00b96b' }}>{v.toLocaleString()}</span> },
                      { title: '佣金', dataIndex: 'commission', width: 100, align: 'right' as const, render: (v: number) => <span className="num" style={{ fontWeight: 700, color: '#fa8c16' }}>¥{v.toFixed(2)}</span> },
                    ]}
                  />
                ),
              }}
              columns={[
                {
                  title: '排名', key: 'rank', width: 60, align: 'center' as const,
                  render: (_: any, __: any, i: number) => {
                    const medals = ['🥇', '🥈', '🥉'];
                    return i < 3 ? <span style={{ fontSize: 16 }}>{medals[i]}</span> : <span className="num" style={{ color: 'var(--text-3)' }}>{i + 1}</span>;
                  },
                },
                {
                  title: '工人', dataIndex: 'worker_name', width: 150,
                  render: (v: string, r: WorkerCommission) => (
                    <Space size={8}>
                      <Avatar size={30} style={{ background: COLORS[(r.worker_id || 0) % COLORS.length], fontWeight: 700, fontSize: 12 }}>
                        {(v || '?').charAt(0)}
                      </Avatar>
                      <span style={{ fontWeight: 600 }}>{v}</span>
                    </Space>
                  ),
                },
                {
                  title: '打印数', dataIndex: 'total_printed', width: 100, align: 'right' as const,
                  render: (v: number) => <span className="num" style={{ fontWeight: 500 }}>{v.toLocaleString()}</span>,
                },
                {
                  title: '出库数', dataIndex: 'total_outbound', width: 100, align: 'right' as const,
                  render: (v: number) => <span className="num" style={{ fontWeight: 600, color: '#00b96b' }}>{v.toLocaleString()}</span>,
                  sorter: (a: WorkerCommission, b: WorkerCommission) => a.total_outbound - b.total_outbound,
                },
                {
                  title: '出库率', key: 'rate', width: 80, align: 'center' as const,
                  render: (_: any, r: WorkerCommission) => {
                    const rate = r.total_printed > 0 ? Math.round(r.total_outbound / r.total_printed * 100) : 0;
                    const color = rate >= 90 ? '#00b96b' : rate >= 70 ? '#fa8c16' : '#ff4d4f';
                    return <span className="num" style={{ fontWeight: 600, color }}>{rate}%</span>;
                  },
                },
                {
                  title: '佣金', dataIndex: 'total_commission', width: 130, align: 'right' as const,
                  render: (v: number) => <span className="num" style={{ fontWeight: 700, fontSize: 16, color: '#fa8c16' }}>¥{v.toFixed(2)}</span>,
                  sorter: (a: WorkerCommission, b: WorkerCommission) => a.total_commission - b.total_commission,
                  defaultSortOrder: 'descend' as const,
                },
                {
                  title: 'SKU数', key: 'sku_count', width: 70, align: 'center' as const,
                  render: (_: any, r: WorkerCommission) => <Tag style={{ borderRadius: 6 }}>{r.sku_details.length}</Tag>,
                },
              ]}
              summary={() => {
                if (!data.workers.length) return null;
                return (
                  <Table.Summary fixed>
                    <Table.Summary.Row style={{ background: 'rgba(250,140,22,0.04)' }}>
                      <Table.Summary.Cell index={0} colSpan={2}><span style={{ fontWeight: 700 }}>合计</span></Table.Summary.Cell>
                      <Table.Summary.Cell index={2} align="right"><span className="num" style={{ fontWeight: 700 }}>{data.summary.total_printed.toLocaleString()}</span></Table.Summary.Cell>
                      <Table.Summary.Cell index={3} align="right"><span className="num" style={{ fontWeight: 700, color: '#00b96b' }}>{data.summary.total_outbound.toLocaleString()}</span></Table.Summary.Cell>
                      <Table.Summary.Cell index={4} align="center">
                        <span className="num" style={{ fontWeight: 600 }}>
                          {data.summary.total_printed > 0 ? Math.round(data.summary.total_outbound / data.summary.total_printed * 100) : 0}%
                        </span>
                      </Table.Summary.Cell>
                      <Table.Summary.Cell index={5} align="right"><span className="num" style={{ fontWeight: 700, fontSize: 16, color: '#fa8c16' }}>¥{data.summary.total_commission.toFixed(2)}</span></Table.Summary.Cell>
                      <Table.Summary.Cell index={6} align="center"><span style={{ fontWeight: 600 }}>{data.summary.worker_count}人</span></Table.Summary.Cell>
                    </Table.Summary.Row>
                  </Table.Summary>
                );
              }}
            />
          </div>
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: 80, color: 'var(--text-4)' }}>暂无数据</div>
      )}
    </div>
  );
}
