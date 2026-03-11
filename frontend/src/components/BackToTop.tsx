'use client';

import { useState, useEffect } from 'react';
import { Button } from 'antd';
import { UpOutlined } from '@ant-design/icons';

export default function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!visible) return null;

  return (
    <Button
      type="primary"
      icon={<UpOutlined />}
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      style={{
        position: 'fixed',
        bottom: 32,
        right: 32,
        zIndex: 999,
        width: 44,
        height: 44,
        borderRadius: 12,
        boxShadow: '0 6px 24px rgba(22,119,255,0.35)',
        background: 'linear-gradient(135deg, #1677ff 0%, #722ed1 100%)',
        border: 'none',
        animation: 'backToTopIn 0.3s ease-out',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-4px) scale(1.05)';
        e.currentTarget.style.boxShadow = '0 10px 32px rgba(22,119,255,0.45)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = '';
        e.currentTarget.style.boxShadow = '0 6px 24px rgba(22,119,255,0.35)';
      }}
    />
  );
}
