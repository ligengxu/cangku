'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Spin } from 'antd';

export default function Home() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('token');
    router.replace(token ? '/dashboard' : '/login');
    setReady(true);
  }, [router]);

  if (!ready) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }
  return null;
}
