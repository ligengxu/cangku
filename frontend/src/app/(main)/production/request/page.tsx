'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button, message, Empty, Spin, Modal, InputNumber } from 'antd';
import { CheckCircleOutlined, ReloadOutlined, ArrowLeftOutlined, SendOutlined } from '@ant-design/icons';
import api from '@/services/api';
import dayjs from 'dayjs';
import { useDevice } from '@/hooks/useDevice';

interface Batch {
  assignment_id: number;
  purchase_id: number;
  fruit_name: string;
  supplier_name: string;
  purchase_date: string;
  purchase_weight: number;
  is_today: boolean;
}

interface SkuItem {
  id: number;
  sku_name: string;
  sku_description: string;
  fruit_name: string;
  total_weight: number;
  production_performance: number;
  today_submitted: number;
}

const FRUIT_ICONS: Record<string, string> = {
  '苹果': '🍎', '梨': '🍐', '橙': '🍊', '柠檬': '🍋', '桃': '🍑',
  '樱桃': '🍒', '葡萄': '🍇', '西瓜': '🍉', '芒果': '🥭', '猕猴桃': '🥝',
  '香蕉': '🍌', '菠萝': '🍍', '草莓': '🍓', '蓝莓': '🫐', '雪莲果': '🥔',
};

function getIcon(name: string): string {
  for (const [k, v] of Object.entries(FRUIT_ICONS)) if (name.includes(k)) return v;
  return '🍎';
}

