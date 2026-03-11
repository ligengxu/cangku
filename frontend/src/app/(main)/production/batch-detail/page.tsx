'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Tag, Space, Typography, Row, Col, DatePicker,
  Button, Select, Empty, Spin, Progress, Tooltip, Divider,
  Badge, Avatar, message,
} from 'antd';
import {
  AimOutlined, UserOutlined, AppstoreOutlined, ReloadOutlined,
  CheckCircleOutlined, ClockCircleOutlined, RightOutlined,
  TeamOutlined, ThunderboltOutlined, InboxOutlined,
  ArrowLeftOutlined, DashboardOutlined, BarChartOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dayjs, { Dayjs } from 'dayjs';

const { Title, Text } = Typography;

interface BatchOverview {
  purchase_id: number;
  fruit_name: string;
  supplier_name: string;
  purchase_date: string;
  purchase_weight: number;
  worker_count: number;
  total_labels: number;
  outbound_labels: number;
  progress: number;
}

interface BatchDetail {
  purchase: {
    id: number; fruit_id: number; fruit_name: string;
    supplier_name: string; purchase_date: string;
    purchase_weight: number; purchase_price: number;
  };
  assignments: { worker_id: number; worker_name: string; date: string | null }[];
  labels: { total: number; outbound: number; pending: number; progress: number };
  weight: {
    purchase: number; estimated_total: number; actual_outbound: number;
    net_consumed: number; remaining: number;
  };
  transactions: { total: number; total_qty: number; printed: number };
  sku_summary: {
    sku_id: number; sku_name: string; total_labels: number;
    outbound_labels: number; estimated_weight: number;
    actual_weight: number; performance: number;
  }[];
  worker_summary: {
    worker_id: number; worker_name: string; total_labels: number;
    outbound_labels: number; estimated_weight: number;
    actual_weight: number; share: number;
  }[];
}

const FRUIT_ICONS: Record<string, string> = {
  '苹果': '🍎', '梨': '🍐', '橙': '🍊', '柠檬': '🍋', '桃': '🍑',
  '樱桃': '🍒', '葡萄': '🍇', '西瓜': '🍉', '芒果': '🥭', '猕猴桃': '🥝',
  '香蕉': '🍌', '菠萝': '🍍', '草莓': '🍓', '蓝莓': '🫐',
};

function getFruitIcon(name: string): string {
  for (const [k, v] of Object.entries(FRUIT_ICONS)) {
    if (name.includes(k)) return v;
  }
  return '🍎';
}

export default function BatchDetailPage() {
  const [viewDate, setViewDate] = useState<Dayjs>(dayjs());
  const [overview, setOverview] = useState<BatchOverview[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<BatchDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/production/batch-overview', {
        params: { view_date: viewDate.format('YYYY-MM-DD') },
      });
      setOverview(r.data?.data || []);
    } catch {
      message.error('加载批次概览失败');
    } finally {
      setLoading(false);
    }
  }, [viewDate]);

  const fetchDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      const r = await api.get(`/production/batch-detail/${id}`);
      setDetail(r.data?.data || null);
    } catch {
      message.error('加载批次详情失败');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { fetchOverview(); }, [fetchOverview]);

  const selectBatch = (id: number) => {
    setSelectedId(id);
    fetchDetail(id);
  };

  if (selectedId && detail) {
    return <BatchDetailView detail={detail} onBack={() => { setSelectedId(null); setDetail(null); }} onRefresh={() => fetchDetail(selectedId)} loading={detailLoading} />;
  }

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #13c2c2 0%, #1677ff 50%, #722ed1 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: -30, right: -20, width: 180, height: 180,
          borderRadius: '50%', background: 'rgba(255,255,255,0.06)',
        }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <span style={{
              width: 42, height: 42, borderRadius: 12,
              background: 'rgba(255,255,255,0.2)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 20,
            }}>
              <AimOutlined />
            </span>
            <Title level={3} style={{ margin: 0, color: '#fff' }}>批次追踪</Title>
          </div>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14 }}>
            查看每日批次的分配工人 · 标签打印 · 出库进度 · 重量消耗
          </Text>
        </div>
      </div>

      {/* Date filter */}
      <Card style={{
        borderRadius: 14, marginBottom: 20, border: '1px solid var(--border-2)',
        boxShadow: 'var(--shadow-1)',
      }} styles={{ body: { padding: '14px 20px' } }}>
        <Space size={12} wrap>
          <DashboardOutlined style={{ color: 'var(--brand)' }} />
          <DatePicker
            value={viewDate}
            onChange={v => v && setViewDate(v)}
            style={{ borderRadius: 10 }}
            format="YYYY-MM-DD"
          />
          <Button size="small" onClick={() => setViewDate(dayjs().subtract(1, 'day'))}>昨天</Button>
          <Button size="small" type={viewDate.isSame(dayjs(), 'day') ? 'primary' : 'default'} onClick={() => setViewDate(dayjs())}>今天</Button>
          <Button icon={<ReloadOutlined />} size="small" onClick={fetchOverview}>刷新</Button>
        </Space>
      </Card>

      {/* Batch list */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : overview.length === 0 ? (
        <Card style={{ borderRadius: 14, textAlign: 'center', padding: 40 }}>
          <Empty description={`${viewDate.format('MM月DD日')} 暂无批次分配`} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {overview.map((b, i) => (
            <Col xs={24} sm={12} lg={8} key={b.purchase_id}>
              <div
                onClick={() => selectBatch(b.purchase_id)}
                style={{
                  padding: '20px', borderRadius: 16, cursor: 'pointer',
                  background: 'var(--bg-card)', border: '1px solid var(--border-2)',
                  boxShadow: 'var(--shadow-1)', transition: 'all 0.3s',
                  animation: `fadeSlideUp 0.5s ease ${i * 0.06}s both`,
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.transform = 'translateY(-4px)';
                  e.currentTarget.style.boxShadow = 'var(--shadow-2)';
                  e.currentTarget.style.borderColor = 'var(--brand)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.transform = '';
                  e.currentTarget.style.boxShadow = 'var(--shadow-1)';
                  e.currentTarget.style.borderColor = 'var(--border-2)';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <span style={{ fontSize: 28 }}>{getFruitIcon(b.fruit_name)}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Text style={{ fontWeight: 700, fontSize: 16 }}>{b.fruit_name}</Text>
                      <Tag color="blue" style={{ borderRadius: 6, fontSize: 11 }}>#{b.purchase_id}</Tag>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                      {b.supplier_name} · {b.purchase_weight}kg
                    </div>
                  </div>
                  <RightOutlined style={{ color: 'var(--text-4)', fontSize: 14 }} />
                </div>

                <Progress
                  percent={b.progress}
                  strokeColor={{ '0%': '#1677ff', '100%': '#52c41a' }}
                  size="small"
                  format={p => `${p}%`}
                  style={{ marginBottom: 12 }}
                />

                <Row gutter={8}>
                  <Col span={8} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-4)' }}><TeamOutlined /> 工人</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#722ed1' }}>{b.worker_count}</div>
                  </Col>
                  <Col span={8} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-4)' }}><InboxOutlined /> 标签</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#1677ff' }}>{b.total_labels}</div>
                  </Col>
                  <Col span={8} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-4)' }}><CheckCircleOutlined /> 出库</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#52c41a' }}>{b.outbound_labels}</div>
                  </Col>
                </Row>
              </div>
            </Col>
          ))}
        </Row>
      )}

      <style jsx global>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}


