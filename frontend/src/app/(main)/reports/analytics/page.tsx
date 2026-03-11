'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Row, Col, Spin, Tooltip, Select, Button, Empty, Tag, Segmented } from 'antd';
import {
  FundOutlined, DollarOutlined, PrinterOutlined, ExportOutlined,
  TeamOutlined, ShoppingCartOutlined, BarChartOutlined, TrophyOutlined,
  SyncOutlined, ThunderboltOutlined, PieChartOutlined, HeatMapOutlined,
  RadarChartOutlined, DashboardOutlined, FullscreenOutlined,
  FullscreenExitOutlined, DownloadOutlined,
} from '@ant-design/icons';
import api from '@/services/api';
import dynamic from 'next/dynamic';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

interface Summary {
  total_purchase_amount: number;
  total_labels: number;
  total_outbound: number;
  total_outbound_weight: number;
  fruit_purchase_count: number;
  fruit_purchase_weight: number;
  active_workers: number;
  days: number;
}

interface CostItem { date: string; fruit: number; carton: number; material: number; total: number }
interface FruitDist { name: string; amount: number; weight: number; count: number }
interface ProdItem { date: string; printed: number; outbound: number; outbound_weight: number }
interface SkuRank { sku_id: number; name: string; fruit: string; count: number; weight: number }
interface WorkerRank { id: number; name: string; total_qty: number; active_days: number; daily_avg: number }
interface HeatItem { day: number; hour: number; value: number }

interface AnalyticsData {
  summary: Summary;
  cost_trend: CostItem[];
  fruit_distribution: FruitDist[];
  production_trend: ProdItem[];
  sku_ranking: SkuRank[];
  worker_ranking: WorkerRank[];
  heatmap: HeatItem[];
}

function fmt(v: number): string {
  if (v >= 10000) return `${(v / 10000).toFixed(1)}万`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function fmtW(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}t`;
  return `${v.toFixed(1)}kg`;
}

const ECHARTS_COLORS = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc', '#48b8d0'];

const KPI_CARDS = [
  { key: 'total_purchase_amount', label: '采购总额', icon: <DollarOutlined />, color: '#1677ff', gradient: 'linear-gradient(135deg, #1677ff 0%, #69b1ff 100%)', formatter: (v: number) => `¥${fmt(v)}` },
  { key: 'total_labels', label: '标签产量', icon: <PrinterOutlined />, color: '#00b96b', gradient: 'linear-gradient(135deg, #00b96b 0%, #5cdbd3 100%)', formatter: (v: number) => fmt(v) },
  { key: 'total_outbound', label: '出库总量', icon: <ExportOutlined />, color: '#fa8c16', gradient: 'linear-gradient(135deg, #fa8c16 0%, #ffc53d 100%)', formatter: (v: number) => fmt(v) },
  { key: 'active_workers', label: '活跃工人', icon: <TeamOutlined />, color: '#722ed1', gradient: 'linear-gradient(135deg, #722ed1 0%, #b37feb 100%)', formatter: (v: number) => `${v}人` },
];

function CostTrendChart({ data }: { data: CostItem[] }) {
  if (!data?.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />;
  const option = {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#333', fontSize: 12 },
      formatter: (params: any) => {
        let html = `<div style="font-weight:700;margin-bottom:6px;font-size:13px">${params[0].axisValue}</div>`;
        let total = 0;
        params.forEach((p: any) => {
          total += p.value;
          html += `<div style="display:flex;align-items:center;gap:6px;margin:3px 0">${p.marker}<span>${p.seriesName}</span><span style="margin-left:auto;font-weight:600">¥${Number(p.value).toLocaleString()}</span></div>`;
        });
        html += `<div style="border-top:1px solid #eee;margin-top:6px;padding-top:6px;font-weight:700">合计: ¥${total.toLocaleString()}</div>`;
        return html;
      },
    },
    legend: {
      bottom: 0,
      icon: 'roundRect',
      itemWidth: 12, itemHeight: 8,
      textStyle: { color: '#8a919f', fontSize: 11 },
    },
    grid: { top: 20, right: 20, bottom: 40, left: 50 },
    xAxis: {
      type: 'category',
      data: data.map(d => d.date),
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#e8e8e8' } },
      axisTick: { show: false },
      axisLabel: { color: '#8a919f', fontSize: 11, rotate: data.length > 20 ? 30 : 0 },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: '#f0f0f0', type: 'dashed' } },
      axisLabel: {
        color: '#8a919f', fontSize: 11,
        formatter: (v: number) => v >= 10000 ? `${(v / 10000).toFixed(0)}万` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`,
      },
    },
    series: [
      {
        name: '水果', type: 'line', stack: 'cost', smooth: true,
        data: data.map(d => d.fruit), symbol: 'none',
        lineStyle: { width: 2, color: '#91cc75' },
        areaStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(145,204,117,0.4)' }, { offset: 1, color: 'rgba(145,204,117,0.02)' }] },
        },
        emphasis: { focus: 'series' },
      },
      {
        name: '纸箱', type: 'line', stack: 'cost', smooth: true,
        data: data.map(d => d.carton), symbol: 'none',
        lineStyle: { width: 2, color: '#73c0de' },
        areaStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(115,192,222,0.4)' }, { offset: 1, color: 'rgba(115,192,222,0.02)' }] },
        },
        emphasis: { focus: 'series' },
      },
      {
        name: '材料', type: 'line', stack: 'cost', smooth: true,
        data: data.map(d => d.material), symbol: 'none',
        lineStyle: { width: 2, color: '#9a60b4' },
        areaStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(154,96,180,0.4)' }, { offset: 1, color: 'rgba(154,96,180,0.02)' }] },
        },
        emphasis: { focus: 'series' },
      },
    ],
    animationDuration: 1200,
    animationEasing: 'cubicOut',
  };
  return <ReactECharts option={option} style={{ height: 300 }} notMerge />;
}

