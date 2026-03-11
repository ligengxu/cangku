'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated } from '@/services/auth';
import { Spin } from 'antd';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const ok = isAuthenticated();
    if (!ok) {
      router.replace('/login');
    } else {
      setAuthed(true);
    }
    setChecked(true);
  }, [router]);

  if (!checked || !authed) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  return <>{children}</>;
}