function BatchDetailView({ detail, onBack, onRefresh, loading }: {
  detail: BatchDetail; onBack: () => void; onRefresh: () => void; loading: boolean;
}) {
  const { purchase: p, labels, weight, assignments, sku_summary, worker_summary, transactions } = detail;

  const statCards = [
    { label: '标签总数', value: labels.total, icon: <InboxOutlined />, color: '#1677ff', gradient: 'linear-gradient(135deg, #1677ff, #69b1ff)' },
    { label: '已出库', value: labels.outbound, icon: <CheckCircleOutlined />, color: '#52c41a', gradient: 'linear-gradient(135deg, #52c41a, #95de64)' },
    { label: '待出库', value: labels.pending, icon: <ClockCircleOutlined />, color: '#fa8c16', gradient: 'linear-gradient(135deg, #fa8c16, #ffc53d)' },
    { label: '出库率', value: `${labels.progress}%`, icon: <BarChartOutlined />, color: '#722ed1', gradient: 'linear-gradient(135deg, #722ed1, #b37feb)' },
  ];

  const skuColumns = [
    { title: 'SKU', dataIndex: 'sku_name', width: 150, render: (v: string) => <Text strong>{v}</Text> },
    { title: '绩效', dataIndex: 'performance', width: 70, render: (v: number) => <Tag color="purple" style={{ borderRadius: 6 }}>{v}</Tag> },
    { title: '标签', dataIndex: 'total_labels', width: 70, render: (v: number) => v },
    {
      title: '出库', dataIndex: 'outbound_labels', width: 70,
      render: (v: number, r: any) => (
        <Tooltip title={`${r.total_labels > 0 ? Math.round(v / r.total_labels * 100) : 0}%`}>
          <Text style={{ color: '#52c41a', fontWeight: 600 }}>{v}</Text>
        </Tooltip>
      ),
    },
    { title: '预估重量', dataIndex: 'estimated_weight', width: 100, render: (v: number) => `${Number(v).toFixed(1)}kg` },
    { title: '实际重量', dataIndex: 'actual_weight', width: 100, render: (v: number) => v > 0 ? `${Number(v).toFixed(1)}kg` : '-' },
  ];

  const workerColumns = [
    {
      title: '工人', dataIndex: 'worker_name', width: 100,
      render: (v: string) => (
        <Space size={6}>
          <Avatar size={24} style={{ background: 'linear-gradient(135deg, #1677ff, #722ed1)', fontSize: 11, fontWeight: 700 }}>
            {v[0]}
          </Avatar>
          <Text style={{ fontWeight: 500 }}>{v}</Text>
        </Space>
      ),
    },
    { title: '标签', dataIndex: 'total_labels', width: 60 },
    { title: '出库', dataIndex: 'outbound_labels', width: 60, render: (v: number) => <Text style={{ color: '#52c41a', fontWeight: 600 }}>{v}</Text> },
    {
      title: '占比', dataIndex: 'share', width: 120,
      render: (v: number) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Progress percent={v} size="small" strokeColor="var(--brand)" style={{ flex: 1, marginBottom: 0 }} showInfo={false} />
          <Text style={{ fontSize: 12, minWidth: 36 }}>{v}%</Text>
        </div>
      ),
    },
    { title: '预估重量', dataIndex: 'estimated_weight', width: 90, render: (v: number) => `${Number(v).toFixed(1)}kg` },
    { title: '实际重量', dataIndex: 'actual_weight', width: 90, render: (v: number) => v > 0 ? `${Number(v).toFixed(1)}kg` : '-' },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <Spin spinning={loading}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #13c2c2 0%, #1677ff 50%, #722ed1 100%)',
          borderRadius: 16, padding: '24px 28px', marginBottom: 24,
          color: '#fff', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', top: -30, right: -20, width: 160, height: 160,
            borderRadius: '50%', background: 'rgba(255,255,255,0.06)',
          }} />
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack}
                  style={{ color: '#fff', padding: '0 4px', marginBottom: 8, height: 28 }}>
                  返回列表
                </Button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 36 }}>{getFruitIcon(p.fruit_name)}</span>
                  <div>
                    <Title level={3} style={{ margin: 0, color: '#fff' }}>
                      {p.fruit_name} · 批次 #{p.id}
                    </Title>
                    <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 4 }}>
                      {p.supplier_name} · {p.purchase_date} · {p.purchase_weight}kg · ¥{Number(p.purchase_price).toFixed(2)}/kg
                    </div>
                  </div>
                </div>
              </div>
              <Button icon={<ReloadOutlined />} onClick={onRefresh}
                style={{ borderRadius: 10, background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none' }}>
                刷新
              </Button>
            </div>
          </div>
        </div>

        {/* Stat cards */}
        <Row gutter={[14, 14]} style={{ marginBottom: 24 }}>
          {statCards.map((c, i) => (
            <Col xs={12} sm={6} key={i}>
              <div style={{
                background: 'var(--bg-card)', borderRadius: 14, padding: '18px 16px',
                border: '1px solid var(--border-2)', boxShadow: 'var(--shadow-1)',
                display: 'flex', alignItems: 'center', gap: 12,
                animation: `fadeSlideUp 0.4s ease ${i * 0.06}s both`,
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, background: c.gradient,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 20, color: '#fff', boxShadow: `0 4px 14px ${c.color}30`, flexShrink: 0,
                }}>
                  {c.icon}
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{c.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-1)' }}>{c.value}</div>
                </div>
              </div>
            </Col>
          ))}
        </Row>

        {/* Weight + Progress */}
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          <Col xs={24} md={12}>
            <Card title={
              <Space><DashboardOutlined style={{ color: '#1677ff' }} />出库进度</Space>
            } style={{ borderRadius: 14, height: '100%' }} styles={{ body: { padding: '20px 24px' } }}>
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <Progress
                  type="dashboard"
                  percent={labels.progress}
                  strokeColor={{ '0%': '#1677ff', '100%': '#52c41a' }}
                  format={p => <span style={{ fontSize: 22, fontWeight: 700 }}>{p}%</span>}
                  size={140}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-around' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-4)' }}>已出库</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#52c41a' }}>{labels.outbound}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-4)' }}>待出库</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#fa8c16' }}>{labels.pending}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-4)' }}>总标签</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#1677ff' }}>{labels.total}</div>
                </div>
              </div>
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card title={
              <Space><BarChartOutlined style={{ color: '#722ed1' }} />重量消耗</Space>
            } style={{ borderRadius: 14, height: '100%' }} styles={{ body: { padding: '20px 24px' } }}>
              <Row gutter={[0, 14]}>
                {[
                  { label: '采购重量', value: weight.purchase, color: '#1677ff', suffix: 'kg' },
                  { label: '净消耗', value: weight.net_consumed, color: '#fa8c16', suffix: 'kg' },
                  { label: '剩余重量', value: weight.remaining, color: weight.remaining < 0 ? '#ff4d4f' : '#52c41a', suffix: 'kg' },
                  { label: '出库实重', value: weight.actual_outbound, color: '#722ed1', suffix: 'kg' },
                ].map((item, i) => (
                  <Col span={12} key={i}>
                    <div style={{
                      padding: '10px 14px', borderRadius: 10,
                      background: `${item.color}08`, border: `1px solid ${item.color}15`,
                    }}>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{item.label}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: item.color }}>
                        {Number(item.value).toFixed(1)}{item.suffix}
                      </div>
                    </div>
                  </Col>
                ))}
              </Row>
              {weight.purchase > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>
                    <span>消耗进度</span>
                    <span>{Math.min(100, Math.round(weight.net_consumed / weight.purchase * 100))}%</span>
                  </div>
                  <Progress
                    percent={Math.min(100, Math.round(weight.net_consumed / weight.purchase * 100))}
                    strokeColor={{ '0%': '#fa8c16', '100%': weight.net_consumed > weight.purchase ? '#ff4d4f' : '#52c41a' }}
                    size="small"
                    showInfo={false}
                  />
                </div>
              )}
            </Card>
          </Col>
        </Row>

        {/* Assigned workers */}
        <Card title={
          <Space><TeamOutlined style={{ color: '#13c2c2' }} />分配工人 <Badge count={assignments.length} style={{ backgroundColor: '#13c2c2' }} /></Space>
        } style={{ borderRadius: 14, marginBottom: 20 }} styles={{ body: { padding: '16px 20px' } }}>
          <Space wrap size={8}>
            {assignments.map(a => (
              <Tag key={a.worker_id} color="cyan" style={{ borderRadius: 8, padding: '4px 12px', fontSize: 13 }}>
                <UserOutlined style={{ marginRight: 4 }} />
                {a.worker_name}
                {a.date && <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 4 }}>{a.date}</span>}
              </Tag>
            ))}
            {assignments.length === 0 && <Text style={{ color: 'var(--text-4)' }}>暂无分配工人</Text>}
          </Space>
        </Card>

        {/* SKU + Worker tables */}
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Card title={
              <Space><AppstoreOutlined style={{ color: '#722ed1' }} />SKU 汇总</Space>
            } style={{ borderRadius: 14 }} styles={{ body: { padding: 0 } }}>
              <Table
                dataSource={sku_summary}
                columns={skuColumns}
                rowKey="sku_id"
                pagination={false}
                size="small"
                scroll={{ x: 500 }}
                locale={{ emptyText: <Empty description="暂无标签" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                summary={() => {
                  if (sku_summary.length === 0) return null;
                  const totals = sku_summary.reduce((acc, s) => ({
                    total: acc.total + s.total_labels,
                    outbound: acc.outbound + s.outbound_labels,
                    est: acc.est + s.estimated_weight,
                    act: acc.act + s.actual_weight,
                  }), { total: 0, outbound: 0, est: 0, act: 0 });
                  return (
                    <Table.Summary.Row style={{ background: 'rgba(22,119,255,0.03)', fontWeight: 600 }}>
                      <Table.Summary.Cell index={0}>合计</Table.Summary.Cell>
                      <Table.Summary.Cell index={1}>-</Table.Summary.Cell>
                      <Table.Summary.Cell index={2}>{totals.total}</Table.Summary.Cell>
                      <Table.Summary.Cell index={3}><Text style={{ color: '#52c41a' }}>{totals.outbound}</Text></Table.Summary.Cell>
                      <Table.Summary.Cell index={4}>{totals.est.toFixed(1)}kg</Table.Summary.Cell>
                      <Table.Summary.Cell index={5}>{totals.act > 0 ? `${totals.act.toFixed(1)}kg` : '-'}</Table.Summary.Cell>
                    </Table.Summary.Row>
                  );
                }}
              />
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card title={
              <Space><TeamOutlined style={{ color: '#1677ff' }} />工人产出</Space>
            } style={{ borderRadius: 14 }} styles={{ body: { padding: 0 } }}>
              <Table
                dataSource={worker_summary}
                columns={workerColumns}
                rowKey="worker_id"
                pagination={false}
                size="small"
                scroll={{ x: 500 }}
                locale={{ emptyText: <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
              />
            </Card>
          </Col>
        </Row>

        {/* Transaction stats */}
        {transactions.total > 0 && (
          <Card style={{ borderRadius: 14, marginTop: 16 }} styles={{ body: { padding: '14px 20px' } }}>
            <Space size={24}>
              <div>
                <Text style={{ fontSize: 12, color: 'var(--text-3)' }}>申请记录</Text>
                <Text style={{ fontSize: 16, fontWeight: 600, marginLeft: 6 }}>{transactions.total}</Text>
              </div>
              <div>
                <Text style={{ fontSize: 12, color: 'var(--text-3)' }}>申请数量</Text>
                <Text style={{ fontSize: 16, fontWeight: 600, marginLeft: 6 }}>{transactions.total_qty}</Text>
              </div>
              <div>
                <Text style={{ fontSize: 12, color: 'var(--text-3)' }}>已打印</Text>
                <Text style={{ fontSize: 16, fontWeight: 600, marginLeft: 6, color: '#52c41a' }}>{transactions.printed}</Text>
              </div>
            </Space>
          </Card>
        )}
      </Spin>

      <style jsx global>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