function FruitPieChart({ data }: { data: FruitDist[] }) {
  if (!data?.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />;
  const total = data.reduce((s, d) => s + d.amount, 0);
  const option = {
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#333', fontSize: 12 },
      formatter: (p: any) => {
        const d = data[p.dataIndex];
        return `<div style="font-weight:700;margin-bottom:4px">${d.name}</div>
          <div>金额: ¥${d.amount.toLocaleString()}</div>
          <div>重量: ${d.weight.toLocaleString()}kg</div>
          <div>笔数: ${d.count}</div>
          <div style="margin-top:4px;font-weight:600">占比: ${p.percent}%</div>`;
      },
    },
    legend: {
      orient: 'vertical', right: 10, top: 'center',
      icon: 'roundRect', itemWidth: 10, itemHeight: 10, itemGap: 10,
      textStyle: { color: '#525966', fontSize: 11 },
      formatter: (name: string) => {
        const d = data.find(i => i.name === name);
        const pct = d ? ((d.amount / total) * 100).toFixed(1) : '0';
        return `${name}  ${pct}%`;
      },
    },
    series: [{
      type: 'pie', radius: ['42%', '72%'], center: ['35%', '50%'],
      padAngle: 2, itemStyle: { borderRadius: 6 },
      label: { show: false },
      emphasis: {
        scaleSize: 8,
        label: { show: true, fontSize: 13, fontWeight: 700, formatter: '{b}\n¥{c}' },
      },
      data: data.slice(0, 10).map((d, i) => ({
        name: d.name, value: d.amount,
        itemStyle: { color: ECHARTS_COLORS[i % ECHARTS_COLORS.length] },
      })),
      animationType: 'scale',
      animationEasing: 'elasticOut',
      animationDelay: (idx: number) => idx * 80,
    }],
    graphic: [{
      type: 'group', left: '25%', top: 'center',
      children: [
        { type: 'text', style: { text: `¥${fmt(total)}`, x: 0, y: -8, fill: '#1f1f1f', fontSize: 18, fontWeight: 700, textAlign: 'center' } },
        { type: 'text', style: { text: '采购总额', x: 0, y: 14, fill: '#8a919f', fontSize: 11, textAlign: 'center' } },
      ],
    }],
  };
  return <ReactECharts option={option} style={{ height: 300 }} notMerge />;
}

