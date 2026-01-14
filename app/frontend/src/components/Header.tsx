import { 
  RefreshCw, 
  Settings, 
  Plus, 
  Moon, 
  Sun, 
  Download,
  TrendingUp,
  RotateCcw
} from 'lucide-react';
import { usePortfolioStore, useSettingsStore, useUIStore } from '../store';
import { transactionApi } from '../api';

function Header() {
  const { 
    refreshPrices, 
    isRefreshingPrices, 
    rebuildHistoricalData,
    isRebuildingSnapshots
  } = usePortfolioStore();
  const { theme, toggleTheme, refreshInterval } = useSettingsStore();
  const { openTransactionForm, openSettings } = useUIStore();

  const handleRefresh = async () => {
    try {
      await refreshPrices();
    } catch (error) {
      // Error handled by store
    }
  };

  const handleRebuild = async () => {
    if (!confirm('确定要重新构建历史每日数据吗？这将清空所有现有的历史快照数据，并从最早的交易日期开始重新计算。此操作可能需要较长时间。')) {
      return;
    }
    try {
      await rebuildHistoricalData();
      alert('历史每日数据重新构建完成！');
    } catch (error) {
      // Error handled by store
    }
  };

  const handleExport = () => {
    window.open(transactionApi.getExportUrl(), '_blank');
  };

  return (
    <header className="sticky top-0 z-50 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-500 rounded-xl flex items-center justify-center shadow-lg">
              <TrendingUp className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100 tracking-tight">
                Portfolio Guard
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">私密投资仪表盘</p>
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* 刷新频率指示 */}
            {refreshInterval !== 'manual' && (
              <span className="hidden sm:inline text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                自动刷新: {refreshInterval}
              </span>
            )}

            {/* 刷新行情 */}
            <button
              onClick={handleRefresh}
              disabled={isRefreshingPrices}
              className="px-3 py-2 rounded-lg font-medium transition-all bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 flex items-center gap-2"
              title="刷新行情"
            >
              <RefreshCw 
                className={`w-4 h-4 ${isRefreshingPrices ? 'animate-spin' : ''}`} 
              />
              <span className="hidden sm:inline">刷新行情</span>
            </button>

            {/* 重新构建历史数据 */}
            <button
              onClick={handleRebuild}
              disabled={isRebuildingSnapshots}
              className="px-3 py-2 rounded-lg font-medium transition-all bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-800 hover:bg-orange-200 dark:hover:bg-orange-900/50 disabled:opacity-50 flex items-center gap-2"
              title="重新构建历史每日数据"
            >
              <RotateCcw 
                className={`w-4 h-4 ${isRebuildingSnapshots ? 'animate-spin' : ''}`} 
              />
              <span className="hidden sm:inline">重建历史</span>
            </button>

            {/* 导出 */}
            <button
              onClick={handleExport}
              className="px-3 py-2 rounded-lg font-medium transition-all bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center gap-2"
              title="导出交易记录"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">导出</span>
            </button>

            {/* 新建交易 */}
            <button
              onClick={() => openTransactionForm('buy')}
              className="px-4 py-2 rounded-lg font-medium transition-all bg-blue-500 hover:bg-blue-600 text-white flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>新建交易</span>
            </button>

            {/* 主题切换 */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg transition-all bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700"
              title="切换主题"
            >
              {theme === 'dark' ? (
                <Sun className="w-5 h-5 text-amber-400" />
              ) : (
                <Moon className="w-5 h-5 text-blue-500" />
              )}
            </button>

            {/* 设置 */}
            <button
              onClick={openSettings}
              className="p-2 rounded-lg transition-all bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700"
              title="设置"
            >
              <Settings className="w-5 h-5 text-slate-500 dark:text-slate-400" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;
