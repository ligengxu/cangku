'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Card, Input, Button, Table, Tag, Space, Typography, Row, Col,
  Statistic, message, Alert, Modal, Form, InputNumber, Divider,
  Tooltip, Switch, Empty, Spin, Badge, Select, Collapse,
} from 'antd';
import {
  ScanOutlined, CheckCircleOutlined, WarningOutlined,
  CloseCircleOutlined, ReloadOutlined, SettingOutlined,
  ThunderboltOutlined, HistoryOutlined, DashboardOutlined,
  SoundOutlined, AimOutlined, CaretRightOutlined,
  FieldTimeOutlined, NumberOutlined, UndoOutlined,
  ApiOutlined,
} from '@ant-design/icons';
import api from '@/services/api';

const { Title, Text } = Typography;

interface ScanResult {
  label_id: number;
  sku_id: number;
  sku_name: string;
  fruit_name: string;
  worker_id: number;
  worker_name: string;
  batch_id: number;
  estimated_weight: number;
  actual_weight: number;
  weight_difference: number;
  scanned_time: string;
  weight_warning: string | null;
}

interface RecentScan {
  id: number;
  sku_id: number;
  sku_name: string;
  fruit_name: string;
  worker_id: number;
  worker_name: string;
  estimated_weight: number;
  actual_weight: number;
  weight_difference: number;
  scanned_time: string;
}

interface OutboundStats {
  date: string;
  total_outbound: number;
  total_weight: number;
  worker_count: number;
  sku_count: number;
}

interface WeightSettings {
  max_weight_difference: number;
  max_weight_percentage: number | null;
  mode: string;
}

interface MachineInfo {
  machine_number: string;
  total_scans: number;
  last_active: string | null;
}

interface DeviceRecord {
  id: number;
  tickets_num: string;
  weight: number;
  is_success: boolean;
  message: string;
  upload_time: string | null;
  weight_difference: number;
  worker_name: string;
  scan_count: number;
}