function ProductionTrendChart({ data }: { data: ProdItem[] }) {
  if (!data?.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />;
  const option = {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#333', fontSize: 12 },
      axisPointer: { type: 'cross', crossStyle: { color: '#ccc' } },
    },
    legend: {
      bottom: 0,
      icon: 'roundRect',
      itemWidth: 12, itemHeight: 8,
      textStyle: { color: '#8a919f', fontSize: 11 },
    },
    grid: { top: 20, right: 60, bottom: 40, left: 50 },
    xAxis: {
      type: 'category',
      data: data.map(d => d.date),
      boundaryGap: true,
      axisLine: { lineStyle: { color: '#e8e8e8' } },
      axisTick: { show: false },
      axisLabel: { color: '#8a919f', fontSize: 11, rotate: data.length > 20 ? 30 : 0 },
    },
    yAxis: [
      {
        type: 'value', name: '数量',
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { lineStyle: { color: '#f0f0f0', type: 'dashed' } },
        axisLabel: { color: '#8a919f', fontSize: 11 },
        nameTextStyle: { color: '#8a919f', fontSize: 11 },
      },
      {
        type: 'value', name: '重量(kg)',
        axisLine: { show: false }, axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { color: '#8a919f', fontSize: 11, formatter: '{value}kg' },
        nameTextStyle: { color: '#8a919f', fontSize: 11 },
      },
    ],
    series: [
      {
        name: '打印量', type: 'bar', barWidth: '35%',
        data: data.map(d => d.printed),
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#5470c6' }, { offset: 1, color: '#5470c6aa' }] },
        },
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(84,112,198,0.3)' } },
      },
      {
        name: '出库量', type: 'bar', barWidth: '35%',
        data: data.map(d => d.outbound),
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#fac858' }, { offset: 1, color: '#fac858aa' }] },
        },
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(250,200,88,0.3)' } },
      },
      {
        name: '出库重量', type: 'line', yAxisIndex: 1,
        data: data.map(d => d.outbound_weight),
        smooth: true, symbol: 'circle', symbolSize: 6,
        lineStyle: { width: 2, color: '#ee6666' },
        itemStyle: { color: '#ee6666' },
        areaStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(238,102,102,0.15)' }, { offset: 1, color: 'rgba(238,102,102,0.01)' }] },
        },
      },
    ],
    animationDuration: 1000,
    animationEasing: 'cubicOut',
  };
  return <ReactECharts option={option} style={{ height: 320 }} notMerge />;
}

function SkuRankingChart({ data }: { data: SkuRank[] }) {
  if (!data?.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />;
  const sorted = [...data].reverse();
  const option = {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#333', fontSize: 12 },
      formatter: (params: any) => {
        const p = params[0];
        const d = data.find(s => s.name === p.name);
        return `<div style="font-weight:700;margin-bottom:4px">${p.name}</div>
          <div>产量: ${Number(p.value).toLocaleString()}</div>
          <div>重量: ${d ? fmtW(d.weight) : '-'}</div>`;
      },
    },
    grid: { top: 10, right: 80, bottom: 10, left: 10, containLabel: true },
    xAxis: {
      type: 'value',
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { color: '#f5f5f5', type: 'dashed' } },
      axisLabel: { color: '#8a919f', fontSize: 11 },
    },
    yAxis: {
      type: 'category', data: sorted.map(s => s.name),
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: '#525966', fontSize: 11, width: 80, overflow: 'truncate' },
    },
    series: [{
      type: 'bar', barWidth: 16,
      data: sorted.map((s, i) => ({
        value: s.count,
        itemStyle: {
          borderRadius: [0, 8, 8, 0],
          color: {
            type: 'linear', x: 0, y: 0, x2: 1, y2: 0,
            colorStops: [
              { offset: 0, color: ECHARTS_COLORS[(data.length - 1 - i) % ECHARTS_COLORS.length] },
              { offset: 1, color: ECHARTS_COLORS[(data.length - 1 - i) % ECHARTS_COLORS.length] + '88' },
            ],
          },
        },
      })),
      label: {
        show: true, position: 'right',
        formatter: (p: any) => `${Number(p.value).toLocaleString()}`,
        color: '#525966', fontSize: 11, fontWeight: 600,
      },
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.1)' } },
      animationDelay: (idx: number) => idx * 80,
    }],
    animationDuration: 1000,
    animationEasing: 'cubicOut',
  };
  return <ReactECharts option={option} style={{ height: Math.max(250, data.length * 36) }} notMerge />;
}

