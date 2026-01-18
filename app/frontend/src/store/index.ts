import { create } from 'zustand';
import type {
  Transaction,
  Holding,
  PortfolioOverview,
  NetValuePoint,
  CreateTransactionRequest,
  UpdateTransactionRequest,
} from '../../../shared/types';
import { transactionApi, holdingApi, analyticsApi, marketApi, snapshotApi, settingsApi } from '../api';

// ==================== Portfolio Store ====================

interface PortfolioState {
  // 数据
  holdings: (Holding & { market_value: number; unrealized_pnl: number; unrealized_pnl_pct: number; weight: number })[];
  overview: PortfolioOverview | null;
  transactions: Transaction[];
  transactionsTotal: number;
  netValueCurve: NetValuePoint[];
  distribution: { name: string; value: number; symbol: string }[];

  // 加载状态
  isLoadingHoldings: boolean;
  isLoadingOverview: boolean;
  isLoadingTransactions: boolean;
  isLoadingChart: boolean;
  isRefreshingPrices: boolean;
  isRebuildingSnapshots: boolean;

  // 错误
  error: string | null;

  // Actions
  fetchHoldings: () => Promise<void>;
  fetchOverview: () => Promise<void>;
  fetchTransactions: (page?: number, limit?: number) => Promise<void>;
  fetchNetValueCurve: (from?: string, to?: string) => Promise<void>;
  fetchDistribution: () => Promise<void>;
  createTransaction: (data: CreateTransactionRequest) => Promise<void>;
  updateTransaction: (id: number, data: UpdateTransactionRequest) => Promise<void>;
  deleteTransaction: (id: number) => Promise<void>;
  refreshPrices: () => Promise<{ updated: number; failed: string[] }>;
  rebuildHistoricalData: () => Promise<void>;
  refreshAll: () => Promise<void>;
  clearError: () => void;
}