export default function ScanWorkstationPage() {
  const [labelInput, setLabelInput] = useState('');
  const [weightInput, setWeightInput] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [recentScans, setRecentScans] = useState<RecentScan[]>([]);
  const [stats, setStats] = useState<OutboundStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoWeight, setAutoWeight] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [weightSettings, setWeightSettings] = useState<WeightSettings>({ max_weight_difference: 0.5, max_weight_percentage: null, mode: 'absolute' });
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsForm] = Form.useForm();
  const inputRef = useRef<any>(null);
  const scanCount = useRef(0);

  // Continuous scan counter state
  const [continuousScanCount, setContinuousScanCount] = useState(0);
  const [scanTimestamps, setScanTimestamps] = useState<number[]>([]);
  const [scanRate, setScanRate] = useState(0);
  const scanRateTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Weighing machine monitor state
  const [machines, setMachines] = useState<MachineInfo[]>([]);
  const [selectedMachine, setSelectedMachine] = useState<string>('');
  const [deviceRecords, setDeviceRecords] = useState<DeviceRecord[]>([]);
  const [deviceScanCount, setDeviceScanCount] = useState(0);
  const [deviceLastId, setDeviceLastId] = useState(0);
  const [deviceConnected, setDeviceConnected] = useState(false);
  const deviceLastDataTime = useRef<number>(0);
  const devicePollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectionCheckTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const r = await api.get('/production/outbound/stats');
      setStats(r.data?.data);
    } catch { /* ignore */ }
  }, []);

  const fetchRecent = useCallback(async () => {
    try {
      const r = await api.get('/production/outbound/recent-scans', { params: { limit: 30 } });
      setRecentScans(r.data?.data || []);
    } catch { /* ignore */ }
  }, []);

  const fetchWeightSettings = useCallback(async () => {
    try {
      const r = await api.get('/production/weight-settings');
      const d = r.data?.data;
      if (d) setWeightSettings(d);
    } catch { /* ignore */ }
  }, []);

  const fetchMachines = useCallback(async () => {
    try {
      const r = await api.get('/device/machines');
      const list = r.data?.data || [];
      setMachines(list);
      if (list.length > 0 && !selectedMachine) {
        setSelectedMachine(list[0].machine_number);
      }
    } catch { /* ignore */ }
  }, [selectedMachine]);

  const fetchDeviceRecords = useCallback(async () => {
    if (!selectedMachine) return;
    try {
      const r = await api.get(`/device/latest-records/${selectedMachine}/${deviceLastId}`);
      const d = r.data?.data;
      if (d?.records?.length) {
        deviceLastDataTime.current = Date.now();
        setDeviceConnected(true);
        setDeviceRecords(prev => {
          const combined = [...d.records, ...prev];
          return combined.slice(0, 30);
        });
        const maxId = Math.max(...d.records.map((r: DeviceRecord) => r.id));
        setDeviceLastId(maxId);
      }
      if (d?.scan_count !== undefined) setDeviceScanCount(d.scan_count);
    } catch { /* ignore */ }
  }, [selectedMachine, deviceLastId]);

  useEffect(() => {
    fetchStats();
    fetchRecent();
    fetchWeightSettings();
    fetchMachines();
    const id = setInterval(() => { fetchStats(); fetchRecent(); }, 15000);
    return () => clearInterval(id);
  }, [fetchStats, fetchRecent, fetchWeightSettings, fetchMachines]);

  useEffect(() => {
    if (!selectedMachine) return;
    setDeviceRecords([]);
    setDeviceLastId(0);
    setDeviceScanCount(0);
    deviceLastDataTime.current = 0;
  }, [selectedMachine]);

  useEffect(() => {
    if (!selectedMachine) return;
    fetchDeviceRecords();
    if (devicePollTimer.current) clearInterval(devicePollTimer.current);
    devicePollTimer.current = setInterval(fetchDeviceRecords, 2000);
    return () => { if (devicePollTimer.current) clearInterval(devicePollTimer.current); };
  }, [selectedMachine, fetchDeviceRecords]);

  useEffect(() => {
    if (connectionCheckTimer.current) clearInterval(connectionCheckTimer.current);
    connectionCheckTimer.current = setInterval(() => {
      setDeviceConnected(Date.now() - deviceLastDataTime.current < 4000);
    }, 1000);
    return () => { if (connectionCheckTimer.current) clearInterval(connectionCheckTimer.current); };
  }, []);

  useEffect(() => {
    if (scanRateTimer.current) clearInterval(scanRateTimer.current);
    scanRateTimer.current = setInterval(() => {
      const now = Date.now();
      const oneMinAgo = now - 60000;
      setScanTimestamps(prev => prev.filter(t => t > oneMinAgo));
      setScanRate(scanTimestamps.filter(t => t > oneMinAgo).length);
    }, 3000);
    return () => { if (scanRateTimer.current) clearInterval(scanRateTimer.current); };
  }, [scanTimestamps]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [lastResult, lastError]);

  const handleScan = async () => {
    let raw = labelInput.trim();
    if (!raw) { message.warning('请输入或扫描标签编号'); return; }

    let numId: number;
    if (raw.length > 4 && /^\d+$/.test(raw)) {
      numId = parseInt(raw.substring(2), 10);
    } else {
      numId = parseInt(raw, 10);
    }
    if (isNaN(numId) || numId <= 0) { message.error('标签编号无效'); return; }

    setScanning(true);
    setLastError(null);
    setLastResult(null);

    try {
      const r = await api.post('/production/outbound/scan-json', {
        label_id: numId,
        actual_weight: weightInput || 0,
      });
      const data = r.data?.data;
      setLastResult(data);
      scanCount.current += 1;
      setContinuousScanCount(prev => prev + 1);
      setScanTimestamps(prev => [...prev, Date.now()]);

      if (data?.weight_warning) {
        message.warning(data.weight_warning);
      } else {
        message.success(`标签 #${numId} 出库成功`);
      }

      fetchStats();
      fetchRecent();
    } catch (e: any) {
      const detail = e?.response?.data?.detail || '扫码失败';
      setLastError(detail);
      message.error(detail);
    } finally {
      setScanning(false);
      setLabelInput('');
      if (!autoWeight) setWeightInput(null);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleScan();
    }
  };

  const handleSaveSettings = async () => {
    const vals = await settingsForm.validateFields();
    setSettingsLoading(true);
    try {
      await api.put('/production/weight-settings', vals);
      message.success('称重设置已保存');
      setWeightSettings(vals);
      setSettingsOpen(false);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '保存失败');
    } finally {
      setSettingsLoading(false);
    }
  };

  const handleResetScanCounter = () => {
    setContinuousScanCount(0);
    setScanTimestamps([]);
    setScanRate(0);
    message.info('扫码计数已重置');
  };

  const statCards = [
    { title: '今日出库', value: stats?.total_outbound ?? 0, icon: <CheckCircleOutlined />, color: '#52c41a', gradient: 'linear-gradient(135deg, #52c41a, #95de64)' },
    { title: '出库重量', value: stats?.total_weight ?? 0, suffix: 'kg', icon: <DashboardOutlined />, color: '#1677ff', gradient: 'linear-gradient(135deg, #1677ff, #69b1ff)' },
    { title: '工人数', value: stats?.worker_count ?? 0, icon: <AimOutlined />, color: '#722ed1', gradient: 'linear-gradient(135deg, #722ed1, #b37feb)' },
    { title: 'SKU 品类', value: stats?.sku_count ?? 0, icon: <ThunderboltOutlined />, color: '#fa8c16', gradient: 'linear-gradient(135deg, #fa8c16, #ffc53d)' },
  ];

  const columns = [
    {
      title: '标签ID', dataIndex: 'id', width: 80,
      render: (v: number) => <Text strong style={{ color: 'var(--brand)' }}>#{v}</Text>,
    },
    {
      title: 'SKU', dataIndex: 'sku_name', width: 160,
      render: (v: string, r: RecentScan) => (
        <div>
          <div style={{ fontWeight: 500, fontSize: 13 }}>{v}</div>
          {r.fruit_name && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{r.fruit_name}</div>}
        </div>
      ),
    },
    {
      title: '工人', dataIndex: 'worker_name', width: 80,
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: '预估', dataIndex: 'estimated_weight', width: 80,
      render: (v: number) => `${Number(v).toFixed(2)}kg`,
    },
    {
      title: '实称', dataIndex: 'actual_weight', width: 80,
      render: (v: number) => v > 0 ? `${Number(v).toFixed(2)}kg` : '-',
    },
    {
      title: '差值', dataIndex: 'weight_difference', width: 80,
      render: (v: number) => {
        if (!v) return '-';
        const abs = Math.abs(Number(v));
        const color = abs > Number(weightSettings.max_weight_difference) ? '#ff4d4f' : abs > 0.1 ? '#fa8c16' : '#52c41a';
        return <Text style={{ color, fontWeight: 600 }}>{Number(v) > 0 ? '+' : ''}{Number(v).toFixed(2)}kg</Text>;
      },
    },
    {
      title: '时间', dataIndex: 'scanned_time', width: 100,
      render: (v: string) => v ? new Date(v).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-',
    },
  ];

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Page header */}
      <div style={{
        background: 'linear-gradient(135deg, #1677ff 0%, #722ed1 50%, #eb2f96 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: -40, right: -40, width: 200, height: 200,
          borderRadius: '50%', background: 'rgba(255,255,255,0.08)',
        }} />
        <div style={{
          position: 'absolute', bottom: -60, right: 80, width: 160, height: 160,
          borderRadius: '50%', background: 'rgba(255,255,255,0.05)',
        }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
              <span style={{
                width: 42, height: 42, borderRadius: 12,
                background: 'rgba(255,255,255,0.2)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: 20,
              }}>
                <ScanOutlined />
              </span>
              <Title level={3} style={{ margin: 0, color: '#fff' }}>出库扫码工作站</Title>
            </div>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14 }}>
              扫描标签条码 · 录入实际重量 · 实时出库确认
            </Text>
          </div>
          <Space>
            <Tooltip title="称重设置">
              <Button type="text" icon={<SettingOutlined />} onClick={() => { setSettingsOpen(true); settingsForm.setFieldsValue(weightSettings); }}
                style={{ color: '#fff', width: 40, height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.15)' }} />
            </Tooltip>
            <Tooltip title="刷新数据">
              <Button type="text" icon={<ReloadOutlined />} onClick={() => { fetchStats(); fetchRecent(); }}
                style={{ color: '#fff', width: 40, height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.15)' }} />
            </Tooltip>
          </Space>
        </div>
      </div>

      {/* Stats row */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {statCards.map((c, i) => (
          <Col xs={12} sm={6} key={i}>
            <div className="stat-card-hover" style={{
              background: 'var(--bg-card)', borderRadius: 14, padding: '20px 18px',
              border: '1px solid var(--border-2)', boxShadow: 'var(--shadow-1)',
              display: 'flex', alignItems: 'center', gap: 14, transition: 'all 0.3s',
              animation: `fadeSlideUp 0.5s ease ${i * 0.08}s both`,
            }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14, background: c.gradient,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22, color: '#fff', boxShadow: `0 4px 16px ${c.color}30`,
                flexShrink: 0,
              }}>
                {c.icon}
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 2 }}>{c.title}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-1)' }}>
                  {typeof c.value === 'number' ? Number(c.value).toLocaleString() : c.value}
                  {c.suffix && <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-3)', marginLeft: 3 }}>{c.suffix}</span>}
                </div>
              </div>
            </div>
          </Col>
        ))}
      </Row>

      <Row gutter={24}>
        {/* Scan panel */}
        <Col xs={24} lg={10}>
          <Card style={{
            borderRadius: 16, border: '1px solid var(--border-2)',
            background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)',
            boxShadow: 'var(--shadow-2)', marginBottom: 24,
          }} styles={{ body: { padding: 24 } }}>
            {/* Continuous scan counter */}
            <div style={{
              marginBottom: 16, padding: '12px 16px', borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(22,119,255,0.06), rgba(114,46,209,0.04))',
              border: '1px solid rgba(22,119,255,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}><NumberOutlined style={{ marginRight: 3 }} />连续扫码</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--brand)', lineHeight: 1.3 }}>{continuousScanCount}</div>
                </div>
                <div style={{ width: 1, height: 32, background: 'var(--border-2)' }} />
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}><FieldTimeOutlined style={{ marginRight: 3 }} />速率/分钟</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#52c41a', lineHeight: 1.3 }}>{scanRate}</div>
                </div>
              </div>
              <Tooltip title="重置计数">
                <Button
                  size="small" type="text" icon={<UndoOutlined />}
                  onClick={handleResetScanCounter}
                  style={{ color: 'var(--text-3)', borderRadius: 8 }}
                />
              </Tooltip>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
              <ScanOutlined style={{ fontSize: 18, color: 'var(--brand)' }} />
              <Text style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-1)' }}>扫码录入</Text>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 12, color: 'var(--text-3)' }}>保持称重</Text>
                <Switch size="small" checked={autoWeight} onChange={setAutoWeight} />
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <Text style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6, display: 'block' }}>
                标签编号（扫码枪自动输入）
              </Text>
              <Input
                ref={inputRef}
                size="large"
                value={labelInput}
                onChange={e => setLabelInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="扫描或输入标签编号..."
                prefix={<ScanOutlined style={{ color: 'var(--brand)' }} />}
                autoFocus
                style={{
                  borderRadius: 12, height: 52, fontSize: 18, fontWeight: 600,
                  border: '2px solid var(--brand)',
                  boxShadow: '0 0 0 4px rgba(22,119,255,0.08)',
                }}
              />
            </div>

            <div style={{ marginBottom: 20 }}>
              <Text style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6, display: 'block' }}>
                实际重量 (kg)，可选
              </Text>
              <InputNumber
                size="large"
                value={weightInput}
                onChange={v => setWeightInput(v)}
                placeholder="0.00"
                min={0}
                max={9999}
                step={0.01}
                precision={2}
                style={{ width: '100%', borderRadius: 12, height: 48 }}
                addonAfter="kg"
              />
            </div>

            <Button
              type="primary"
              size="large"
              block
              loading={scanning}
              onClick={handleScan}
              icon={<ThunderboltOutlined />}
              style={{
                height: 52, borderRadius: 12, fontWeight: 600, fontSize: 16,
                background: 'linear-gradient(135deg, #1677ff, #722ed1)',
                border: 'none', boxShadow: '0 4px 16px rgba(22,119,255,0.3)',
              }}
            >
              确认出库
            </Button>

            <div style={{
              marginTop: 12, padding: '8px 12px', borderRadius: 8,
              background: 'rgba(22,119,255,0.04)', textAlign: 'center',
            }}>
              <Text style={{ fontSize: 12, color: 'var(--text-3)' }}>
                <SoundOutlined style={{ marginRight: 4 }} />
                扫码枪扫描后自动回车确认 · 可手动输入ID
              </Text>
            </div>
          </Card>

          {/* Last scan result */}
          {lastResult && (
            <Card style={{
              borderRadius: 16, marginBottom: 24, overflow: 'hidden',
              border: lastResult.weight_warning ? '2px solid #faad14' : '2px solid #52c41a',
              animation: 'fadeSlideUp 0.4s ease',
            }} styles={{ body: { padding: 0 } }}>
              <div style={{
                background: lastResult.weight_warning
                  ? 'linear-gradient(135deg, #fffbe6, #fff7e6)'
                  : 'linear-gradient(135deg, #f6ffed, #e6fffb)',
                padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 10,
              }}>
                {lastResult.weight_warning
                  ? <WarningOutlined style={{ fontSize: 22, color: '#faad14' }} />
                  : <CheckCircleOutlined style={{ fontSize: 22, color: '#52c41a' }} />}
                <div>
                  <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-1)' }}>
                    {lastResult.weight_warning ? '出库成功（重量异常）' : '出库成功'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    标签 #{lastResult.label_id} · {lastResult.sku_name}
                  </div>
                </div>
              </div>
              <div style={{ padding: '16px 20px' }}>
                <Row gutter={[16, 12]}>
                  <Col span={12}>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>SKU</div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{lastResult.sku_name}</div>
                  </Col>
                  <Col span={12}>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>工人</div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{lastResult.worker_name}</div>
                  </Col>
                  <Col span={8}>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>预估</div>
                    <div style={{ fontWeight: 600, color: 'var(--brand)' }}>{Number(lastResult.estimated_weight).toFixed(2)}kg</div>
                  </Col>
                  <Col span={8}>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>实称</div>
                    <div style={{ fontWeight: 600, color: '#722ed1' }}>
                      {lastResult.actual_weight > 0 ? `${Number(lastResult.actual_weight).toFixed(2)}kg` : '-'}
                    </div>
                  </Col>
                  <Col span={8}>
                    <div style={{ fontSize: 11, color: 'var(--text-3)' }}>差值</div>
                    <div style={{
                      fontWeight: 700,
                      color: Math.abs(Number(lastResult.weight_difference)) > Number(weightSettings.max_weight_difference) ? '#ff4d4f' : '#52c41a',
                    }}>
                      {lastResult.weight_difference !== 0 ? `${Number(lastResult.weight_difference) > 0 ? '+' : ''}${Number(lastResult.weight_difference).toFixed(2)}kg` : '-'}
                    </div>
                  </Col>
                </Row>
                {lastResult.weight_warning && (
                  <Alert
                    type="warning"
                    message={lastResult.weight_warning}
                    style={{ marginTop: 12, borderRadius: 10 }}
                    showIcon
                  />
                )}
              </div>
            </Card>
          )}

          {lastError && (
            <Alert
              type="error"
              message="扫码失败"
              description={lastError}
              showIcon
              icon={<CloseCircleOutlined />}
              closable
              onClose={() => setLastError(null)}
              style={{ borderRadius: 14, marginBottom: 24, animation: 'fadeSlideUp 0.3s ease' }}
            />
          )}

          {/* Weight settings info */}
          <div style={{
            padding: '12px 16px', borderRadius: 12,
            background: 'rgba(22,119,255,0.04)', border: '1px solid rgba(22,119,255,0.08)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <SettingOutlined style={{ color: 'var(--brand)', fontSize: 14 }} />
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>当前称重阈值</div>
              <Text style={{ fontSize: 13, fontWeight: 600 }}>
                最大差值 {weightSettings.max_weight_difference}kg
                {weightSettings.max_weight_percentage ? ` / ${weightSettings.max_weight_percentage}%` : ''}
              </Text>
            </div>
            <Button size="small" type="link" onClick={() => { setSettingsOpen(true); settingsForm.setFieldsValue(weightSettings); }}>
              修改
            </Button>
          </div>
        </Col>

        {/* Recent scans table */}
        <Col xs={24} lg={14}>
          <Card style={{
            borderRadius: 16, border: '1px solid var(--border-2)',
            boxShadow: 'var(--shadow-1)',
          }} styles={{ body: { padding: 0 } }}>
            <div style={{
              padding: '18px 24px', borderBottom: '1px solid var(--border-2)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <HistoryOutlined style={{ color: 'var(--brand)', fontSize: 16 }} />
                <Text style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)' }}>今日扫码流水</Text>
                <Badge count={recentScans.length} style={{ backgroundColor: 'var(--brand)' }} />
              </div>
              <Button size="small" type="text" icon={<ReloadOutlined />} onClick={fetchRecent}>
                刷新
              </Button>
            </div>
            <Table
              dataSource={recentScans}
              columns={columns}
              rowKey="id"
              pagination={false}
              scroll={{ y: 580, x: 680 }}
              size="small"
              locale={{ emptyText: <Empty description="今日暂无出库记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
              style={{ fontSize: 13 }}
              rowClassName={(_, i) => i === 0 && recentScans.length > 0 ? 'scan-latest-row' : ''}
            />
          </Card>

          {/* Weighing machine monitor */}
          <Collapse
            style={{ marginTop: 16, borderRadius: 16, border: '1px solid var(--border-2)', overflow: 'hidden' }}
            defaultActiveKey={[]}
            expandIcon={({ isActive }) => <CaretRightOutlined rotate={isActive ? 90 : 0} />}
            items={[{
              key: 'device-monitor',
              label: (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ApiOutlined style={{ color: '#722ed1', fontSize: 16 }} />
                  <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-1)' }}>称重机监控</span>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: deviceConnected ? '#52c41a' : '#d9d9d9',
                    boxShadow: deviceConnected ? '0 0 6px #52c41a' : 'none',
                    transition: 'all 0.3s',
                  }} />
                  {deviceScanCount > 0 && (
                    <Tag color="purple" style={{ borderRadius: 8, fontSize: 11, margin: 0 }}>今日 {deviceScanCount} 次</Tag>
                  )}
                </div>
              ),
              children: (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                    <Select
                      value={selectedMachine || undefined}
                      onChange={(v) => setSelectedMachine(v)}
                      placeholder="选择机器号"
                      style={{ width: 180 }}
                      options={machines.map(m => ({
                        value: m.machine_number,
                        label: `机器 ${m.machine_number}`,
                      }))}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: deviceConnected ? '#52c41a' : '#d9d9d9',
                        boxShadow: deviceConnected ? '0 0 6px #52c41a' : 'none',
                        transition: 'all 0.3s',
                      }} />
                      <Text style={{ fontSize: 12, color: deviceConnected ? '#52c41a' : 'var(--text-4)' }}>
                        {deviceConnected ? '在线' : '离线'}
                      </Text>
                    </div>
                  </div>

                  <div style={{
                    maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6,
                  }}>
                    {deviceRecords.length === 0 ? (
                      <Empty description="暂无记录" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '20px 0' }} />
                    ) : deviceRecords.map((rec) => (
                      <div key={rec.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                        borderRadius: 10, background: rec.is_success ? 'rgba(82,196,26,0.04)' : 'rgba(255,77,79,0.04)',
                        border: `1px solid ${rec.is_success ? 'rgba(82,196,26,0.12)' : 'rgba(255,77,79,0.12)'}`,
                        animation: 'fadeSlideUp 0.3s ease',
                      }}>
                        <div style={{
                          width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                          background: rec.is_success ? '#52c41a' : '#ff4d4f',
                        }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                            <Text style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-1)' }}>{rec.tickets_num}</Text>
                            <Tag color={rec.is_success ? 'success' : 'error'} style={{ fontSize: 10, borderRadius: 6, lineHeight: '18px', margin: 0 }}>
                              {rec.is_success ? '成功' : '失败'}
                            </Tag>
                          </div>
                          {rec.message && (
                            <Text style={{ fontSize: 11, color: 'var(--text-3)' }} ellipsis>{rec.message}</Text>
                          )}
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#722ed1' }}>
                            {rec.weight > 0 ? `${rec.weight.toFixed(2)}kg` : '-'}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text-4)' }}>
                            {rec.upload_time ? new Date(rec.upload_time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ),
            }]}
          />
        </Col>
      </Row>

      {/* Weight settings modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 28, height: 28, borderRadius: 8,
              background: 'linear-gradient(135deg, #1677ff, #722ed1)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 13,
            }}>
              <SettingOutlined />
            </span>
            称重设置
          </div>
        }
        open={settingsOpen}
        onOk={handleSaveSettings}
        onCancel={() => setSettingsOpen(false)}
        confirmLoading={settingsLoading}
        okText="保存"
        cancelText="取消"
        width={440}
      >
        <Form form={settingsForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="max_weight_difference"
            label="最大重量差值 (kg)"
            rules={[{ required: true, message: '请输入最大差值' }]}
          >
            <InputNumber min={0} max={100} step={0.1} precision={2} style={{ width: '100%' }} addonAfter="kg" />
          </Form.Item>
          <Form.Item
            name="max_weight_percentage"
            label="最大重量差值百分比 (%)"
            extra="可选，与差值取其一超标即告警"
          >
            <InputNumber min={0} max={100} step={1} precision={1} style={{ width: '100%' }} addonAfter="%" />
          </Form.Item>
          <Form.Item name="mode" label="判断模式" initialValue="absolute">
            <Input disabled style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <style jsx global>{`
        .scan-latest-row td {
          background: rgba(22, 119, 255, 0.04) !important;
          border-left: 3px solid var(--brand) !important;
        }
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .stat-card-hover:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-2) !important;
        }
      `}</style>
    </div>
  );
}