function WorkerRadarChart({ data }: { data: WorkerRank[] }) {
  if (!data?.length || data.length < 3) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="数据不足" />;
  const top5 = data.slice(0, 5);
  const maxQty = Math.max(...top5.map(w => w.total_qty), 1);
  const maxDays = Math.max(...top5.map(w => w.active_days), 1);
  const maxAvg = Math.max(...top5.map(w => w.daily_avg), 1);

  const option = {
    tooltip: {
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#333', fontSize: 12 },
    },
    legend: {
      bottom: 0,
      icon: 'roundRect', itemWidth: 12, itemHeight: 8,
      textStyle: { color: '#8a919f', fontSize: 11 },
    },
    radar: {
      indicator: [
        { name: '总产量', max: maxQty * 1.1 },
        { name: '出勤天数', max: maxDays * 1.1 },
        { name: '日均产量', max: maxAvg * 1.1 },
      ],
      shape: 'polygon',
      splitNumber: 4,
      axisName: { color: '#525966', fontSize: 11 },
      splitArea: { areaStyle: { color: ['rgba(22,119,255,0.02)', 'rgba(22,119,255,0.04)', 'rgba(22,119,255,0.06)', 'rgba(22,119,255,0.08)'] } },
      splitLine: { lineStyle: { color: 'rgba(0,0,0,0.06)' } },
      axisLine: { lineStyle: { color: 'rgba(0,0,0,0.08)' } },
    },
    series: [{
      type: 'radar',
      data: top5.map((w, i) => ({
        value: [w.total_qty, w.active_days, w.daily_avg],
        name: w.name,
        symbol: 'circle', symbolSize: 5,
        lineStyle: { width: 2, color: ECHARTS_COLORS[i] },
        areaStyle: { color: ECHARTS_COLORS[i] + '20' },
        itemStyle: { color: ECHARTS_COLORS[i] },
      })),
      animationDuration: 1200,
    }],
  };
  return <ReactECharts option={option} style={{ height: 300 }} notMerge />;
}

