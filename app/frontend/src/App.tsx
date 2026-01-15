import { useEffect, useState } from 'react';
import { usePortfolioStore, useSettingsStore, useUIStore } from './store';
import Header from './components/Header';
import OverviewCards from './components/OverviewCards';
import HoldingsTable from './components/HoldingsTable';
import PieChart from './components/PieChart';
import NetValueChart from './components/NetValueChart';
import TransactionForm from './components/TransactionForm';
import TransactionList from './components/TransactionList';
import CashAccounts from './components/CashAccounts';
import AccountManager from './components/AccountManager';
import SettingsModal from './components/SettingsModal';
import Toast from './components/Toast';

function App() {
  const { refreshAll, error, clearError, isRefreshingPrices } = usePortfolioStore();
  const { fetchSettings, theme, refreshInterval } = useSettingsStore();
  const { isTransactionFormOpen, isSettingsOpen, selectedAccountIds } = useUIStore();
  const [isInitialized, setIsInitialized] = useState(false);

  // 初始化加载
  useEffect(() => {
    const init = async () => {
      await fetchSettings();
      // 不加载图表数据，让应用先进入，图表数据在 NetValueChart 组件中异步加载
      await Promise.all([
        usePortfolioStore.getState().fetchHoldings(),
        usePortfolioStore.getState().fetchOverview(),
        usePortfolioStore.getState().fetchTransactions(),
        usePortfolioStore.getState().fetchDistribution(),
      ]);
      setIsInitialized(true);
    };
    init();
  }, []);

  // 主题切换
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // 监听账户筛选变化，自动刷新数据
  useEffect(() => {
    if (isInitialized) {
      refreshAll().catch(console.error);
    }
  }, [selectedAccountIds, isInitialized, refreshAll]);

  // 自动刷新逻辑
  useEffect(() => {
    // 如果设置为手动刷新，不启动自动刷新
    if (refreshInterval === 'manual') {
      return;
    }

    // 解析刷新间隔（秒）
    let intervalSeconds = 60; // 默认60秒
    if (refreshInterval === '5s') {
      intervalSeconds = 5;
    } else if (refreshInterval === '30s') {
      intervalSeconds = 30;
    } else if (refreshInterval === '60s') {
      intervalSeconds = 60;
    } else if (refreshInterval === 'custom') {
      // 自定义间隔需要从设置中获取，这里暂时使用60秒
      intervalSeconds = 60;
    }

    // 设置定时器
    const interval = setInterval(() => {
      // 自动刷新价格和总览
      refreshAll().catch((error) => {
        console.warn('自动刷新失败:', error);
      });
    }, intervalSeconds * 1000);

    // 清理函数
    return () => {
      clearInterval(interval);
    };
  }, [refreshInterval, refreshAll]);

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-900">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-slate-500 dark:text-slate-400">正在加载...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-8 bg-slate-100 dark:bg-slate-900">
      {/* 顶部导航 */}
      <Header />

      {/* 主内容区 */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* 总览卡片 */}
        <OverviewCards />

        {/* 账户管理 */}
        <AccountManager />

        {/* 图表区域 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* 持仓表格 */}
          <div className="lg:col-span-2">
            <HoldingsTable />
          </div>

          {/* 饼图 */}
          <div>
            <PieChart />
          </div>
        </div>

        {/* 净值曲线 */}
        <NetValueChart />

        {/* 现金账户 */}
        <CashAccounts />

        {/* 交易记录 */}
        <TransactionList />
      </main>

      {/* 交易表单弹窗 */}
      {isTransactionFormOpen && <TransactionForm />}

      {/* 设置弹窗 */}
      {isSettingsOpen && <SettingsModal />}

      {/* Toast 提示 */}
      {error && (
        <Toast 
          message={error} 
          type="error" 
          onClose={clearError}
        />
      )}

      {/* 刷新中提示 */}
      {isRefreshingPrices && (
        <div className="fixed bottom-6 left-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 flex items-center gap-3 shadow-lg animate-fade-in">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-slate-500 dark:text-slate-400">正在刷新行情...</span>
        </div>
      )}
    </div>
  );
}

export default App;
