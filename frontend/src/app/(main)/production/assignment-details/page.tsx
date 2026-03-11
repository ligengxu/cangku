'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Select, DatePicker, Button, Table, Tag, Tooltip, Row, Col,
  Empty, Spin, message, Avatar, Space, Progress, Collapse,
} from 'antd';
import {
  TeamOutlined, SearchOutlined, ReloadOutlined, UserOutlined,
  CalendarOutlined, ExpandOutlined, ShoppingCartOutlined,
  FireOutlined, EnvironmentOutlined, TrophyOutlined,
  DownloadOutlined, DatabaseOutlined, BranchesOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dayjs from 'dayjs';

const FRUIT_ICONS: Record<string, string> = {
  '苹果': '🍎', '梨': '🍐', '橙': '🍊', '柠檬': '🍋', '桃': '🍑',
  '樱桃': '🍒', '葡萄': '🍇', '西瓜': '🍉', '芒果': '🥭', '猕猴桃': '🥝',
  '香蕉': '🍌', '菠萝': '🍍', '草莓': '🍓', '蓝莓': '🫐', '椰子': '🥥',
  '橘子': '🍊', '柚子': '🍊', '荔枝': '🍎', '龙眼': '🍇', '石榴': '🍎',
};

function getFruitIcon(name: string): string {
  for (const [k, v] of Object.entries(FRUIT_ICONS)) if (name.includes(k)) return v;
  return '🍎';
}

interface WorkerDetail { worker_id: number; worker_name: string; consumed_weight: number; item_count: number }
interface BatchDetail {
  purchase_id: number; supplier_name: string; purchase_date: string;
  purchase_weight: number; total_consumed_weight: number; total_items: number;
  usage_pct: number; workers: WorkerDetail[];
}
interface FruitGroup { fruit_name: string; batches: BatchDetail[]; total_consumed: number; batch_count: number }
interface WorkerStat { worker_id: number; worker_name: string; total_weight: number; batch_count: number; item_count: number }
interface Summary { worker_count: number; batch_count: number; fruit_count: number; total_weight: number; total_items: number }
interface DetailsData {
  date: string; fruits: FruitGroup[]; summary: Summary;
  worker_stats: WorkerStat[]; available_dates: string[];
}

const COLORS = ['#1677ff', '#00b96b', '#722ed1', '#fa8c16', '#eb2f96', '#13c2c2', '#f5222d', '#52c41a'];
const STAT_GRADIENTS = [
  { bg: 'linear-gradient(135deg, #1677ff, #69b1ff)', glow: 'rgba(22,119,255,0.15)' },
  { bg: 'linear-gradient(135deg, #fa8c16, #ffc53d)', glow: 'rgba(250,140,22,0.15)' },
  { bg: 'linear-gradient(135deg, #00b96b, #5cdbd3)', glow: 'rgba(0,185,107,0.15)' },
  { bg: 'linear-gradient(135deg, #722ed1, #b37feb)', glow: 'rgba(114,46,209,0.15)' },
  { bg: 'linear-gradient(135deg, #eb2f96, #ff85c0)', glow: 'rgba(235,47,150,0.15)' },
];

export default function AssignmentDetailsPage() {
  const [selectedDate, setSelectedDate] = useState(dayjs());
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DetailsData | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);

  const fetchData = useCallback(async (dt?: dayjs.Dayjs) => {
    setLoading(true);
    try {
      const res = await api.get('/production/assignment-details', {
        params: { assignment_date: (dt ?? selectedDate).format('YYYY-MM-DD') },
      });
      setData(res.data?.data || null);
    } catch { message.error('查询失败'); }
    finally { setLoading(false); }
  }, [selectedDate]);

  useEffect(() => { fetchData(); }, []);

  const handleDateChange = (v: dayjs.Dayjs | null) => {
    if (v) { setSelectedDate(v); fetchData(v); }
  };
  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };
  const handleQuickDate = (dateStr: string) => {
    const d = dayjs(dateStr);
    setSelectedDate(d);
    fetchData(d);
  };

  const exportCSV = () => {
    if (!data?.fruits?.length) { message.warning('暂无数据'); return; }
    const headers = ['水果,批次ID,供应商,采购重量(kg),消耗重量(kg),使用率(%),工人,工人消耗(kg),出库件数'];
    const rows = data.fruits.flatMap(f =>
      f.batches.flatMap(b =>
        b.workers.map(w =>
          `${f.fruit_name},${b.purchase_id},${b.supplier_name},${b.purchase_weight},${b.total_consumed_weight},${b.usage_pct},${w.worker_name},${w.consumed_weight},${w.item_count}`
        )
      )
    );
    const csv = '\uFEFF' + [...headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `派工详情_${data.date}.csv`;
    a.click(); URL.revokeObjectURL(url);
    message.success('导出成功');
  };

  const s = data?.summary;
  const stats = [
    { label: '工人数', value: s?.worker_count ?? 0, icon: <TeamOutlined />, ...STAT_GRADIENTS[0] },
    { label: '批次数', value: s?.batch_count ?? 0, icon: <ShoppingCartOutlined />, ...STAT_GRADIENTS[1] },
    { label: '水果种类', value: s?.fruit_count ?? 0, icon: <FireOutlined />, ...STAT_GRADIENTS[2] },
    { label: '消耗重量', value: `${s?.total_weight ?? 0}kg`, icon: <DatabaseOutlined />, ...STAT_GRADIENTS[3] },
    { label: '出库件数', value: s?.total_items ?? 0, icon: <BranchesOutlined />, ...STAT_GRADIENTS[4] },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #fa8c16 0%, #f5222d 50%, #eb2f96 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -40, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'absolute', bottom: -20, left: '40%', width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
            <span style={{
              width: 44, height: 44, borderRadius: 14,
              background: 'rgba(255,255,255,0.2)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 22,
              backdropFilter: 'blur(10px)',
            }}><BranchesOutlined /></span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>派工详情</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
                {data?.date && `${dayjs(data.date).format('YYYY年M月D日')} · 按水果/批次分组查看消耗`}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Date Selector */}
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head">
          <span className="panel-title"><CalendarOutlined style={{ color: '#fa8c16' }} /> 选择日期</span>
          <Space>
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 8 }} />
            <Button icon={<DownloadOutlined />} onClick={exportCSV} style={{ borderRadius: 8 }}>导出</Button>
          </Space>
        </div>
        <div style={{ padding: '14px 20px' }}>
          <Row gutter={[12, 12]} align="middle">
            <Col xs={24} sm={8}>
              <DatePicker value={selectedDate} onChange={handleDateChange}
                style={{ width: '100%', borderRadius: 8 }} allowClear={false} />
            </Col>
            <Col xs={24} sm={16}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {(data?.available_dates || []).slice(0, 7).map((d, i) => (
                  <Button key={d} size="small" type={d === data?.date ? 'primary' : 'default'}
                    onClick={() => handleQuickDate(d)}
                    style={{
                      borderRadius: 8, fontSize: 12,
                      ...(d === data?.date ? { background: 'linear-gradient(135deg, #fa8c16, #eb2f96)', border: 'none' } : {}),
                    }}>
                    {dayjs(d).format('MM-DD')}
                  </Button>
                ))}
              </div>
            </Col>
          </Row>
        </div>
      </div>

      {/* Stats */}
      {data && s && s.worker_count > 0 && (
        <Row gutter={[10, 10]} style={{ marginBottom: 20 }}>
          {stats.map((st, i) => (
            <Col xs={12} sm={i < 4 ? 6 : 24} key={i}>
              <div style={{
                padding: '14px 16px', borderRadius: 14, background: st.bg,
                boxShadow: `0 4px 14px ${st.glow}`,
                animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.07}s`,
              }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                  {st.icon} {st.label}
                </div>
                <div className="num" style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{st.value}</div>
              </div>
            </Col>
          ))}
        </Row>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : !data?.fruits?.length ? (
        <div className="panel" style={{ padding: 60, textAlign: 'center' }}>
          <Empty description="该日期没有派工记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          {(data?.available_dates?.length ?? 0) > 0 && (
            <div style={{ marginTop: 12, color: 'var(--text-3)', fontSize: 13 }}>
              可选日期：{data?.available_dates?.slice(0, 5).map(d => dayjs(d).format('MM-DD')).join('、')}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Worker Ranking */}
          {(data?.worker_stats?.length ?? 0) > 0 && (
            <div className="panel" style={{ marginBottom: 20 }}>
              <div className="panel-head">
                <span className="panel-title"><TrophyOutlined style={{ color: '#fa8c16' }} /> 工人消耗排行</span>
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {data!.worker_stats.map((w, i) => {
                  const color = COLORS[i % COLORS.length];
                  const maxW = data!.worker_stats[0]?.total_weight || 1;
                  return (
                    <div key={w.worker_id} style={{
                      flex: '1 1 140px', maxWidth: 200, padding: '12px 14px', borderRadius: 12,
                      border: `1px solid ${color}20`, background: `${color}05`,
                      animation: `stagger-in 0.4s ease both`, animationDelay: `${i * 0.06}s`,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        {i < 3 && (
                          <span style={{ fontSize: 16 }}>{['🥇', '🥈', '🥉'][i]}</span>
                        )}
                        <Avatar size={26} style={{ background: color, fontWeight: 700, fontSize: 11, flexShrink: 0 }}>
                          {w.worker_name.charAt(0)}
                        </Avatar>
                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{w.worker_name}</span>
                      </div>
                      <Progress percent={Math.round((w.total_weight / maxW) * 100)} showInfo={false}
                        strokeColor={color} trailColor="rgba(0,0,0,0.04)" size="small" />
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11 }}>
                        <span style={{ color: 'var(--text-3)' }}>{w.total_weight}kg</span>
                        <span style={{ color: 'var(--text-4)' }}>{w.item_count}件 · {w.batch_count}批</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Fruit Groups */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {data!.fruits.map((fruit, fi) => {
              const color = COLORS[fi % COLORS.length];
              return (
                <div key={fruit.fruit_name} className="panel" style={{
                  overflow: 'hidden',
                  animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${fi * 0.08}s`,
                }}>
                  {/* Fruit Header */}
                  <div style={{
                    padding: '16px 20px',
                    background: `linear-gradient(135deg, ${color}12, ${color}06)`,
                    borderBottom: '1px solid var(--border-2)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 28 }}>{getFruitIcon(fruit.fruit_name)}</span>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text-1)' }}>{fruit.fruit_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-4)' }}>{fruit.batch_count} 个批次</div>
                      </div>
                    </div>
                    <Tag style={{
                      borderRadius: 10, fontWeight: 700, fontSize: 14, padding: '4px 14px',
                      background: `${color}12`, color, border: `1px solid ${color}30`,
                    }}>
                      消耗 {fruit.total_consumed}kg
                    </Tag>
                  </div>

                  {/* Batch Cards */}
                  <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {fruit.batches.map((batch, bi) => (
                      <div key={batch.purchase_id} style={{
                        border: '1px solid var(--border-2)', borderRadius: 12, overflow: 'hidden',
                      }}>
                        {/* Batch Header */}
                        <div style={{
                          padding: '12px 16px', background: 'var(--gray-1)',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
                          borderBottom: '1px solid var(--border-2)',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Tag color="blue" style={{ borderRadius: 6, fontWeight: 600 }}>#{batch.purchase_id}</Tag>
                            <span style={{ fontWeight: 600, fontSize: 13 }}>{batch.supplier_name}</span>
                            <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{batch.purchase_date}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Tooltip title="采购重量">
                              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                                采购 <span className="num" style={{ fontWeight: 700 }}>{batch.purchase_weight}kg</span>
                              </span>
                            </Tooltip>
                            <Tooltip title="出库消耗">
                              <span style={{ fontSize: 12, color: '#00b96b' }}>
                                消耗 <span className="num" style={{ fontWeight: 700 }}>{batch.total_consumed_weight}kg</span>
                              </span>
                            </Tooltip>
                            <Tooltip title="使用率">
                              <Tag color={batch.usage_pct > 90 ? 'red' : batch.usage_pct > 70 ? 'orange' : 'green'}
                                style={{ borderRadius: 8, fontWeight: 700 }}>
                                {batch.usage_pct}%
                              </Tag>
                            </Tooltip>
                          </div>
                        </div>

                        {/* Usage Progress */}
                        <div style={{ padding: '0 16px', paddingTop: 10 }}>
                          <Progress percent={Math.min(batch.usage_pct, 100)}
                            strokeColor={batch.usage_pct > 90 ? '#ff4d4f' : batch.usage_pct > 70 ? '#fa8c16' : '#00b96b'}
                            trailColor="rgba(0,0,0,0.04)" size="small" showInfo={false} />
                        </div>

                        {/* Workers Table */}
                        <div style={{ padding: '8px 0' }}>
                          <Table
                            dataSource={batch.workers}
                            rowKey="worker_id"
                            pagination={false}
                            size="small"
                            locale={{ emptyText: '暂无工人' }}
                            columns={[
                              {
                                title: '工人', dataIndex: 'worker_name', width: 140,
                                render: (v: string, _: WorkerDetail, i: number) => (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Avatar size={26} style={{ background: COLORS[(bi + i) % COLORS.length], fontWeight: 700, fontSize: 11 }}>
                                      {v.charAt(0)}
                                    </Avatar>
                                    <span style={{ fontWeight: 600, fontSize: 13 }}>{v}</span>
                                  </div>
                                ),
                              },
                              {
                                title: '消耗重量(kg)', dataIndex: 'consumed_weight', width: 120, align: 'right' as const,
                                render: (v: number) => <span className="num" style={{ fontWeight: 700, color: v > 0 ? '#00b96b' : 'var(--text-4)' }}>{v}</span>,
                              },
                              {
                                title: '出库件数', dataIndex: 'item_count', width: 100, align: 'right' as const,
                                render: (v: number) => <span className="num" style={{ fontWeight: 600, color: v > 0 ? '#1677ff' : 'var(--text-4)' }}>{v}</span>,
                              },
                              {
                                title: '占比', key: 'pct', width: 120,
                                render: (_: unknown, r: WorkerDetail) => {
                                  const pct = batch.total_consumed_weight > 0 ? Math.round((r.consumed_weight / batch.total_consumed_weight) * 100) : 0;
                                  return (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                      <Progress percent={pct} size="small" showInfo={false}
                                        strokeColor={COLORS[(bi) % COLORS.length]} trailColor="rgba(0,0,0,0.04)"
                                        style={{ flex: 1, margin: 0 }} />
                                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', minWidth: 30 }}>{pct}%</span>
                                    </div>
                                  );
                                },
                              },
                            ]}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