function WorkerBarChart({ data }: { data: WorkerRank[] }) {
  if (!data?.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />;
  const option = {
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#333', fontSize: 12 },
      formatter: (params: any) => {
        const p = params[0];
        const w = data.find(w => w.name === p.name);
        return `<div style="font-weight:700;margin-bottom:4px">${p.name}</div>
          <div>总产量: ${Number(p.value).toLocaleString()}</div>
          <div>出勤: ${w?.active_days || 0}天</div>
          <div>日均: ${w?.daily_avg || 0}</div>`;
      },
    },
    grid: { top: 20, right: 20, bottom: 30, left: 10, containLabel: true },
    xAxis: {
      type: 'category', data: data.map(w => w.name),
      axisLine: { lineStyle: { color: '#e8e8e8' } },
      axisTick: { show: false },
      axisLabel: { color: '#8a919f', fontSize: 10, rotate: data.length > 8 ? 30 : 0 },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { color: '#f0f0f0', type: 'dashed' } },
      axisLabel: { color: '#8a919f', fontSize: 11 },
    },
    series: [{
      type: 'bar', barWidth: '50%',
      data: data.map((w, i) => ({
        value: w.total_qty,
        itemStyle: {
          borderRadius: [4, 4, 0, 0],
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: i < 3 ? '#9a60b4' : '#5470c6' },
              { offset: 1, color: i < 3 ? '#9a60b4aa' : '#5470c6aa' },
            ],
          },
        },
      })),
      emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.15)' } },
      label: {
        show: data.length <= 10, position: 'top',
        formatter: (p: any) => Number(p.value).toLocaleString(),
        color: '#525966', fontSize: 10,
      },
      animationDelay: (idx: number) => idx * 60,
    }],
    animationDuration: 1000,
    animationEasing: 'cubicOut',
  };
  return <ReactECharts option={option} style={{ height: 280 }} notMerge />;
}

function HeatmapChart({ data }: { data: HeatItem[] }) {
  if (!data?.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本周暂无数据" />;
  const dayLabels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const hours = Array.from({ length: 24 }, (_, i) => `${i}:00`);
  const mx = Math.max(...data.map(d => d.value), 1);

  const heatData = data.map(d => [d.hour, d.day % 7, d.value || '-']);

  const option = {
    tooltip: {
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: 'rgba(0,0,0,0.08)',
      borderWidth: 1,
      textStyle: { color: '#333', fontSize: 12 },
      formatter: (p: any) => {
        const [hour, day, val] = p.data;
        return `<div style="font-weight:700">${dayLabels[day]} ${hour}:00</div><div>打印量: ${val === '-' ? 0 : val}</div>`;
      },
    },
    grid: { top: 10, right: 20, bottom: 40, left: 55 },
    xAxis: {
      type: 'category', data: hours,
      splitArea: { show: true },
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: '#8a919f', fontSize: 10, interval: 2 },
    },
    yAxis: {
      type: 'category', data: dayLabels.slice(1).concat(dayLabels[0]),
      splitArea: { show: true },
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: '#525966', fontSize: 11 },
    },
    visualMap: {
      min: 0, max: mx,
      calculable: true, orient: 'horizontal',
      left: 'center', bottom: 0,
      inRange: {
        color: ['#ebedf0', '#c6e48b', '#7bc96f', '#239a3b', '#196127'],
      },
      textStyle: { color: '#8a919f', fontSize: 11 },
      itemWidth: 12, itemHeight: 120,
      text: ['多', '少'],
    },
    series: [{
      type: 'heatmap',
      data: heatData,
      label: { show: false },
      itemStyle: { borderRadius: 3, borderColor: '#fff', borderWidth: 2 },
      emphasis: {
        itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.2)', borderColor: '#333', borderWidth: 1 },
      },
      progressive: 100,
      animation: true,
    }],
  };
  return <ReactECharts option={option} style={{ height: 280 }} notMerge />;
}