export const usePortfolioStore = create<PortfolioState>((set, get) => ({
  // 初始状态
  holdings: [],
  overview: null,
  transactions: [],
  transactionsTotal: 0,
  netValueCurve: [],
  distribution: [],

  isLoadingHoldings: false,
  isLoadingOverview: false,
  isLoadingTransactions: false,
  isLoadingChart: false,
  isRefreshingPrices: false,
  isRebuildingSnapshots: false,

  error: null,

  // Actions
  fetchHoldings: async () => {
    set({ isLoadingHoldings: true, error: null });
    try {
      const accountIds = useUIStore.getState().selectedAccountIds;
      const holdings = await holdingApi.list(accountIds.length > 0 ? accountIds : undefined);
      set({ holdings, isLoadingHoldings: false });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : '获取持仓失败', 
        isLoadingHoldings: false 
      });
    }
  },

  fetchOverview: async () => {
    set({ isLoadingOverview: true, error: null });
    try {
      const accountIds = useUIStore.getState().selectedAccountIds;
      const overview = await analyticsApi.getOverview(accountIds.length > 0 ? accountIds : undefined);
      set({ overview, isLoadingOverview: false });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : '获取总览失败', 
        isLoadingOverview: false 
      });
    }
  },

  fetchTransactions: async (page = 1, limit = 20) => {
    set({ isLoadingTransactions: true, error: null });
    try {
      const offset = (page - 1) * limit;
      const accountIds = useUIStore.getState().selectedAccountIds;
      const result = await transactionApi.list({ 
        limit, 
        offset,
        account_ids: accountIds.length > 0 ? accountIds : undefined
      });
      set({ 
        transactions: result.items, 
        transactionsTotal: result.total,
        isLoadingTransactions: false 
      });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : '获取交易记录失败', 
        isLoadingTransactions: false 
      });
    }
  },

  fetchNetValueCurve: async (from?: string, to?: string) => {
    set({ isLoadingChart: true, error: null });
    try {
      const accountIds = useUIStore.getState().selectedAccountIds;
      const curve = await analyticsApi.getSnapshots(from, to, accountIds.length > 0 ? accountIds : undefined);
      set({ netValueCurve: curve, isLoadingChart: false });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : '获取净值曲线失败', 
        isLoadingChart: false 
      });
    }
  },

  fetchDistribution: async () => {
    try {
      const accountIds = useUIStore.getState().selectedAccountIds;
      const distribution = await holdingApi.distribution(accountIds.length > 0 ? accountIds : undefined);
      set({ distribution });
    } catch (error) {
      // 静默失败，不影响主流程
      set({ error: error instanceof Error ? error.message : '获取持仓分布失败' });
    }
  },

  createTransaction: async (data: CreateTransactionRequest) => {
    try {
      await transactionApi.create(data);
      // 刷新所有数据，包括净值曲线
      // 先刷新基础数据
      await Promise.all([
        get().fetchHoldings(),
        get().fetchOverview(),
        get().fetchTransactions(),
        get().fetchDistribution(),
      ]);
      // 强制清空净值曲线数据，触发完全重新加载
      set({ netValueCurve: [] });
      // 触发净值曲线重新加载（组件会使用当前时间范围）
      // 通过设置一个刷新标志来强制组件重新加载
      const state = get();
      if (state.fetchNetValueCurve) {
        // 组件会监听交易变化并自动刷新，但为了确保，我们也触发一次
        // 组件中的 useEffect 会处理实际的刷新
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '创建交易失败';
      set({ error: message });
      throw error;
    }
  },

  updateTransaction: async (id: number, data: UpdateTransactionRequest) => {
    try {
      await transactionApi.update(id, data);
      // 刷新所有数据，包括净值曲线
      // 先刷新基础数据
      await Promise.all([
        get().fetchHoldings(),
        get().fetchOverview(),
        get().fetchTransactions(),
        get().fetchDistribution(),
      ]);
      // 强制清空净值曲线数据，触发完全重新加载
      set({ netValueCurve: [] });
      // 触发净值曲线重新加载（组件会使用当前时间范围）
      // 组件中的 useEffect 会监听交易变化并自动刷新
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新交易失败';
      set({ error: message });
      throw error;
    }
  },

  deleteTransaction: async (id: number) => {
    try {
      await transactionApi.delete(id);
      // 刷新所有数据，包括净值曲线
      // 先刷新基础数据
      await Promise.all([
        get().fetchHoldings(),
        get().fetchOverview(),
        get().fetchTransactions(),
        get().fetchDistribution(),
      ]);
      // 强制清空净值曲线数据，触发完全重新加载
      set({ netValueCurve: [] });
      // 触发净值曲线重新加载（组件会使用当前时间范围）
      // 组件中的 useEffect 会监听交易变化并自动刷新
    } catch (error) {
      const message = error instanceof Error ? error.message : '删除交易失败';
      set({ error: message });
      throw error;
    }
  },

  refreshPrices: async () => {
    set({ isRefreshingPrices: true, error: null });
    try {
      const result = await marketApi.refreshPrices();
      // 刷新数据
      await Promise.all([
        get().fetchHoldings(),
        get().fetchOverview(),
        get().fetchDistribution(),
      ]);
      set({ isRefreshingPrices: false });
      return result;
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : '刷新价格失败', 
        isRefreshingPrices: false 
      });
      throw error;
    }
  },

  rebuildHistoricalData: async () => {
    set({ isRebuildingSnapshots: true, error: null });
    try {
      await snapshotApi.rebuild();
      // 重建完成后，刷新所有相关数据
      await Promise.all([
        get().fetchNetValueCurve(),
        get().fetchOverview(),
        get().fetchHoldings(),
        get().fetchDistribution(),
      ]);
      set({ isRebuildingSnapshots: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : '重新构建历史数据失败';
      set({ 
        error: message,
        isRebuildingSnapshots: false 
      });
      throw error;
    }
  },

  refreshAll: async () => {
    await Promise.all([
      get().fetchHoldings(),
      get().fetchOverview(),
      get().fetchTransactions(),
      get().fetchDistribution(),
      get().fetchNetValueCurve(),
    ]);
  },

  clearError: () => set({ error: null }),
}));

// ==================== Settings Store ====================

