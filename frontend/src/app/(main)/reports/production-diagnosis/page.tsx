'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Button, Tag, Row, Col, Segmented, Space, Spin, message, Avatar,
  Table, Tooltip, Progress, Modal, Empty,
} from 'antd';
import {
  DashboardOutlined, ReloadOutlined, RobotOutlined,
  ShoppingCartOutlined, TeamOutlined, FormOutlined,
  PrinterOutlined, AuditOutlined, ScanOutlined,
  WarningOutlined, CheckCircleOutlined, ClockCircleOutlined,
  ExclamationCircleOutlined, ArrowRightOutlined,
  TrophyOutlined, BarChartOutlined, ThunderboltOutlined,
  FireOutlined, RiseOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dayjs from 'dayjs';

interface PipelineStage {
  stage: string; icon: string; value: number; detail: string; status: string;
}
interface AlertItem { type: string; message: string }
interface DailyTrend { date: string; printed: number; outbound: number }
interface WorkerRank { worker_id: number; worker_name: string; printed: number; outbound: number; outbound_rate: number }
interface SkuRank { sku_name: string; printed: number; outbound: number; outbound_rate: number }
interface DiagnosisData {
  days: number; date_range: { start: string; end: string };
  health_score: number; pipeline: PipelineStage[]; alerts: AlertItem[];
  daily_trend: DailyTrend[]; worker_ranking: WorkerRank[]; sku_ranking: SkuRank[];
  summary: {
    total_purchases: number; total_weight: number; total_labels: number;
    total_outbound: number; outbound_rate: number; audit_pass_rate: number;
    failures: number; weight_anomalies: number;
  };
}

const STAGE_ICONS: Record<string, React.ReactNode> = {
  shopping: <ShoppingCartOutlined />, team: <TeamOutlined />, form: <FormOutlined />,
  printer: <PrinterOutlined />, audit: <AuditOutlined />, scan: <ScanOutlined />,
};

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  healthy: { bg: 'rgba(82,196,26,0.08)', border: 'rgba(82,196,26,0.2)', text: '#52c41a' },
  warning: { bg: 'rgba(250,173,20,0.08)', border: 'rgba(250,173,20,0.2)', text: '#faad14' },
  error: { bg: 'rgba(255,77,79,0.08)', border: 'rgba(255,77,79,0.2)', text: '#ff4d4f' },
  idle: { bg: 'rgba(0,0,0,0.02)', border: 'rgba(0,0,0,0.06)', text: '#bfbfbf' },
};

function HealthGauge({ score }: { score: number }) {
  const color = score >= 80 ? '#52c41a' : score >= 60 ? '#faad14' : '#ff4d4f';
  const label = score >= 80 ? '健康' : score >= 60 ? '一般' : '需关注';
  return (
    <div style={{ textAlign: 'center' }}>
      <Progress
        type="dashboard"
        percent={score}
        strokeColor={color}
        trailColor="rgba(0,0,0,0.04)"
        format={() => (
          <div>
            <div style={{ fontSize: 32, fontWeight: 800, color, lineHeight: 1.2 }}>{score}</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{label}</div>
          </div>
        )}
        size={160}
        strokeWidth={10}
      />
    </div>
  );
}

function MiniBarChart({ data }: { data: DailyTrend[] }) {
  if (!data.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无趋势" />;
  const maxVal = Math.max(...data.map(d => Math.max(d.printed, d.outbound)), 1);
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 120, padding: '0 4px' }}>
      {data.map((d, i) => (
        <Tooltip key={i} title={`${d.date}: 打印${d.printed} 出库${d.outbound}`}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <div style={{ width: '100%', display: 'flex', gap: 1, alignItems: 'flex-end', height: 90 }}>
              <div style={{
                flex: 1, borderRadius: '3px 3px 0 0', transition: 'height 0.6s ease',
                background: 'linear-gradient(180deg, #4facfe, #00f2fe)',
                height: `${(d.printed / maxVal) * 100}%`, minHeight: 2,
              }} />
              <div style={{
                flex: 1, borderRadius: '3px 3px 0 0', transition: 'height 0.6s ease',
                background: 'linear-gradient(180deg, #43e97b, #38f9d7)',
                height: `${(d.outbound / maxVal) * 100}%`, minHeight: 2,
              }} />
            </div>
            <span style={{ fontSize: 9, color: 'var(--text-4)', whiteSpace: 'nowrap' }}>{dayjs(d.date).format('MM/DD')}</span>
          </div>
        </Tooltip>
      ))}
    </div>
  );
}

