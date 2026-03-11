'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Select, DatePicker, Button, Table, Tag, Tooltip, Row, Col,
  Segmented, Collapse, Empty, Spin, message, Avatar, Space, Statistic,
} from 'antd';
import {
  InboxOutlined, SearchOutlined, ReloadOutlined, UserOutlined,
  CalendarOutlined, DollarOutlined, PrinterOutlined,
  FileExcelOutlined, DownloadOutlined, ExpandOutlined,
  TeamOutlined, ShoppingCartOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

interface WorkerItem {
  id: number;
  sku_id: number;
  sku_name: string;
  sku_description: string;
  fruit_name: string;
  warehouse_quantity: number;
  printed_quantity: number;
  production_date: string;
  commission: number;
}

interface WorkerGroup {
  worker_id: number;
  worker_name: string;
  total_qty: number;
  total_printed: number;
  total_commission: number;
  items: WorkerItem[];
}

interface QueryResult {
  filter_type: string;
  date_range: { start: string; end: string };
  worker_count: number;
  grand_totals: { total_qty: number; total_printed: number; total_commission: number };
  workers: WorkerGroup[];
  worker_options: { id: number; name: string }[];
}

const GRADIENT_COLORS = [
  { bg: 'linear-gradient(135deg, #1677ff, #69b1ff)', glow: 'rgba(22,119,255,0.15)' },
  { bg: 'linear-gradient(135deg, #00b96b, #5cdbd3)', glow: 'rgba(0,185,107,0.15)' },
  { bg: 'linear-gradient(135deg, #722ed1, #b37feb)', glow: 'rgba(114,46,209,0.15)' },
  { bg: 'linear-gradient(135deg, #fa8c16, #ffc53d)', glow: 'rgba(250,140,22,0.15)' },
];

const WORKER_COLORS = ['#1677ff', '#00b96b', '#722ed1', '#fa8c16', '#eb2f96', '#13c2c2', '#f5222d', '#52c41a'];

export default function InventoryQueryPage() {
  const [filterType, setFilterType] = useState<string>('day');
  const [selectedDate, setSelectedDate] = useState(dayjs());
  const [selectedMonth, setSelectedMonth] = useState(dayjs());
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().subtract(6, 'day'), dayjs()]);
  const [workerId, setWorkerId] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<QueryResult | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [refreshSpin, setRefreshSpin] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { filter_type: filterType };
      if (filterType === 'day') {
        params.selected_date = selectedDate.format('YYYY-MM-DD');
      } else if (filterType === 'month') {
        params.selected_month = selectedMonth.format('YYYY-MM');
      } else if (filterType === 'range') {
        params.start_date = dateRange[0].format('YYYY-MM-DD');
        params.end_date = dateRange[1].format('YYYY-MM-DD');
      }
      if (workerId) params.worker_id = workerId;

      const res = await api.get('/reports/inventory-query', { params });
      setData(res.data?.data || null);
      if (res.data?.data?.workers?.length) {
        setExpandedKeys(res.data.data.workers.map((w: WorkerGroup) => String(w.worker_id)));
      }
    } catch { message.error('查询失败'); }
    finally { setLoading(false); }
  }, [filterType, selectedDate, selectedMonth, dateRange, workerId]);

  useEffect(() => { fetchData(); }, []);

  const handleSearch = () => { fetchData(); };
  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const exportCSV = () => {
    if (!data?.workers?.length) { message.warning('暂无数据'); return; }
    const headers = ['工人,SKU,水果,描述,审核数量,打印数量,差异,日期,佣金'];
    const rows = data.workers.flatMap(w =>
      w.items.map(item =>
        `${w.worker_name},${item.sku_name},${item.fruit_name},${item.sku_description},${item.warehouse_quantity},${item.printed_quantity},${item.warehouse_quantity - item.printed_quantity},${item.production_date},${item.commission}`
      )
    );
    const csv = '\uFEFF' + [...headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `入库查询_${data.date_range.start}_${data.date_range.end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('导出成功');
  };

  const displayRange = data ? `${data.date_range.start} ~ ${data.date_range.end}` : '';
  const stats = [
    { label: '参与工人', value: data?.worker_count ?? 0, icon: <TeamOutlined />, ...GRADIENT_COLORS[0], suffix: '人' },
    { label: '审核入库', value: data?.grand_totals?.total_qty ?? 0, icon: <InboxOutlined />, ...GRADIENT_COLORS[1], suffix: '件' },
    { label: '打印标签', value: data?.grand_totals?.total_printed ?? 0, icon: <PrinterOutlined />, ...GRADIENT_COLORS[2], suffix: '件' },
    { label: '总佣金', value: `¥${(data?.grand_totals?.total_commission ?? 0).toFixed(2)}`, icon: <DollarOutlined />, ...GRADIENT_COLORS[3], suffix: '' },
  ];

  const columns = [
    {
      title: 'SKU', dataIndex: 'sku_name', width: 160, ellipsis: true,
      render: (v: string, r: WorkerItem) => (
        <div>
          <span style={{ fontWeight: 600, fontSize: 13, color: '#1677ff' }}>{v}</span>
          <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 1 }}>{r.fruit_name}{r.sku_description ? ` · ${r.sku_description}` : ''}</div>
        </div>
      ),
    },
    {
      title: '审核数量', dataIndex: 'warehouse_quantity', width: 90, align: 'right' as const,
      render: (v: number) => <span className="num" style={{ fontWeight: 700, color: '#00b96b' }}>{v}</span>,
    },
    {
      title: '打印数量', dataIndex: 'printed_quantity', width: 90, align: 'right' as const,
      render: (v: number) => <span className="num" style={{ fontWeight: 600, color: '#1677ff' }}>{v}</span>,
    },
    {
      title: '差异', key: 'diff', width: 80, align: 'center' as const,
      render: (_: unknown, r: WorkerItem) => {
        const diff = r.warehouse_quantity - r.printed_quantity;
        return <Tag color={diff > 0 ? 'red' : diff < 0 ? 'green' : 'default'} style={{ borderRadius: 6, fontWeight: 600 }}>{diff > 0 ? '+' : ''}{diff}</Tag>;
      },
    },
    {
      title: '佣金', dataIndex: 'commission', width: 90, align: 'right' as const,
      render: (v: number) => <span style={{ fontWeight: 600, color: '#722ed1' }}>¥{v.toFixed(2)}</span>,
    },
    {
      title: '日期', dataIndex: 'production_date', width: 100,
      render: (v: string) => <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{v ? dayjs(v).format('MM-DD') : '-'}</span>,
    },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #4A6CF7 0%, #3A57E8 60%, #6B73FF 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: -40, right: -30, width: 180, height: 180,
          borderRadius: '50%', background: 'rgba(255,255,255,0.08)',
        }} />
        <div style={{
          position: 'absolute', bottom: -20, left: '40%', width: 120, height: 120,
          borderRadius: '50%', background: 'rgba(255,255,255,0.05)',
        }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
            <span style={{
              width: 44, height: 44, borderRadius: 14,
              background: 'rgba(255,255,255,0.2)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 22,
              backdropFilter: 'blur(10px)',
            }}><InboxOutlined /></span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>入库数据查询</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
                {displayRange && `查询范围：${displayRange}`}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Panel */}
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head">
          <span className="panel-title"><SearchOutlined style={{ color: '#1677ff' }} /> 查询条件</span>
          <Space>
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 8 }} />
            <Button icon={<DownloadOutlined />} onClick={exportCSV} style={{ borderRadius: 8 }}>导出</Button>
          </Space>
        </div>
        <div style={{ padding: '16px 20px' }}>
          <div style={{ marginBottom: 14 }}>
            <Segmented
              value={filterType}
              onChange={v => setFilterType(v as string)}
              options={[
                { value: 'day', label: <span><CalendarOutlined style={{ marginRight: 4 }} />按日</span> },
                { value: 'month', label: <span><CalendarOutlined style={{ marginRight: 4 }} />按月</span> },
                { value: 'range', label: <span><CalendarOutlined style={{ marginRight: 4 }} />区间</span> },
              ]}
              style={{ borderRadius: 10 }}
            />
          </div>
          <Row gutter={[12, 12]} align="bottom">
            <Col xs={24} sm={8}>
              {filterType === 'day' && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>选择日期</div>
                  <DatePicker value={selectedDate} onChange={v => v && setSelectedDate(v)}
                    style={{ width: '100%', borderRadius: 8 }} allowClear={false} />
                </div>
              )}
              {filterType === 'month' && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>选择月份</div>
                  <DatePicker.MonthPicker value={selectedMonth} onChange={v => v && setSelectedMonth(v)}
                    style={{ width: '100%', borderRadius: 8 }} allowClear={false} />
                </div>
              )}
              {filterType === 'range' && (
                <div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>日期区间</div>
                  <RangePicker value={dateRange} onChange={v => v && setDateRange(v as [dayjs.Dayjs, dayjs.Dayjs])}
                    style={{ width: '100%', borderRadius: 8 }} />
                </div>
              )}
            </Col>
            <Col xs={24} sm={8}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>选择工人</div>
                <Select
                  value={workerId}
                  onChange={v => setWorkerId(v)}
                  allowClear placeholder="全部工人"
                  style={{ width: '100%', borderRadius: 8 }}
                  options={[
                    ...(data?.worker_options || []).map(w => ({ value: w.id, label: w.name })),
                  ]}
                />
              </div>
            </Col>
            <Col xs={24} sm={8}>
              <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch} loading={loading}
                style={{ width: '100%', borderRadius: 10, height: 40, fontWeight: 600, background: 'linear-gradient(135deg, #4A6CF7, #3A57E8)', border: 'none', boxShadow: '0 4px 14px rgba(74,108,247,0.3)' }}>
                查询数据
              </Button>
            </Col>
          </Row>
        </div>
      </div>

      {/* Stats */}
      {data && (
        <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
          {stats.map((s, i) => (
            <Col xs={12} sm={6} key={i}>
              <div style={{
                padding: '16px 18px', borderRadius: 14, background: s.bg,
                position: 'relative', overflow: 'hidden', boxShadow: `0 4px 16px ${s.glow}`,
                animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.08}s`,
              }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {s.icon} {s.label}
                </div>
                <div className="num" style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>{s.value}</div>
                {s.suffix && <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}>{s.suffix}</span>}
              </div>
            </Col>
          ))}
        </Row>
      )}

      {/* Data Info */}
      {data && data.grand_totals.total_qty > 0 && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div style={{
            padding: '12px 20px', borderRadius: 10,
            background: 'linear-gradient(135deg, rgba(22,119,255,0.04), rgba(0,185,107,0.03))',
            border: '1px solid rgba(22,119,255,0.08)',
            display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', fontSize: 13,
          }}>
            <span style={{ color: 'var(--text-3)' }}>数量差异（审核-打印）：</span>
            <Tag color={(data.grand_totals.total_qty - data.grand_totals.total_printed) > 0 ? 'red' : 'green'}
              style={{ borderRadius: 8, fontWeight: 700, fontSize: 14 }}>
              {(data.grand_totals.total_qty - data.grand_totals.total_printed) > 0 ? '+' : ''}
              {data.grand_totals.total_qty - data.grand_totals.total_printed} 件
            </Tag>
            <span style={{ color: 'var(--text-4)', fontSize: 12 }}>
              审核数量为库管已确认入库的数量，打印数量为实际打印的标签数量
            </span>
          </div>
        </div>
      )}

      {/* Workers Data */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : !data?.workers?.length ? (
        <div className="panel" style={{ padding: 60, textAlign: 'center' }}>
          <Empty description="所选时间范围内没有入库数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {data.workers.map((worker, wi) => {
            const color = WORKER_COLORS[wi % WORKER_COLORS.length];
            const isExpanded = expandedKeys.includes(String(worker.worker_id));
            const diff = worker.total_qty - worker.total_printed;

            return (
              <div key={worker.worker_id} className="panel" style={{
                border: `1px solid ${color}15`, overflow: 'hidden',
                animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`,
                animationDelay: `${wi * 0.06}s`,
              }}>
                {/* Worker Header */}
                <div
                  onClick={() => setExpandedKeys(prev =>
                    prev.includes(String(worker.worker_id))
                      ? prev.filter(k => k !== String(worker.worker_id))
                      : [...prev, String(worker.worker_id)]
                  )}
                  style={{
                    padding: '14px 20px', cursor: 'pointer',
                    background: `linear-gradient(135deg, ${color}10, ${color}05)`,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    borderBottom: isExpanded ? '1px solid var(--border-2)' : 'none',
                    transition: 'all 0.3s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Avatar size={36} style={{ background: color, fontWeight: 700, fontSize: 14 }}>
                      {worker.worker_name.charAt(0)}
                    </Avatar>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-1)' }}>{worker.worker_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{worker.items.length} 条记录</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <Tag style={{ borderRadius: 8, fontWeight: 600, background: `${color}12`, color, border: `1px solid ${color}30` }}>
                      审核 {worker.total_qty}
                    </Tag>
                    <Tag style={{ borderRadius: 8, fontWeight: 600, background: 'rgba(22,119,255,0.08)', color: '#1677ff', border: '1px solid rgba(22,119,255,0.2)' }}>
                      打印 {worker.total_printed}
                    </Tag>
                    {diff !== 0 && (
                      <Tag color={diff > 0 ? 'red' : 'green'} style={{ borderRadius: 8, fontWeight: 700 }}>
                        差异 {diff > 0 ? '+' : ''}{diff}
                      </Tag>
                    )}
                    <Tag style={{ borderRadius: 8, fontWeight: 700, background: 'rgba(114,46,209,0.08)', color: '#722ed1', border: '1px solid rgba(114,46,209,0.2)' }}>
                      ¥{worker.total_commission.toFixed(2)}
                    </Tag>
                    <ExpandOutlined style={{ color: 'var(--text-4)', fontSize: 12, transition: 'transform 0.3s', transform: isExpanded ? 'rotate(45deg)' : '' }} />
                  </div>
                </div>

                {/* Worker Detail Table */}
                {isExpanded && (
                  <div style={{ padding: '0' }}>
                    <Table
                      dataSource={worker.items}
                      columns={columns}
                      rowKey="id"
                      pagination={false}
                      size="small"
                      locale={{ emptyText: '暂无记录' }}
                      summary={() => (
                        <Table.Summary fixed>
                          <Table.Summary.Row style={{ background: 'var(--gray-2)', fontWeight: 700 }}>
                            <Table.Summary.Cell index={0}>合计</Table.Summary.Cell>
                            <Table.Summary.Cell index={1} align="right">
                              <span className="num" style={{ color: '#00b96b' }}>{worker.total_qty}</span>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={2} align="right">
                              <span className="num" style={{ color: '#1677ff' }}>{worker.total_printed}</span>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={3} align="center">
                              <Tag color={diff > 0 ? 'red' : diff < 0 ? 'green' : 'default'} style={{ borderRadius: 6 }}>
                                {diff > 0 ? '+' : ''}{diff}
                              </Tag>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={4} align="right">
                              <span style={{ color: '#722ed1' }}>¥{worker.total_commission.toFixed(2)}</span>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={5}></Table.Summary.Cell>
                          </Table.Summary.Row>
                        </Table.Summary>
                      )}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
