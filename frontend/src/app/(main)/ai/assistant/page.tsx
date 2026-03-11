'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Input, Button, Card, Tag, Space, Spin, Typography, Avatar, Tooltip, message } from 'antd';
import {
  SendOutlined, RobotOutlined, UserOutlined, BulbOutlined, ClearOutlined,
  ThunderboltOutlined, ReloadOutlined, CopyOutlined, ExpandOutlined,
  CompressOutlined, DownOutlined, UpOutlined,
} from '@ant-design/icons';
import api from '@/services/api';

function ThinkingBlock({ reasoning, isThinking }: { reasoning: string; isThinking?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const lines = reasoning.split('\n').filter(Boolean);
  const preview = lines.slice(0, 2).join(' ').slice(0, 80);
  return (
    <div style={{
      marginBottom: 10, borderRadius: 12, overflow: 'hidden',
      border: '1px solid rgba(124,58,237,0.15)',
      background: 'linear-gradient(135deg, rgba(124,58,237,0.04) 0%, rgba(99,102,241,0.03) 100%)',
    }}>
      <div
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', cursor: 'pointer', fontSize: 12,
          color: '#7c3aed', fontWeight: 600, userSelect: 'none',
        }}
      >
        {isThinking ? <Spin size="small" /> : <BulbOutlined />}
        <span style={{ flex: 1 }}>
          {isThinking ? '正在思考...' : '思考过程'}
          {!open && !isThinking && <span style={{ fontWeight: 400, color: 'var(--text-3)', marginLeft: 6 }}>{preview}...</span>}
        </span>
        {!isThinking && (open ? <UpOutlined style={{ fontSize: 10 }} /> : <DownOutlined style={{ fontSize: 10 }} />)}
      </div>
      {(open || isThinking) && (
        <div style={{
          padding: '6px 12px 10px', fontSize: 12, lineHeight: 1.7,
          color: 'var(--text-2)', maxHeight: 300, overflowY: 'auto',
          borderTop: '1px solid rgba(124,58,237,0.08)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {reasoning}
        </div>
      )}
    </div>
  );
}

const { Text, Paragraph } = Typography;

interface ChatMsg {
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning?: string;
  timestamp?: number;
  loading?: boolean;
}

interface Suggestion {
  icon: string;
  title: string;
  desc: string;
  type: string;
  prompt?: string;
}

export default function AIAssistantPage() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [expanded, setExpanded] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    api.get('/ai/suggestions').then(res => {
      setSuggestions(res.data?.data || []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: ChatMsg = { role: 'user', content: text.trim(), timestamp: Date.now() };
    const assistantMsg: ChatMsg = { role: 'assistant', content: '', timestamp: Date.now(), loading: true };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setLoading(true);

    const history = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content }));

    try {
      abortRef.current = new AbortController();
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ message: text.trim(), history, stream: true }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let accumulated = '';
      let reasoningAcc = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              accumulated += `\n\n⚠️ ${parsed.error}`;
            } else if (parsed.reasoning) {
              reasoningAcc += parsed.reasoning;
            } else if (parsed.content) {
              accumulated += parsed.content;
            }
          } catch {}
        }

        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: accumulated, reasoning: reasoningAcc || undefined, loading: !accumulated && !!reasoningAcc };
          }
          return updated;
        });
      }
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === 'assistant') {
          updated[updated.length - 1] = {
            ...last,
            content: '抱歉，AI 服务暂时不可用，请稍后重试。',
            loading: false,
          };
        }
        return updated;
      });
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [loading, messages]);

  const handleQuickAnalysis = useCallback(async (type: string, prompt?: string) => {
    if (loading) return;
    if (type === 'free') {
      if (prompt) {
        sendMessage(prompt);
      } else {
        inputRef.current?.focus();
      }
      return;
    }

    const titles: Record<string, string> = {
      today_summary: '今日运营简报',
      worker_ranking: '工人绩效分析',
      loss_analysis: '损耗分析',
      production_trend: '生产趋势',
      inventory_status: '库存状况',
    };

    const userMsg: ChatMsg = { role: 'user', content: `请给我 ${titles[type] || type}`, timestamp: Date.now() };
    const assistantMsg: ChatMsg = { role: 'assistant', content: '', timestamp: Date.now(), loading: true };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setLoading(true);

    try {
      abortRef.current = new AbortController();
      const response = await fetch('/api/ai/quick-analysis', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ analysis_type: type }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') break;

          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              accumulated += `\n\n⚠️ ${parsed.error}`;
            } else if (parsed.content) {
              accumulated += parsed.content;
            }
          } catch {}
        }

        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: accumulated, loading: false };
          }
          return updated;
        });
      }
    } catch (e: any) {
      if (e.name === 'AbortError') return;
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === 'assistant') {
          updated[updated.length - 1] = {
            ...last, content: '分析请求失败，请稍后重试。', loading: false,
          };
        }
        return updated;
      });
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [loading, sendMessage]);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => message.success('已复制'));
  };

  const handleClear = () => {
    if (loading && abortRef.current) {
      abortRef.current.abort();
    }
    setMessages([]);
    setLoading(false);
  };

  const formatContent = (content: string) => {
    const parts = content.split(/(\*\*.*?\*\*|`[^`]+`|\n)/g);
    return parts.map((part, i) => {
      if (part === '\n') return <br key={i} />;
      if (part.startsWith('**') && part.endsWith('**'))
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('`') && part.endsWith('`'))
        return <code key={i} style={{
          background: 'rgba(22,119,255,0.08)', padding: '1px 6px',
          borderRadius: 4, fontSize: 13, color: 'var(--brand)',
        }}>{part.slice(1, -1)}</code>;
      return <span key={i}>{part}</span>;
    });
  };

  const isEmpty = messages.length === 0;

  return (
    <div style={{ height: expanded ? '100vh' : 'auto', display: 'flex', flexDirection: 'column', position: expanded ? 'fixed' : 'relative', inset: expanded ? 0 : undefined, zIndex: expanded ? 1000 : undefined, background: expanded ? 'var(--bg-page)' : undefined }}>
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 0, borderRadius: expanded ? 0 : undefined }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            boxShadow: '0 4px 15px rgba(102,126,234,0.4)',
            fontSize: 24,
          }}>
            <RobotOutlined style={{ color: '#fff' }} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
              果小智 · AI 助手
              <Tag color="purple" style={{ marginLeft: 8, fontSize: 11 }}>Qwen AI</Tag>
            </h2>
            <Text type="secondary" style={{ fontSize: 13 }}>
              智能分析业务数据，助力高效决策
            </Text>
          </div>
        </div>
        <Space>
          {messages.length > 0 && (
            <Tooltip title="清空对话">
              <Button icon={<ClearOutlined />} onClick={handleClear}>清空</Button>
            </Tooltip>
          )}
          <Tooltip title={expanded ? '退出全屏' : '全屏模式'}>
            <Button
              icon={expanded ? <CompressOutlined /> : <ExpandOutlined />}
              onClick={() => setExpanded(!expanded)}
            />
          </Tooltip>
        </Space>
      </div>

      {/* Chat Area */}
      <div style={{
        flex: 1, overflow: 'auto', padding: '20px 24px',
        display: 'flex', flexDirection: 'column',
        minHeight: expanded ? 0 : 'calc(100vh - 320px)',
      }}>
        {isEmpty ? (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 32,
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: 80, height: 80, borderRadius: 24, margin: '0 auto 16px',
                background: 'linear-gradient(135deg, #667eea, #764ba2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 8px 32px rgba(102,126,234,0.3)',
              }}>
                <RobotOutlined style={{ fontSize: 36, color: '#fff' }} />
              </div>
              <h3 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>
                你好，我是果小智
              </h3>
              <Text type="secondary" style={{ fontSize: 14 }}>
                我可以帮你分析业务数据、回答系统问题、提供管理建议
              </Text>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12, width: '100%', maxWidth: 720,
            }}>
              {suggestions.map((s, i) => (
                <div
                  key={i}
                  onClick={() => handleQuickAnalysis(s.type, s.prompt)}
                  className="stat-card"
                  style={{
                    padding: '16px 18px', borderRadius: 14, cursor: 'pointer',
                    background: 'var(--glass-bg)',
                    backdropFilter: 'var(--glass-blur)',
                    border: '1px solid var(--glass-border)',
                    transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)',
                    display: 'flex', alignItems: 'center', gap: 14,
                  }}
                >
                  <div style={{ fontSize: 28, lineHeight: 1 }}>{s.icon}</div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{s.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  display: 'flex', gap: 12, marginBottom: 20,
                  flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                  alignItems: 'flex-start',
                  animation: 'fadeInUp 0.3s ease-out',
                }}
              >
                <Avatar
                  size={36}
                  icon={msg.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                  style={{
                    flexShrink: 0,
                    background: msg.role === 'user'
                      ? 'linear-gradient(135deg, #1677ff, #4096ff)'
                      : 'linear-gradient(135deg, #667eea, #764ba2)',
                    boxShadow: msg.role === 'user'
                      ? '0 3px 10px rgba(22,119,255,0.3)'
                      : '0 3px 10px rgba(102,126,234,0.3)',
                  }}
                />
                <div style={{
                  maxWidth: '75%',
                  padding: '12px 18px',
                  borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                  background: msg.role === 'user'
                    ? 'linear-gradient(135deg, #1677ff, #4096ff)'
                    : 'var(--glass-bg)',
                  color: msg.role === 'user' ? '#fff' : 'var(--text-1)',
                  backdropFilter: msg.role === 'assistant' ? 'var(--glass-blur)' : undefined,
                  border: msg.role === 'assistant' ? '1px solid var(--glass-border)' : undefined,
                  boxShadow: msg.role === 'user'
                    ? '0 4px 15px rgba(22,119,255,0.25)'
                    : 'var(--shadow-1)',
                  fontSize: 14, lineHeight: 1.7,
                  position: 'relative',
                }}>
                  {msg.loading && !msg.content && !msg.reasoning ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Spin size="small" />
                      <Text type="secondary" style={{ fontSize: 13 }}>果小智思考中...</Text>
                    </div>
                  ) : (
                    <>
                      {msg.reasoning && msg.role === 'assistant' && (
                        <ThinkingBlock reasoning={msg.reasoning} isThinking={msg.loading && !msg.content} />
                      )}
                      {msg.content && <div>{formatContent(msg.content)}</div>}
                      {msg.role === 'assistant' && msg.content && !msg.loading && (
                        <div style={{
                          marginTop: 8, paddingTop: 8,
                          borderTop: '1px solid var(--border-2)',
                          display: 'flex', gap: 8,
                        }}>
                          <Tooltip title="复制内容">
                            <Button
                              type="text" size="small" icon={<CopyOutlined />}
                              onClick={() => handleCopy(msg.content)}
                              style={{ fontSize: 12, color: 'var(--text-3)' }}
                            />
                          </Tooltip>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </>
        )}
      </div>

      {/* Input Area */}
      <div style={{
        padding: '16px 24px 20px',
        background: 'var(--glass-bg)',
        backdropFilter: 'var(--glass-blur)',
        borderTop: '1px solid var(--glass-border)',
      }}>
        {messages.length > 0 && !loading && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            {['今日出库多少？', '哪个工人产量最高？', '损耗率正常吗？'].map((q, i) => (
              <Tag
                key={i}
                onClick={() => sendMessage(q)}
                style={{
                  cursor: 'pointer', borderRadius: 16, padding: '4px 14px',
                  background: 'var(--brand-bg)', border: '1px solid var(--brand-border)',
                  color: 'var(--brand)', fontSize: 12,
                  transition: 'all 0.2s',
                }}
              >
                <BulbOutlined style={{ marginRight: 4 }} />{q}
              </Tag>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <Input.TextArea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder="输入问题，Shift+Enter 换行..."
            autoSize={{ minRows: 1, maxRows: 4 }}
            style={{
              flex: 1, borderRadius: 14, padding: '10px 16px',
              background: 'var(--bg-card)', border: '1px solid var(--border-2)',
              fontSize: 14, resize: 'none',
            }}
            disabled={loading}
          />
          <Button
            type="primary"
            icon={loading ? <Spin size="small" style={{ color: '#fff' }} /> : <SendOutlined />}
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            style={{
              height: 44, width: 44, borderRadius: 14,
              background: 'linear-gradient(135deg, #667eea, #764ba2)',
              border: 'none',
              boxShadow: '0 4px 12px rgba(102,126,234,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          />
        </div>
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            由通义千问 Qwen AI 驱动 · 回答仅供参考
          </Text>
        </div>
      </div>

    </div>
  );
}
