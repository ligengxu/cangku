'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Row, Col, message, Spin, Table, Tag, Tooltip, Button, Space, Select, Progress, Empty, DatePicker, Segmented } from 'antd';
import {
  DollarOutlined, CheckCircleOutlined, CloseCircleOutlined, ShopOutlined,
  ReloadOutlined, PrinterOutlined, DownloadOutlined, PhoneOutlined,
  UserOutlined, BankOutlined, AlipayCircleOutlined,
  ShoppingCartOutlined, DropboxOutlined, ExperimentOutlined,
  FileTextOutlined, PieChartOutlined, InboxOutlined,
  CalendarOutlined,
} from '@ant-design/icons';
import dynamic from 'next/dynamic';
import api from '@/services/api';
import dayjs, { Dayjs } from 'dayjs';
import { exportToCsv } from '@/utils/exportCsv';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });
const { RangePicker } = DatePicker;

// ========== Types ==========

interface SupplierOrder {
  id: number; type: string; date: string; description: string; amount: number; payment_status: string;
}

interface SupplierEntry {
  supplier_id: number; supplier_name: string; supplier_type: string;
  contact_person: string; phone: string; alipay_account: string; bank_card: string;
  orders: SupplierOrder[]; total_amount: number; paid_amount: number; unpaid_amount: number;
  order_count: number; unpaid_count: number;
}

interface StatementData {
  suppliers: SupplierEntry[];
  summary: { supplier_count: number; grand_total: number; grand_unpaid: number; grand_paid: number };
}

interface BoxItem {
  box_id: number; box_type: string; unit_price: number; quantity: number; amount: number;
}

interface BoxData {
  start_date: string; end_date: string; items: BoxItem[];
  summary: { total_types: number; total_quantity: number; total_amount: number };
}

interface MaterialItem {
  material_type: string; order_count: number; total_amount: number; percentage: number;
}

interface MaterialDetail {
  id: number; material_type: string; material_name: string; supplier_name: string;
  purchase_amount: number; purchase_date: string; payment_status: string;
}

interface MaterialData {
  start_date: string; end_date: string; items: MaterialItem[]; details: MaterialDetail[];
  summary: { total_types: number; total_orders: number; total_amount: number };
}

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  fruit: { label: '水果', color: '#00b96b', icon: <ShoppingCartOutlined /> },
  box: { label: '纸箱', color: '#13c2c2', icon: <DropboxOutlined /> },
  material: { label: '材料', color: '#722ed1', icon: <ExperimentOutlined /> },
};

const PIE_COLORS = ['#1677ff', '#fa8c16', '#00b96b', '#722ed1', '#13c2c2', '#ff4d4f', '#faad14', '#eb2f96', '#2f54eb', '#52c41a'];

