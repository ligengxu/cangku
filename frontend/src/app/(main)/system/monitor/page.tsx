'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Button, Tag, Row, Col, Empty, Spin, message, Space, Progress, Tooltip,
} from 'antd';
import {
  SafetyCertificateOutlined, ReloadOutlined, WarningOutlined,
  CheckCircleOutlined, CloseCircleOutlined, InfoCircleOutlined,
  InboxOutlined, PrinterOutlined, ExportOutlined, AuditOutlined,
  AlertOutlined, BugOutlined, ClockCircleOutlined, DashboardOutlined,
  ThunderboltOutlined, LinkOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import { useRouter } from 'next/navigation';

interface Anomaly {
  category: string; level: string; title: string; detail: string; link: string;
}
interface ScanData {
  anomalies: Anomaly[];
  summary: {
    total_anomalies: number;
    level_counts: { critical: number; warning: number; info: number };
    category_counts: Record<string, number>;
    health_score: number; health_grade: string;
  };
  today: { production_records: number; outbound_count: number; printed_labels: number; pending_audits: number };
  scan_time: string;
}

const LEVEL_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string; tagColor: string }> = {
  critical: { color: '#f5222d', icon: <CloseCircleOutlined />, label: '严重', tagColor: 'error' },
  warning: { color: '#fa8c16', icon: <WarningOutlined />, label: '警告', tagColor: 'warning' },
  info: { color: '#1677ff', icon: <InfoCircleOutlined />, label: '提示', tagColor: 'processing' },
};

const CAT_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  inventory: { icon: <InboxOutlined />, label: '库存', color: '#722ed1' },
  production: { icon: <PrinterOutlined />, label: '生产', color: '#1677ff' },
  audit: { icon: <AuditOutlined />, label: '审核', color: '#fa8c16' },
  scan: { icon: <BugOutlined />, label: '扫码', color: '#f5222d' },
};

