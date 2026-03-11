'use client';

import React, { useState, useEffect } from 'react';
import { ConfigProvider, App as AntdApp, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import './globals.css';
import { ThemeContext } from '@/stores/useTheme';

dayjs.locale('zh-cn');

const lightTheme = {
  token: {
    colorPrimary: '#1677ff',
    borderRadius: 6,
    fontSize: 14,
    colorBgLayout: '#f5f7fa',
    colorBgContainer: '#ffffff',
    fontFamily: '-apple-system, BlinkMacSystemFont, PingFang SC, Hiragino Sans GB, Microsoft YaHei UI, Microsoft YaHei, Source Han Sans CN, sans-serif',
  },
  components: {
    Menu: {
      itemBorderRadius: 6,
      itemMarginInline: 8,
      itemHeight: 36,
      subMenuItemBg: 'transparent',
      itemSelectedBg: '#f0f5ff',
      itemSelectedColor: '#1677ff',
      itemHoverBg: '#f5f5f5',
    },
    Card: { borderRadiusLG: 8 },
    Table: { borderRadiusLG: 8, headerBg: '#fafafa' },
    Button: { borderRadius: 6 },
    Input: { borderRadius: 6 },
    Select: { borderRadius: 6 },
  },
};

const darkTheme = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    colorPrimary: '#1677ff',
    borderRadius: 6,
    fontSize: 14,
    colorBgLayout: '#0d1117',
    colorBgContainer: '#161b22',
    colorBgElevated: '#1e242c',
    fontFamily: '-apple-system, BlinkMacSystemFont, PingFang SC, Hiragino Sans GB, Microsoft YaHei UI, Microsoft YaHei, Source Han Sans CN, sans-serif',
  },
  components: {
    Menu: {
      itemBorderRadius: 6,
      itemMarginInline: 8,
      itemHeight: 36,
      subMenuItemBg: 'transparent',
      itemSelectedBg: 'rgba(22,119,255,0.15)',
      itemSelectedColor: '#1677ff',
      itemHoverBg: 'rgba(255,255,255,0.06)',
    },
    Card: { borderRadiusLG: 8 },
    Table: { borderRadiusLG: 8, headerBg: 'rgba(22,119,255,0.06)' },
    Button: { borderRadius: 6 },
    Input: { borderRadius: 6 },
    Select: { borderRadius: 6 },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') {
      setDark(true);
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }, []);

  const toggle = () => {
    setDark(prev => {
      const next = !prev;
      if (next) {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
      } else {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
      }
      return next;
    });
  };

  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="theme-color" content={dark ? '#0d1117' : '#ffffff'} />
        <link rel="manifest" href="/manifest.json" />
        <title>{'\u679c\u7ba1\u7cfb\u7edf'}</title>
      </head>
      <body style={{ margin: 0 }}>
        <ThemeContext.Provider value={{ dark, toggle }}>
          <ConfigProvider locale={zhCN} theme={dark ? darkTheme : lightTheme}>
            <AntdApp>
              {children}
            </AntdApp>
          </ConfigProvider>
        </ThemeContext.Provider>
      </body>
    </html>
  );
}
