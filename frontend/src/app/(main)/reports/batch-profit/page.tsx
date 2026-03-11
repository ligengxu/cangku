'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Select, Button, Table, Tag, Row, Col, Segmented,
  Space, Spin, message, Tooltip, Empty, Modal, Progress,
} from 'antd';
import {
  DollarOutlined, ReloadOutlined, DownloadOutlined,
  ShoppingCartOutlined, BarChartOutlined, RobotOutlined,
  ExclamationCircleOutlined, CheckCircleOutlined,
  RiseOutlined, FallOutlined, FireOutlined,
  ThunderboltOutlined, PieChartOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dayjs from 'dayjs';

interface BatchItem {
  id: number; fruit_name: string; supplier: string; purchase_date: string;
  weight: number; price: number; cost: number;
  total_labels: number; outbound_labels: number; outbound_rate: number;
  consumed_weight: number; remaining_weight: number; loss_rate: number;
  commission: number; status: string;
}

interface ProfitData {
  batches: BatchItem[];
  summary: {
    batch_count: number; total_cost: number; total_weight: number;
    total_consumed: number; total_remaining: number; avg_loss_rate: number;
    total_labels: number; total_outbound: number; avg_outbound_rate: number;
    total_commission: number;
  };
  fruit_options: { id: number; name: string }[];
}

const FRUIT_ICONS: Record<string, string> = {
  '苹果': '🍎', '梨': '🍐', '橙': '🍊', '柠檬': '🍋', '桃': '🍑',
  '樱桃': '🍒', '葡萄': '🍇', '西瓜': '🍉', '芒果': '🥭', '猕猴桃': '🥝',
  '香蕉': '🍌', '菠萝': '🍍', '草莓': '🍓', '蓝莓': '🫐',
};

function getFruitIcon(name: string): string {
  for (const [k, v] of Object.entries(FRUIT_ICONS)) if (name.includes(k)) return v;
  return '🍎';
}

export default function BatchProfitPage() {
  const [days, setDays] = useState(90);
  const [fruitId, setFruitId] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ProfitData | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { days };
      if (fruitId) params.fruit_id = fruitId;
      const res = await api.get('/reports/batch-profit', { params });
      setData(res.data?.data || null);
    } catch { message.error('获取数据失败'); }
    finally { setLoading(false); }
  }, [days, fruitId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const openAi = async () => {
    setAiContent(''); setAiModalOpen(true); setAiLoading(true);
    try {
      abortRef.current = new AbortController();
      const res = await fetch(`/api/reports/batch-profit-ai?days=${days}`, {
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
          try {
            const p = JSON.parse(d);
            if (p.error) acc += `\n⚠️ ${p.error}`;
            else if (p.content) acc += p.content;
          } catch {}
        }
        setAiContent(acc);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') setAiContent('AI分析暂不可用');
    } finally { setAiLoading(false); abortRef.current = null; }
  };

  const exportCSV = () => {
    if (!data?.batches?.length) { message.warning('暂无数据'); return; }
    const h = ['批次ID,水果,供应商,采购日期,重量(kg),单价,成本,标签数,出库数,出库率,消耗重量,剩余重量,损耗率,佣金'];
    const rows = data.batches.map(b =>
      `${b.id},${b.fruit_name},${b.supplier},${b.purchase_date},${b.weight},${b.price},${b.cost},${b.total_labels},${b.outbound_labels},${b.outbound_rate}%,${b.consumed_weight},${b.remaining_weight},${b.loss_rate}%,${b.commission}`
    );
    const csv = '\uFEFF' + [...h, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `批次利润分析_${dayjs().format('YYYYMMDD')}.csv`; a.click();
    URL.revokeObjectURL(url); message.success('导出成功');
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
      title: '批次', key: 'batch', width: 180, fixed: 'left' as const,
      render: (_: any, r: BatchItem) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 24 }}>{getFruitIcon(r.fruit_name)}</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{r.fruit_name}</div>
            <div style={{ fontSize: 11, color: 'var(--text-4)' }}>
              {r.supplier} · {dayjs(r.purchase_date).format('MM-DD')}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: '采购', key: 'purchase', width: 120,
      render: (_: any, r: BatchItem) => (
        <div style={{ fontSize: 12 }}>
          <div>{r.weight}kg × ¥{r.price}</div>
          <div style={{ fontWeight: 700, color: '#fa8c16' }}>¥{r.cost.toFixed(0)}</div>
        </div>
      ),
    },
    {
      title: '标签', key: 'labels', width: 100, align: 'center' as const,
      render: (_: any, r: BatchItem) => (
        <div>
          <div className="num" style={{ fontWeight: 700 }}>{r.total_labels}</div>
          <div style={{ fontSize: 11, color: 'var(--text-4)' }}>出库 {r.outbound_labels}</div>
        </div>
      ),
    },
    {
      title: '出库率', dataIndex: 'outbound_rate', width: 90, align: 'center' as const,
      sorter: (a: BatchItem, b: BatchItem) => a.outbound_rate - b.outbound_rate,
      render: (v: number) => (
        <Progress
          percent={v} size="small" strokeColor={v >= 80 ? '#52c41a' : v >= 50 ? '#faad14' : '#ff4d4f'}
          format={p => <span style={{ fontSize: 11, fontWeight: 700 }}>{p}%</span>}
        />
      ),
    },
    {
      title: '消耗', key: 'consumed', width: 110,
      render: (_: any, r: BatchItem) => (
        <div style={{ fontSize: 12 }}>
          <div>消耗: <span style={{ fontWeight: 600, color: '#1677ff' }}>{r.consumed_weight}kg</span></div>
          <div>剩余: <span style={{ color: r.remaining_weight > 0 ? '#faad14' : '#52c41a' }}>{r.remaining_weight}kg</span></div>
        </div>
      ),
    },
    {
      title: '损耗率', dataIndex: 'loss_rate', width: 90, align: 'center' as const,
      sorter: (a: BatchItem, b: BatchItem) => a.loss_rate - b.loss_rate,
      render: (v: number) => {
        const color = v > 15 ? '#ff4d4f' : v > 8 ? '#faad14' : '#52c41a';
        return <Tag color={v > 15 ? 'red' : v > 8 ? 'orange' : 'green'} style={{ borderRadius: 8, fontWeight: 700, fontSize: 13 }}>{v}%</Tag>;
      },
    },
    {
      title: '佣金', dataIndex: 'commission', width: 90, align: 'right' as const,
      sorter: (a: BatchItem, b: BatchItem) => a.commission - b.commission,
      render: (v: number) => <span style={{ fontWeight: 700, color: '#722ed1' }}>¥{v.toFixed(2)}</span>,
    },
    {
      title: '状态', dataIndex: 'status', width: 80, align: 'center' as const,
      render: (v: string) => {
        if (v === 'completed') return <Tag icon={<CheckCircleOutlined />} color="success" style={{ borderRadius: 6 }}>完成</Tag>;
        if (v === 'active') return <Tag icon={<ThunderboltOutlined />} color="processing" style={{ borderRadius: 6 }}>进行中</Tag>;
        return <Tag color="default" style={{ borderRadius: 6 }}>新建</Tag>;
      },
    },
  ];

  const statCards = [
    { label: '批次总数', value: s?.batch_count ?? 0, suffix: '笔', color: '#1677ff', icon: <ShoppingCartOutlined /> },
    { label: '总采购成本', value: `¥${(s?.total_cost ?? 0).toFixed(0)}`, suffix: '', color: '#fa8c16', icon: <DollarOutlined /> },
    { label: '总采购重量', value: `${(s?.total_weight ?? 0).toFixed(0)}`, suffix: 'kg', color: '#4facfe', icon: <BarChartOutlined /> },
    { label: '平均损耗率', value: `${s?.avg_loss_rate ?? 0}%`, suffix: '', color: (s?.avg_loss_rate ?? 0) > 15 ? '#ff4d4f' : '#52c41a', icon: <PieChartOutlined /> },
    { label: '平均出库率', value: `${s?.avg_outbound_rate ?? 0}%`, suffix: '', color: (s?.avg_outbound_rate ?? 0) >= 70 ? '#52c41a' : '#faad14', icon: <RiseOutlined /> },
    { label: '总佣金', value: `¥${(s?.total_commission ?? 0).toFixed(0)}`, suffix: '', color: '#722ed1', icon: <FireOutlined /> },
  ];

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #f5af19 0%, #f12711 50%, #c31432 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -30, right: -20, width: 150, height: 150, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{
              width: 48, height: 48, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(10px)', fontSize: 24,
            }}><DollarOutlined /></span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>批次利润分析</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>采购成本 · 出库消耗 · 损耗率 · 利润追踪</div>
            </div>
          </div>
          <Space wrap>
            <Segmented value={days} onChange={v => setDays(v as number)}
              options={[{ value: 30, label: '30天' }, { value: 60, label: '60天' }, { value: 90, label: '90天' }, { value: 180, label: '半年' }]}
              style={{ borderRadius: 10, background: 'rgba(255,255,255,0.15)' }}
            />
            <Select value={fruitId} onChange={setFruitId} allowClear placeholder="全部水果"
              showSearch optionFilterProp="label"
              options={(data?.fruit_options || []).map(f => ({ value: f.id, label: f.name }))}
              style={{ minWidth: 120, borderRadius: 10 }}
            />
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh}
              style={{ borderRadius: 10, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff' }} />
            <Button icon={<DownloadOutlined />} onClick={exportCSV}
              style={{ borderRadius: 10, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff' }}>导出</Button>
            <Button icon={<RobotOutlined />} onClick={openAi}
              style={{ borderRadius: 10, background: 'rgba(255,255,255,0.25)', border: 'none', color: '#fff', fontWeight: 600 }}>AI分析</Button>
          </Space>
        </div>
      </div>

      {/* Stats */}
      {data && (
        <Row gutter={[10, 10]} style={{ marginBottom: 20 }}>
          {statCards.map((c, i) => (
            <Col xs={12} sm={8} md={4} key={i}>
              <div style={{
                padding: '14px 16px', borderRadius: 12,
                background: `${c.color}08`, border: `1px solid ${c.color}15`,
                animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.05}s`,
              }}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  <span style={{ color: c.color }}>{c.icon}</span> {c.label}
                </div>
                <div className="num" style={{ fontSize: 20, fontWeight: 700, color: c.color }}>{c.value}</div>
                {c.suffix && <span style={{ fontSize: 10, color: 'var(--text-4)' }}>{c.suffix}</span>}
              </div>
            </Col>
          ))}
        </Row>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : !data?.batches?.length ? (
        <div className="panel" style={{ padding: 60, textAlign: 'center' }}>
          <Empty description="暂无批次数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      ) : (
        <div className="panel" style={{ overflow: 'hidden' }}>
          <div className="panel-head">
            <span className="panel-title"><BarChartOutlined style={{ color: '#f12711' }} /> 批次明细 ({data.batches.length})</span>
          </div>
          <Table
            dataSource={data.batches}
            columns={columns}
            rowKey="id"
            size="small"
            scroll={{ x: 'max-content' }}
            pagination={{ pageSize: 20, showTotal: t => `共 ${t} 笔`, showSizeChanger: false }}
            locale={{ emptyText: '暂无数据' }}
            summary={() => s ? (
              <Table.Summary fixed>
                <Table.Summary.Row style={{ background: 'var(--gray-2)', fontWeight: 700 }}>
                  <Table.Summary.Cell index={0}>合计 ({s.batch_count}笔)</Table.Summary.Cell>
                  <Table.Summary.Cell index={1}>¥{s.total_cost.toFixed(0)} / {s.total_weight}kg</Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="center">{s.total_labels} / {s.total_outbound}</Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="center">
                    <Tag color={s.avg_outbound_rate >= 70 ? 'green' : 'orange'} style={{ borderRadius: 6 }}>{s.avg_outbound_rate}%</Tag>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={4}>{s.total_consumed}kg / {s.total_remaining}kg</Table.Summary.Cell>
                  <Table.Summary.Cell index={5} align="center">
                    <Tag color={s.avg_loss_rate > 15 ? 'red' : 'green'} style={{ borderRadius: 6, fontWeight: 700 }}>{s.avg_loss_rate}%</Tag>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={6} align="right">
                    <span style={{ color: '#722ed1', fontWeight: 800 }}>¥{s.total_commission.toFixed(2)}</span>
                  </Table.Summary.Cell>
                  <Table.Summary.Cell index={7}></Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            ) : undefined}
          />
        </div>
      )}

      {/* AI Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 10,
              background: 'linear-gradient(135deg, #f5af19, #f12711)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <RobotOutlined style={{ color: '#fff', fontSize: 16 }} />
            </div>
            <span>AI 利润分析</span>
            {aiLoading && <Spin size="small" />}
          </div>
        }
        open={aiModalOpen}
        onCancel={() => { setAiModalOpen(false); if (abortRef.current) abortRef.current.abort(); }}
        footer={null} width={600}
      >
        <div style={{ padding: '16px 0', fontSize: 14, lineHeight: 1.8, minHeight: 120 }}>
          {aiContent ? (
            <div style={{
              padding: '16px 20px', borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(245,175,25,0.04), rgba(241,39,17,0.04))',
              border: '1px solid rgba(241,39,17,0.1)',
            }}>
              {formatContent(aiContent)}
            </div>
          ) : aiLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin size="large" />
              <div style={{ marginTop: 12, color: 'var(--text-3)' }}>AI 正在分析批次利润...</div>
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
