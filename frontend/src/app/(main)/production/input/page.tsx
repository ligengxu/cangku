'use client';

import { useEffect, useState, useCallback } from 'react';
import { Button, message, Spin, Empty } from 'antd';
import {
  CheckCircleOutlined, ReloadOutlined, SaveOutlined,
  ClockCircleOutlined, CloseCircleOutlined, EditOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dayjs from 'dayjs';
import { useAuth } from '@/stores/useAuth';
import { useDevice } from '@/hooks/useDevice';

interface DailySummaryItem {
  sku_id: number;
  sku_name: string;
  sku_description: string;
  fruit_name: string;
  production_performance: number;
  printed_quantity: number;
  actual_quantity: number;
  audit_status: string;
  production_id: number | null;
  has_pending_edit: boolean;
}

interface DailySummary {
  date: string;
  items: DailySummaryItem[];
  summary: { total_printed: number; total_actual: number; total_skus: number; completion_rate: number };
}

const STATUS_STYLE: Record<string, { label: string; bg: string; color: string; icon: React.ReactNode }> = {
  pending: { label: '待审核', bg: 'rgba(250,140,22,0.1)', color: '#fa8c16', icon: <ClockCircleOutlined /> },
  approved: { label: '已通过', bg: 'rgba(0,185,107,0.1)', color: '#00b96b', icon: <CheckCircleOutlined /> },
  rejected: { label: '已驳回', bg: 'rgba(255,77,79,0.1)', color: '#ff4d4f', icon: <CloseCircleOutlined /> },
};

export default function ProductionInputPage() {
  const user = useAuth(s => s.user);
  const isAdmin = user?.role === 'admin';
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [inputs, setInputs] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await api.get('/production/my-daily-summary', {
        params: { production_date: dayjs().format('YYYY-MM-DD') },
      });
      const d = res.data?.data;
      setSummary(d ?? null);
      if (d?.items) {
        const map: Record<number, number> = {};
        d.items.forEach((item: DailySummaryItem) => { map[item.sku_id] = item.actual_quantity; });
        setInputs(map);
      }
    } catch { message.error('加载失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const handleSave = async (item: DailySummaryItem) => {
    const qty = inputs[item.sku_id] ?? 0;
    if (qty <= 0) { message.error('数量必须大于0'); return; }
    if (qty > item.printed_quantity && item.printed_quantity > 0) {
      message.error(`不能超过打印数量 ${item.printed_quantity}`);
      return;
    }
    setSaving(item.sku_id);
    try {
      const res = await api.post('/production/worker-input', {
        sku_id: item.sku_id,
        actual_packaging_quantity: qty,
        production_date: dayjs().format('YYYY-MM-DD'),
      });
      message.success(res.data?.message ?? '保存成功');
      setSaved(item.sku_id);
      setTimeout(() => setSaved(null), 2000);
      fetchSummary();
    } catch (e: any) { message.error(e?.response?.data?.detail ?? '保存失败'); }
    finally { setSaving(null); }
  };

  const adjust = (skuId: number, delta: number, max: number) => {
    setInputs(prev => {
      const cur = prev[skuId] ?? 0;
      const next = Math.max(0, Math.min(max > 0 ? max : 99999, cur + delta));
      return { ...prev, [skuId]: next };
    });
  };

  const skuLabel = (s: DailySummaryItem) => (s.sku_description || '').trim() || `${s.fruit_name} ${s.sku_name}`;

  const { isMobile } = useDevice();

  const items = summary?.items || [];
  const totalPrinted = summary?.summary?.total_printed ?? 0;
  const totalActual = summary?.summary?.total_actual ?? 0;

  if (isAdmin) {
    return (
      <div style={{ maxWidth: 800, margin: '0 auto', padding: 20 }}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>生产录入</div>
        <div style={{ color: 'var(--text-3)' }}>此页面为工人端操作页面，管理员请前往「生产审核」查看工人提交的数据。</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', padding: isMobile ? '0 16px' : '0 4px' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: isMobile ? '20px 0 10px' : '16px 4px 8px',
      }}>
        <div style={{ fontSize: isMobile ? 24 : 22, fontWeight: 800, color: 'var(--text-1)' }}>生产录入</div>
        <Button type="text" icon={<ReloadOutlined />} onClick={() => { setLoading(true); fetchSummary(); }}
          style={{ fontSize: 16, color: 'var(--text-3)' }} />
      </div>

      {/* Today stats */}
      <div style={{
        display: 'flex', gap: 10, marginBottom: 16, padding: '0 4px',
      }}>
        <div style={{
          flex: 1, padding: '14px', borderRadius: 14,
          background: 'linear-gradient(135deg, #1677ff, #69b1ff)',
          color: '#fff', textAlign: 'center',
        }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>今日打印</div>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.2 }}>{totalPrinted}</div>
        </div>
        <div style={{
          flex: 1, padding: '14px', borderRadius: 14,
          background: 'linear-gradient(135deg, #00b96b, #5cdbd3)',
          color: '#fff', textAlign: 'center',
        }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>已录入</div>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.2 }}>{totalActual}</div>
        </div>
        <div style={{
          flex: 1, padding: '14px', borderRadius: 14,
          background: totalPrinted > 0 && totalActual >= totalPrinted
            ? 'linear-gradient(135deg, #722ed1, #b37feb)'
            : 'linear-gradient(135deg, #fa8c16, #ffc53d)',
          color: '#fff', textAlign: 'center',
        }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>完成率</div>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.2 }}>
            {totalPrinted > 0 ? Math.round(totalActual / totalPrinted * 100) : 0}%
          </div>
        </div>
      </div>

      <div style={{ fontSize: 14, color: 'var(--text-3)', padding: '0 4px', marginBottom: 12 }}>
        {dayjs().format('M月D日')} · 对每个产品录入实际包装数量
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>
      ) : items.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '60px 20px', borderRadius: 20,
          background: 'rgba(0,0,0,0.02)', border: '2px dashed rgba(0,0,0,0.06)',
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📦</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>今天还没有打印记录</div>
          <div style={{ fontSize: 15, color: 'var(--text-3)' }}>先去「我的任务」提交产品，打印后再来录入</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map(item => {
            const qty = inputs[item.sku_id] ?? 0;
            const isSaved = saved === item.sku_id;
            const st = STATUS_STYLE[item.audit_status] || STATUS_STYLE.pending;
            const isApproved = item.audit_status === 'approved';
            const hasPendingEdit = item.has_pending_edit;

            return (
              <div key={item.sku_id} style={{
                padding: '18px', borderRadius: 18,
                background: isSaved ? 'rgba(0,185,107,0.04)' : '#fff',
                border: isSaved ? '2px solid rgba(0,185,107,0.3)' : '2px solid rgba(0,0,0,0.06)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                transition: 'all 0.3s',
              }}>
                {/* SKU info */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>{skuLabel(item)}</div>
                    <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
                      打印 {item.printed_quantity} 件 · ¥{item.production_performance}/件
                    </div>
                  </div>
                  {item.production_id && (
                    <div style={{
                      padding: '3px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                      background: st.bg, color: st.color,
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                      {st.icon} {st.label}
                    </div>
                  )}
                </div>

                {hasPendingEdit ? (
                  <div style={{
                    padding: '12px', borderRadius: 12, textAlign: 'center',
                    background: 'rgba(250,140,22,0.06)', border: '1px solid rgba(250,140,22,0.15)',
                    color: '#fa8c16', fontSize: 14, fontWeight: 600,
                  }}>
                    修改申请审核中，请等待
                  </div>
                ) : (
                  <>
                    {isApproved && (
                      <div style={{
                        padding: '10px 12px', borderRadius: 12, marginBottom: 14,
                        background: 'rgba(0,185,107,0.06)', border: '1px solid rgba(0,185,107,0.15)',
                        color: '#00b96b', fontSize: 14, fontWeight: 600,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}>
                        <CheckCircleOutlined /> 已审核 {item.actual_quantity} 件
                        <span style={{ color: 'var(--text-4)', fontWeight: 400, fontSize: 12 }}>· 可修改数量提交审批</span>
                      </div>
                    )}

                    {/* Quantity controls */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 14 }}>
                      <button onClick={() => adjust(item.sku_id, -10, item.printed_quantity)}
                        style={{
                          width: 44, height: 44, borderRadius: 12, border: '2px solid rgba(0,0,0,0.06)',
                          background: '#fff', fontSize: 14, fontWeight: 700, color: 'var(--text-2)',
                          cursor: 'pointer',
                        }}>-10</button>
                      <button onClick={() => adjust(item.sku_id, -1, item.printed_quantity)}
                        style={{
                          width: 48, height: 48, borderRadius: 14, border: '2px solid rgba(0,0,0,0.06)',
                          background: '#fff', fontSize: 22, fontWeight: 700, color: 'var(--text-1)',
                          cursor: 'pointer',
                        }}>−</button>
                      <div style={{
                        width: 80, height: 52, borderRadius: 14,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: qty > 0
                          ? (isApproved ? 'linear-gradient(135deg, #722ed1, #b37feb)' : 'linear-gradient(135deg, #1677ff, #4d6bfe)')
                          : 'rgba(0,0,0,0.04)',
                        color: qty > 0 ? '#fff' : 'var(--text-3)',
                        fontSize: 26, fontWeight: 800,
                        boxShadow: qty > 0 ? '0 3px 12px rgba(22,119,255,0.2)' : 'none',
                      }}>{qty}</div>
                      <button onClick={() => adjust(item.sku_id, 1, item.printed_quantity)}
                        style={{
                          width: 48, height: 48, borderRadius: 14, border: '2px solid rgba(0,0,0,0.06)',
                          background: '#fff', fontSize: 22, fontWeight: 700, color: 'var(--text-1)',
                          cursor: 'pointer',
                        }}>+</button>
                      <button onClick={() => adjust(item.sku_id, 10, item.printed_quantity)}
                        style={{
                          width: 44, height: 44, borderRadius: 12, border: '2px solid rgba(0,0,0,0.06)',
                          background: '#fff', fontSize: 14, fontWeight: 700, color: 'var(--text-2)',
                          cursor: 'pointer',
                        }}>+10</button>
                    </div>

                    {/* Fill all button */}
                    {item.printed_quantity > 0 && qty !== item.printed_quantity && (
                      <button onClick={() => setInputs(prev => ({ ...prev, [item.sku_id]: item.printed_quantity }))}
                        style={{
                          width: '100%', padding: '8px', borderRadius: 10, border: '1px solid rgba(22,119,255,0.15)',
                          background: 'rgba(22,119,255,0.04)', color: '#1677ff', fontSize: 14, fontWeight: 600,
                          cursor: 'pointer', marginBottom: 10, WebkitTapHighlightColor: 'transparent',
                        }}>
                        全部完成（填入 {item.printed_quantity}）
                      </button>
                    )}

                    {/* Save / Submit edit request button */}
                    <button onClick={() => handleSave(item)}
                      disabled={saving === item.sku_id || qty <= 0 || (isApproved && qty === item.actual_quantity)}
                      style={{
                        width: '100%', padding: '14px', borderRadius: 14, border: 'none',
                        background: isSaved
                          ? '#00b96b'
                          : (isApproved
                            ? (qty > 0 && qty !== item.actual_quantity ? 'linear-gradient(135deg, #722ed1, #b37feb)' : 'rgba(0,0,0,0.06)')
                            : (qty > 0 ? 'linear-gradient(135deg, #00b96b, #5cdbd3)' : 'rgba(0,0,0,0.06)')),
                        color: (qty > 0 && (!isApproved || qty !== item.actual_quantity)) ? '#fff' : 'var(--text-4)',
                        fontSize: 17, fontWeight: 700,
                        cursor: (qty > 0 && (!isApproved || qty !== item.actual_quantity)) ? 'pointer' : 'not-allowed',
                        boxShadow: (qty > 0 && (!isApproved || qty !== item.actual_quantity)) ? '0 4px 16px rgba(0,185,107,0.2)' : 'none',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        WebkitTapHighlightColor: 'transparent',
                      }}>
                      {saving === item.sku_id ? '提交中...' : isSaved ? (
                        <><CheckCircleOutlined /> 已提交</>
                      ) : isApproved ? (
                        qty > 0 && qty !== item.actual_quantity
                          ? <><EditOutlined /> 提交修改申请（{item.actual_quantity} → {qty} 件）</>
                          : <><CheckCircleOutlined /> 已审核 {item.actual_quantity} 件</>
                      ) : (
                        <><SaveOutlined /> 保存 {qty > 0 ? `${qty} 件` : ''}</>
                      )}
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
