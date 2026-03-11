'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Row, Col, Spin, Tooltip, Typography, Empty, Progress, Badge, Button } from 'antd';
import {
  ShoppingCartOutlined, AppstoreOutlined, PrinterOutlined, AuditOutlined,
  TeamOutlined, ExportOutlined, FileDoneOutlined, RiseOutlined,
  ArrowRightOutlined, ClockCircleOutlined, SyncOutlined,
  BarChartOutlined, FileTextOutlined, UserAddOutlined, CalendarOutlined,
  DollarOutlined, TrophyOutlined, ThunderboltOutlined, FundOutlined,
  CheckCircleOutlined, WarningOutlined, BellOutlined, CrownOutlined,
  FireOutlined, StarOutlined, RocketOutlined, PieChartOutlined,
  AccountBookOutlined, ReconciliationOutlined,
  BugOutlined, EditOutlined, SafetyCertificateOutlined,
  DashboardOutlined, ExperimentOutlined, AlertOutlined, RobotOutlined,
  DownOutlined, UpOutlined,
} from '@ant-design/icons';
import { useAuth } from '@/stores/useAuth';
import { useRouter } from 'next/navigation';
import api from '@/services/api';
import { useDevice } from '@/hooks/useDevice';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import dynamic from 'next/dynamic';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Text } = Typography;

interface FullDash { stats: any; yesterday?: any; finance?: any; trends?: any; top_skus?: any[]; top_workers?: any[]; notices?: any[]; alerts?: any[]; activity?: any[]; production_efficiency?: any; todo_items?: any[]; date: string }

function CompareTag({ current, previous }: { current: number; previous: number | undefined }) {
  if (previous === undefined || previous === null) return null;
  if (previous === 0 && current === 0) return null;
  const diff = current - previous;
  if (diff === 0) return <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginLeft: 4 }}>持平</span>;
  const pct = previous > 0 ? Math.round(Math.abs(diff) / previous * 100) : 100;
  const up = diff > 0;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 2,
      fontSize: 10, fontWeight: 600, marginLeft: 4,
      padding: '1px 6px', borderRadius: 8,
      background: up ? 'rgba(82,196,26,0.25)' : 'rgba(255,77,79,0.25)',
      color: '#fff',
    }}>
      {up ? '↑' : '↓'}{pct}%
    </span>
  );
}

function AnimNum({ value, color }: { value: number; color?: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!value) { setN(0); return; }
    let cur = 0;
    const step = Math.max(1, Math.ceil(value / 20));
    const t = setInterval(() => { cur += step; if (cur >= value) { setN(value); clearInterval(t); } else setN(cur); }, 25);
    return () => clearInterval(t);
  }, [value]);
  return <span className="num" style={{ color }}>{n.toLocaleString()}</span>;
}

function TrendChart({ trends }: { trends: any }) {
  const production = trends?.production || [];
  const purchases = trends?.purchases || [];
  const outbound = trends?.outbound || [];
  if (!production.length && !purchases.length && !outbound.length) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无趋势数据" />;
  }
  const dates = production.map((d: any) => d.date) || purchases.map((d: any) => d.date) || [];
  const option = {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#333', fontSize: 12 },
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(22,119,255,0.04)' } },
    },
    legend: {
      bottom: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 8,
      textStyle: { color: '#8a919f', fontSize: 11 },
    },
    grid: { top: 15, right: 15, bottom: 35, left: 40 },
    xAxis: {
      type: 'category', data: dates, boundaryGap: false,
      axisLine: { lineStyle: { color: '#e8e8e8' } },
      axisTick: { show: false },
      axisLabel: { color: '#8a919f', fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { color: '#f5f5f5', type: 'dashed' } },
      axisLabel: { color: '#8a919f', fontSize: 10 },
    },
    series: [
      {
        name: '标签产量', type: 'line', smooth: true, symbol: 'circle', symbolSize: 6, showSymbol: false,
        data: production.map((d: any) => d.value),
        lineStyle: { width: 2.5, color: '#5470c6' },
        itemStyle: { color: '#5470c6' },
        areaStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(84,112,198,0.25)' }, { offset: 1, color: 'rgba(84,112,198,0.01)' }] },
        },
        emphasis: { focus: 'series' },
      },
      {
        name: '采购批次', type: 'line', smooth: true, symbol: 'circle', symbolSize: 6, showSymbol: false,
        data: purchases.map((d: any) => d.value),
        lineStyle: { width: 2.5, color: '#91cc75' },
        itemStyle: { color: '#91cc75' },
        areaStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(145,204,117,0.25)' }, { offset: 1, color: 'rgba(145,204,117,0.01)' }] },
        },
        emphasis: { focus: 'series' },
      },
      {
        name: '出库数量', type: 'line', smooth: true, symbol: 'circle', symbolSize: 6, showSymbol: false,
        data: outbound.map((d: any) => d.value),
        lineStyle: { width: 2.5, color: '#fac858' },
        itemStyle: { color: '#fac858' },
        areaStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(250,200,88,0.25)' }, { offset: 1, color: 'rgba(250,200,88,0.01)' }] },
        },
        emphasis: { focus: 'series' },
      },
    ],
    animationDuration: 1200,
    animationEasing: 'cubicOut',
  };
  return <ReactECharts option={option} style={{ height: 260 }} notMerge />;
}

function FinancePieChart({ finance }: { finance: any }) {
  if (!finance) return null;
  const total = Number(finance.unpaid_fruit_cnt || 0) + Number(finance.unpaid_carton_cnt || 0) + Number(finance.unpaid_material_cnt || 0);
  if (total === 0) return <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-4)', fontSize: 12 }}>暂无未付订单</div>;
  const option = {
    tooltip: { trigger: 'item', backgroundColor: 'rgba(255,255,255,0.96)', borderColor: 'rgba(0,0,0,0.08)', borderWidth: 1, textStyle: { color: '#333', fontSize: 12 } },
    series: [{
      type: 'pie', radius: ['55%', '80%'], center: ['50%', '50%'],
      padAngle: 3, itemStyle: { borderRadius: 6 },
      label: { show: false },
      emphasis: { scaleSize: 5 },
      data: [
        { name: '水果未付', value: finance.unpaid_fruit_cnt || 0, itemStyle: { color: '#5470c6' } },
        { name: '纸箱未付', value: finance.unpaid_carton_cnt || 0, itemStyle: { color: '#fac858' } },
        { name: '材料未付', value: finance.unpaid_material_cnt || 0, itemStyle: { color: '#9a60b4' } },
      ],
      animationType: 'scale', animationEasing: 'elasticOut',
    }],
    graphic: [{ type: 'group', left: 'center', top: 'middle', children: [
      { type: 'text', style: { text: `${total}`, x: 0, y: -6, fill: '#1f1f1f', fontSize: 20, fontWeight: 700, textAlign: 'center' } },
      { type: 'text', style: { text: '未付', x: 0, y: 12, fill: '#8a919f', fontSize: 10, textAlign: 'center' } },
    ] }],
  };
  return <ReactECharts option={option} style={{ height: 130 }} notMerge />;
}

function ProductionEfficiencyChart({ data }: { data: any }) {
  if (!data) return null;
  const rate = data.outbound_rate || 0;
  const option = {
    series: [{
      type: 'gauge',
      startAngle: 220,
      endAngle: -40,
      min: 0,
      max: 100,
      pointer: { show: false },
      progress: {
        show: true,
        overlap: false,
        roundCap: true,
        clip: false,
        itemStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
            colorStops: [
              { offset: 0, color: '#1677ff' },
              { offset: 0.5, color: '#722ed1' },
              { offset: 1, color: '#eb2f96' },
            ],
          },
        },
      },
      axisLine: { lineStyle: { width: 12, color: [[1, 'rgba(22,119,255,0.08)']] } },
      splitLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      data: [{ value: rate }],
      detail: {
        fontSize: 24, fontWeight: 700, fontFamily: 'DIN Alternate, sans-serif',
        offsetCenter: [0, '10%'],
        formatter: '{value}%',
        color: '#1f1f1f',
      },
      title: {
        offsetCenter: [0, '40%'],
        fontSize: 11,
        color: '#8a919f',
      },
    }],
  };
  return <ReactECharts option={option} style={{ height: 155 }} notMerge />;
}