interface SettingsState {
  theme: 'light' | 'dark';
  refreshInterval: string;
  baseCurrency: string;
  defaultProvider: 'yahoo' | 'tushare';
  isLoading: boolean;

  // Actions
  fetchSettings: () => Promise<void>;
  setTheme: (theme: 'light' | 'dark') => void;
  setRefreshInterval: (interval: string) => void;
  setBaseCurrency: (currency: string) => void;
  saveSettings: () => Promise<void>;
  toggleTheme: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  theme: 'light',
  refreshInterval: '60s', // 默认60秒自动刷新
  baseCurrency: 'USD',
  defaultProvider: 'yahoo',
  isLoading: false,

  fetchSettings: async () => {
    set({ isLoading: true });
    try {
      const settings = await settingsApi.get();
      set({
        theme: (settings.theme as 'light' | 'dark') || 'light',
        refreshInterval: settings.refresh_interval || '60s', // 默认60秒
        baseCurrency: settings.base_currency || 'USD',
        defaultProvider: (settings.default_provider as 'yahoo' | 'tushare') || 'yahoo',
        isLoading: false,
      });
    } catch (error) {
      // 设置加载失败不影响应用运行，使用默认值
      set({ isLoading: false });
    }
  },

  setTheme: (theme) => set({ theme }),
  setRefreshInterval: (refreshInterval) => set({ refreshInterval }),
  setBaseCurrency: (baseCurrency) => set({ baseCurrency }),

  saveSettings: async () => {
    const { theme, refreshInterval, baseCurrency, defaultProvider } = get();
    try {
      await settingsApi.update({
        theme,
        refresh_interval: refreshInterval,
        base_currency: baseCurrency,
        default_provider: defaultProvider,
      });
    } catch (error) {
      // 保存设置失败时抛出错误，让调用方处理
      throw error;
    }
  },

  toggleTheme: () => {
    const current = get().theme;
    const next = current === 'dark' ? 'light' : 'dark';
    set({ theme: next });
    // 立即保存（静默失败，不影响UI切换）
    settingsApi.update({ theme: next }).catch(() => {
      // 静默失败
    });
  },
}));

// ==================== UI Store ====================

interface UIState {
  isTransactionFormOpen: boolean;
  transactionFormType: 'buy' | 'sell';
  isSettingsOpen: boolean;
  isExportImportOpen: boolean;
  selectedSymbol: string | null;
  selectedAccountIds: number[]; // 选中的账户ID列表，空数组表示所有账户

  // Actions
  openTransactionForm: (type?: 'buy' | 'sell') => void;
  closeTransactionForm: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  openExportImport: () => void;
  closeExportImport: () => void;
  selectSymbol: (symbol: string | null) => void;
  setSelectedAccountIds: (accountIds: number[]) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isTransactionFormOpen: false,
  transactionFormType: 'buy',
  isSettingsOpen: false,
  isExportImportOpen: false,
  selectedSymbol: null,
  selectedAccountIds: [], // 空数组表示所有账户

  openTransactionForm: (type = 'buy') => set({ isTransactionFormOpen: true, transactionFormType: type }),
  closeTransactionForm: () => set({ isTransactionFormOpen: false }),
  openSettings: () => set({ isSettingsOpen: true }),
  closeSettings: () => set({ isSettingsOpen: false }),
  openExportImport: () => set({ isExportImportOpen: true }),
  closeExportImport: () => set({ isExportImportOpen: false }),
  selectSymbol: (symbol) => set({ selectedSymbol: symbol }),
  setSelectedAccountIds: (accountIds) => {
    set({ selectedAccountIds: accountIds });
    // 当账户筛选改变时，自动刷新数据（延迟执行以避免循环依赖）
    setTimeout(() => {
      const portfolioStore = usePortfolioStore.getState();
      Promise.all([
        portfolioStore.fetchHoldings(),
        portfolioStore.fetchOverview(),
        portfolioStore.fetchTransactions(1, 10),
        portfolioStore.fetchDistribution(),
        portfolioStore.fetchNetValueCurve(),
      ]).catch(console.error);
    }, 0);
  },
}));
