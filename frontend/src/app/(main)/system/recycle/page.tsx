'use client';

import { useState, useEffect, useCallback } from 'react';
import { Table, message, Space, Row, Col, Tooltip, Button, Tag, Popconfirm, Modal, Empty } from 'antd';
import {
  DeleteOutlined, RestOutlined, ReloadOutlined, ExclamationCircleOutlined,
  ShoppingCartOutlined, ExperimentOutlined, DropboxOutlined, ShopOutlined,
  UndoOutlined, ClearOutlined, WarningOutlined, CheckCircleOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

interface RecycleItem {
  id: number;
  category: string;
  category_label: string;
  name: string;
  deleted_at: string;
}

const CAT_CONFIG: Record<string, { icon: React.ReactNode; color: string; gradient: string }> = {
  fruit_purchase: { icon: <ShoppingCartOutlined />, color: '#00b96b', gradient: 'linear-gradient(135deg, #00b96b, #5cdbd3)' },
  carton_purchase: { icon: <DropboxOutlined />, color: '#13c2c2', gradient: 'linear-gradient(135deg, #13c2c2, #5cdbd3)' },
  material_purchase: { icon: <ExperimentOutlined />, color: '#722ed1', gradient: 'linear-gradient(135deg, #722ed1, #b37feb)' },
  supplier: { icon: <ShopOutlined />, color: '#1677ff', gradient: 'linear-gradient(135deg, #1677ff, #69b1ff)' },
};

export default function RecyclePage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<RecycleItem[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<React.Key[]>([]);
  const [refreshSpin, setRefreshSpin] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, any> = { page, page_size: pageSize };
      if (activeTab) params.category = activeTab;
      const res = await api.get('/recycle', { params });
      const d = res.data?.data;
      setData(d?.items ?? []);
      setTotal(d?.total ?? 0);
      setCounts(d?.counts ?? {});
    } catch {
      message.error('加载回收站失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, activeTab]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleRefresh = () => {
    setRefreshSpin(true);
    fetchData().finally(() => setTimeout(() => setRefreshSpin(false), 600));
  };

  const handleRestore = async (category: string, id: number) => {
    try {
      await api.post(`/recycle/restore?category=${category}&item_id=${id}`);
      message.success('恢复成功');
      setSelectedKeys(prev => prev.filter(k => k !== `${category}:${id}`));
      fetchData();
    } catch {
      message.error('恢复失败');
    }
  };

  const handlePermanentDelete = async (category: string, id: number) => {
    try {
      await api.delete(`/recycle/permanent?category=${category}&item_id=${id}`);
      message.success('永久删除成功');
      setSelectedKeys(prev => prev.filter(k => k !== `${category}:${id}`));
      fetchData();
    } catch {
      message.error('删除失败');
    }
  };

  const handleBatchRestore = async () => {
    if (!selectedKeys.length) return;
    const items = selectedKeys.map(k => {
      const [cat, id] = (k as string).split(':');
      return { category: cat, id: parseInt(id) };
    });
    try {
      await api.post('/recycle/restore-batch', items);
      message.success(`成功恢复 ${items.length} 条记录`);
      setSelectedKeys([]);
      fetchData();
    } catch {
      message.error('批量恢复失败');
    }
  };

  const handleEmptyBin = () => {
    const scope = activeTab ? CAT_CONFIG[activeTab] : null;
    Modal.confirm({
      title: '清空回收站',
      icon: <ExclamationCircleOutlined />,
      content: `确定要${scope ? `清空所有已删除的${(counts as any)[activeTab!] ?? 0}条记录` : '清空整个回收站'}吗？此操作不可恢复！`,
      okText: '确定清空',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const params: Record<string, string> = {};
          if (activeTab) params.category = activeTab;
          await api.delete('/recycle/empty', { params });
          message.success('清空成功');
          setSelectedKeys([]);
          fetchData();
        } catch {
          message.error('清空失败');
        }
      },
    });
  };

  const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);

  const tabs = [
    { key: null, label: '全部', count: totalCount, gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', glow: 'rgba(250,140,22,0.15)' },
    { key: 'fruit_purchase', label: '水果采购', count: counts.fruit_purchase ?? 0, gradient: CAT_CONFIG.fruit_purchase.gradient, glow: 'rgba(0,185,107,0.15)' },
    { key: 'carton_purchase', label: '纸箱采购', count: counts.carton_purchase ?? 0, gradient: CAT_CONFIG.carton_purchase.gradient, glow: 'rgba(19,194,194,0.15)' },
    { key: 'material_purchase', label: '材料采购', count: counts.material_purchase ?? 0, gradient: CAT_CONFIG.material_purchase.gradient, glow: 'rgba(114,46,209,0.15)' },
    { key: 'supplier', label: '供应商', count: counts.supplier ?? 0, gradient: CAT_CONFIG.supplier.gradient, glow: 'rgba(22,119,255,0.15)' },
  ];

  const columns = [
    {
      title: '类型', dataIndex: 'category', key: 'category', width: 130,
      render: (_: string, r: RecycleItem) => {
        const cfg = CAT_CONFIG[r.category] || { gradient: '#999', icon: <DeleteOutlined />, color: '#999' };
        return (
          <Space size={8}>
            <span style={{
              width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: cfg.gradient, color: '#fff', fontSize: 13,
            }}>{cfg.icon}</span>
            <span style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: 13 }}>{r.category_label}</span>
          </Space>
        );
      },
    },
    {
      title: '名称', dataIndex: 'name', key: 'name', ellipsis: true,
      render: (v: string, r: RecycleItem) => (
        <span style={{ color: 'var(--text-2)', fontSize: 13 }}>
          <span style={{ color: 'var(--text-4)', fontSize: 11, marginRight: 6 }}>#{r.id}</span>
          {v}
        </span>
      ),
    },
    {
      title: '删除时间', dataIndex: 'deleted_at', key: 'deleted_at', width: 190,
      render: (v: string) => v ? (
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{dayjs(v).format('YYYY-MM-DD HH:mm:ss')}</div>
          <div style={{ fontSize: 11, color: 'var(--text-4)' }}>{dayjs(v).fromNow()}</div>
        </div>
      ) : '-',
    },
    {
      title: '操作', key: 'action', width: 180, align: 'center' as const,
      render: (_: any, r: RecycleItem) => (
        <Space size={4}>
          <Tooltip title="恢复">
            <Button
              type="link" size="small"
              icon={<UndoOutlined />}
              onClick={() => handleRestore(r.category, r.id)}
              style={{ color: '#00b96b', fontWeight: 600 }}
            >
              恢复
            </Button>
          </Tooltip>
          <Popconfirm
            title="永久删除"
            description="此操作不可恢复，确定要永久删除吗？"
            onConfirm={() => handlePermanentDelete(r.category, r.id)}
            okText="确定"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              永久删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22,
        padding: '20px 24px', borderRadius: 'var(--radius-l)',
        background: 'linear-gradient(135deg, rgba(255,77,79,0.06) 0%, rgba(250,140,22,0.04) 100%)',
        border: '1px solid rgba(255,77,79,0.08)',
      }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 32, height: 32, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #ff4d4f 0%, #fa8c16 100%)', color: '#fff', fontSize: 15,
              boxShadow: '0 3px 10px rgba(255,77,79,0.2)',
            }}><RestOutlined /></span>
            回收站
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4, marginLeft: 42 }}>
            已删除的数据在此暂存，可以恢复或永久删除
          </div>
        </div>
        <Space>
          <Tooltip title="刷新">
            <Button icon={<ReloadOutlined spin={refreshSpin} />} onClick={handleRefresh} style={{ borderRadius: 10, height: 38, width: 38 }} />
          </Tooltip>
          {totalCount > 0 && (
            <Tooltip title="清空回收站">
              <Button danger icon={<ClearOutlined />} onClick={handleEmptyBin} style={{ borderRadius: 10, height: 38 }}>
                清空
              </Button>
            </Tooltip>
          )}
        </Space>
      </div>

      {/* Category Tabs */}
      <Row gutter={[10, 10]} style={{ marginBottom: 18 }}>
        {tabs.map((tab, i) => {
          const isActive = activeTab === tab.key;
          return (
            <Col xs={12} sm={8} md={4} lg={4} key={tab.key ?? 'all'}>
              <div
                onClick={() => { setActiveTab(tab.key as string | null); setPage(1); setSelectedKeys([]); }}
                style={{
                  padding: '12px 14px', borderRadius: 'var(--radius-m)', cursor: 'pointer',
                  background: isActive ? tab.gradient : 'var(--glass-bg)',
                  border: isActive ? 'none' : '1px solid var(--border)',
                  boxShadow: isActive ? `0 4px 14px ${tab.glow}` : 'none',
                  transition: 'all 0.3s cubic-bezier(0.22,1,0.36,1)',
                  animation: `stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both`,
                  animationDelay: `${i * 0.06}s`,
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.transform = 'translateY(-2px)'; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.transform = ''; }}
              >
                <div style={{ fontSize: 11, color: isActive ? 'rgba(255,255,255,0.8)' : 'var(--text-3)', marginBottom: 2 }}>{tab.label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: isActive ? '#fff' : 'var(--text-1)', lineHeight: 1.2 }} className="num">
                  {tab.count}
                  <span style={{ fontSize: 11, fontWeight: 400, marginLeft: 3, opacity: 0.7 }}>条</span>
                </div>
              </div>
            </Col>
          );
        })}
      </Row>

      {/* Batch Actions */}
      {selectedKeys.length > 0 && (
        <div style={{
          marginBottom: 14, padding: '10px 18px', borderRadius: 'var(--radius-m)',
          background: 'linear-gradient(135deg, rgba(0,185,107,0.06) 0%, rgba(22,119,255,0.04) 100%)',
          border: '1px solid rgba(0,185,107,0.1)',
          display: 'flex', alignItems: 'center', gap: 12,
          animation: 'stagger-in 0.3s cubic-bezier(0.22,1,0.36,1) both',
        }}>
          <CheckCircleOutlined style={{ color: '#00b96b', fontSize: 16 }} />
          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
            已选中 <strong style={{ color: '#00b96b' }}>{selectedKeys.length}</strong> 条记录
          </span>
          <Button type="primary" size="small" icon={<UndoOutlined />} onClick={handleBatchRestore}
            style={{ borderRadius: 8, background: 'linear-gradient(135deg, #00b96b, #5cdbd3)', border: 'none', marginLeft: 'auto' }}>
            批量恢复
          </Button>
          <Button size="small" onClick={() => setSelectedKeys([])} style={{ borderRadius: 8 }}>取消选择</Button>
        </div>
      )}

      {/* Table */}
      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">
            <DeleteOutlined style={{ color: '#ff4d4f' }} />
            {activeTab ? CAT_CONFIG[activeTab]?.icon : null}
            已删除的数据
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-4)' }}>共 {total} 条</span>
        </div>
        {totalCount === 0 ? (
          <div style={{ padding: '60px 0', textAlign: 'center' }}>
            <InboxOutlined style={{ fontSize: 48, color: 'var(--text-4)', marginBottom: 16 }} />
            <div style={{ fontSize: 15, color: 'var(--text-3)', marginBottom: 4 }}>回收站是空的</div>
            <div style={{ fontSize: 12, color: 'var(--text-4)' }}>删除的采购记录和供应商会暂存在这里</div>
          </div>
        ) : (
          <Table
            dataSource={data}
            columns={columns}
            rowKey={r => `${r.category}:${r.id}`}
            size="middle"
            loading={loading}
            rowSelection={{
              selectedRowKeys: selectedKeys,
              onChange: setSelectedKeys,
            }}
            pagination={{
              current: page, pageSize, total,
              showSizeChanger: true, pageSizeOptions: ['10', '20', '50'],
              showTotal: t => `共 ${t} 条`,
              onChange: (p, ps) => { setPage(p); setPageSize(ps ?? 20); },
            }}
            locale={{ emptyText: '暂无数据' }}
          />
        )}
      </div>

      {/* Safety Notice */}
      {totalCount > 0 && (
        <div style={{
          marginTop: 16, padding: '12px 18px', borderRadius: 'var(--radius-m)',
          background: 'linear-gradient(135deg, rgba(250,140,22,0.05) 0%, rgba(250,140,22,0.02) 100%)',
          border: '1px solid rgba(250,140,22,0.1)',
          display: 'flex', alignItems: 'center', gap: 10,
          animation: 'stagger-in 0.5s cubic-bezier(0.22,1,0.36,1) both',
          animationDelay: '0.2s',
        }}>
          <WarningOutlined style={{ color: '#fa8c16', fontSize: 16 }} />
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
            回收站中的数据不会计入报表统计。永久删除后数据将无法恢复，请谨慎操作。
          </span>
        </div>
      )}
    </div>
  );
}