function fmt(v: number): string {
  if (v >= 10000) return `${(v / 10000).toFixed(1)}万`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

// ========== Supplier Statement Tab ==========

function SupplierStatementTab() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<StatementData | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [filterType, setFilterType] = useState<string | undefined>(undefined);
  const [expandedSupplier, setExpandedSupplier] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = {};
      if (filterType) params.supplier_type = filterType;
      const res = await api.get('/reports/supplier-statement', { params });
      setData(res.data?.data ?? null);
    } catch { message.error('加载对账数据失败'); }
    finally { setLoading(false); }
  }, [filterType]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const handlePrint = (supplier: SupplierEntry) => {
    const unpaidOrders = supplier.orders.filter(o => o.payment_status !== 'paid');
    const printContent = `
      <html><head><title>对账单 - ${supplier.supplier_name}</title>
      <style>
        body { font-family: -apple-system, system-ui, sans-serif; padding: 40px; color: #333; }
        h1 { font-size: 22px; text-align: center; margin-bottom: 6px; }
        .subtitle { text-align: center; color: #666; font-size: 13px; margin-bottom: 30px; }
        .info { display: flex; gap: 40px; margin-bottom: 24px; font-size: 13px; }
        .info-item { display: flex; gap: 6px; }
        .info-label { color: #999; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
        th { background: #f5f5f5; padding: 10px 12px; text-align: left; font-size: 13px; border-bottom: 2px solid #ddd; }
        td { padding: 8px 12px; font-size: 13px; border-bottom: 1px solid #eee; }
        .amount { text-align: right; font-weight: 700; font-family: monospace; }
        .total-row { background: #fafafa; font-weight: 700; }
        .total-row td { border-top: 2px solid #ddd; padding: 12px; }
        .footer { margin-top: 40px; display: flex; justify-content: space-between; font-size: 13px; color: #666; }
        .payment-info { margin-top: 24px; padding: 16px; background: #f9f9f9; border-radius: 8px; font-size: 13px; }
        .payment-info h3 { font-size: 14px; margin: 0 0 8px 0; }
        @media print { body { padding: 20px; } }
      </style></head><body>
      <h1>供应商对账单</h1>
      <div class="subtitle">生成日期: ${dayjs().format('YYYY-MM-DD HH:mm')}</div>
      <div class="info">
        <div class="info-item"><span class="info-label">供应商:</span> <strong>${supplier.supplier_name}</strong></div>
        <div class="info-item"><span class="info-label">类型:</span> ${TYPE_CONFIG[supplier.supplier_type]?.label || supplier.supplier_type}</div>
        ${supplier.contact_person ? `<div class="info-item"><span class="info-label">联系人:</span> ${supplier.contact_person}</div>` : ''}
        ${supplier.phone ? `<div class="info-item"><span class="info-label">电话:</span> ${supplier.phone}</div>` : ''}
      </div>
      <table>
        <thead><tr><th>序号</th><th>日期</th><th>项目描述</th><th class="amount">金额 (¥)</th><th>状态</th></tr></thead>
        <tbody>
          ${unpaidOrders.map((o, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${o.date}</td>
              <td>${o.description}</td>
              <td class="amount">${o.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
              <td style="color: #ff4d4f;">未付</td>
            </tr>
          `).join('')}
          <tr class="total-row">
            <td colspan="3">未付款合计（${unpaidOrders.length} 笔）</td>
            <td class="amount" style="color: #ff4d4f; font-size: 16px;">¥ ${supplier.unpaid_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
      ${(supplier.alipay_account || supplier.bank_card) ? `
        <div class="payment-info">
          <h3>收款信息</h3>
          ${supplier.alipay_account ? `<div>支付宝: ${supplier.alipay_account}</div>` : ''}
          ${supplier.bank_card ? `<div>银行卡: ${supplier.bank_card}</div>` : ''}
        </div>
      ` : ''}
      <div class="footer">
        <span>果管系统自动生成</span>
        <span>打印时间: ${dayjs().format('YYYY-MM-DD HH:mm:ss')}</span>
      </div>
      </body></html>
    `;
    const w = window.open('', '_blank');
    if (w) { w.document.write(printContent); w.document.close(); setTimeout(() => { w.print(); }, 300); }
  };

  const handleExportAll = () => {
    if (!data?.suppliers?.length) { message.warning('无数据可导出'); return; }
    const rows: any[] = [];
    data.suppliers.forEach(sup => {
      sup.orders.filter(o => o.payment_status !== 'paid').forEach(o => {
        rows.push({
          supplier_name: sup.supplier_name,
          supplier_type: TYPE_CONFIG[sup.supplier_type]?.label || sup.supplier_type,
          date: o.date, description: o.description, amount: o.amount, payment_status: '未付',
        });
      });
    });
    exportToCsv(rows, [
      { key: 'supplier_name', title: '供应商' }, { key: 'supplier_type', title: '类型' },
      { key: 'date', title: '日期' }, { key: 'description', title: '描述' },
      { key: 'amount', title: '金额' }, { key: 'payment_status', title: '状态' },
    ], '供应商对账单');
  };

  const sm = data?.summary;

  return (
    <>
      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Select placeholder="供应商类型" allowClear style={{ width: 130, borderRadius: 10 }}
          value={filterType} onChange={v => setFilterType(v)}
          options={[
            { value: 'fruit', label: '水果供应商' },
            { value: 'box', label: '纸箱供应商' },
            { value: 'material', label: '材料供应商' },
          ]}
        />
        <Tooltip title="刷新">
          <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 10, height: 36, width: 36 }} />
        </Tooltip>
        <Tooltip title="导出未付款汇总">
          <Button icon={<DownloadOutlined />} onClick={handleExportAll} disabled={!data?.suppliers?.length} style={{ borderRadius: 10, height: 36, width: 36 }} />
        </Tooltip>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>
      ) : data ? (
        <>
          {/* Summary Cards */}
          <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
            {[
              { label: '供应商数', value: sm?.supplier_count ?? 0, unit: '家', icon: <ShopOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.15)' },
              { label: '采购总额', value: `¥${fmt(sm?.grand_total ?? 0)}`, icon: <DollarOutlined />, gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.15)' },
              { label: '已付金额', value: `¥${fmt(sm?.grand_paid ?? 0)}`, icon: <CheckCircleOutlined />, gradient: 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: 'rgba(0,185,107,0.15)' },
              { label: '待付金额', value: `¥${fmt(sm?.grand_unpaid ?? 0)}`, icon: <CloseCircleOutlined />, gradient: (sm?.grand_unpaid ?? 0) > 0 ? 'linear-gradient(135deg, #ff4d4f 0%, #ff7875 100%)' : 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', glow: (sm?.grand_unpaid ?? 0) > 0 ? 'rgba(255,77,79,0.15)' : 'rgba(0,185,107,0.15)' },
            ].map((s, i) => (
              <Col xs={12} sm={6} key={i}>
                <div style={{
                  padding: '16px 18px', borderRadius: 'var(--radius-m)', background: s.gradient, position: 'relative', overflow: 'hidden',
                  boxShadow: `0 4px 14px ${s.glow}`, transition: 'all 0.3s',
                  animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.08}s`,
                }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
                >
                  <div style={{ position: 'absolute', top: -14, right: -14, width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>{s.icon} {s.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#fff', lineHeight: 1.2 }} className="num">
                    {s.value}
                    {'unit' in s && s.unit && <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3, opacity: 0.7 }}>{s.unit}</span>}
                  </div>
                </div>
              </Col>
            ))}
          </Row>

          {/* Supplier List */}
          {data.suppliers.length === 0 ? (
            <div className="panel" style={{ padding: 60, textAlign: 'center' }}><Empty description="没有采购记录的供应商" /></div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {data.suppliers.map((sup, idx) => {
                const cfg = TYPE_CONFIG[sup.supplier_type] || { label: sup.supplier_type, color: '#1677ff', icon: <ShopOutlined /> };
                const paidPct = sup.total_amount > 0 ? Math.round((sup.paid_amount / sup.total_amount) * 100) : 100;
                const isExpanded = expandedSupplier === sup.supplier_id;
                return (
                  <div key={sup.supplier_id} className="panel" style={{
                    animation: `stagger-in 0.4s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${idx * 0.05}s`,
                  }}>
                    <div
                      style={{ padding: '16px 20px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, transition: 'background 0.2s' }}
                      onClick={() => setExpandedSupplier(isExpanded ? null : sup.supplier_id)}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(22,119,255,0.02)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <span style={{
                        width: 40, height: 40, borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        background: cfg.color + '15', color: cfg.color, fontSize: 18, flexShrink: 0,
                      }}>{cfg.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-1)' }}>{sup.supplier_name}</span>
                          <Tag style={{ borderRadius: 6, fontSize: 11, fontWeight: 500 }} color={cfg.color}>{cfg.label}</Tag>
                          {sup.unpaid_count > 0 && <Tag color="error" style={{ borderRadius: 6, fontSize: 11 }}>{sup.unpaid_count} 笔未付</Tag>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12, color: 'var(--text-3)' }}>
                          {sup.contact_person && <span><UserOutlined style={{ marginRight: 3 }} />{sup.contact_person}</span>}
                          {sup.phone && <span><PhoneOutlined style={{ marginRight: 3 }} />{sup.phone}</span>}
                          <span>{sup.order_count} 笔订单</span>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, justifyContent: 'flex-end' }}>
                          <span style={{ fontSize: 12, color: 'var(--text-4)' }}>待付</span>
                          <span className="num" style={{
                            fontSize: sup.unpaid_amount > 0 ? 22 : 16, fontWeight: 700,
                            color: sup.unpaid_amount > 0 ? '#ff4d4f' : '#00b96b',
                          }}>
                            {sup.unpaid_amount > 0 ? `¥${fmt(sup.unpaid_amount)}` : '已结清'}
                          </span>
                        </div>
                        <div style={{ width: 120, marginTop: 4 }}>
                          <Progress percent={paidPct} size="small"
                            strokeColor={paidPct >= 80 ? { from: '#00b96b', to: '#5cdbd3' } : paidPct >= 50 ? { from: '#fa8c16', to: '#ffc53d' } : { from: '#ff4d4f', to: '#ff7875' }}
                            format={p => <span className="num" style={{ fontSize: 11, fontWeight: 600 }}>{p}%</span>}
                          />
                        </div>
                      </div>
                      <Space size={4} style={{ flexShrink: 0, marginLeft: 8 }}>
                        {sup.unpaid_count > 0 && (
                          <Tooltip title="打印对账单">
                            <Button size="small" icon={<PrinterOutlined />} onClick={(e) => { e.stopPropagation(); handlePrint(sup); }}
                              style={{ borderRadius: 8, height: 32, width: 32 }} />
                          </Tooltip>
                        )}
                      </Space>
                    </div>
                    {isExpanded && (
                      <div style={{ borderTop: '1px solid rgba(0,0,0,0.04)', animation: 'stagger-in 0.3s cubic-bezier(0.22,1,0.36,1) both' }}>
                        {(sup.alipay_account || sup.bank_card) && (
                          <div style={{
                            padding: '10px 20px', display: 'flex', gap: 20, fontSize: 12, color: 'var(--text-3)',
                            background: 'rgba(22,119,255,0.02)',
                          }}>
                            {sup.alipay_account && <span><AlipayCircleOutlined style={{ color: '#1677ff', marginRight: 4 }} />支付宝: {sup.alipay_account}</span>}
                            {sup.bank_card && <span><BankOutlined style={{ color: '#fa8c16', marginRight: 4 }} />银行卡: {sup.bank_card}</span>}
                          </div>
                        )}
                        <Table dataSource={sup.orders} rowKey="id" size="small" pagination={false} locale={{ emptyText: '暂无订单' }}
                          columns={[
                            { title: '日期', dataIndex: 'date', width: 110, render: (v: string) => <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{v || '-'}</span> },
                            { title: '描述', dataIndex: 'description', ellipsis: true, render: (v: string) => <span style={{ fontSize: 12 }}>{v}</span> },
                            { title: '金额', dataIndex: 'amount', width: 130, align: 'right' as const, render: (v: number) => <span className="num" style={{ fontWeight: 700, color: '#fa8c16', fontSize: 13 }}>¥{Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span> },
                            { title: '状态', dataIndex: 'payment_status', width: 80, align: 'center' as const, render: (v: string) => <Tag color={v === 'paid' ? 'success' : 'error'} style={{ borderRadius: 6, fontSize: 11 }} icon={v === 'paid' ? <CheckCircleOutlined /> : <CloseCircleOutlined />}>{v === 'paid' ? '已付' : '未付'}</Tag> },
                          ]}
                          summary={() => (
                            <Table.Summary fixed>
                              <Table.Summary.Row style={{ background: 'rgba(250,140,22,0.04)' }}>
                                <Table.Summary.Cell index={0}><span style={{ fontWeight: 700, fontSize: 12 }}>合计</span></Table.Summary.Cell>
                                <Table.Summary.Cell index={1}><span style={{ fontSize: 12, color: 'var(--text-3)' }}>{sup.order_count} 笔订单</span></Table.Summary.Cell>
                                <Table.Summary.Cell index={2} align="right">
                                  <span className="num" style={{ fontWeight: 700, color: '#fa8c16', fontSize: 13 }}>¥{sup.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                </Table.Summary.Cell>
                                <Table.Summary.Cell index={3} align="center">
                                  {sup.unpaid_amount > 0 ? (
                                    <span className="num" style={{ fontWeight: 700, color: '#ff4d4f', fontSize: 12 }}>待付 ¥{fmt(sup.unpaid_amount)}</span>
                                  ) : <Tag color="success" style={{ borderRadius: 6, fontSize: 11 }}>已结清</Tag>}
                                </Table.Summary.Cell>
                              </Table.Summary.Row>
                            </Table.Summary>
                          )}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: 80, color: 'var(--text-4)' }}>无数据</div>
      )}
    </>
  );
}

// ========== Box Consumption Tab ==========

function BoxConsumptionTab() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<BoxData | null>(null);
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(30, 'day'), dayjs()]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/reports/box-consumption', {
        params: { start_date: dateRange[0].format('YYYY-MM-DD'), end_date: dateRange[1].format('YYYY-MM-DD') },
      });
      setData(res.data?.data ?? null);
    } catch { message.error('加载纸箱消耗数据失败'); }
    finally { setLoading(false); }
  }, [dateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleExport = () => {
    if (!data?.items?.length) { message.warning('无数据可导出'); return; }
    exportToCsv(data.items.map(it => ({
      ...it, percentage: data.summary.total_amount > 0 ? ((it.amount / data.summary.total_amount) * 100).toFixed(1) + '%' : '0%',
    })), [
      { key: 'box_type', title: '纸箱类型' }, { key: 'quantity', title: '消耗数量' },
      { key: 'unit_price', title: '单价' }, { key: 'amount', title: '金额' },
      { key: 'percentage', title: '占比' },
    ], `纸箱消耗_${dateRange[0].format('YYYYMMDD')}_${dateRange[1].format('YYYYMMDD')}`);
  };

  const sm = data?.summary;
  const pieData = (data?.items || []).map(it => ({ name: it.box_type || '未知', value: it.amount }));

  const pieOption = {
    tooltip: { trigger: 'item', formatter: '{b}: ¥{c} ({d}%)' },
    legend: { bottom: 0, left: 'center', textStyle: { fontSize: 11, color: '#666' } },
    color: PIE_COLORS,
    series: [{
      type: 'pie', radius: ['42%', '72%'], center: ['50%', '45%'],
      label: { show: true, formatter: '{b}\n{d}%', fontSize: 11 },
      emphasis: { label: { fontSize: 14, fontWeight: 'bold' }, itemStyle: { shadowBlur: 16, shadowColor: 'rgba(0,0,0,0.15)' } },
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      data: pieData,
    }],
  };

  return (
    <>
      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <CalendarOutlined style={{ color: 'var(--text-3)' }} />
          <RangePicker value={dateRange} onChange={v => { if (v?.[0] && v?.[1]) setDateRange([v[0], v[1]]); }}
            style={{ borderRadius: 10 }} allowClear={false}
            presets={[
              { label: '近7天', value: [dayjs().subtract(7, 'day'), dayjs()] },
              { label: '近30天', value: [dayjs().subtract(30, 'day'), dayjs()] },
              { label: '近90天', value: [dayjs().subtract(90, 'day'), dayjs()] },
              { label: '本月', value: [dayjs().startOf('month'), dayjs()] },
              { label: '上月', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
            ]}
          />
        </Space>
        <Space>
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} onClick={fetchData} style={{ borderRadius: 10, height: 36, width: 36 }} /></Tooltip>
          <Tooltip title="导出CSV"><Button icon={<DownloadOutlined />} onClick={handleExport} disabled={!data?.items?.length} style={{ borderRadius: 10, height: 36, width: 36 }} /></Tooltip>
        </Space>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>
      ) : data ? (
        <>
          {/* Summary Cards */}
          <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
            {[
              { label: '纸箱类型', value: sm?.total_types ?? 0, unit: '种', icon: <InboxOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.15)' },
              { label: '总消耗量', value: sm?.total_quantity?.toLocaleString() ?? '0', unit: '个', icon: <DropboxOutlined />, gradient: 'linear-gradient(135deg, #13c2c2 0%, #36cfc9 100%)', glow: 'rgba(19,194,194,0.15)' },
              { label: '总金额', value: `¥${fmt(sm?.total_amount ?? 0)}`, icon: <DollarOutlined />, gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.15)' },
              { label: '日均消耗', value: `¥${fmt(sm?.total_amount && dateRange ? sm.total_amount / Math.max(1, dateRange[1].diff(dateRange[0], 'day') + 1) : 0)}`, icon: <PieChartOutlined />, gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', glow: 'rgba(114,46,209,0.15)' },
            ].map((s, i) => (
              <Col xs={12} sm={6} key={i}>
                <div style={{
                  padding: '16px 18px', borderRadius: 'var(--radius-m)', background: s.gradient, position: 'relative', overflow: 'hidden',
                  boxShadow: `0 4px 14px ${s.glow}`, transition: 'all 0.3s',
                  animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.08}s`,
                }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
                >
                  <div style={{ position: 'absolute', top: -14, right: -14, width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>{s.icon} {s.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#fff', lineHeight: 1.2 }} className="num">
                    {s.value}
                    {'unit' in s && s.unit && <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3, opacity: 0.7 }}>{s.unit}</span>}
                  </div>
                </div>
              </Col>
            ))}
          </Row>

          <Row gutter={[16, 16]}>
            {/* Pie Chart */}
            <Col xs={24} md={10}>
              <div className="panel" style={{ padding: '20px', animation: 'stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both', animationDelay: '0.1s' }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <PieChartOutlined style={{ color: '#1677ff' }} />
                  消耗占比分析
                </div>
                {pieData.length > 0 ? (
                  <ReactECharts option={pieOption} style={{ height: 320 }} opts={{ renderer: 'svg' }} />
                ) : (
                  <Empty description="无数据" style={{ padding: 60 }} />
                )}
              </div>
            </Col>

            {/* Table */}
            <Col xs={24} md={14}>
              <div className="panel" style={{ padding: '0', overflow: 'hidden', animation: 'stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both', animationDelay: '0.15s' }}>
                <Table dataSource={data.items} rowKey="box_id" size="small"
                  pagination={false} locale={{ emptyText: '暂无数据' }}
                  columns={[
                    {
                      title: '纸箱类型', dataIndex: 'box_type', ellipsis: true,
                      render: (v: string) => (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{
                            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                            background: PIE_COLORS[(data.items.findIndex(it => it.box_type === v)) % PIE_COLORS.length],
                          }} />
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{v || '未知'}</span>
                        </div>
                      ),
                    },
                    {
                      title: '消耗数量', dataIndex: 'quantity', width: 100, align: 'right' as const, sorter: (a: BoxItem, b: BoxItem) => a.quantity - b.quantity,
                      render: (v: number) => <span className="num" style={{ fontWeight: 700, fontSize: 13, color: '#13c2c2' }}>{v.toLocaleString()}</span>,
                    },
                    {
                      title: '单价', dataIndex: 'unit_price', width: 90, align: 'right' as const,
                      render: (v: number) => <span className="num" style={{ fontSize: 12, color: 'var(--text-2)' }}>¥{v.toFixed(2)}</span>,
                    },
                    {
                      title: '金额', dataIndex: 'amount', width: 110, align: 'right' as const, sorter: (a: BoxItem, b: BoxItem) => a.amount - b.amount, defaultSortOrder: 'descend' as const,
                      render: (v: number) => <span className="num" style={{ fontWeight: 700, fontSize: 13, color: '#fa8c16' }}>¥{v.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>,
                    },
                    {
                      title: '占比', key: 'pct', width: 120,
                      render: (_: any, r: BoxItem) => {
                        const pct = sm?.total_amount ? Math.round((r.amount / sm.total_amount) * 100) : 0;
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Progress percent={pct} size="small" style={{ flex: 1, marginBottom: 0 }}
                              strokeColor={{ from: '#1677ff', to: '#69b1ff' }}
                              format={p => <span className="num" style={{ fontSize: 11, fontWeight: 600 }}>{p}%</span>}
                            />
                          </div>
                        );
                      },
                    },
                  ]}
                  summary={() => sm && sm.total_quantity > 0 ? (
                    <Table.Summary fixed>
                      <Table.Summary.Row style={{ background: 'rgba(19,194,194,0.04)' }}>
                        <Table.Summary.Cell index={0}><span style={{ fontWeight: 700, fontSize: 12 }}>合计 ({data.items.length} 种)</span></Table.Summary.Cell>
                        <Table.Summary.Cell index={1} align="right"><span className="num" style={{ fontWeight: 700, color: '#13c2c2', fontSize: 13 }}>{sm.total_quantity.toLocaleString()}</span></Table.Summary.Cell>
                        <Table.Summary.Cell index={2} />
                        <Table.Summary.Cell index={3} align="right"><span className="num" style={{ fontWeight: 700, color: '#fa8c16', fontSize: 13 }}>¥{sm.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></Table.Summary.Cell>
                        <Table.Summary.Cell index={4} />
                      </Table.Summary.Row>
                    </Table.Summary>
                  ) : null}
                />
              </div>
            </Col>
          </Row>
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: 80, color: 'var(--text-4)' }}>无数据</div>
      )}
    </>
  );
}

// ========== Material Consumption Tab ==========

function MaterialConsumptionTab() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<MaterialData | null>(null);
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(30, 'day'), dayjs()]);
  const [viewMode, setViewMode] = useState<'summary' | 'detail'>('summary');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/reports/material-consumption', {
        params: { start_date: dateRange[0].format('YYYY-MM-DD'), end_date: dateRange[1].format('YYYY-MM-DD') },
      });
      setData(res.data?.data ?? null);
    } catch { message.error('加载材料消耗数据失败'); }
    finally { setLoading(false); }
  }, [dateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleExport = () => {
    if (viewMode === 'summary') {
      if (!data?.items?.length) { message.warning('无数据可导出'); return; }
      exportToCsv(data.items, [
        { key: 'material_type', title: '材料类型' }, { key: 'order_count', title: '采购次数' },
        { key: 'total_amount', title: '金额' }, { key: 'percentage', title: '占比%' },
      ], `材料消耗汇总_${dateRange[0].format('YYYYMMDD')}_${dateRange[1].format('YYYYMMDD')}`);
    } else {
      if (!data?.details?.length) { message.warning('无数据可导出'); return; }
      exportToCsv(data.details.map(d => ({ ...d, payment_status: d.payment_status === 'paid' ? '已付' : '未付' })), [
        { key: 'purchase_date', title: '日期' }, { key: 'material_type', title: '类型' },
        { key: 'material_name', title: '名称' }, { key: 'supplier_name', title: '供应商' },
        { key: 'purchase_amount', title: '金额' }, { key: 'payment_status', title: '状态' },
      ], `材料消耗明细_${dateRange[0].format('YYYYMMDD')}_${dateRange[1].format('YYYYMMDD')}`);
    }
  };

  const sm = data?.summary;
  const pieData = (data?.items || []).map(it => ({ name: it.material_type, value: it.total_amount }));

  const pieOption = {
    tooltip: { trigger: 'item', formatter: '{b}: ¥{c} ({d}%)' },
    legend: { bottom: 0, left: 'center', textStyle: { fontSize: 11, color: '#666' } },
    color: PIE_COLORS,
    series: [{
      type: 'pie', radius: ['42%', '72%'], center: ['50%', '45%'],
      label: { show: true, formatter: '{b}\n{d}%', fontSize: 11 },
      emphasis: { label: { fontSize: 14, fontWeight: 'bold' }, itemStyle: { shadowBlur: 16, shadowColor: 'rgba(0,0,0,0.15)' } },
      itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
      data: pieData,
    }],
  };

  return (
    <>
      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <CalendarOutlined style={{ color: 'var(--text-3)' }} />
          <RangePicker value={dateRange} onChange={v => { if (v?.[0] && v?.[1]) setDateRange([v[0], v[1]]); }}
            style={{ borderRadius: 10 }} allowClear={false}
            presets={[
              { label: '近7天', value: [dayjs().subtract(7, 'day'), dayjs()] },
              { label: '近30天', value: [dayjs().subtract(30, 'day'), dayjs()] },
              { label: '近90天', value: [dayjs().subtract(90, 'day'), dayjs()] },
              { label: '本月', value: [dayjs().startOf('month'), dayjs()] },
              { label: '上月', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] },
            ]}
          />
          <Segmented value={viewMode} onChange={v => setViewMode(v as any)}
            options={[
              { value: 'summary', label: '按类型汇总' },
              { value: 'detail', label: '采购明细' },
            ]}
            style={{ borderRadius: 10 }}
          />
        </Space>
        <Space>
          <Tooltip title="刷新"><Button icon={<ReloadOutlined />} onClick={fetchData} style={{ borderRadius: 10, height: 36, width: 36 }} /></Tooltip>
          <Tooltip title="导出CSV"><Button icon={<DownloadOutlined />} onClick={handleExport} disabled={!data?.items?.length && !data?.details?.length} style={{ borderRadius: 10, height: 36, width: 36 }} /></Tooltip>
        </Space>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>
      ) : data ? (
        <>
          {/* Summary Cards */}
          <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
            {[
              { label: '材料种类', value: sm?.total_types ?? 0, unit: '种', icon: <ExperimentOutlined />, gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', glow: 'rgba(114,46,209,0.15)' },
              { label: '采购次数', value: sm?.total_orders ?? 0, unit: '次', icon: <ShoppingCartOutlined />, gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', glow: 'rgba(22,119,255,0.15)' },
              { label: '总金额', value: `¥${fmt(sm?.total_amount ?? 0)}`, icon: <DollarOutlined />, gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.15)' },
              { label: '日均消耗', value: `¥${fmt(sm?.total_amount && dateRange ? sm.total_amount / Math.max(1, dateRange[1].diff(dateRange[0], 'day') + 1) : 0)}`, icon: <PieChartOutlined />, gradient: 'linear-gradient(135deg, #13c2c2 0%, #36cfc9 100%)', glow: 'rgba(19,194,194,0.15)' },
            ].map((s, i) => (
              <Col xs={12} sm={6} key={i}>
                <div style={{
                  padding: '16px 18px', borderRadius: 'var(--radius-m)', background: s.gradient, position: 'relative', overflow: 'hidden',
                  boxShadow: `0 4px 14px ${s.glow}`, transition: 'all 0.3s',
                  animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.08}s`,
                }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
                >
                  <div style={{ position: 'absolute', top: -14, right: -14, width: 56, height: 56, borderRadius: '50%', background: 'rgba(255,255,255,0.1)', pointerEvents: 'none' }} />
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>{s.icon} {s.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#fff', lineHeight: 1.2 }} className="num">
                    {s.value}
                    {'unit' in s && s.unit && <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3, opacity: 0.7 }}>{s.unit}</span>}
                  </div>
                </div>
              </Col>
            ))}
          </Row>

          {viewMode === 'summary' ? (
            <Row gutter={[16, 16]}>
              {/* Pie Chart */}
              <Col xs={24} md={10}>
                <div className="panel" style={{ padding: '20px', animation: 'stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both', animationDelay: '0.1s' }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <PieChartOutlined style={{ color: '#722ed1' }} />
                    材料消耗占比
                  </div>
                  {pieData.length > 0 ? (
                    <ReactECharts option={pieOption} style={{ height: 320 }} opts={{ renderer: 'svg' }} />
                  ) : (
                    <Empty description="无数据" style={{ padding: 60 }} />
                  )}
                </div>
              </Col>

              {/* Summary Table */}
              <Col xs={24} md={14}>
                <div className="panel" style={{ padding: 0, overflow: 'hidden', animation: 'stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both', animationDelay: '0.15s' }}>
                  <Table dataSource={data.items} rowKey="material_type" size="small"
                    pagination={false} locale={{ emptyText: '暂无数据' }}
                    columns={[
                      {
                        title: '材料类型', dataIndex: 'material_type', ellipsis: true,
                        render: (v: string, _: any, idx: number) => (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: PIE_COLORS[idx % PIE_COLORS.length] }} />
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{v}</span>
                          </div>
                        ),
                      },
                      {
                        title: '采购次数', dataIndex: 'order_count', width: 90, align: 'right' as const, sorter: (a: MaterialItem, b: MaterialItem) => a.order_count - b.order_count,
                        render: (v: number) => <span className="num" style={{ fontWeight: 600, fontSize: 13, color: '#1677ff' }}>{v}</span>,
                      },
                      {
                        title: '金额', dataIndex: 'total_amount', width: 120, align: 'right' as const, sorter: (a: MaterialItem, b: MaterialItem) => a.total_amount - b.total_amount, defaultSortOrder: 'descend' as const,
                        render: (v: number) => <span className="num" style={{ fontWeight: 700, fontSize: 13, color: '#fa8c16' }}>¥{v.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>,
                      },
                      {
                        title: '占比', key: 'pct', width: 120,
                        render: (_: any, r: MaterialItem) => (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Progress percent={Math.round(r.percentage)} size="small" style={{ flex: 1, marginBottom: 0 }}
                              strokeColor={{ from: '#722ed1', to: '#b37feb' }}
                              format={p => <span className="num" style={{ fontSize: 11, fontWeight: 600 }}>{p}%</span>}
                            />
                          </div>
                        ),
                      },
                    ]}
                    summary={() => sm && sm.total_orders > 0 ? (
                      <Table.Summary fixed>
                        <Table.Summary.Row style={{ background: 'rgba(114,46,209,0.04)' }}>
                          <Table.Summary.Cell index={0}><span style={{ fontWeight: 700, fontSize: 12 }}>合计 ({data.items.length} 种)</span></Table.Summary.Cell>
                          <Table.Summary.Cell index={1} align="right"><span className="num" style={{ fontWeight: 700, color: '#1677ff', fontSize: 13 }}>{sm.total_orders}</span></Table.Summary.Cell>
                          <Table.Summary.Cell index={2} align="right"><span className="num" style={{ fontWeight: 700, color: '#fa8c16', fontSize: 13 }}>¥{sm.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></Table.Summary.Cell>
                          <Table.Summary.Cell index={3} />
                        </Table.Summary.Row>
                      </Table.Summary>
                    ) : null}
                  />
                </div>
              </Col>
            </Row>
          ) : (
            /* Detail Table */
            <div className="panel" style={{ padding: 0, overflow: 'hidden', animation: 'stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both' }}>
              <Table dataSource={data.details} rowKey="id" size="small"
                pagination={{ pageSize: 20, showSizeChanger: true, showTotal: t => `共 ${t} 条` }}
                locale={{ emptyText: '暂无数据' }}
                columns={[
                  { title: '日期', dataIndex: 'purchase_date', width: 110, sorter: (a: MaterialDetail, b: MaterialDetail) => a.purchase_date.localeCompare(b.purchase_date), render: (v: string) => <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{v || '-'}</span> },
                  {
                    title: '类型', dataIndex: 'material_type', width: 100,
                    filters: Array.from(new Set(data.details.map(d => d.material_type))).map(t => ({ text: t, value: t })),
                    onFilter: (val: any, record: MaterialDetail) => record.material_type === val,
                    render: (v: string) => <Tag color="purple" style={{ borderRadius: 6, fontSize: 11 }}>{v}</Tag>,
                  },
                  { title: '名称', dataIndex: 'material_name', ellipsis: true, render: (v: string) => <span style={{ fontSize: 13 }}>{v || '-'}</span> },
                  { title: '供应商', dataIndex: 'supplier_name', width: 120, ellipsis: true, render: (v: string) => <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{v || '-'}</span> },
                  {
                    title: '金额', dataIndex: 'purchase_amount', width: 120, align: 'right' as const, sorter: (a: MaterialDetail, b: MaterialDetail) => a.purchase_amount - b.purchase_amount,
                    render: (v: number) => <span className="num" style={{ fontWeight: 700, fontSize: 13, color: '#fa8c16' }}>¥{Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>,
                  },
                  {
                    title: '状态', dataIndex: 'payment_status', width: 80, align: 'center' as const,
                    filters: [{ text: '已付', value: 'paid' }, { text: '未付', value: 'unpaid' }],
                    onFilter: (val: any, record: MaterialDetail) => record.payment_status === val,
                    render: (v: string) => <Tag color={v === 'paid' ? 'success' : 'error'} style={{ borderRadius: 6, fontSize: 11 }} icon={v === 'paid' ? <CheckCircleOutlined /> : <CloseCircleOutlined />}>{v === 'paid' ? '已付' : '未付'}</Tag>,
                  },
                ]}
              />
            </div>
          )}
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: 80, color: 'var(--text-4)' }}>无数据</div>
      )}
    </>
  );
}