export default function ProductionDiagnosisPage() {
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DiagnosisData | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/reports/production-diagnosis', { params: { days } });
      setData(res.data?.data || null);
    } catch { message.error('获取诊断数据失败'); }
    finally { setLoading(false); }
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const openAiDiagnosis = async () => {
    setAiContent('');
    setAiModalOpen(true);
    setAiLoading(true);
    try {
      abortRef.current = new AbortController();
      const response = await fetch(`/api/reports/production-diagnosis-ai?days=${days}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        signal: abortRef.current.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body?.getReader();
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
            const parsed = JSON.parse(d);
            if (parsed.error) acc += `\n⚠️ ${parsed.error}`;
            else if (parsed.content) acc += parsed.content;
          } catch {}
        }
        setAiContent(acc);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') setAiContent('AI诊断暂时不可用');
    } finally { setAiLoading(false); abortRef.current = null; }
  };

  const formatContent = (content: string) => {
    return content.split(/(\*\*.*?\*\*|`[^`]+`|\n)/g).map((part, i) => {
      if (part === '\n') return <br key={i} />;
      if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('`') && part.endsWith('`'))
        return <code key={i} style={{ background: 'rgba(22,119,255,0.08)', padding: '1px 6px', borderRadius: 4, fontSize: 13, color: 'var(--brand)' }}>{part.slice(1, -1)}</code>;
      return <span key={i}>{part}</span>;
    });
  };

  const s = data?.summary;

  return (
    <div style={{ maxWidth: 1300, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -30, right: -20, width: 160, height: 160, borderRadius: '50%', background: 'rgba(79,172,254,0.1)' }} />
        <div style={{ position: 'absolute', bottom: -20, left: '30%', width: 100, height: 100, borderRadius: '50%', background: 'rgba(67,233,123,0.08)' }} />
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{
              width: 48, height: 48, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(79,172,254,0.2)', backdropFilter: 'blur(10px)', fontSize: 24,
            }}><ThunderboltOutlined /></span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>生产效率诊断中心</div>
              <div style={{ fontSize: 13, opacity: 0.75, marginTop: 2 }}>
                {data ? `${data.date_range.start} ~ ${data.date_range.end}` : '全链路效率分析 · AI智能诊断'}
              </div>
            </div>
          </div>
          <Space>
            <Segmented value={days} onChange={v => setDays(v as number)}
              options={[{ value: 3, label: '3天' }, { value: 7, label: '7天' }, { value: 14, label: '14天' }, { value: 30, label: '30天' }]}
              style={{ borderRadius: 10, background: 'rgba(255,255,255,0.1)' }}
            />
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh}
              style={{ borderRadius: 10, background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff' }} />
            <Button icon={<RobotOutlined />} onClick={openAiDiagnosis}
              style={{ borderRadius: 10, background: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none', color: '#fff', fontWeight: 600 }}>
              AI诊断
            </Button>
          </Space>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>
      ) : !data ? (
        <div className="panel" style={{ padding: 60, textAlign: 'center' }}><Empty /></div>
      ) : (
        <>
          {/* Health Score + Alerts */}
          <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
            <Col xs={24} md={8}>
              <div className="panel" style={{ padding: '24px 20px', textAlign: 'center', height: '100%' }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <DashboardOutlined style={{ color: '#4facfe' }} /> 生产线健康度
                </div>
                <HealthGauge score={data.health_score} />
              </div>
            </Col>
            <Col xs={24} md={16}>
              <div className="panel" style={{ padding: '20px', height: '100%' }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <BarChartOutlined style={{ color: '#43e97b' }} /> 每日产出趋势
                  <span style={{ fontSize: 11, color: 'var(--text-4)', fontWeight: 400, marginLeft: 'auto' }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#4facfe', marginRight: 4 }} />打印
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#43e97b', marginLeft: 10, marginRight: 4 }} />出库
                  </span>
                </div>
                <MiniBarChart data={data.daily_trend} />
              </div>
            </Col>
          </Row>

          {/* Alerts */}
          {data.alerts.length > 0 && (
            <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.alerts.map((a, i) => (
                <div key={i} style={{
                  padding: '10px 16px', borderRadius: 10,
                  background: a.type === 'error' ? 'rgba(255,77,79,0.06)' : 'rgba(250,173,20,0.06)',
                  border: `1px solid ${a.type === 'error' ? 'rgba(255,77,79,0.15)' : 'rgba(250,173,20,0.15)'}`,
                  display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
                }}>
                  {a.type === 'error' ? <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} /> : <WarningOutlined style={{ color: '#faad14' }} />}
                  <span style={{ color: a.type === 'error' ? '#ff4d4f' : '#d48806' }}>{a.message}</span>
                </div>
              ))}
            </div>
          )}

          {/* Pipeline */}
          <div className="panel" style={{ marginBottom: 20, padding: '20px' }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
              <FireOutlined style={{ color: '#fa8c16' }} /> 生产链路全景
            </div>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
              {data.pipeline.map((stage, i) => {
                const sc = STATUS_COLORS[stage.status] || STATUS_COLORS.idle;
                return (
                  <React.Fragment key={i}>
                    <div style={{
                      flex: 1, minWidth: 140, padding: '16px 14px', borderRadius: 12,
                      background: sc.bg, border: `1px solid ${sc.border}`,
                      textAlign: 'center', transition: 'all 0.3s',
                    }}>
                      <div style={{ fontSize: 24, marginBottom: 6, color: sc.text }}>
                        {STAGE_ICONS[stage.icon] || <ClockCircleOutlined />}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4 }}>{stage.stage}</div>
                      <div className="num" style={{ fontSize: 22, fontWeight: 800, color: sc.text }}>{stage.value.toLocaleString()}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>{stage.detail}</div>
                    </div>
                    {i < data.pipeline.length - 1 && (
                      <div style={{ display: 'flex', alignItems: 'center', color: 'var(--text-4)' }}>
                        <ArrowRightOutlined />
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          {/* Summary Cards */}
          <Row gutter={[10, 10]} style={{ marginBottom: 20 }}>
            {[
              { label: '总标签', value: s?.total_labels ?? 0, color: '#4facfe', icon: <PrinterOutlined /> },
              { label: '总出库', value: s?.total_outbound ?? 0, color: '#43e97b', icon: <ScanOutlined /> },
              { label: '出库率', value: `${s?.outbound_rate ?? 0}%`, color: s && s.outbound_rate >= 70 ? '#43e97b' : '#faad14', icon: <RiseOutlined /> },
              { label: '审核通过率', value: `${s?.audit_pass_rate ?? 0}%`, color: s && s.audit_pass_rate >= 80 ? '#43e97b' : '#faad14', icon: <AuditOutlined /> },
              { label: '扫码失败', value: s?.failures ?? 0, color: (s?.failures ?? 0) > 5 ? '#ff4d4f' : '#43e97b', icon: <WarningOutlined /> },
              { label: '重量异常', value: s?.weight_anomalies ?? 0, color: (s?.weight_anomalies ?? 0) > 3 ? '#ff4d4f' : '#43e97b', icon: <ExclamationCircleOutlined /> },
            ].map((c, i) => (
              <Col xs={12} sm={8} md={4} key={i}>
                <div style={{
                  padding: '12px 14px', borderRadius: 12,
                  background: `${c.color}08`, border: `1px solid ${c.color}15`,
                  animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.05}s`,
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                    <span style={{ color: c.color }}>{c.icon}</span> {c.label}
                  </div>
                  <div className="num" style={{ fontSize: 20, fontWeight: 700, color: c.color }}>{c.value}</div>
                </div>
              </Col>
            ))}
          </Row>

          {/* Rankings */}
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12}>
              <div className="panel">
                <div className="panel-head">
                  <span className="panel-title"><TrophyOutlined style={{ color: '#fa8c16' }} /> 工人出库排行</span>
                </div>
                <Table
                  dataSource={data.worker_ranking}
                  rowKey="worker_id"
                  size="small"
                  pagination={false}
                  locale={{ emptyText: '暂无数据' }}
                  columns={[
                    {
                      title: '#', key: 'rank', width: 40, align: 'center',
                      render: (_: any, __: any, i: number) => {
                        const colors = ['#ffd700', '#c0c0c0', '#cd7f32'];
                        return i < 3 ? <span style={{ width: 20, height: 20, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', background: colors[i] }}>{i + 1}</span> : <span style={{ color: 'var(--text-4)' }}>{i + 1}</span>;
                      },
                    },
                    {
                      title: '工人', key: 'worker', width: 120,
                      render: (_: any, r: WorkerRank) => (
                        <Space size={6}>
                          <Avatar size={24} style={{ background: `hsl(${r.worker_id * 47 % 360},55%,55%)`, fontSize: 10 }}>{r.worker_name.charAt(0)}</Avatar>
                          <span style={{ fontWeight: 600, fontSize: 12 }}>{r.worker_name}</span>
                        </Space>
                      ),
                    },
                    { title: '出库', dataIndex: 'outbound', width: 70, align: 'right' as const, render: (v: number) => <span className="num" style={{ fontWeight: 700, color: '#43e97b' }}>{v}</span> },
                    { title: '打印', dataIndex: 'printed', width: 70, align: 'right' as const },
                    {
                      title: '出库率', dataIndex: 'outbound_rate', width: 80, align: 'center' as const,
                      render: (v: number) => <Tag color={v >= 80 ? 'green' : v >= 50 ? 'orange' : 'red'} style={{ borderRadius: 6, fontWeight: 600 }}>{v}%</Tag>,
                    },
                  ]}
                />
              </div>
            </Col>
            <Col xs={24} md={12}>
              <div className="panel">
                <div className="panel-head">
                  <span className="panel-title"><BarChartOutlined style={{ color: '#722ed1' }} /> SKU出库排行</span>
                </div>
                <Table
                  dataSource={data.sku_ranking}
                  rowKey="sku_name"
                  size="small"
                  pagination={false}
                  locale={{ emptyText: '暂无数据' }}
                  columns={[
                    { title: '#', key: 'rank', width: 40, align: 'center', render: (_: any, __: any, i: number) => <span style={{ color: 'var(--text-4)' }}>{i + 1}</span> },
                    { title: 'SKU', dataIndex: 'sku_name', width: 140, ellipsis: true, render: (v: string) => <span style={{ fontWeight: 600, fontSize: 12 }}>{v}</span> },
                    { title: '出库', dataIndex: 'outbound', width: 70, align: 'right' as const, render: (v: number) => <span className="num" style={{ fontWeight: 700, color: '#43e97b' }}>{v}</span> },
                    { title: '打印', dataIndex: 'printed', width: 70, align: 'right' as const },
                    {
                      title: '出库率', dataIndex: 'outbound_rate', width: 80, align: 'center' as const,
                      render: (v: number) => <Tag color={v >= 80 ? 'green' : v >= 50 ? 'orange' : 'red'} style={{ borderRadius: 6, fontWeight: 600 }}>{v}%</Tag>,
                    },
                  ]}
                />
              </div>
            </Col>
          </Row>
        </>
      )}

      {/* AI Diagnosis Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 10,
              background: 'linear-gradient(135deg, #0f0c29, #302b63)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <RobotOutlined style={{ color: '#4facfe', fontSize: 16 }} />
            </div>
            <span>AI 生产效率诊断</span>
            {aiLoading && <Spin size="small" />}
          </div>
        }
        open={aiModalOpen}
        onCancel={() => { setAiModalOpen(false); if (abortRef.current) abortRef.current.abort(); }}
        footer={null}
        width={640}
      >
        <div style={{ padding: '16px 0', fontSize: 14, lineHeight: 1.8, minHeight: 120 }}>
          {aiContent ? (
            <div style={{
              padding: '16px 20px', borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(15,12,41,0.03), rgba(48,43,99,0.03))',
              border: '1px solid rgba(79,172,254,0.1)',
            }}>
              {formatContent(aiContent)}
            </div>
          ) : aiLoading ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <Spin size="large" />
              <div style={{ marginTop: 12, color: 'var(--text-3)' }}>AI 正在诊断生产线...</div>
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
