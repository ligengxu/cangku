'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, Row, Col, Typography, Button, Space, Tooltip, Badge,
  Spin, Empty, Tag, message,
} from 'antd';
import {
  CalendarOutlined, LeftOutlined, RightOutlined, ReloadOutlined,
  CheckCircleOutlined, ClockCircleOutlined, ThunderboltOutlined,
  DollarOutlined, InboxOutlined, PrinterOutlined, TrophyOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

interface DayData {
  date: string; day: number; weekday: number;
  production_qty: number; production_count: number; audit_status: string | null;
  printed: number; outbound: number; commission: number;
  attendance: string | null; work_hours: number | null;
  is_today: boolean; is_future: boolean;
}

interface CalendarData {
  year: number; month: number;
  days: DayData[];
  summary: {
    total_production: number; total_outbound: number;
    total_commission: number; total_printed: number;
    working_days: number; days_in_month: number;
  };
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

export default function WorkerCalendarPage() {
  const [year, setYear] = useState(dayjs().year());
  const [month, setMonth] = useState(dayjs().month() + 1);
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedDay, setSelectedDay] = useState<DayData | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/workers/my-calendar', { params: { year, month } });
      setData(r.data?.data);
    } catch {
      message.error('加载日历数据失败');
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const goMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setYear(y); setMonth(m); setSelectedDay(null);
  };

  const goToday = () => {
    setYear(dayjs().year()); setMonth(dayjs().month() + 1); setSelectedDay(null);
  };

  const summary = data?.summary;
  const days = data?.days || [];

  const firstDayWeekday = days.length > 0 ? days[0].weekday : 1;
  const padBefore = firstDayWeekday - 1;

  const getColor = (d: DayData) => {
    if (d.is_future) return 'var(--text-4)';
    if (d.outbound > 0) return '#52c41a';
    if (d.printed > 0) return '#1677ff';
    if (d.production_qty > 0) return '#fa8c16';
    return 'var(--text-3)';
  };

  const getBg = (d: DayData) => {
    if (d.is_today) return 'linear-gradient(135deg, rgba(22,119,255,0.08), rgba(114,46,209,0.04))';
    if (d.is_future) return 'transparent';
    if (d.outbound > 0) return 'rgba(82,196,26,0.04)';
    if (d.production_qty > 0) return 'rgba(250,140,22,0.03)';
    return 'transparent';
  };

  const statCards = [
    { label: '工作天数', value: summary?.working_days ?? 0, icon: <CalendarOutlined />, color: '#1677ff', gradient: 'linear-gradient(135deg, #1677ff, #69b1ff)' },
    { label: '总产量', value: summary?.total_production ?? 0, icon: <InboxOutlined />, color: '#fa8c16', gradient: 'linear-gradient(135deg, #fa8c16, #ffc53d)' },
    { label: '总出库', value: summary?.total_outbound ?? 0, icon: <CheckCircleOutlined />, color: '#52c41a', gradient: 'linear-gradient(135deg, #52c41a, #95de64)' },
    { label: '总佣金', value: summary?.total_commission ?? 0, icon: <DollarOutlined />, color: '#eb2f96', gradient: 'linear-gradient(135deg, #eb2f96, #f759ab)' },
  ];

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #fa8c16 0%, #eb2f96 50%, #722ed1 100%)',
        borderRadius: 16, padding: '24px 28px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: -30, right: -20, width: 160, height: 160,
          borderRadius: '50%', background: 'rgba(255,255,255,0.06)',
        }} />
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
              <span style={{
                width: 40, height: 40, borderRadius: 12,
                background: 'rgba(255,255,255,0.2)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 18,
              }}><CalendarOutlined /></span>
              <Title level={3} style={{ margin: 0, color: '#fff' }}>产量日历</Title>
            </div>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>按月查看每日生产数据</Text>
          </div>
          <Space>
            <Button icon={<LeftOutlined />} onClick={() => goMonth(-1)}
              style={{ borderRadius: 10, background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', width: 36, height: 36 }} />
            <div style={{ fontSize: 18, fontWeight: 700, minWidth: 100, textAlign: 'center' }}>
              {year}年{month}月
            </div>
            <Button icon={<RightOutlined />} onClick={() => goMonth(1)}
              style={{ borderRadius: 10, background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', width: 36, height: 36 }} />
            <Button onClick={goToday} style={{ borderRadius: 10, background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', fontSize: 12 }}>
              今天
            </Button>
          </Space>
        </div>
      </div>

      {/* Summary cards */}
      <Row gutter={[10, 10]} style={{ marginBottom: 18 }}>
        {statCards.map((c, i) => (
          <Col xs={12} sm={6} key={i}>
            <div style={{
              background: 'var(--bg-card)', borderRadius: 12, padding: '14px 12px',
              border: '1px solid var(--border-2)', display: 'flex', alignItems: 'center', gap: 10,
              animation: `fadeSlideUp 0.4s ease ${i * 0.06}s both`,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, background: c.gradient,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, color: '#fff', flexShrink: 0,
              }}>{c.icon}</div>
              <div>
                <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{c.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>
                  {c.label === '总佣金' ? Number(c.value).toFixed(1) : c.value}
                </div>
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : (
        <Row gutter={16}>
          <Col xs={24} md={selectedDay ? 16 : 24}>
            <Card style={{ borderRadius: 16, border: '1px solid var(--border-2)', boxShadow: 'var(--shadow-1)' }}
              styles={{ body: { padding: '12px 16px' } }}>
              {/* Weekday headers */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 8 }}>
                {WEEKDAYS.map((w, i) => (
                  <div key={w} style={{
                    textAlign: 'center', fontSize: 12, fontWeight: 600, padding: '6px 0',
                    color: i >= 5 ? '#eb2f96' : 'var(--text-3)',
                  }}>{w}</div>
                ))}
              </div>

              {/* Calendar grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
                {Array(padBefore).fill(null).map((_, i) => <div key={`pad-${i}`} />)}
                {days.map(d => (
                  <Tooltip key={d.day} title={
                    <div style={{ fontSize: 12 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.date}</div>
                      {d.printed > 0 && <div>标签: {d.printed}</div>}
                      {d.production_qty > 0 && <div>产量: {d.production_qty}</div>}
                      {d.outbound > 0 && <div>出库: {d.outbound}</div>}
                      {d.commission > 0 && <div>佣金: {d.commission}</div>}
                      {d.attendance && <div>考勤: {d.attendance === 'present' ? '出勤' : d.attendance}</div>}
                    </div>
                  }>
                    <div
                      onClick={() => !d.is_future && setSelectedDay(d)}
                      style={{
                        padding: '8px 4px', borderRadius: 10, textAlign: 'center',
                        cursor: d.is_future ? 'default' : 'pointer',
                        border: selectedDay?.day === d.day ? '2px solid var(--brand)' : d.is_today ? '2px solid rgba(22,119,255,0.3)' : '1px solid transparent',
                        background: getBg(d),
                        transition: 'all 0.2s', minHeight: 68,
                        opacity: d.is_future ? 0.4 : 1,
                      }}
                      onMouseEnter={e => { if (!d.is_future) e.currentTarget.style.transform = 'scale(1.05)'; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
                    >
                      <div style={{
                        fontSize: 15, fontWeight: d.is_today ? 800 : 600,
                        color: d.is_today ? 'var(--brand)' : getColor(d),
                        marginBottom: 3,
                      }}>
                        {d.day}
                      </div>
                      {!d.is_future && (d.production_qty > 0 || d.outbound > 0 || d.printed > 0) && (
                        <div style={{ display: 'flex', justifyContent: 'center', gap: 2, flexWrap: 'wrap' }}>
                          {d.outbound > 0 && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#52c41a' }} />}
                          {d.printed > 0 && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#1677ff' }} />}
                          {d.production_qty > 0 && d.outbound === 0 && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fa8c16' }} />}
                        </div>
                      )}
                      {!d.is_future && d.commission > 0 && (
                        <div style={{ fontSize: 9, color: '#eb2f96', fontWeight: 600, marginTop: 2 }}>
                          {d.commission}
                        </div>
                      )}
                    </div>
                  </Tooltip>
                ))}
              </div>

              {/* Legend */}
              <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-2)' }}>
                {[
                  { color: '#52c41a', label: '已出库' },
                  { color: '#1677ff', label: '已打印' },
                  { color: '#fa8c16', label: '有产量' },
                ].map(l => (
                  <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-3)' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: l.color }} />
                    {l.label}
                  </div>
                ))}
              </div>
            </Card>
          </Col>

          {/* Day detail */}
          {selectedDay && (
            <Col xs={24} md={8}>
              <Card style={{
                borderRadius: 16, border: '1px solid var(--border-2)',
                boxShadow: 'var(--shadow-1)', position: 'sticky', top: 80,
              }} styles={{ body: { padding: '20px' } }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <CalendarOutlined style={{ color: 'var(--brand)', fontSize: 16 }} />
                  <Text style={{ fontWeight: 700, fontSize: 16 }}>{selectedDay.date}</Text>
                  {selectedDay.is_today && <Tag color="blue" style={{ borderRadius: 6 }}>今天</Tag>}
                </div>

                {[
                  { label: '标签打印', value: selectedDay.printed, icon: <PrinterOutlined />, color: '#1677ff' },
                  { label: '实际产量', value: selectedDay.production_qty, icon: <InboxOutlined />, color: '#fa8c16' },
                  { label: '出库数量', value: selectedDay.outbound, icon: <CheckCircleOutlined />, color: '#52c41a' },
                  { label: '佣金', value: selectedDay.commission, icon: <DollarOutlined />, color: '#eb2f96', suffix: '' },
                ].map((item, i) => (
                  <div key={i} style={{
                    padding: '12px 14px', borderRadius: 10, marginBottom: 8,
                    background: `${item.color}06`, border: `1px solid ${item.color}12`,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: item.color, fontSize: 14 }}>{item.icon}</span>
                      <Text style={{ fontSize: 13, color: 'var(--text-2)' }}>{item.label}</Text>
                    </div>
                    <Text style={{ fontSize: 18, fontWeight: 700, color: item.color }}>
                      {item.label === '佣金' ? Number(item.value).toFixed(1) : item.value}
                    </Text>
                  </div>
                ))}

                {selectedDay.attendance && (
                  <div style={{
                    padding: '10px 14px', borderRadius: 10, marginTop: 4,
                    background: selectedDay.attendance === 'present' ? 'rgba(82,196,26,0.06)' : 'rgba(250,140,22,0.06)',
                    border: `1px solid ${selectedDay.attendance === 'present' ? 'rgba(82,196,26,0.15)' : 'rgba(250,140,22,0.15)'}`,
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <ClockCircleOutlined style={{ color: selectedDay.attendance === 'present' ? '#52c41a' : '#fa8c16' }} />
                    <Text style={{ fontSize: 13 }}>
                      {selectedDay.attendance === 'present' ? '出勤' : selectedDay.attendance}
                      {selectedDay.work_hours && ` · ${selectedDay.work_hours}h`}
                    </Text>
                  </div>
                )}

                {selectedDay.audit_status && (
                  <div style={{ marginTop: 8 }}>
                    <Tag color={
                      selectedDay.audit_status === 'approved' ? 'green' :
                      selectedDay.audit_status === 'rejected' ? 'red' : 'orange'
                    } style={{ borderRadius: 6 }}>
                      {selectedDay.audit_status === 'approved' ? '已审核' :
                       selectedDay.audit_status === 'rejected' ? '被驳回' : '待审核'}
                    </Tag>
                  </div>
                )}
              </Card>
            </Col>
          )}
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
