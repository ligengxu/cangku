'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Table, Button, Space, Tag, message, Modal, Tooltip, Row, Col, Avatar,
  Select, DatePicker, Form, Drawer, Descriptions, Divider, Badge, Switch,
  Timeline, InputNumber, Input,
} from 'antd';
import {
  CheckOutlined, CloseOutlined, AuditOutlined, ClockCircleOutlined,
  CheckCircleOutlined, CloseCircleOutlined, FileTextOutlined, ReloadOutlined,
  SearchOutlined, UserOutlined, FilterOutlined, EyeOutlined, DownloadOutlined,
  BarChartOutlined, RiseOutlined, EditOutlined, HistoryOutlined,
  SwapOutlined, BellOutlined, RobotOutlined, RollbackOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dayjs from 'dayjs';
import { exportToCsv } from '@/utils/exportCsv';

const STATUS_MAP: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: '待审核', color: 'warning', icon: <ClockCircleOutlined /> },
  approved: { label: '已通过', color: 'success', icon: <CheckCircleOutlined /> },
  rejected: { label: '已驳回', color: 'error', icon: <CloseCircleOutlined /> },
};

interface AuditStats {
  pending: number;
  approved: number;
  rejected: number;
  today_pending: number;
  today_approved: number;
  total_qty_pending: number;
  pending_edits: number;
  today_pending_edits: number;
  daily_trend: { date: string; count: number; qty: number }[];
  top_pending_workers: { worker_id: number; name: string; qty: number; count: number }[];
}

type ViewMode = 'production' | 'edits';

