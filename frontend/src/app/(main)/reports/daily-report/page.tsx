'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  DatePicker, Button, Row, Col, Empty, Spin, message, Space, Tag, Modal,
} from 'antd';
import {
  FileTextOutlined, ReloadOutlined,
  PrinterOutlined, ExportOutlined,
  WarningOutlined, DollarOutlined,
  ThunderboltOutlined, TrophyOutlined,
  ArrowUpOutlined, ArrowDownOutlined, CheckCircleOutlined,
  ClockCircleOutlined, ExperimentOutlined,
  ShoppingCartOutlined, RobotOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dayjs from 'dayjs';

interface DailyData {
  date: string;
  production: { records: number; total_qty: number; workers: number; skus: number; change_vs_yesterday: number; pending_audit: number; approved: number };
  labels: { printed: number; outbound: number; outbound_weight: number; outbound_change: number; warehouse: number };
  transactions: { count: number; quantity: number };
  purchase: { count: number; weight: number; cost: number };
  assignments: { batches: number; workers: number };
  alerts: { low_stock: number; failures: number };
  finance: { commission: number };
  top_workers: { name: string; qty: number }[];
  top_skus: { name: string; count: number }[];
}

const SECTION_COLORS = {
  production: { bg: 'linear-gradient(135deg, #1677ff, #69b1ff)', glow: 'rgba(22,119,255,0.15)', icon: <ExperimentOutlined /> },
  labels: { bg: 'linear-gradient(135deg, #722ed1, #b37feb)', glow: 'rgba(114,46,209,0.15)', icon: <PrinterOutlined /> },
  outbound: { bg: 'linear-gradient(135deg, #00b96b, #5cdbd3)', glow: 'rgba(0,185,107,0.15)', icon: <ExportOutlined /> },
  purchase: { bg: 'linear-gradient(135deg, #fa8c16, #ffc53d)', glow: 'rgba(250,140,22,0.15)', icon: <ShoppingCartOutlined /> },
  finance: { bg: 'linear-gradient(135deg, #eb2f96, #ff85c0)', glow: 'rgba(235,47,150,0.15)', icon: <DollarOutlined /> },
  alerts: { bg: 'linear-gradient(135deg, #f5222d, #ff7875)', glow: 'rgba(245,34,45,0.15)', icon: <WarningOutlined /> },
};

function ChangeTag({ value, suffix = '' }: { value: number; suffix?: string }) {
  if (value === 0) return <span style={{ fontSize: 11, color: 'var(--text-4)' }}>持平</span>;
  return (
    <Tag color={value > 0 ? 'success' : 'error'} style={{ borderRadius: 6, fontSize: 10, fontWeight: 600 }}>
      {value > 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {Math.abs(value)}{suffix}
    </Tag>
  );
}

export default function DailyReportPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DailyData | null>(null);
  const [selectedDate, setSelectedDate] = useState(dayjs());
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const openAi = async () => {
    setAiContent(''); setAiOpen(true); setAiLoading(true);
    try {
      abortRef.current = new AbortController();
      const res = await fetch(`/api/reports/daily-brief-ai?target_date=${selectedDate.format('YYYY-MM-DD')}`, {
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
          try { const p = JSON.parse(d); if (p.content) acc += p.content; } catch {}
        }
        setAiContent(acc);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') setAiContent('AI分析暂不可用');
    } finally { setAiLoading(false); abortRef.current = null; }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/reports/daily-report', { params: { report_date: selectedDate.format('YYYY-MM-DD') } });
      setData(res.data?.data || null);
    } catch { message.error('加载日报失败'); }
    finally { setLoading(false); }
  }, [selectedDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const handlePrint = () => window.print();

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div style={{
        background: 'linear-gradient(135deg, #1f1f1f 0%, #141414 50%, #262626 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -40, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.03)' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ width: 44, height: 44, borderRadius: 14, background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}><FileTextOutlined /></span>
              <div>
                <div style={{ fontSize: 22, fontWeight: 700 }}>每日运营日报</div>
                <div style={{ fontSize: 14, opacity: 0.85, marginTop: 4 }}>{selectedDate.format('YYYY年MM月DD日')} · 星期{['日','一','二','三','四','五','六'][selectedDate.day()]}</div>
              </div>
            </div>
            <Space>
              <DatePicker value={selectedDate} onChange={v => v && setSelectedDate(v)} allowClear={false}
                style={{ borderRadius: 8, background: 'rgba(255,255,255,0.1)', borderColor: 'rgba(255,255,255,0.2)' }} />
              <Button icon={<RobotOutlined />} onClick={openAi} style={{ borderRadius: 8, background: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none', color: '#fff' }}>AI日报</Button>
              <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 8 }} />
              <Button onClick={handlePrint} style={{ borderRadius: 8 }}>打印</Button>
            </Space>
          </div>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : !data ? (
        <div className="panel" style={{ padding: 60, textAlign: 'center' }}><Empty description="暂无数据" /></div>
      ) : (
        <>
          <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
            {[
              { label: '生产录入', value: data.production.total_qty, suffix: '件', change: data.production.change_vs_yesterday, ...SECTION_COLORS.production },
              { label: '标签打印', value: data.labels.printed, suffix: '个', change: 0, ...SECTION_COLORS.labels },
              { label: '出库扫码', value: data.labels.outbound, suffix: '件', change: data.labels.outbound_change, ...SECTION_COLORS.outbound },
              { label: '采购入库', value: `${data.purchase.weight}kg`, suffix: '', change: 0, ...SECTION_COLORS.purchase },
              { label: '总佣金', value: `¥${data.finance.commission}`, suffix: '', change: 0, ...SECTION_COLORS.finance },
              { label: '告警数', value: data.alerts.low_stock + data.alerts.failures, suffix: '项', change: 0, ...SECTION_COLORS.alerts },
            ].map((s, i) => (
              <Col xs={12} sm={8} md={4} key={i}>
                <div style={{ padding: '14px 16px', borderRadius: 14, background: s.bg, boxShadow: `0 4px 16px ${s.glow}` }}>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)', display: 'flex', alignItems: 'center', gap: 3, marginBottom: 3 }}>{s.icon} {s.label}</div>
                  <div className="num" style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{s.value}</div>
                  {s.suffix && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)' }}>{s.suffix}</span>}
                  {s.change !== 0 && <div style={{ marginTop: 3 }}><ChangeTag value={s.change} /></div>}
                </div>
              </Col>
            ))}
          </Row>

          <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
            <Col xs={24} md={12}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head"><span className="panel-title"><ExperimentOutlined style={{ color: '#1677ff' }} /> 生产概况</span></div>
                <div style={{ padding: '12px 20px' }}>
                  {[
                    { label: '录入条数', value: data.production.records, color: '#1677ff' },
                    { label: '生产数量', value: `${data.production.total_qty} 件`, color: '#00b96b' },
                    { label: '参与工人', value: `${data.production.workers} 人`, color: '#722ed1' },
                    { label: 'SKU品类', value: `${data.production.skus} 种`, color: '#fa8c16' },
                    { label: '已审核', value: data.production.approved, color: '#00b96b', icon: <CheckCircleOutlined /> },
                    { label: '待审核', value: data.production.pending_audit, color: '#faad14', icon: <ClockCircleOutlined /> },
                  ].map((item, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < 5 ? '1px solid var(--border-2)' : 'none' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: 4 }}>{item.icon} {item.label}</span>
                      <span className="num" style={{ fontWeight: 700, color: item.color, fontSize: 14 }}>{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Col>
            <Col xs={24} md={12}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head"><span className="panel-title"><ExportOutlined style={{ color: '#00b96b' }} /> 出库与库存</span></div>
                <div style={{ padding: '12px 20px' }}>
                  {[
                    { label: '出库件数', value: data.labels.outbound, color: '#00b96b' },
                    { label: '出库重量', value: `${data.labels.outbound_weight} kg`, color: '#1677ff' },
                    { label: '仓库滞留', value: `${data.labels.warehouse} 个`, color: '#fa8c16' },
                    { label: 'SKU申请', value: `${data.transactions.count} 笔 / ${data.transactions.quantity} 件`, color: '#722ed1' },
                    { label: '扫码失败', value: `${data.alerts.failures} 次`, color: data.alerts.failures > 10 ? '#f5222d' : '#8c8c8c' },
                    { label: '库存告警', value: `${data.alerts.low_stock} 种`, color: data.alerts.low_stock > 0 ? '#f5222d' : '#8c8c8c' },
                  ].map((item, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < 5 ? '1px solid var(--border-2)' : 'none' }}>
                      <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{item.label}</span>
                      <span className="num" style={{ fontWeight: 700, color: item.color, fontSize: 14 }}>{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
            <Col xs={24} md={12}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head"><span className="panel-title"><TrophyOutlined style={{ color: '#fa8c16' }} /> 今日产量王</span></div>
                <div style={{ padding: '8px 16px' }}>
                  {data.top_workers.length ? data.top_workers.map((w, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i < data.top_workers.length - 1 ? '1px solid var(--border-2)' : 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 22, height: 22, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: i < 3 ? '#fff' : 'var(--text-3)', background: i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : 'var(--gray-3)' }}>{i + 1}</span>
                        <span style={{ fontWeight: 600 }}>{w.name}</span>
                      </div>
                      <span className="num" style={{ fontWeight: 700, color: '#fa8c16' }}>{w.qty} 件</span>
                    </div>
                  )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="今日暂无数据" />}
                </div>
              </div>
            </Col>
            <Col xs={24} md={12}>
              <div className="panel" style={{ height: '100%' }}>
                <div className="panel-head"><span className="panel-title"><ThunderboltOutlined style={{ color: '#1677ff' }} /> 热销SKU</span></div>
                <div style={{ padding: '8px 16px' }}>
                  {data.top_skus.length ? data.top_skus.map((s, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i < data.top_skus.length - 1 ? '1px solid var(--border-2)' : 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 22, height: 22, borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: i < 3 ? '#fff' : 'var(--text-3)', background: i === 0 ? '#ffd700' : i === 1 ? '#c0c0c0' : i === 2 ? '#cd7f32' : 'var(--gray-3)' }}>{i + 1}</span>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</span>
                      </div>
                      <span className="num" style={{ fontWeight: 700, color: '#1677ff' }}>{s.count} 件</span>
                    </div>
                  )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="今日暂无出库" />}
                </div>
              </div>
            </Col>
          </Row>

          {data.purchase.count > 0 && (
            <div className="panel" style={{ marginBottom: 20 }}>
              <div className="panel-head"><span className="panel-title"><ShoppingCartOutlined style={{ color: '#fa8c16' }} /> 采购概况</span></div>
              <div style={{ padding: '12px 20px', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 11, color: 'var(--text-3)' }}>采购批次</div><div className="num" style={{ fontSize: 20, fontWeight: 700, color: '#fa8c16' }}>{data.purchase.count}</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 11, color: 'var(--text-3)' }}>采购重量</div><div className="num" style={{ fontSize: 20, fontWeight: 700, color: '#1677ff' }}>{data.purchase.weight}kg</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 11, color: 'var(--text-3)' }}>采购金额</div><div className="num" style={{ fontSize: 20, fontWeight: 700, color: '#722ed1' }}>¥{data.purchase.cost}</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 11, color: 'var(--text-3)' }}>分配批次</div><div className="num" style={{ fontSize: 20, fontWeight: 700, color: '#00b96b' }}>{data.assignments.batches}</div></div>
              </div>
            </div>
          )}
        </>
      )}

      <Modal
        title={<div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #0f2027, #2c5364)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <RobotOutlined style={{ color: '#4facfe', fontSize: 14 }} />
          </div>
          <span>AI 运营日报 · {selectedDate.format('YYYY-MM-DD')}</span>
          {aiLoading && <Spin size="small" />}
        </div>}
        open={aiOpen}
        onCancel={() => { setAiOpen(false); if (abortRef.current) abortRef.current.abort(); }}
        footer={null} width={580}
      >
        <div style={{ padding: '12px 0', fontSize: 14, lineHeight: 1.8, minHeight: 100 }}>
          {aiContent ? (
            <div style={{ padding: '14px 18px', borderRadius: 12, background: 'rgba(79,172,254,0.04)', border: '1px solid rgba(79,172,254,0.1)' }}>
              {aiContent.split(/(\*\*.*?\*\*|\n)/g).map((p, i) => {
                if (p === '\n') return <br key={i} />;
                if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
                return <span key={i}>{p}</span>;
              })}
            </div>
          ) : aiLoading ? (
            <div style={{ textAlign: 'center', padding: 30 }}><Spin size="large" /><div style={{ marginTop: 10, color: 'var(--text-3)' }}>AI正在生成日报...</div></div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
