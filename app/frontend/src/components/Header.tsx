import { useState, useEffect } from 'react';
import { 
  RefreshCw, 
  Settings, 
  Plus, 
  Moon, 
  Sun, 
  Download,
  TrendingUp,
  RotateCcw,
  Filter
} from 'lucide-react';
import { usePortfolioStore, useSettingsStore, useUIStore } from '../store';
import { transactionApi, accountApi } from '../api';
import type { Account } from '../../../shared/types';

function Header() {
  const { 
    refreshPrices, 
    isRefreshingPrices, 
    rebuildHistoricalData,
    isRebuildingSnapshots
  } = usePortfolioStore();
  const { theme, toggleTheme, refreshInterval } = useSettingsStore();
  const { openTransactionForm, openSettings, selectedAccountIds, setSelectedAccountIds } = useUIStore();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isAccountFilterOpen, setIsAccountFilterOpen] = useState(false);

  // 加载账户列表
  useEffect(() => {
    accountApi.list().then(setAccounts).catch(console.error);
  }, []);

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

  const handleAccountFilterChange = (accountId: number, checked: boolean) => {
    let newSelectedIds: number[];
    
    if (selectedAccountIds.length === 0) {
      // 当前是"所有账户"状态，如果取消某个账户，则选中除了这个账户之外的所有账户
      if (!checked) {
        newSelectedIds = accounts.filter(acc => acc.id !== accountId).map(acc => acc.id);
      } else {
        // 这种情况不应该发生，因为"所有账户"时所有都是选中状态
        newSelectedIds = [accountId];
      }
    } else {
      // 当前是部分账户选中状态
      if (checked) {
        // 添加到选中列表
        newSelectedIds = [...selectedAccountIds, accountId];
      } else {
        // 从选中列表移除
        newSelectedIds = selectedAccountIds.filter(id => id !== accountId);
      }
    }
    
    setSelectedAccountIds(newSelectedIds);
  };

  const handleSelectAllAccounts = () => {
    setSelectedAccountIds([]); // 空数组表示所有账户
    setIsAccountFilterOpen(false);
  };

  const handleClearAccountFilter = () => {
    setSelectedAccountIds([]);
    setIsAccountFilterOpen(false);
  };

  // 判断账户是否被选中（空数组表示所有账户都被选中）
  const isAccountSelected = (accountId: number): boolean => {
    return selectedAccountIds.length === 0 || selectedAccountIds.includes(accountId);
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
            {/* 账户筛选器 */}
            <div className="relative">
              <button
                onClick={() => setIsAccountFilterOpen(!isAccountFilterOpen)}
                className={`px-3 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${
                  selectedAccountIds.length > 0
                    ? 'bg-blue-500 text-white hover:bg-blue-600'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
                title="筛选账户"
              >
                <Filter className="w-4 h-4" />
                <span className="hidden sm:inline">
                  {selectedAccountIds.length === 0
                    ? '所有账户'
                    : selectedAccountIds.length === 1
                    ? accounts.find(a => a.id === selectedAccountIds[0])?.account_name || '1个账户'
                    : `${selectedAccountIds.length}个账户`}
                </span>
              </button>

              {/* 账户筛选下拉菜单 */}
              {isAccountFilterOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsAccountFilterOpen(false)}
                  />
                  <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl z-50 max-h-96 overflow-y-auto">
                    <div className="p-3 border-b border-slate-200 dark:border-slate-700">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">筛选账户</h3>
                        <button
                          onClick={handleSelectAllAccounts}
                          className="text-xs text-blue-500 hover:text-blue-600"
                        >
                          全部
                        </button>
                      </div>
                      {selectedAccountIds.length > 0 && (
                        <button
                          onClick={handleClearAccountFilter}
                          className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                        >
                          清除筛选
                        </button>
                      )}
                    </div>
                    <div className="p-2">
                      {accounts.map(account => {
                        const isChecked = isAccountSelected(account.id);
                        return (
                          <label
                            key={account.id}
                            className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => handleAccountFilterChange(account.id, e.target.checked)}
                              className="w-4 h-4 text-blue-500 rounded focus:ring-blue-500"
                            />
                            <span className="text-sm text-slate-700 dark:text-slate-300">
                              {account.account_name}
                            </span>
                            <span className="text-xs text-slate-500 dark:text-slate-400 ml-auto">
                              {account.account_type === 'stock' ? '股票' : account.account_type === 'cash' ? '现金' : '混合'}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>

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
