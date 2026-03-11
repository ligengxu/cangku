'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import {
  Table, Button, Badge, Space, message, Row, Col, Tooltip, Avatar, notification, Empty,
  Modal, Form, Select, InputNumber, Input, Segmented, Progress, Collapse, Tag, Popconfirm,
} from 'antd';
import {
  PrinterOutlined, SyncOutlined, FileTextOutlined,
  RedoOutlined, HistoryOutlined, DeleteOutlined,
  PlayCircleOutlined, PauseCircleOutlined, SearchOutlined,
  CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined,
  ThunderboltOutlined, BarcodeOutlined, UnorderedListOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import type { SkuTransaction, Sku } from '@/types';
import dayjs from 'dayjs';

const { TextArea } = Input;

/* ── Types ── */
interface PrintTransaction extends SkuTransaction { transaction_id?: number }
interface PrintedLabelItem {
  id: number; sku_id: number; sku_name: string; fruit_name: string;
  worker_id: number; worker_name: string;
  estimated_weight: number; actual_weight: number;
  scanned_outbound: boolean; created_at: string | null;
  barcode?: string;
}
interface PrintLabel {
  barcode: string;
  sku_name: string;
  worker_name: string;
}
interface LogEntry {
  time: string;
  action: string;
  barcode?: string;
  status: 'success' | 'error' | 'info' | 'warning';
}
interface BatchLookupResult {
  barcode: string;
  sku_name?: string;
  worker_name?: string;
  status?: string;
  scanned_outbound?: boolean;
  label_id?: number;
}

type PrinterStatus = 'connected' | 'detecting' | 'disconnected';
type PrintMode = 'manual' | 'auto';
type ViewTab = 'pending' | 'history' | 'barcode';

const POLL_INTERVAL = 20000;
const PRINT_DELAY = 300;
const MAX_LOG_ENTRIES = 50;
const SEPARATOR_COUNT = 3;

const CC_API_CONFIG = {
  XAction: 'Print',
  XOpenId: '10000870',
  XTokens: '+fdBeHkvLvKR31CCH9fqxOgqkrpS3a67',
  TemplateMode: '0',
  TemplateURL: 'C:/',
};

/* ── CCPrintingAPI Promise Wrapper ── */
function ccPrint(printerName: string, templateName: string, printData: Record<string, string> | Record<string, string>[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (!w.CCPrintingAPI?.Excute) {
      reject(new Error('CCPrintingAPI not available'));
      return;
    }
    const dataArr = Array.isArray(printData) ? printData : [printData];
    w.CCPrintingAPI.Excute(
      {
        ...CC_API_CONFIG,
        PrinterName: printerName,
        TemplateName: templateName,
        PrintDataType: 1,
        PrintData: JSON.stringify(dataArr),
      },
      () => reject(new Error('timeout')),
      (fail: string) => reject(new Error(String(fail || 'fail'))),
      (success: string) => {
        try {
          const r = JSON.parse(success.trim());
          if (r.Status === '1' || r.Status === 1) {
            resolve('ok');
          } else {
            reject(new Error(Array.isArray(r.Message) ? r.Message[0] : String(r.Message || 'print error')));
          }
        } catch {
          resolve('ok');
        }
      },
    );
  });
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

/* ── Style Constants ── */
const COLORS = ['#1677ff', '#00b96b', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2'];

const glassPanel: React.CSSProperties = {
  background: 'rgba(255,255,255,0.65)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid rgba(255,255,255,0.35)',
  borderRadius: 16,
  boxShadow: '0 4px 24px rgba(0,0,0,0.04)',
};

/* ══════════════════════════════════════════════════════════════════ */

export default function ProductionPrintPage() {
  /* ── Core State ── */
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<PrintTransaction[]>([]);
  const [queueCount, setQueueCount] = useState(0);
  const [printLoading, setPrintLoading] = useState<number | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<number[]>([]);
  const [batchPrinting, setBatchPrinting] = useState(false);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [lastUpdate, setLastUpdate] = useState('');
  const prevCountRef = useRef(0);
  const [notifyApi, contextHolder] = notification.useNotification();

  /* ── View / Mode State ── */
  const [viewTab, setViewTab] = useState<ViewTab>('pending');
  const [printMode, setPrintMode] = useState<PrintMode>('manual');

  /* ── Printer State ── */
  const [printerStatus, setPrinterStatus] = useState<PrinterStatus>('detecting');
  const [printerList, setPrinterList] = useState<string[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const ccApiLoaded = useRef(false);

  /* ── Auto Print State ── */
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoProgress, setAutoProgress] = useState({ current: 0, total: 0 });
  const autoStopFlag = useRef(false);

  /* ── Print Log ── */
  const [printLogs, setPrintLogs] = useState<LogEntry[]>([]);

  /* ── History State ── */
  const [historyData, setHistoryData] = useState<PrintedLabelItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);

  /* ── Reprint State ── */
  const [reprintOpen, setReprintOpen] = useState(false);
  const [reprintForm] = Form.useForm();
  const [reprintLoading, setReprintLoading] = useState(false);
  const [reprintFromLabel, setReprintFromLabel] = useState<PrintedLabelItem | null>(null);
  const [skuList, setSkuList] = useState<Sku[]>([]);
  const [workerList, setWorkerList] = useState<any[]>([]);

  /* ── Barcode Lookup State ── */
  const [barcodeInput, setBarcodeInput] = useState('');
  const [barcodeResults, setBarcodeResults] = useState<BatchLookupResult[]>([]);
  const [barcodeLoading, setBarcodeLoading] = useState(false);

  /* ── Delete Loading ── */
  const [deleteLoading, setDeleteLoading] = useState<number | null>(null);

  /* ── Today Printed Count ── */
  const [todayPrinted, setTodayPrinted] = useState(0);

  /* ════════════════════════════════════════════════════════════════ */
  /*                      CCPrintingAPI Loading                      */
  /* ════════════════════════════════════════════════════════════════ */

  useEffect(() => {
    const w = window as any;
    if (w.CCPrintingAPI?.Excute) {
      ccApiLoaded.current = true;
      detectPrinters();
      return;
    }
    const script = document.createElement('script');
    script.src = '/js/CCPrintingAPI.min.js';
    script.async = true;
    script.onload = () => {
      ccApiLoaded.current = true;
      setTimeout(detectPrinters, 500);
    };
    script.onerror = () => {
      ccApiLoaded.current = false;
      setPrinterStatus('disconnected');
    };
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, []);

  const detectPrinters = useCallback(() => {
    setPrinterStatus('detecting');
    const w = window as any;
    if (!w.CCPrintingAPI?.Excute) {
      setPrinterStatus('disconnected');
      addLog('CCPrintingAPI not loaded', undefined, 'warning');
      return;
    }
    try {
      w.CCPrintingAPI.Excute(
        {
          XAction: 'Printers',
          XOpenId: CC_API_CONFIG.XOpenId,
          XTokens: CC_API_CONFIG.XTokens,
        },
        () => {
          setPrinterStatus('disconnected');
          addLog('printer detect timeout', undefined, 'error');
        },
        (fail: string) => {
          setPrinterStatus('disconnected');
          addLog(`printer detect fail: ${fail}`, undefined, 'error');
        },
        (success: string) => {
          try {
            const result = JSON.parse(success.trim());
            if (result.Status === '1' || result.Status === 1) {
              const printers = Array.isArray(result.Message) ? result.Message : [];
              setPrinterList(printers);
              if (printers.length > 0) {
                setSelectedPrinter(prev => prev || (printers.length > 1 ? printers[1] : printers[0]));
                setPrinterStatus('connected');
                addLog(`detected ${printers.length} printers`, undefined, 'success');
              } else {
                setPrinterStatus('disconnected');
                addLog('no printers found', undefined, 'warning');
              }
            } else {
              setPrinterStatus('disconnected');
              addLog('printer API error', undefined, 'error');
            }
          } catch {
            setPrinterStatus('disconnected');
          }
        },
      );
    } catch {
      setPrinterStatus('disconnected');
    }
  }, []);

  /* ════════════════════════════════════════════════════════════════ */
  /*                          Log Utility                           */
  /* ════════════════════════════════════════════════════════════════ */

  const addLog = useCallback((action: string, barcode?: string, status: LogEntry['status'] = 'info') => {
    setPrintLogs(prev => [{
      time: dayjs().format('HH:mm:ss'),
      action,
      barcode,
      status,
    }, ...prev].slice(0, MAX_LOG_ENTRIES));
  }, []);

  /* ════════════════════════════════════════════════════════════════ */
  /*                         Data Fetching                          */
  /* ════════════════════════════════════════════════════════════════ */

  const fetchTransactions = useCallback(async () => {
    try {
      const res = await api.get('/production/transactions', { params: { is_printed: false } });
      setTransactions(Array.isArray(res.data?.data ?? res.data) ? (res.data?.data ?? res.data) : []);
    } catch { setTransactions([]); }
  }, []);

  const fetchQueueCount = useCallback(async () => {
    try {
      const res = await api.get('/production/print-queue');
      const d = res.data?.data ?? res.data;
      const count = typeof d?.count === 'number' ? d.count : d?.pending ?? 0;
      setQueueCount(count);
      return count;
    } catch { setQueueCount(0); return 0; }
  }, []);

  const fetchTodayPrinted = useCallback(async () => {
    try {
      const today = dayjs().format('YYYY-MM-DD');
      const res = await api.get('/production/printed-labels', {
        params: { page: 1, page_size: 1, start_date: today, end_date: today },
      });
      setTodayPrinted(res.data?.total ?? 0);
    } catch { /* ignore */ }
  }, []);

  const refresh = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setRefreshSpin(true);
    Promise.all([fetchTransactions(), fetchQueueCount(), fetchTodayPrinted()]).finally(() => {
      setLoading(false);
      setLastUpdate(dayjs().format('HH:mm:ss'));
      setTimeout(() => setRefreshSpin(false), 600);
    });
  }, [fetchTransactions, fetchQueueCount, fetchTodayPrinted]);

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    const poll = setInterval(async () => {
      const newCount = await fetchQueueCount();
      if (newCount > prevCountRef.current && prevCountRef.current > 0) {
        const diff = newCount - prevCountRef.current;
        notifyApi.info({
          message: '新标签待打印',
          description: `有 ${diff} 条新的待打印标签已加入队列`,
          icon: <PrinterOutlined style={{ color: '#fa8c16' }} />,
          placement: 'topRight',
          duration: 5,
          btn: (
            <Button type="primary" size="small" onClick={() => { refresh(true); notification.destroy(); }}
              style={{ borderRadius: 6, fontWeight: 600 }}>
              立即刷新
            </Button>
          ),
        });
        fetchTransactions();
        setLastUpdate(dayjs().format('HH:mm:ss'));
      }
      prevCountRef.current = newCount;
    }, POLL_INTERVAL);
    return () => clearInterval(poll);
  }, [fetchQueueCount, fetchTransactions, notifyApi, refresh]);

  useEffect(() => { prevCountRef.current = queueCount; }, [queueCount]);

  /* ════════════════════════════════════════════════════════════════ */
  /*                       Print Execution                          */
  /* ════════════════════════════════════════════════════════════════ */

  const isCCAvailable = () => {
    const w = window as any;
    return !!w.CCPrintingAPI?.Excute && printerStatus === 'connected' && !!selectedPrinter;
  };

  const printSeparators = async () => {
    if (!isCCAvailable()) return;
    const batch = Array.from({ length: SEPARATOR_COUNT }, () => ({
      barcode: '0000', data: '===\u5206\u9694\u7b26===', Field3: '===\u5206\u9694\u7b26===',
    }));
    try {
      await ccPrint(selectedPrinter, 'qrcode3.Lblx', batch);
      addLog(`${SEPARATOR_COUNT} \u4e2a\u5206\u9694\u7b26\u5df2\u53d1\u9001`, '0000', 'info');
    } catch (e: any) {
      addLog(`\u5206\u9694\u7b26\u6253\u5370\u5931\u8d25: ${e.message}`, undefined, 'error');
    }
  };

  const printLabels = async (labels: PrintLabel[]) => {
    if (!isCCAvailable() || !labels.length) return;
    const batch = labels.map(l => ({ barcode: l.barcode, data: l.sku_name, Field3: l.worker_name }));
    try {
      await ccPrint(selectedPrinter, 'qrcode.Lblx', batch);
      addLog(`${labels.length} \u4e2a\u6807\u7b7e\u5df2\u53d1\u9001\u6253\u5370\u673a`, labels[0]?.barcode, 'success');
    } catch (e: any) {
      addLog(`\u6279\u91cf\u6253\u5370\u5931\u8d25: ${e.message}`, undefined, 'error');
    }
  };

  const executePrintFlow = async (transactionIds: number[]) => {
    addLog(`开始打印流程 (${transactionIds.length} 条记录)`, undefined, 'info');
    try {
      const res = await api.post('/production/print-with-labels', { transaction_ids: transactionIds });
      const labels: PrintLabel[] = res.data?.data?.labels ?? res.data?.labels ?? [];
      const labelsCreated = res.data?.data?.labels_created ?? labels.length;

      if (isCCAvailable() && labels.length > 0) {
        addLog('打印分隔符...', undefined, 'info');
        await printSeparators();
        await sleep(PRINT_DELAY);
        addLog('打印正式标签...', undefined, 'info');
        await printLabels(labels);
      } else if (!isCCAvailable()) {
        addLog('打印机未连接，仅后端创建标签', undefined, 'warning');
      }

      addLog(`打印完成，创建 ${labelsCreated} 个标签`, undefined, 'success');
      return labelsCreated;
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.response?.data?.detail || '打印失败';
      addLog(`打印失败: ${msg}`, undefined, 'error');
      throw e;
    }
  };

  /* ── Single Print ── */
  const handlePrint = async (row: PrintTransaction) => {
    const id = row.transaction_id ?? row.id;
    setPrintLoading(id);
    try {
      const cnt = await executePrintFlow([id]);
      message.success(`打印成功，已创建 ${cnt} 个标签`);
      fetchTransactions();
      fetchQueueCount();
      fetchTodayPrinted();
    } catch (e: any) {
      message.error(e?.response?.data?.message ?? '打印失败');
    } finally {
      setPrintLoading(null);
    }
  };

  /* ── Batch Print ── */
  const handleBatchPrint = async () => {
    if (!selectedKeys.length) { message.warning('请先选择要打印的记录'); return; }
    setBatchPrinting(true);
    let ok = 0, fail = 0;
    for (const id of selectedKeys) {
      try {
        await executePrintFlow([id]);
        ok++;
      } catch { fail++; }
    }
    message.success(`批量打印完成：成功 ${ok}${fail > 0 ? `，失败 ${fail}` : ''}`);
    setSelectedKeys([]);
    setBatchPrinting(false);
    refresh(true);
  };

  /* ── Delete Transaction ── */
  const handleDelete = async (id: number) => {
    setDeleteLoading(id);
    try {
      await api.delete(`/production/transactions/${id}`);
      message.success('删除成功');
      fetchTransactions();
      fetchQueueCount();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '删除失败');
    } finally {
      setDeleteLoading(null);
    }
  };

  /* ════════════════════════════════════════════════════════════════ */
  /*                        Auto Print                              */
  /* ════════════════════════════════════════════════════════════════ */

  const startAutoPrint = async () => {
    autoStopFlag.current = false;
    setAutoRunning(true);
    addLog('自动打印已启动', undefined, 'info');

    const runLoop = async () => {
      while (!autoStopFlag.current) {
        const res = await api.get('/production/transactions', { params: { is_printed: false } });
        const pending: PrintTransaction[] = Array.isArray(res.data?.data ?? res.data) ? (res.data?.data ?? res.data) : [];
        setTransactions(pending);

        if (pending.length === 0) {
          addLog('暂无待打印记录，等待新任务...', undefined, 'info');
          await sleep(5000);
          continue;
        }

        setAutoProgress({ current: 0, total: pending.length });

        for (let i = 0; i < pending.length; i++) {
          if (autoStopFlag.current) break;
          const tx = pending[i];
          const txId = tx.transaction_id ?? tx.id;
          try {
            await executePrintFlow([txId]);
            addLog(`自动打印完成 [${i + 1}/${pending.length}]`, undefined, 'success');
          } catch {
            addLog(`自动打印失败 #${txId}`, undefined, 'error');
          }
          setAutoProgress({ current: i + 1, total: pending.length });
          if (i < pending.length - 1) await sleep(500);
        }

        fetchTransactions();
        fetchQueueCount();
        fetchTodayPrinted();

        if (!autoStopFlag.current) {
          addLog('本轮完成，5秒后检查新任务...', undefined, 'info');
          await sleep(5000);
        }
      }
    };

    try {
      await runLoop();
    } finally {
      setAutoRunning(false);
      addLog('自动打印已停止', undefined, 'warning');
    }
  };

  const stopAutoPrint = () => {
    autoStopFlag.current = true;
    addLog('正在停止自动打印...', undefined, 'warning');
  };

  /* ════════════════════════════════════════════════════════════════ */
  /*                        History                                 */
  /* ════════════════════════════════════════════════════════════════ */

  const fetchHistory = useCallback(async (pg = 1) => {
    setHistoryLoading(true);
    try {
      const res = await api.get('/production/printed-labels', { params: { page: pg, page_size: 20 } });
      setHistoryData(res.data?.data ?? []);
      setHistoryTotal(res.data?.total ?? 0);
      setHistoryPage(pg);
    } catch { setHistoryData([]); }
    finally { setHistoryLoading(false); }
  }, []);

  const fetchSkuAndWorkers = useCallback(async () => {
    try {
      const [sRes, wRes] = await Promise.all([
        api.get('/inventory/sku').catch(() => ({ data: { data: [] } })),
        api.get('/workers', { params: { page: 1, page_size: 500 } }).catch(() => ({ data: { data: [] } })),
      ]);
      setSkuList(Array.isArray(sRes.data?.data ?? sRes.data) ? (sRes.data?.data ?? sRes.data) : []);
      setWorkerList(Array.isArray(wRes.data?.data ?? wRes.data) ? (wRes.data?.data ?? wRes.data) : []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (viewTab === 'history') fetchHistory(1);
  }, [viewTab, fetchHistory]);

  /* ════════════════════════════════════════════════════════════════ */
  /*                        Reprint                                 */
  /* ════════════════════════════════════════════════════════════════ */

  const openReprintFromLabel = (label: PrintedLabelItem) => {
    setReprintFromLabel(label);
    reprintForm.setFieldsValue({ quantity: 1, reason: '' });
    setReprintOpen(true);
  };

  const openReprintNew = () => {
    setReprintFromLabel(null);
    reprintForm.resetFields();
    reprintForm.setFieldsValue({ quantity: 1 });
    fetchSkuAndWorkers();
    setReprintOpen(true);
  };

  const handleReprint = async () => {
    const vals = await reprintForm.validateFields();
    setReprintLoading(true);
    try {
      const payload: any = { quantity: vals.quantity, reason: vals.reason || '' };
      if (reprintFromLabel) {
        payload.label_id = reprintFromLabel.id;
      } else {
        if (!vals.sku_id) { message.warning('请选择 SKU'); setReprintLoading(false); return; }
        payload.sku_id = vals.sku_id;
        payload.worker_id = vals.worker_id || null;
      }
      const res = await api.post('/production/reprint', payload);
      const cnt = res.data?.data?.labels_created ?? vals.quantity;
      message.success(`补打成功，已创建 ${cnt} 个标签`);
      addLog(`补打成功 x${cnt}`, undefined, 'success');
      setReprintOpen(false);
      if (viewTab === 'history') fetchHistory(historyPage);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '补打失败');
    } finally { setReprintLoading(false); }
  };

  /* ════════════════════════════════════════════════════════════════ */
  /*                     Barcode Batch Lookup                       */
  /* ════════════════════════════════════════════════════════════════ */

  const handleBarcodeLookup = async () => {
    const lines = barcodeInput.trim().split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) { message.warning('请输入至少一个条码'); return; }
    setBarcodeLoading(true);
    try {
      const res = await api.post('/production/batch-lookup', { barcodes: lines });
      setBarcodeResults(res.data?.data ?? res.data ?? []);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '查询失败');
    } finally { setBarcodeLoading(false); }
  };

  const handleBarcodeReprint = async (item: BatchLookupResult) => {
    if (!item.label_id) { message.warning('无法补打：标签ID缺失'); return; }
    try {
      await api.post('/production/reprint', { label_id: item.label_id, quantity: 1, reason: '条码查询补打' });
      message.success('补打成功');
      addLog('条码查询补打', item.barcode, 'success');
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '补打失败');
    }
  };

  /* ════════════════════════════════════════════════════════════════ */
  /*                          Render Helpers                        */
  /* ════════════════════════════════════════════════════════════════ */

  const printerStatusIcon = () => {
    const m: Record<PrinterStatus, { color: string; label: string }> = {
      connected: { color: '#52c41a', label: '已连接' },
      detecting: { color: '#faad14', label: '检测中' },
      disconnected: { color: '#ff4d4f', label: '未连接' },
    };
    const s = m[printerStatus];
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 12px', borderRadius: 20, fontSize: 12, fontWeight: 500, background: `${s.color}10`, border: `1px solid ${s.color}20` }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.color, boxShadow: `0 0 6px ${s.color}60`, animation: printerStatus === 'detecting' ? 'pulse-glow 1.5s infinite' : printerStatus === 'connected' ? 'pulse-glow 3s infinite' : 'none' }} />
        <span style={{ color: s.color }}>{s.label}</span>
      </div>
    );
  };

  const logStatusTag = (status: LogEntry['status']) => {
    const m: Record<string, { color: string; icon: React.ReactNode }> = {
      success: { color: 'success', icon: <CheckCircleOutlined /> },
      error: { color: 'error', icon: <CloseCircleOutlined /> },
      warning: { color: 'warning', icon: <ExclamationCircleOutlined /> },
      info: { color: 'processing', icon: <ThunderboltOutlined /> },
    };
    const s = m[status] || m.info;
    return <Tag color={s.color} icon={s.icon} style={{ borderRadius: 6, fontSize: 11 }}>{status}</Tag>;
  };

  /* ── Pending Table Columns ── */
  const pendingColumns: any[] = [
    {
      title: 'ID', key: 'id', width: 60,
      render: (_: any, r: PrintTransaction) => <span className="num" style={{ color: 'var(--text-4)', fontSize: 12 }}>#{r.transaction_id ?? r.id}</span>,
    },
    {
      title: '工人', dataIndex: 'worker_name', width: 130,
      render: (v: string) => (
        <Space size={8}>
          <Avatar size={26} style={{ background: COLORS[(v || '').charCodeAt(0) % COLORS.length], fontWeight: 700, fontSize: 11, boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}>
            {(v || '?').charAt(0)}
          </Avatar>
          <span style={{ fontWeight: 600 }}>{v || '-'}</span>
        </Space>
      ),
    },
    {
      title: 'SKU', dataIndex: 'sku_name', width: 150,
      render: (v: string) => (
        <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 6, fontSize: 12, fontWeight: 500, background: 'linear-gradient(135deg, rgba(22,119,255,0.08), rgba(22,119,255,0.03))', color: '#1677ff', border: '1px solid rgba(22,119,255,0.12)' }}>{v || '-'}</span>
      ),
    },
    {
      title: '水果', dataIndex: 'fruit_name', width: 100,
      render: (v: string) => (
        <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 6, fontSize: 12, fontWeight: 500, background: 'linear-gradient(135deg, rgba(0,185,107,0.08), rgba(0,185,107,0.03))', color: '#00b96b', border: '1px solid rgba(0,185,107,0.12)' }}>{v || '-'}</span>
      ),
    },
    {
      title: '数量', dataIndex: 'quantity', width: 80, align: 'right' as const,
      render: (v: any) => <span className="num" style={{ fontWeight: 700, color: '#fa8c16' }}>{v}</span>,
    },
    {
      title: '日期', dataIndex: 'transaction_date', width: 140,
      render: (v: string) => <span style={{ color: 'var(--text-2)', fontSize: 13 }}>{v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'}</span>,
    },
    {
      title: '操作', key: 'action', width: 160, align: 'center' as const,
      render: (_: any, row: PrintTransaction) => {
        const id = row.transaction_id ?? row.id;
        return (
          <Space size={4}>
            <Button type="primary" size="small" icon={<PrinterOutlined />}
              loading={printLoading === id}
              onClick={() => handlePrint(row)}
              style={{ borderRadius: 8, fontWeight: 600, fontSize: 12, boxShadow: '0 2px 8px rgba(22,119,255,0.15)' }}>
              打印
            </Button>
            <Popconfirm title="确定删除此记录？" description="删除后不可恢复" onConfirm={() => handleDelete(id)} okText="确认删除" cancelText="取消" okButtonProps={{ danger: true }}>
              <Button type="text" size="small" danger icon={<DeleteOutlined />} loading={deleteLoading === id}
                style={{ borderRadius: 8, fontSize: 12 }} />
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  /* ── History Table Columns ── */
  const historyColumns: any[] = [
    { title: 'ID', dataIndex: 'id', width: 60, render: (v: number) => <span className="num" style={{ color: 'var(--text-4)', fontSize: 12 }}>#{v}</span> },
    {
      title: '工人', dataIndex: 'worker_name', width: 120,
      render: (v: string) => (
        <Space size={6}>
          <Avatar size={24} style={{ background: COLORS[(v || '').charCodeAt(0) % COLORS.length], fontWeight: 700, fontSize: 10 }}>{(v || '?')[0]}</Avatar>
          <span style={{ fontWeight: 600 }}>{v || '-'}</span>
        </Space>
      ),
    },
    {
      title: 'SKU', dataIndex: 'sku_name', width: 140,
      render: (v: string) => <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 6, fontSize: 12, fontWeight: 500, background: 'linear-gradient(135deg, rgba(22,119,255,0.08), rgba(22,119,255,0.03))', color: '#1677ff', border: '1px solid rgba(22,119,255,0.12)' }}>{v || '-'}</span>,
    },
    {
      title: '水果', dataIndex: 'fruit_name', width: 90,
      render: (v: string) => <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: 6, fontSize: 12, fontWeight: 500, background: 'rgba(0,185,107,0.06)', color: '#00b96b' }}>{v || '-'}</span>,
    },
    {
      title: '预估重量', dataIndex: 'estimated_weight', width: 90, align: 'right' as const,
      render: (v: number) => <span className="num" style={{ fontWeight: 500 }}>{v ? `${v}kg` : '-'}</span>,
    },
    {
      title: '出库', dataIndex: 'scanned_outbound', width: 70, align: 'center' as const,
      render: (v: boolean) => v ? <Tag color="success" style={{ borderRadius: 6 }}>已出库</Tag> : <Tag style={{ borderRadius: 6 }}>未出库</Tag>,
    },
    {
      title: '打印时间', dataIndex: 'created_at', width: 140,
      render: (v: string) => <span style={{ color: 'var(--text-2)', fontSize: 12 }}>{v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'}</span>,
    },
    {
      title: '操作', key: 'action', width: 80, align: 'center' as const,
      render: (_: any, row: PrintedLabelItem) => (
        <Tooltip title="补打此标签">
          <Button type="text" size="small" icon={<RedoOutlined />} onClick={() => openReprintFromLabel(row)}
            style={{ color: '#722ed1', borderRadius: 6 }} />
        </Tooltip>
      ),
    },
  ];

  /* ── Barcode Table Columns ── */
  const barcodeColumns: any[] = [
    { title: '条码', dataIndex: 'barcode', width: 160, render: (v: string) => <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{v}</span> },
    { title: 'SKU', dataIndex: 'sku_name', width: 140, render: (v: string) => v || '-' },
    { title: '工人', dataIndex: 'worker_name', width: 120, render: (v: string) => v || '-' },
    {
      title: '状态', dataIndex: 'status', width: 100,
      render: (v: string) => {
        if (!v) return <Tag style={{ borderRadius: 6 }}>未找到</Tag>;
        return <Tag color={v === 'active' ? 'success' : 'default'} style={{ borderRadius: 6 }}>{v}</Tag>;
      },
    },
    {
      title: '出库', dataIndex: 'scanned_outbound', width: 80, align: 'center' as const,
      render: (v: boolean) => v ? <Tag color="success" style={{ borderRadius: 6 }}>已出库</Tag> : <Tag style={{ borderRadius: 6 }}>未出库</Tag>,
    },
    {
      title: '操作', key: 'action', width: 80, align: 'center' as const,
      render: (_: any, row: BatchLookupResult) => row.label_id ? (
        <Button type="link" size="small" icon={<RedoOutlined />} onClick={() => handleBarcodeReprint(row)}
          style={{ borderRadius: 6, fontSize: 12 }}>
          补打
        </Button>
      ) : null,
    },
  ];

  /* ════════════════════════════════════════════════════════════════ */
  /*                           Stats Cards                          */
  /* ════════════════════════════════════════════════════════════════ */

  const statsCards = [
    { label: '待打印', value: transactions.length, unit: '条', icon: <PrinterOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.15)' },
    { label: '今日已打印', value: todayPrinted, unit: '条', icon: <FileTextOutlined />, gradient: 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: 'rgba(0,185,107,0.15)' },
    { label: '打印机', value: printerList.length || 0, unit: '台', icon: <PrinterOutlined />, gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', glow: 'rgba(114,46,209,0.15)', extra: printerStatusIcon() },
    { label: '自动打印', value: autoRunning ? 'ON' : 'OFF', unit: '', icon: <ThunderboltOutlined />, gradient: autoRunning ? 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)' : 'linear-gradient(135deg, #8c8c8c 0%, #bfbfbf 100%)', glow: autoRunning ? 'rgba(250,140,22,0.15)' : 'rgba(0,0,0,0.05)' },
  ];

  /* ════════════════════════════════════════════════════════════════ */
  /*                             JSX                                */
  /* ════════════════════════════════════════════════════════════════ */

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {contextHolder}

      {/* ── Animated Styles ── */}
      <style>{`
        @keyframes pulse-glow { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes stagger-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
        .stat-card { transition: all 0.3s cubic-bezier(0.22,1,0.36,1); cursor: default; }
        .stat-card:hover { transform: translateY(-3px); box-shadow: 0 8px 24px rgba(0,0,0,0.1) !important; }
        .glass-panel { transition: all 0.3s; }
        .glass-panel:hover { box-shadow: 0 8px 32px rgba(0,0,0,0.06) !important; }
        .log-row { padding: 6px 12px; border-bottom: 1px solid rgba(0,0,0,0.03); transition: background 0.2s; }
        .log-row:hover { background: rgba(22,119,255,0.02); }
      `}</style>

      {/* ══════════════ Page Header ══════════════ */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22,
        padding: '20px 24px', borderRadius: 16,
        background: 'linear-gradient(135deg, rgba(22,119,255,0.06) 0%, rgba(114,46,209,0.04) 50%, rgba(250,140,22,0.03) 100%)',
        border: '1px solid rgba(22,119,255,0.08)',
        backdropFilter: 'blur(12px)',
        flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 36, height: 36, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #1677ff 0%, #722ed1 100%)', color: '#fff', fontSize: 16,
              boxShadow: '0 4px 14px rgba(22,119,255,0.25)',
            }}><PrinterOutlined /></span>
            标签打印中心
            {printerStatusIcon()}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 46 }}>
            管理打印队列 · 支持 CCPrintingAPI 本地打印
            {lastUpdate && <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-4)' }}>最后更新 {lastUpdate}</span>}
          </div>
        </div>
        <Space size={8} wrap>
          {/* Printer Selector */}
          <Select
            value={selectedPrinter || undefined}
            onChange={setSelectedPrinter}
            placeholder="选择打印机"
            style={{ minWidth: 180, borderRadius: 10 }}
            options={printerList.map(p => ({ value: p, label: p }))}
            notFoundContent="未检测到打印机"
            allowClear={false}
            disabled={printerStatus !== 'connected'}
          />
          <Tooltip title="重新检测打印机">
            <Button icon={<SyncOutlined />} onClick={detectPrinters} style={{ borderRadius: 10, height: 32, width: 32 }} />
          </Tooltip>
          <Badge count={queueCount} size="small" offset={[-4, 4]}>
            <div style={{
              padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 500,
              background: 'linear-gradient(135deg, rgba(250,140,22,0.08), rgba(250,140,22,0.04))',
              color: '#fa8c16', border: '1px solid rgba(250,140,22,0.12)',
            }}>队列</div>
          </Badge>
          {selectedKeys.length > 0 && (
            <Button type="primary" icon={<PrinterOutlined />} loading={batchPrinting}
              onClick={handleBatchPrint}
              style={{ borderRadius: 10, fontWeight: 600, background: 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', border: 'none', boxShadow: '0 3px 12px rgba(0,185,107,0.25)' }}>
              批量打印 ({selectedKeys.length})
            </Button>
          )}
          <Tooltip title="补打标签">
            <Button icon={<RedoOutlined />} onClick={openReprintNew}
              style={{ borderRadius: 10, height: 32, fontWeight: 600, color: '#722ed1', borderColor: 'rgba(114,46,209,0.3)' }}>
              补打
            </Button>
          </Tooltip>
          <Tooltip title="手动刷新">
            <Button icon={<SyncOutlined spin={refreshSpin} />} onClick={() => refresh()}
              style={{ borderRadius: 10, height: 32, width: 32 }} />
          </Tooltip>
        </Space>
      </div>

      {/* ══════════════ Stats Cards ══════════════ */}
      <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
        {statsCards.map((s, i) => (
          <Col xs={12} sm={6} key={i}>
            <div className="stat-card" style={{
              padding: '14px 16px', borderRadius: 14, background: s.gradient, position: 'relative', overflow: 'hidden',
              boxShadow: `0 4px 14px ${s.glow}`,
              animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`,
              animationDelay: `${i * 0.08}s`,
            }}>
              <div style={{ position: 'absolute', top: -12, right: -12, width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', bottom: -8, left: -8, width: 30, height: 30, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', pointerEvents: 'none' }} />
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>{s.icon} {s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', lineHeight: 1.2, display: 'flex', alignItems: 'baseline', gap: 4 }} className="num">
                {s.value}{s.unit && <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.7 }}>{s.unit}</span>}
              </div>
              {s.extra && <div style={{ marginTop: 4 }}>{s.extra}</div>}
            </div>
          </Col>
        ))}
      </Row>

      {/* ══════════════ Print Mode + View Tabs ══════════════ */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <Segmented
          value={viewTab}
          onChange={v => setViewTab(v as ViewTab)}
          options={[
            { value: 'pending', icon: <PrinterOutlined />, label: `待打印 (${transactions.length})` },
            { value: 'history', icon: <HistoryOutlined />, label: '已打印标签' },
            { value: 'barcode', icon: <BarcodeOutlined />, label: '条码查询' },
          ]}
          style={{ borderRadius: 10 }}
        />
        {viewTab === 'pending' && (
          <Space size={8}>
            <Segmented
              value={printMode}
              onChange={v => setPrintMode(v as PrintMode)}
              options={[
                { value: 'manual', label: '手动模式' },
                { value: 'auto', label: '自动模式' },
              ]}
              style={{ borderRadius: 10 }}
            />
            {printMode === 'auto' && (
              autoRunning ? (
                <Button danger icon={<PauseCircleOutlined />} onClick={stopAutoPrint}
                  style={{ borderRadius: 10, fontWeight: 600 }}>
                  停止自动
                </Button>
              ) : (
                <Button type="primary" icon={<PlayCircleOutlined />} onClick={startAutoPrint}
                  style={{ borderRadius: 10, fontWeight: 600, background: 'linear-gradient(135deg, #fa8c16, #ffc53d)', border: 'none', boxShadow: '0 3px 12px rgba(250,140,22,0.25)' }}>
                  开始自动打印
                </Button>
              )
            )}
          </Space>
        )}
      </div>

      {/* ══════════════ Auto Print Progress ══════════════ */}
      {autoRunning && autoProgress.total > 0 && (
        <div style={{ ...glassPanel, padding: '12px 20px', marginBottom: 14 }} className="glass-panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <ThunderboltOutlined style={{ color: '#fa8c16', fontSize: 16 }} />
            <span style={{ fontWeight: 600, fontSize: 13 }}>自动打印进行中</span>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{autoProgress.current} / {autoProgress.total}</span>
          </div>
          <Progress
            percent={Math.round((autoProgress.current / autoProgress.total) * 100)}
            strokeColor={{ from: '#fa8c16', to: '#ffc53d' }}
            size="small"
            style={{ marginBottom: 0 }}
          />
        </div>
      )}

      {/* ══════════════ Main Content ══════════════ */}
      {viewTab === 'pending' && (
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title"><PrinterOutlined style={{ color: '#1677ff' }} />待打印列表</span>
            <span style={{ fontSize: 12, color: 'var(--text-4)' }}>共 {transactions.length} 条 · 每 {POLL_INTERVAL / 1000}s 自动刷新</span>
          </div>
          <Table dataSource={transactions} columns={pendingColumns} rowKey={r => r.transaction_id ?? r.id} size="middle"
            loading={loading}
            rowSelection={{
              selectedRowKeys: selectedKeys,
              onChange: keys => setSelectedKeys(keys as number[]),
            }}
            pagination={{ pageSize: 10, showSizeChanger: true, showTotal: t => `共 ${t} 条` }}
            locale={{ emptyText: <Empty description="暂无待打印记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          />
        </div>
      )}

      {viewTab === 'history' && (
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title"><HistoryOutlined style={{ color: '#722ed1' }} />已打印标签</span>
            <span style={{ fontSize: 12, color: 'var(--text-4)' }}>共 {historyTotal} 条</span>
          </div>
          <Table
            dataSource={historyData}
            rowKey="id"
            size="middle"
            loading={historyLoading}
            pagination={{
              current: historyPage, pageSize: 20, total: historyTotal,
              showTotal: t => `共 ${t} 条`,
              onChange: p => fetchHistory(p),
            }}
            scroll={{ x: 800 }}
            locale={{ emptyText: <Empty description="暂无已打印标签" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
            columns={historyColumns}
          />
        </div>
      )}

      {viewTab === 'barcode' && (
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title"><BarcodeOutlined style={{ color: '#13c2c2' }} />条码批量查询</span>
          </div>
          <div style={{ padding: '16px 20px' }}>
            <div style={{ ...glassPanel, padding: 16, marginBottom: 16 }} className="glass-panel">
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-2)' }}>
                <BarcodeOutlined style={{ marginRight: 6 }} />输入条码（一行一个）
              </div>
              <TextArea
                value={barcodeInput}
                onChange={e => setBarcodeInput(e.target.value)}
                placeholder={'请输入条码，每行一个\n例如：\nBC202403060001\nBC202403060002\nBC202403060003'}
                rows={5}
                style={{ borderRadius: 10, fontFamily: 'monospace', fontSize: 13 }}
              />
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <Button type="primary" icon={<SearchOutlined />} loading={barcodeLoading} onClick={handleBarcodeLookup}
                  style={{ borderRadius: 10, fontWeight: 600, background: 'linear-gradient(135deg, #13c2c2, #36cfc9)', border: 'none', boxShadow: '0 3px 12px rgba(19,194,194,0.25)' }}>
                  查询
                </Button>
                <Button onClick={() => { setBarcodeInput(''); setBarcodeResults([]); }}
                  style={{ borderRadius: 10 }}>
                  清空
                </Button>
              </div>
            </div>
            {barcodeResults.length > 0 && (
              <Table
                dataSource={barcodeResults}
                rowKey="barcode"
                size="middle"
                columns={barcodeColumns}
                pagination={false}
                scroll={{ x: 600 }}
              />
            )}
            {barcodeResults.length === 0 && !barcodeLoading && barcodeInput.trim() === '' && (
              <Empty description="输入条码后点击查询" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '30px 0' }} />
            )}
          </div>
        </div>
      )}

      {/* ══════════════ Print Log Panel ══════════════ */}
      <div style={{ marginTop: 18 }}>
        <Collapse
          ghost
          items={[{
            key: 'log',
            label: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 24, height: 24, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: 'linear-gradient(135deg, #1677ff, #722ed1)', color: '#fff', fontSize: 11,
                }}><UnorderedListOutlined /></span>
                <span style={{ fontWeight: 600, fontSize: 13 }}>打印日志</span>
                {printLogs.length > 0 && (
                  <Badge count={printLogs.length} size="small" style={{ backgroundColor: '#1677ff' }} />
                )}
              </div>
            ),
            children: (
              <div style={{ ...glassPanel, maxHeight: 320, overflowY: 'auto', padding: 0 }}>
                {printLogs.length === 0 ? (
                  <Empty description="暂无打印日志" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '20px 0' }} />
                ) : (
                  printLogs.map((log, i) => (
                    <div key={i} className="log-row" style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
                      <span style={{ color: 'var(--text-4)', fontFamily: 'monospace', minWidth: 64, fontSize: 11 }}>{log.time}</span>
                      {logStatusTag(log.status)}
                      <span style={{ flex: 1, color: 'var(--text-2)' }}>{log.action}</span>
                      {log.barcode && (
                        <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#1677ff', background: 'rgba(22,119,255,0.06)', padding: '1px 6px', borderRadius: 4 }}>
                          {log.barcode}
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            ),
          }]}
          style={{ borderRadius: 12 }}
        />
      </div>

      {/* ══════════════ Reprint Modal ══════════════ */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #722ed1, #b37feb)', color: '#fff', fontSize: 13,
            }}><RedoOutlined /></span>
            {reprintFromLabel ? `补打标签 #${reprintFromLabel.id}` : '补打标签'}
          </div>
        }
        open={reprintOpen}
        onOk={handleReprint}
        onCancel={() => setReprintOpen(false)}
        confirmLoading={reprintLoading}
        okText="确认补打"
        cancelText="取消"
        destroyOnClose
        width={480}
        styles={{ body: { paddingTop: 16 } }}
      >
        {reprintFromLabel ? (
          <div style={{
            padding: '14px 16px', borderRadius: 12, marginBottom: 16,
            background: 'linear-gradient(135deg, rgba(114,46,209,0.04), rgba(22,119,255,0.03))',
            border: '1px solid rgba(114,46,209,0.1)',
          }}>
            <div style={{ fontSize: 13, marginBottom: 4 }}>
              <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{reprintFromLabel.sku_name}</span>
              <span style={{ color: 'var(--text-4)', margin: '0 6px' }}>·</span>
              <span style={{ color: '#00b96b' }}>{reprintFromLabel.fruit_name}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
              工人: {reprintFromLabel.worker_name} · 预估重量: {reprintFromLabel.estimated_weight}kg
            </div>
          </div>
        ) : null}
        <Form form={reprintForm} layout="vertical">
          {!reprintFromLabel && (
            <>
              <Form.Item name="sku_id" label="SKU" rules={[{ required: true, message: '请选择 SKU' }]}>
                <Select
                  placeholder="选择要补打的 SKU"
                  showSearch optionFilterProp="label"
                  options={skuList.map(s => ({ value: s.id, label: `${s.sku_name} (${s.fruit_name})` }))}
                />
              </Form.Item>
              <Form.Item name="worker_id" label="工人（可选）">
                <Select
                  placeholder="选择关联工人"
                  showSearch optionFilterProp="label" allowClear
                  options={workerList.map((w: any) => ({ value: w.id, label: w.real_name || w.username }))}
                />
              </Form.Item>
            </>
          )}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="quantity" label="补打数量" rules={[{ required: true, message: '请输入数量' }]}>
                <InputNumber min={1} max={100} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="reason" label="补打原因">
                <Input placeholder="如：标签损坏、丢失等" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
