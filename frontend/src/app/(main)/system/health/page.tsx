'use client';

import { useState, useEffect } from 'react';
import { Row, Col, Spin, message, Tooltip } from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, DatabaseOutlined,
  ApiOutlined, CodeOutlined, HeartOutlined, SyncOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import { useAuth } from '@/stores/useAuth';
import type { SystemHealth } from '@/types';

export default function HealthPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await api.get('/system/health');
      const d = res.data?.data ?? res.data ?? {};
      setHealth(typeof d === 'object' ? d : null);
      setLastCheck(new Date());
    } catch {
      message.error('加载健康状态失败');
      setHealth(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const statusOk = health?.status === 'ok' || health?.status === 'healthy';
  const dbOk = !health?.database || health.database?.status === 'ok' || health.database?.status === 'healthy' || health.database?.status === 'connected';

  const cards = [
    {
      title: '服务状态', icon: <ApiOutlined />,
      value: statusOk ? '运行正常' : '服务异常',
      ok: statusOk,
      gradient: statusOk ? 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)' : 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)',
      glow: statusOk ? 'rgba(0,185,107,0.2)' : 'rgba(255,77,79,0.2)',
      statusIcon: statusOk ? <CheckCircleOutlined /> : <CloseCircleOutlined />,
    },
    {
      title: '数据库', icon: <DatabaseOutlined />,
      value: dbOk ? (health?.database?.status ?? '已连接') : (health?.database?.status ?? '异常'),
      ok: dbOk,
      gradient: dbOk ? 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)' : 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)',
      glow: dbOk ? 'rgba(22,119,255,0.2)' : 'rgba(255,77,79,0.2)',
      statusIcon: dbOk ? <CheckCircleOutlined /> : <CloseCircleOutlined />,
    },
    {
      title: '系统版本', icon: <CodeOutlined />,
      value: health?.version ?? '-',
      ok: true,
      gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)',
      glow: 'rgba(114,46,209,0.2)',
      statusIcon: <CodeOutlined />,
    },
  ];

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* ── 页头 ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28,
        padding: '20px 24px', borderRadius: 'var(--radius-l)',
        background: 'linear-gradient(135deg, rgba(0,185,107,0.05) 0%, rgba(22,119,255,0.03) 100%)',
        border: '1px solid rgba(0,185,107,0.06)',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 32, height: 32, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', color: '#fff', fontSize: 15,
              boxShadow: '0 3px 10px rgba(0,185,107,0.2)',
            }}><HeartOutlined /></span>
            系统健康
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 42 }}>
            {user?.real_name || user?.username}，查看系统运行状态
          </div>
        </div>
        <Tooltip title={lastCheck ? `上次检查：${lastCheck.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : '点击刷新'}>
          <div onClick={fetchData} style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(0,185,107,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: '#00b96b', fontSize: 14,
            transition: 'all 0.25s', boxShadow: '0 2px 8px rgba(0,185,107,0.08)',
          }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'rotate(90deg) scale(1.05)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,185,107,0.2)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,185,107,0.08)'; }}
          >
            <SyncOutlined spin={loading} />
          </div>
        </Tooltip>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : (
        <Row gutter={[16, 16]}>
          {cards.map((c, i) => (
            <Col xs={24} sm={8} key={i}>
              <div className={`stagger-${i + 1}`} style={{
                background: c.gradient, borderRadius: 'var(--radius-l)',
                padding: '28px 22px', position: 'relative', overflow: 'hidden',
                boxShadow: `0 6px 24px ${c.glow}`,
                transition: 'all 0.3s',
                minHeight: 160,
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = `0 10px 36px ${c.glow}`; }}
                onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = `0 6px 24px ${c.glow}`; }}
              >
                <div style={{ position: 'absolute', top: -24, right: -24, width: 90, height: 90, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', bottom: -16, left: -16, width: 60, height: 60, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none' }} />

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <span style={{
                    width: 36, height: 36, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: 17,
                    backdropFilter: 'blur(4px)',
                  }}>{c.icon}</span>
                  <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: 600 }}>{c.title}</span>
                </div>

                <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginBottom: 6, textShadow: '0 1px 2px rgba(0,0,0,0.08)' }}>
                  {c.value}
                </div>

                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '3px 10px', borderRadius: 20,
                  background: 'rgba(255,255,255,0.2)', fontSize: 12, color: '#fff', fontWeight: 500,
                }}>
                  {c.statusIcon}
                  {c.ok ? '正常' : '异常'}
                </div>
              </div>
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
}
