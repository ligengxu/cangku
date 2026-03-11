'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Input, Button, Table, Tag, Tooltip, Row, Col,
  Empty, Spin, message, Avatar, Space, Progress, Select,
} from 'antd';
import {
  DatabaseOutlined, SearchOutlined, ReloadOutlined,
  InboxOutlined, ExportOutlined, RiseOutlined,
  WarningOutlined, DownloadOutlined, AppstoreOutlined,
  BarChartOutlined, ClockCircleOutlined, ThunderboltOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import api from '@/services/api';

const FRUIT_ICONS: Record<string, string> = {
  '苹果': '🍎', '梨': '🍐', '橙': '🍊', '柠檬': '🍋', '桃': '🍑',
  '樱桃': '🍒', '葡萄': '🍇', '西瓜': '🍉', '芒果': '🥭', '猕猴桃': '🥝',
  '香蕉': '🍌', '菠萝': '🍍', '草莓': '🍓', '蓝莓': '🫐', '椰子': '🥥',
  '橘子': '🍊', '柚子': '🍊', '荔枝': '🍎', '龙眼': '🍇',
};

function getFruitIcon(name: string): string {
  for (const [k, v] of Object.entries(FRUIT_ICONS)) if (name.includes(k)) return v;
  return '🍎';
}

interface SkuItem {
  sku_id: number; sku_name: string; sku_description: string; fruit_name: string;
  estimated_weight: number; inbound: number; outbound: number; stock: number;
  outbound_7d: number; outbound_30d: number; daily_rate: number; days_remaining: number;
}
interface FruitGroup { fruit_name: string; total_stock: number; sku_count: number; items: SkuItem[] }
interface Summary { total_sku_count: number; total_stock: number; total_inbound: number; total_outbound: number; stock_rate: number }
interface InventoryData { items: SkuItem[]; groups: FruitGroup[]; summary: Summary }

const COLORS = ['#1677ff', '#00b96b', '#722ed1', '#fa8c16', '#eb2f96', '#13c2c2', '#f5222d', '#52c41a'];
const STAT_GRADIENTS = [
  { bg: 'linear-gradient(135deg, #6B73FF, #000DFF)', glow: 'rgba(107,115,255,0.15)' },
  { bg: 'linear-gradient(135deg, #00b96b, #52c41a)', glow: 'rgba(0,185,107,0.15)' },
  { bg: 'linear-gradient(135deg, #1677ff, #69b1ff)', glow: 'rgba(22,119,255,0.15)' },
  { bg: 'linear-gradient(135deg, #fa8c16, #ffc53d)', glow: 'rgba(250,140,22,0.15)' },
];

export default function InventoryOverviewPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<InventoryData | null>(null);
  const [refreshSpin, setRefreshSpin] = useState(false);
  const [fruitFilter, setFruitFilter] = useState<string | undefined>(undefined);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [search, setSearch] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (fruitFilter) params.fruit_name = fruitFilter;
      const res = await api.get('/inventory/sku/inventory', { params });
      setData(res.data?.data || null);
    } catch { message.error('查询失败'); }
    finally { setLoading(false); }
  }, [fruitFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const filteredGroups = data?.groups?.filter(g => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return g.fruit_name.toLowerCase().includes(q) ||
      g.items.some(i => i.sku_name.toLowerCase().includes(q) || (i.sku_description || '').toLowerCase().includes(q));
  }) || [];

  const filteredItems = data?.items?.filter(i => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return i.sku_name.toLowerCase().includes(q) || i.fruit_name.toLowerCase().includes(q) || (i.sku_description || '').toLowerCase().includes(q);
  }) || [];

  const fruitOptions = Array.from(new Set(data?.items?.map(i => i.fruit_name) || [])).map(n => ({ value: n, label: n }));

  const exportCSV = () => {
    if (!data?.items?.length) { message.warning('暂无数据'); return; }
    const headers = ['SKU,描述,水果,入库数,出库数,库存,7日出库,30日出库,日均出库,预计天数'];
    const rows = filteredItems.map(i =>
      `${i.sku_name},${i.sku_description},${i.fruit_name},${i.inbound},${i.outbound},${i.stock},${i.outbound_7d},${i.outbound_30d},${i.daily_rate},${i.days_remaining >= 999 ? '∞' : i.days_remaining}`
    );
    const csv = '\uFEFF' + [...headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = '库存总览.csv'; a.click();
    URL.revokeObjectURL(url); message.success('导出成功');
  };

  const sm = data?.summary;
  const stats = [
    { label: 'SKU 品类', value: sm?.total_sku_count ?? 0, icon: <AppstoreOutlined />, ...STAT_GRADIENTS[0], suffix: '种' },
    { label: '当前库存', value: sm?.total_stock ?? 0, icon: <DatabaseOutlined />, ...STAT_GRADIENTS[1], suffix: '件' },
    { label: '累计入库', value: sm?.total_inbound ?? 0, icon: <InboxOutlined />, ...STAT_GRADIENTS[2], suffix: '件' },
    { label: '累计出库', value: sm?.total_outbound ?? 0, icon: <ExportOutlined />, ...STAT_GRADIENTS[3], suffix: '件' },
  ];

  const getDaysColor = (d: number) => d >= 999 ? 'var(--text-4)' : d <= 3 ? '#ff4d4f' : d <= 7 ? '#fa8c16' : '#00b96b';
  const getDaysTag = (d: number) => d >= 999 ? '充足' : d <= 3 ? '紧急' : d <= 7 ? '注意' : '正常';
  const getDaysTagColor = (d: number) => d >= 999 ? 'default' : d <= 3 ? 'error' : d <= 7 ? 'warning' : 'success';

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #6B73FF 0%, #000DFF 50%, #4A6CF7 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -40, right: -30, width: 180, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'absolute', bottom: -20, left: '40%', width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
            <span style={{
              width: 44, height: 44, borderRadius: 14,
              background: 'rgba(255,255,255,0.2)', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: 22,
            }}><DatabaseOutlined /></span>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>库存总览</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
                预估库存 = 审核入库 - 出库扫码 · 实时更新
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      {data && (
        <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
          {stats.map((s, i) => (
            <Col xs={12} sm={6} key={i}>
              <div style={{
                padding: '16px 18px', borderRadius: 14, background: s.bg,
                boxShadow: `0 4px 16px ${s.glow}`,
                animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${i * 0.08}s`,
              }}>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                  {s.icon} {s.label}
                </div>
                <div className="num" style={{ fontSize: 22, fontWeight: 700, color: '#fff' }}>
                  {typeof s.value === 'number' ? s.value.toLocaleString() : s.value}
                </div>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)' }}>{s.suffix}</span>
              </div>
            </Col>
          ))}
        </Row>
      )}

      {/* Filters */}
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-head">
          <span className="panel-title"><SearchOutlined style={{ color: '#1677ff' }} /> 筛选</span>
          <Space>
            <Button size="small" type={viewMode === 'grid' ? 'primary' : 'default'} icon={<AppstoreOutlined />}
              onClick={() => setViewMode('grid')} style={{ borderRadius: 6 }} />
            <Button size="small" type={viewMode === 'table' ? 'primary' : 'default'} icon={<UnorderedListOutlined />}
              onClick={() => setViewMode('table')} style={{ borderRadius: 6 }} />
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 8 }} />
            <Button icon={<DownloadOutlined />} onClick={exportCSV} style={{ borderRadius: 8 }}>导出</Button>
          </Space>
        </div>
        <div style={{ padding: '12px 20px' }}>
          <Row gutter={[12, 12]}>
            <Col xs={24} sm={12}>
              <Input prefix={<SearchOutlined style={{ color: 'var(--text-4)' }} />} placeholder="搜索 SKU / 水果"
                value={search} onChange={e => setSearch(e.target.value)} allowClear style={{ borderRadius: 8 }} />
            </Col>
            <Col xs={24} sm={12}>
              <Select value={fruitFilter} onChange={v => setFruitFilter(v)} allowClear
                placeholder="筛选水果类型" style={{ width: '100%', borderRadius: 8 }} options={fruitOptions} />
            </Col>
          </Row>
        </div>
      </div>

      {/* Overview Table */}
      {data && filteredGroups.length > 0 && (
        <div className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-head">
            <span className="panel-title"><BarChartOutlined style={{ color: '#6B73FF' }} /> 水果库存概览</span>
          </div>
          <div style={{ padding: '12px 16px' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {filteredGroups.map((g, i) => {
                const color = COLORS[i % COLORS.length];
                const maxStock = Math.max(...filteredGroups.map(gg => gg.total_stock), 1);
                const pct = Math.round((g.total_stock / maxStock) * 100);
                return (
                  <div key={g.fruit_name} style={{
                    flex: '1 1 120px', maxWidth: 200, padding: '14px 16px', borderRadius: 12,
                    border: `1px solid ${color}20`, background: `${color}04`,
                    animation: `stagger-in 0.4s ease both`, animationDelay: `${i * 0.06}s`,
                    transition: 'all 0.3s', cursor: 'default',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{ fontSize: 20 }}>{getFruitIcon(g.fruit_name)}</span>
                      <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-1)' }}>{g.fruit_name}</span>
                    </div>
                    <Progress percent={pct} showInfo={false} strokeColor={color} trailColor="rgba(0,0,0,0.04)" size="small" />
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12 }}>
                      <span className="num" style={{ fontWeight: 700, color, fontSize: 16 }}>{g.total_stock.toLocaleString()}</span>
                      <span style={{ color: 'var(--text-4)' }}>{g.sku_count} SKU</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80 }}><Spin size="large" /></div>
      ) : !data?.items?.length ? (
        <div className="panel" style={{ padding: 60, textAlign: 'center' }}>
          <Empty description="暂无库存数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        </div>
      ) : viewMode === 'grid' ? (
        /* Grid View - by fruit groups */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {filteredGroups.map((group, gi) => {
            const color = COLORS[gi % COLORS.length];
            return (
              <div key={group.fruit_name} className="panel" style={{
                overflow: 'hidden',
                animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`, animationDelay: `${gi * 0.08}s`,
              }}>
                <div style={{
                  padding: '14px 20px', borderBottom: '1px solid var(--border-2)',
                  background: `linear-gradient(135deg, ${color}08, ${color}03)`,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 24 }}>{getFruitIcon(group.fruit_name)}</span>
                    <span style={{ fontWeight: 700, fontSize: 16 }}>{group.fruit_name}</span>
                  </div>
                  <Tag style={{
                    borderRadius: 10, fontWeight: 700, fontSize: 14, padding: '4px 14px',
                    background: `${color}12`, color, border: `1px solid ${color}30`,
                  }}>
                    库存 {group.total_stock.toLocaleString()} 件
                  </Tag>
                </div>
                <div style={{
                  padding: 16, display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12,
                }}>
                  {group.items.map((item, si) => (
                    <div key={item.sku_id} style={{
                      padding: '14px 16px', borderRadius: 12,
                      border: '1px solid var(--border-2)', background: 'var(--bg-card)',
                      transition: 'all 0.3s',
                    }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = color; e.currentTarget.style.boxShadow = `0 4px 14px ${color}15`; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-2)'; e.currentTarget.style.boxShadow = 'none'; }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 14, color, marginBottom: 2 }}>{item.sku_name}</div>
                          {item.sku_description && (
                            <div style={{ fontSize: 12, color: 'var(--text-4)' }}>{item.sku_description}</div>
                          )}
                        </div>
                        <Tag color={getDaysTagColor(item.days_remaining)} style={{ borderRadius: 8, fontWeight: 600, fontSize: 11 }}>
                          {item.days_remaining >= 999 ? '∞' : `${item.days_remaining}天`}
                        </Tag>
                      </div>

                      <div style={{
                        display: 'flex', justifyContent: 'space-between', padding: '8px 0',
                        borderTop: '1px solid var(--border-2)', borderBottom: '1px solid var(--border-2)',
                        marginBottom: 8,
                      }}>
                        <div style={{ textAlign: 'center', flex: 1 }}>
                          <div style={{ fontSize: 10, color: 'var(--text-4)' }}>入库</div>
                          <div className="num" style={{ fontWeight: 700, color: '#1677ff' }}>{item.inbound}</div>
                        </div>
                        <div style={{ textAlign: 'center', flex: 1 }}>
                          <div style={{ fontSize: 10, color: 'var(--text-4)' }}>出库</div>
                          <div className="num" style={{ fontWeight: 700, color: '#fa8c16' }}>{item.outbound}</div>
                        </div>
                        <div style={{ textAlign: 'center', flex: 1, borderLeft: '1px solid var(--border-2)' }}>
                          <div style={{ fontSize: 10, color: 'var(--text-4)' }}>库存</div>
                          <div className="num" style={{ fontWeight: 800, color: '#00b96b', fontSize: 16 }}>{item.stock}</div>
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                        <Tooltip title="近7日出库">
                          <span style={{ color: 'var(--text-3)' }}>
                            <ThunderboltOutlined style={{ marginRight: 2 }} />7d: {item.outbound_7d}
                          </span>
                        </Tooltip>
                        <Tooltip title="日均出库">
                          <span style={{ color: 'var(--text-3)' }}>
                            <RiseOutlined style={{ marginRight: 2 }} />日均: {item.daily_rate}
                          </span>
                        </Tooltip>
                        <Tooltip title="预计可用天数">
                          <span style={{ color: getDaysColor(item.days_remaining), fontWeight: 600 }}>
                            <ClockCircleOutlined style={{ marginRight: 2 }} />
                            {item.days_remaining >= 999 ? '充足' : `${item.days_remaining}天`}
                          </span>
                        </Tooltip>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table View */
        <div className="panel">
          <div className="panel-head">
            <span className="panel-title"><UnorderedListOutlined style={{ color: '#1677ff' }} /> 库存明细表</span>
            <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{filteredItems.length} 条</span>
          </div>
          <Table
            dataSource={filteredItems}
            rowKey="sku_id"
            size="small"
            pagination={{ pageSize: 20, showTotal: t => `共 ${t} 条`, size: 'small' }}
            locale={{ emptyText: '暂无数据' }}
            columns={[
              {
                title: 'SKU', dataIndex: 'sku_name', width: 160, ellipsis: true,
                render: (v: string, r: SkuItem) => (
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 13, color: '#1677ff' }}>{v}</span>
                    <div style={{ fontSize: 11, color: 'var(--text-4)' }}>
                      {getFruitIcon(r.fruit_name)} {r.fruit_name}
                      {r.sku_description ? ` · ${r.sku_description}` : ''}
                    </div>
                  </div>
                ),
              },
              { title: '入库', dataIndex: 'inbound', width: 80, align: 'right' as const, sorter: (a: SkuItem, b: SkuItem) => a.inbound - b.inbound, render: (v: number) => <span className="num" style={{ fontWeight: 600, color: '#1677ff' }}>{v}</span> },
              { title: '出库', dataIndex: 'outbound', width: 80, align: 'right' as const, sorter: (a: SkuItem, b: SkuItem) => a.outbound - b.outbound, render: (v: number) => <span className="num" style={{ fontWeight: 600, color: '#fa8c16' }}>{v}</span> },
              { title: '库存', dataIndex: 'stock', width: 80, align: 'right' as const, defaultSortOrder: 'descend' as const, sorter: (a: SkuItem, b: SkuItem) => a.stock - b.stock, render: (v: number) => <span className="num" style={{ fontWeight: 800, color: '#00b96b' }}>{v}</span> },
              { title: '7日出库', dataIndex: 'outbound_7d', width: 80, align: 'right' as const, render: (v: number) => <span className="num">{v}</span> },
              { title: '日均', dataIndex: 'daily_rate', width: 60, align: 'right' as const, render: (v: number) => <span className="num">{v}</span> },
              {
                title: '预计天数', dataIndex: 'days_remaining', width: 100, align: 'center' as const,
                sorter: (a: SkuItem, b: SkuItem) => a.days_remaining - b.days_remaining,
                render: (v: number) => (
                  <Tag color={getDaysTagColor(v)} style={{ borderRadius: 8, fontWeight: 600 }}>
                    {v >= 999 ? '∞ 充足' : `${v}天`}
                    {v <= 3 && v < 999 && <WarningOutlined style={{ marginLeft: 3 }} />}
                  </Tag>
                ),
              },
            ]}
          />
        </div>
      )}

      {/* Info note */}
      {data && (
        <div style={{
          marginTop: 16, padding: '10px 16px', borderRadius: 10,
          background: 'linear-gradient(135deg, rgba(22,119,255,0.04), rgba(107,115,255,0.03))',
          border: '1px solid rgba(22,119,255,0.08)',
          fontSize: 12, color: 'var(--text-4)', lineHeight: 1.8,
        }}>
          <WarningOutlined style={{ color: '#fa8c16', marginRight: 6 }} />
          数据说明：库存 = 审核入库数 - 出库扫码数，可能存在少量误差（工人多录或未扫码上货）。建议定期进行实际盘点。
          库存率 {sm?.stock_rate ?? 0}%（当前库存占累计入库比例）
        </div>
      )}
    </div>
  );
}
