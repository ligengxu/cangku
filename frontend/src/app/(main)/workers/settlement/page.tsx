'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  DatePicker, Button, Table, Tag, Tooltip, Row, Col,
  Select, Space, Empty, Spin, message, Avatar, Collapse,
  Descriptions, Divider, Modal,
} from 'antd';
import {
  DollarOutlined, ReloadOutlined, DownloadOutlined, TeamOutlined,
  PrinterOutlined, TrophyOutlined, RiseOutlined, FileTextOutlined,
  CalendarOutlined, UserOutlined, RobotOutlined, BulbOutlined,
  CheckCircleOutlined, ExclamationCircleOutlined, BarChartOutlined,
  ExpandOutlined, CompressOutlined, CopyOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

interface SkuSummary {
  sku_id: number; sku_name: string; fruit_name: string;
  performance: number; printed: number; outbound: number; commission: number;
}

interface DailyRecord {
  date: string; sku_id: number; sku_name: string; fruit_name: string;
  performance: number; printed: number; outbound: number;
  approved_qty: number; commission: number;
}

interface WorkerSettlement {
  worker_id: number; worker_name: string; phone: string; alipay: string;
  total_printed: number; total_outbound: number; total_commission: number;
  total_approved_qty: number; outbound_rate: number;
  daily_records: DailyRecord[]; sku_summary: SkuSummary[];
}

interface SettlementData {
  start_date: string; end_date: string; generated_at: string;
  summary: {
    total_commission: number; total_outbound: number; total_printed: number;
    total_approved: number; worker_count: number; avg_commission: number;
  };
  workers: WorkerSettlement[];
}

const GRADIENT_CARDS = [
  { bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', glow: 'rgba(102,126,234,0.2)' },
  { bg: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', glow: 'rgba(245,87,108,0.2)' },
  { bg: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', glow: 'rgba(79,172,254,0.2)' },
  { bg: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)', glow: 'rgba(67,233,123,0.2)' },
  { bg: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)', glow: 'rgba(250,112,154,0.2)' },
  { bg: 'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)', glow: 'rgba(161,140,209,0.2)' },
];

const WORKER_COLORS = ['#667eea', '#f5576c', '#4facfe', '#43e97b', '#fa709a', '#a18cd1', '#ff6b6b', '#48dbfb'];

export default function SettlementPage() {
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().startOf('month'), dayjs(),
  ]);
  const [workerId, setWorkerId] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SettlementData | null>(null);
  const [expandedWorker, setExpandedWorker] = useState<number | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiWorkerId, setAiWorkerId] = useState<number | null>(null);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {
        start_date: dateRange[0].format('YYYY-MM-DD'),
        end_date: dateRange[1].format('YYYY-MM-DD'),
      };
      if (workerId) params.worker_id = workerId;
      const res = await api.get('/workers/settlement', { params });
      setData(res.data?.data || null);
    } catch { message.error('获取结算数据失败'); }
    finally { setLoading(false); }
  }, [dateRange, workerId]);

  useEffect(() => { fetchData(); }, []);

  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const openAiAnalysis = async (wid: number) => {
    setAiWorkerId(wid);
    setAiContent('');
    setAiModalOpen(true);
    setAiLoading(true);

    try {
      abortRef.current = new AbortController();
      const response = await fetch(
        `/api/workers/settlement-ai-analysis?worker_id=${wid}&start_date=${dateRange[0].format('YYYY-MM-DD')}&end_date=${dateRange[1].format('YYYY-MM-DD')}`,
        {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
          signal: abortRef.current.signal,
        }
      );
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
            if (parsed.error) acc += `\n\n⚠️ ${parsed.error}`;
            else if (parsed.content) acc += parsed.content;
          } catch {}
        }
        setAiContent(acc);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') setAiContent('AI分析暂时不可用，请稍后重试。');
    } finally {
      setAiLoading(false);
      abortRef.current = null;
    }
  };

  const exportCSV = () => {
    if (!data?.workers?.length) { message.warning('暂无数据'); return; }
    const headers = ['工人,SKU,水果,绩效系数,打印数,出库数,审核数,佣金,日期'];
    const rows = data.workers.flatMap(w =>
      w.daily_records.map(r =>
        `${w.worker_name},${r.sku_name},${r.fruit_name},${r.performance},${r.printed},${r.outbound},${r.approved_qty},${r.commission},${r.date}`
      )
    );
    const csv = '\uFEFF' + [...headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `结算单_${data.start_date}_${data.end_date}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('导出成功');
  };

  const formatContent = (content: string) => {
    const parts = content.split(/(\*\*.*?\*\*|`[^`]+`|\n)/g);
    return parts.map((part, i) => {
      if (part === '\n') return <br key={i} />;
      if (part.startsWith('**') && part.endsWith('**'))
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('`') && part.endsWith('`'))
        return <code key={i} style={{ background: 'rgba(22,119,255,0.08)', padding: '1px 6px', borderRadius: 4, fontSize: 13, color: 'var(--brand)' }}>{part.slice(1, -1)}</code>;
      return <span key={i}>{part}</span>;
    });
  };

  const workerOptions = data?.workers?.map(w => ({ value: w.worker_id, label: w.worker_name })) || [];

  const skuColumns = [
    {
      title: 'SKU', key: 'sku', width: 180,
      render: (_: any, r: SkuSummary) => (
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{r.sku_name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{r.fruit_name} · 绩效 {r.performance}</div>
        </div>
      ),
    },
    { title: '打印', dataIndex: 'printed', width: 80, align: 'right' as const, render: (v: number) => <span className="num" style={{ fontWeight: 600 }}>{v}</span> },
    {
      title: '出库', dataIndex: 'outbound', width: 80, align: 'right' as const,
      render: (v: number) => <span className="num" style={{ fontWeight: 700, color: '#00b96b' }}>{v}</span>,
    },
    {
      title: '出库率', key: 'rate', width: 80, align: 'center' as const,
      render: (_: any, r: SkuSummary) => {
        const rate = r.printed > 0 ? (r.outbound / r.printed * 100) : 0;
        return <Tag color={rate >= 80 ? 'green' : rate >= 50 ? 'orange' : 'red'} style={{ borderRadius: 6, fontWeight: 600 }}>{rate.toFixed(0)}%</Tag>;
      },
    },
    {
      title: '佣金', dataIndex: 'commission', width: 100, align: 'right' as const,
      render: (v: number) => <span style={{ fontWeight: 700, color: '#722ed1' }}>¥{v.toFixed(2)}</span>,
    },
  ];

  const dailyColumns = [
    { title: '日期', dataIndex: 'date', width: 100, render: (v: string) => <span style={{ fontSize: 12, fontWeight: 500 }}>{dayjs(v).format('MM-DD')}</span> },
    { title: 'SKU', dataIndex: 'sku_name', width: 140, ellipsis: true, render: (v: string, r: DailyRecord) => <span style={{ fontSize: 12 }}>{v} <span style={{ color: 'var(--text-4)' }}>({r.fruit_name})</span></span> },
    { title: '打印', dataIndex: 'printed', width: 60, align: 'right' as const },
    { title: '出库', dataIndex: 'outbound', width: 60, align: 'right' as const, render: (v: number) => <span style={{ color: '#00b96b', fontWeight: 600 }}>{v}</span> },
    { title: '审核', dataIndex: 'approved_qty', width: 60, align: 'right' as const },
    { title: '佣金', dataIndex: 'commission', width: 80, align: 'right' as const, render: (v: number) => <span style={{ color: '#722ed1', fontWeight: 600 }}>¥{v.toFixed(2)}</span> },
  ];

  const stats = data?.summary;
  const statCards = [
    { label: '参与工人', value: stats?.worker_count ?? 0, suffix: '人', icon: <TeamOutlined />, ...GRADIENT_CARDS[0] },
    { label: '总佣金', value: `¥${(stats?.total_commission ?? 0).toFixed(2)}`, suffix: '', icon: <DollarOutlined />, ...GRADIENT_CARDS[1] },
    { label: '总出库', value: stats?.total_outbound ?? 0, suffix: '件', icon: <CheckCircleOutlined />, ...GRADIENT_CARDS[2] },
    { label: '总打印', value: stats?.total_printed ?? 0, suffix: '件', icon: <PrinterOutlined />, ...GRADIENT_CARDS[3] },
    { label: '人均佣金', value: `¥${(stats?.avg_commission ?? 0).toFixed(2)}`, suffix: '', icon: <BarChartOutlined />, ...GRADIENT_CARDS[4] },
    { label: '审核入库', value: stats?.total_approved ?? 0, suffix: '件', icon: <FileTextOutlined />, ...GRADIENT_CARDS[5] },
  ];

  return (
    <div style={{ maxWidth: 1300, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -40, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'absolute', bottom: -20, left: '35%', width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
            <span style={{
              width: 48, height: 48, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(10px)', fontSize: 24,
            }}><FileTextOutlined /></span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>佣金结算单</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
                {data ? `${data.start_date} ~ ${data.end_date} · 生成于 ${data.generated_at}` : '选择日期范围生成结算单'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head">
          <span className="panel-title"><CalendarOutlined style={{ color: '#667eea' }} /> 结算条件</span>
          <Space>
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 8 }} />
            <Button icon={<DownloadOutlined />} onClick={exportCSV} style={{ borderRadius: 8 }}>导出CSV</Button>
          </Space>
        </div>
        <div style={{ padding: '16px 20px' }}>
          <Row gutter={[12, 12]} align="bottom">
            <Col xs={24} sm={10}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>结算周期</div>
              <RangePicker
                value={dateRange}
                onChange={v => v && setDateRange(v as [dayjs.Dayjs, dayjs.Dayjs])}
                style={{ width: '100%', borderRadius: 10 }}
                presets={[
                  { label: '本月', value: [dayjs().startOf('month'), dayjs()] },
                  { label: '上月', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
                  { label: '近7天', value: [dayjs().subtract(6, 'day'), dayjs()] },
                  { label: '近30天', value: [dayjs().subtract(29, 'day'), dayjs()] },
                ]}
              />
            </Col>
            <Col xs={24} sm={8}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>指定工人（可选）</div>
              <Select
                value={workerId}
                onChange={setWorkerId}
                allowClear placeholder="全部工人"
                showSearch optionFilterProp="label"
                options={workerOptions}
                style={{ width: '100%', borderRadius: 10 }}
              />
            </Col>
            <Col xs={24} sm={6}>
              <Button type="primary" icon={<FileTextOutlined />} onClick={fetchData} loading={loading}
                style={{
                  width: '100%', borderRadius: 10, height: 40, fontWeight: 600,
                  background: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none',
                  boxShadow: '0 4px 14px rgba(102,126,234,0.35)',
                }}>
                生成结算单
              </Button>
            </Col>
          </Row>
        </div>
      </div>

      {/* Stats Cards */}
      {data && (
        <Row gutter={[10, 10]} style={{ marginBottom: 20 }}>
          {statCards.map((s, i) => (
            <Col xs={12} sm={8} md={4} key={i}>
              <div style={{
                padding: '14px 16px', borderRadius: 14, background: s.bg,
                position: 'relative', overflow: 'hidden', boxShadow: `0 4px 16px ${s.glow}`,
                animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.06}s`,
              }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                  {s.icon} {s.label}
                </div>
                <div className="num" style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{s.value}</div>
                {s.suffix && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>{s.suffix}</span>}
              </div>
            </Col>
          ))}
        </Row>
      )}

      {/* Workers Settlement */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : !data?.workers?.length ? (
        <div className="panel" style={{ padding: 60, textAlign: 'center' }}>
          <Empty description="所选周期内暂无结算数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {data.workers.map((worker, wi) => {
            const color = WORKER_COLORS[wi % WORKER_COLORS.length];
            const isExpanded = expandedWorker === worker.worker_id;
            const rank = wi + 1;

            return (
              <div key={worker.worker_id} className="panel" style={{
                border: `1px solid ${color}20`, overflow: 'hidden',
                animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`,
                animationDelay: `${wi * 0.05}s`,
              }}>
                {/* Worker Header */}
                <div
                  onClick={() => setExpandedWorker(isExpanded ? null : worker.worker_id)}
                  style={{
                    padding: '16px 20px', cursor: 'pointer',
                    background: `linear-gradient(135deg, ${color}08, ${color}03)`,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    borderBottom: isExpanded ? '1px solid var(--border-2)' : 'none',
                    transition: 'all 0.3s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    {rank <= 3 ? (
                      <div style={{
                        width: 40, height: 40, borderRadius: 12,
                        background: rank === 1 ? 'linear-gradient(135deg, #FFD700, #FFA500)' : rank === 2 ? 'linear-gradient(135deg, #C0C0C0, #A0A0A0)' : 'linear-gradient(135deg, #CD7F32, #A0522D)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: `0 3px 10px ${rank === 1 ? 'rgba(255,215,0,0.3)' : 'rgba(0,0,0,0.1)'}`,
                      }}>
                        <TrophyOutlined style={{ color: '#fff', fontSize: 18 }} />
                      </div>
                    ) : (
                      <Avatar size={40} style={{ background: color, fontWeight: 700, fontSize: 16 }}>
                        {worker.worker_name.charAt(0)}
                      </Avatar>
                    )}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-1)' }}>
                        {worker.worker_name}
                        {rank <= 3 && <Tag color={rank === 1 ? 'gold' : rank === 2 ? 'default' : 'orange'} style={{ marginLeft: 8, borderRadius: 6, fontSize: 11 }}>#{rank}</Tag>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-4)', display: 'flex', gap: 12 }}>
                        {worker.phone && <span>{worker.phone}</span>}
                        {worker.alipay && <span>支付宝: {worker.alipay}</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <div style={{
                      padding: '6px 16px', borderRadius: 10,
                      background: 'linear-gradient(135deg, #667eea15, #764ba215)',
                      border: '1px solid rgba(102,126,234,0.15)',
                    }}>
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>佣金 </span>
                      <span className="num" style={{ fontSize: 18, fontWeight: 800, color: '#722ed1' }}>¥{worker.total_commission.toFixed(2)}</span>
                    </div>
                    <Tag style={{ borderRadius: 8, fontWeight: 600, background: `${color}10`, color, border: `1px solid ${color}25` }}>
                      出库 {worker.total_outbound}
                    </Tag>
                    <Tag color={worker.outbound_rate >= 80 ? 'green' : worker.outbound_rate >= 50 ? 'orange' : 'red'}
                      style={{ borderRadius: 8, fontWeight: 700 }}>
                      {worker.outbound_rate}%
                    </Tag>
                    <Tooltip title="AI分析">
                      <Button type="text" size="small" icon={<RobotOutlined />}
                        onClick={e => { e.stopPropagation(); openAiAnalysis(worker.worker_id); }}
                        style={{ color: '#667eea', borderRadius: 8 }}
                      />
                    </Tooltip>
                    <ExpandOutlined style={{ color: 'var(--text-4)', fontSize: 12, transition: 'transform 0.3s', transform: isExpanded ? 'rotate(45deg)' : '' }} />
                  </div>
                </div>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div style={{ padding: '16px 20px' }}>
                    {/* Worker Summary */}
                    <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                      {[
                        { label: '总打印', value: worker.total_printed, color: '#1677ff' },
                        { label: '总出库', value: worker.total_outbound, color: '#00b96b' },
                        { label: '审核入库', value: worker.total_approved_qty, color: '#fa8c16' },
                        { label: '出库率', value: `${worker.outbound_rate}%`, color: worker.outbound_rate >= 80 ? '#00b96b' : '#ff4d4f' },
                      ].map((s, i) => (
                        <Col xs={12} sm={6} key={i}>
                          <div style={{
                            padding: '10px 14px', borderRadius: 10,
                            background: `${s.color}08`, border: `1px solid ${s.color}15`,
                          }}>
                            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{s.label}</div>
                            <div className="num" style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
                          </div>
                        </Col>
                      ))}
                    </Row>

                    {/* SKU Summary */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <BarChartOutlined style={{ color: '#722ed1' }} /> SKU汇总
                      </div>
                      <Table
                        dataSource={worker.sku_summary}
                        columns={skuColumns}
                        rowKey="sku_id"
                        size="small"
                        pagination={false}
                        locale={{ emptyText: '暂无数据' }}
                        summary={() => (
                          <Table.Summary fixed>
                            <Table.Summary.Row style={{ background: 'var(--gray-2)', fontWeight: 700 }}>
                              <Table.Summary.Cell index={0}>合计</Table.Summary.Cell>
                              <Table.Summary.Cell index={1} align="right">{worker.total_printed}</Table.Summary.Cell>
                              <Table.Summary.Cell index={2} align="right"><span style={{ color: '#00b96b' }}>{worker.total_outbound}</span></Table.Summary.Cell>
                              <Table.Summary.Cell index={3} align="center">
                                <Tag color={worker.outbound_rate >= 80 ? 'green' : 'orange'} style={{ borderRadius: 6 }}>{worker.outbound_rate}%</Tag>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={4} align="right">
                                <span style={{ color: '#722ed1', fontWeight: 800 }}>¥{worker.total_commission.toFixed(2)}</span>
                              </Table.Summary.Cell>
                            </Table.Summary.Row>
                          </Table.Summary>
                        )}
                      />
                    </div>

                    {/* Daily Records */}
                    <Collapse
                      ghost
                      items={[{
                        key: 'daily',
                        label: <span style={{ fontWeight: 600, fontSize: 13 }}><CalendarOutlined style={{ marginRight: 6, color: '#1677ff' }} />每日明细 ({worker.daily_records.length} 条)</span>,
                        children: (
                          <Table
                            dataSource={worker.daily_records}
                            columns={dailyColumns}
                            rowKey={(r, i) => `${r.date}-${r.sku_id}-${i}`}
                            size="small"
                            pagination={worker.daily_records.length > 20 ? { pageSize: 20, showTotal: t => `共 ${t} 条` } : false}
                            scroll={{ x: 'max-content' }}
                            locale={{ emptyText: '暂无明细' }}
                          />
                        ),
                      }]}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* AI Analysis Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 10,
              background: 'linear-gradient(135deg, #667eea, #764ba2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <RobotOutlined style={{ color: '#fff', fontSize: 16 }} />
            </div>
            <span>AI 结算分析</span>
            {aiLoading && <Spin size="small" />}
          </div>
        }
        open={aiModalOpen}
        onCancel={() => { setAiModalOpen(false); if (abortRef.current) abortRef.current.abort(); }}
        footer={null}
        width={600}
      >
        <div style={{
          padding: '16px 0', fontSize: 14, lineHeight: 1.8,
          minHeight: 120,
        }}>
          {aiContent ? (
            <div style={{
              padding: '16px 20px', borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(102,126,234,0.04), rgba(118,75,162,0.04))',
              border: '1px solid rgba(102,126,234,0.1)',
            }}>
              {formatContent(aiContent)}
            </div>
          ) : aiLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin size="large" />
              <div style={{ marginTop: 12, color: 'var(--text-3)' }}>AI 正在分析结算数据...</div>
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