export default function WorkerTaskPage() {
  const [step, setStep] = useState<'batch' | 'sku' | 'qty'>('batch');
  const [batches, setBatches] = useState<Batch[]>([]);
  const [skus, setSkus] = useState<SkuItem[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  const [selectedSku, setSelectedSku] = useState<SkuItem | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [todayTotal, setTodayTotal] = useState(0);

  const fetchBatches = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/production/my-batches');
      setBatches(r.data?.data || []);
    } catch { message.error('加载失败'); }
    finally { setLoading(false); }
  }, []);

  const fetchTodaySummary = useCallback(async () => {
    try {
      const r = await api.get('/production/my-transactions', { params: { page_size: 200 } });
      const txns = r.data?.data || [];
      const today = dayjs().format('YYYY-MM-DD');
      const todayQty = txns.filter((t: any) => t.transaction_date?.startsWith(today)).reduce((a: number, t: any) => a + (t.quantity || 0), 0);
      setTodayTotal(todayQty);
    } catch {}
  }, []);

  useEffect(() => { fetchBatches(); fetchTodaySummary(); }, [fetchBatches, fetchTodaySummary]);

  const selectBatch = async (batch: Batch) => {
    setSelectedBatch(batch);
    setStep('sku');
    try {
      const r = await api.get(`/production/batch-skus/${batch.purchase_id}`);
      setSkus(r.data?.data || []);
    } catch { message.error('加载产品失败'); }
  };

  const selectSku = (sku: SkuItem) => {
    setSelectedSku(sku);
    setQuantity(1);
    setStep('qty');
  };

  const submit = async () => {
    if (!selectedBatch || !selectedSku || quantity < 1) return;
    setSubmitting(true);
    try {
      await api.post('/production/sku-transaction', {
        fruit_purchase_id: selectedBatch.purchase_id,
        sku_id: selectedSku.id,
        quantity,
        fruit_name: selectedBatch.fruit_name,
      });
      message.success(`提交成功！${(selectedSku.sku_description || selectedSku.sku_name)} × ${quantity}`);
      setStep('batch');
      setSelectedBatch(null);
      setSelectedSku(null);
      setQuantity(1);
      fetchBatches();
      fetchTodaySummary();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '提交失败');
    } finally { setSubmitting(false); }
  };

  const goBack = () => {
    if (step === 'qty') { setStep('sku'); setSelectedSku(null); }
    else if (step === 'sku') { setStep('batch'); setSelectedBatch(null); }
  };

  const skuLabel = (s: SkuItem) => (s.sku_description || '').trim() || `${s.fruit_name} ${s.sku_name}`;

  const { isMobile } = useDevice();

  return (
    <div style={{ maxWidth: 500, margin: '0 auto', padding: isMobile ? '0 16px' : '0 4px' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: isMobile ? '20px 0 14px' : '16px 4px 12px', marginBottom: 8,
      }}>
        {step !== 'batch' ? (
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={goBack}
            style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)', padding: '4px 8px', height: 'auto' }}>
            返回
          </Button>
        ) : (
          <div style={{ fontSize: isMobile ? 24 : 22, fontWeight: 800, color: 'var(--text-1)' }}>我的任务</div>
        )}
        <Button type="text" icon={<ReloadOutlined />} onClick={() => { fetchBatches(); fetchTodaySummary(); }}
          style={{ fontSize: 16, color: 'var(--text-3)' }} />
      </div>

      {/* Today summary */}
      {step === 'batch' && todayTotal > 0 && (
        <div style={{
          padding: '14px 18px', borderRadius: 16, marginBottom: 16,
          background: 'linear-gradient(135deg, #00b96b, #5cdbd3)',
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 13, opacity: 0.85 }}>今日已提交</div>
            <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.2 }}>{todayTotal} <span style={{ fontSize: 14, fontWeight: 400 }}>件</span></div>
          </div>
          <CheckCircleOutlined style={{ fontSize: 40, opacity: 0.3 }} />
        </div>
      )}

      {/* Step: Select Batch */}
      {step === 'batch' && (
        loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>
        ) : batches.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '60px 20px', borderRadius: 20,
            background: 'rgba(0,0,0,0.02)', border: '2px dashed rgba(0,0,0,0.06)',
          }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', marginBottom: 8 }}>今天没有派工</div>
            <div style={{ fontSize: 15, color: 'var(--text-3)' }}>请联系库管分配任务</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 15, color: 'var(--text-3)', padding: '0 4px', marginBottom: 4 }}>
              点击选择今天的批次 ({batches.length}个)
            </div>
            {batches.map(b => (
              <div key={b.purchase_id} onClick={() => selectBatch(b)}
                style={{
                  padding: '20px', borderRadius: 18, cursor: 'pointer',
                  background: '#fff', border: '2px solid rgba(0,0,0,0.06)',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
                  transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 16,
                  WebkitTapHighlightColor: 'transparent',
                }}
                onTouchStart={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.98)'; }}
                onTouchEnd={e => { (e.currentTarget as HTMLElement).style.transform = ''; }}
              >
                <div style={{
                  width: 56, height: 56, borderRadius: 16, fontSize: 28,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'linear-gradient(135deg, rgba(22,119,255,0.08), rgba(22,119,255,0.03))',
                  flexShrink: 0,
                }}>{getIcon(b.fruit_name)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)' }}>{b.fruit_name}</div>
                  <div style={{ fontSize: 14, color: 'var(--text-3)', marginTop: 4 }}>
                    {b.supplier_name} · {b.purchase_weight}kg
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 2 }}>
                    批次 #{b.purchase_id} · {b.purchase_date}
                  </div>
                </div>
                <div style={{ fontSize: 24, color: 'var(--text-4)' }}>›</div>
              </div>
            ))}
          </div>
        )
      )}

      {/* Step: Select SKU */}
      {step === 'sku' && selectedBatch && (
        <div>
          <div style={{
            padding: '12px 16px', borderRadius: 14, marginBottom: 16,
            background: 'linear-gradient(135deg, rgba(22,119,255,0.06), rgba(22,119,255,0.02))',
            border: '1px solid rgba(22,119,255,0.1)',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{ fontSize: 24 }}>{getIcon(selectedBatch.fruit_name)}</span>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{selectedBatch.fruit_name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>批次 #{selectedBatch.purchase_id}</div>
            </div>
          </div>

          <div style={{ fontSize: 15, color: 'var(--text-3)', padding: '0 4px', marginBottom: 12 }}>
            选择要做的产品
          </div>

          {skus.length === 0 ? (
            <Empty description="该批次暂无可选产品" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {skus.map(s => (
                <div key={s.id} onClick={() => selectSku(s)}
                  style={{
                    padding: '18px 20px', borderRadius: 16, cursor: 'pointer',
                    background: '#fff', border: '2px solid rgba(0,0,0,0.06)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                    transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    WebkitTapHighlightColor: 'transparent',
                  }}
                  onTouchStart={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.98)'; }}
                  onTouchEnd={e => { (e.currentTarget as HTMLElement).style.transform = ''; }}
                >
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>{skuLabel(s)}</div>
                    <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
                      {s.total_weight}kg/件 · 绩效 ¥{s.production_performance}
                    </div>
                    {s.today_submitted > 0 && (
                      <div style={{ fontSize: 12, color: '#00b96b', fontWeight: 600, marginTop: 4 }}>
                        今日已提交 {s.today_submitted} 件
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 24, color: 'var(--text-4)' }}>›</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step: Input Quantity */}
      {step === 'qty' && selectedBatch && selectedSku && (
        <div>
          <div style={{
            padding: '20px', borderRadius: 18, marginBottom: 20,
            background: 'linear-gradient(135deg, rgba(114,46,209,0.06), rgba(22,119,255,0.03))',
            border: '1px solid rgba(114,46,209,0.1)', textAlign: 'center',
          }}>
            <div style={{ fontSize: 14, color: 'var(--text-3)', marginBottom: 4 }}>{selectedBatch.fruit_name} · 批次 #{selectedBatch.purchase_id}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-1)' }}>{skuLabel(selectedSku)}</div>
            <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 6 }}>
              {selectedSku.total_weight}kg/件 · 绩效 ¥{selectedSku.production_performance}/件
            </div>
          </div>

          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-2)', textAlign: 'center', marginBottom: 16 }}>
            输入数量
          </div>

          {/* Big quantity controls */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 24 }}>
            <button onClick={() => setQuantity(Math.max(1, quantity - 10))}
              style={{
                width: 52, height: 52, borderRadius: 14, border: '2px solid rgba(0,0,0,0.08)',
                background: '#fff', fontSize: 16, fontWeight: 700, color: 'var(--text-2)',
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              }}>-10</button>
            <button onClick={() => setQuantity(Math.max(1, quantity - 1))}
              style={{
                width: 56, height: 56, borderRadius: 16, border: '2px solid rgba(0,0,0,0.08)',
                background: '#fff', fontSize: 24, fontWeight: 700, color: 'var(--text-1)',
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              }}>−</button>
            <div style={{
              width: 100, height: 64, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #1677ff, #4d6bfe)',
              color: '#fff', fontSize: 32, fontWeight: 800,
              boxShadow: '0 4px 16px rgba(22,119,255,0.25)',
            }}>{quantity}</div>
            <button onClick={() => setQuantity(quantity + 1)}
              style={{
                width: 56, height: 56, borderRadius: 16, border: '2px solid rgba(0,0,0,0.08)',
                background: '#fff', fontSize: 24, fontWeight: 700, color: 'var(--text-1)',
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              }}>+</button>
            <button onClick={() => setQuantity(quantity + 10)}
              style={{
                width: 52, height: 52, borderRadius: 14, border: '2px solid rgba(0,0,0,0.08)',
                background: '#fff', fontSize: 16, fontWeight: 700, color: 'var(--text-2)',
                cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
              }}>+10</button>
          </div>

          {/* Quick numbers */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 28, flexWrap: 'wrap' }}>
            {[5, 10, 20, 50, 100].map(n => (
              <button key={n} onClick={() => setQuantity(n)}
                style={{
                  padding: '10px 20px', borderRadius: 12, fontSize: 16, fontWeight: 600,
                  border: quantity === n ? '2px solid #1677ff' : '2px solid rgba(0,0,0,0.06)',
                  background: quantity === n ? 'rgba(22,119,255,0.06)' : '#fff',
                  color: quantity === n ? '#1677ff' : 'var(--text-2)',
                  cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
                }}>{n}</button>
            ))}
          </div>

          {/* Submit button */}
          <button onClick={submit} disabled={submitting}
            style={{
              width: '100%', padding: '18px', borderRadius: 18, border: 'none',
              background: submitting ? '#ccc' : 'linear-gradient(135deg, #00b96b, #5cdbd3)',
              color: '#fff', fontSize: 20, fontWeight: 800, cursor: submitting ? 'not-allowed' : 'pointer',
              boxShadow: '0 6px 24px rgba(0,185,107,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
              WebkitTapHighlightColor: 'transparent',
            }}>
            <SendOutlined />
            {submitting ? '提交中...' : `确认提交 ${quantity} 件`}
          </button>
        </div>
      )}
    </div>
  );
}
