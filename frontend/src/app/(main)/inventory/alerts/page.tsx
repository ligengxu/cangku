'use client';

import { useState, useEffect, useCallback } from 'react';
import { Row, Col, Tooltip, Tag, Space, Button, message, Progress, Table, Badge } from 'antd';
import {
  AlertOutlined, ReloadOutlined, ShoppingCartOutlined,
  ThunderboltOutlined, ClockCircleOutlined, FireOutlined,
  InboxOutlined, SafetyCertificateOutlined, WarningOutlined,
  RiseOutlined, FallOutlined, DashboardOutlined, DownloadOutlined,
  CheckCircleOutlined, ExclamationCircleOutlined, StopOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dayjs from 'dayjs';
import { exportToCsv } from '@/utils/exportCsv';

interface BoxItem {
  id: number;
  box_type: string;
  stock_quantity: number;
  threshold: number;
  price: number;
  stock_value: number;
  health: 'healthy' | 'warning' | 'danger' | 'critical';
  sku_count: number;
  consumption_7d: number;
  consumption_30d: number;
  daily_rate: number;
  days_remaining: number;
  predicted_stockout: string | null;
  suggest_purchase_qty: number;
  suggest_purchase_cost: number;
  purchase_30d: number;
  daily_consumption: { date: string; count: number }[];
}

interface DashboardData {
  summary: {
    total_types: number;
    total_stock_qty: number;
    total_stock_value: number;
    healthy_count: number;
    warning_count: number;
    danger_count: number;
    total_consumption_7d: number;
    total_consumption_30d: number;
    total_suggest_qty: number;
    total_suggest_cost: number;
  };
  boxes: BoxItem[];
  purchase_trend: { date: string; purchase: number; consumption: number }[];
}

const HEALTH_CONFIG = {
  critical: { label: '已断货', color: '#ff4d4f', bg: 'linear-gradient(135deg, #ff4d4f 0%, #cf1322 100%)', icon: <StopOutlined /> },
  danger: { label: '紧急', color: '#fa8c16', bg: 'linear-gradient(135deg, #fa8c16 0%, #d48806 100%)', icon: <ExclamationCircleOutlined /> },
  warning: { label: '偏低', color: '#faad14', bg: 'linear-gradient(135deg, #faad14 0%, #d4b106 100%)', icon: <WarningOutlined /> },
  healthy: { label: '正常', color: '#52c41a', bg: 'linear-gradient(135deg, #52c41a 0%, #389e0d 100%)', icon: <CheckCircleOutlined /> },
};

export default function InventoryAlertsPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DashboardData | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string>('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/inventory/stock-dashboard');
      setData(res.data?.data ?? null);
      setLastRefresh(dayjs().format('HH:mm:ss'));
    } catch {
      message.error('加载库存预警数据失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const handleExport = () => {
    if (!data?.boxes?.length) { message.warning('暂无数据'); return; }
    const csvCols = [
      { key: 'box_type', title: '纸箱类型' },
      { key: 'stock_quantity', title: '当前库存' },
      { key: 'threshold', title: '预警阈值' },
      { key: 'health', title: '健康状态', render: (v: unknown) => HEALTH_CONFIG[v as keyof typeof HEALTH_CONFIG]?.label ?? String(v) },
      { key: 'consumption_7d', title: '7日消耗' },
      { key: 'consumption_30d', title: '30日消耗' },
      { key: 'daily_rate', title: '日均消耗' },
      { key: 'days_remaining', title: '预计可用天数', render: (v: unknown) => Number(v) >= 999 ? '充足' : String(v) },
      { key: 'predicted_stockout', title: '预计断货日', render: (v: unknown) => v ? String(v) : '-' },
      { key: 'suggest_purchase_qty', title: '建议采购量' },
      { key: 'suggest_purchase_cost', title: '建议采购成本' },
      { key: 'sku_count', title: '关联SKU数' },
      { key: 'purchase_30d', title: '30日采购量' },
      { key: 'stock_value', title: '库存金额' },
    ];
    exportToCsv(data.boxes, csvCols, `库存预警报表`);
  };

  const s = data?.summary;

  const trendMax = Math.max(...(data?.purchase_trend?.map(d => Math.max(d.purchase, d.consumption)) ?? []), 1);

  const columns: any[] = [
    {
      title: '纸箱类型', dataIndex: 'box_type', key: 'box_type', width: 160, fixed: 'left' as const,
      render: (v: string, r: BoxItem) => {
        const cfg = HEALTH_CONFIG[r.health];
        return (
          <Space size={8}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%', background: cfg.color,
              boxShadow: `0 0 8px ${cfg.color}60`,
              animation: r.health === 'critical' ? 'pulse-dot 1.5s infinite' : undefined,
            }} />
            <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{v}</span>
          </Space>
        );
      },
    },
    {
      title: '状态', dataIndex: 'health', key: 'health', width: 90, align: 'center' as const,
      render: (v: string) => {
        const cfg = HEALTH_CONFIG[v as keyof typeof HEALTH_CONFIG];
        return <Tag color={cfg?.color} style={{ borderRadius: 8, fontSize: 11, fontWeight: 600, margin: 0 }}>{cfg?.icon} {cfg?.label}</Tag>;
      },
    },
    {
      title: '库存', dataIndex: 'stock_quantity', key: 'stock_quantity', width: 120, align: 'right' as const,
      render: (v: number, r: BoxItem) => {
        const pct = r.threshold > 0 ? Math.min((v / (r.threshold * 2)) * 100, 100) : 100;
        const color = r.health === 'critical' ? '#ff4d4f' : r.health === 'danger' ? '#fa8c16' : r.health === 'warning' ? '#faad14' : '#52c41a';
        return (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
              <span className="num" style={{ fontWeight: 700, color }}>{v.toLocaleString()}</span>
              <span style={{ color: 'var(--text-4)', fontSize: 11 }}>/ {r.threshold}</span>
            </div>
            <Progress percent={pct} size="small" showInfo={false} strokeColor={color}
              trailColor="rgba(0,0,0,0.04)" style={{ marginBottom: 0 }} />
          </div>
        );
      },
    },
    {
      title: '日均消耗', dataIndex: 'daily_rate', key: 'daily_rate', width: 90, align: 'right' as const,
      render: (v: number) => (
        <span className="num" style={{ fontWeight: 600, color: v > 0 ? '#fa8c16' : 'var(--text-4)' }}>
          {v > 0 ? v.toFixed(1) : '-'}
          {v > 0 && <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 2 }}>/天</span>}
        </span>
      ),
    },
    {
      title: '可用天数', dataIndex: 'days_remaining', key: 'days_remaining', width: 100, align: 'center' as const,
      render: (v: number, r: BoxItem) => {
        if (v >= 999) return <Tag color="green" style={{ borderRadius: 8 }}>充足</Tag>;
        const color = v <= 3 ? '#ff4d4f' : v <= 7 ? '#fa8c16' : v <= 14 ? '#faad14' : '#52c41a';
        return (
          <Tooltip title={r.predicted_stockout ? `预计 ${r.predicted_stockout} 断货` : ''}>
            <span className="num" style={{ fontWeight: 700, color, fontSize: 16 }}>
              {v.toFixed(0)}
              <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 2 }}>天</span>
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: '7日趋势', key: 'trend', width: 120,
      render: (_: any, r: BoxItem) => {
        const max = Math.max(...r.daily_consumption.map(d => d.count), 1);
        return (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 28 }}>
            {r.daily_consumption.map((d, i) => (
              <Tooltip key={i} title={`${d.date}: ${d.count}`}>
                <div style={{
                  flex: 1, height: Math.max((d.count / max) * 24, d.count > 0 ? 3 : 1),
                  background: d.count > 0 ? 'linear-gradient(180deg, #1677ff, #69b1ff88)' : 'rgba(0,0,0,0.04)',
                  borderRadius: '2px 2px 0 0', transition: 'height 0.3s', cursor: 'pointer',
                }} />
              </Tooltip>
            ))}
          </div>
        );
      },
    },
    {
      title: '采购建议', key: 'suggest', width: 160,
      render: (_: any, r: BoxItem) => {
        if (r.suggest_purchase_qty <= 0) return <span style={{ color: 'var(--text-4)', fontSize: 12 }}>暂无需求</span>;
        return (
          <div>
            <div style={{ fontWeight: 700, color: '#1677ff', fontSize: 14 }} className="num">
              <ShoppingCartOutlined style={{ marginRight: 4, fontSize: 12 }} />
              {r.suggest_purchase_qty.toLocaleString()}
              <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 2, color: 'var(--text-3)' }}>个</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
              ≈ ¥{r.suggest_purchase_cost.toLocaleString()}
            </div>
          </div>
        );
      },
    },
    {
      title: '关联SKU', dataIndex: 'sku_count', key: 'sku_count', width: 80, align: 'center' as const,
      render: (v: number) => <Badge count={v} showZero style={{ background: v > 0 ? '#1677ff' : '#d9d9d9' }} />,
    },
  ];

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      <style>{`
        @keyframes pulse-dot { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
      `}</style>

      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22,
        padding: '20px 24px', borderRadius: 'var(--radius-l)',
        background: 'linear-gradient(135deg, rgba(250,140,22,0.06) 0%, rgba(255,77,79,0.04) 50%, rgba(22,119,255,0.03) 100%)',
        border: '1px solid rgba(250,140,22,0.08)',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 32, height: 32, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #fa8c16 0%, #ff4d4f 100%)', color: '#fff', fontSize: 15,
              boxShadow: '0 3px 10px rgba(250,140,22,0.25)',
            }}><AlertOutlined /></span>
            库存预警中心
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 42 }}>
            智能监控库存健康度 · 消耗预测 · 采购建议
            {lastRefresh && <span style={{ marginLeft: 12, fontSize: 11, color: 'var(--text-4)' }}>更新于 {lastRefresh}</span>}
          </div>
        </div>
        <Space>
          <Tooltip title="导出报表">
            <Button icon={<DownloadOutlined />} onClick={handleExport} disabled={!data?.boxes?.length}
              style={{ borderRadius: 10, height: 38, width: 38 }} />
          </Tooltip>
          <Tooltip title="刷新">
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh}
              style={{ borderRadius: 10, height: 38, width: 38 }} />
          </Tooltip>
        </Space>
      </div>

      {/* KPI Cards */}
      <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
        {[
          { label: '库存总量', value: (s?.total_stock_qty ?? 0).toLocaleString(), unit: '个', icon: <InboxOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.15)' },
          { label: '库存总值', value: `¥${((s?.total_stock_value ?? 0) / 1000).toFixed(1)}k`, unit: '', icon: <DashboardOutlined />, gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', glow: 'rgba(114,46,209,0.15)' },
          { label: '7日消耗', value: (s?.total_consumption_7d ?? 0).toLocaleString(), unit: '个', icon: <FireOutlined />, gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.15)' },
          { label: '需采购', value: (s?.total_suggest_qty ?? 0).toLocaleString(), unit: '个', icon: <ShoppingCartOutlined />, gradient: 'linear-gradient(135deg, #ff4d4f 0%, #ff85c0 100%)', glow: 'rgba(255,77,79,0.15)' },
        ].map((card, i) => (
          <Col xs={12} sm={6} key={i}>
            <div style={{
              padding: '14px 16px', borderRadius: 'var(--radius-m)', background: card.gradient,
              position: 'relative', overflow: 'hidden',
              boxShadow: `0 4px 14px ${card.glow}`, transition: 'all 0.3s',
              animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`,
              animationDelay: `${i * 0.08}s`,
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
            >
              <div style={{ position: 'absolute', top: -12, right: -12, width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                {card.icon} {card.label}
              </div>
              <div className="num" style={{ fontSize: 22, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>
                {card.value}
                {card.unit && <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3, opacity: 0.7 }}>{card.unit}</span>}
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* Health Distribution + Trend */}
      <Row gutter={[16, 16]} style={{ marginBottom: 18 }}>
        {/* Health Pie */}
        <Col xs={24} lg={8}>
          <div className="panel" style={{ height: '100%' }}>
            <div className="panel-head">
              <span className="panel-title"><SafetyCertificateOutlined style={{ color: '#52c41a' }} />库存健康分布</span>
            </div>
            <div style={{ padding: '20px 16px' }}>
              {/* Visual health ring */}
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
                <div style={{ position: 'relative', width: 140, height: 140 }}>
                  <svg width="140" height="140" viewBox="0 0 140 140">
                    {(() => {
                      const total = (s?.healthy_count ?? 0) + (s?.warning_count ?? 0) + (s?.danger_count ?? 0);
                      if (total === 0) return <circle cx="70" cy="70" r="55" fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="18" />;
                      const segments = [
                        { count: s?.healthy_count ?? 0, color: '#52c41a' },
                        { count: s?.warning_count ?? 0, color: '#faad14' },
                        { count: s?.danger_count ?? 0, color: '#ff4d4f' },
                      ];
                      const circumference = 2 * Math.PI * 55;
                      let offset = 0;
                      return segments.map((seg, i) => {
                        const pct = seg.count / total;
                        const dash = pct * circumference;
                        const el = (
                          <circle key={i} cx="70" cy="70" r="55" fill="none"
                            stroke={seg.color} strokeWidth="18"
                            strokeDasharray={`${dash} ${circumference - dash}`}
                            strokeDashoffset={-offset}
                            transform="rotate(-90 70 70)"
                            style={{ transition: 'all 0.6s' }}
                          />
                        );
                        offset += dash;
                        return el;
                      });
                    })()}
                  </svg>
                  <div style={{
                    position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                    textAlign: 'center',
                  }}>
                    <div className="num" style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1 }}>
                      {s?.total_types ?? 0}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>种类</div>
                  </div>
                </div>
              </div>

              {/* Legend */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { label: '正常', count: s?.healthy_count ?? 0, color: '#52c41a', icon: <CheckCircleOutlined /> },
                  { label: '偏低', count: s?.warning_count ?? 0, color: '#faad14', icon: <WarningOutlined /> },
                  { label: '紧急/断货', count: s?.danger_count ?? 0, color: '#ff4d4f', icon: <ExclamationCircleOutlined /> },
                ].map((item, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                    borderRadius: 10, background: `${item.color}08`, border: `1px solid ${item.color}15`,
                  }}>
                    <span style={{ color: item.color, fontSize: 14, width: 20, textAlign: 'center' }}>{item.icon}</span>
                    <span style={{ flex: 1, fontSize: 13, color: 'var(--text-2)' }}>{item.label}</span>
                    <span className="num" style={{ fontWeight: 700, fontSize: 18, color: item.count > 0 ? item.color : 'var(--text-4)' }}>{item.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Col>

        {/* Purchase vs Consumption Trend */}
        <Col xs={24} lg={16}>
          <div className="panel" style={{ height: '100%' }}>
            <div className="panel-head">
              <span className="panel-title"><RiseOutlined style={{ color: '#1677ff' }} />30日采购 vs 消耗趋势</span>
              <Space size={12}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                  <span style={{ width: 10, height: 3, background: '#1677ff', borderRadius: 2 }} />采购
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                  <span style={{ width: 10, height: 3, background: '#ff4d4f', borderRadius: 2 }} />消耗
                </span>
              </Space>
            </div>
            <div style={{ padding: '12px 16px', height: 260, position: 'relative' }}>
              {data?.purchase_trend && data.purchase_trend.length > 0 ? (
                <svg width="100%" height="100%" viewBox={`0 0 ${data.purchase_trend.length * 24} 220`} preserveAspectRatio="none">
                  {/* Grid lines */}
                  {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => (
                    <line key={i} x1="0" y1={pct * 190} x2={data.purchase_trend.length * 24} y2={pct * 190}
                      stroke="rgba(0,0,0,0.04)" strokeWidth="1" />
                  ))}
                  {/* Purchase area */}
                  <path d={
                    `M0,190 ` +
                    data.purchase_trend.map((d, i) => `L${i * 24 + 12},${190 - (d.purchase / trendMax) * 170}`).join(' ') +
                    ` L${(data.purchase_trend.length - 1) * 24 + 12},190 Z`
                  } fill="rgba(22,119,255,0.08)" />
                  <polyline
                    points={data.purchase_trend.map((d, i) => `${i * 24 + 12},${190 - (d.purchase / trendMax) * 170}`).join(' ')}
                    fill="none" stroke="#1677ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  />
                  {/* Consumption area */}
                  <path d={
                    `M0,190 ` +
                    data.purchase_trend.map((d, i) => `L${i * 24 + 12},${190 - (d.consumption / trendMax) * 170}`).join(' ') +
                    ` L${(data.purchase_trend.length - 1) * 24 + 12},190 Z`
                  } fill="rgba(255,77,79,0.06)" />
                  <polyline
                    points={data.purchase_trend.map((d, i) => `${i * 24 + 12},${190 - (d.consumption / trendMax) * 170}`).join(' ')}
                    fill="none" stroke="#ff4d4f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  />
                  {/* X-axis labels (every 5 days) */}
                  {data.purchase_trend.map((d, i) => (
                    i % 5 === 0 ? (
                      <text key={i} x={i * 24 + 12} y={210} textAnchor="middle"
                        fontSize="9" fill="var(--text-4)">{d.date}</text>
                    ) : null
                  ))}
                </svg>
              ) : (
                <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-4)' }}>
                  暂无趋势数据
                </div>
              )}
            </div>
          </div>
        </Col>
      </Row>

      {/* Purchase Suggestion Summary */}
      {(s?.total_suggest_qty ?? 0) > 0 && (
        <div style={{
          marginBottom: 18, padding: '16px 20px', borderRadius: 'var(--radius-m)',
          background: 'linear-gradient(135deg, rgba(22,119,255,0.04) 0%, rgba(114,46,209,0.03) 100%)',
          border: '1px solid rgba(22,119,255,0.08)',
          display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          animation: 'stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both 0.3s',
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg, #1677ff, #722ed1)', color: '#fff', fontSize: 18,
          }}>
            <ShoppingCartOutlined />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: 'var(--text-1)', fontSize: 15 }}>
              采购建议汇总
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
              基于14天安全库存计算，共 <span style={{ fontWeight: 600, color: '#1677ff' }}>{data?.boxes?.filter(b => b.suggest_purchase_qty > 0).length}</span> 种纸箱需要补货
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="num" style={{ fontSize: 22, fontWeight: 700, color: '#1677ff' }}>
              {(s?.total_suggest_qty ?? 0).toLocaleString()} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-3)' }}>个</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
              预计 ¥{(s?.total_suggest_cost ?? 0).toLocaleString()}
            </div>
          </div>
        </div>
      )}

      {/* Box Detail Table */}
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title"><ThunderboltOutlined style={{ color: '#fa8c16' }} />各纸箱库存详情</span>
          <span style={{ fontSize: 12, color: 'var(--text-4)' }}>共 {data?.boxes?.length ?? 0} 种</span>
        </div>
        <Table
          dataSource={data?.boxes ?? []}
          columns={columns}
          rowKey="id"
          size="middle"
          loading={loading}
          pagination={false}
          scroll={{ x: 900 }}
          locale={{ emptyText: '暂无纸箱库存数据' }}
          rowClassName={(r: BoxItem) =>
            r.health === 'critical' ? 'row-critical' : r.health === 'danger' ? 'row-danger' : ''
          }
        />
      </div>

      <style>{`
        .row-critical td { background: rgba(255,77,79,0.03) !important; }
        .row-danger td { background: rgba(250,140,22,0.02) !important; }
        .row-critical:hover td, .row-danger:hover td { background: rgba(250,140,22,0.06) !important; }
      `}</style>
    </div>
  );
}
