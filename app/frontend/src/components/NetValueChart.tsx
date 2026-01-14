import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { usePortfolioStore, useSettingsStore } from '../store';
import { formatPercent } from '../utils/format';
import { getTodayET } from '../utils/timeUtils';
import { analyticsApi } from '../api';

type TimeRange = '7d' | '30d' | '90d' | '180d' | '1y' | 'all';

function NetValueChart() {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);
  const { netValueCurve, fetchNetValueCurve, isLoadingChart, transactions } = usePortfolioStore();
  const { theme } = useSettingsStore();
  const [timeRange, setTimeRange] = useState<TimeRange>('90d');
  const [isReady, setIsReady] = useState(false);
  const [firstRecordDate, setFirstRecordDate] = useState<string | null>(null);
  const [showStock, setShowStock] = useState(true);
  const [showCash, setShowCash] = useState(true);

  // 延迟渲染，确保容器尺寸正确
  useEffect(() => {
    const timer = setTimeout(() => setIsReady(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // 获取第一条记录的日期
  useEffect(() => {
    const loadFirstRecordDate = async () => {
      try {
        const date = await analyticsApi.getFirstRecordDate();
        setFirstRecordDate(date);
      } catch (error) {
        console.error('获取第一条记录日期失败:', error);
      }
    };
    loadFirstRecordDate();
  }, []);

  // 根据时间范围计算日期（使用ET时间）
  const getDateRange = (range: TimeRange): { from: string; to: string } | null => {
    // 使用ET时间作为"今天"
    const todayET = getTodayET();
    const todayDate = new Date(todayET + 'T12:00:00'); // 使用中午时间避免时区问题
    const from = new Date(todayDate);

    switch (range) {
      case '7d':
        from.setDate(from.getDate() - 7);
        break;
      case '30d':
        from.setDate(from.getDate() - 30);
        break;
      case '90d':
        from.setDate(from.getDate() - 90);
        break;
      case '180d':
        from.setDate(from.getDate() - 180);
        break;
      case '1y':
        from.setFullYear(from.getFullYear() - 1);
        break;
      case 'all':
        // 如果没有第一条记录日期，返回 null，等待加载
        if (!firstRecordDate) {
          return null;
        }
        // 从第一条记录日期开始
        from.setTime(new Date(firstRecordDate + 'T12:00:00').getTime());
        break;
    }

    // 格式化为 YYYY-MM-DD
    const formatDate = (date: Date): string => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    return {
      from: formatDate(from),
      to: todayET, // 使用ET时间的今天
    };
  };

  // 切换时间范围时重新加载数据
  useEffect(() => {
    // 如果是 'all' 且还没有第一条记录日期，等待
    if (timeRange === 'all' && !firstRecordDate) {
      return;
    }
    
    const dateRange = getDateRange(timeRange);
    if (dateRange) {
      // 完全销毁旧图表实例，确保重新绘制
      if (chartInstance.current) {
        chartInstance.current.dispose();
        chartInstance.current = null;
      }
      fetchNetValueCurve(dateRange.from, dateRange.to);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange, firstRecordDate]);

  // 监听总览数据、交易和现金账户变化，自动刷新净值曲线
  const { overview } = usePortfolioStore();
  const prevTransactionsCount = useRef<number>(0);
  const prevTotalAsset = useRef<number | undefined>(undefined);
  const prevCash = useRef<number | undefined>(undefined);
  const prevTransactionsRef = useRef<string>('');
  const prevNetValueCurveLength = useRef<number>(0);
  
  useEffect(() => {
    // 如果净值曲线数据被清空（由 store 操作触发），立即重新加载
    const dataWasCleared = netValueCurve.length === 0 && prevNetValueCurveLength.current > 0;
    
    // 计算交易的唯一标识（基于所有交易的ID、日期、数量和价格）
    const transactionsKey = transactions.map(t => `${t.id}-${t.trade_date}-${t.quantity}-${t.price}-${t.type}`).join(',');
    const transactionsChanged = transactionsKey !== prevTransactionsRef.current;
    
    // 当交易数量变化时，重新绘制完整曲线（因为用户可能记录一段时间之前的交易或修改记录）
    const transactionsCountChanged = transactions.length !== prevTransactionsCount.current;
    
    // 当总览数据更新时，重新加载净值曲线（使用当前时间范围）
    // 只有当总资产或现金实际发生变化时才刷新（避免初始加载时重复请求）
    if (overview && timeRange) {
      const totalAssetChanged = prevTotalAsset.current !== undefined && 
                                prevTotalAsset.current !== overview.total_asset;
      const cashChanged = prevCash.current !== undefined && 
                          prevCash.current !== overview.cash;
      
      // 如果数据被清空、交易数据变化（包括创建、更新、删除），或者资产/现金变化，强制重新加载
      if (dataWasCleared || transactionsChanged || transactionsCountChanged || totalAssetChanged || cashChanged) {
        const dateRange = getDateRange(timeRange);
        if (dateRange) {
          // 完全销毁旧图表实例，确保重新绘制
          if (chartInstance.current) {
            chartInstance.current.dispose();
            chartInstance.current = null;
          }
          // 重新绘制完整曲线，确保数据完整（从服务器获取最新数据）
          fetchNetValueCurve(dateRange.from, dateRange.to);
        }
      }
      
      // 更新引用值
      prevTotalAsset.current = overview.total_asset;
      prevCash.current = overview.cash;
      prevTransactionsCount.current = transactions.length;
      prevTransactionsRef.current = transactionsKey;
      prevNetValueCurveLength.current = netValueCurve.length;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview?.total_asset, overview?.cash, transactions, timeRange, netValueCurve.length]); // 监听总资产、现金、交易数组、时间范围和净值曲线长度变化

  // 渲染图表
  useEffect(() => {
    if (!chartRef.current || !isReady || isLoadingChart) {
      // 如果正在加载或数据为空，销毁旧图表
      if (chartInstance.current) {
        chartInstance.current.dispose();
        chartInstance.current = null;
      }
      return;
    }

    // 如果数据为空，不渲染图表
    if (netValueCurve.length === 0) {
      if (chartInstance.current) {
        chartInstance.current.dispose();
        chartInstance.current = null;
      }
      return;
    }

    // 确保容器有尺寸
    const { clientWidth, clientHeight } = chartRef.current;
    if (clientWidth === 0 || clientHeight === 0) return;

    // 完全销毁旧图表实例，确保重新绘制
    if (chartInstance.current) {
      chartInstance.current.dispose();
      chartInstance.current = null;
    }
    
    // 创建新的图表实例
    chartInstance.current = echarts.init(chartRef.current);

    const chart = chartInstance.current;

    // 根据主题设置颜色
    const isDark = theme === 'dark';
    const textColor = isDark ? '#f1f5f9' : '#1e293b';
    const mutedColor = isDark ? '#64748b' : '#94a3b8';
    const bgColor = isDark ? '#1e293b' : '#ffffff';
    const borderColor = isDark ? '#334155' : '#e2e8f0';
    const gridLineColor = isDark ? '#334155' : '#e2e8f0';

    const dates = netValueCurve.map(p => p.date);
    const totalValues = netValueCurve.map(p => p.value);
    const stockValues = netValueCurve.map(p => p.stock_value ?? 0);
    const cashValues = netValueCurve.map(p => p.cash_value ?? 0);
    const pnlPcts = netValueCurve.map(p => p.pnl_pct);

    // 根据勾选状态决定显示哪些数据
    const seriesData: any[] = [];
    
    if (showStock && showCash) {
      // 显示总资产（股票+现金）
      const lastPnl = pnlPcts.length > 0 ? pnlPcts[pnlPcts.length - 1] : 0;
      const lineColor = lastPnl >= 0 ? '#10b981' : '#ef4444';
      const areaColor = lastPnl >= 0 
        ? new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(16, 185, 129, 0.3)' },
            { offset: 1, color: 'rgba(16, 185, 129, 0.02)' },
          ])
        : new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(239, 68, 68, 0.3)' },
            { offset: 1, color: 'rgba(239, 68, 68, 0.02)' },
          ]);
      
      seriesData.push({
        name: '总资产',
        type: 'line',
        data: totalValues,
        smooth: true,
        symbol: 'none',
        lineStyle: {
          color: lineColor,
          width: 2,
        },
        areaStyle: {
          color: areaColor,
        },
      });
    } else if (showStock) {
      // 只显示股票
      const stockPnlPcts = netValueCurve.map(p => p.stock_pnl_pct ?? 0);
      const lastStockPnl = stockPnlPcts.length > 0 ? stockPnlPcts[stockPnlPcts.length - 1] : 0;
      const lineColor = lastStockPnl >= 0 ? '#3b82f6' : '#ef4444';
      const areaColor = lastStockPnl >= 0 
        ? new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(59, 130, 246, 0.3)' },
            { offset: 1, color: 'rgba(59, 130, 246, 0.02)' },
          ])
        : new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(239, 68, 68, 0.3)' },
            { offset: 1, color: 'rgba(239, 68, 68, 0.02)' },
          ]);
      
      seriesData.push({
        name: '股票市值',
        type: 'line',
        data: stockValues,
        smooth: true,
        symbol: 'none',
        lineStyle: {
          color: lineColor,
          width: 2,
        },
        areaStyle: {
          color: areaColor,
        },
      });
    } else if (showCash) {
      // 只显示现金
      const cashPnlPcts = netValueCurve.map(p => p.cash_pnl_pct ?? 0);
      const lastCashPnl = cashPnlPcts.length > 0 ? cashPnlPcts[cashPnlPcts.length - 1] : 0;
      const lineColor = lastCashPnl >= 0 ? '#f59e0b' : '#ef4444';
      const areaColor = lastCashPnl >= 0 
        ? new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(245, 158, 11, 0.3)' },
            { offset: 1, color: 'rgba(245, 158, 11, 0.02)' },
          ])
        : new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(239, 68, 68, 0.3)' },
            { offset: 1, color: 'rgba(239, 68, 68, 0.02)' },
          ]);
      
      seriesData.push({
        name: '现金余额',
        type: 'line',
        data: cashValues,
        smooth: true,
        symbol: 'none',
        lineStyle: {
          color: lineColor,
          width: 2,
        },
        areaStyle: {
          color: areaColor,
        },
      });
    } else {
      // 都不显示，显示空数据
      seriesData.push({
        name: '无数据',
        type: 'line',
        data: [],
        smooth: true,
        symbol: 'none',
      });
    }

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      grid: {
        left: 60,
        right: 30,
        top: 30,
        bottom: 50,
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: bgColor,
        borderColor: borderColor,
        borderWidth: 1,
        textStyle: {
          color: textColor,
          fontSize: 12,
        },
        formatter: (params: any) => {
          const point = params[0];
          const date = point.axisValue;
          const dataPoint = netValueCurve.find(p => p.date === date);
          if (!dataPoint) return '';
          
          const totalValue = dataPoint.value;
          const stockValue = dataPoint.stock_value ?? 0;
          const cashValue = dataPoint.cash_value ?? 0;
          const totalPnl = dataPoint.pnl_pct;
          const stockPnl = dataPoint.stock_pnl_pct ?? 0;
          const cashPnl = dataPoint.cash_pnl_pct ?? 0;
          
          let content = `
            <div style="padding: 8px;">
              <div style="color: ${mutedColor}; margin-bottom: 8px;">${date}</div>
          `;
          
          if (showStock && showCash) {
            content += `
              <div style="display: flex; justify-content: space-between; gap: 24px; margin-bottom: 4px;">
                <span style="color: ${mutedColor};">总资产</span>
                <span style="color: ${textColor}; font-weight: 600;">$${totalValue.toLocaleString()}</span>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 24px; margin-bottom: 4px;">
                <span style="color: ${mutedColor};">股票市值</span>
                <span style="color: ${textColor};">$${stockValue.toLocaleString()}</span>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 24px; margin-bottom: 4px;">
                <span style="color: ${mutedColor};">现金余额</span>
                <span style="color: ${textColor};">$${cashValue.toLocaleString()}</span>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 24px; margin-top: 4px;">
                <span style="color: ${mutedColor};">累计收益</span>
                <span style="color: ${totalPnl >= 0 ? '#10b981' : '#ef4444'}; font-weight: 600;">${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%</span>
              </div>
            `;
          } else if (showStock) {
            content += `
              <div style="display: flex; justify-content: space-between; gap: 24px; margin-bottom: 4px;">
                <span style="color: ${mutedColor};">股票市值</span>
                <span style="color: ${textColor}; font-weight: 600;">$${stockValue.toLocaleString()}</span>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 24px; margin-top: 4px;">
                <span style="color: ${mutedColor};">累计收益</span>
                <span style="color: ${stockPnl >= 0 ? '#3b82f6' : '#ef4444'}; font-weight: 600;">${stockPnl >= 0 ? '+' : ''}${stockPnl.toFixed(2)}%</span>
              </div>
            `;
          } else if (showCash) {
            content += `
              <div style="display: flex; justify-content: space-between; gap: 24px; margin-bottom: 4px;">
                <span style="color: ${mutedColor};">现金余额</span>
                <span style="color: ${textColor}; font-weight: 600;">$${cashValue.toLocaleString()}</span>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 24px; margin-top: 4px;">
                <span style="color: ${mutedColor};">累计收益</span>
                <span style="color: ${cashPnl >= 0 ? '#f59e0b' : '#ef4444'}; font-weight: 600;">${cashPnl >= 0 ? '+' : ''}${cashPnl.toFixed(2)}%</span>
              </div>
            `;
          }
          
          content += `</div>`;
          return content;
        },
        axisPointer: {
          type: 'cross',
          lineStyle: {
            color: borderColor,
          },
          crossStyle: {
            color: borderColor,
          },
        },
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: {
          lineStyle: {
            color: gridLineColor,
          },
        },
        axisTick: {
          show: false,
        },
        axisLabel: {
          color: mutedColor,
          fontSize: 10,
          formatter: (value: string) => {
            const parts = value.split('-');
            return `${parts[1]}/${parts[2]}`;
          },
        },
      },
      yAxis: [
        {
          type: 'value',
          position: 'left',
          axisLine: {
            show: false,
          },
          axisTick: {
            show: false,
          },
          axisLabel: {
            color: mutedColor,
            fontSize: 10,
            formatter: (value: number) => {
              if (value >= 10000) {
                return `${(value / 10000).toFixed(0)}万`;
              }
              return value.toFixed(0);
            },
          },
          splitLine: {
            lineStyle: {
              color: gridLineColor,
              type: 'dashed',
            },
          },
        },
      ],
      series: seriesData,
      animation: true,
      animationDuration: 1000,
      animationEasing: 'cubicOut',
    };

    chart.setOption(option);

    const handleResize = () => chart.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [netValueCurve, theme, isReady, isLoadingChart, showStock, showCash]);

  useEffect(() => {
    return () => {
      chartInstance.current?.dispose();
    };
  }, []);

  const timeRanges: { key: TimeRange; label: string }[] = [
    { key: '7d', label: '7天' },
    { key: '30d', label: '30天' },
    { key: '90d', label: '90天' },
    { key: '180d', label: '半年' },
    { key: '1y', label: '1年' },
    { key: 'all', label: '全部' },
  ];

  // 计算统计数据
  const stats = netValueCurve.length > 0 ? {
    totalPnlPct: netValueCurve[netValueCurve.length - 1].pnl_pct,
  } : null;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm">
      <div className="flex flex-col gap-4 mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">净值曲线</h2>
            {stats && (
              <div className="flex items-center gap-3 text-sm">
                <span className="text-slate-500 dark:text-slate-400">
                  区间收益: 
                  <span className={`ml-1 font-mono font-semibold ${stats.totalPnlPct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                    {formatPercent(stats.totalPnlPct)}
                  </span>
                </span>
              </div>
            )}
          </div>

          {/* 时间范围选择 */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-700 rounded-lg p-1">
            {timeRanges.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTimeRange(key)}
                className={`px-3 py-1.5 text-xs rounded-md transition-all font-medium ${
                  timeRange === key
                    ? 'bg-blue-500 text-white'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 显示选项：股票和现金勾选框 */}
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showStock}
              onChange={(e) => setShowStock(e.target.checked)}
              className="w-4 h-4 text-blue-500 rounded focus:ring-blue-500 focus:ring-2"
            />
            <span className="text-sm text-slate-700 dark:text-slate-300">显示股票</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showCash}
              onChange={(e) => setShowCash(e.target.checked)}
              className="w-4 h-4 text-blue-500 rounded focus:ring-blue-500 focus:ring-2"
            />
            <span className="text-sm text-slate-700 dark:text-slate-300">显示现金</span>
          </label>
        </div>
      </div>

      {isLoadingChart ? (
        <div style={{ height: '320px' }} className="flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : netValueCurve.length === 0 ? (
        <div style={{ height: '320px' }} className="flex items-center justify-center text-slate-500 dark:text-slate-400">
          <div className="text-center">
            <p className="mb-2">暂无净值数据</p>
            <p className="text-xs">系统会在开盘和收市时自动生成快照</p>
          </div>
        </div>
      ) : (
        <div ref={chartRef} style={{ width: '100%', height: '320px' }} />
      )}
    </div>
  );
}

export default NetValueChart;
