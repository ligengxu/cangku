'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Row, Col, Tooltip, Button, Spin, Space, Tag, Empty, message, Progress,
} from 'antd';
import {
  ShoppingCartOutlined, TeamOutlined, AppstoreOutlined, PrinterOutlined,
  ExperimentOutlined, AuditOutlined, HomeOutlined, ScanOutlined,
  ReloadOutlined, ArrowRightOutlined, WarningOutlined,
  SyncOutlined, RiseOutlined, FallOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dayjs from 'dayjs';

interface Stage {
  key: string; title: string; value: number; unit: string; color: string;
  sub_value?: string; warning?: number; warning_label?: string;
}
interface Totals { total_labels: number; total_instock: number; total_outbound: number; outbound_rate: number }
interface DailyFlow { date: string; printed: number; outbound: number }
interface PipelineData { stages: Stage[]; totals: Totals; daily_flow: DailyFlow[] }

const STAGE_ICONS: Record<string, React.ReactNode> = {
  purchase: <ShoppingCartOutlined />, assign: <TeamOutlined />,
  request: <AppstoreOutlined />, print: <PrinterOutlined />,
  production: <ExperimentOutlined />, audit: <AuditOutlined />,
  warehouse: <HomeOutlined />, outbound: <ScanOutlined />,
};

export default function PipelinePage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PipelineData | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get('/production/pipeline');
      setData(res.data?.data || null);
    } catch { message.error('加载失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(fetchData, 30000);
    return () => clearInterval(t);
  }, [autoRefresh, fetchData]);

  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const maxFlow = Math.max(...(data?.daily_flow?.map(d => Math.max(d.printed, d.outbound)) || [1]), 1);

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -40, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'absolute', bottom: -20, left: '35%', width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{
                width: 48, height: 48, borderRadius: 14,
                background: 'rgba(255,255,255,0.2)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 24,
                backdropFilter: 'blur(10px)',
              }}><RiseOutlined /></span>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>生产管线</div>
                <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
                  {dayjs().format('YYYY年M月D日')} · 从采购到出库的实时全景
                </div>
              </div>
            </div>
            <Space>
              <Tooltip title={autoRefresh ? '关闭自动刷新(30s)' : '开启自动刷新(30s)'}>
                <Button icon={<SyncOutlined spin={autoRefresh} />}
                  onClick={() => setAutoRefresh(!autoRefresh)}
                  style={{
                    borderRadius: 10, background: autoRefresh ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.15)',
                    border: 'none', color: '#fff',
                  }} />
              </Tooltip>
              <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh}
                style={{ borderRadius: 10, background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff' }} />
            </Space>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : !data ? (
        <Empty description="暂无数据" />
      ) : (
        <>
          {/* Pipeline Flow */}
          <div className="panel" style={{ marginBottom: 20, overflow: 'hidden' }}>
            <div className="panel-head">
              <span className="panel-title"><RiseOutlined style={{ color: '#667eea' }} /> 今日管线流</span>
              <Tag style={{ borderRadius: 10, background: 'rgba(102,126,234,0.08)', color: '#667eea', border: '1px solid rgba(102,126,234,0.15)', fontWeight: 600 }}>
                实时数据
              </Tag>
            </div>
            <div style={{ padding: '20px 16px', overflowX: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 0, minWidth: 'max-content' }}>
                {data.stages.map((stage, i) => (
                  <React.Fragment key={stage.key}>
                    <div style={{
                      flex: '0 0 auto', width: 130, padding: '16px 12px', borderRadius: 14,
                      background: `${stage.color}08`, border: `1px solid ${stage.color}20`,
                      textAlign: 'center', position: 'relative',
                      animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`,
                      animationDelay: `${i * 0.08}s`,
                      transition: 'transform 0.2s, box-shadow 0.2s',
                    }}
                      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = `0 8px 24px ${stage.color}20`; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
                    >
                      <div style={{
                        width: 40, height: 40, borderRadius: 12, margin: '0 auto 10px',
                        background: `linear-gradient(135deg, ${stage.color}, ${stage.color}88)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontSize: 18,
                        boxShadow: `0 4px 14px ${stage.color}30`,
                      }}>
                        {STAGE_ICONS[stage.key]}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4 }}>{stage.title}</div>
                      <div className="num" style={{ fontSize: 24, fontWeight: 800, color: stage.color, lineHeight: 1.2 }}>
                        {stage.value.toLocaleString()}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 2 }}>{stage.unit}</div>
                      {stage.sub_value && (
                        <div style={{ fontSize: 11, color: stage.color, fontWeight: 600, marginTop: 4 }}>{stage.sub_value}</div>
                      )}
                      {stage.warning && stage.warning > 0 && (
                        <Tag icon={<WarningOutlined />} color="warning" style={{
                          borderRadius: 8, fontSize: 10, marginTop: 6, fontWeight: 600,
                        }}>
                          {stage.warning} {stage.warning_label}
                        </Tag>
                      )}
                    </div>
                    {i < data.stages.length - 1 && (
                      <div style={{
                        flex: '0 0 auto', width: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <ArrowRightOutlined style={{
                          fontSize: 14, color: 'var(--text-4)',
                          animation: `pulse-arrow 2s infinite ${i * 0.3}s`,
                        }} />
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>

          {/* Totals + Daily Flow */}
          <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
            {/* Totals */}
            <Col xs={24} lg={8}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head">
                  <span className="panel-title"><HomeOutlined style={{ color: '#2f54eb' }} /> 库存概况</span>
                  <Tag style={{ borderRadius: 10, background: 'rgba(47,84,235,0.08)', color: '#2f54eb', border: '1px solid rgba(47,84,235,0.15)', fontWeight: 600, fontSize: 11 }}>
                    近7天
                  </Tag>
                </div>
                <div style={{ padding: '16px 20px' }}>
                  <div style={{ textAlign: 'center', marginBottom: 16 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 4 }}>生产录入总量</div>
                    <div className="num" style={{ fontSize: 36, fontWeight: 800, color: '#2f54eb' }}>
                      {data.totals.total_labels.toLocaleString()}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                    <div style={{
                      flex: 1, padding: '12px 14px', borderRadius: 12, textAlign: 'center',
                      background: 'linear-gradient(135deg, rgba(47,84,235,0.06), rgba(47,84,235,0.02))',
                      border: '1px solid rgba(47,84,235,0.1)',
                    }}>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>在库</div>
                      <div className="num" style={{ fontSize: 20, fontWeight: 700, color: '#2f54eb' }}>
                        {data.totals.total_instock.toLocaleString()}
                      </div>
                    </div>
                    <div style={{
                      flex: 1, padding: '12px 14px', borderRadius: 12, textAlign: 'center',
                      background: 'linear-gradient(135deg, rgba(82,196,26,0.06), rgba(82,196,26,0.02))',
                      border: '1px solid rgba(82,196,26,0.1)',
                    }}>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>已出库</div>
                      <div className="num" style={{ fontSize: 20, fontWeight: 700, color: '#52c41a' }}>
                        {data.totals.total_outbound.toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                      <span style={{ color: 'var(--text-3)' }}>出库率</span>
                      <span className="num" style={{ fontWeight: 700, color: '#52c41a' }}>{data.totals.outbound_rate}%</span>
                    </div>
                    <Progress percent={data.totals.outbound_rate} showInfo={false}
                      strokeColor={{ from: '#52c41a', to: '#95de64' }} trailColor="rgba(0,0,0,0.04)" />
                  </div>
                </div>
              </div>
            </Col>

            {/* Daily Flow Chart */}
            <Col xs={24} lg={16}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head">
                  <span className="panel-title"><RiseOutlined style={{ color: '#1677ff' }} /> 7日打印/出库趋势</span>
                  <Space size={12}>
                    <span style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: 'linear-gradient(135deg, #1677ff, #69b1ff)', display: 'inline-block' }} />
                      打印
                    </span>
                    <span style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: 'linear-gradient(135deg, #52c41a, #95de64)', display: 'inline-block' }} />
                      出库
                    </span>
                  </Space>
                </div>
                <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'flex-end', gap: 12, height: 200 }}>
                  {data.daily_flow.map((d, i) => {
                    const ph = maxFlow > 0 ? (d.printed / maxFlow) * 130 : 0;
                    const oh = maxFlow > 0 ? (d.outbound / maxFlow) * 130 : 0;
                    const isToday = i === data.daily_flow.length - 1;
                    return (
                      <Tooltip key={d.date} title={`${d.date}: 打印${d.printed} / 出库${d.outbound}`}>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                          <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end' }}>
                            <div style={{
                              width: 16, height: Math.max(ph, d.printed > 0 ? 4 : 2),
                              background: isToday ? 'linear-gradient(180deg, #1677ff, #69b1ff)' : 'linear-gradient(180deg, #1677ff88, #69b1ff55)',
                              borderRadius: '3px 3px 0 0', transition: 'height 0.5s',
                            }} />
                            <div style={{
                              width: 16, height: Math.max(oh, d.outbound > 0 ? 4 : 2),
                              background: isToday ? 'linear-gradient(180deg, #52c41a, #95de64)' : 'linear-gradient(180deg, #52c41a88, #95de6455)',
                              borderRadius: '3px 3px 0 0', transition: 'height 0.5s',
                            }} />
                          </div>
                          <div style={{
                            fontSize: 10, color: isToday ? '#1677ff' : 'var(--text-4)',
                            fontWeight: isToday ? 700 : 400,
                          }}>{d.date.slice(5)}</div>
                        </div>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            </Col>
          </Row>

          {/* Stage Detail Cards */}
          <Row gutter={[12, 12]}>
            {data.stages.map((stage, i) => (
              <Col xs={12} sm={6} key={stage.key}>
                <div style={{
                  padding: '18px 16px', borderRadius: 14,
                  background: `linear-gradient(135deg, ${stage.color}, ${stage.color}cc)`,
                  boxShadow: `0 4px 16px ${stage.color}25`,
                  animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`,
                  animationDelay: `${i * 0.06}s`,
                  position: 'relative', overflow: 'hidden',
                  transition: 'transform 0.2s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
                >
                  <div style={{ position: 'absolute', top: -10, right: -10, width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.1)' }} />
                  <div style={{ fontSize: 20, color: 'rgba(255,255,255,0.6)', marginBottom: 8 }}>
                    {STAGE_ICONS[stage.key]}
                  </div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>{stage.title}</div>
                  <div className="num" style={{ fontSize: 26, fontWeight: 800, color: '#fff', lineHeight: 1.3 }}>
                    {stage.value.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)' }}>{stage.unit}</div>
                  {stage.sub_value && (
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.9)', fontWeight: 600, marginTop: 3 }}>
                      {stage.sub_value}
                    </div>
                  )}
                  {stage.warning != null && stage.warning > 0 && (
                    <div style={{
                      marginTop: 6, padding: '2px 8px', borderRadius: 6,
                      background: 'rgba(255,255,255,0.2)', fontSize: 10, color: '#fff',
                      display: 'inline-flex', alignItems: 'center', gap: 3,
                    }}>
                      <WarningOutlined /> {stage.warning} {stage.warning_label}
                    </div>
                  )}
                </div>
              </Col>
            ))}
          </Row>
        </>
      )}

      <style>{`
        @keyframes pulse-arrow {
          0%, 100% { opacity: 0.3; transform: translateX(0); }
          50% { opacity: 1; transform: translateX(3px); }
        }
      `}</style>
    </div>
  );
}