// ========== Main Page ==========

export default function SupplierStatementPage() {
  const [activeTab, setActiveTab] = useState<string>('statement');

  const TAB_OPTIONS = [
    { value: 'statement', label: (<span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FileTextOutlined />供应商对账</span>) },
    { value: 'box', label: (<span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><DropboxOutlined />纸箱消耗分析</span>) },
    { value: 'material', label: (<span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ExperimentOutlined />材料消耗统计</span>) },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22,
        padding: '20px 24px', borderRadius: 'var(--radius-l)',
        background: 'linear-gradient(135deg, rgba(22,119,255,0.06) 0%, rgba(250,140,22,0.03) 100%)',
        border: '1px solid rgba(22,119,255,0.08)',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 32, height: 32, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #1677ff 0%, #fa8c16 100%)', color: '#fff', fontSize: 15,
              boxShadow: '0 3px 10px rgba(22,119,255,0.2)',
            }}><FileTextOutlined /></span>
            供应商对账与消耗分析
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 42 }}>
            供应商对账、纸箱消耗和材料采购全景分析
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div style={{ marginBottom: 18 }}>
        <Segmented
          value={activeTab}
          onChange={v => setActiveTab(v as string)}
          options={TAB_OPTIONS}
          block
          style={{
            padding: 4, borderRadius: 'var(--radius-m)',
            background: 'rgba(0,0,0,0.02)',
          }}
        />
      </div>

      {/* Tab Content */}
      {activeTab === 'statement' && <SupplierStatementTab />}
      {activeTab === 'box' && <BoxConsumptionTab />}
      {activeTab === 'material' && <MaterialConsumptionTab />}
    </div>
  );
}