export default function ProductionAuditPage() {
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [tab, setTab] = useState('pending');
  const [viewMode, setViewMode] = useState<ViewMode>('production');
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [workers, setWorkers] = useState<{ id: number; name: string }[]>([]);
  const [skus, setSkus] = useState<{ id: number; name: string }[]>([]);
  const [stats, setStats] = useState<AuditStats | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRecord, setDetailRecord] = useState<any>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filterForm] = Form.useForm();
  const [batchLoading, setBatchLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const autoRefreshRef = useRef(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyData, setHistoryData] = useState<any>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [aiAdvice, setAiAdvice] = useState('');
  const [aiAdviceLoading, setAiAdviceLoading] = useState(false);
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [approveTarget, setApproveTarget] = useState<any>(null);
  const [adjustedQty, setAdjustedQty] = useState<number | null>(null);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<{ id: number; isBatch: boolean; ids?: number[] } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [changesMap, setChangesMap] = useState<Record<number, { has_edits: boolean; edit_count: number; has_pending: boolean }>>({});
  const [smartScan, setSmartScan] = useState<any>(null);
  const [smartScanLoading, setSmartScanLoading] = useState(false);
  const [autoApproveLoading, setAutoApproveLoading] = useState(false);
  const [showSmartPanel, setShowSmartPanel] = useState(false);
  const [efficiency, setEfficiency] = useState<any>(null);

  const fetchAIAdvice = async (record: any) => {
    setAiAdvice(''); setAiAdviceLoading(true);
    const msg = `审核以下生产记录：工人=${record.worker_name}, SKU=${record.sku_name}, 日期=${record.production_date}, 打印量=${record.printed_quantity}, 实际包装量=${record.actual_packaging_quantity}。请分析合理性并给出审核建议。`;
    try {
      const response = await fetch('/api/ai/audit-advice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
        body: JSON.stringify({ message: msg, history: [], stream: true }),
      });
      const reader = response.body?.getReader();
      if (!reader) return;
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
        setAiAdvice(acc);
      }
    } catch { setAiAdvice('AI 建议不可用'); }
    finally { setAiAdviceLoading(false); }
  };

  const [filters, setFilters] = useState({
    page: 1, page_size: 20, worker_id: undefined as number | undefined,
    sku_id: undefined as number | undefined,
    start_date: '', end_date: '',
  });

  useEffect(() => {
    const loadMaps = async () => {
      try {
        const [wRes, sRes] = await Promise.all([
          api.get('/workers', { params: { page: 1, page_size: 500 } }).catch(() => ({ data: { data: [] } })),
          api.get('/inventory/sku').catch(() => ({ data: { data: [] } })),
        ]);
        const wList = (wRes.data as any)?.data ?? wRes.data ?? [];
        const sList = (sRes.data as any)?.data ?? sRes.data ?? [];
        const wArr = Array.isArray(wList) ? wList : [];
        const sArr = Array.isArray(sList) ? sList : [];
        setWorkers(wArr.map((w: any) => ({ id: w.id, name: w.real_name || w.username })));
        setSkus(sArr.map((s: any) => ({ id: s.id, name: s.sku_name })));
      } catch { /* optional */ }
    };
    loadMaps();
  }, []);

  const fetchRecords = useCallback(async () => {
    try {
      setLoading(true);
      if (viewMode === 'production') {
        const params: Record<string, any> = { page: filters.page, page_size: filters.page_size, status: tab };
        if (filters.worker_id) params.worker_id = filters.worker_id;
        if (filters.sku_id) params.sku_id = filters.sku_id;
        if (filters.start_date) params.start_date = filters.start_date;
        if (filters.end_date) params.end_date = filters.end_date;
        const res = await api.get('/production/audit', { params });
        const d = res.data?.data ?? res.data ?? [];
        setRecords(Array.isArray(d) ? d : []);
        setTotal(res.data?.total ?? 0);
      } else {
        const params: Record<string, any> = { page: filters.page, page_size: filters.page_size, status: tab };
        if (filters.worker_id) params.worker_id = filters.worker_id;
        if (filters.sku_id) params.sku_id = filters.sku_id;
        if (filters.start_date) params.start_date = filters.start_date;
        if (filters.end_date) params.end_date = filters.end_date;
        const res = await api.get('/production/edit-requests', { params });
        const d = res.data?.data ?? res.data ?? [];
        setRecords(Array.isArray(d) ? d : []);
        setTotal(res.data?.total ?? 0);
      }
    } catch { message.error('加载失败'); setRecords([]); setTotal(0); }
    finally { setLoading(false); setSelectedKeys([]); }
  }, [tab, filters, viewMode]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get('/production/audit/stats');
      setStats(res.data?.data ?? null);
    } catch { /* non-critical */ }
  }, []);

  const checkChanges = useCallback(async (ids: number[]) => {
    if (!ids.length || viewMode !== 'production') return;
    try {
      const res = await api.post('/production/audit/check-changes', { production_ids: ids });
      setChangesMap(res.data?.data?.changes ?? {});
    } catch { /* non-critical */ }
  }, [viewMode]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);
  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => {
    if (records.length > 0 && viewMode === 'production') {
      checkChanges(records.map((r: any) => r.id));
    }
  }, [records, viewMode, checkChanges]);

  useEffect(() => {
    autoRefreshRef.current = autoRefresh;
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      if (autoRefreshRef.current) {
        fetchRecords();
        fetchStats();
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [autoRefresh, fetchRecords, fetchStats]);

  const openApproveModal = (record: any) => {
    setApproveTarget(record);
    setAdjustedQty(record.actual_packaging_quantity);
    setApproveModalOpen(true);
  };

  const confirmApprove = async () => {
    if (!approveTarget) return;
    const id = approveTarget.id;
    setActionLoading(id);
    try {
      const payload: any = { id, action: 'approved' };
      if (adjustedQty !== null && adjustedQty !== approveTarget.actual_packaging_quantity) {
        payload.adjusted_quantity = adjustedQty;
      }
      await api.post('/production/audit', payload);
      const adj = payload.adjusted_quantity !== undefined;
      message.success(adj ? `已通过（数量调整为 ${adjustedQty}）` : '已通过');
      setApproveModalOpen(false);
      fetchRecords(); fetchStats();
    } catch (e: any) { message.error(e?.response?.data?.detail ?? '操作失败'); }
    finally { setActionLoading(null); }
  };

  const openRejectModal = (id: number, isBatch = false, ids?: number[]) => {
    setRejectTarget({ id, isBatch, ids });
    setRejectReason('');
    setRejectModalOpen(true);
  };

  const confirmReject = async () => {
    if (!rejectTarget) return;
    setActionLoading(rejectTarget.id);
    try {
      if (rejectTarget.isBatch && rejectTarget.ids?.length) {
        setBatchLoading(true);
        const res = await api.post(
          viewMode === 'production' ? '/production/audit/batch' : '/production/edit-requests/batch',
          { ids: rejectTarget.ids, action: 'rejected', reject_reason: rejectReason || undefined }
        );
        const processed = res.data?.data?.processed ?? rejectTarget.ids.length;
        message.success(`已批量驳回 ${processed} 条`);
        setSelectedKeys([]);
        setBatchLoading(false);
      } else {
        await api.post('/production/audit', {
          id: rejectTarget.id, action: 'rejected',
          reject_reason: rejectReason || undefined,
        });
        message.success('已驳回');
      }
      setRejectModalOpen(false);
      fetchRecords(); fetchStats();
    } catch (e: any) { message.error(e?.response?.data?.detail ?? '操作失败'); }
    finally { setActionLoading(null); setBatchLoading(false); }
  };

  const handleProductionAction = (id: number, action: 'approved' | 'rejected', record?: any) => {
    if (action === 'approved' && record) {
      openApproveModal(record);
    } else if (action === 'rejected') {
      openRejectModal(id);
    }
  };

  const handleEditAction = (editId: number, action: 'approved' | 'rejected') => {
    const actionText = action === 'approved' ? '通过' : '驳回';
    Modal.confirm({
      title: `确认${actionText}修改申请`,
      content: action === 'approved'
        ? '通过后将用新数量覆盖原记录，原记录变为待审核状态'
        : '驳回后修改申请将被拒绝',
      okText: '确定', cancelText: '取消', okButtonProps: { danger: action === 'rejected' },
      onOk: async () => {
        setActionLoading(editId);
        try {
          await api.post(`/production/edit-requests/${editId}/audit`, { id: editId, action });
          message.success(`修改申请已${actionText}`);
          fetchRecords(); fetchStats();
        } catch (e: any) { message.error(e?.response?.data?.detail ?? '操作失败'); }
        finally { setActionLoading(null); }
      },
    });
  };

  const batchProductionAction = async (action: 'approved' | 'rejected') => {
    if (!selectedKeys.length) return;
    if (action === 'rejected') {
      openRejectModal(selectedKeys[0], true, [...selectedKeys]);
      return;
    }
    const actionText = '通过';
    Modal.confirm({
      title: `批量${actionText} ${selectedKeys.length} 条记录`,
      content: `确定要批量${actionText}已选择的 ${selectedKeys.length} 条${viewMode === 'production' ? '生产' : '修改'}记录吗？`,
      okText: '确定', cancelText: '取消',
      onOk: async () => {
        setBatchLoading(true);
        try {
          const url = viewMode === 'production' ? '/production/audit/batch' : '/production/edit-requests/batch';
          const res = await api.post(url, { ids: selectedKeys, action });
          const processed = res.data?.data?.processed ?? selectedKeys.length;
          message.success(`已${actionText} ${processed} 条记录`);
          setSelectedKeys([]); fetchRecords(); fetchStats();
        } catch (e: any) { message.error(e?.response?.data?.detail ?? '批量操作失败'); }
        finally { setBatchLoading(false); }
      },
    });
  };

  const handleRevoke = (id: number) => {
    Modal.confirm({
      title: '确认撤回审核',
      content: '撤回后记录将恢复为"待审核"状态，工人可以重新修改数据后再提交审核。',
      okText: '确认撤回',
      cancelText: '取消',
      okButtonProps: { style: { background: 'linear-gradient(135deg, #fa8c16, #ffc53d)', border: 'none' } },
      onOk: async () => {
        setActionLoading(id);
        try {
          await api.post('/production/audit/revoke', { id, action: 'pending' });
          message.success('已撤回审核，记录恢复为待审核');
          fetchRecords(); fetchStats();
        } catch (e: any) { message.error(e?.response?.data?.detail ?? '撤回失败'); }
        finally { setActionLoading(null); }
      },
    });
  };

  const batchRevoke = () => {
    if (!selectedKeys.length) return;
    Modal.confirm({
      title: `批量撤回 ${selectedKeys.length} 条记录`,
      content: `确定要撤回已选择的 ${selectedKeys.length} 条记录的审核状态吗？撤回后将恢复为待审核。`,
      okText: '确认撤回',
      cancelText: '取消',
      okButtonProps: { style: { background: 'linear-gradient(135deg, #fa8c16, #ffc53d)', border: 'none' } },
      onOk: async () => {
        setBatchLoading(true);
        try {
          const res = await api.post('/production/audit/batch-revoke', { ids: selectedKeys, action: 'pending' });
          const processed = res.data?.data?.processed ?? selectedKeys.length;
          message.success(`已撤回 ${processed} 条记录`);
          setSelectedKeys([]); fetchRecords(); fetchStats();
        } catch (e: any) { message.error(e?.response?.data?.detail ?? '批量撤回失败'); }
        finally { setBatchLoading(false); }
      },
    });
  };

  const showChangeHistory = async (productionId: number) => {
    setHistoryLoading(true);
    setHistoryOpen(true);
    try {
      const res = await api.get(`/production/audit/change-history/${productionId}`);
      setHistoryData(res.data?.data ?? null);
    } catch (e: any) {
      message.error(e?.response?.data?.detail ?? '加载变更历史失败');
      setHistoryData(null);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleRefresh = () => {
    setRefreshSpin(true);
    Promise.all([fetchRecords(), fetchStats()]).finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const handleSmartScan = async () => {
    setSmartScanLoading(true);
    try {
      const [scanRes, effRes] = await Promise.all([
        api.get('/production/audit/smart-scan'),
        api.get('/production/audit/efficiency'),
      ]);
      setSmartScan(scanRes.data?.data || null);
      setEfficiency(effRes.data?.data || null);
      setShowSmartPanel(true);
    } catch { message.error('智能扫描失败'); }
    finally { setSmartScanLoading(false); }
  };

  const handleAutoApprove = async () => {
    Modal.confirm({
      title: '一键审核全部正常记录',
      content: `将自动通过所有异常评分为0的待审核记录。已检测到 ${smartScan?.summary?.normal ?? 0} 条正常记录。确定继续？`,
      okText: '确定审核',
      cancelText: '取消',
      okButtonProps: { style: { background: 'linear-gradient(135deg, #00b96b, #5cdbd3)', border: 'none' } },
      onOk: async () => {
        setAutoApproveLoading(true);
        try {
          const res = await api.post('/production/audit/approve-normal');
          const cnt = res.data?.data?.approved_count ?? 0;
          message.success(`已自动审核通过 ${cnt} 条正常记录`);
          fetchRecords(); fetchStats();
          if (showSmartPanel) handleSmartScan();
        } catch (e: any) { message.error(e?.response?.data?.detail ?? '自动审核失败'); }
        finally { setAutoApproveLoading(false); }
      },
    });
  };

  const handleFilter = (v: any) => {
    const [sd, ed] = v.date_range
      ? [v.date_range[0]?.format('YYYY-MM-DD') ?? '', v.date_range[1]?.format('YYYY-MM-DD') ?? '']
      : ['', ''];
    setFilters(p => ({ ...p, page: 1, worker_id: v.worker_id, sku_id: v.sku_id, start_date: sd, end_date: ed }));
  };

  const handleResetFilter = () => {
    filterForm.resetFields();
    setFilters(p => ({ ...p, page: 1, worker_id: undefined, sku_id: undefined, start_date: '', end_date: '' }));
  };

  const handleExport = () => {
    if (!records.length) { message.warning('暂无数据'); return; }
    if (viewMode === 'production') {
      const cols = [
        { key: 'id', title: 'ID' },
        { key: 'worker_name', title: '工人' },
        { key: 'sku_name', title: 'SKU' },
        { key: 'production_date', title: '日期' },
        { key: 'printed_quantity', title: '打印量' },
        { key: 'actual_packaging_quantity', title: '实包装量' },
        { key: 'audit_status', title: '状态', render: (v: unknown) => STATUS_MAP[v as string]?.label ?? String(v) },
      ];
      exportToCsv(records, cols, `生产审核_${tab}`);
    } else {
      const cols = [
        { key: 'id', title: '申请ID' },
        { key: 'worker_name', title: '工人' },
        { key: 'sku_name', title: 'SKU' },
        { key: 'production_date', title: '日期' },
        { key: 'old_quantity', title: '原数量' },
        { key: 'new_quantity', title: '新数量' },
        { key: 'audit_status', title: '状态', render: (v: unknown) => STATUS_MAP[v as string]?.label ?? String(v) },
        { key: 'edit_date', title: '申请时间' },
      ];
      exportToCsv(records, cols, `修改审核_${tab}`);
    }
  };

  const COLORS = ['#1677ff', '#00b96b', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2'];

  const trendMax = Math.max(...(stats?.daily_trend?.map(d => d.qty) ?? []), 1);

  const productionColumns: any[] = [
    { title: 'ID', dataIndex: 'id', width: 60, render: (v: number) => <span className="num" style={{ color: 'var(--text-4)', fontSize: 12 }}>#{v}</span> },
    {
      title: '工人', dataIndex: 'worker_id', width: 130,
      render: (_: any, r: any) => {
        const name = r.worker_name || `#${r.worker_id}`;
        return (
          <Space size={8}>
            <Avatar size={26} style={{ background: COLORS[(name || '').charCodeAt(0) % COLORS.length], fontWeight: 700, fontSize: 11, boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}>
              {(name || '?').charAt(0)}
            </Avatar>
            <span style={{ fontWeight: 600 }}>{name}</span>
          </Space>
        );
      },
    },
    {
      title: 'SKU', dataIndex: 'sku_id', width: 150, ellipsis: true,
      render: (_: any, r: any) => {
        const name = r.sku_name || `#${r.sku_id}`;
        return (
          <span style={{
            display: 'inline-block', padding: '1px 8px', borderRadius: 6, fontSize: 12, fontWeight: 500,
            background: 'linear-gradient(135deg, rgba(22,119,255,0.08) 0%, rgba(22,119,255,0.03) 100%)',
            color: '#1677ff', border: '1px solid rgba(22,119,255,0.12)',
          }}>{name}</span>
        );
      },
    },
    {
      title: '日期', dataIndex: 'production_date', width: 110,
      render: (v: string) => <span style={{ color: 'var(--text-2)' }}>{v ? dayjs(v).format('YYYY-MM-DD') : '-'}</span>,
      sorter: (a: any, b: any) => dayjs(a.production_date).unix() - dayjs(b.production_date).unix(),
    },
    {
      title: '打印量', dataIndex: 'printed_quantity', width: 80, align: 'right' as const,
      render: (v: any) => <span className="num" style={{ fontWeight: 500 }}>{v ?? '-'}</span>,
    },
    {
      title: '实包装', dataIndex: 'actual_packaging_quantity', width: 90, align: 'right' as const,
      render: (v: any) => <span className="num" style={{ fontWeight: 700, color: '#1677ff' }}>{v ?? '-'}</span>,
    },
    {
      title: '差异', key: 'diff', width: 80, align: 'right' as const,
      render: (_: any, r: any) => {
        if (r.printed_quantity == null || r.actual_packaging_quantity == null) return '-';
        const diff = r.actual_packaging_quantity - r.printed_quantity;
        return <Tag color={diff === 0 ? 'default' : diff > 0 ? 'success' : 'error'} style={{ borderRadius: 6, fontWeight: 600, fontSize: 12 }}>{diff > 0 ? '+' : ''}{diff}</Tag>;
      },
    },
    {
      title: '状态', dataIndex: 'audit_status', width: 110, align: 'center' as const,
      render: (s: string, r: any) => {
        const m = STATUS_MAP[s] || STATUS_MAP.pending;
        const cm = changesMap[r.id];
        return (
          <Space direction="vertical" size={2} style={{ alignItems: 'center' }}>
            <Tag color={m.color} style={{ borderRadius: 6, fontWeight: 600, fontSize: 12 }} icon={m.icon}>{m.label}</Tag>
            {cm?.has_edits && (
              <Tag color={cm.has_pending ? 'orange' : 'default'} style={{ borderRadius: 4, fontSize: 10, padding: '0 4px', lineHeight: '16px' }}>
                {cm.has_pending ? '有待审变更' : `${cm.edit_count}条变更`}
              </Tag>
            )}
          </Space>
        );
      },
    },
    {
      title: '驳回原因', dataIndex: 'reject_reason', width: 120, ellipsis: true,
      render: (v: string) => v ? <Tooltip title={v}><span style={{ color: '#ff4d4f', fontSize: 12 }}>{v}</span></Tooltip> : null,
    },
    {
      title: '操作', key: 'action', width: tab === 'pending' ? 220 : 140, fixed: 'right' as const, align: 'center' as const,
      render: (_: any, row: any) => (
        <Space size={4}>
          <Tooltip title="查看详情">
            <Button type="text" size="small" icon={<EyeOutlined />}
              onClick={() => { setDetailRecord(row); setDetailOpen(true); }}
              style={{ color: '#1677ff', borderRadius: 6 }} />
          </Tooltip>
          <Tooltip title="变更历史">
            <Button type="text" size="small" icon={<HistoryOutlined />}
              onClick={() => showChangeHistory(row.id)}
              style={{ color: '#722ed1', borderRadius: 6 }} />
          </Tooltip>
          {tab === 'pending' && (
            <>
              <Button type="primary" size="small" icon={<CheckOutlined />}
                loading={actionLoading === row.id} onClick={() => handleProductionAction(row.id, 'approved', row)}
                style={{ borderRadius: 6, fontWeight: 600, fontSize: 12 }}>通过</Button>
              <Button danger size="small" icon={<CloseOutlined />}
                loading={actionLoading === row.id} onClick={() => handleProductionAction(row.id, 'rejected')}
                style={{ borderRadius: 6, fontWeight: 600, fontSize: 12 }}>驳回</Button>
            </>
          )}
          {(tab === 'approved' || tab === 'rejected') && (
            <Tooltip title="撤回审核，恢复为待审核状态">
              <Button size="small" icon={<RollbackOutlined />}
                loading={actionLoading === row.id} onClick={() => handleRevoke(row.id)}
                style={{ borderRadius: 6, fontWeight: 600, fontSize: 12, color: '#fa8c16', borderColor: '#fa8c16' }}>撤回</Button>
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  const editColumns: any[] = [
    { title: 'ID', dataIndex: 'id', width: 60, render: (v: number) => <span className="num" style={{ color: 'var(--text-4)', fontSize: 12 }}>#{v}</span> },
    {
      title: '工人', dataIndex: 'worker_id', width: 130,
      render: (_: any, r: any) => {
        const name = r.worker_name || `#${r.worker_id}`;
        return (
          <Space size={8}>
            <Avatar size={26} style={{ background: COLORS[(name || '').charCodeAt(0) % COLORS.length], fontWeight: 700, fontSize: 11, boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}>
              {(name || '?').charAt(0)}
            </Avatar>
            <span style={{ fontWeight: 600 }}>{name}</span>
          </Space>
        );
      },
    },
    {
      title: 'SKU', dataIndex: 'sku_id', width: 150, ellipsis: true,
      render: (_: any, r: any) => {
        const name = r.sku_name || `#${r.sku_id}`;
        return (
          <span style={{
            display: 'inline-block', padding: '1px 8px', borderRadius: 6, fontSize: 12, fontWeight: 500,
            background: 'linear-gradient(135deg, rgba(114,46,209,0.08) 0%, rgba(114,46,209,0.03) 100%)',
            color: '#722ed1', border: '1px solid rgba(114,46,209,0.12)',
          }}>{name}</span>
        );
      },
    },
    {
      title: '日期', dataIndex: 'production_date', width: 110,
      render: (v: string) => <span style={{ color: 'var(--text-2)' }}>{v ? dayjs(v).format('YYYY-MM-DD') : '-'}</span>,
    },
    {
      title: '原数量', dataIndex: 'old_quantity', width: 80, align: 'right' as const,
      render: (v: any) => <span className="num" style={{ fontWeight: 500, color: 'var(--text-3)' }}>{v ?? '-'}</span>,
    },
    {
      title: '新数量', dataIndex: 'new_quantity', width: 80, align: 'right' as const,
      render: (v: any) => <span className="num" style={{ fontWeight: 700, color: '#722ed1' }}>{v ?? '-'}</span>,
    },
    {
      title: '变化', key: 'change', width: 80, align: 'right' as const,
      render: (_: any, r: any) => {
        const diff = (r.new_quantity ?? 0) - (r.old_quantity ?? 0);
        if (diff === 0) return <Tag color="default" style={{ borderRadius: 6, fontWeight: 600, fontSize: 12 }}>0</Tag>;
        return <Tag color={diff > 0 ? 'success' : 'error'} style={{ borderRadius: 6, fontWeight: 600, fontSize: 12 }}>{diff > 0 ? '+' : ''}{diff}</Tag>;
      },
    },
    {
      title: '申请时间', dataIndex: 'edit_date', width: 150,
      render: (v: string) => <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{v ? dayjs(v).format('MM-DD HH:mm') : '-'}</span>,
    },
    {
      title: '状态', dataIndex: 'audit_status', width: 90, align: 'center' as const,
      render: (s: string) => {
        const m = STATUS_MAP[s] || STATUS_MAP.pending;
        return <Tag color={m.color} style={{ borderRadius: 6, fontWeight: 600, fontSize: 12 }} icon={m.icon}>{m.label}</Tag>;
      },
    },
    {
      title: '操作', key: 'action', width: tab === 'pending' ? 200 : 60, fixed: 'right' as const, align: 'center' as const,
      render: (_: any, row: any) => (
        <Space size={4}>
          <Tooltip title="查看原记录">
            <Button type="text" size="small" icon={<EyeOutlined />}
              onClick={() => showChangeHistory(row.original_id)}
              style={{ color: '#1677ff', borderRadius: 6 }} />
          </Tooltip>
          {tab === 'pending' && (
            <>
              <Button type="primary" size="small" icon={<CheckOutlined />}
                loading={actionLoading === row.id} onClick={() => handleEditAction(row.id, 'approved')}
                style={{ borderRadius: 6, fontWeight: 600, fontSize: 12, background: 'linear-gradient(135deg, #722ed1, #b37feb)' }}>通过</Button>
              <Button danger size="small" icon={<CloseOutlined />}
                loading={actionLoading === row.id} onClick={() => handleEditAction(row.id, 'rejected')}
                style={{ borderRadius: 6, fontWeight: 600, fontSize: 12 }}>驳回</Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  const activeFilterCount = [filters.worker_id, filters.sku_id, filters.start_date].filter(Boolean).length;

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22,
        padding: '20px 24px', borderRadius: 'var(--radius-l)',
        background: viewMode === 'production'
          ? 'linear-gradient(135deg, rgba(250,140,22,0.05) 0%, rgba(255,77,79,0.03) 100%)'
          : 'linear-gradient(135deg, rgba(114,46,209,0.05) 0%, rgba(179,127,235,0.03) 100%)',
        border: viewMode === 'production'
          ? '1px solid rgba(250,140,22,0.06)'
          : '1px solid rgba(114,46,209,0.06)',
        transition: 'all 0.3s ease',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 32, height: 32, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: viewMode === 'production'
                ? 'linear-gradient(135deg, #fa8c16 0%, #ff4d4f 100%)'
                : 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)',
              color: '#fff', fontSize: 15,
              boxShadow: viewMode === 'production'
                ? '0 3px 10px rgba(250,140,22,0.2)'
                : '0 3px 10px rgba(114,46,209,0.2)',
            }}>{viewMode === 'production' ? <AuditOutlined /> : <EditOutlined />}</span>
            {viewMode === 'production' ? '生产审核' : '变更审核'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 42 }}>
            {viewMode === 'production'
              ? '审核工人生产记录 · 通过或驳回 · 数据统计'
              : '处理工人修改申请 · 批准或拒绝 · 数据追溯'}
          </div>
        </div>
        <Space size={8}>
          <Tooltip title={autoRefresh ? '关闭自动刷新' : '开启自动刷新(10s)'}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
              borderRadius: 10, background: autoRefresh ? 'rgba(0,185,107,0.08)' : 'transparent',
              border: autoRefresh ? '1px solid rgba(0,185,107,0.2)' : '1px solid transparent',
              transition: 'all 0.3s',
            }}>
              {autoRefresh && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00b96b', animation: 'pulse 2s infinite' }} />}
              <Switch size="small" checked={autoRefresh} onChange={setAutoRefresh}
                style={{ background: autoRefresh ? '#00b96b' : undefined }} />
            </div>
          </Tooltip>
          {viewMode === 'production' && (
            <Tooltip title="AI 智能审核扫描">
              <Button icon={<RobotOutlined />} onClick={handleSmartScan} loading={smartScanLoading}
                style={{
                  borderRadius: 10, height: 34, fontWeight: 600, fontSize: 12,
                  background: showSmartPanel ? 'linear-gradient(135deg, #667eea, #764ba2)' : undefined,
                  color: showSmartPanel ? '#fff' : undefined,
                  border: showSmartPanel ? 'none' : undefined,
                }}>
                智能审核
              </Button>
            </Tooltip>
          )}
          <Tooltip title="导出 CSV"><Button icon={<DownloadOutlined />} onClick={handleExport} disabled={!records.length} style={{ borderRadius: 10, height: 34, width: 34 }} /></Tooltip>
          <Tooltip title="刷新数据"><Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 10, height: 34, width: 34 }} /></Tooltip>
        </Space>
      </div>

      {/* View Mode Toggle */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 18, padding: '6px',
        borderRadius: 14, background: 'var(--glass-bg, rgba(255,255,255,0.6))',
        border: '1px solid rgba(0,0,0,0.04)', width: 'fit-content',
        backdropFilter: 'blur(10px)',
      }}>
        {([
          { key: 'production' as ViewMode, label: '生产审核', icon: <AuditOutlined />, count: stats?.pending ?? 0, gradient: 'linear-gradient(135deg, #fa8c16, #ff4d4f)' },
          { key: 'edits' as ViewMode, label: '变更审核', icon: <EditOutlined />, count: stats?.pending_edits ?? 0, gradient: 'linear-gradient(135deg, #722ed1, #b37feb)' },
        ]).map(m => (
          <div key={m.key} onClick={() => { setViewMode(m.key); setTab('pending'); setFilters(p => ({ ...p, page: 1 })); setSelectedKeys([]); }}
            style={{
              padding: '8px 20px', borderRadius: 10, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              background: viewMode === m.key ? m.gradient : 'transparent',
              color: viewMode === m.key ? '#fff' : 'var(--text-3)',
              fontWeight: viewMode === m.key ? 700 : 500,
              fontSize: 14, transition: 'all 0.25s cubic-bezier(0.22,1,0.36,1)',
              boxShadow: viewMode === m.key ? '0 3px 12px rgba(0,0,0,0.1)' : 'none',
            }}>
            {m.icon}
            {m.label}
            {m.count > 0 && (
              <Badge count={m.count} size="small"
                style={{
                  background: viewMode === m.key ? 'rgba(255,255,255,0.25)' : undefined,
                  boxShadow: 'none', fontSize: 10, fontWeight: 700,
                }} />
            )}
          </div>
        ))}
      </div>

      {/* Stats Cards */}
      <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
        {(viewMode === 'production' ? [
          { label: '待审核', value: stats?.pending ?? 0, unit: '条', icon: <ClockCircleOutlined />, gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.15)' },
          { label: '已通过', value: stats?.approved ?? 0, unit: '条', icon: <CheckCircleOutlined />, gradient: 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: 'rgba(0,185,107,0.15)' },
          { label: '已驳回', value: stats?.rejected ?? 0, unit: '条', icon: <CloseCircleOutlined />, gradient: 'linear-gradient(135deg, #ff4d4f 0%, #ff85c0 100%)', glow: 'rgba(255,77,79,0.15)' },
          { label: '待审包装量', value: stats?.total_qty_pending ?? 0, unit: '件', icon: <BarChartOutlined />, gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', glow: 'rgba(114,46,209,0.15)' },
        ] : [
          { label: '待处理变更', value: stats?.pending_edits ?? 0, unit: '条', icon: <EditOutlined />, gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', glow: 'rgba(114,46,209,0.15)' },
          { label: '今日新增', value: stats?.today_pending_edits ?? 0, unit: '条', icon: <BellOutlined />, gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.15)' },
          { label: '待审生产', value: stats?.pending ?? 0, unit: '条', icon: <ClockCircleOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.15)' },
          { label: '待审包装量', value: stats?.total_qty_pending ?? 0, unit: '件', icon: <BarChartOutlined />, gradient: 'linear-gradient(135deg, #13c2c2 0%, #5cdbd3 100%)', glow: 'rgba(19,194,194,0.15)' },
        ]).map((s, i) => (
          <Col xs={12} sm={6} key={i}>
            <div style={{
              padding: '14px 16px', borderRadius: 'var(--radius-m)', background: s.gradient,
              position: 'relative', overflow: 'hidden',
              boxShadow: `0 4px 14px ${s.glow}`, transition: 'all 0.3s',
              animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`,
              animationDelay: `${i * 0.08}s`, cursor: 'pointer',
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
            >
              <div style={{ position: 'absolute', top: -12, right: -12, width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>{s.icon} {s.label}</div>
              <div className="num" style={{ fontSize: 22, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>
                {s.value.toLocaleString()}<span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3, opacity: 0.7 }}>{s.unit}</span>
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* Trend + Top Workers (production only) */}
      {viewMode === 'production' && (
        <Row gutter={[16, 16]} style={{ marginBottom: 18 }}>
          <Col xs={24} lg={14}>
            <div className="panel" style={{ height: '100%' }}>
              <div className="panel-head">
                <span className="panel-title"><RiseOutlined style={{ color: '#00b96b' }} />7日审核产量趋势</span>
              </div>
              <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'flex-end', gap: 8, height: 140 }}>
                {(stats?.daily_trend ?? []).map((item, idx) => {
                  const h = trendMax > 0 ? (item.qty / trendMax) * 90 : 0;
                  return (
                    <Tooltip key={item.date} title={`${item.date}：${item.count} 条 / ${item.qty} 件`}>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                        <span className="num" style={{ fontSize: 10, color: 'var(--text-3)', fontWeight: 600 }}>{item.qty}</span>
                        <div style={{
                          width: '100%', maxWidth: 36, height: Math.max(h, item.qty > 0 ? 4 : 0), minHeight: item.qty > 0 ? 4 : 0,
                          background: 'linear-gradient(180deg, #00b96b 0%, #5cdbd388 100%)',
                          borderRadius: '4px 4px 0 0', transition: 'height 0.5s cubic-bezier(0.22,1,0.36,1)',
                          boxShadow: '0 2px 6px rgba(0,185,107,0.15)',
                        }} />
                        <span style={{ fontSize: 10, color: 'var(--text-4)', lineHeight: 1 }}>{item.date}</span>
                      </div>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          </Col>
          <Col xs={24} lg={10}>
            <div className="panel" style={{ height: '100%' }}>
              <div className="panel-head">
                <span className="panel-title"><UserOutlined style={{ color: '#fa8c16' }} />待审核工人 Top 5</span>
              </div>
              <div style={{ padding: '12px 16px' }}>
                {(stats?.top_pending_workers ?? []).map((u, i) => {
                  const maxQ = stats?.top_pending_workers?.[0]?.qty || 1;
                  const pct = Math.round((u.qty / maxQ) * 100);
                  return (
                    <div key={u.worker_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                      <Avatar size={26} style={{ background: COLORS[i % COLORS.length], fontWeight: 700, fontSize: 11, flexShrink: 0 }}>
                        {u.name.charAt(0)}
                      </Avatar>
                      <span style={{ width: 60, fontSize: 13, fontWeight: 600, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
                      <div style={{ flex: 1, height: 6, background: 'rgba(0,0,0,0.04)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: `linear-gradient(90deg, ${COLORS[i % COLORS.length]}, ${COLORS[i % COLORS.length]}88)`, transition: 'width 0.6s' }} />
                      </div>
                      <Tag style={{ borderRadius: 6, fontSize: 11, fontWeight: 600, minWidth: 42, textAlign: 'center' }}>{u.qty}件/{u.count}条</Tag>
                    </div>
                  );
                })}
                {!(stats?.top_pending_workers?.length) && <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-4)', fontSize: 13 }}>暂无待审核数据</div>}
              </div>
            </div>
          </Col>
        </Row>
      )}

      {/* Smart Audit Panel */}
      {showSmartPanel && smartScan && (
        <div className="panel" style={{ marginBottom: 18, overflow: 'hidden' }}>
          <div className="panel-head" style={{
            background: 'linear-gradient(135deg, rgba(102,126,234,0.06), rgba(118,75,162,0.04))',
          }}>
            <span className="panel-title">
              <RobotOutlined style={{ color: '#667eea' }} /> AI 智能审核分析
            </span>
            <Space>
              {smartScan.summary.normal > 0 && (
                <Button type="primary" size="small"
                  icon={<CheckCircleOutlined />}
                  loading={autoApproveLoading}
                  onClick={handleAutoApprove}
                  style={{
                    borderRadius: 8, fontWeight: 600,
                    background: 'linear-gradient(135deg, #00b96b, #5cdbd3)',
                    border: 'none', boxShadow: '0 2px 8px rgba(0,185,107,0.25)',
                  }}>
                  一键审核正常 ({smartScan.summary.normal})
                </Button>
              )}
              <Button size="small" onClick={() => setShowSmartPanel(false)} style={{ borderRadius: 8 }}>收起</Button>
            </Space>
          </div>

          {/* Summary cards */}
          <div style={{ padding: '14px 16px' }}>
            <Row gutter={[10, 10]} style={{ marginBottom: 14 }}>
              {[
                { label: '总待审', value: smartScan.summary.total, bg: 'linear-gradient(135deg, #667eea, #764ba2)', glow: 'rgba(102,126,234,0.15)' },
                { label: '正常', value: smartScan.summary.normal, bg: 'linear-gradient(135deg, #00b96b, #5cdbd3)', glow: 'rgba(0,185,107,0.15)' },
                { label: '需注意', value: smartScan.summary.warning, bg: 'linear-gradient(135deg, #faad14, #ffc53d)', glow: 'rgba(250,173,20,0.15)' },
                { label: '异常', value: smartScan.summary.danger, bg: 'linear-gradient(135deg, #ff4d4f, #ff7875)', glow: 'rgba(255,77,79,0.15)' },
              ].map((s, i) => (
                <Col xs={6} key={i}>
                  <div style={{
                    padding: '10px 12px', borderRadius: 10, background: s.bg,
                    boxShadow: `0 3px 10px ${s.glow}`,
                  }}>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.8)', marginBottom: 2 }}>{s.label}</div>
                    <div className="num" style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>{s.value}</div>
                  </div>
                </Col>
              ))}
            </Row>

            {/* Efficiency stats */}
            {efficiency && (
              <div style={{
                display: 'flex', gap: 12, marginBottom: 14, padding: '10px 14px', borderRadius: 10,
                background: 'linear-gradient(135deg, rgba(22,119,255,0.04), rgba(0,185,107,0.03))',
                border: '1px solid rgba(22,119,255,0.08)',
                flexWrap: 'wrap',
              }}>
                <div style={{ flex: '1 1 80px', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)' }}>今日已审</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 700, color: '#1677ff' }}>{efficiency.today_total}</div>
                </div>
                <div style={{ flex: '1 1 80px', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)' }}>今日通过</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 700, color: '#00b96b' }}>{efficiency.today_approved}</div>
                </div>
                <div style={{ flex: '1 1 80px', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)' }}>今日驳回</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 700, color: '#ff4d4f' }}>{efficiency.today_rejected}</div>
                </div>
                <div style={{ flex: '1 1 80px', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)' }}>本周</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 700, color: '#722ed1' }}>{efficiency.week_approved}</div>
                </div>
                <div style={{ flex: '1 1 80px', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)' }}>本月</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 700, color: '#fa8c16' }}>{efficiency.month_approved}</div>
                </div>
              </div>
            )}

            {/* Anomaly records */}
            {smartScan.records.filter((r: any) => r.anomaly_level !== 'normal').length > 0 && (
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: 'var(--text-2)' }}>
                  <span style={{ color: '#ff4d4f' }}>!</span> 需关注的记录
                </div>
                {smartScan.records.filter((r: any) => r.anomaly_level !== 'normal').slice(0, 10).map((r: any) => (
                  <div key={r.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                    marginBottom: 6, borderRadius: 8,
                    border: `1px solid ${r.anomaly_level === 'danger' ? 'rgba(255,77,79,0.2)' : 'rgba(250,173,20,0.2)'}`,
                    background: r.anomaly_level === 'danger' ? 'rgba(255,77,79,0.03)' : 'rgba(250,173,20,0.03)',
                  }}>
                    <Tag color={r.anomaly_level === 'danger' ? 'error' : 'warning'}
                      style={{ borderRadius: 6, fontWeight: 600, fontSize: 10, minWidth: 36, textAlign: 'center' }}>
                      {r.anomaly_level === 'danger' ? '异常' : '注意'}
                    </Tag>
                    <Avatar size={22} style={{
                      background: `hsl(${(r.worker_name || '').charCodeAt(0) * 47 % 360},55%,55%)`,
                      fontSize: 10, flexShrink: 0,
                    }}>{(r.worker_name || '?').charAt(0)}</Avatar>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center' }}>
                        {r.worker_name}
                        <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-3)' }}>{r.sku_name}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-4)' }}>
                        打印{r.printed_quantity} · 实际{r.actual_quantity} · 完成{r.completion_rate}%
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: r.anomaly_level === 'danger' ? '#ff4d4f' : '#faad14', maxWidth: 200, textAlign: 'right' }}>
                      {r.anomaly_reasons.join('；')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Table Panel */}
      <div className="panel">
        <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {Object.entries(STATUS_MAP).map(([k, v]) => {
              const gradients: Record<string, string> = {
                pending: viewMode === 'production' ? 'linear-gradient(135deg, #fa8c16, #ffc53d)' : 'linear-gradient(135deg, #722ed1, #b37feb)',
                approved: 'linear-gradient(135deg, #00b96b, #5cdbd3)',
                rejected: 'linear-gradient(135deg, #ff4d4f, #ff7875)',
              };
              return (
                <div key={k} style={{
                  padding: '5px 14px', borderRadius: 20, fontSize: 13, fontWeight: 500,
                  background: tab === k ? gradients[k] : 'rgba(0,0,0,0.04)',
                  color: tab === k ? '#fff' : 'var(--text-3)',
                  cursor: 'pointer', transition: 'all 0.2s',
                }} onClick={() => { setTab(k); setFilters(p => ({ ...p, page: 1 })); setSelectedKeys([]); }}>
                  {v.icon} {v.label}
                  {tab === k && <span style={{ marginLeft: 4, fontSize: 11 }}>({total})</span>}
                </div>
              );
            })}
          </div>
          <Button icon={<FilterOutlined />} onClick={() => setShowFilters(!showFilters)}
            type={activeFilterCount > 0 ? 'primary' : 'default'}
            style={{ borderRadius: 8, fontWeight: 500 }}>
            筛选{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </Button>
        </div>

        {showFilters && (
          <div style={{
            padding: '12px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)',
            background: viewMode === 'production' ? 'rgba(250,140,22,0.02)' : 'rgba(114,46,209,0.02)',
            animation: 'fadeIn 0.3s ease',
          }}>
            <Form form={filterForm} layout="inline" onFinish={handleFilter} style={{ gap: 8, flexWrap: 'wrap' }}>
              <Form.Item name="worker_id" style={{ marginBottom: 0 }}>
                <Select placeholder="选择工人" allowClear style={{ width: 150, borderRadius: 8 }}
                  showSearch optionFilterProp="label"
                  options={workers.map(w => ({ value: w.id, label: w.name }))} />
              </Form.Item>
              <Form.Item name="sku_id" style={{ marginBottom: 0 }}>
                <Select placeholder="选择 SKU" allowClear style={{ width: 180, borderRadius: 8 }}
                  showSearch optionFilterProp="label"
                  options={skus.map(s => ({ value: s.id, label: s.name }))} />
              </Form.Item>
              <Form.Item name="date_range" style={{ marginBottom: 0 }}>
                <DatePicker.RangePicker style={{ borderRadius: 8 }} />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0 }}>
                <Space size={6}>
                  <Button type="primary" htmlType="submit" icon={<SearchOutlined />} style={{ borderRadius: 8 }}>搜索</Button>
                  <Button onClick={handleResetFilter} icon={<ReloadOutlined />} style={{ borderRadius: 8 }}>重置</Button>
                </Space>
              </Form.Item>
            </Form>
          </div>
        )}

        {(tab === 'pending' || ((tab === 'approved' || tab === 'rejected') && viewMode === 'production')) && (
          <div style={{
            padding: '10px 20px',
            background: selectedKeys.length > 0
              ? (viewMode === 'production'
                ? 'linear-gradient(135deg, rgba(250,140,22,0.08) 0%, rgba(22,119,255,0.04) 100%)'
                : 'linear-gradient(135deg, rgba(114,46,209,0.08) 0%, rgba(22,119,255,0.04) 100%)')
              : 'rgba(0,0,0,0.01)',
            borderBottom: '1px solid rgba(0,0,0,0.04)',
            display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
            flexWrap: 'wrap',
            transition: 'all 0.3s',
          }}>
            <Button size="small"
              onClick={() => {
                if (selectedKeys.length === records.length) {
                  setSelectedKeys([]);
                } else {
                  setSelectedKeys(records.map((r: any) => r.id));
                }
              }}
              icon={selectedKeys.length === records.length && records.length > 0 ? <CloseCircleOutlined /> : <CheckCircleOutlined />}
              style={{
                borderRadius: 8, fontWeight: 600, fontSize: 12,
                background: selectedKeys.length === records.length && records.length > 0
                  ? 'rgba(255,77,79,0.06)' : 'rgba(22,119,255,0.06)',
                borderColor: selectedKeys.length === records.length && records.length > 0
                  ? 'rgba(255,77,79,0.2)' : 'rgba(22,119,255,0.2)',
                color: selectedKeys.length === records.length && records.length > 0
                  ? '#ff4d4f' : '#1677ff',
              }}>
              {selectedKeys.length === records.length && records.length > 0 ? '取消全选' : `全选本页 (${records.length})`}
            </Button>

            {selectedKeys.length > 0 && (
              <>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '2px 12px', borderRadius: 8,
                  background: viewMode === 'production' ? 'rgba(250,140,22,0.1)' : 'rgba(114,46,209,0.1)',
                  color: viewMode === 'production' ? '#fa8c16' : '#722ed1',
                  fontWeight: 700, fontSize: 13,
                }}>
                  {viewMode === 'production' ? <AuditOutlined /> : <EditOutlined />} 已选 {selectedKeys.length} 条
                </span>
                {tab === 'pending' && (
                  <>
                    <Button size="small" type="primary" onClick={() => batchProductionAction('approved')} icon={<CheckOutlined />}
                      loading={batchLoading}
                      style={{
                        borderRadius: 8, fontWeight: 600, height: 30,
                        background: viewMode === 'edits' ? 'linear-gradient(135deg, #722ed1, #b37feb)' : 'linear-gradient(135deg, #00b96b, #5cdbd3)',
                        border: 'none',
                        boxShadow: '0 2px 8px rgba(0,185,107,0.2)',
                      }}>
                      批量{viewMode === 'production' ? '通过' : '批准'} ({selectedKeys.length})
                    </Button>
                    <Button size="small" danger onClick={() => batchProductionAction('rejected')} icon={<CloseOutlined />}
                      loading={batchLoading} style={{ borderRadius: 8, fontWeight: 600, height: 30, boxShadow: '0 2px 8px rgba(255,77,79,0.15)' }}>
                      批量驳回 ({selectedKeys.length})
                    </Button>
                  </>
                )}
                {(tab === 'approved' || tab === 'rejected') && viewMode === 'production' && (
                  <Button size="small" icon={<RollbackOutlined />} onClick={batchRevoke}
                    loading={batchLoading}
                    style={{
                      borderRadius: 8, fontWeight: 600, height: 30,
                      color: '#fa8c16', borderColor: '#fa8c16',
                      boxShadow: '0 2px 8px rgba(250,140,22,0.15)',
                    }}>
                    批量撤回 ({selectedKeys.length})
                  </Button>
                )}
                <Button size="small" type="text" onClick={() => setSelectedKeys([])} style={{ color: 'var(--text-3)', borderRadius: 6 }}>
                  取消
                </Button>
              </>
            )}

            {selectedKeys.length === 0 && records.length > 0 && (
              <span style={{ fontSize: 12, color: 'var(--text-4)' }}>
                勾选记录或点击全选本页进行{tab === 'pending' ? '批量审核' : '批量撤回'}
              </span>
            )}
          </div>
        )}

        <Table rowKey="id"
          columns={viewMode === 'production' ? productionColumns : editColumns}
          dataSource={records} loading={loading} size="middle"
          rowSelection={(tab === 'pending' || ((tab === 'approved' || tab === 'rejected') && viewMode === 'production')) ? { selectedRowKeys: selectedKeys, onChange: k => setSelectedKeys(k as number[]) } : undefined}
          pagination={{
            current: filters.page, pageSize: filters.page_size, total,
            showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'],
            showTotal: t => `共 ${t} 条`,
            onChange: (p, ps) => setFilters(prev => ({ ...prev, page: p, page_size: ps ?? 20 })),
          }}
          scroll={{ x: 1000 }}
          locale={{ emptyText: tab === 'pending' ? `暂无待${viewMode === 'production' ? '审核' : '处理'}记录` : `暂无${tab === 'approved' ? '已通过' : '已驳回'}记录` }}
        />
      </div>

      {/* Detail Drawer */}
      <Drawer title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg, #1677ff, #722ed1)', color: '#fff', fontSize: 13,
          }}><FileTextOutlined /></span>
          生产记录详情 #{detailRecord?.id}
        </div>
      } open={detailOpen} onClose={() => setDetailOpen(false)} width={480}>
        {detailRecord && (
          <>
            <Descriptions column={1} size="small" labelStyle={{ color: 'var(--text-3)', width: 100 }}>
              <Descriptions.Item label="记录ID"><Tag color="blue" style={{ borderRadius: 6 }}>#{detailRecord.id}</Tag></Descriptions.Item>
              <Descriptions.Item label="工人">
                <Space>
                  <Avatar size={24} style={{ background: COLORS[(detailRecord.worker_name || '').charCodeAt(0) % COLORS.length], fontSize: 10, fontWeight: 700 }}>
                    {(detailRecord.worker_name || '?')[0]}
                  </Avatar>
                  {detailRecord.worker_name}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="SKU">{detailRecord.sku_name}</Descriptions.Item>
              <Descriptions.Item label="生产日期">{detailRecord.production_date ? dayjs(detailRecord.production_date).format('YYYY-MM-DD') : '-'}</Descriptions.Item>
              <Descriptions.Item label="打印量"><span className="num" style={{ fontWeight: 600 }}>{detailRecord.printed_quantity ?? '-'}</span></Descriptions.Item>
              <Descriptions.Item label="实包装量"><span className="num" style={{ fontWeight: 700, color: '#1677ff', fontSize: 16 }}>{detailRecord.actual_packaging_quantity ?? '-'}</span></Descriptions.Item>
              <Descriptions.Item label="差异">
                {(() => {
                  if (detailRecord.printed_quantity == null || detailRecord.actual_packaging_quantity == null) return '-';
                  const diff = detailRecord.actual_packaging_quantity - detailRecord.printed_quantity;
                  return <Tag color={diff === 0 ? 'default' : diff > 0 ? 'success' : 'error'} style={{ borderRadius: 6, fontWeight: 600 }}>{diff > 0 ? '+' : ''}{diff}</Tag>;
                })()}
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                {(() => {
                  const m = STATUS_MAP[detailRecord.audit_status] || STATUS_MAP.pending;
                  return <Tag color={m.color} icon={m.icon} style={{ borderRadius: 6, fontWeight: 600 }}>{m.label}</Tag>;
                })()}
              </Descriptions.Item>
              {detailRecord.audit_by && <Descriptions.Item label="审核人">{detailRecord.audit_by}</Descriptions.Item>}
              {detailRecord.audit_at && <Descriptions.Item label="审核时间">{dayjs(detailRecord.audit_at).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>}
              {detailRecord.reject_reason && (
                <Descriptions.Item label="驳回原因">
                  <span style={{ color: '#ff4d4f', fontWeight: 500 }}>{detailRecord.reject_reason}</span>
                </Descriptions.Item>
              )}
              {detailRecord.created_at && <Descriptions.Item label="创建时间">{dayjs(detailRecord.created_at).format('YYYY-MM-DD HH:mm:ss')}</Descriptions.Item>}
            </Descriptions>

            {/* AI Advice */}
            <Divider style={{ margin: '14px 0 10px' }} />
            <Button
              icon={<RobotOutlined />}
              onClick={() => fetchAIAdvice(detailRecord)}
              loading={aiAdviceLoading}
              block
              style={{
                borderRadius: 10, height: 38, marginBottom: 10,
                background: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none',
                color: '#fff', fontWeight: 600,
                boxShadow: '0 3px 10px rgba(102,126,234,0.3)',
              }}
            >AI 审核建议</Button>
            {aiAdvice && (
              <div style={{
                padding: '10px 14px', borderRadius: 10, marginBottom: 12,
                background: 'linear-gradient(135deg, rgba(102,126,234,0.06), rgba(118,75,162,0.04))',
                border: '1px solid rgba(102,126,234,0.12)',
                fontSize: 13, lineHeight: 1.7, color: 'var(--text-1)',
              }}>
                {aiAdvice.split(/(\*\*.*?\*\*|\n)/g).map((p, i) => {
                  if (p === '\n') return <br key={i} />;
                  if (p.startsWith('**') && p.endsWith('**')) return <strong key={i} style={{ color: '#667eea' }}>{p.slice(2, -2)}</strong>;
                  return <span key={i}>{p}</span>;
                })}
              </div>
            )}

            {detailRecord.audit_status === 'pending' && (
              <Space style={{ width: '100%' }}>
                <Button type="primary" icon={<CheckOutlined />} block
                  onClick={() => { setDetailOpen(false); openApproveModal(detailRecord); }}
                  style={{ borderRadius: 10, height: 42, fontWeight: 600, flex: 1 }}>通过（可调数量）</Button>
                <Button danger icon={<CloseOutlined />} block
                  onClick={() => { setDetailOpen(false); openRejectModal(detailRecord.id); }}
                  style={{ borderRadius: 10, height: 42, fontWeight: 600, flex: 1 }}>驳回</Button>
              </Space>
            )}
          </>
        )}
      </Drawer>

      {/* Change History Drawer */}
      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #722ed1, #b37feb)', color: '#fff', fontSize: 13,
            }}><HistoryOutlined /></span>
            变更历史
          </div>
        }
        open={historyOpen} onClose={() => { setHistoryOpen(false); setHistoryData(null); }} width={500}
      >
        {historyLoading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-4)' }}>加载中...</div>
        ) : historyData ? (
          <>
            <div style={{
              padding: 16, borderRadius: 12, marginBottom: 20,
              background: 'linear-gradient(135deg, rgba(114,46,209,0.06) 0%, rgba(22,119,255,0.03) 100%)',
              border: '1px solid rgba(114,46,209,0.08)',
            }}>
              <Row gutter={[16, 12]}>
                <Col span={12}>
                  <div style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 2 }}>工人</div>
                  <div style={{ fontWeight: 600 }}>{historyData.worker_name}</div>
                </Col>
                <Col span={12}>
                  <div style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 2 }}>SKU</div>
                  <div style={{ fontWeight: 600, color: '#722ed1' }}>{historyData.sku_name}</div>
                </Col>
                <Col span={12}>
                  <div style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 2 }}>生产日期</div>
                  <div style={{ fontWeight: 600 }}>{historyData.production_date}</div>
                </Col>
                <Col span={12}>
                  <div style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 2 }}>当前状态</div>
                  {(() => {
                    const m = STATUS_MAP[historyData.audit_status] || STATUS_MAP.pending;
                    return <Tag color={m.color} icon={m.icon} style={{ borderRadius: 6, fontWeight: 600 }}>{m.label}</Tag>;
                  })()}
                </Col>
                <Col span={12}>
                  <div style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 2 }}>打印量</div>
                  <div className="num" style={{ fontWeight: 600, fontSize: 18 }}>{historyData.printed_quantity}</div>
                </Col>
                <Col span={12}>
                  <div style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 2 }}>当前包装量</div>
                  <div className="num" style={{ fontWeight: 700, fontSize: 18, color: '#1677ff' }}>{historyData.current_quantity}</div>
                </Col>
              </Row>
            </div>

            <Divider style={{ margin: '12px 0' }}>
              <span style={{ fontSize: 13, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <SwapOutlined /> 修改记录 ({historyData.history?.length || 0})
              </span>
            </Divider>

            {historyData.history?.length > 0 ? (
              <Timeline
                items={historyData.history.map((h: any) => {
                  const m = STATUS_MAP[h.audit_status] || STATUS_MAP.pending;
                  const dotColor = h.audit_status === 'approved' ? '#00b96b' : h.audit_status === 'rejected' ? '#ff4d4f' : '#fa8c16';
                  return {
                    color: dotColor,
                    children: (
                      <div style={{
                        padding: '10px 14px', borderRadius: 10,
                        background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.04)',
                        transition: 'all 0.2s',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>
                            申请改为 <span className="num" style={{ color: '#722ed1', fontSize: 16 }}>{h.new_quantity}</span> 件
                          </span>
                          <Tag color={m.color} icon={m.icon} style={{ borderRadius: 6, fontSize: 11 }}>{m.label}</Tag>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-4)' }}>
                          {h.edit_date ? dayjs(h.edit_date).format('YYYY-MM-DD HH:mm:ss') : '-'}
                        </div>
                      </div>
                    ),
                  };
                })}
              />
            ) : (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-4)', fontSize: 13 }}>
                <HistoryOutlined style={{ fontSize: 32, marginBottom: 8, display: 'block', opacity: 0.3 }} />
                暂无修改记录
              </div>
            )}
          </>
        ) : (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-4)' }}>无数据</div>
        )}
      </Drawer>

      {/* Approve Modal with qty adjustment */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #00b96b, #5cdbd3)', color: '#fff', fontSize: 13 }}><CheckOutlined /></span>
            审核通过 — 可调整数量
          </div>
        }
        open={approveModalOpen}
        onCancel={() => setApproveModalOpen(false)}
        onOk={confirmApprove}
        okText="确认通过"
        cancelText="取消"
        confirmLoading={actionLoading !== null}
      >
        {approveTarget && (
          <div style={{ padding: '12px 0' }}>
            <Row gutter={[16, 12]}>
              <Col span={12}>
                <div style={{ fontSize: 12, color: 'var(--text-4)', marginBottom: 4 }}>工人</div>
                <div style={{ fontWeight: 600 }}>{approveTarget.worker_name}</div>
              </Col>
              <Col span={12}>
                <div style={{ fontSize: 12, color: 'var(--text-4)', marginBottom: 4 }}>SKU</div>
                <div style={{ fontWeight: 600, color: '#1677ff' }}>{approveTarget.sku_name}</div>
              </Col>
              <Col span={12}>
                <div style={{ fontSize: 12, color: 'var(--text-4)', marginBottom: 4 }}>打印量</div>
                <div className="num" style={{ fontWeight: 600, fontSize: 18 }}>{approveTarget.printed_quantity}</div>
              </Col>
              <Col span={12}>
                <div style={{ fontSize: 12, color: 'var(--text-4)', marginBottom: 4 }}>工人申报包装量</div>
                <div className="num" style={{ fontWeight: 600, fontSize: 18, color: '#fa8c16' }}>{approveTarget.actual_packaging_quantity}</div>
              </Col>
            </Row>
            <Divider style={{ margin: '16px 0 12px' }} />
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>
              调整实际包装量（留空或不改则保持原值）：
            </div>
            <InputNumber
              value={adjustedQty}
              onChange={v => setAdjustedQty(v)}
              min={0}
              max={approveTarget.printed_quantity || 99999}
              style={{ width: '100%', borderRadius: 10 }}
              size="large"
              addonAfter="件"
            />
            {adjustedQty !== null && adjustedQty !== approveTarget.actual_packaging_quantity && (
              <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(250,140,22,0.06)', border: '1px solid rgba(250,140,22,0.15)', fontSize: 12, color: '#fa8c16' }}>
                将由 <strong>{approveTarget.actual_packaging_quantity}</strong> 调整为 <strong>{adjustedQty}</strong>（差 {(adjustedQty ?? 0) - approveTarget.actual_packaging_quantity > 0 ? '+' : ''}{(adjustedQty ?? 0) - approveTarget.actual_packaging_quantity}）
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Reject Modal with reason */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #ff4d4f, #ff7875)', color: '#fff', fontSize: 13 }}><CloseOutlined /></span>
            {rejectTarget?.isBatch ? `批量驳回 ${rejectTarget.ids?.length ?? 0} 条记录` : '驳回生产记录'}
          </div>
        }
        open={rejectModalOpen}
        onCancel={() => setRejectModalOpen(false)}
        onOk={confirmReject}
        okText="确认驳回"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        confirmLoading={actionLoading !== null || batchLoading}
      >
        <div style={{ padding: '12px 0' }}>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 8 }}>
            请填写驳回原因（可选，将通知工人）：
          </div>
          <Input.TextArea
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            placeholder="例如：数量与打印量差异过大、数据核实有误..."
            rows={3}
            maxLength={200}
            showCount
            style={{ borderRadius: 10 }}
          />
          <div style={{ marginTop: 8 }}>
            <Space wrap>
              {['数量异常，请核实', '超过打印数量', '日期不正确', '重复提交'].map(t => (
                <Tag key={t} style={{ cursor: 'pointer', borderRadius: 6 }} onClick={() => setRejectReason(t)}>{t}</Tag>
              ))}
            </Space>
          </div>
        </div>
      </Modal>

      <style jsx global>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.8); }
        }
      `}</style>
    </div>
  );
}
