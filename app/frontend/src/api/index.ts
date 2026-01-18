import type {
  ApiResponse,
  Transaction,
  CreateTransactionRequest,
  UpdateTransactionRequest,
  TransactionQuery,
  Holding,
  PortfolioOverview,
  DailySnapshot,
  NetValuePoint,
  RefreshPricesRequest,
  QuoteData,
  CashAccount,
  CreateCashAccountRequest,
  UpdateCashAccountRequest,
  Account,
  CreateAccountRequest,
  UpdateAccountRequest,
  Target,
  CreateTargetRequest,
  UpdateTargetRequest,
} from '../../../shared/types';

const API_BASE = '/api';

async function request<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  // 只有当有 body 或者是 POST/PUT/PATCH 请求时才设置 Content-Type
  const hasBody = options?.body !== undefined;
  const isMethodWithBody = options?.method && ['POST', 'PUT', 'PATCH'].includes(options.method);
  
  const headers: HeadersInit = {};
  if (hasBody || isMethodWithBody) {
    headers['Content-Type'] = 'application/json';
  }
  
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      ...headers,
      ...options?.headers,
    },
    ...options,
    // 如果是 POST/PUT/PATCH 但没有 body，发送空对象
    body: options?.body !== undefined 
      ? options.body 
      : (isMethodWithBody && !hasBody ? JSON.stringify({}) : undefined),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `请求失败: ${response.status}`);
  }

  return data.data;
}

// ==================== 交易 API ====================

