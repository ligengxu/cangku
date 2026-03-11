'use client';

import { useState } from 'react';
import { Card, Tag, Button, Input, Space, message, Collapse, Tabs, Typography, Spin, Descriptions, Timeline, Empty } from 'antd';
import {
  ApiOutlined, SendOutlined, CopyOutlined, ThunderboltOutlined,
  SearchOutlined, CodeOutlined, SafetyCertificateOutlined, BookOutlined,
} from '@ant-design/icons';
import axios from 'axios';

const { TextArea } = Input;
const { Text, Paragraph } = Typography;

interface ApiEndpoint {
  method: 'GET' | 'POST';
  path: string;
  name: string;
  description: string;
  auth: boolean;
  params: { name: string; type: string; required: boolean; desc: string }[];
  body?: string;
  responseExample: string;
  category: string;
}

const API_LIST: ApiEndpoint[] = [
  {
    method: 'GET',
    path: '/api/device/open/trace',
    name: '产品溯源查询',
    description: '通过快递单号、二维码或标签ID查询完整溯源信息，包括供应商、采购日期、批次、打包人、打包时间、重量、出库时间、快递信息等全链路数据。',
    auth: false,
    category: '溯源',
    params: [
      { name: 'q', type: 'string', required: false, desc: '万能查询（自动识别快递单号/二维码/标签ID）' },
      { name: 'express', type: 'string', required: false, desc: '快递单号精确查询' },
      { name: 'barcode', type: 'string', required: false, desc: '二维码号精确查询（如 0777337）' },
    ],
    responseExample: JSON.stringify({
      success: true, count: 1,
      data: [{
        label_id: 77337, barcode: "0777337",
        express_number: "YT1234567890", express_carrier: "圆通",
        supplier_name: "张记果园", supplier_contact: "张三",
        purchase_date: "2024-10-28", purchase_price: 5.5, purchase_weight: 500,
        batch_id: 42, fruit_name: "苹果",
        sku_name: "XLG/AAA/10", sku_description: "特大果/精选/10斤装",
        worker_name: "罗章亮", worker_id: 19,
        pack_time: "2024-10-28 09:59:10",
        estimated_weight: 4.85, actual_weight: 4.92, weight_difference: 0.07,
        scanned_outbound: true, outbound_time: "2024-10-29 15:45:20",
        scan_history: [{ time: "2024-10-29 15:45:20", weight: 4.92, is_success: true, message: "出库成功", machine: "1" }],
      }],
    }, null, 2),
  },
  {
    method: 'POST',
    path: '/api/device/open/trace-batch',
    name: '批量溯源查询',
    description: '批量查询多个快递单号的溯源信息，单次最多100个。适合售后系统批量拉取数据。',
    auth: false,
    category: '溯源',
    params: [],
    body: JSON.stringify({ express_numbers: ["YT123", "SF456"] }, null, 2),
    responseExample: JSON.stringify({
      success: true, count: 2,
      data: {
        "YT123": { found: true, items: [{ label_id: 100, barcode: "07100", supplier_name: "张记果园", worker_name: "王五", pack_time: "2024-10-28 10:00:00" }] },
        "SF456": { found: false },
      },
    }, null, 2),
  },
  {
    method: 'GET',
    path: '/api/device/order-lookup',
    name: '订单追踪查询',
    description: '统一订单查询接口，支持快递单号、二维码条码、标签ID。返回标签详情和扫码时间线。',
    auth: false,
    category: '查询',
    params: [
      { name: 'q', type: 'string', required: true, desc: '查询关键词（快递单号/二维码/标签ID）' },
    ],
    responseExample: JSON.stringify({
      success: true, query: "YT123", query_type: "快递单号", count: 1,
      data: [{
        label_id: 100, sku_name: "XLG/AAA/10", worker_name: "罗章亮",
        express_number: "YT123", express_carrier: "圆通",
        timeline: [{ time: "2024-10-29 15:45:20", weight: 4.92, is_success: true, message: "出库成功" }],
      }],
    }, null, 2),
  },
  {
    method: 'GET',
    path: '/api/device/express-lookup/{express_number}',
    name: '快递单号查标签',
    description: '根据快递单号精确查找关联的所有标签信息。',
    auth: false,
    category: '查询',
    params: [
      { name: 'express_number', type: 'string (路径参数)', required: true, desc: '快递单号' },
    ],
    responseExample: JSON.stringify({
      success: true,
      data: [{ label_id: 100, sku_name: "XLG/AAA/10", worker_name: "罗章亮", actual_weight: 4.92, express_number: "YT123" }],
    }, null, 2),
  },
  {
    method: 'GET',
    path: '/api/download/client/info',
    name: '客户端版本信息',
    description: '获取扫码称重客户端的最新版本信息，包括版本号、文件大小、下载链接。',
    auth: false,
    category: '系统',
    params: [],
    responseExample: JSON.stringify({
      success: true,
      data: { available: true, version: "3.0.0", size: "7.5MB", filename: "fruit-scanner-v3.exe", download_url: "/api/download/client" },
    }, null, 2),
  },
  {
    method: 'GET',
    path: '/api/download/client',
    name: '下载客户端',
    description: '下载 Windows 扫码称重客户端 EXE 安装包。',
    auth: false,
    category: '系统',
    params: [],
    responseExample: '(二进制文件下载)',
  },
  {
    method: 'POST',
    path: '/api/device/heartbeat/{machine_number}',
    name: '机器心跳',
    description: '称重机定期上报心跳，更新在线状态。',
    auth: false,
    category: '设备',
    params: [
      { name: 'machine_number', type: 'string (路径参数)', required: true, desc: '机器编号' },
    ],
    responseExample: JSON.stringify({ success: true, machine: "1", status: "online" }, null, 2),
  },
  {
    method: 'GET',
    path: '/api/device/machines',
    name: '机器列表',
    description: '获取所有称重机的状态信息，包括在线状态、今日扫码数据。',
    auth: false,
    category: '设备',
    params: [],
    responseExample: JSON.stringify({
      success: true,
      data: [{ id: 1, machine_number: "1", name: "机器1", status: "online", today_success: 120, today_fail: 3 }],
    }, null, 2),
  },
];