export default function SystemMonitorPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ScanData | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const router = useRouter();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/system/anomaly-scan');
      setData(res.data?.data || null);
    } catch { message.error('扫描失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const sm = data?.summary;
  const getHealthColor = (s: number) => s >= 80 ? '#00b96b' : s >= 60 ? '#faad14' : '#f5222d';
  const getHealthGradient = (s: number) => s >= 80
    ? 'linear-gradient(135deg, #00b96b, #5cdbd3)'
    : s >= 60 ? 'linear-gradient(135deg, #faad14, #ffc53d)'
    : 'linear-gradient(135deg, #f5222d, #ff7875)';

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{
        background: 'linear-gradient(135deg, #141414 0%, #1f1f1f 50%, #262626 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -40, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.03)' }} />
        <div style={{ position: 'absolute', bottom: -60, left: '30%', width: 200, height: 200, borderRadius: '50%', background: sm ? `${getHealthColor(sm.health_score)}10` : 'transparent' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ width: 44, height: 44, borderRadius: 14, background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
                <DashboardOutlined />
              </span>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>系统监控中心</div>
                <div style={{ fontSize: 13, opacity: 0.6, marginTop: 2 }}>
                  {data?.scan_time ? `最后扫描：${data.scan_time.slice(11, 19)}` : '正在扫描...'}
                </div>
              </div>
            </div>
            {sm && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 48, fontWeight: 900, color: getHealthColor(sm.health_score), lineHeight: 1 }}>{sm.health_grade}</div>
                  <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>健康等级</div>
                </div>
                <div style={{ width: 80, height: 80 }}>
                  <Progress type="circle" percent={sm.health_score} size={80}
                    strokeColor={getHealthColor(sm.health_score)}
                    trailColor="rgba(255,255,255,0.08)"
                    format={p => <span style={{ color: '#fff', fontWeight: 700 }}>{p}</span>} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {data && (
        <>
          <Row gutter={[10, 10]} style={{ marginBottom: 20 }}>
            {[
              { label: '今日生产', value: data.today.production_records, icon: <ThunderboltOutlined />, bg: 'linear-gradient(135deg, #1677ff, #69b1ff)', glow: 'rgba(22,119,255,0.15)' },
              { label: '今日出库', value: data.today.outbound_count, icon: <ExportOutlined />, bg: 'linear-gradient(135deg, #00b96b, #5cdbd3)', glow: 'rgba(0,185,107,0.15)' },
              { label: '今日打印', value: data.today.printed_labels, icon: <PrinterOutlined />, bg: 'linear-gradient(135deg, #722ed1, #b37feb)', glow: 'rgba(114,46,209,0.15)' },
              { label: '待审核', value: data.today.pending_audits, icon: <AuditOutlined />, bg: 'linear-gradient(135deg, #fa8c16, #ffc53d)', glow: 'rgba(250,140,22,0.15)' },
            ].map((s, i) => (
              <Col xs={12} sm={6} key={i}>
                <div style={{ padding: '14px 16px', borderRadius: 14, background: s.bg, boxShadow: `0 4px 16px ${s.glow}`, animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.06}s` }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)', display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>{s.icon} {s.label}</div>
                  <div className="num" style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>{s.value}</div>
                </div>
              </Col>
            ))}
          </Row>

          <div className="panel" style={{ marginBottom: 20 }}>
            <div className="panel-head">
              <span className="panel-title"><AlertOutlined style={{ color: '#f5222d' }} /> 异常告警</span>
              <Space>
                <Tag color={sm!.level_counts.critical > 0 ? 'error' : 'default'} style={{ borderRadius: 8, fontWeight: 600 }}>
                  严重 {sm!.level_counts.critical}
                </Tag>
                <Tag color={sm!.level_counts.warning > 0 ? 'warning' : 'default'} style={{ borderRadius: 8, fontWeight: 600 }}>
                  警告 {sm!.level_counts.warning}
                </Tag>
                <Tag color={sm!.level_counts.info > 0 ? 'processing' : 'default'} style={{ borderRadius: 8, fontWeight: 600 }}>
                  提示 {sm!.level_counts.info}
                </Tag>
                <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 8 }}>重新扫描</Button>
              </Space>
            </div>
            <div style={{ padding: '12px 16px' }}>
              {data.anomalies.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40 }}>
                  <CheckCircleOutlined style={{ fontSize: 48, color: '#00b96b', marginBottom: 12 }} />
                  <div style={{ fontSize: 16, fontWeight: 600, color: '#00b96b' }}>系统运行正常</div>
                  <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 4 }}>未检测到异常项目</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.anomalies.map((a, i) => {
                    const lc = LEVEL_CONFIG[a.level] || LEVEL_CONFIG.info;
                    const cc = CAT_CONFIG[a.category] || CAT_CONFIG.production;
                    return (
                      <div key={i} style={{
                        padding: '14px 18px', borderRadius: 12,
                        border: `1px solid ${lc.color}20`,
                        background: `${lc.color}04`,
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        gap: 12, cursor: a.link ? 'pointer' : 'default',
                        transition: 'all 0.3s',
                        animation: `stagger-in 0.4s ease both`, animationDelay: `${i * 0.05}s`,
                      }}
                        onClick={() => a.link && router.push(a.link)}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = lc.color + '50'; e.currentTarget.style.boxShadow = `0 4px 14px ${lc.color}15`; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = lc.color + '20'; e.currentTarget.style.boxShadow = 'none'; }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                          <span style={{
                            width: 36, height: 36, borderRadius: 10,
                            background: `${lc.color}12`, display: 'flex',
                            alignItems: 'center', justifyContent: 'center',
                            fontSize: 18, color: lc.color, flexShrink: 0,
                          }}>{lc.icon}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                              <Tag color={lc.tagColor} style={{ borderRadius: 6, fontSize: 10, fontWeight: 600 }}>{lc.label}</Tag>
                              <Tag style={{ borderRadius: 6, fontSize: 10, background: `${cc.color}10`, color: cc.color, border: `1px solid ${cc.color}25` }}>
                                {cc.icon} {cc.label}
                              </Tag>
                              <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>{a.title}</span>
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {a.detail}
                            </div>
                          </div>
                        </div>
                        {a.link && <LinkOutlined style={{ color: 'var(--text-4)', fontSize: 14, flexShrink: 0 }} />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div style={{
            padding: '10px 16px', borderRadius: 10,
            background: 'linear-gradient(135deg, rgba(0,0,0,0.02), rgba(0,0,0,0.01))',
            border: '1px solid var(--border-2)',
            fontSize: 12, color: 'var(--text-4)', lineHeight: 1.8,
          }}>
            <SafetyCertificateOutlined style={{ color: '#1677ff', marginRight: 6 }} />
            系统监控说明：自动扫描库存告警、标签滞留、审核积压、扫码异常等。健康评分满分100：每个严重问题扣20分，警告扣10分，提示扣3分。
            点击告警卡片可跳转到对应处理页面。
          </div>
        </>
      )}

      {loading && !data && (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" tip="正在扫描系统..." /></div>
      )}
    </div>
  );
}