export const transactionApi = {
  /**
   * 创建交易
   */
  async create(data: CreateTransactionRequest): Promise<{ transaction: Transaction; holding: Holding }> {
    return request('/transactions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * 查询交易列表
   */
  async list(params?: TransactionQuery): Promise<{ items: Transaction[]; total: number }> {
    const searchParams = new URLSearchParams();
    if (params?.account_ids && params.account_ids.length > 0) {
      searchParams.set('account_ids', params.account_ids.join(','));
    }
    if (params?.symbol) searchParams.set('symbol', params.symbol);
    if (params?.type) searchParams.set('type', params.type);
    if (params?.from) searchParams.set('from', params.from);
    if (params?.to) searchParams.set('to', params.to);
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.offset) searchParams.set('offset', String(params.offset));

    const query = searchParams.toString();
    return request(`/transactions${query ? `?${query}` : ''}`);
  },

  /**
   * 更新交易
   */
  async update(id: number, data: UpdateTransactionRequest): Promise<{ transaction: Transaction; holding: Holding }> {
    return request(`/transactions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  /**
   * 删除交易
   */
  async delete(id: number): Promise<void> {
    await request(`/transactions/${id}`, {
      method: 'DELETE',
    });
  },

  /**
   * 导出 CSV
   */
  getExportUrl(): string {
    return `${API_BASE}/export/transactions.csv`;
  },
};

// ==================== 持仓 API ====================

export const holdingApi = {
  /**
   * 获取所有持仓
   */
  async list(accountIds?: number[]): Promise<(Holding & { market_value: number; unrealized_pnl: number; unrealized_pnl_pct: number; weight: number })[]> {
    const searchParams = new URLSearchParams();
    if (accountIds && accountIds.length > 0) {
      searchParams.set('account_ids', accountIds.join(','));
    }
    const query = searchParams.toString();
    return request(`/holdings${query ? `?${query}` : ''}`);
  },

  /**
   * 获取持仓分布
   */
  async distribution(accountIds?: number[]): Promise<{ name: string; value: number; symbol: string }[]> {
    const searchParams = new URLSearchParams();
    if (accountIds && accountIds.length > 0) {
      searchParams.set('account_ids', accountIds.join(','));
    }
    const query = searchParams.toString();
    return request(`/holdings/distribution${query ? `?${query}` : ''}`);
  },
};

// ==================== 行情 API ====================

export const marketApi = {
  /**
   * 刷新价格
   */
  async refreshPrices(params?: RefreshPricesRequest): Promise<{ updated: number; failed: string[] }> {
    return request('/refresh-prices', {
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  },

  /**
   * 获取单个股票行情
   */
  async getQuote(symbol: string): Promise<QuoteData | null> {
    return request(`/quote/${symbol}`);
  },
};

// ==================== 分析 API ====================

export const analyticsApi = {
  /**
   * 获取总览
   */
  async getOverview(accountIds?: number[]): Promise<PortfolioOverview> {
    const searchParams = new URLSearchParams();
    if (accountIds && accountIds.length > 0) {
      searchParams.set('account_ids', accountIds.join(','));
    }
    const query = searchParams.toString();
    return request(`/analytics/overview${query ? `?${query}` : ''}`);
  },

  /**
   * 获取第一条记录的日期
   */
  async getFirstRecordDate(): Promise<string | null> {
    return request('/analytics/first-record-date');
  },

  /**
   * 获取净值曲线
   * 添加时间戳参数确保每次请求都获取最新数据（避免浏览器缓存）
   */
  async getSnapshots(from?: string, to?: string, accountIds?: number[]): Promise<NetValuePoint[]> {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (accountIds && accountIds.length > 0) {
      params.set('account_ids', accountIds.join(','));
    }
    // 添加时间戳确保每次都是新请求，避免缓存
    params.set('_t', Date.now().toString());
    const query = params.toString();
    return request(`/analytics/snapshots${query ? `?${query}` : ''}`);
  },

  /**
   * 获取对比数据
   */
  async getComparison(from?: string, to?: string, index?: string): Promise<{
    portfolio: NetValuePoint[];
    index: { date: string; value: number; change_pct: number }[];
  }> {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (index) params.set('index', index);
    const query = params.toString();
    return request(`/analytics/comparison${query ? `?${query}` : ''}`);
  },

  /**
   * 获取收益统计
   */
  async getStats(from?: string, to?: string): Promise<{
    totalReturn: number;
    totalReturnPct: number;
    maxDrawdown: number;
    volatility: number;
    sharpeRatio: number;
  }> {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const query = params.toString();
    return request(`/analytics/stats${query ? `?${query}` : ''}`);
  },
};

// ==================== 快照 API ====================

export const snapshotApi = {
  /**
   * 重新构建历史每日数据
   */
  async rebuild(): Promise<{ firstRecordDate: string | null; rebuilt: boolean }> {
    return request('/snapshots/rebuild', {
      method: 'POST',
    });
  },
};

// ==================== 设置 API ====================

export const settingsApi = {
  /**
   * 获取设置
   */
  async get(): Promise<Record<string, string>> {
    return request('/settings');
  },

  /**
   * 更新设置
   */
  async update(settings: Record<string, string>): Promise<void> {
    await request('/settings', {
      method: 'POST',
      body: JSON.stringify(settings),
    });
  },
};

// ==================== 现金账户 API ====================

// ==================== 账户 API ====================

export const accountApi = {
  /**
   * 获取所有账户
   */
  async list(): Promise<Account[]> {
    return request('/accounts');
  },

  /**
   * 创建账户
   */
  async create(data: CreateAccountRequest): Promise<Account> {
    return request('/accounts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * 更新账户
   */
  async update(id: number, data: UpdateAccountRequest): Promise<Account> {
    return request(`/accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  /**
   * 删除账户
   */
  async delete(id: number): Promise<void> {
    await request(`/accounts/${id}`, {
      method: 'DELETE',
    });
  },
};

// ==================== 现金账户 API ====================

export const cashAccountApi = {
  /**
   * 获取所有现金账户
   */
  async list(accountIds?: number[]): Promise<CashAccount[]> {
    const searchParams = new URLSearchParams();
    if (accountIds && accountIds.length > 0) {
      searchParams.set('account_ids', accountIds.join(','));
    }
    const query = searchParams.toString();
    return request(`/cash-accounts${query ? `?${query}` : ''}`);
  },

  /**
   * 创建现金账户
   */
  async create(data: CreateCashAccountRequest): Promise<CashAccount> {
    return request('/cash-accounts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * 更新现金账户
   */
  async update(id: number, data: UpdateCashAccountRequest): Promise<CashAccount> {
    return request(`/cash-accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  /**
   * 删除现金账户
   */
  async delete(id: number): Promise<void> {
    await request(`/cash-accounts/${id}`, {
      method: 'DELETE',
    });
  },
};

// ==================== 投资目标 API ====================

export const targetApi = {
  /**
   * 获取所有目标
   */
  async list(): Promise<Target[]> {
    return request('/targets');
  },

  /**
   * 获取单个目标
   */
  async get(id: number): Promise<Target> {
    return request(`/targets/${id}`);
  },

  /**
   * 创建目标
   */
  async create(data: CreateTargetRequest): Promise<Target> {
    return request('/targets', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * 更新目标
   */
  async update(id: number, data: UpdateTargetRequest): Promise<Target> {
    return request(`/targets/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  /**
   * 删除目标
   */
  async delete(id: number): Promise<void> {
    await request(`/targets/${id}`, {
      method: 'DELETE',
    });
  },
};

// ==================== 导出/导入 API ====================

export const exportImportApi = {
  /**
   * 导出所有数据
   */
  async exportAll(): Promise<{
    accounts: string;
    transactions: string;
    cash_accounts: string;
    targets: string;
    metadata: {
      export_date: string;
      version: string;
    };
  }> {
    const response = await fetch(`${API_BASE}/export/all`);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `导出失败: ${response.status}`);
    }
    return data.data;
  },

  /**
   * 导出单个CSV文件
   */
  getExportUrl(type: 'accounts' | 'transactions' | 'cash_accounts' | 'targets'): string {
    return `${API_BASE}/export/${type}`;
  },

  /**
   * 导入数据
   */
  async import(data: {
    accounts?: string;
    transactions?: string;
    cash_accounts?: string;
    targets?: string;
    options?: {
      skipExisting?: boolean;
      recalculateSnapshots?: boolean;
    };
  }): Promise<{
    accounts: { success: number; errors: Array<{ row: number; error: string }> };
    transactions: { success: number; errors: Array<{ row: number; error: string }> };
    cash_accounts: { success: number; errors: Array<{ row: number; error: string }> };
    targets: { success: number; errors: Array<{ row: number; error: string }> };
  }> {
    return request('/import', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};

// ==================== 健康检查 ====================

export const healthApi = {
  async check(): Promise<{ status: string; timestamp: string }> {
    return request('/health');
  },
};

export default {
  account: accountApi,
  transaction: transactionApi,
  holding: holdingApi,
  market: marketApi,
  analytics: analyticsApi,
  snapshot: snapshotApi,
  cashAccount: cashAccountApi,
  target: targetApi,
  settings: settingsApi,
  exportImport: exportImportApi,
  health: healthApi,
};

