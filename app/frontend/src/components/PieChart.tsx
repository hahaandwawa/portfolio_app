import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { usePortfolioStore, useSettingsStore } from '../store';

function PieChart() {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);
  const { distribution, isLoadingHoldings } = usePortfolioStore();
  const { theme } = useSettingsStore();
  const [isReady, setIsReady] = useState(false);

  // 延迟渲染，确保容器尺寸正确
  useEffect(() => {
    const timer = setTimeout(() => setIsReady(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!chartRef.current || !isReady || isLoadingHoldings || distribution.length === 0) return;
    
    // 确保容器有尺寸
    const { clientWidth, clientHeight } = chartRef.current;
    if (clientWidth === 0 || clientHeight === 0) return;

    // 初始化或重新创建图表
    if (chartInstance.current) {
      chartInstance.current.dispose();
    }
    chartInstance.current = echarts.init(chartRef.current);

    const chart = chartInstance.current;

    // 根据主题设置颜色
    const isDark = theme === 'dark';
    const textColor = isDark ? '#f1f5f9' : '#1e293b';
    const mutedColor = isDark ? '#64748b' : '#94a3b8';
    const bgColor = isDark ? '#1e293b' : '#ffffff';
    const borderColor = isDark ? '#334155' : '#e2e8f0';

    // 配置
    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        backgroundColor: bgColor,
        borderColor: borderColor,
        borderWidth: 1,
        textStyle: {
          color: textColor,
        },
        formatter: (params: any) => {
          const { name, value, percent } = params;
          return `
            <div style="padding: 4px 8px;">
              <div style="font-weight: 600; margin-bottom: 4px;">${name}</div>
              <div style="color: ${mutedColor};">Value: $${value.toLocaleString()}</div>
              <div style="color: #3b82f6;">占比: ${percent}%</div>
            </div>
          `;
        },
      },
      legend: {
        type: 'scroll',
        orient: 'horizontal',
        bottom: 15,
        left: '10%',
        right: '10%',
        itemWidth: 14,
        itemHeight: 14,
        itemGap: 30,
        lineGap: 15,
        textStyle: {
          color: mutedColor,
          fontSize: 12,
        },
        pageTextStyle: {
          color: mutedColor,
        },
        pageIconColor: '#3b82f6',
        pageIconInactiveColor: borderColor,
      },
      series: [
        {
          name: '持仓占比',
          type: 'pie',
          radius: ['40%', '70%'],
          center: ['50%', '40%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderRadius: 6,
            borderColor: bgColor,
            borderWidth: 2,
          },
          label: {
            show: false,
          },
          emphasis: {
            label: {
              show: true,
              fontSize: 14,
              fontWeight: 'bold',
              color: textColor,
              formatter: (params: any) => {
                return `${params.data.name}\n${params.percent}%`;
              },
            },
            itemStyle: {
              shadowBlur: 20,
              shadowOffsetX: 0,
              shadowColor: 'rgba(59, 130, 246, 0.3)',
            },
          },
          labelLine: {
            show: false,
          },
          data: distribution.map((item, index) => ({
            value: item.value,
            name: item.symbol,
            itemStyle: {
              color: getColor(index),
            },
          })),
        },
      ],
      animation: true,
      animationDuration: 800,
      animationEasing: 'cubicOut',
    };

    chart.setOption(option);

    // 响应式
    const handleResize = () => {
      chart.resize();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [distribution, theme, isReady, isLoadingHoldings]);

  // 清理
  useEffect(() => {
    return () => {
      chartInstance.current?.dispose();
    };
  }, []);

  if (isLoadingHoldings) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm min-h-[500px]">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">持仓占比</h2>
        <div className="flex items-center justify-center h-[450px]">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (distribution.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm min-h-[500px]">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">持仓占比</h2>
        <div className="flex items-center justify-center h-[450px] text-slate-500 dark:text-slate-400">
          暂无持仓数据
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm min-h-[500px]">
      <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">持仓占比</h2>
      <div ref={chartRef} style={{ width: '100%', height: '450px' }} />
    </div>
  );
}

// 配色方案
function getColor(index: number): string {
  const colors = [
    '#3b82f6', // 蓝色
    '#8b5cf6', // 紫色
    '#10b981', // 绿色
    '#f59e0b', // 金色
    '#ef4444', // 红色
    '#06b6d4', // 青色
    '#ec4899', // 粉红
    '#84cc16', // 草绿
    '#f97316', // 橙色
    '#6366f1', // 靛蓝
  ];
  return colors[index % colors.length];
}

export default PieChart;