const methodColor: Record<string, string> = { GET: '#52c41a', POST: '#1677ff', PUT: '#fa8c16', DELETE: '#ff4d4f' };

const ApiTester = ({ api }: { api: ApiEndpoint }) => {
  const [params, setParams] = useState<Record<string, string>>({});
  const [body, setBody] = useState(api.body || '');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const handleTest = async () => {
    setLoading(true);
    const start = Date.now();
    try {
      let url = api.path;
      const queryParams: Record<string, string> = {};
      for (const p of api.params) {
        const val = params[p.name];
        if (!val) continue;
        if (p.type.includes('路径参数')) {
          url = url.replace(`{${p.name}}`, val);
        } else {
          queryParams[p.name] = val;
        }
      }
      const config: any = { params: queryParams };
      let res;
      if (api.method === 'POST') {
        res = await axios.post(url, body ? JSON.parse(body) : {}, config);
      } else {
        res = await axios.get(url, config);
      }
      setResponse(JSON.stringify(res.data, null, 2));
    } catch (e: any) {
      setResponse(JSON.stringify(e?.response?.data || { error: e.message }, null, 2));
    } finally {
      setElapsed(Date.now() - start);
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {api.params.map(p => (
          <Input
            key={p.name}
            placeholder={`${p.name}: ${p.desc}`}
            value={params[p.name] || ''}
            onChange={e => setParams({ ...params, [p.name]: e.target.value })}
            style={{ width: 280, borderRadius: 8 }}
            prefix={<Text type="secondary" style={{ fontSize: 11 }}>{p.name}=</Text>}
          />
        ))}
      </div>
      {api.method === 'POST' && (
        <TextArea
          rows={3}
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="请求体 (JSON)"
          style={{ borderRadius: 8, marginBottom: 12, fontFamily: 'monospace', fontSize: 12 }}
        />
      )}
      <Space>
        <Button
          type="primary"
          icon={<SendOutlined />}
          loading={loading}
          onClick={handleTest}
          style={{ borderRadius: 8, background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', border: 'none' }}
        >
          发送请求
        </Button>
        {elapsed > 0 && <Tag color="blue">{elapsed}ms</Tag>}
      </Space>
      {response && (
        <div style={{ marginTop: 12, position: 'relative' }}>
          <Button
            size="small"
            icon={<CopyOutlined />}
            style={{ position: 'absolute', top: 8, right: 8, zIndex: 1, borderRadius: 6 }}
            onClick={() => { navigator.clipboard.writeText(response); message.success('已复制'); }}
          />
          <pre style={{
            background: '#0d1117', color: '#c9d1d9', padding: 16, borderRadius: 10,
            fontSize: 12, lineHeight: 1.5, overflow: 'auto', maxHeight: 400,
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            {response}
          </pre>
        </div>
      )}
    </div>
  );
};

export default function ApiCenterPage() {
  const [activeTab, setActiveTab] = useState('all');
  const categories = Array.from(new Set(API_LIST.map(a => a.category)));

  const categoryIcons: Record<string, any> = {
    '溯源': <SafetyCertificateOutlined />,
    '查询': <SearchOutlined />,
    '系统': <CodeOutlined />,
    '设备': <ThunderboltOutlined />,
  };

  const categoryColors: Record<string, string> = {
    '溯源': 'linear-gradient(135deg, #10b981, #059669)',
    '查询': 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    '系统': 'linear-gradient(135deg, #f59e0b, #d97706)',
    '设备': 'linear-gradient(135deg, #3b82f6, #2563eb)',
  };

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div style={{ padding: '0 4px' }}>
      {/* Header */}
      <div style={{
        padding: '28px 32px', borderRadius: 20, marginBottom: 24,
        background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
        border: '1px solid rgba(99,102,241,0.15)',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: -40, right: -40, width: 200, height: 200,
          background: 'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)',
          borderRadius: '50%',
        }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, position: 'relative' }}>
          <div style={{
            width: 52, height: 52, borderRadius: 16,
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24, color: '#fff',
          }}>
            <ApiOutlined />
          </div>
          <div>
            <h2 style={{ margin: 0, color: '#fff', fontSize: 22, fontWeight: 800 }}>接口中心</h2>
            <p style={{ margin: '4px 0 0', color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>
              果管系统公开 API 接口文档 · 支持在线调试 · 供售后系统、外部系统集成使用
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 20, flexWrap: 'wrap' }}>
          <Tag style={{ borderRadius: 20, padding: '4px 14px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', color: '#10b981' }}>
            <SafetyCertificateOutlined /> 无需认证
          </Tag>
          <Tag style={{ borderRadius: 20, padding: '4px 14px', background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)', color: '#818cf8' }}>
            <CodeOutlined /> RESTful API
          </Tag>
          <Tag style={{ borderRadius: 20, padding: '4px 14px', background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b' }}>
            <ThunderboltOutlined /> JSON 响应
          </Tag>
          <Tag style={{ borderRadius: 20, padding: '4px 14px', background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', color: '#3b82f6' }}>
            <BookOutlined /> 共 {API_LIST.length} 个接口
          </Tag>
        </div>
      </div>

      {/* Base URL */}
      <Card size="small" style={{ marginBottom: 20, borderRadius: 14, background: '#fafafa' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Text strong style={{ fontSize: 13 }}>Base URL:</Text>
          <code style={{
            padding: '4px 12px', borderRadius: 8, background: '#f0f0f0',
            fontSize: 13, fontFamily: 'monospace', color: '#6366f1',
          }}>
            {baseUrl}
          </code>
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={() => { navigator.clipboard.writeText(baseUrl); message.success('已复制'); }}
            style={{ borderRadius: 6 }}
          >
            复制
          </Button>
        </div>
      </Card>

      {/* API List by category */}
      <Tabs
        type="card"
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: 'all', label: `全部 (${API_LIST.length})` },
          ...categories.map(c => ({
            key: c,
            label: <span>{categoryIcons[c]} {c} ({API_LIST.filter(a => a.category === c).length})</span>,
          })),
        ]}
        style={{ marginBottom: 0 }}
      />

      {categories.filter(cat => activeTab === 'all' || activeTab === cat).map(cat => {
        const apis = API_LIST.filter(a => a.category === cat);
        return (
          <div key={cat} style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 10,
                background: categoryColors[cat] || '#6366f1',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 16,
              }}>
                {categoryIcons[cat] || <ApiOutlined />}
              </div>
              <Text strong style={{ fontSize: 16 }}>{cat}接口</Text>
              <Tag>{apis.length} 个</Tag>
            </div>

            <Collapse
              accordion
              style={{ borderRadius: 14, overflow: 'hidden' }}
              items={apis.map((api, i) => ({
                key: `${cat}-${i}`,
                label: (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                    <Tag color={methodColor[api.method]} style={{ borderRadius: 6, fontWeight: 700, fontSize: 11, minWidth: 42, textAlign: 'center' }}>
                      {api.method}
                    </Tag>
                    <code style={{ fontSize: 13, color: '#333', fontFamily: 'monospace' }}>{api.path}</code>
                    <Text type="secondary" style={{ fontSize: 12, marginLeft: 'auto' }}>{api.name}</Text>
                    {!api.auth && <Tag color="green" style={{ borderRadius: 10, fontSize: 10 }}>公开</Tag>}
                  </div>
                ),
                children: (
                  <div>
                    <Paragraph style={{ color: '#666', marginBottom: 16 }}>{api.description}</Paragraph>

                    {api.params.length > 0 && (
                      <>
                        <Text strong style={{ fontSize: 13 }}>请求参数</Text>
                        <Descriptions
                          bordered
                          size="small"
                          column={1}
                          style={{ marginTop: 8, marginBottom: 16 }}
                          items={api.params.map(p => ({
                            key: p.name,
                            label: (
                              <Space>
                                <code style={{ color: '#6366f1' }}>{p.name}</code>
                                <Tag style={{ fontSize: 10, borderRadius: 4 }}>{p.type}</Tag>
                                {p.required && <Tag color="red" style={{ fontSize: 10, borderRadius: 4 }}>必填</Tag>}
                              </Space>
                            ),
                            children: p.desc,
                          }))}
                        />
                      </>
                    )}

                    <Text strong style={{ fontSize: 13 }}>响应示例</Text>
                    <pre style={{
                      background: '#0d1117', color: '#c9d1d9', padding: 14, borderRadius: 10,
                      fontSize: 12, lineHeight: 1.5, overflow: 'auto', maxHeight: 300,
                      marginTop: 8, border: '1px solid rgba(255,255,255,0.06)',
                    }}>
                      {api.responseExample}
                    </pre>

                    <div style={{
                      marginTop: 16, padding: '14px 16px', borderRadius: 12,
                      background: 'linear-gradient(135deg, rgba(99,102,241,0.04), rgba(139,92,246,0.04))',
                      border: '1px solid rgba(99,102,241,0.1)',
                    }}>
                      <Text strong style={{ fontSize: 13 }}>
                        <ThunderboltOutlined style={{ color: '#6366f1' }} /> 在线测试
                      </Text>
                      <ApiTester api={api} />
                    </div>
                  </div>
                ),
              }))}
            />
          </div>
        );
      })}

      {/* Usage Guide */}
      <Card
        title={<span><BookOutlined style={{ color: '#6366f1' }} /> 接入指南</span>}
        style={{ borderRadius: 16, marginTop: 8 }}
      >
        <Timeline
          items={[
            {
              color: '#6366f1',
              children: (
                <div>
                  <Text strong>1. 确定接口地址</Text>
                  <Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
                    所有接口的 Base URL 为 <code>{baseUrl}</code>，直接拼接路径即可调用。
                  </Paragraph>
                </div>
              ),
            },
            {
              color: '#10b981',
              children: (
                <div>
                  <Text strong>2. 无需认证</Text>
                  <Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
                    标记为「公开」的接口无需传递 Token 或 API Key，可直接调用。
                  </Paragraph>
                </div>
              ),
            },
            {
              color: '#f59e0b',
              children: (
                <div>
                  <Text strong>3. 调用示例 (cURL)</Text>
                  <pre style={{
                    background: '#0d1117', color: '#c9d1d9', padding: 12, borderRadius: 8,
                    fontSize: 12, marginTop: 8,
                  }}>
{`# 溯源查询（快递单号）
curl "${baseUrl}/api/device/open/trace?express=YT1234567890"

# 溯源查询（二维码）
curl "${baseUrl}/api/device/open/trace?barcode=0777337"

# 批量溯源
curl -X POST "${baseUrl}/api/device/open/trace-batch" \\
  -H "Content-Type: application/json" \\
  -d '{"express_numbers":["YT123","SF456"]}'`}
                  </pre>
                </div>
              ),
            },
            {
              color: '#3b82f6',
              children: (
                <div>
                  <Text strong>4. 响应格式</Text>
                  <Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
                    所有接口均返回 JSON 格式，<code>success: true</code> 表示成功，<code>data</code> 包含业务数据。
                    失败时 <code>success: false</code>，<code>message</code> 包含错误描述。
                  </Paragraph>
                </div>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
