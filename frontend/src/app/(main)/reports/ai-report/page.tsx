'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Input, Button, Table, Tag, Row, Col, Space, Empty, Spin, message,
  Tooltip, Typography,
} from 'antd';
import {
  RobotOutlined, SendOutlined, ThunderboltOutlined, ReloadOutlined,
  TableOutlined, BarChartOutlined, PieChartOutlined, LineChartOutlined,
  CopyOutlined, DownloadOutlined, DatabaseOutlined, BulbOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dynamic from 'next/dynamic';
import { exportToCsv } from '@/utils/exportCsv';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });
const { Text, Paragraph } = Typography;

interface ReportResult {
  sql: string;
  description: string;
  chart_type: string;
  columns: string[];
  rows: Record<string, any>[];
  row_count: number;
}

interface Template {
  id: string; name: string; query: string; icon: string;
}

function buildChartOption(result: ReportResult) {
  const { columns, rows, chart_type } = result;
  if (!rows.length || columns.length < 2) return null;

  const labelCol = columns[0];
  const labels = rows.map(r => String(r[labelCol] ?? ''));

  if (chart_type === 'pie') {
    const valCol = columns[1];
    return {
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: { bottom: 0, type: 'scroll' },
      series: [{
        type: 'pie', radius: ['35%', '65%'], padAngle: 2, itemStyle: { borderRadius: 6 },
        data: rows.map(r => ({ name: String(r[labelCol] ?? ''), value: Number(r[valCol]) || 0 })),
        label: { show: true, formatter: '{b}\n{d}%' },
      }],
    };
  }

  const valueCols = columns.slice(1).filter(c => rows.some(r => !isNaN(Number(r[c]))));
  const colors = ['#1677ff', '#52c41a', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2', '#faad14'];

  const series = valueCols.map((col, i) => ({
    name: col,
    type: chart_type === 'line' ? 'line' : 'bar',
    data: rows.map(r => Number(r[col]) || 0),
    smooth: true,
    itemStyle: { color: colors[i % colors.length], borderRadius: chart_type === 'bar' ? [4, 4, 0, 0] : undefined },
    areaStyle: chart_type === 'line' ? { opacity: 0.1 } : undefined,
  }));

  return {
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0, type: 'scroll' },
    grid: { top: 30, right: 20, bottom: valueCols.length > 1 ? 40 : 10, left: 60, containLabel: true },
    xAxis: { type: 'category', data: labels, axisLabel: { rotate: labels.length > 8 ? 30 : 0, fontSize: 11 } },
    yAxis: { type: 'value' },
    series,
  };
}