function RankIdx({ n }: { n: number }) {
  const cls = n === 1 ? 'gold' : n === 2 ? 'silver' : n === 3 ? 'bronze' : '';
  const icon = n === 1 ? <CrownOutlined /> : null;
  return <div className={`rank-idx ${cls}`}>{icon || n}</div>;
}

const STAT_CARDS = [
  { k: 'purchases', l: '今日采购', icon: <ShoppingCartOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.18)' },
  { k: 'assignments', l: '批次分配', icon: <AppstoreOutlined />, gradient: 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: 'rgba(0,185,107,0.18)' },
  { k: 'pending_print', l: '待打印', icon: <PrinterOutlined />, gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.18)' },
  { k: 'pending_audit', l: '待审核', icon: <AuditOutlined />, gradient: 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)', glow: 'rgba(255,77,79,0.18)' },
];

const STAT_CARDS_2 = [
  { k: 'today_active', l: '活跃工人', icon: <TeamOutlined />, gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', glow: 'rgba(114,46,209,0.18)' },
  { k: 'today_outbound', l: '今日出库', icon: <ExportOutlined />, gradient: 'linear-gradient(135deg, #13c2c2 0%, #5cdbd3 100%)', glow: 'rgba(19,194,194,0.18)' },
  { k: 'today_printed', l: '今日打印', icon: <FileDoneOutlined />, gradient: 'linear-gradient(135deg, #eb2f96 0%, #ff85c0 100%)', glow: 'rgba(235,47,150,0.18)' },
  { k: 'pending_edits', l: '修改待审', icon: <FileTextOutlined />, gradient: 'linear-gradient(135deg, #2f54eb 0%, #85a5ff 100%)', glow: 'rgba(47,84,235,0.18)' },
];

const ADMIN_SHORTCUTS = [
  { label: '水果采购', icon: <ShoppingCartOutlined />, path: '/orders/fruit', gradient: 'linear-gradient(135deg, #e6f7ff 0%, #bae7ff 100%)', fg: '#1677ff' },
  { label: '批次分配', icon: <AppstoreOutlined />, path: '/production/assign', gradient: 'linear-gradient(135deg, #f6ffed 0%, #d9f7be 100%)', fg: '#52c41a' },
  { label: '标签打印', icon: <PrinterOutlined />, path: '/production/print', gradient: 'linear-gradient(135deg, #fff7e6 0%, #ffe7ba 100%)', fg: '#fa8c16' },
  { label: '生产审核', icon: <AuditOutlined />, path: '/production/audit', gradient: 'linear-gradient(135deg, #fff2f0 0%, #ffccc7 100%)', fg: '#ff4d4f' },
  { label: 'SKU 管理', icon: <BarChartOutlined />, path: '/inventory/sku', gradient: 'linear-gradient(135deg, #e6fffb 0%, #b5f5ec 100%)', fg: '#13c2c2' },
  { label: '工人管理', icon: <UserAddOutlined />, path: '/workers/list', gradient: 'linear-gradient(135deg, #f9f0ff 0%, #efdbff 100%)', fg: '#722ed1' },
  { label: '数据分析', icon: <FundOutlined />, path: '/reports/analytics', gradient: 'linear-gradient(135deg, #fff0f6 0%, #ffd6e7 100%)', fg: '#eb2f96' },
  { label: '财务报表', icon: <AccountBookOutlined />, path: '/reports/finance', gradient: 'linear-gradient(135deg, #fcffe6 0%, #eaff8f 100%)', fg: '#a0d911' },
  { label: '供应商对账', icon: <ReconciliationOutlined />, path: '/reports/statement', gradient: 'linear-gradient(135deg, #e6fffb 0%, #87e8de 100%)', fg: '#13c2c2' },
  { label: '库存预警', icon: <WarningOutlined />, path: '/inventory/alerts', gradient: 'linear-gradient(135deg, #fff2f0 0%, #ffa39e 100%)', fg: '#ff4d4f' },
  { label: '库存盘点', icon: <FileDoneOutlined />, path: '/inventory/checks', gradient: 'linear-gradient(135deg, #f9f0ff 0%, #d3adf7 100%)', fg: '#722ed1' },
  { label: '损耗分析', icon: <PieChartOutlined />, path: '/reports/loss', gradient: 'linear-gradient(135deg, #fff7e6 0%, #ffd591 100%)', fg: '#fa8c16' },
  { label: '生产大屏', icon: <ThunderboltOutlined />, path: '/production/screen', gradient: 'linear-gradient(135deg, #fff0f6 0%, #ffadd2 100%)', fg: '#eb2f96' },
];

const WORKER_SHORTCUTS = [
  { label: 'SKU 申请', icon: <AppstoreOutlined />, path: '/production/request', gradient: 'linear-gradient(135deg, #fff0f6 0%, #ffd6e7 100%)', fg: '#eb2f96' },
  { label: '生产录入', icon: <RiseOutlined />, path: '/production/input', gradient: 'linear-gradient(135deg, #e6f7ff 0%, #bae7ff 100%)', fg: '#1677ff' },
  { label: '我的绩效', icon: <ThunderboltOutlined />, path: '/workers/performance', gradient: 'linear-gradient(135deg, #fff7e6 0%, #ffe7ba 100%)', fg: '#fa8c16' },
  { label: '绩效排行', icon: <TrophyOutlined />, path: '/workers/ranking', gradient: 'linear-gradient(135deg, #f6ffed 0%, #d9f7be 100%)', fg: '#52c41a' },
  { label: '我的佣金', icon: <DollarOutlined />, path: '/workers/commission', gradient: 'linear-gradient(135deg, #f9f0ff 0%, #efdbff 100%)', fg: '#722ed1' },
  { label: '产量日历', icon: <CalendarOutlined />, path: '/workers/calendar', gradient: 'linear-gradient(135deg, #e6fffb 0%, #b5f5ec 100%)', fg: '#13c2c2' },
];

const TODO_ICONS: Record<string, React.ReactNode> = {
  printer: <PrinterOutlined />,
  audit: <AuditOutlined />,
  edit: <EditOutlined />,
  calendar: <CalendarOutlined />,
  warning: <WarningOutlined />,
  bug: <BugOutlined />,
};

function GradientStatCard({ item, value, sub, delay, prevValue }: { item: typeof STAT_CARDS[0]; value: number; sub?: string; delay: number; prevValue?: number }) {
  return (
    <div className={`stagger-${delay}`} style={{
      background: item.gradient, borderRadius: 'var(--radius-l)', padding: '22px 20px',
      display: 'flex', alignItems: 'flex-start', gap: 14, position: 'relative', overflow: 'hidden',
      boxShadow: `0 6px 20px ${item.glow}`, transition: 'all 0.35s cubic-bezier(0.22, 1, 0.36, 1)', cursor: 'default',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px) scale(1.02)'; e.currentTarget.style.boxShadow = `0 10px 30px ${item.glow}`; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = `0 6px 20px ${item.glow}`; }}
    >
      <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.12)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: -30, left: -10, width: 60, height: 60, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', pointerEvents: 'none' }} />
      <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: '#fff', flexShrink: 0, backdropFilter: 'blur(8px)' }}>
        {item.icon}
      </div>
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', lineHeight: 1.4, marginBottom: 2 }}>
          {item.l}
          <CompareTag current={value} previous={prevValue} />
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#fff', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>
          <AnimNum value={value} color="#fff" />
          {sub && <span style={{ fontSize: 13, fontWeight: 400, marginLeft: 4, opacity: 0.75 }}>{sub}</span>}
        </div>
      </div>
    </div>
  );
}

