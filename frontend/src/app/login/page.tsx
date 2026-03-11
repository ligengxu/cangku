'use client';

import { useState, useEffect } from 'react';
import { Form, Input, Button, Checkbox, message, Modal } from 'antd';
import { UserOutlined, LockOutlined, SafetyCertificateOutlined, ThunderboltOutlined, LineChartOutlined, WindowsOutlined, DownloadOutlined, DesktopOutlined } from '@ant-design/icons';
import { login } from '@/services/auth';
import { useAuth } from '@/stores/useAuth';
import { useRouter } from 'next/navigation';
import axios from 'axios';

interface ClientInfo {
  available: boolean;
  version: string;
  size?: string;
  filename?: string;
  update_time?: string;
  download_url?: string;
  message?: string;
}

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isWindows, setIsWindows] = useState(false);
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const setUser = useAuth(s => s.setUser);
  const router = useRouter();

  useEffect(() => {
    const check = () => {
      const w = window.innerWidth;
      const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      setIsMobile(w < 768 || (touch && w < 1024));
    };
    check();
    window.addEventListener('resize', check);

    const winCheck = /Windows/i.test(navigator.userAgent);
    setIsWindows(winCheck);

    if (winCheck) {
      axios.get('/api/download/client/info').then(res => {
        if (res.data?.success) setClientInfo(res.data.data);
      }).catch(() => {});
    }

    return () => window.removeEventListener('resize', check);
  }, []);

  const onFinish = async (v: any) => {
    setLoading(true);
    try {
      const user = await login(v.username, v.password, v.remember);
      setUser(user);
      message.success('登录成功');

      if (isWindows && clientInfo?.available && !localStorage.getItem('client_download_dismissed')) {
        setShowDownloadModal(true);
        setTimeout(() => {
          if (user.role === 'worker') {
            router.push('/production/request');
          } else {
            router.push('/dashboard');
          }
        }, 100);
      } else {
        if (user.role === 'worker') {
          router.push('/production/request');
        } else {
          router.push('/dashboard');
        }
      }
    } catch (e: any) {
      const errMsg = e?.response?.data?.detail ?? (e?.code === 'ECONNABORTED' || e?.message?.includes?.('timeout') ? '请求超时，请检查网络' : e?.message || '登录失败，请检查账号密码');
      message.error(typeof errMsg === 'string' ? errMsg : '登录失败，请检查账号密码');
    } finally { setLoading(false); }
  };

  const handleDownload = () => {
    if (clientInfo?.download_url) {
      window.open(clientInfo.download_url, '_blank');
    }
    setShowDownloadModal(false);
  };

  const handleDismissDownload = () => {
    localStorage.setItem('client_download_dismissed', '1');
    setShowDownloadModal(false);
  };

  const features = [
    { t: 'SKU 全流程追溯', d: '标签打印 · 扫码出库 · 校验', icon: <SafetyCertificateOutlined />, c: '#69b1ff' },
    { t: '多工人协同作业', d: '批次分配 · 实时统计 · 考核', icon: <ThunderboltOutlined />, c: '#b37feb' },
    { t: '经营数据分析', d: '采购成本 · 损耗监控 · 走势', icon: <LineChartOutlined />, c: '#ff85c0' },
  ];

  if (isMobile) {
    return (
      <div className="login-mobile-root">
        <div className="login-mobile-bg">
          <div className="login-mobile-orb1" />
          <div className="login-mobile-orb2" />
          <div className="login-mobile-orb3" />
        </div>

        <div className="login-mobile-container">
          <div className="login-mobile-header">
            <div className="login-mobile-logo">
              <span className="login-mobile-logo-text">果</span>
            </div>
            <h1 className="login-mobile-title">果管系统</h1>
            <p className="login-mobile-subtitle">高效仓储生产管理平台</p>
          </div>

          <div className="login-mobile-card login-form-area">
            <div className="login-mobile-welcome">
              <h2>欢迎回来</h2>
              <p>请输入账号和密码登录</p>
            </div>

            <Form onFinish={onFinish} autoComplete="off" layout="vertical">
              <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
                <Input
                  prefix={<UserOutlined style={{ color: focused === 'user' ? '#4d6bfe' : 'rgba(255,255,255,0.25)', transition: 'color 0.3s', fontSize: 17 }} />}
                  placeholder="用户名"
                  maxLength={64}
                  size="large"
                  onFocus={() => setFocused('user')}
                  onBlur={() => setFocused(null)}
                />
              </Form.Item>

              <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
                <Input.Password
                  prefix={<LockOutlined style={{ color: focused === 'pass' ? '#4d6bfe' : 'rgba(255,255,255,0.25)', transition: 'color 0.3s', fontSize: 17 }} />}
                  placeholder="密码"
                  maxLength={128}
                  size="large"
                  onFocus={() => setFocused('pass')}
                  onBlur={() => setFocused(null)}
                />
              </Form.Item>

              <Form.Item name="remember" valuePropName="checked" style={{ marginBottom: 24 }}>
                <Checkbox>
                  <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14 }}>7 天免登录</span>
                </Checkbox>
              </Form.Item>

              <Form.Item style={{ marginBottom: 0 }}>
                <Button type="primary" htmlType="submit" block loading={loading}
                  className="login-mobile-btn"
                  style={{
                    height: 52, fontSize: 16, fontWeight: 700, borderRadius: 16, border: 'none',
                    background: 'linear-gradient(135deg, #1677ff 0%, #4d6bfe 50%, #722ed1 100%)',
                    boxShadow: '0 8px 32px rgba(22,119,255,0.35)',
                    letterSpacing: 3,
                  }}>
                  {loading ? '登录中...' : '登 录'}
                </Button>
              </Form.Item>
            </Form>
          </div>

          <div className="login-mobile-footer">
            v3.0 · 安全加密传输
          </div>
        </div>

        <style jsx global>{`
          .login-mobile-root {
            min-height: 100vh;
            min-height: 100dvh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(160deg, #0a0e27 0%, #141937 35%, #1a2248 65%, #0d1130 100%);
            position: relative;
            overflow: hidden;
            padding: 0;
            color-scheme: dark;
          }

          .login-mobile-bg {
            position: absolute;
            top: 0; right: 0; bottom: 0; left: 0;
            pointer-events: none;
          }

          .login-mobile-orb1 {
            position: absolute;
            top: -10%;
            left: -20%;
            width: 300px;
            height: 300px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(22,119,255,0.12) 0%, transparent 60%);
            animation: mOrb1 12s ease-in-out infinite;
          }

          .login-mobile-orb2 {
            position: absolute;
            bottom: 5%;
            right: -15%;
            width: 250px;
            height: 250px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(114,46,209,0.08) 0%, transparent 60%);
            animation: mOrb2 10s ease-in-out infinite;
          }

          .login-mobile-orb3 {
            position: absolute;
            top: 40%;
            right: 10%;
            width: 150px;
            height: 150px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(22,119,255,0.05) 0%, transparent 60%);
            animation: mOrb1 15s ease-in-out infinite reverse;
          }

          @keyframes mOrb1 {
            0%, 100% { transform: translate(0, 0) scale(1); }
            50% { transform: translate(20px, -25px) scale(1.08); }
          }

          @keyframes mOrb2 {
            0%, 100% { transform: translate(0, 0) scale(1); }
            50% { transform: translate(-15px, 20px) scale(1.05); }
          }

          .login-mobile-container {
            position: relative;
            z-index: 1;
            width: 100%;
            max-width: 400px;
            padding: 40px 24px;
            padding-top: max(40px, env(safe-area-inset-top, 40px));
            padding-bottom: max(24px, env(safe-area-inset-bottom, 24px));
            display: flex;
            flex-direction: column;
            align-items: center;
            min-height: 100dvh;
            justify-content: center;
          }

          .login-mobile-header {
            text-align: center;
            margin-bottom: 36px;
            animation: loginFadeIn 0.6s ease-out;
          }

          .login-mobile-logo {
            width: 72px;
            height: 72px;
            border-radius: 22px;
            background: linear-gradient(135deg, rgba(22,119,255,0.35) 0%, rgba(114,46,209,0.25) 100%);
            border: 1.5px solid rgba(255,255,255,0.15);
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 20px;
            box-shadow: 0 16px 48px rgba(22,119,255,0.2);
            animation: loginFloat 5s ease-in-out infinite;
          }

          .login-mobile-logo-text {
            font-size: 34px;
            color: #fff;
            font-weight: 800;
          }

          .login-mobile-title {
            font-size: 28px;
            font-weight: 800;
            color: rgba(255,255,255,0.95);
            letter-spacing: 3px;
            margin: 0 0 8px;
          }

          .login-mobile-subtitle {
            font-size: 13px;
            color: rgba(255,255,255,0.35);
            letter-spacing: 4px;
            margin: 0;
          }

          .login-mobile-card {
            width: 100%;
            padding: 28px 24px;
            border-radius: 24px;
            background: linear-gradient(160deg, rgba(15,19,42,0.95) 0%, rgba(20,25,55,0.96) 50%, rgba(13,17,48,0.95) 100%);
            border: 1px solid rgba(255,255,255,0.08);
            -webkit-backdrop-filter: blur(40px);
            backdrop-filter: blur(40px);
            box-shadow: 0 24px 64px rgba(0,0,0,0.3);
            animation: loginSlideUp 0.5s ease-out 0.15s both;
          }

          .login-mobile-welcome h2 {
            font-size: 22px;
            font-weight: 700;
            color: rgba(255,255,255,0.95);
            margin: 0 0 6px;
          }

          .login-mobile-welcome p {
            font-size: 14px;
            color: rgba(255,255,255,0.35);
            margin: 0 0 28px;
          }

          .login-mobile-footer {
            margin-top: 32px;
            font-size: 11px;
            color: rgba(255,255,255,0.12);
            text-align: center;
            animation: loginFadeIn 0.6s ease-out 0.3s both;
          }

          @keyframes loginFadeIn {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
          }

          @keyframes loginSlideUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }

          @keyframes loginFloat {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-8px); }
          }

          /* Mobile form input styles */
          .login-mobile-card .ant-input-affix-wrapper,
          .login-mobile-card .ant-input-affix-wrapper.ant-input-affix-wrapper-lg {
            height: 54px !important;
            border-radius: 16px !important;
            background: rgba(255,255,255,0.05) !important;
            border: 1.5px solid rgba(255,255,255,0.1) !important;
            color: rgba(255,255,255,0.92) !important;
            font-size: 15px !important;
            padding: 0 18px !important;
            transition: all 0.3s cubic-bezier(0.4,0,0.2,1) !important;
            box-shadow: none !important;
          }

          .login-mobile-card .ant-input-affix-wrapper .ant-input {
            height: auto !important;
            border: none !important;
            background: transparent !important;
            padding: 0 !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            color: rgba(255,255,255,0.92) !important;
            font-size: 15px !important;
          }

          .login-mobile-card .ant-input::placeholder,
          .login-mobile-card .ant-input-affix-wrapper .ant-input::placeholder {
            color: rgba(255,255,255,0.22) !important;
            font-size: 15px !important;
          }

          .login-mobile-card .ant-input-affix-wrapper:focus-within {
            border-color: rgba(77,107,254,0.55) !important;
            background: rgba(77,107,254,0.06) !important;
            box-shadow: 0 0 0 3px rgba(77,107,254,0.12) !important;
          }

          .login-mobile-card .ant-input-prefix {
            margin-inline-end: 14px !important;
          }

          .login-mobile-card .ant-input-password .ant-input-suffix .anticon {
            color: rgba(255,255,255,0.25) !important;
            font-size: 18px !important;
          }

          .login-mobile-card .ant-checkbox-inner {
            background: rgba(255,255,255,0.06) !important;
            border-color: rgba(255,255,255,0.15) !important;
            border-radius: 5px !important;
            width: 20px !important;
            height: 20px !important;
          }

          .login-mobile-card .ant-checkbox-checked .ant-checkbox-inner {
            background: linear-gradient(135deg, #1677ff, #4d6bfe) !important;
            border-color: #4d6bfe !important;
          }

          .login-mobile-card .ant-form-item-explain-error {
            color: #ff7875 !important;
            font-size: 12px !important;
            margin-top: 6px !important;
          }

          .login-mobile-card input:-webkit-autofill,
          .login-mobile-card input:-webkit-autofill:hover,
          .login-mobile-card input:-webkit-autofill:focus,
          .login-mobile-card input:-webkit-autofill:active,
          .login-mobile-card .ant-input:-webkit-autofill {
            -webkit-box-shadow: 0 0 0 9999px #0f1328 inset !important;
            box-shadow: 0 0 0 9999px #0f1328 inset !important;
            -webkit-text-fill-color: #e8e8f0 !important;
            caret-color: #e8e8f0 !important;
            background-color: #0f1328 !important;
            color: #e8e8f0 !important;
            transition: background-color 600000s 0s, color 600000s 0s !important;
          }

          .login-mobile-btn:active:not(:disabled) {
            transform: scale(0.98) !important;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(140deg, #0a0e27 0%, #141937 40%, #1a2248 70%, #0d1130 100%)',
      position: 'relative', overflow: 'hidden',
      colorScheme: 'dark',
    }}>
      {/* Ambient orbs */}
      <div style={{
        position: 'absolute', top: '15%', left: '10%', width: 400, height: 400, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(22,119,255,0.07) 0%, transparent 60%)',
        animation: 'loginOrb1 18s ease-in-out infinite', pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '10%', right: '8%', width: 350, height: 350, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(114,46,209,0.05) 0%, transparent 60%)',
        animation: 'loginOrb2 14s ease-in-out infinite', pointerEvents: 'none',
      }} />

      <div style={{
        display: 'flex', width: '100%', maxWidth: 900, minHeight: 520,
        borderRadius: 24, overflow: 'hidden', margin: 20, position: 'relative', zIndex: 1,
        background: 'linear-gradient(160deg, rgba(15,19,42,0.97) 0%, rgba(20,25,55,0.98) 50%, rgba(13,17,48,0.97) 100%)',
        border: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03) inset',
        WebkitBackdropFilter: 'blur(40px)',
        backdropFilter: 'blur(40px)',
      }}>
        {/* ── 左侧品牌面板 ── */}
        <div className="login-brand" style={{
          width: 380, minWidth: 380, maxWidth: 380, flexShrink: 0,
          background: 'linear-gradient(165deg, rgba(16,22,50,0.98) 0%, rgba(20,28,60,0.98) 50%, rgba(14,18,45,0.98) 100%)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          padding: '56px 40px', position: 'relative', overflow: 'hidden',
          borderRight: '1px solid rgba(255,255,255,0.04)',
        }}>
          <div style={{
            position: 'absolute', top: -80, right: -80, width: 200, height: 200, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(22,119,255,0.06) 0%, transparent 70%)',
          }} />
          <div style={{
            position: 'absolute', bottom: -40, left: -40, width: 140, height: 140, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(114,46,209,0.04) 0%, transparent 70%)',
          }} />

          <div style={{
            width: 64, height: 64, borderRadius: 18,
            background: 'linear-gradient(135deg, rgba(22,119,255,0.3) 0%, rgba(114,46,209,0.2) 100%)',
            border: '1px solid rgba(255,255,255,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 28, boxShadow: '0 12px 40px rgba(22,119,255,0.15)',
            animation: 'loginFloat 5s ease-in-out infinite',
          }}>
            <span style={{ fontSize: 28, color: '#fff', fontWeight: 800 }}>果</span>
          </div>

          <div style={{ fontSize: 26, fontWeight: 800, marginBottom: 8, color: 'rgba(255,255,255,0.93)', letterSpacing: 2 }}>
            果管系统
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginBottom: 44, letterSpacing: 4 }}>
            高效仓储生产管理平台
          </div>

          <div style={{ width: '100%', maxWidth: 270 }}>
            {features.map((f, i) => (
              <div key={i} className="login-feat" style={{
                display: 'flex', gap: 14, marginBottom: 10, padding: '13px 16px',
                borderRadius: 14, background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.04)', transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)',
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                  background: `linear-gradient(135deg, ${f.c}18, ${f.c}08)`,
                  border: `1px solid ${f.c}15`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 15, color: f.c,
                }}>
                  {f.icon}
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 }}>{f.t}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)', marginTop: 1 }}>{f.d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── 右侧登录表单 ── */}
        <div className="login-form-area" style={{
          flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '56px 48px',
        }}>
          <div style={{ width: '100%', maxWidth: 320 }}>
            <div style={{ marginBottom: 44 }}>
              <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 10, color: 'rgba(255,255,255,0.95)' }}>
                欢迎回来
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', lineHeight: 1.6 }}>
                请输入账号和密码登录系统
              </div>
            </div>

            <Form onFinish={onFinish} autoComplete="off" layout="vertical">
              <div style={{ marginBottom: 22 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 8, letterSpacing: 0.5 }}>
                  用户名
                </div>
                <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]} style={{ marginBottom: 0 }}>
                  <Input
                    prefix={<UserOutlined style={{ color: focused === 'user' ? '#4d6bfe' : 'rgba(255,255,255,0.2)', transition: 'color 0.3s', fontSize: 15 }} />}
                    placeholder="请输入用户名"
                    maxLength={64}
                    onFocus={() => setFocused('user')}
                    onBlur={() => setFocused(null)}
                  />
                </Form.Item>
              </div>

              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginBottom: 8, letterSpacing: 0.5 }}>
                  密码
                </div>
                <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]} style={{ marginBottom: 0 }}>
                  <Input.Password
                    prefix={<LockOutlined style={{ color: focused === 'pass' ? '#4d6bfe' : 'rgba(255,255,255,0.2)', transition: 'color 0.3s', fontSize: 15 }} />}
                    placeholder="请输入密码"
                    maxLength={128}
                    onFocus={() => setFocused('pass')}
                    onBlur={() => setFocused(null)}
                  />
                </Form.Item>
              </div>

              <Form.Item name="remember" valuePropName="checked" style={{ marginBottom: 32 }}>
                <Checkbox>
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>7 天免登录</span>
                </Checkbox>
              </Form.Item>

              <Form.Item style={{ marginBottom: 0 }}>
                <Button type="primary" htmlType="submit" block loading={loading}
                  style={{
                    height: 48, fontSize: 15, fontWeight: 700, borderRadius: 14, border: 'none',
                    background: 'linear-gradient(135deg, #1677ff 0%, #4d6bfe 50%, #722ed1 100%)',
                    boxShadow: '0 8px 28px rgba(22,119,255,0.3), 0 0 0 1px rgba(255,255,255,0.06) inset',
                    letterSpacing: 2,
                  }}>
                  {loading ? '登录中...' : '登 录'}
                </Button>
              </Form.Item>
            </Form>

            <div style={{ textAlign: 'center', marginTop: 40, fontSize: 11, color: 'rgba(255,255,255,0.12)' }}>
              v3.0 · 安全加密传输
            </div>

            {isWindows && clientInfo?.available && (
              <div
                className="client-download-hint"
                onClick={() => handleDownload()}
                style={{
                  marginTop: 20, padding: '12px 16px', borderRadius: 12, cursor: 'pointer',
                  background: 'linear-gradient(135deg, rgba(22,119,255,0.08) 0%, rgba(114,46,209,0.06) 100%)',
                  border: '1px solid rgba(22,119,255,0.15)',
                  display: 'flex', alignItems: 'center', gap: 10,
                  transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)',
                }}
              >
                <div style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: 'linear-gradient(135deg, #1677ff 0%, #722ed1 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <WindowsOutlined style={{ color: '#fff', fontSize: 15 }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.75)' }}>
                    下载 Windows 客户端
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 1 }}>
                    v{clientInfo.version} · {clientInfo.size} · 独立桌面应用
                  </div>
                </div>
                <DownloadOutlined style={{ color: 'rgba(255,255,255,0.3)', fontSize: 14 }} />
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal
        open={showDownloadModal}
        onCancel={() => setShowDownloadModal(false)}
        footer={null}
        centered
        width={420}
        closable={false}
        className="download-modal"
        styles={{
          content: {
            background: 'linear-gradient(160deg, #141937 0%, #1a2248 50%, #0d1130 100%)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 20,
            padding: '32px 28px',
            boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
          },
          mask: { backdropFilter: 'blur(8px)', background: 'rgba(0,0,0,0.5)' },
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 64, height: 64, borderRadius: 18, margin: '0 auto 20px',
            background: 'linear-gradient(135deg, rgba(22,119,255,0.25) 0%, rgba(114,46,209,0.2) 100%)',
            border: '1px solid rgba(255,255,255,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 12px 40px rgba(22,119,255,0.15)',
          }}>
            <DesktopOutlined style={{ fontSize: 28, color: '#69b1ff' }} />
          </div>

          <h3 style={{ fontSize: 20, fontWeight: 700, color: 'rgba(255,255,255,0.95)', margin: '0 0 8px' }}>
            Windows 桌面客户端
          </h3>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', margin: '0 0 24px', lineHeight: 1.6 }}>
            检测到您正在使用 Windows 系统，推荐下载桌面客户端获得更好的体验
          </p>

          <div style={{
            padding: '14px 16px', borderRadius: 12, marginBottom: 24,
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
            display: 'flex', justifyContent: 'space-between', fontSize: 12,
          }}>
            <span style={{ color: 'rgba(255,255,255,0.35)' }}>版本 v{clientInfo?.version}</span>
            <span style={{ color: 'rgba(255,255,255,0.35)' }}>{clientInfo?.size}</span>
            <span style={{ color: 'rgba(255,255,255,0.35)' }}>{clientInfo?.update_time}</span>
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            <Button
              block
              onClick={handleDismissDownload}
              style={{
                height: 44, borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.5)',
                fontSize: 14, fontWeight: 500,
              }}
            >
              不再提示
            </Button>
            <Button
              type="primary"
              block
              icon={<DownloadOutlined />}
              onClick={handleDownload}
              style={{
                height: 44, borderRadius: 12, border: 'none',
                background: 'linear-gradient(135deg, #1677ff 0%, #4d6bfe 50%, #722ed1 100%)',
                boxShadow: '0 8px 24px rgba(22,119,255,0.3)',
                fontSize: 14, fontWeight: 600,
              }}
            >
              立即下载
            </Button>
          </div>
        </div>
      </Modal>

      <style jsx global>{`
        @keyframes loginOrb1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(25px, -35px) scale(1.05); }
        }
        @keyframes loginOrb2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-20px, 25px) scale(1.03); }
        }
        @keyframes loginFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
        }

        .login-feat:hover {
          background: rgba(255,255,255,0.05) !important;
          border-color: rgba(255,255,255,0.1) !important;
          transform: translateX(4px);
        }

        .login-form-area .ant-input-affix-wrapper,
        .login-form-area .ant-input-affix-wrapper.ant-input-affix-wrapper,
        .login-form-area .ant-input-affix-wrapper.ant-input-affix-wrapper-lg {
          height: 50px !important;
          border-radius: 14px !important;
          background: rgba(255,255,255,0.04) !important;
          border: 1.5px solid rgba(255,255,255,0.08) !important;
          color: rgba(255,255,255,0.92) !important;
          font-size: 14px !important;
          padding: 0 18px !important;
          transition: all 0.3s cubic-bezier(0.4,0,0.2,1) !important;
          box-shadow: none !important;
          outline: none !important;
        }

        .login-form-area .ant-input,
        .login-form-area .ant-input.ant-input,
        .login-form-area .ant-input.ant-input-lg {
          height: 50px !important;
          border-radius: 14px !important;
          background: rgba(255,255,255,0.04) !important;
          border: 1.5px solid rgba(255,255,255,0.08) !important;
          color: rgba(255,255,255,0.92) !important;
          font-size: 14px !important;
          padding: 0 18px !important;
          transition: all 0.3s cubic-bezier(0.4,0,0.2,1) !important;
          box-shadow: none !important;
          outline: none !important;
        }

        .login-form-area .ant-input-affix-wrapper .ant-input,
        .login-form-area .ant-input-affix-wrapper .ant-input.ant-input {
          height: auto !important;
          border: none !important;
          background: transparent !important;
          padding: 0 !important;
          box-shadow: none !important;
          outline: none !important;
          border-radius: 0 !important;
        }

        /* Autofill override for dark theme — must use hex color, not rgba */
        .login-form-area input:-webkit-autofill,
        .login-form-area input:-webkit-autofill:hover,
        .login-form-area input:-webkit-autofill:focus,
        .login-form-area input:-webkit-autofill:active,
        .login-form-area .ant-input:-webkit-autofill,
        .login-form-area .ant-input-affix-wrapper .ant-input:-webkit-autofill {
          -webkit-box-shadow: 0 0 0 9999px #0f1328 inset !important;
          box-shadow: 0 0 0 9999px #0f1328 inset !important;
          -webkit-text-fill-color: #e8e8f0 !important;
          caret-color: #e8e8f0 !important;
          background-color: #0f1328 !important;
          color: #e8e8f0 !important;
          transition: background-color 600000s 0s, color 600000s 0s !important;
        }

        .login-form-area .ant-input::placeholder,
        .login-form-area .ant-input-affix-wrapper .ant-input::placeholder {
          color: rgba(255,255,255,0.2) !important;
          font-size: 14px !important;
        }

        .login-form-area .ant-input-affix-wrapper:hover,
        .login-form-area .ant-input:hover:not(.ant-input-affix-wrapper .ant-input) {
          border-color: rgba(77,107,254,0.35) !important;
          background: rgba(255,255,255,0.06) !important;
          box-shadow: none !important;
        }

        .login-form-area .ant-input-affix-wrapper-focused,
        .login-form-area .ant-input-affix-wrapper:focus,
        .login-form-area .ant-input-affix-wrapper:focus-within,
        .login-form-area .ant-input-affix-wrapper-focused.ant-input-affix-wrapper-focused {
          border-color: rgba(77,107,254,0.55) !important;
          background: rgba(77,107,254,0.05) !important;
          box-shadow: 0 0 0 3px rgba(77,107,254,0.12), 0 4px 20px rgba(77,107,254,0.08) !important;
          outline: none !important;
        }

        .login-form-area .ant-input:focus:not(.ant-input-affix-wrapper .ant-input),
        .login-form-area .ant-input-focused:not(.ant-input-affix-wrapper .ant-input) {
          border-color: rgba(77,107,254,0.55) !important;
          background: rgba(77,107,254,0.05) !important;
          box-shadow: 0 0 0 3px rgba(77,107,254,0.12), 0 4px 20px rgba(77,107,254,0.08) !important;
          outline: none !important;
        }

        .login-form-area .ant-input-password .ant-input-suffix .anticon {
          color: rgba(255,255,255,0.2) !important;
          font-size: 16px !important;
          transition: color 0.3s !important;
          cursor: pointer;
        }
        .login-form-area .ant-input-password .ant-input-suffix .anticon:hover {
          color: rgba(255,255,255,0.5) !important;
        }

        .login-form-area .ant-input-prefix {
          margin-inline-end: 12px !important;
        }

        .login-form-area .ant-checkbox-inner {
          background: rgba(255,255,255,0.06) !important;
          border-color: rgba(255,255,255,0.15) !important;
          border-radius: 5px !important;
          width: 18px !important;
          height: 18px !important;
        }
        .login-form-area .ant-checkbox-checked .ant-checkbox-inner {
          background: linear-gradient(135deg, #1677ff, #4d6bfe) !important;
          border-color: #4d6bfe !important;
        }

        .login-form-area .ant-form-item-explain-error {
          color: #ff7875 !important;
          font-size: 12px !important;
          margin-top: 6px !important;
        }

        .login-form-area .ant-btn-primary:hover:not(:disabled) {
          transform: translateY(-1px) !important;
          box-shadow: 0 12px 36px rgba(22,119,255,0.4), 0 0 0 1px rgba(255,255,255,0.08) inset !important;
        }
        .login-form-area .ant-btn-primary:active:not(:disabled) {
          transform: translateY(0) !important;
        }

        .client-download-hint:hover {
          background: linear-gradient(135deg, rgba(22,119,255,0.14) 0%, rgba(114,46,209,0.1) 100%) !important;
          border-color: rgba(22,119,255,0.3) !important;
          transform: translateY(-1px);
          box-shadow: 0 4px 16px rgba(22,119,255,0.15);
        }

        @media (max-width: 767px) {
          .login-brand { display: none !important; }
          .login-form-area { padding: 40px 28px !important; }
        }
      `}</style>
    </div>
  );
}