export default function AIReportPage() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [error, setError] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [history, setHistory] = useState<{ query: string; time: number }[]>([]);
  const inputRef = useRef<any>(null);

  useEffect(() => {
    api.get('/ai/report-templates').then(res => {
      setTemplates(res.data?.data || []);
    }).catch(() => {});
  }, []);

  const executeQuery = useCallback(async (q: string) => {
    if (!q.trim() || loading) return;
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await api.post('/ai/generate-report', { query: q.trim() });
      if (res.data?.success) {
        setResult(res.data.data);
        setHistory(prev => [{ query: q.trim(), time: Date.now() }, ...prev.slice(0, 9)]);
      } else {
        setError(res.data?.message || '查询失败');
      }
    } catch (e: any) {
      setError(e.response?.data?.message || e.response?.data?.detail || '请求失败');
    } finally {
      setLoading(false);
    }
  }, [loading]);

  const handleExport = () => {
    if (!result) return;
    const csvCols = result.columns.map(c => ({ key: c, title: c }));
    exportToCsv(result.rows, csvCols, `ai-report-${Date.now()}`);
    message.success('导出成功');
  };

  const chartOption = result ? buildChartOption(result) : null;
  const showChart = result && chartOption && result.chart_type !== 'table' && result.rows.length > 0;

  const tableColumns = result?.columns.map(col => ({
    title: col, dataIndex: col, key: col, ellipsis: true,
    render: (v: any) => {
      if (v === null || v === undefined) return <Text type="secondary">-</Text>;
      if (typeof v === 'number') return <Text strong style={{ fontFamily: 'monospace' }}>{v.toLocaleString()}</Text>;
      return String(v);
    },
  })) || [];

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%)',
        borderRadius: 16, padding: '28px 32px', marginBottom: 24,
        color: '#fff', position: 'relative', overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: -30, right: -30, width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
        <div style={{ position: 'absolute', bottom: -20, right: 60, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, position: 'relative', zIndex: 1 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(10px)',
            fontSize: 26,
          }}>
            <RobotOutlined />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#fff' }}>AI 智能报表</h2>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
              用自然语言描述数据需求，AI 自动生成查询并可视化
            </div>
          </div>
          <Tag style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', borderRadius: 12, padding: '4px 12px' }}>
            <DatabaseOutlined style={{ marginRight: 4 }} />Qwen AI
          </Tag>
        </div>
      </div>

      {/* Input Area */}
      <div style={{
        background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)',
        border: '1px solid var(--glass-border)', borderRadius: 14,
        padding: '20px 24px', marginBottom: 20, boxShadow: 'var(--shadow-1)',
      }}>
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          <Input.TextArea
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); executeQuery(query); }}}
            placeholder="例如：最近7天每天出库了多少标签？哪个工人佣金最高？"
            autoSize={{ minRows: 1, maxRows: 3 }}
            style={{ flex: 1, borderRadius: 10, fontSize: 14 }}
            disabled={loading}
          />
          <Button
            type="primary" icon={loading ? <Spin size="small" /> : <SendOutlined />}
            onClick={() => executeQuery(query)}
            disabled={!query.trim() || loading}
            style={{
              height: 'auto', minHeight: 40, borderRadius: 10,
              background: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none',
              boxShadow: '0 4px 12px rgba(102,126,234,0.35)',
            }}
          >
            生成
          </Button>
        </div>

        {/* Templates */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {templates.map(t => (
            <Tag
              key={t.id}
              onClick={() => { setQuery(t.query); executeQuery(t.query); }}
              style={{
                cursor: 'pointer', borderRadius: 14, padding: '4px 14px',
                background: 'var(--brand-bg)', border: '1px solid var(--brand-border)',
                color: 'var(--brand)', fontSize: 12, transition: 'all 0.2s',
              }}
            >
              <span style={{ marginRight: 4 }}>{t.icon}</span>{t.name}
            </Tag>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          background: 'rgba(255,77,79,0.06)', border: '1px solid rgba(255,77,79,0.2)',
          borderRadius: 12, padding: '14px 20px', marginBottom: 20, color: '#ff4d4f',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <BulbOutlined style={{ fontSize: 18 }} />
          <div>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>查询失败</div>
            <div style={{ fontSize: 13 }}>{error}</div>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{
          background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)',
          border: '1px solid var(--glass-border)', borderRadius: 14,
          padding: '40px', textAlign: 'center', marginBottom: 20,
        }}>
          <Spin size="large" />
          <div style={{ marginTop: 12, color: 'var(--text-3)' }}>AI 正在分析并生成查询...</div>
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <div style={{
          background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)',
          border: '1px solid var(--glass-border)', borderRadius: 14,
          overflow: 'hidden', boxShadow: 'var(--shadow-1)',
        }}>
          {/* Result Header */}
          <div style={{
            padding: '16px 24px', borderBottom: '1px solid var(--border-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Tag color="green" style={{ borderRadius: 10, fontWeight: 600 }}>
                {result.row_count} 条结果
              </Tag>
              <Text style={{ fontSize: 13, color: 'var(--text-2)' }}>{result.description}</Text>
            </div>
            <Space>
              <Tooltip title="复制SQL">
                <Button size="small" icon={<CopyOutlined />} onClick={() => {
                  navigator.clipboard.writeText(result.sql).then(() => message.success('SQL已复制'));
                }}>SQL</Button>
              </Tooltip>
              <Button size="small" icon={<DownloadOutlined />} onClick={handleExport}>导出CSV</Button>
            </Space>
          </div>

          {/* SQL Preview */}
          <div style={{
            padding: '10px 24px', background: 'rgba(0,0,0,0.02)',
            borderBottom: '1px solid var(--border-2)',
          }}>
            <code style={{
              fontSize: 11, color: 'var(--text-3)', fontFamily: 'monospace',
              wordBreak: 'break-all', lineHeight: 1.5,
            }}>{result.sql}</code>
          </div>

          {/* Chart */}
          {showChart && (
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-2)' }}>
              <ReactECharts option={chartOption!} style={{ height: 320 }} />
            </div>
          )}

          {/* Table */}
          <div style={{ padding: '0 8px 16px' }}>
            <Table
              dataSource={result.rows.map((r, i) => ({ ...r, _key: i }))}
              columns={tableColumns}
              rowKey="_key"
              size="small"
              scroll={{ x: 'max-content' }}
              pagination={result.rows.length > 20 ? { pageSize: 20, showSizeChanger: false, showTotal: t => `共 ${t} 条` } : false}
              locale={{ emptyText: <Empty description="无数据" /> }}
            />
          </div>
        </div>
      )}

      {/* Empty State */}
      {!result && !loading && !error && (
        <div style={{
          background: 'var(--glass-bg)', backdropFilter: 'var(--glass-blur)',
          border: '1px solid var(--glass-border)', borderRadius: 14,
          padding: '60px 40px', textAlign: 'center',
        }}>
          <div style={{
            width: 72, height: 72, borderRadius: 20, margin: '0 auto 20px',
            background: 'linear-gradient(135deg, #667eea20, #764ba220)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <RobotOutlined style={{ fontSize: 32, color: '#764ba2' }} />
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>输入你的数据需求</h3>
          <Text type="secondary" style={{ display: 'block', maxWidth: 400, margin: '0 auto', lineHeight: 1.8 }}>
            用自然语言描述你想查询的数据，AI 会自动生成 SQL 并展示结果。
            支持表格、柱状图、折线图、饼图等多种展示方式。
          </Text>
          <div style={{
            marginTop: 24, display: 'flex', flexWrap: 'wrap', gap: 8,
            justifyContent: 'center',
          }}>
            {['每种水果的采购总金额', '出库量最高的10个SKU', '本月工人佣金排行'].map((q, i) => (
              <Tag
                key={i}
                onClick={() => { setQuery(q); executeQuery(q); }}
                style={{
                  cursor: 'pointer', borderRadius: 14, padding: '6px 16px',
                  background: 'linear-gradient(135deg, rgba(102,126,234,0.08), rgba(118,75,162,0.08))',
                  border: '1px solid rgba(102,126,234,0.2)', color: '#667eea',
                  fontSize: 13, fontWeight: 500,
                }}
              >
                <ThunderboltOutlined style={{ marginRight: 4 }} />{q}
              </Tag>
            ))}
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div style={{ marginTop: 20, padding: '16px 20px', background: 'var(--glass-bg)', borderRadius: 12, border: '1px solid var(--glass-border)' }}>
          <Text type="secondary" style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 8 }}>
            最近查询
          </Text>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {history.map((h, i) => (
              <Tag
                key={i}
                onClick={() => { setQuery(h.query); executeQuery(h.query); }}
                style={{ cursor: 'pointer', borderRadius: 10, fontSize: 11, color: 'var(--text-3)' }}
              >
                {h.query.length > 20 ? h.query.slice(0, 20) + '...' : h.query}
              </Tag>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
