'use client';

import AuthGuard from '@/components/AuthGuard';
import AdminLayout from '@/components/AdminLayout';
import WorkerMobileLayout from '@/components/WorkerMobileLayout';
import { useDevice } from '@/hooks/useDevice';
import { useAuth } from '@/stores/useAuth';

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const { isMobile } = useDevice();
  const { user } = useAuth();
  const isWorkerMobile = isMobile && user?.role === 'worker';

  return (
    <AuthGuard>
      {isWorkerMobile ? (
        <WorkerMobileLayout>{children}</WorkerMobileLayout>
      ) : (
        <AdminLayout>{children}</AdminLayout>
      )}
    </AuthGuard>
  );
}