function CostBreakdownGauge({ data }: { data: CostItem[] }) {
  if (!data?.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />;
  const totalFruit = data.reduce((s, d) => s + d.fruit, 0);
  const totalCarton = data.reduce((s, d) => s + d.carton, 0);
  const totalMaterial = data.reduce((s, d) => s + d.material, 0);
  const total = totalFruit + totalCarton + totalMaterial;
  const fruitPct = total > 0 ? Math.round((totalFruit / total) * 100) : 0;
  const cartonPct = total > 0 ? Math.round((totalCarton / total) * 100) : 0;
  const materialPct = total > 0 ? 100 - fruitPct - cartonPct : 0;

  const option = {
    series: [
      {
        type: 'gauge', startAngle: 90, endAngle: -270, radius: '85%', center: ['50%', '50%'],
        pointer: { show: false },
        progress: { show: true, overlap: false, roundCap: true, clip: false, itemStyle: { borderWidth: 0 } },
        axisLine: { lineStyle: { width: 16, color: [[1, '#f0f0f0']] } },
        splitLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false },
        data: [
          { value: fruitPct, name: '水果', title: { offsetCenter: ['0%', '-20%'] }, detail: { offsetCenter: ['0%', '-6%'] }, itemStyle: { color: '#91cc75' } },
          { value: cartonPct, name: '纸箱', title: { offsetCenter: ['0%', '10%'] }, detail: { offsetCenter: ['0%', '24%'] }, itemStyle: { color: '#73c0de' } },
          { value: materialPct, name: '材料', title: { offsetCenter: ['0%', '40%'] }, detail: { offsetCenter: ['0%', '54%'] }, itemStyle: { color: '#9a60b4' } },
        ],
        title: { fontSize: 11, color: '#8a919f' },
        detail: {
          width: 40, height: 14, fontSize: 14, color: 'inherit', fontWeight: 700,
          borderRadius: 4,
          formatter: '{value}%',
        },
        animationDuration: 1500,
      },
    ],
  };
  return <ReactECharts option={option} style={{ height: 250 }} notMerge />;
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [days, setDays] = useState(30);
  const [workerView, setWorkerView] = useState<'bar' | 'radar'>('bar');
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const r = await api.get('/reports/analytics', { params: { days } });
      setData(r.data?.data || null);
    } catch { setData(null); }
    finally { setLoading(false); setRefreshing(false); }
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement && containerRef.current) {
      containerRef.current.requestFullscreen();
      setIsFullscreen(true);
    } else if (document.fullscreenElement) {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const s = data?.summary;

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
      <div style={{ textAlign: 'center' }}>
        <Spin size="large" />
        <div style={{ marginTop: 16, color: 'var(--text-3)', fontSize: 13 }}>加载分析数据中...</div>
      </div>
    </div>
  );

  return (
    <div ref={containerRef} style={{ maxWidth: 1200, margin: '0 auto', background: isFullscreen ? 'var(--gray-2)' : undefined, padding: isFullscreen ? 24 : 0, overflowY: isFullscreen ? 'auto' : undefined, height: isFullscreen ? '100vh' : undefined }}>
      {/* Page Header */}
      <div className="stagger-1" style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
        marginBottom: 24, padding: '20px 24px',
        background: 'linear-gradient(135deg, rgba(22,119,255,0.07) 0%, rgba(114,46,209,0.05) 40%, rgba(235,47,150,0.04) 70%, rgba(250,140,22,0.03) 100%)',
        borderRadius: 'var(--radius-xl)', border: '1px solid rgba(22,119,255,0.08)',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: -50, right: 30, width: 140, height: 140, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(114,46,209,0.06) 0%, transparent 70%)', pointerEvents: 'none',
        }} />
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-1)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              width: 34, height: 34, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, #1677ff, #722ed1)', color: '#fff', fontSize: 16,
            }}><FundOutlined /></span>
            数据分析中心
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
            多维度业务数据分析 · 专业级交互式图表 · 洞察运营趋势
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Select
            value={days}
            onChange={v => setDays(v)}
            style={{ width: 120 }}
            options={[
              { value: 7, label: '近 7 天' },
              { value: 14, label: '近 14 天' },
              { value: 30, label: '近 30 天' },
              { value: 60, label: '近 60 天' },
              { value: 90, label: '近 90 天' },
            ]}
          />
          <Tooltip title={isFullscreen ? '退出全屏' : '全屏模式'}>
            <Button
              type="default"
              icon={isFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={toggleFullscreen}
              style={{ borderRadius: 10, border: '1px solid rgba(22,119,255,0.1)' }}
            />
          </Tooltip>
          <Tooltip title="刷新数据">
            <Button
              type="default" icon={<SyncOutlined spin={refreshing} />}
              onClick={() => fetchData(true)}
              style={{ borderRadius: 10, border: '1px solid rgba(22,119,255,0.1)' }}
            />
          </Tooltip>
        </div>
      </div>

      {/* KPI Cards */}
      <Row gutter={[14, 14]} style={{ marginBottom: 22 }}>
        {KPI_CARDS.map((card, i) => (
          <Col xs={12} sm={12} md={6} key={card.key}>
            <div className={`stagger-${i + 2}`} style={{
              background: card.gradient,
              borderRadius: 'var(--radius-l)', padding: '20px 18px',
              position: 'relative', overflow: 'hidden',
              boxShadow: `0 6px 20px ${card.color}30`,
              transition: 'all 0.35s cubic-bezier(0.22, 1, 0.36, 1)',
              cursor: 'default',
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px) scale(1.02)'; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ''; }}
            >
              <div style={{ position: 'absolute', top: -15, right: -15, width: 60, height: 60, borderRadius: '50%', background: 'rgba(255,255,255,0.12)', pointerEvents: 'none' }} />
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', marginBottom: 6 }}>{card.label}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
                {card.formatter(Number((s as any)?.[card.key]) || 0)}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>近 {days} 天</div>
            </div>
          </Col>
        ))}
      </Row>

      {/* Second row: extra KPIs */}
      <Row gutter={[14, 14]} style={{ marginBottom: 22 }}>
        {[
          { label: '水果采购笔数', value: s?.fruit_purchase_count || 0, icon: <ShoppingCartOutlined />, color: '#00b96b', bg: 'rgba(0,185,107,0.06)' },
          { label: '采购总重量', value: fmtW(s?.fruit_purchase_weight || 0), icon: <BarChartOutlined />, color: '#13c2c2', bg: 'rgba(19,194,194,0.06)' },
          { label: '出库总重量', value: fmtW(s?.total_outbound_weight || 0), icon: <ExportOutlined />, color: '#fa8c16', bg: 'rgba(250,140,22,0.06)' },
          { label: '统计天数', value: `${s?.days || days} 天`, icon: <ThunderboltOutlined />, color: '#722ed1', bg: 'rgba(114,46,209,0.06)' },
        ].map((item, i) => (
          <Col xs={12} sm={6} key={i}>
            <div className={`stagger-${i + 6}`} style={{
              padding: '16px', borderRadius: 'var(--radius-l)',
              background: 'var(--bg-card)', backdropFilter: 'var(--glass-blur)',
              border: '1px solid var(--glass-border)',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: item.bg, color: item.color, fontSize: 16,
              }}>{item.icon}</div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{item.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)', fontVariantNumeric: 'tabular-nums' }}>
                  {typeof item.value === 'number' ? item.value.toLocaleString() : item.value}
                </div>
              </div>
            </div>
          </Col>
        ))}
      </Row>

      {/* Cost Trend + Fruit Distribution */}
      <Row gutter={[14, 14]} style={{ marginBottom: 22 }}>
        <Col xs={24} lg={14}>
          <div className="panel">
            <div className="panel-head">
              <span className="panel-title">
                <span style={{
                  width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: 'linear-gradient(135deg, rgba(22,119,255,0.1), rgba(0,185,107,0.08))', color: '#1677ff', fontSize: 13,
                }}><DollarOutlined /></span>
                采购成本趋势
              </span>
            </div>
            <div className="panel-body">
              <CostTrendChart data={data?.cost_trend || []} />
            </div>
          </div>
        </Col>
        <Col xs={24} lg={10}>
          <div className="panel" style={{ height: '100%' }}>
            <div className="panel-head">
              <span className="panel-title">
                <span style={{
                  width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: 'linear-gradient(135deg, rgba(250,140,22,0.1), rgba(235,47,150,0.08))', color: '#fa8c16', fontSize: 13,
                }}><PieChartOutlined /></span>
                水果品类分布
              </span>
            </div>
            <div className="panel-body">
              <FruitPieChart data={data?.fruit_distribution || []} />
            </div>
          </div>
        </Col>
      </Row>

      {/* Production Trend (Bar + Line combo) */}
      <div className="panel" style={{ marginBottom: 22 }}>
        <div className="panel-head">
          <span className="panel-title">
            <span style={{
              width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, rgba(22,119,255,0.1), rgba(250,140,22,0.08))', color: '#1677ff', fontSize: 13,
            }}><BarChartOutlined /></span>
            生产与出库趋势
          </span>
          <Tag color="blue" style={{ borderRadius: 10, fontSize: 11 }}>柱状图 + 折线图</Tag>
        </div>
        <div className="panel-body">
          <ProductionTrendChart data={data?.production_trend || []} />
        </div>
      </div>

      {/* Cost Breakdown Gauge + SKU Ranking */}
      <Row gutter={[14, 14]} style={{ marginBottom: 22 }}>
        <Col xs={24} md={8}>
          <div className="panel" style={{ height: '100%' }}>
            <div className="panel-head">
              <span className="panel-title">
                <span style={{
                  width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: 'linear-gradient(135deg, rgba(114,46,209,0.1), rgba(0,185,107,0.08))', color: '#722ed1', fontSize: 13,
                }}><DashboardOutlined /></span>
                成本结构
              </span>
            </div>
            <div className="panel-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CostBreakdownGauge data={data?.cost_trend || []} />
            </div>
          </div>
        </Col>
        <Col xs={24} md={16}>
          <div className="panel" style={{ height: '100%' }}>
            <div className="panel-head">
              <span className="panel-title">
                <span style={{
                  width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: 'linear-gradient(135deg, rgba(22,119,255,0.1), rgba(114,46,209,0.08))', color: '#1677ff', fontSize: 13,
                }}><TrophyOutlined /></span>
                SKU 产量排行
              </span>
              <Tag color="blue" style={{ borderRadius: 10, fontSize: 11 }}>Top 10</Tag>
            </div>
            <div className="panel-body">
              <SkuRankingChart data={data?.sku_ranking || []} />
            </div>
          </div>
        </Col>
      </Row>

      {/* Worker Ranking: Bar + Radar toggle */}
      <div className="panel" style={{ marginBottom: 22 }}>
        <div className="panel-head">
          <span className="panel-title">
            <span style={{
              width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, rgba(114,46,209,0.1), rgba(235,47,150,0.08))', color: '#722ed1', fontSize: 13,
            }}><TeamOutlined /></span>
            工人效率排行
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Tag color="purple" style={{ borderRadius: 10, fontSize: 11 }}>Top 15</Tag>
            <Segmented
              size="small"
              value={workerView}
              onChange={v => setWorkerView(v as 'bar' | 'radar')}
              options={[
                { value: 'bar', icon: <BarChartOutlined />, label: '柱状图' },
                { value: 'radar', icon: <RadarChartOutlined />, label: '雷达图' },
              ]}
            />
          </div>
        </div>
        <div className="panel-body">
          {workerView === 'bar' ? (
            <WorkerBarChart data={data?.worker_ranking || []} />
          ) : (
            <WorkerRadarChart data={data?.worker_ranking || []} />
          )}
        </div>
      </div>

      {/* Heatmap */}
      <div className="panel" style={{ marginBottom: 22 }}>
        <div className="panel-head">
          <span className="panel-title">
            <span style={{
              width: 28, height: 28, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: 'linear-gradient(135deg, rgba(22,119,255,0.1), rgba(19,194,194,0.08))', color: '#1677ff', fontSize: 13,
            }}><HeatMapOutlined /></span>
            本周生产热力图
          </span>
          <Tag style={{ borderRadius: 10, fontSize: 11, background: 'linear-gradient(135deg, #ebedf0, #239a3b)', color: '#fff', border: 'none' }}>
            GitHub 风格
          </Tag>
        </div>
        <div className="panel-body">
          <HeatmapChart data={data?.heatmap || []} />
        </div>
      </div>
    </div>
  );
}