function AIBriefPanel() {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const fetchedRef = useRef(false);

  const fetchBrief = useCallback(async () => {
    setLoading(true);
    setContent('');
    try {
      const response = await fetch('/api/ai/quick-analysis', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ analysis_type: 'today_summary' }),
      });
      if (!response.ok) throw new Error('Failed');
      const reader = response.body?.getReader();
      if (!reader) return;
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
            if (p.content) acc += p.content;
          } catch {}
        }
        setContent(acc);
      }
    } catch {
      setContent('AI 摘要暂时不可用');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!fetchedRef.current) {
      fetchedRef.current = true;
      fetchBrief();
    }
  }, [fetchBrief]);

  const formatMd = (text: string) => text.split(/(\*\*.*?\*\*|\n)/g).map((p, i) => {
    if (p === '\n') return <br key={i} />;
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i} style={{ color: '#667eea' }}>{p.slice(2, -2)}</strong>;
    return <span key={i}>{p}</span>;
  });

  return (
    <div className="panel" style={{ marginBottom: 22 }}>
      <div className="panel-head">
        <span className="panel-title">
          <RobotOutlined style={{ color: '#667eea' }} />
          AI 每日运营简报
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 10, padding: '2px 8px', borderRadius: 10,
            background: 'linear-gradient(135deg, rgba(102,126,234,0.1), rgba(118,75,162,0.1))',
            color: '#667eea', fontWeight: 600,
          }}>Qwen AI</span>
          <Button type="text" size="small" onClick={fetchBrief} disabled={loading}
            style={{ fontSize: 11, color: 'var(--text-3)' }}>
            {loading ? <Spin size="small" /> : <SyncOutlined />}
          </Button>
        </div>
      </div>
      <div className="panel-body" style={{ padding: '12px 20px 16px' }}>
        {loading && !content ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0' }}>
            <Spin size="small" />
            <Text type="secondary" style={{ fontSize: 13 }}>果小智正在分析今日数据...</Text>
          </div>
        ) : content ? (
          <div style={{
            fontSize: 13, lineHeight: 1.8, color: 'var(--text-2)',
            maxHeight: expanded ? 'none' : 120, overflow: 'hidden',
            position: 'relative',
          }}>
            {formatMd(content)}
            {!expanded && content.length > 200 && (
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0, height: 40,
                background: 'linear-gradient(transparent, var(--gray-1))',
              }} />
            )}
          </div>
        ) : null}
        {content.length > 200 && (
          <div style={{ textAlign: 'center', marginTop: 4 }}>
            <Button type="link" size="small" onClick={() => setExpanded(!expanded)} style={{ fontSize: 12 }}>
              {expanded ? '收起' : '展开全文'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, isAdmin } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<FullDash | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [alertsCollapsed, setAlertsCollapsed] = useState(false);
  const [alertsTouched, setAlertsTouched] = useState(false);

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const r = await api.get('/dashboard/full');
      setData(r.data?.data || null);
    } catch {
      try {
        const [s1, s2] = await Promise.all([api.get('/dashboard/stats'), api.get('/dashboard/today-stats')]);
        setData({ stats: { ...s1.data?.data, ...s2.data?.data }, date: s1.data?.data?.date || '' });
      } catch { /* noop */ }
    } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (!alertsTouched) {
      setAlertsCollapsed((data?.alerts?.length || 0) > 4);
    }
  }, [data?.alerts?.length, alertsTouched]);

  const admin = isAdmin();
  const now = dayjs();
  const hour = now.hour();
  const greeting = hour < 6 ? '凌晨好' : hour < 12 ? '上午好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  const s = data?.stats || {};
  const alerts = data?.alerts || [];
  const dangerAlerts = alerts.filter((a: any) => a.type === 'danger').length;
  const warningAlerts = alerts.filter((a: any) => a.type === 'warning').length;

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
      <div style={{ textAlign: 'center' }}>
        <Spin size="large" />
        <div style={{ marginTop: 16, color: 'var(--text-3)', fontSize: 13 }}>加载数据中...</div>
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Welcome */}
      <div className="stagger-1" style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 28, padding: '24px 28px',
        background: 'linear-gradient(135deg, rgba(22,119,255,0.06) 0%, rgba(114,46,209,0.04) 50%, rgba(235,47,150,0.03) 100%)',
        borderRadius: 'var(--radius-xl)', border: '1px solid rgba(22,119,255,0.08)',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -40, right: 60, width: 120, height: 120, borderRadius: '50%', background: 'radial-gradient(circle, rgba(22,119,255,0.06) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -30, left: '40%', width: 80, height: 80, borderRadius: '50%', background: 'radial-gradient(circle, rgba(114,46,209,0.05) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 8 }}>
            {greeting}，{user?.real_name || user?.username}
            <StarOutlined style={{ fontSize: 16, color: '#faad14' }} />
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <RocketOutlined style={{ fontSize: 12, color: 'var(--brand)' }} />
            {admin ? '今日运营数据一览' : '今日工作进展'}
            <span style={{ display: 'inline-block', padding: '1px 10px', borderRadius: 20, background: 'linear-gradient(135deg, rgba(22,119,255,0.08) 0%, rgba(114,46,209,0.06) 100%)', fontSize: 12, color: 'var(--text-2)' }}>
              {now.format('YYYY年M月D日 dddd')}
            </span>
          </div>
        </div>
        <Tooltip title="刷新数据">
          <div onClick={() => fetchAll(true)} style={{
            width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.8)',
            border: '1px solid rgba(22,119,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--brand)', fontSize: 14, backdropFilter: 'blur(8px)',
            transition: 'all 0.25s', boxShadow: '0 2px 8px rgba(22,119,255,0.08)',
          }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'rotate(90deg) scale(1.1)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(22,119,255,0.15)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 2px 8px rgba(22,119,255,0.08)'; }}
          >
            <SyncOutlined spin={refreshing} />
          </div>
        </Tooltip>
      </div>

      {/* Alerts */}
      {!!alerts.length && (
        <div className="stagger-2" style={{ marginBottom: 22 }}>
          <div
            onClick={() => {
              setAlertsTouched(true);
              setAlertsCollapsed(prev => !prev);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '12px 16px',
              borderRadius: 14,
              cursor: 'pointer',
              background: 'linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(248,250,255,0.96) 100%)',
              border: '1px solid rgba(22,119,255,0.08)',
              boxShadow: '0 8px 24px rgba(15,23,42,0.04)',
              transition: 'all 0.25s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{
                width: 32, height: 32, borderRadius: 10,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: 'linear-gradient(135deg, rgba(255,77,79,0.12) 0%, rgba(250,173,20,0.12) 100%)',
                color: '#ff4d4f', fontSize: 15,
              }}>
                <AlertOutlined />
              </span>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>运营提醒</span>
              <span style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                minWidth: 24, height: 24, borderRadius: 999, padding: '0 8px',
                background: 'linear-gradient(135deg, #1677ff, #722ed1)', color: '#fff', fontSize: 12, fontWeight: 700,
              }}>
                {alerts.length}
              </span>
              {dangerAlerts > 0 && (
                <span style={{ fontSize: 12, color: '#ff4d4f', background: 'rgba(255,77,79,0.08)', borderRadius: 999, padding: '3px 10px' }}>
                  {dangerAlerts} 条高优先级
                </span>
              )}
              {warningAlerts > 0 && (
                <span style={{ fontSize: 12, color: '#d48806', background: 'rgba(250,173,20,0.12)', borderRadius: 999, padding: '3px 10px' }}>
                  {warningAlerts} 条预警
                </span>
              )}
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {alertsCollapsed ? '点击展开详情' : '点击收起'}
              </span>
            </div>
            <span style={{
              width: 28, height: 28, borderRadius: 8,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(22,119,255,0.06)', color: 'var(--brand)', fontSize: 12, flexShrink: 0,
            }}>
              {alertsCollapsed ? <DownOutlined /> : <UpOutlined />}
            </span>
          </div>

          {alertsCollapsed ? (
            <div style={{
              marginTop: 10,
              padding: '12px 16px',
              borderRadius: 14,
              background: 'linear-gradient(135deg, rgba(255,255,255,0.78) 0%, rgba(248,250,255,0.9) 100%)',
              border: '1px dashed rgba(22,119,255,0.12)',
              color: 'var(--text-3)',
              fontSize: 13,
            }}>
              当前共有 <span style={{ fontWeight: 700, color: 'var(--text-1)' }}>{alerts.length}</span> 条提醒，已折叠显示。
            </div>
          ) : (
            <div style={{ marginTop: 10 }}>
              {alerts.map((a: any, i: number) => (
                <div
                  key={i}
                  className={`alert-strip ${a.type === 'danger' ? 'error' : a.type === 'warning' ? 'warn' : 'info'}`}
                  onClick={() => router.push(a.link)}
                >
                  <span style={{ flex: 1 }}>{a.text}</span>
                  <ArrowRightOutlined style={{ fontSize: 10 }} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {admin ? (
        <>
          {/* Stat Cards Row 1 */}
          <Row gutter={[14, 14]} style={{ marginBottom: 22 }}>
            {STAT_CARDS.map((m, i) => (
              <Col xs={12} sm={12} md={6} key={m.k}>
                <GradientStatCard item={m} value={s[m.k] || 0} delay={i + 1} prevValue={data?.yesterday?.[m.k]} />
              </Col>
            ))}
          </Row>
          {/* Stat Cards Row 2 */}
          <Row gutter={[14, 14]} style={{ marginBottom: 22 }}>
            {STAT_CARDS_2.map((m, i) => (
              <Col xs={12} sm={12} md={6} key={m.k}>
                <GradientStatCard item={m} value={s[m.k] || 0} sub={m.k === 'today_active' ? `/ ${s.total_workers || 0}` : undefined} delay={i + 5} prevValue={data?.yesterday?.[m.k]} />
              </Col>
            ))}
          </Row>

          {/* AI Daily Brief */}
          <AIBriefPanel />

          {/* Production Efficiency + Todo Center */}
          <Row gutter={[14, 14]} style={{ marginBottom: 22 }}>
            {/* Production Efficiency Gauge */}
            <Col xs={24} md={8}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head">
                  <span className="panel-title"><DashboardOutlined style={{ color: '#722ed1' }} />出库效率</span>
                  <Tooltip title="打印→出库转化率">
                    <SafetyCertificateOutlined style={{ color: 'var(--text-4)', fontSize: 13, cursor: 'help' }} />
                  </Tooltip>
                </div>
                <div className="panel-body" style={{ padding: '0 16px 14px' }}>
                  <ProductionEfficiencyChart data={data?.production_efficiency} />
                  <Row gutter={8} style={{ marginTop: 4 }}>
                    {[
                      { label: '出库重量', value: `${Number(data?.production_efficiency?.outbound_weight || 0).toLocaleString()} kg`, color: '#1677ff' },
                      { label: '平均单件', value: `${data?.production_efficiency?.avg_weight || 0} kg`, color: '#722ed1' },
                    ].map(item => (
                      <Col span={12} key={item.label}>
                        <div style={{ textAlign: 'center', padding: '8px 6px', borderRadius: 10, background: `${item.color}08`, border: `1px solid ${item.color}10` }}>
                          <div style={{ fontSize: 10, color: 'var(--text-4)' }}>{item.label}</div>
                          <div className="num" style={{ fontSize: 15, fontWeight: 700, color: item.color }}>{item.value}</div>
                        </div>
                      </Col>
                    ))}
                  </Row>
                </div>
              </div>
            </Col>

            {/* Todo Center */}
            <Col xs={24} md={8}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head">
                  <span className="panel-title"><AlertOutlined style={{ color: '#ff4d4f' }} />待办事项</span>
                  {(data?.todo_items?.length || 0) > 0 && (
                    <Badge count={data?.todo_items?.reduce((a: number, t: any) => a + t.count, 0) || 0} overflowCount={99} style={{ backgroundColor: '#ff4d4f' }} />
                  )}
                </div>
                <div className="panel-body" style={{ padding: '4px 16px 16px' }}>
                  {!data?.todo_items?.length ? (
                    <div style={{ textAlign: 'center', padding: '30px 0' }}>
                      <CheckCircleOutlined style={{ fontSize: 36, color: '#52c41a', opacity: 0.5 }} />
                      <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 8 }}>暂无待办，一切良好</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {data?.todo_items?.map((item: any, i: number) => (
                        <div
                          key={item.key}
                          onClick={() => router.push(item.link)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            padding: '12px 14px', borderRadius: 12, cursor: 'pointer',
                            background: `linear-gradient(135deg, ${item.color}06 0%, ${item.color}02 100%)`,
                            border: `1px solid ${item.color}15`,
                            transition: 'all 0.3s',
                            animation: `stagger-in 0.4s cubic-bezier(0.22,1,0.36,1) both`,
                            animationDelay: `${i * 0.06}s`,
                          }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = item.color; e.currentTarget.style.transform = 'translateX(4px)'; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = `${item.color}15`; e.currentTarget.style.transform = ''; }}
                        >
                          <div style={{
                            width: 34, height: 34, borderRadius: 10,
                            background: `${item.color}12`, color: item.color,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 15, flexShrink: 0,
                          }}>
                            {TODO_ICONS[item.icon] || <WarningOutlined />}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{item.label}</div>
                          </div>
                          <div style={{
                            minWidth: 28, height: 28, borderRadius: 8, display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            background: item.color, color: '#fff',
                            fontSize: 13, fontWeight: 700, padding: '0 8px',
                          }}>
                            {item.count}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Col>

            {/* Today Production */}
            <Col xs={24} md={8}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head">
                  <span className="panel-title"><ExperimentOutlined style={{ color: '#722ed1' }} />今日生产</span>
                  <span className="panel-extra" onClick={() => router.push('/reports/sku-daily')}>详情 <ArrowRightOutlined style={{ fontSize: 9 }} /></span>
                </div>
                <div className="panel-body" style={{ padding: '4px 16px 14px' }}>
                  {data?.top_skus?.length ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {data.top_skus.slice(0, 6).map((sk: any, i: number) => {
                        const maxQty = Math.max(...(data.top_skus || []).map((s: any) => s.count), 1);
                        const colors = ['#722ed1', '#1677ff', '#00b96b', '#fa8c16', '#eb2f96', '#13c2c2'];
                        const c = colors[i % colors.length];
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{
                              width: 20, height: 20, borderRadius: 6, fontSize: 10, fontWeight: 700,
                              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                              background: i < 3 ? `linear-gradient(135deg, ${c}, ${c}88)` : 'rgba(0,0,0,0.04)',
                              color: i < 3 ? '#fff' : 'var(--text-3)',
                            }}>{i + 1}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sk.name}</div>
                              <div style={{ height: 4, borderRadius: 2, background: 'rgba(0,0,0,0.04)', overflow: 'hidden', marginTop: 2 }}>
                                <div style={{
                                  height: '100%', borderRadius: 2,
                                  width: `${(sk.count / maxQty) * 100}%`,
                                  background: `linear-gradient(90deg, ${c}, ${c}66)`,
                                  transition: 'width 0.6s',
                                }} />
                              </div>
                            </div>
                            <span style={{ fontSize: 11, fontWeight: 700, color: c, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{sk.count}</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="今日暂无生产数据" style={{ padding: '20px 0' }} />
                  )}
                </div>
              </div>
            </Col>
          </Row>

          {/* Finance + Loss Monitor */}
          <Row gutter={[14, 14]} style={{ marginBottom: 22 }}>
            <Col xs={24} lg={14}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head">
                  <span className="panel-title"><DollarOutlined style={{ color: '#faad14' }} />财务概览</span>
                  <span className="panel-extra" onClick={() => router.push('/reports/finance')}>查看报表 <ArrowRightOutlined style={{ fontSize: 9 }} /></span>
                </div>
                <div className="panel-body">
                  <Row gutter={[16, 16]} align="middle">
                    <Col xs={24} sm={10}>
                      <FinancePieChart finance={data?.finance} />
                    </Col>
                    <Col xs={24} sm={14}>
                      <Row gutter={[12, 12]}>
                        {[
                          { label: '水果未付', key: 'unpaid_fruit_cnt', color: '#5470c6' },
                          { label: '纸箱未付', key: 'unpaid_carton_cnt', color: '#fac858' },
                          { label: '材料未付', key: 'unpaid_material_cnt', color: '#9a60b4' },
                        ].map(f => (
                          <Col xs={8} key={f.key}>
                            <div style={{ textAlign: 'center', padding: '14px 8px', borderRadius: 12, background: `linear-gradient(135deg, ${f.color}08 0%, ${f.color}03 100%)`, border: `1px solid ${f.color}10` }}>
                              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{f.label}</div>
                              <div style={{ fontSize: 22, fontWeight: 700, color: f.color }} className="num">{((data?.finance as any)?.[f.key] || 0).toLocaleString()}</div>
                              <div style={{ fontSize: 10, color: 'var(--text-4)', marginTop: 2 }}>笔</div>
                            </div>
                          </Col>
                        ))}
                      </Row>
                      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed rgba(22,119,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <FireOutlined style={{ color: '#ff4d4f' }} />水果未付总额
                        </span>
                        <span style={{ fontSize: 22, fontWeight: 700, background: 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }} className="num">
                          ¥{Math.round(data?.finance?.unpaid_fruit_amt || 0).toLocaleString()}
                        </span>
                      </div>
                    </Col>
                  </Row>
                </div>
              </div>
            </Col>
            <Col xs={24} lg={10}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head">
                  <span className="panel-title"><WarningOutlined style={{ color: '#fa8c16' }} />损耗监控</span>
                  <span className="panel-extra" onClick={() => router.push('/reports/loss')}>详情 <ArrowRightOutlined style={{ fontSize: 9 }} /></span>
                </div>
                <div className="panel-body" style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                  <div style={{ position: 'relative', width: 90, height: 90 }}>
                    <Progress type="circle" size={90}
                      percent={s.today_printed ? Math.round((s.today_outbound || 0) / s.today_printed * 100) : 0}
                      strokeColor={{ '0%': '#fa8c16', '100%': '#ffc53d' }} strokeWidth={8}
                      format={pct => <span style={{ fontSize: 18, fontWeight: 700, background: 'linear-gradient(135deg, #fa8c16, #ffc53d)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{pct}%</span>}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, fontSize: 13 }}>
                      <span style={{ color: 'var(--text-3)' }}>出库 / 打印</span>
                      <span style={{ fontWeight: 700, color: 'var(--text-1)' }}>{s.today_outbound || 0} / {s.today_printed || 0}</span>
                    </div>
                    <Row gutter={12}>
                      {[
                        { label: '出库重量', value: `${Number(data?.production_efficiency?.outbound_weight || 0).toLocaleString()} kg`, color: '#13c2c2' },
                        { label: '重量差异', value: data?.production_efficiency?.weight_diff ? `${data.production_efficiency.weight_diff > 0 ? '+' : ''}${data.production_efficiency.weight_diff} kg` : '0 kg', color: data?.production_efficiency?.weight_diff > 0 ? '#ff4d4f' : '#00b96b' },
                      ].map(item => (
                        <Col span={12} key={item.label}>
                          <div style={{ padding: '10px', borderRadius: 10, background: `linear-gradient(135deg, ${item.color}08 0%, ${item.color}03 100%)`, textAlign: 'center' }}>
                            <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{item.label}</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: item.color }} className="num">{item.value}</div>
                          </div>
                        </Col>
                      ))}
                    </Row>
                  </div>
                </div>
              </div>
            </Col>
          </Row>

          {/* Trend Chart */}
          <div className="panel" style={{ marginBottom: 22 }}>
            <div className="panel-head">
              <span className="panel-title">
                <span style={{ width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, rgba(22,119,255,0.1) 0%, rgba(114,46,209,0.06) 100%)', color: 'var(--brand)', fontSize: 14 }}>
                  <BarChartOutlined />
                </span>
                运营趋势
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
                {data?.trends?.production?.[0]?.date} ~ {data?.trends?.production?.[data?.trends?.production?.length - 1]?.date}
              </span>
            </div>
            <div className="panel-body">
              <TrendChart trends={data?.trends} />
            </div>
          </div>

          {/* Rankings + Shortcuts */}
          <Row gutter={[14, 14]} style={{ marginBottom: 22 }}>
            <Col xs={24} md={8}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head">
                  <span className="panel-title"><TrophyOutlined style={{ color: '#faad14' }} />SKU 热度</span>
                  <FireOutlined style={{ color: '#ff4d4f', fontSize: 14 }} />
                </div>
                <div className="panel-body" style={{ padding: '0 22px 18px' }}>
                  {!(data?.top_skus?.length) ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" /> :
                    data?.top_skus?.map((sk: any, i: number) => (
                      <div key={i} className="rank-row">
                        <RankIdx n={i + 1} />
                        <span className="rank-name">{sk.name}</span>
                        <span className="rank-val" style={{ color: i === 0 ? '#faad14' : i === 1 ? '#8c8c8c' : i === 2 ? '#cd7f32' : 'var(--text-1)' }}>{sk.count.toLocaleString()}</span>
                      </div>
                    ))
                  }
                </div>
              </div>
            </Col>
            <Col xs={24} md={8}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head">
                  <span className="panel-title"><TeamOutlined style={{ color: '#1677ff' }} />工人产量</span>
                  <CrownOutlined style={{ color: '#faad14', fontSize: 14 }} />
                </div>
                <div className="panel-body" style={{ padding: '0 22px 18px' }}>
                  {!(data?.top_workers?.length) ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" /> :
                    data?.top_workers?.map((w: any, i: number) => (
                      <div key={i} className="rank-row">
                        <RankIdx n={i + 1} />
                        <span className="rank-name">{w.name}</span>
                        <span className="rank-val" style={{ color: i === 0 ? '#faad14' : i === 1 ? '#8c8c8c' : i === 2 ? '#cd7f32' : 'var(--text-1)' }}>{w.qty.toLocaleString()}</span>
                      </div>
                    ))
                  }
                </div>
              </div>
            </Col>
            <Col xs={24} md={8}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head">
                  <span className="panel-title"><ThunderboltOutlined style={{ color: '#fa8c16' }} />快捷入口</span>
                </div>
                <div className="panel-body" style={{ padding: '0 14px 14px' }}>
                  <Row gutter={[6, 6]}>
                    {ADMIN_SHORTCUTS.map((a, i) => (
                      <Col span={8} key={i}>
                        <div className="shortcut" onClick={() => router.push(a.path)}>
                          <div className="shortcut-icon" style={{ background: a.gradient, color: a.fg }}>{a.icon}</div>
                          <span className="shortcut-text">{a.label}</span>
                        </div>
                      </Col>
                    ))}
                  </Row>
                </div>
              </div>
            </Col>
          </Row>

          {/* Notices + Activity */}
          <Row gutter={[14, 14]}>
            <Col xs={24} md={12}>
              <div className="panel">
                <div className="panel-head">
                  <span className="panel-title"><BellOutlined style={{ color: '#eb2f96' }} />系统公告</span>
                  <span className="panel-extra" onClick={() => router.push('/system/notices')}>管理 <ArrowRightOutlined style={{ fontSize: 9 }} /></span>
                </div>
                <div className="panel-body" style={{ minHeight: 100 }}>
                  {!(data?.notices?.length) ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无公告" style={{ padding: 16 }} /> :
                    data?.notices?.map((n: any) => (
                      <div key={n.id} style={{ padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: n.type === 'urgent' ? 'linear-gradient(135deg, #ff4d4f, #ff7875)' : 'linear-gradient(135deg, #1677ff, #69b1ff)', flexShrink: 0, boxShadow: n.type === 'urgent' ? '0 0 0 3px rgba(255,77,79,0.15)' : '0 0 0 3px rgba(22,119,255,0.12)' }} />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-1)' }}>{n.content}</span>
                      </div>
                    ))
                  }
                </div>
              </div>
            </Col>
            <Col xs={24} md={12}>
              <div className="panel">
                <div className="panel-head">
                  <span className="panel-title"><ClockCircleOutlined style={{ color: '#13c2c2' }} />最近动态</span>
                  <span className="panel-extra" onClick={() => router.push('/system/logs')}>全部 <ArrowRightOutlined style={{ fontSize: 9 }} /></span>
                </div>
                <div className="panel-body" style={{ minHeight: 100 }}>
                  {!(data?.activity?.length) ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无动态" style={{ padding: 16 }} /> :
                    data?.activity?.map((a: any) => (
                      <div key={a.id} className="tl-item">
                        <div className="tl-dot" />
                        <div className="tl-content">
                          <span className="tl-user">{a.username}</span>{' '}
                          <span className="tl-action">{a.action}</span>
                          <div className="tl-time">{a.ts ? dayjs(a.ts).fromNow() : ''}</div>
                        </div>
                      </div>
                    ))
                  }
                </div>
              </div>
            </Col>
          </Row>
        </>
      ) : (
        <WorkerDashboard stats={s} router={router} />
      )}
    </div>
  );
}


function WorkerAIBriefPanel() {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(false);

  const fetchBrief = useCallback(async () => {
    setLoading(true); setContent('');
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ message: '请根据"当前实时业务数据"中的数据，简要总结当前工人的工作情况。如果数据中没有该工人的个人数据，请直接说明"暂无您的个人数据"，不要编造。限制100字以内。', history: [], stream: true, context_mode: 'auto' }),
      });
      const reader = response.body?.getReader();
      if (!reader) return;
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
        setContent(acc);
      }
    } catch { setContent('AI 简报暂不可用'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!fetchedRef.current) { fetchedRef.current = true; fetchBrief(); }
  }, [fetchBrief]);

  return (
    <div className="panel" style={{ marginBottom: 18 }}>
      <div className="panel-head">
        <span className="panel-title"><RobotOutlined style={{ color: '#667eea' }} />AI 工作简报</span>
        <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: 'rgba(102,126,234,0.08)', color: '#667eea', fontWeight: 600 }}>Qwen AI</span>
      </div>
      <div className="panel-body" style={{ padding: '10px 20px 14px' }}>
        {loading && !content ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
            <Spin size="small" /><Text type="secondary" style={{ fontSize: 13 }}>正在生成简报...</Text>
          </div>
        ) : content ? (
          <div style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--text-2)' }}>
            {content.split(/(\*\*.*?\*\*|\n)/g).map((p, i) => {
              if (p === '\n') return <br key={i} />;
              if (p.startsWith('**') && p.endsWith('**')) return <strong key={i} style={{ color: '#667eea' }}>{p.slice(2, -2)}</strong>;
              return <span key={i}>{p}</span>;
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WorkerTaskGuide({ router }: { router: any }) {
  const [tasks, setTasks] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await api.get('/workers/my-tasks');
        setTasks(r.data?.data);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    };
    load();
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, []);

  if (loading || !tasks) return null;

  const TASK_ICONS: Record<string, React.ReactNode> = {
    batch: <CalendarOutlined />, request: <AppstoreOutlined />, print: <PrinterOutlined />,
    input: <ExperimentOutlined />, audit: <SafetyCertificateOutlined />, message: <BellOutlined />,
  };
  const STATUS_STYLES: Record<string, { color: string; bg: string; label: string }> = {
    completed: { color: '#52c41a', bg: 'rgba(82,196,26,0.08)', label: '✓' },
    warning: { color: '#faad14', bg: 'rgba(250,173,20,0.08)', label: '!' },
    error: { color: '#ff4d4f', bg: 'rgba(255,77,79,0.08)', label: '✕' },
    todo: { color: '#1677ff', bg: 'rgba(22,119,255,0.08)', label: '→' },
    waiting: { color: '#8c8c8c', bg: 'rgba(0,0,0,0.04)', label: '·' },
    empty: { color: '#8c8c8c', bg: 'rgba(0,0,0,0.04)', label: '·' },
  };

  return (
    <div className="panel" style={{ marginBottom: 18, overflow: 'hidden' }}>
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid var(--border-2)',
        background: 'linear-gradient(135deg, rgba(22,119,255,0.04), rgba(0,185,107,0.03))',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg, #1677ff, #00b96b)', color: '#fff', fontSize: 15,
          }}><RocketOutlined /></span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>今日工作流</div>
            <div style={{ fontSize: 11, color: 'var(--text-4)' }}>
              完成 {tasks.summary.completed}/{tasks.summary.total_tasks} · 进度 {tasks.summary.progress}%
            </div>
          </div>
        </div>
        <Progress type="circle" percent={tasks.summary.progress} size={36}
          strokeColor={{ '0%': '#1677ff', '100%': '#00b96b' }} strokeWidth={8} />
      </div>
      <div style={{ padding: '10px 16px' }}>
        {tasks.tasks.map((t: any, i: number) => {
          const ss = STATUS_STYLES[t.status] || STATUS_STYLES.waiting;
          return (
            <div key={t.key} onClick={() => t.link && router.push(t.link)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px',
                marginBottom: i < tasks.tasks.length - 1 ? 4 : 0,
                borderRadius: 10, cursor: t.link ? 'pointer' : 'default',
                background: ss.bg, transition: 'all 0.2s',
                border: `1px solid transparent`,
              }}
              onMouseEnter={e => { if (t.link) { e.currentTarget.style.borderColor = ss.color + '30'; e.currentTarget.style.transform = 'translateX(4px)'; } }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.transform = ''; }}
            >
              <div style={{
                width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: `${ss.color}15`, color: ss.color, fontSize: 14, flexShrink: 0,
              }}>
                {TASK_ICONS[t.icon] || <ClockCircleOutlined />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: t.status === 'completed' ? 'var(--text-2)' : 'var(--text-1)' }}>{t.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text-4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.description}</div>
              </div>
              <div style={{
                width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: ss.color, color: '#fff', fontSize: 11, fontWeight: 700, flexShrink: 0,
              }}>{ss.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorkerDashboard({ stats: _s, router }: { stats: any; router: any }) {
  const { isMobile } = useDevice();
  const [wd, setWd] = useState<any>(null);
  const [wdLoading, setWdLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      setWdLoading(true);
      try {
        const r = await api.get('/dashboard/worker-dashboard');
        setWd(r.data?.data);
      } catch { /* ignore */ }
      finally { setWdLoading(false); }
    };
    fetch();
    const id = setInterval(fetch, 30000);
    return () => clearInterval(id);
  }, []);

  const s = wd || _s || {};
  const FRUIT_ICONS: Record<string, string> = { '苹果': '🍎', '梨': '🍐', '橙': '🍊', '桃': '🍑', '葡萄': '🍇', '芒果': '🥭', '草莓': '🍓', '香蕉': '🍌', '西瓜': '🍉', '樱桃': '🍒' };
  const getFruit = (n: string) => { for (const [k, v] of Object.entries(FRUIT_ICONS)) { if (n.includes(k)) return v; } return '🍎'; };

  const WORKER_STAT_CARDS = [
    { k: 'today_printed', l: '今日标签', icon: <PrinterOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.18)' },
    { k: 'today_outbound', l: '今日出库', icon: <ExportOutlined />, gradient: 'linear-gradient(135deg, #52c41a 0%, #95de64 100%)', glow: 'rgba(82,196,26,0.18)' },
    { k: 'month_qty', l: '本月产量', icon: <TrophyOutlined />, gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.18)' },
    { k: 'month_commission', l: '月佣金', icon: <DollarOutlined />, gradient: 'linear-gradient(135deg, #eb2f96 0%, #f759ab 100%)', glow: 'rgba(235,47,150,0.18)' },
  ];

  if (isMobile) {
    return (
      <div className="wm-dashboard">
        {/* 顶部统计卡片 - 2x2 网格 */}
        <div className="wm-stats-grid">
          {WORKER_STAT_CARDS.map((m, i) => (
            <div key={m.k} className="wm-stat-card" style={{ background: m.gradient, animationDelay: `${i * 0.08}s` }}>
              <div className="wm-stat-icon">{m.icon}</div>
              <div className="wm-stat-value">{(s[m.k] || 0).toLocaleString()}</div>
              <div className="wm-stat-label">{m.l}</div>
            </div>
          ))}
        </div>

        {/* 佣金卡片 */}
        <div className="wm-commission-card">
          <div className="wm-commission-bg" />
          <div className="wm-commission-inner">
            <div className="wm-commission-icon"><DollarOutlined /></div>
            <div className="wm-commission-info">
              <div className="wm-commission-label">本月预估佣金</div>
              <div className="wm-commission-amount">¥{(s.month_commission || 0).toLocaleString()}</div>
            </div>
            {s.last_month_commission !== undefined && s.last_month_commission !== null && (
              <div className="wm-commission-change">
                <span className="wm-commission-arrow">
                  {(s.month_commission || 0) >= (s.last_month_commission || 0) ? '↑' : '↓'}
                  {s.last_month_commission > 0 ? Math.abs(Math.round(((s.month_commission || 0) - s.last_month_commission) / s.last_month_commission * 100)) : 0}%
                </span>
                <span className="wm-commission-vs">较上月</span>
              </div>
            )}
          </div>
        </div>

        {/* 审核状态 */}
        <div className="wm-audit-row">
          <div className="wm-audit-item">
            <div className="wm-audit-num" style={{ color: s.pending_audit > 0 ? '#fa8c16' : 'var(--text-2)' }}>{s.pending_audit || 0}</div>
            <div className="wm-audit-label">待审核</div>
          </div>
          <div className="wm-audit-divider" />
          <div className="wm-audit-item">
            <div className="wm-audit-num" style={{ color: s.pending_edits > 0 ? '#722ed1' : 'var(--text-2)' }}>{s.pending_edits || 0}</div>
            <div className="wm-audit-label">修改待审</div>
          </div>
          <div className="wm-audit-divider" />
          <div className="wm-audit-item">
            <div className="wm-audit-num" style={{ color: s.rejected_count > 0 ? '#ff4d4f' : 'var(--text-2)' }}>{s.rejected_count || 0}</div>
            <div className="wm-audit-label">被驳回</div>
          </div>
        </div>

        {/* 今日分配批次 */}
        {s.today_batches?.length > 0 && (
          <div className="wm-section">
            <div className="wm-section-head">
              <span className="wm-section-title">今日分配批次</span>
              <span className="wm-section-more" onClick={() => router.push('/production/request')}>去申请 →</span>
            </div>
            <div className="wm-batch-list">
              {s.today_batches.map((b: any) => (
                <div key={b.purchase_id} className="wm-batch-item" onClick={() => router.push('/production/request')}>
                  <span className="wm-batch-fruit">{getFruit(b.fruit_name)}</span>
                  <div className="wm-batch-info">
                    <div className="wm-batch-name">{b.fruit_name}</div>
                    <div className="wm-batch-detail">{b.supplier_name} · {b.purchase_weight}kg</div>
                  </div>
                  <span className="wm-batch-id">#{b.purchase_id}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 今日申请 */}
        <div className="wm-section">
          <div className="wm-section-head">
            <span className="wm-section-title">今日申请</span>
          </div>
          {s.today_transactions?.length > 0 ? (
            <div className="wm-trans-list">
              {s.today_transactions.map((t: any, i: number) => (
                <div key={i} className="wm-trans-item" style={{
                  borderColor: t.is_printed ? 'rgba(82,196,26,0.15)' : 'rgba(250,140,22,0.15)',
                  background: t.is_printed ? 'rgba(82,196,26,0.03)' : 'rgba(250,140,22,0.03)',
                }}>
                  <div className="wm-trans-info">
                    <div className="wm-trans-name">{t.sku_name}</div>
                    <div className="wm-trans-qty">数量: {t.quantity}</div>
                  </div>
                  <span className="wm-trans-status" style={{
                    background: t.is_printed ? 'rgba(82,196,26,0.12)' : 'rgba(250,140,22,0.12)',
                    color: t.is_printed ? '#52c41a' : '#fa8c16',
                  }}>
                    {t.is_printed ? '已打印' : '待打印'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="wm-empty">今日暂无申请</div>
          )}
        </div>

        {/* 快捷操作 */}
        <div className="wm-section">
          <div className="wm-section-head">
            <span className="wm-section-title">快捷操作</span>
          </div>
          <div className="wm-shortcuts-grid">
            {WORKER_SHORTCUTS.map((a, i) => (
              <div key={i} className="wm-shortcut" onClick={() => router.push(a.path)}>
                <div className="wm-shortcut-icon" style={{ background: a.gradient, color: a.fg }}>
                  {a.icon}
                </div>
                <span className="wm-shortcut-label">{a.label}</span>
              </div>
            ))}
          </div>
        </div>

        <style jsx global>{`
          .wm-dashboard {
            padding: 16px;
            padding-bottom: 20px;
          }

          .wm-stats-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            margin-bottom: 14px;
          }

          .wm-stat-card {
            border-radius: 16px;
            padding: 16px 14px;
            position: relative;
            overflow: hidden;
            animation: wmFadeUp 0.4s ease-out both;
          }

          .wm-stat-card::after {
            content: '';
            position: absolute;
            top: -15px;
            right: -15px;
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background: rgba(255,255,255,0.12);
          }

          .wm-stat-icon {
            font-size: 18px;
            color: rgba(255,255,255,0.85);
            margin-bottom: 8px;
          }

          .wm-stat-value {
            font-size: 26px;
            font-weight: 800;
            color: #fff;
            line-height: 1.1;
            font-variant-numeric: tabular-nums;
          }

          .wm-stat-label {
            font-size: 12px;
            color: rgba(255,255,255,0.75);
            margin-top: 4px;
          }

          .wm-commission-card {
            border-radius: 18px;
            overflow: hidden;
            position: relative;
            margin-bottom: 14px;
            background: linear-gradient(135deg, #eb2f96 0%, #722ed1 100%);
            animation: wmFadeUp 0.4s ease-out 0.3s both;
          }

          .wm-commission-bg {
            position: absolute;
            top: -20px;
            right: -20px;
            width: 100px;
            height: 100px;
            border-radius: 50%;
            background: rgba(255,255,255,0.1);
          }

          .wm-commission-inner {
            padding: 18px 20px;
            display: flex;
            align-items: center;
            gap: 14px;
            position: relative;
          }

          .wm-commission-icon {
            width: 46px;
            height: 46px;
            border-radius: 14px;
            background: rgba(255,255,255,0.2);
            backdrop-filter: blur(8px);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
            color: #fff;
            flex-shrink: 0;
          }

          .wm-commission-info { flex: 1; }

          .wm-commission-label {
            font-size: 12px;
            color: rgba(255,255,255,0.7);
            margin-bottom: 2px;
          }

          .wm-commission-amount {
            font-size: 28px;
            font-weight: 800;
            color: #fff;
            line-height: 1.2;
            font-variant-numeric: tabular-nums;
          }

          .wm-commission-change {
            text-align: right;
          }

          .wm-commission-arrow {
            display: block;
            font-size: 14px;
            font-weight: 700;
            color: #fff;
          }

          .wm-commission-vs {
            font-size: 10px;
            color: rgba(255,255,255,0.6);
          }

          .wm-audit-row {
            display: flex;
            align-items: center;
            background: var(--bg-card, #fff);
            border-radius: 16px;
            padding: 16px 0;
            margin-bottom: 14px;
            border: 1px solid var(--border-1, rgba(0,0,0,0.06));
            animation: wmFadeUp 0.4s ease-out 0.35s both;
          }

          .wm-audit-item {
            flex: 1;
            text-align: center;
          }

          .wm-audit-num {
            font-size: 24px;
            font-weight: 700;
            line-height: 1.2;
          }

          .wm-audit-label {
            font-size: 11px;
            color: var(--text-4);
            margin-top: 4px;
          }

          .wm-audit-divider {
            width: 1px;
            height: 32px;
            background: var(--border-1, rgba(0,0,0,0.06));
          }

          .wm-section {
            background: var(--bg-card, #fff);
            border-radius: 16px;
            border: 1px solid var(--border-1, rgba(0,0,0,0.06));
            margin-bottom: 14px;
            overflow: hidden;
          }

          .wm-section-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 14px 16px 10px;
          }

          .wm-section-title {
            font-size: 15px;
            font-weight: 700;
            color: var(--text-1);
          }

          .wm-section-more {
            font-size: 12px;
            color: var(--brand);
            font-weight: 500;
            cursor: pointer;
          }

          .wm-batch-list {
            padding: 0 12px 12px;
          }

          .wm-batch-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 14px;
            border-radius: 12px;
            border: 1px solid rgba(22,119,255,0.1);
            background: rgba(22,119,255,0.02);
            margin-bottom: 8px;
            cursor: pointer;
            -webkit-tap-highlight-color: transparent;
            transition: all 0.2s;
          }

          .wm-batch-item:active {
            transform: scale(0.98);
            background: rgba(22,119,255,0.05);
          }

          .wm-batch-fruit { font-size: 28px; }

          .wm-batch-info { flex: 1; min-width: 0; }

          .wm-batch-name {
            font-weight: 600;
            font-size: 14px;
            color: var(--text-1);
          }

          .wm-batch-detail {
            font-size: 12px;
            color: var(--text-3);
            margin-top: 2px;
          }

          .wm-batch-id {
            padding: 3px 10px;
            border-radius: 8px;
            background: linear-gradient(135deg, #1677ff, #4096ff);
            color: #fff;
            font-size: 11px;
            font-weight: 600;
            flex-shrink: 0;
          }

          .wm-trans-list { padding: 0 12px 12px; }

          .wm-trans-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 14px;
            border-radius: 12px;
            border: 1px solid;
            margin-bottom: 8px;
          }

          .wm-trans-info { flex: 1; }

          .wm-trans-name {
            font-weight: 600;
            font-size: 14px;
            color: var(--text-1);
          }

          .wm-trans-qty {
            font-size: 12px;
            color: var(--text-3);
            margin-top: 2px;
          }

          .wm-trans-status {
            padding: 3px 10px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 600;
            flex-shrink: 0;
          }

          .wm-empty {
            padding: 24px;
            text-align: center;
            color: var(--text-4);
            font-size: 13px;
          }

          .wm-shortcuts-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
            padding: 0 12px 16px;
          }

          .wm-shortcut {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            padding: 14px 8px;
            border-radius: 12px;
            cursor: pointer;
            -webkit-tap-highlight-color: transparent;
            transition: all 0.2s;
          }

          .wm-shortcut:active {
            transform: scale(0.92);
          }

          .wm-shortcut-icon {
            width: 46px;
            height: 46px;
            border-radius: 14px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
          }

          .wm-shortcut-label {
            font-size: 12px;
            color: var(--text-2);
            font-weight: 500;
          }

          @keyframes wmFadeUp {
            from { opacity: 0; transform: translateY(12px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <>
      {/* Stat Cards */}
      <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
        {WORKER_STAT_CARDS.map((m, i) => (
          <Col xs={12} sm={6} key={m.k}>
            <GradientStatCard item={m} value={s[m.k] || 0} delay={i + 1} />
          </Col>
        ))}
      </Row>

      {/* Task Guide */}
      <WorkerTaskGuide router={router} />

      {/* Worker AI Brief */}
      <WorkerAIBriefPanel />

      {/* Commission + Alerts */}
      <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
        <Col xs={24} sm={12}>
          <div className="panel" style={{ height: '100%', overflow: 'hidden' }}>
            <div style={{
              background: 'linear-gradient(135deg, #eb2f96 0%, #722ed1 100%)',
              padding: '18px 22px', position: 'relative',
            }}>
              <div style={{ position: 'absolute', top: -20, right: -20, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 14,
                  background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 22, color: '#fff',
                }}>
                  <DollarOutlined />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', marginBottom: 2 }}>本月预估佣金</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: '#fff', lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>
                    ¥{(s.month_commission || 0).toLocaleString()}
                  </div>
                </div>
                {s.last_month_commission !== undefined && s.last_month_commission !== null && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)' }}>较上月</div>
                    <div style={{
                      fontSize: 13, fontWeight: 700, color: '#fff',
                      display: 'flex', alignItems: 'center', gap: 2,
                    }}>
                      {(s.month_commission || 0) >= (s.last_month_commission || 0) ? '↑' : '↓'}
                      {s.last_month_commission > 0 ? Math.abs(Math.round(((s.month_commission || 0) - s.last_month_commission) / s.last_month_commission * 100)) : 0}%
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Col>
        <Col xs={24} sm={12}>
          <div className="panel" style={{ height: '100%' }}>
            <div className="panel-body" style={{ padding: '18px 22px' }}>
              <Row gutter={12}>
                <Col span={8} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 4 }}>待审核</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: s.pending_audit > 0 ? '#fa8c16' : 'var(--text-1)' }}>{s.pending_audit || 0}</div>
                </Col>
                <Col span={8} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 4 }}>修改待审</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: s.pending_edits > 0 ? '#722ed1' : 'var(--text-1)' }}>{s.pending_edits || 0}</div>
                </Col>
                <Col span={8} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 4 }}>被驳回</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: s.rejected_count > 0 ? '#ff4d4f' : 'var(--text-1)' }}>{s.rejected_count || 0}</div>
                </Col>
              </Row>
            </div>
          </div>
        </Col>
      </Row>

      {/* Today batches */}
      {s.today_batches?.length > 0 && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-head">
            <span className="panel-title"><ShoppingCartOutlined style={{ color: '#1677ff' }} />今日分配批次</span>
            <span className="panel-extra" onClick={() => router.push('/production/request')}>去申请 <ArrowRightOutlined style={{ fontSize: 9 }} /></span>
          </div>
          <div className="panel-body" style={{ padding: '4px 14px 14px' }}>
            <Row gutter={[10, 10]}>
              {s.today_batches.map((b: any, i: number) => (
                <Col xs={24} sm={12} key={b.purchase_id}>
                  <div style={{
                    padding: '14px 16px', borderRadius: 12,
                    border: '1px solid rgba(22,119,255,0.1)', background: 'rgba(22,119,255,0.02)',
                    display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                    transition: 'all 0.3s',
                  }}
                    onClick={() => router.push('/production/request')}
                    onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.borderColor = 'var(--brand)'; e.currentTarget.style.transform = 'translateX(3px)'; }}
                    onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.borderColor = 'rgba(22,119,255,0.1)'; e.currentTarget.style.transform = ''; }}
                  >
                    <span style={{ fontSize: 26 }}>{getFruit(b.fruit_name)}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-1)' }}>{b.fruit_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{b.supplier_name} · {b.purchase_weight}kg</div>
                    </div>
                    <span style={{
                      padding: '3px 10px', borderRadius: 8,
                      background: 'linear-gradient(135deg, #1677ff, #4096ff)',
                      color: '#fff', fontSize: 11, fontWeight: 600,
                    }}>#{b.purchase_id}</span>
                  </div>
                </Col>
              ))}
            </Row>
          </div>
        </div>
      )}

      {/* Today transactions + trend */}
      <Row gutter={[14, 14]} style={{ marginBottom: 18 }}>
        <Col xs={24} md={14}>
          <div className="panel" style={{ height: '100%' }}>
            <div className="panel-head">
              <span className="panel-title"><RiseOutlined style={{ color: '#00b96b' }} />7日产量趋势</span>
            </div>
            <div className="panel-body">
              {s.trend?.length > 0 ? (
                <ReactECharts
                  option={{
                    tooltip: { trigger: 'axis', backgroundColor: 'rgba(255,255,255,0.96)', borderColor: 'rgba(0,0,0,0.08)', borderWidth: 1, textStyle: { color: '#333', fontSize: 12 } },
                    grid: { top: 10, right: 10, bottom: 25, left: 35 },
                    xAxis: { type: 'category', data: s.trend.map((t: any) => t.date), axisLine: { lineStyle: { color: '#e8e8e8' } }, axisTick: { show: false }, axisLabel: { color: '#8a919f', fontSize: 10 } },
                    yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: '#f5f5f5', type: 'dashed' } }, axisLabel: { color: '#8a919f', fontSize: 10 } },
                    series: [{
                      type: 'bar', data: s.trend.map((t: any) => t.qty),
                      itemStyle: { borderRadius: [6, 6, 0, 0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#1677ff' }, { offset: 1, color: '#69b1ff' }] } },
                      barWidth: '45%',
                    }],
                  }}
                  style={{ height: 180 }}
                />
              ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />}
            </div>
          </div>
        </Col>
        <Col xs={24} md={10}>
          <div className="panel" style={{ height: '100%' }}>
            <div className="panel-head">
              <span className="panel-title"><FileDoneOutlined style={{ color: '#722ed1' }} />今日申请</span>
            </div>
            <div className="panel-body" style={{ padding: '4px 16px 16px' }}>
              {s.today_transactions?.length > 0 ? s.today_transactions.map((t: any, i: number) => (
                <div key={i} style={{
                  padding: '10px 14px', borderRadius: 10, marginBottom: 6,
                  background: t.is_printed ? 'rgba(82,196,26,0.04)' : 'rgba(250,140,22,0.04)',
                  border: `1px solid ${t.is_printed ? 'rgba(82,196,26,0.12)' : 'rgba(250,140,22,0.12)'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{t.sku_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>数量: {t.quantity}</div>
                  </div>
                  <span style={{
                    padding: '2px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                    background: t.is_printed ? 'rgba(82,196,26,0.12)' : 'rgba(250,140,22,0.12)',
                    color: t.is_printed ? '#52c41a' : '#fa8c16',
                  }}>
                    {t.is_printed ? '已打印' : '待打印'}
                  </span>
                </div>
              )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="今日暂无申请" style={{ padding: '16px 0' }} />}
            </div>
          </div>
        </Col>
      </Row>

      {/* Shortcuts */}
      <div className="panel">
        <div className="panel-head"><span className="panel-title"><ThunderboltOutlined style={{ color: '#fa8c16' }} />常用操作</span></div>
        <div className="panel-body" style={{ padding: '4px 14px 14px' }}>
          <Row gutter={[8, 8]}>
            {WORKER_SHORTCUTS.map((a, i) => (
              <Col xs={8} sm={4} key={i}>
                <div className="shortcut" onClick={() => router.push(a.path)}>
                  <div className="shortcut-icon" style={{ background: a.gradient, color: a.fg, width: 44, height: 44, fontSize: 20 }}>{a.icon}</div>
                  <span className="shortcut-text" style={{ fontSize: 12 }}>{a.label}</span>
                </div>
              </Col>
            ))}
          </Row>
        </div>
      </div>
    </>
  );
}
