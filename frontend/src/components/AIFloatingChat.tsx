'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Input, Button, Spin, Tooltip, Avatar, Badge } from 'antd';
import {
  RobotOutlined, SendOutlined, CloseOutlined, UserOutlined,
  ClearOutlined, ExpandOutlined, BulbOutlined, DownOutlined, UpOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  reasoning?: string;
  loading?: boolean;
}

function MiniThinking({ reasoning, isThinking }: { reasoning: string; isThinking?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const preview = reasoning.replace(/\n/g, ' ').slice(0, 60);
  return (
    <div style={{
      marginBottom: 6, borderRadius: 8, overflow: 'hidden',
      border: '1px solid rgba(124,58,237,0.12)',
      background: 'rgba(124,58,237,0.03)',
      fontSize: 11,
    }}>
      <div
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 8px', cursor: 'pointer',
          color: '#7c3aed', fontWeight: 600,
        }}
      >
        {isThinking ? <Spin size="small" /> : <BulbOutlined style={{ fontSize: 10 }} />}
        <span style={{ flex: 1 }}>
          {isThinking ? '思考中...' : '思考过程'}
          {!open && !isThinking && <span style={{ fontWeight: 400, color: '#999', marginLeft: 4 }}>{preview}...</span>}
        </span>
        {!isThinking && (open ? <UpOutlined style={{ fontSize: 8 }} /> : <DownOutlined style={{ fontSize: 8 }} />)}
      </div>
      {(open || isThinking) && (
        <div style={{
          padding: '4px 8px 6px', lineHeight: 1.5,
          color: '#666', maxHeight: 150, overflowY: 'auto',
          borderTop: '1px solid rgba(124,58,237,0.06)',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {reasoning}
        </div>
      )}
    </div>
  );
}

export default function AIFloatingChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: ChatMsg = { role: 'user', content: text.trim() };
    const assistantMsg: ChatMsg = { role: 'assistant', content: '', loading: true };
    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setLoading(true);

    const history = messages.map(m => ({ role: m.role, content: m.content }));

    try {
      abortRef.current = new AbortController();
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ message: text.trim(), history, stream: true, context_mode: 'auto' }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let acc = '';
      let reasoningAcc = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value, { stream: true }).split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const d = line.slice(6);
          if (d === '[DONE]') break;
          try {
            const parsed = JSON.parse(d);
            if (parsed.reasoning) reasoningAcc += parsed.reasoning;
            else if (parsed.content) acc += parsed.content;
            if (parsed.error) acc += `\n⚠️ ${parsed.error}`;
          } catch {}
        }
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: acc, reasoning: reasoningAcc || undefined, loading: !acc && !!reasoningAcc };
          }
          return updated;
        });
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: 'AI 暂时不可用', loading: false };
          }
          return updated;
        });
      }
    } finally {
      setLoading(false);
    }
  }, [loading, messages]);

  const formatContent = (text: string) => text.split(/(\*\*.*?\*\*|\n)/g).map((p, i) => {
    if (p === '\n') return <br key={i} />;
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
    return <span key={i}>{p}</span>;
  });

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Floating Button */}
      {!open && (
        <button
          type="button"
          aria-label="打开AI助手"
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed', bottom: 88, right: 20, zIndex: 10000,
            width: 52, height: 52, borderRadius: 16,
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            boxShadow: '0 6px 24px rgba(102,126,234,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)',
            color: '#fff', fontSize: 24, border: 'none', padding: 0,
            pointerEvents: 'auto', touchAction: 'manipulation', userSelect: 'none',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1) rotate(-5deg)'; e.currentTarget.style.boxShadow = '0 8px 32px rgba(102,126,234,0.5)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 6px 24px rgba(102,126,234,0.4)'; }}
        >
          <Badge dot={messages.length > 0} offset={[-2, 2]}>
            <RobotOutlined style={{ color: '#fff', fontSize: 24 }} />
          </Badge>
        </button>
      )}

      {/* Chat Window */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 10000,
          width: 380, maxWidth: 'calc(100vw - 40px)',
          height: 520, maxHeight: 'calc(100vh - 100px)',
          borderRadius: 20, overflow: 'hidden',
          background: 'var(--glass-bg)', backdropFilter: 'blur(24px)',
          border: '1px solid var(--glass-border)',
          boxShadow: '0 16px 48px rgba(0,0,0,0.12), 0 4px 16px rgba(102,126,234,0.15)',
          display: 'flex', flexDirection: 'column',
          animation: 'scaleIn 0.25s ease-out',
          pointerEvents: 'auto',
        }}>
          {/* Header */}
          <div style={{
            padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'linear-gradient(135deg, #667eea, #764ba2)',
            color: '#fff',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar size={30} icon={<RobotOutlined />} style={{ background: 'rgba(255,255,255,0.2)' }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>果小智</div>
                <div style={{ fontSize: 10, opacity: 0.7 }}>AI 助手 · 在线</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <Tooltip title="完整版">
                <Button type="text" size="small" icon={<ExpandOutlined />}
                  onClick={() => { setOpen(false); router.push('/ai/assistant'); }}
                  style={{ color: 'rgba(255,255,255,0.8)' }} />
              </Tooltip>
              {messages.length > 0 && (
                <Tooltip title="清空">
                  <Button type="text" size="small" icon={<ClearOutlined />}
                    onClick={() => { setMessages([]); if (loading && abortRef.current) abortRef.current.abort(); setLoading(false); }}
                    style={{ color: 'rgba(255,255,255,0.8)' }} />
                </Tooltip>
              )}
              <Tooltip title="关闭">
                <Button type="text" size="small" icon={<CloseOutlined />}
                  onClick={() => setOpen(false)}
                  style={{ color: 'rgba(255,255,255,0.8)' }} />
              </Tooltip>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflow: 'auto', padding: '14px 14px 8px' }}>
            {messages.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px 10px' }}>
                <RobotOutlined style={{ fontSize: 36, color: '#764ba2', opacity: 0.3 }} />
                <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 10 }}>
                  有什么可以帮你的？
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}>
                  {['今天出库了多少？', '帮我分析一下损耗', '待审核有多少条？'].map((q, i) => (
                    <div
                      key={i}
                      onClick={() => sendMessage(q)}
                      style={{
                        padding: '8px 14px', borderRadius: 10,
                        background: 'rgba(102,126,234,0.06)',
                        border: '1px solid rgba(102,126,234,0.12)',
                        color: '#667eea', fontSize: 12, cursor: 'pointer',
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(102,126,234,0.12)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(102,126,234,0.06)'; }}
                    >
                      {q}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 8, marginBottom: 12,
                  flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                  alignItems: 'flex-start',
                }}>
                  <Avatar size={28}
                    icon={msg.role === 'user' ? <UserOutlined /> : <RobotOutlined />}
                    style={{
                      flexShrink: 0,
                      background: msg.role === 'user'
                        ? 'linear-gradient(135deg, #1677ff, #4096ff)'
                        : 'linear-gradient(135deg, #667eea, #764ba2)',
                    }}
                  />
                  <div style={{
                    maxWidth: '80%', padding: '8px 14px',
                    borderRadius: msg.role === 'user' ? '14px 14px 2px 14px' : '14px 14px 14px 2px',
                    background: msg.role === 'user'
                      ? 'linear-gradient(135deg, #1677ff, #4096ff)' : 'rgba(0,0,0,0.03)',
                    color: msg.role === 'user' ? '#fff' : 'var(--text-1)',
                    fontSize: 13, lineHeight: 1.6,
                  }}>
                    {msg.loading && !msg.content && !msg.reasoning ? (
                      <Spin size="small" />
                    ) : (
                      <>
                        {msg.reasoning && msg.role === 'assistant' && (
                          <MiniThinking reasoning={msg.reasoning} isThinking={msg.loading && !msg.content} />
                        )}
                        {msg.content && formatContent(msg.content)}
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div style={{
            padding: '10px 14px 14px',
            borderTop: '1px solid var(--border-2)',
          }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
                placeholder="输入问题..."
                disabled={loading}
                style={{ borderRadius: 10, fontSize: 13 }}
              />
              <Button
                type="primary" icon={<SendOutlined />}
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || loading}
                style={{
                  borderRadius: 10,
                  background: 'linear-gradient(135deg, #667eea, #764ba2)', border: 'none',
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  );
}
