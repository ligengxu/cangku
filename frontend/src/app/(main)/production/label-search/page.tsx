'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Input, Button, Table, Tag, Tooltip, Row, Col,
  Space, Empty, message, Select, DatePicker, Drawer, Descriptions, Avatar,
  Segmented, Spin, Steps,
} from 'antd';
import {
  SearchOutlined, ReloadOutlined, QrcodeOutlined,
  DownloadOutlined, EyeOutlined, CheckCircleOutlined,
  ClockCircleOutlined, InboxOutlined, PrinterOutlined,
  UserOutlined, EnvironmentOutlined, SyncOutlined,
  ShoppingCartOutlined, AuditOutlined, HomeOutlined,
  ScanOutlined, LoadingOutlined, DollarOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dayjs from 'dayjs';
import { exportToCsv } from '@/utils/exportCsv';

const { RangePicker } = DatePicker;

interface LabelItem {
  id: number; barcode: string; sku_name: string; fruit_name: string;
  performance: number; worker_name: string; worker_id: number;
  supplier: string; purchase_date: string; purchase_id: number;
  estimated_weight: number; actual_weight: number; weight_diff: number;
  scanned_outbound: number; scanned_time: string | null; created_at: string | null;
}

interface SearchResult {
  items: LabelItem[];
  total: number; page: number; page_size: number;
  summary: { total: number; outbound: number; instock: number };
}

export default function LabelSearchPage() {
  const [search, setSearch] = useState('');
  const [workerId, setWorkerId] = useState<number | undefined>();
  const [skuId, setSkuId] = useState<number | undefined>();
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [outboundStatus, setOutboundStatus] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SearchResult | null>(null);
  const [workers, setWorkers] = useState<{ id: number; name: string }[]>([]);
  const [skus, setSkus] = useState<{ id: number; name: string }[]>([]);
  const [detailItem, setDetailItem] = useState<LabelItem | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [batchInput, setBatchInput] = useState('');
  const [batchResults, setBatchResults] = useState<any[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [lifecycle, setLifecycle] = useState<any>(null);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/workers/list').catch(() => ({ data: { data: [] } })),
      api.get('/inventory/sku-list').catch(() => ({ data: { data: [] } })),
    ]).then(([wRes, sRes]) => {
      const wData = wRes.data?.data;
      if (Array.isArray(wData)) setWorkers(wData.map((w: any) => ({ id: w.id, name: w.real_name || w.username })));
      const sData = sRes.data?.data;
      if (Array.isArray(sData)) setSkus(sData.map((s: any) => ({ id: s.id, name: s.sku_name })));
    });
  }, []);

  const fetchData = useCallback(async (p?: number) => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page: p ?? page, page_size: pageSize };
      if (search.trim()) params.search = search.trim();
      if (workerId) params.worker_id = workerId;
      if (skuId) params.sku_id = skuId;
      if (dateRange) {
        params.start_date = dateRange[0].format('YYYY-MM-DD');
        params.end_date = dateRange[1].format('YYYY-MM-DD');
      }
      if (outboundStatus !== 'all') params.outbound_status = outboundStatus;

      const res = await api.get('/production/label-search', { params });
      setData(res.data?.data || null);
    } catch { message.error('搜索失败'); }
    finally { setLoading(false); }
  }, [search, workerId, skuId, dateRange, outboundStatus, page, pageSize]);

  const handleSearch = () => { setPage(1); fetchData(1); };

  const handleBatchSearch = async () => {
    if (!batchInput.trim()) return;
    setBatchLoading(true);
    try {
      const barcodes = batchInput.split(/[\n,;，；\s]+/).map(s => s.trim()).filter(Boolean);
      const res = await api.post('/production/batch-lookup', { barcodes });
      setBatchResults(res.data?.data?.results || []);
    } catch { message.error('批量查询失败'); }
    finally { setBatchLoading(false); }
  };

  const openDetail = async (item: LabelItem) => {
    setDetailItem(item);
    setLifecycle(null);
    setLifecycleLoading(true);
    try {
      const res = await api.get(`/production/label-lifecycle/${item.id}`);
      setLifecycle(res.data?.data || null);
    } catch { /* non-critical */ }
    finally { setLifecycleLoading(false); }
  };

  const handleExport = () => {
    if (!data?.items?.length) return;
    exportToCsv(data.items, [
      { key: 'barcode', title: '条码' }, { key: 'sku_name', title: 'SKU' },
      { key: 'fruit_name', title: '水果' }, { key: 'worker_name', title: '工人' },
      { key: 'supplier', title: '供应商' }, { key: 'estimated_weight', title: '预估重量' },
      { key: 'actual_weight', title: '实际重量' }, { key: 'weight_diff', title: '重量差' },
      { key: 'scanned_outbound', title: '出库状态' }, { key: 'created_at', title: '打印时间' },
    ], `标签搜索_${dayjs().format('YYYYMMDD_HHmm')}`);
    message.success('导出成功');
  };

  const columns = [
    {
      title: '条码', dataIndex: 'barcode', width: 110,
      render: (v: string) => (
        <Tag style={{
          fontFamily: 'monospace', fontWeight: 700, fontSize: 13,
          borderRadius: 6, padding: '2px 10px',
          background: 'linear-gradient(135deg, rgba(22,119,255,0.08), rgba(114,46,209,0.08))',
          border: '1px solid rgba(22,119,255,0.15)', color: '#1677ff',
        }}><QrcodeOutlined style={{ marginRight: 4 }} />{v}</Tag>
      ),
    },
    {
      title: 'SKU', key: 'sku', width: 180,
      render: (_: any, r: LabelItem) => (
        <div>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{r.sku_name}</div>
          <div style={{ fontSize: 11, color: 'var(--text-4)' }}>
            <span style={{ color: '#00b96b' }}>{r.fruit_name}</span>
            {r.performance > 0 && <Tag color="purple" style={{ marginLeft: 4, fontSize: 10, borderRadius: 4, padding: '0 4px' }}>{r.performance}</Tag>}
          </div>
        </div>
      ),
    },
    {
      title: '工人', dataIndex: 'worker_name', width: 100,
      render: (v: string, r: LabelItem) => (
        <Space size={4}>
          <Avatar size={22} style={{ background: `hsl(${r.worker_id * 47 % 360},55%,55%)`, fontSize: 10 }}>{v.charAt(0)}</Avatar>
          <span style={{ fontSize: 12, fontWeight: 500 }}>{v}</span>
        </Space>
      ),
    },
    {
      title: '供应商', dataIndex: 'supplier', width: 100, ellipsis: true,
      render: (v: string) => <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{v || '-'}</span>,
    },
    {
      title: '重量', key: 'weight', width: 130,
      render: (_: any, r: LabelItem) => (
        <div style={{ fontSize: 12 }}>
          <div>预估: <span className="num" style={{ fontWeight: 600 }}>{r.estimated_weight.toFixed(1)}</span>g</div>
          {r.actual_weight > 0 && (
            <div>
              实际: <span className="num" style={{ fontWeight: 600, color: r.weight_diff > 0 ? '#ff4d4f' : '#52c41a' }}>{r.actual_weight.toFixed(1)}</span>g
              <span style={{ fontSize: 10, color: r.weight_diff > 0 ? '#ff4d4f' : '#52c41a', marginLeft: 4 }}>
                ({r.weight_diff > 0 ? '+' : ''}{r.weight_diff.toFixed(1)})
              </span>
            </div>
          )}
        </div>
      ),
    },
    {
      title: '状态', dataIndex: 'scanned_outbound', width: 90, align: 'center' as const,
      render: (v: number) => v > 0
        ? <Tag icon={<CheckCircleOutlined />} color="success" style={{ borderRadius: 6 }}>已出库</Tag>
        : <Tag icon={<ClockCircleOutlined />} color="default" style={{ borderRadius: 6 }}>在库</Tag>,
    },
    {
      title: '打印时间', dataIndex: 'created_at', width: 140,
      render: (v: string) => v ? (
        <div style={{ fontSize: 12 }}>
          <div style={{ fontWeight: 500 }}>{dayjs(v).format('YYYY-MM-DD')}</div>
          <div style={{ color: 'var(--text-4)' }}>{dayjs(v).format('HH:mm:ss')}</div>
        </div>
      ) : '-',
    },
    {
      title: '', key: 'action', width: 50,
      render: (_: any, r: LabelItem) => (
        <Tooltip title="查看详情">
          <Button type="text" size="small" icon={<EyeOutlined />} onClick={() => openDetail(r)} />
        </Tooltip>
      ),
    },
  ];

  const batchColumns = [
    { title: '条码', dataIndex: 'barcode', width: 120, render: (v: string) => <Tag style={{ fontFamily: 'monospace', fontWeight: 600 }}>{v}</Tag> },
    { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => v === 'found' ? <Tag color="success">已找到</Tag> : <Tag color="error">未找到</Tag> },
    { title: 'SKU', dataIndex: 'sku_name', width: 150 },
    { title: '工人', dataIndex: 'worker_name', width: 100 },
    { title: '预估重量', dataIndex: 'estimated_weight', width: 100, render: (v: number) => v ? `${v.toFixed(1)}g` : '-' },
    { title: '出库', dataIndex: 'scanned_outbound', width: 80, render: (v: number) => v > 0 ? <Tag color="success">是</Tag> : <Tag>否</Tag> },
    { title: '打印时间', dataIndex: 'created_at', width: 150, render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-' },
  ];

  const stats = data?.summary;

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #1677ff 0%, #722ed1 50%, #eb2f96 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -30, right: -30, width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, position: 'relative', zIndex: 1 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(10px)', fontSize: 24,
          }}>
            <QrcodeOutlined />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#fff' }}>标签搜索管理</h2>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>条码查询 · 批量搜索 · 全生命周期追踪</div>
          </div>
        </div>
      </div>

      {/* Mode Switch */}
      <Segmented
        value={batchMode ? 'batch' : 'single'}
        onChange={v => setBatchMode(v === 'batch')}
        options={[
          { value: 'single', label: '高级搜索' },
          { value: 'batch', label: '批量条码查询' },
        ]}
        style={{ marginBottom: 16 }}
      />

      {batchMode ? (
        <div style={{
          background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)',
          border: '1px solid var(--glass-border)', borderRadius: 14,
          padding: '20px 24px', marginBottom: 20,
        }}>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginBottom: 10 }}>
            输入标签ID（去掉前两位日期），每行一个或用逗号分隔
          </div>
          <Input.TextArea
            value={batchInput}
            onChange={e => setBatchInput(e.target.value)}
            placeholder="例如：\n12345\n12346\n12347"
            rows={5}
            style={{ marginBottom: 12, borderRadius: 10 }}
          />
          <Button type="primary" icon={<SearchOutlined />} onClick={handleBatchSearch} loading={batchLoading}
            style={{ borderRadius: 10 }}>
            批量查询
          </Button>
          {batchResults.length > 0 && (
            <Table
              dataSource={batchResults.map((r, i) => ({ ...r, _k: i }))}
              columns={batchColumns}
              rowKey="_k"
              size="small"
              style={{ marginTop: 16 }}
              pagination={false}
              scroll={{ x: 'max-content' }}
            />
          )}
        </div>
      ) : (
        <>
          {/* Filters */}
          <div style={{
            background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)',
            border: '1px solid var(--glass-border)', borderRadius: 14,
            padding: '16px 20px', marginBottom: 16,
          }}>
            <Row gutter={[10, 10]} align="middle">
              <Col xs={24} sm={6}>
                <Input
                  placeholder="标签ID / 条码"
                  value={search} onChange={e => setSearch(e.target.value)}
                  onPressEnter={handleSearch}
                  prefix={<QrcodeOutlined style={{ color: 'var(--text-4)' }} />}
                  style={{ borderRadius: 10 }}
                  allowClear
                />
              </Col>
              <Col xs={12} sm={4}>
                <Select
                  placeholder="工人" allowClear showSearch optionFilterProp="label"
                  value={workerId} onChange={setWorkerId}
                  options={workers.map(w => ({ value: w.id, label: w.name }))}
                  style={{ width: '100%', borderRadius: 10 }}
                />
              </Col>
              <Col xs={12} sm={4}>
                <Select
                  placeholder="SKU" allowClear showSearch optionFilterProp="label"
                  value={skuId} onChange={setSkuId}
                  options={skus.map(s => ({ value: s.id, label: s.name }))}
                  style={{ width: '100%', borderRadius: 10 }}
                />
              </Col>
              <Col xs={24} sm={6}>
                <RangePicker
                  value={dateRange}
                  onChange={v => setDateRange(v as any)}
                  style={{ width: '100%', borderRadius: 10 }}
                />
              </Col>
              <Col xs={12} sm={4}>
                <Space>
                  <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch} style={{ borderRadius: 10 }}>搜索</Button>
                  <Tooltip title="导出CSV">
                    <Button icon={<DownloadOutlined />} onClick={handleExport} style={{ borderRadius: 10 }} />
                  </Tooltip>
                </Space>
              </Col>
            </Row>
            <div style={{ marginTop: 10 }}>
              <Segmented
                value={outboundStatus}
                onChange={v => { setOutboundStatus(v as string); setPage(1); }}
                options={[
                  { value: 'all', label: `全部${stats ? ` (${stats.total})` : ''}` },
                  { value: 'outbound', label: `已出库${stats ? ` (${stats.outbound})` : ''}` },
                  { value: 'instock', label: `在库${stats ? ` (${stats.instock})` : ''}` },
                ]}
                style={{ fontSize: 12 }}
              />
            </div>
          </div>

          {/* Table */}
          <div style={{
            background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)',
            border: '1px solid var(--glass-border)', borderRadius: 14,
            overflow: 'hidden',
          }}>
            <Table
              dataSource={data?.items || []}
              columns={columns}
              rowKey="id"
              size="small"
              loading={loading}
              scroll={{ x: 'max-content' }}
              pagination={{
                current: data?.page || 1,
                total: data?.total || 0,
                pageSize: pageSize,
                onChange: p => { setPage(p); fetchData(p); },
                showTotal: t => `共 ${t} 条`,
                showSizeChanger: false,
              }}
              locale={{ emptyText: <Empty description="输入条件后点击搜索" /> }}
            />
          </div>
        </>
      )}

      {/* Detail Drawer */}
      <Drawer
        title={<span><QrcodeOutlined style={{ marginRight: 8 }} />标签详情 #{detailItem?.barcode}</span>}
        open={!!detailItem}
        onClose={() => { setDetailItem(null); setLifecycle(null); }}
        width={520}
      >
        {detailItem && (
          <div>
            {/* Barcode hero */}
            <div style={{
              textAlign: 'center', padding: '20px 0 24px',
              background: 'linear-gradient(135deg, rgba(22,119,255,0.04), rgba(114,46,209,0.04))',
              borderRadius: 12, marginBottom: 20,
            }}>
              <div style={{
                fontSize: 32, fontWeight: 800, fontFamily: 'monospace', letterSpacing: 2,
                background: 'linear-gradient(135deg, #1677ff, #722ed1)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>{detailItem.barcode}</div>
              <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'center' }}>
                {detailItem.scanned_outbound > 0
                  ? <Tag icon={<CheckCircleOutlined />} color="success" style={{ borderRadius: 10, fontSize: 13, padding: '4px 16px' }}>已出库</Tag>
                  : <Tag icon={<InboxOutlined />} style={{ borderRadius: 10, fontSize: 13, padding: '4px 16px' }}>在库中</Tag>
                }
                {lifecycle?.commission > 0 && (
                  <Tag icon={<DollarOutlined />} color="purple" style={{ borderRadius: 10, fontSize: 13, padding: '4px 16px' }}>
                    佣金 ¥{Number(lifecycle.commission).toFixed(2)}
                  </Tag>
                )}
              </div>
            </div>

            {/* Basic info */}
            <Descriptions column={2} size="small" labelStyle={{ fontWeight: 600, color: 'var(--text-3)', fontSize: 12 }}
              style={{ marginBottom: 20 }}>
              <Descriptions.Item label="标签ID">{detailItem.id}</Descriptions.Item>
              <Descriptions.Item label="绩效系数">{detailItem.performance}</Descriptions.Item>
              <Descriptions.Item label="SKU">{detailItem.sku_name}</Descriptions.Item>
              <Descriptions.Item label="水果">{detailItem.fruit_name}</Descriptions.Item>
              <Descriptions.Item label="工人">{detailItem.worker_name}</Descriptions.Item>
              <Descriptions.Item label="供应商">{detailItem.supplier || '-'}</Descriptions.Item>
              <Descriptions.Item label="预估重量">{Number(detailItem.estimated_weight).toFixed(1)}g</Descriptions.Item>
              <Descriptions.Item label="实际重量">
                {detailItem.actual_weight > 0 ? (
                  <span>
                    {Number(detailItem.actual_weight).toFixed(1)}g
                    <span style={{ marginLeft: 4, fontSize: 11, color: detailItem.weight_diff > 0 ? '#ff4d4f' : '#52c41a' }}>
                      ({detailItem.weight_diff > 0 ? '+' : ''}{Number(detailItem.weight_diff).toFixed(1)})
                    </span>
                  </span>
                ) : '-'}
              </Descriptions.Item>
            </Descriptions>

            {/* Lifecycle Timeline */}
            <div style={{
              borderRadius: 12, border: '1px solid var(--border-2)',
              background: 'linear-gradient(135deg, rgba(22,119,255,0.01), rgba(114,46,209,0.01))',
              overflow: 'hidden',
            }}>
              <div style={{
                padding: '12px 16px', borderBottom: '1px solid var(--border-2)',
                background: 'linear-gradient(135deg, rgba(22,119,255,0.04), rgba(114,46,209,0.04))',
                fontWeight: 700, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8,
              }}>
                <ClockCircleOutlined style={{ color: '#722ed1' }} />
                生命周期追踪
              </div>

              <div style={{ padding: '16px 16px 8px' }}>
                {lifecycleLoading ? (
                  <div style={{ textAlign: 'center', padding: 30 }}>
                    <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-3)' }}>加载生命周期...</div>
                  </div>
                ) : lifecycle?.events ? (
                  lifecycle.events.map((evt: any, i: number) => {
                    const stageIcons: Record<string, React.ReactNode> = {
                      purchase: <ShoppingCartOutlined />,
                      printed: <PrinterOutlined />,
                      production_input: <UserOutlined />,
                      audit: <AuditOutlined />,
                      warehouse: <HomeOutlined />,
                      outbound: <ScanOutlined />,
                    };
                    const stageColors: Record<string, string> = {
                      completed: '#52c41a',
                      current: '#1677ff',
                      pending: '#faad14',
                      waiting: '#d9d9d9',
                      error: '#ff4d4f',
                    };
                    const lineColor = stageColors[evt.status] || '#d9d9d9';
                    const isLast = i === lifecycle.events.length - 1;

                    return (
                      <div key={i} style={{ display: 'flex', gap: 14, marginBottom: isLast ? 8 : 0 }}>
                        {/* Timeline connector */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 32 }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: evt.status === 'waiting' ? '#f5f5f5' : `${lineColor}15`,
                            border: `2px solid ${lineColor}`,
                            color: lineColor, fontSize: 14, flexShrink: 0,
                            transition: 'all 0.3s',
                          }}>
                            {evt.status === 'current' ? <LoadingOutlined spin /> : (stageIcons[evt.stage] || <ClockCircleOutlined />)}
                          </div>
                          {!isLast && (
                            <div style={{
                              width: 2, flex: 1, minHeight: 24,
                              background: `linear-gradient(180deg, ${lineColor}, ${stageColors[lifecycle.events[i + 1]?.status] || '#d9d9d9'})`,
                            }} />
                          )}
                        </div>
                        {/* Content */}
                        <div style={{ flex: 1, paddingBottom: isLast ? 0 : 16 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: evt.status === 'waiting' ? 'var(--text-4)' : 'var(--text-1)' }}>
                            {evt.title}
                            {evt.status === 'pending' && <Tag color="warning" style={{ marginLeft: 6, fontSize: 10, borderRadius: 4 }}>进行中</Tag>}
                            {evt.status === 'error' && <Tag color="error" style={{ marginLeft: 6, fontSize: 10, borderRadius: 4 }}>异常</Tag>}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{evt.description}</div>
                          {evt.time && (
                            <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 2 }}>
                              <ClockCircleOutlined style={{ marginRight: 4 }} />
                              {dayjs(evt.time).format('YYYY-MM-DD HH:mm:ss')}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <Empty description="暂无生命周期数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                )}
              </div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
