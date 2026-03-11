'use client';

import { useEffect, useState, useCallback } from 'react';
import { Row, Col, Spin, Form, Input, Button, message, Tag, Tooltip, Avatar, Divider } from 'antd';
import {
  UserOutlined, PhoneOutlined, AlipayCircleOutlined, KeyOutlined,
  SaveOutlined, TrophyOutlined, CalendarOutlined, FireOutlined,
  PrinterOutlined, ThunderboltOutlined, EditOutlined, CheckOutlined,
  MailOutlined, SafetyCertificateOutlined, CrownOutlined,
  BarChartOutlined, ClockCircleOutlined, DollarOutlined,
  ExportOutlined, AppstoreOutlined, RocketOutlined, TeamOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import { useAuth } from '@/stores/useAuth';
import { logout } from '@/services/auth';
import { useDevice } from '@/hooks/useDevice';
import { useRouter } from 'next/navigation';

interface Badge { icon: string; name: string; desc: string }
interface ProfileData {
  user_id: number;
  username: string;
  role: string;
  real_name: string | null;
  phone: string | null;
  alipay_account: string | null;
  created_stats: Record<string, any>;
}

const AVATAR_COLORS = ['#1677ff', '#00b96b', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2', '#2f54eb', '#faad14'];

export default function ProfilePage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [editing, setEditing] = useState(false);
  const [form] = Form.useForm();
  const [pwdForm] = Form.useForm();
  const [pwdSaving, setPwdSaving] = useState(false);
  const [showPwd, setShowPwd] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get('/auth/profile');
      setProfile(res.data?.data ?? null);
    } catch { message.error('加载个人信息失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  useEffect(() => {
    if (profile && editing) {
      form.setFieldsValue({
        real_name: profile.real_name || '',
        phone: profile.phone || '',
        alipay_account: profile.alipay_account || '',
      });
    }
  }, [profile, editing, form]);

  const handleSave = async () => {
    const vals = await form.validateFields();
    setSaving(true);
    try {
      await api.put('/auth/profile', vals);
      message.success('个人信息已更新');
      setEditing(false);
      fetchProfile();
    } catch (e: any) { message.error(e?.response?.data?.detail ?? '更新失败'); }
    finally { setSaving(false); }
  };

  const handleChangePassword = async () => {
    const vals = await pwdForm.validateFields();
    if (vals.new_password !== vals.confirm_password) {
      message.error('两次密码不一致');
      return;
    }
    setPwdSaving(true);
    try {
      await api.post('/auth/change-password', { old_password: vals.old_password, new_password: vals.new_password });
      message.success('密码修改成功，请重新登录');
      pwdForm.resetFields();
      setShowPwd(false);
      setTimeout(() => logout(), 1500);
    } catch (e: any) { message.error(e?.response?.data?.detail ?? '修改失败'); }
    finally { setPwdSaving(false); }
  };

  const { isMobile } = useDevice();
  const router = useRouter();
  const isWorkerMobile = isMobile && user?.role === 'worker';
  const avatarBg = profile ? AVATAR_COLORS[profile.user_id % AVATAR_COLORS.length] : '#1677ff';
  const initial = (profile?.real_name || profile?.username || 'U')[0];
  const stats = profile?.created_stats || {};

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
      <Spin size="large" />
    </div>
  );

  if (isWorkerMobile) {
    return (
      <div className="wm-profile">
        {/* 头像卡片 */}
        <div className="wm-profile-hero" style={{ background: `linear-gradient(135deg, ${avatarBg}, ${avatarBg}aa)` }}>
          <div className="wm-profile-hero-bg" />
          <Avatar size={72} style={{
            background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)',
            fontSize: 30, fontWeight: 700, color: '#fff',
            border: '3px solid rgba(255,255,255,0.3)',
          }}>{initial}</Avatar>
          <div className="wm-profile-name">{profile?.real_name || profile?.username}</div>
          <div className="wm-profile-role">
            <ThunderboltOutlined /> 工人
          </div>
        </div>

        {/* 本月统计 */}
        <div style={{ padding: '0 16px', marginBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
            <CalendarOutlined style={{ color: '#1677ff', fontSize: 12 }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)' }}>
              本月绩效
            </span>
            <span style={{ fontSize: 10, color: 'var(--text-4)' }}>
              {new Date().getFullYear()}.{String(new Date().getMonth() + 1).padStart(2, '0')}
            </span>
          </div>
        </div>
        <div className="wm-profile-stats">
          {[
            { label: '本月产量', value: stats.month_production ?? 0, color: '#fa8c16' },
            { label: '本月标签', value: stats.month_labels ?? 0, color: '#1677ff' },
            { label: '本月出库', value: stats.month_outbound ?? 0, color: '#52c41a' },
            { label: '本月绩效', value: `¥${Number(stats.month_commission ?? 0).toFixed(0)}`, color: '#eb2f96' },
          ].map((item, i) => (
            <div key={i} className="wm-profile-stat-item">
              <div className="wm-profile-stat-val" style={{ color: item.color }}>
                {typeof item.value === 'number' ? item.value.toLocaleString() : item.value}
              </div>
              <div className="wm-profile-stat-label">{item.label}</div>
            </div>
          ))}
        </div>

        {/* 菜单列表 */}
        <div className="wm-profile-menu">
          <div className="wm-profile-menu-item" onClick={() => router.push('/workers/performance')}>
            <div className="wm-profile-menu-icon" style={{ background: 'rgba(250,140,22,0.1)', color: '#fa8c16' }}>
              <ThunderboltOutlined />
            </div>
            <span>我的绩效</span>
            <span className="wm-profile-menu-arrow">›</span>
          </div>
          <div className="wm-profile-menu-item" onClick={() => setEditing(true)}>
            <div className="wm-profile-menu-icon" style={{ background: 'rgba(22,119,255,0.1)', color: '#1677ff' }}>
              <EditOutlined />
            </div>
            <span>编辑资料</span>
            <span className="wm-profile-menu-arrow">›</span>
          </div>
          <div className="wm-profile-menu-item" onClick={() => setShowPwd(true)}>
            <div className="wm-profile-menu-icon" style={{ background: 'rgba(114,46,209,0.1)', color: '#722ed1' }}>
              <KeyOutlined />
            </div>
            <span>修改密码</span>
            <span className="wm-profile-menu-arrow">›</span>
          </div>
          <div className="wm-profile-menu-item" onClick={() => router.push('/system/bugs')}>
            <div className="wm-profile-menu-icon" style={{ background: 'rgba(19,194,194,0.1)', color: '#13c2c2' }}>
              <MailOutlined />
            </div>
            <span>问题反馈</span>
            <span className="wm-profile-menu-arrow">›</span>
          </div>
        </div>

        {/* 退出登录 */}
        <button className="wm-profile-logout" onClick={() => logout()}>
          退出登录
        </button>

        {/* 编辑资料弹窗 */}
        {editing && (
          <div className="wm-profile-modal-overlay" onClick={() => setEditing(false)}>
            <div className="wm-profile-modal" onClick={e => e.stopPropagation()}>
              <h3>编辑资料</h3>
              <Form form={form} layout="vertical">
                <Form.Item name="real_name" label="真实姓名">
                  <Input placeholder="输入真实姓名" prefix={<UserOutlined />} style={{ borderRadius: 12, height: 46 }} />
                </Form.Item>
                <Form.Item name="phone" label="手机号" rules={[{ pattern: /^1[3-9]\d{9}$|^$/, message: '请输入正确手机号' }]}>
                  <Input placeholder="输入手机号" prefix={<PhoneOutlined />} style={{ borderRadius: 12, height: 46 }} />
                </Form.Item>
                <Form.Item name="alipay_account" label="支付宝账号">
                  <Input placeholder="输入支付宝账号" prefix={<AlipayCircleOutlined />} style={{ borderRadius: 12, height: 46 }} />
                </Form.Item>
                <div style={{ display: 'flex', gap: 10 }}>
                  <Button onClick={() => setEditing(false)} style={{ flex: 1, height: 46, borderRadius: 12 }}>取消</Button>
                  <Button type="primary" onClick={handleSave} loading={saving}
                    style={{ flex: 1, height: 46, borderRadius: 12, fontWeight: 600 }}>保存</Button>
                </div>
              </Form>
            </div>
          </div>
        )}

        {/* 修改密码弹窗 */}
        {showPwd && (
          <div className="wm-profile-modal-overlay" onClick={() => { setShowPwd(false); pwdForm.resetFields(); }}>
            <div className="wm-profile-modal" onClick={e => e.stopPropagation()}>
              <h3>修改密码</h3>
              <Form form={pwdForm} layout="vertical">
                <Form.Item name="old_password" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}>
                  <Input.Password placeholder="当前密码" style={{ borderRadius: 12, height: 46 }} />
                </Form.Item>
                <Form.Item name="new_password" label="新密码" rules={[{ required: true }, { min: 6, message: '至少6位' }]}>
                  <Input.Password placeholder="6位以上新密码" style={{ borderRadius: 12, height: 46 }} />
                </Form.Item>
                <Form.Item name="confirm_password" label="确认密码" rules={[{ required: true }]}>
                  <Input.Password placeholder="再次输入新密码" style={{ borderRadius: 12, height: 46 }} />
                </Form.Item>
                <div style={{ display: 'flex', gap: 10 }}>
                  <Button onClick={() => { setShowPwd(false); pwdForm.resetFields(); }}
                    style={{ flex: 1, height: 46, borderRadius: 12 }}>取消</Button>
                  <Button type="primary" onClick={handleChangePassword} loading={pwdSaving}
                    style={{ flex: 1, height: 46, borderRadius: 12, fontWeight: 600 }}>确认修改</Button>
                </div>
              </Form>
            </div>
          </div>
        )}

        <style jsx global>{`
          .wm-profile { padding: 0 0 20px; }

          .wm-profile-hero {
            padding: 40px 24px 28px;
            text-align: center;
            position: relative;
            overflow: hidden;
            border-radius: 0 0 28px 28px;
            margin-bottom: 14px;
          }

          .wm-profile-hero-bg {
            position: absolute;
            top: -30px;
            right: -30px;
            width: 120px;
            height: 120px;
            border-radius: 50%;
            background: rgba(255,255,255,0.08);
          }

          .wm-profile-name {
            font-size: 24px;
            font-weight: 800;
            color: #fff;
            margin-top: 14px;
          }

          .wm-profile-role {
            font-size: 13px;
            color: rgba(255,255,255,0.7);
            margin-top: 4px;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 2px 12px;
            border-radius: 12px;
            background: rgba(255,255,255,0.15);
          }

          .wm-profile-stats {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 8px;
            padding: 0 16px;
            margin-bottom: 14px;
          }

          .wm-profile-stat-item {
            text-align: center;
            padding: 12px 4px;
            border-radius: 14px;
            background: var(--bg-card);
            border: 1px solid var(--border-1);
          }

          .wm-profile-stat-val {
            font-size: 18px;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
          }

          .wm-profile-stat-label {
            font-size: 10px;
            color: var(--text-4);
            margin-top: 2px;
          }

          .wm-profile-menu {
            margin: 0 16px 14px;
            border-radius: 16px;
            background: var(--bg-card);
            border: 1px solid var(--border-1);
            overflow: hidden;
          }

          .wm-profile-menu-item {
            display: flex;
            align-items: center;
            gap: 14px;
            padding: 16px 18px;
            cursor: pointer;
            -webkit-tap-highlight-color: transparent;
            transition: background 0.15s;
            border-bottom: 1px solid var(--border-2, rgba(0,0,0,0.04));
          }

          .wm-profile-menu-item:last-child { border-bottom: none; }
          .wm-profile-menu-item:active { background: rgba(0,0,0,0.02); }

          .wm-profile-menu-icon {
            width: 38px;
            height: 38px;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            flex-shrink: 0;
          }

          .wm-profile-menu-item span:nth-child(2) {
            flex: 1;
            font-size: 15px;
            font-weight: 500;
            color: var(--text-1);
          }

          .wm-profile-menu-arrow {
            font-size: 20px;
            color: var(--text-4);
          }

          .wm-profile-logout {
            display: block;
            width: calc(100% - 32px);
            margin: 0 16px;
            padding: 14px;
            border-radius: 14px;
            border: 1px solid rgba(255,77,79,0.2);
            background: rgba(255,77,79,0.04);
            color: #ff4d4f;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            -webkit-tap-highlight-color: transparent;
            text-align: center;
          }

          .wm-profile-logout:active { background: rgba(255,77,79,0.08); }

          .wm-profile-modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.5);
            z-index: 2000;
            display: flex;
            align-items: flex-end;
            justify-content: center;
            animation: wmFadeIn 0.2s ease;
          }

          .wm-profile-modal {
            width: 100%;
            max-width: 500px;
            background: var(--bg-card, #fff);
            border-radius: 24px 24px 0 0;
            padding: 24px 20px;
            padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px));
            animation: wmSlideUp 0.3s ease;
          }

          .wm-profile-modal h3 {
            font-size: 18px;
            font-weight: 700;
            color: var(--text-1);
            margin: 0 0 20px;
            text-align: center;
          }

          @keyframes wmFadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }

          @keyframes wmSlideUp {
            from { transform: translateY(100%); }
            to { transform: translateY(0); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* Profile Header Card */}
      <div style={{
        borderRadius: 'var(--radius-xl)', overflow: 'hidden', marginBottom: 22,
        background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)',
        border: '1px solid var(--glass-border)', boxShadow: 'var(--glass-shadow)',
      }}>
        <div style={{
          background: `linear-gradient(135deg, ${avatarBg} 0%, ${avatarBg}cc 50%, ${avatarBg}88 100%)`,
          padding: '36px 32px 28px', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', top: -40, right: -40, width: 160, height: 160, borderRadius: '50%', background: 'rgba(255,255,255,0.08)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', bottom: -30, left: '40%', width: 100, height: 100, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 20, position: 'relative', zIndex: 1 }}>
            <Avatar size={80} style={{
              background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)',
              fontSize: 32, fontWeight: 700, color: '#fff',
              border: '4px solid rgba(255,255,255,0.3)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            }}>
              {initial}
            </Avatar>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 10 }}>
                {profile?.real_name || profile?.username}
                {profile?.role === 'admin' && (
                  <Tag style={{
                    background: 'linear-gradient(135deg, #faad14, #ffc53d)', color: '#fff',
                    border: 'none', borderRadius: 10, fontSize: 11, padding: '0 10px',
                  }}>
                    <CrownOutlined style={{ marginRight: 3 }} />管理员
                  </Tag>
                )}
                {profile?.role === 'worker' && (
                  <Tag style={{
                    background: 'rgba(255,255,255,0.2)', color: '#fff',
                    border: '1px solid rgba(255,255,255,0.3)', borderRadius: 10, fontSize: 11, padding: '0 10px',
                  }}>
                    <ThunderboltOutlined style={{ marginRight: 3 }} />工人
                  </Tag>
                )}
              </div>
              <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span><UserOutlined style={{ marginRight: 4 }} />{profile?.username}</span>
                {profile?.phone && <span><PhoneOutlined style={{ marginRight: 4 }} />{profile.phone}</span>}
                {profile?.alipay_account && <span><AlipayCircleOutlined style={{ marginRight: 4 }} />{profile.alipay_account}</span>}
              </div>
            </div>
            {!editing && (
              <Button
                type="default" icon={<EditOutlined />}
                onClick={() => setEditing(true)}
                style={{
                  borderRadius: 10, height: 38,
                  background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.2)',
                  color: '#fff', fontWeight: 500,
                  backdropFilter: 'blur(8px)',
                }}
              >编辑资料</Button>
            )}
          </div>
        </div>

        {/* Stats Row — 工人显示本月数据，管理员显示总览 */}
        <div style={{ padding: '20px 32px' }}>
          {profile?.role === 'worker' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
              <CalendarOutlined style={{ color: '#1677ff', fontSize: 13 }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-2)' }}>
                本月绩效数据
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-4)', marginLeft: 4 }}>
                ({new Date().getFullYear()}年{new Date().getMonth() + 1}月)
              </span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {(profile?.role === 'worker' ? [
              { label: '本月产量', value: stats.month_production ?? 0, icon: <FireOutlined />, color: '#fa8c16' },
              { label: '本月标签', value: stats.month_labels ?? 0, icon: <PrinterOutlined />, color: '#1677ff' },
              { label: '本月出库', value: stats.month_outbound ?? 0, icon: <ExportOutlined />, color: '#52c41a' },
              { label: '本月出库率', value: `${stats.month_outbound_rate ?? 0}%`, icon: <RocketOutlined />, color: '#722ed1' },
              { label: '本月绩效', value: `¥${Number(stats.month_commission ?? 0).toFixed(0)}`, icon: <DollarOutlined />, color: '#eb2f96' },
              { label: '本月出勤', value: `${stats.month_working_days ?? 0}天`, icon: <CalendarOutlined />, color: '#13c2c2' },
            ] : [
              { label: '操作记录', value: stats.total_actions ?? 0, icon: <BarChartOutlined />, color: '#1677ff' },
              { label: '标签总数', value: stats.total_labels ?? 0, icon: <PrinterOutlined />, color: '#722ed1' },
              { label: '工人数', value: stats.total_workers ?? 0, icon: <TeamOutlined />, color: '#00b96b' },
              { label: '采购批次', value: stats.total_purchases ?? 0, icon: <AppstoreOutlined />, color: '#fa8c16' },
            ]).map((item, i) => (
              <div key={i} style={{
                flex: '1 1 100px', minWidth: 80, padding: '12px 10px', borderRadius: 12,
                background: `linear-gradient(135deg, ${item.color}08 0%, ${item.color}03 100%)`,
                border: `1px solid ${item.color}12`, textAlign: 'center',
                transition: 'all 0.3s',
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
              >
                <div style={{ color: item.color, fontSize: 16, marginBottom: 4 }}>{item.icon}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>
                  {typeof item.value === 'number' ? item.value.toLocaleString() : item.value}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Badges */}
      {Array.isArray(stats.badges) && stats.badges.length > 0 && (
        <div className="panel" style={{ marginBottom: 22 }}>
          <div className="panel-head">
            <span className="panel-title"><TrophyOutlined style={{ color: '#faad14' }} />成就徽章</span>
            <span style={{ fontSize: 11, color: 'var(--text-4)' }}>已解锁 {stats.badges.length} 个</span>
          </div>
          <div className="panel-body" style={{ padding: '12px 20px 16px' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {(stats.badges as any[]).map((badge: any, i: number) => (
                <Tooltip key={i} title={badge.desc}>
                  <div style={{
                    padding: '10px 16px', borderRadius: 14,
                    background: 'linear-gradient(135deg, rgba(250,173,20,0.06), rgba(255,215,0,0.03))',
                    border: '1px solid rgba(250,173,20,0.15)',
                    display: 'flex', alignItems: 'center', gap: 8,
                    cursor: 'default', transition: 'all 0.3s',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(250,173,20,0.15)'; }}
                    onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
                  >
                    <span style={{ fontSize: 22 }}>{badge.icon}</span>
                    <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{badge.name}</span>
                  </div>
                </Tooltip>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 累计数据（历史总览） */}
      {profile?.role === 'worker' && (
        <div className="panel" style={{ marginBottom: 22 }}>
          <div className="panel-head">
            <span className="panel-title"><BarChartOutlined style={{ color: '#8c8c8c' }} />累计数据</span>
            <span style={{ fontSize: 11, color: 'var(--text-4)' }}>历史总览</span>
          </div>
          <div className="panel-body" style={{ padding: '12px 20px 16px' }}>
            <Row gutter={[12, 12]}>
              {[
                { label: '累计产量', value: stats.total_production ?? 0, color: '#8c8c8c' },
                { label: '累计标签', value: stats.total_labels ?? 0, color: '#8c8c8c' },
                { label: '累计出库', value: stats.total_outbound ?? 0, color: '#8c8c8c' },
                { label: '累计绩效', value: `¥${Number(stats.total_commission ?? 0).toFixed(0)}`, color: '#8c8c8c' },
                { label: '累计出勤', value: `${stats.working_days ?? 0}天`, color: '#8c8c8c' },
                { label: 'SKU种类', value: stats.sku_count ?? 0, color: '#8c8c8c' },
              ].map((item, i) => (
                <Col xs={8} key={i}>
                  <div style={{
                    textAlign: 'center', padding: '14px 8px', borderRadius: 12,
                    background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.04)',
                  }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
                      {typeof item.value === 'number' ? item.value.toLocaleString() : item.value}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 2 }}>{item.label}</div>
                  </div>
                </Col>
              ))}
            </Row>
          </div>
        </div>
      )}

      <Row gutter={[16, 16]}>
        {/* Edit Form */}
        <Col xs={24} md={14}>
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">
                <UserOutlined style={{ color: '#1677ff' }} />
                {editing ? '编辑个人信息' : '个人信息'}
              </span>
              {editing && (
                <Button size="small" onClick={() => setEditing(false)} style={{ borderRadius: 8, fontSize: 12 }}>
                  取消
                </Button>
              )}
            </div>
            <div className="panel-body">
              {editing ? (
                <Form form={form} layout="vertical">
                  <Form.Item name="real_name" label="真实姓名" rules={[{ max: 50, message: '最多50个字符' }]}>
                    <Input placeholder="输入真实姓名" prefix={<UserOutlined />} maxLength={50}
                      style={{ borderRadius: 10, height: 42 }} />
                  </Form.Item>
                  <Form.Item name="phone" label="手机号" rules={[{ pattern: /^1[3-9]\d{9}$|^$/, message: '请输入正确手机号' }]}>
                    <Input placeholder="输入手机号" prefix={<PhoneOutlined />} maxLength={20}
                      style={{ borderRadius: 10, height: 42 }} />
                  </Form.Item>
                  <Form.Item name="alipay_account" label="支付宝账号" rules={[{ max: 100, message: '最多100个字符' }]}>
                    <Input placeholder="输入支付宝账号（手机号或邮箱）" prefix={<AlipayCircleOutlined />} maxLength={100}
                      style={{ borderRadius: 10, height: 42 }} />
                  </Form.Item>
                  <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}
                    style={{ borderRadius: 10, height: 42, fontWeight: 600, width: '100%', boxShadow: '0 4px 14px rgba(22,119,255,0.2)' }}>
                    保存修改
                  </Button>
                </Form>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {[
                    { label: '用户名', value: profile?.username, icon: <UserOutlined />, color: '#1677ff' },
                    { label: '真实姓名', value: profile?.real_name || '未设置', icon: <UserOutlined />, color: '#00b96b', dim: !profile?.real_name },
                    { label: '角色', value: profile?.role === 'admin' ? '管理员' : '工人', icon: <SafetyCertificateOutlined />, color: '#722ed1' },
                    { label: '手机号', value: profile?.phone || '未设置', icon: <PhoneOutlined />, color: '#fa8c16', dim: !profile?.phone },
                    { label: '支付宝', value: profile?.alipay_account || '未设置', icon: <AlipayCircleOutlined />, color: '#1677ff', dim: !profile?.alipay_account },
                  ].map((item, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                      borderRadius: 10, background: 'rgba(0,0,0,0.015)', border: '1px solid rgba(0,0,0,0.04)',
                      transition: 'all 0.2s',
                    }}>
                      <div style={{
                        width: 34, height: 34, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: `${item.color}10`, color: item.color, fontSize: 14, flexShrink: 0,
                      }}>{item.icon}</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{item.label}</div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: (item as any).dim ? 'var(--text-4)' : 'var(--text-1)' }}>
                          {item.value}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Col>

        {/* Security */}
        <Col xs={24} md={10}>
          <div className="panel" style={{ height: '100%' }}>
            <div className="panel-head">
              <span className="panel-title">
                <KeyOutlined style={{ color: '#722ed1' }} />
                安全设置
              </span>
            </div>
            <div className="panel-body">
              {!showPwd ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <div style={{
                    width: 60, height: 60, borderRadius: 16, margin: '0 auto 16px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'linear-gradient(135deg, rgba(114,46,209,0.08) 0%, rgba(22,119,255,0.05) 100%)',
                    color: '#722ed1', fontSize: 24,
                  }}>
                    <SafetyCertificateOutlined />
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)', marginBottom: 4 }}>
                    账户安全
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 20 }}>
                    定期修改密码可以提高账户安全性
                  </div>
                  <Button icon={<KeyOutlined />} onClick={() => setShowPwd(true)}
                    style={{ borderRadius: 10, height: 40, fontWeight: 500, width: '100%' }}>
                    修改密码
                  </Button>
                </div>
              ) : (
                <Form form={pwdForm} layout="vertical">
                  <Form.Item name="old_password" label="当前密码" rules={[{ required: true, message: '请输入当前密码' }]}>
                    <Input.Password placeholder="输入当前密码" maxLength={128}
                      style={{ borderRadius: 10, height: 40 }} />
                  </Form.Item>
                  <Form.Item name="new_password" label="新密码" rules={[{ required: true, message: '请输入新密码' }, { min: 6, message: '至少6位' }]}>
                    <Input.Password placeholder="6位以上新密码" maxLength={128}
                      style={{ borderRadius: 10, height: 40 }} />
                  </Form.Item>
                  <Form.Item name="confirm_password" label="确认新密码" rules={[{ required: true, message: '请确认新密码' }]}>
                    <Input.Password placeholder="再次输入新密码" maxLength={128}
                      style={{ borderRadius: 10, height: 40 }} />
                  </Form.Item>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button onClick={() => { setShowPwd(false); pwdForm.resetFields(); }}
                      style={{ flex: 1, borderRadius: 10, height: 40 }}>取消</Button>
                    <Button type="primary" onClick={handleChangePassword} loading={pwdSaving}
                      style={{ flex: 1, borderRadius: 10, height: 40, fontWeight: 600 }}>
                      确认修改
                    </Button>
                  </div>
                </Form>
              )}
            </div>
          </div>
        </Col>
      </Row>
    </div>
  );
}
