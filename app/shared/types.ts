// 交易类型
export type TransactionType = 'buy' | 'sell';

// 账户类型
export type AccountType = 'stock' | 'cash' | 'mixed';

// 账户
export interface Account {
  id: number;
  account_name: string;
  account_type: AccountType;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// 创建账户请求
export interface CreateAccountRequest {
  account_name: string;
  account_type: AccountType;
  notes?: string;
}

// 更新账户请求
export interface UpdateAccountRequest {
  account_name?: string;
  account_type?: AccountType;
  notes?: string;
}

// 交易记录
export interface Transaction {
  id: number;
  account_id: number;
  symbol: string;
  name: string | null;
  type: TransactionType;
  price: number;
  quantity: number;
  fee: number;
  currency: string;
  trade_date: string;
  created_at: string;
}

// 创建交易请求
export interface CreateTransactionRequest {
  account_id: number;
  symbol: string;
  name?: string;
  type: TransactionType;
  price: number;
  quantity: number;
  fee?: number;
  currency?: string;
  trade_date: string;
}

// 更新交易请求
export interface UpdateTransactionRequest {
  account_id?: number;
  symbol?: string;
  name?: string;
  type?: TransactionType;
  price?: number;
  quantity?: number;
  fee?: number;
  currency?: string;
  trade_date?: string;
}

// 持仓
export interface Holding {
  symbol: string;
  account_id: number;
  name: string | null;
  avg_cost: number;
  total_qty: number;
  last_price: number;
  currency: string;
  updated_at: string | null;
  // 计算字段
  market_value?: number;
  unrealized_pnl?: number;
  unrealized_pnl_pct?: number;
  weight?: number;
}

// 每日快照
export interface DailySnapshot {
  date: string;
  total_market_value: number;
  cash_balance: number;
  base_currency: string;
  created_at: string;
}

// 汇率
export interface FxRate {
  base: string;
  quote: string;
  rate: number;
  as_of: string;
}

// 总览数据
export interface PortfolioOverview {
  total_asset: number;
  total_cost: number;
  total_pnl: number;
  total_pnl_pct: number;
  today_pnl: number;
  today_pnl_pct: number;
  base_currency: string;
  cash: number;
  holdings_count: number;
  today_pnl_status?: string; // 今日盈亏状态标注，如"已闭市"、"休息日"、"法定节假日"等
}

// 设置
export interface AppSettings {
  refresh_interval: 'manual' | '5s' | '30s' | '60s' | 'custom';
  custom_interval_seconds?: number;
  base_currency: string;
  default_provider: 'yahoo' | 'tushare';
  theme: 'light' | 'dark' | 'system';
}

// API 响应
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: number;
}

// 分页
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// 净值曲线数据点
export interface NetValuePoint {
  date: string;
  value: number; // 总资产（股票 + 现金）
  cost: number; // 累计净投入（成本）
  pnl_pct: number;
  stock_value?: number; // 股票市值
  cash_value?: number; // 现金余额
  stock_pnl_pct?: number; // 股票盈亏百分比
  cash_pnl_pct?: number; // 现金盈亏百分比（通常为0，除非有现金变化）
}

// 指数数据点
export interface IndexPoint {
  date: string;
  value: number;
  change_pct: number;
}

// 行情数据
export interface QuoteData {
  symbol: string;
  price: number;
  change: number;
  change_pct: number;
  volume?: number;
  timestamp: string;
}

// 刷新价格请求
export interface RefreshPricesRequest {
  symbols?: string[];
  provider?: 'yahoo' | 'tushare';
}

// 交易查询参数
export interface TransactionQuery {
  account_ids?: number[]; // 账户ID列表，为空则查询所有账户
  symbol?: string;
  type?: TransactionType;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

// 快照查询参数
export interface SnapshotQuery {
  account_ids?: number[]; // 账户ID列表，为空则查询所有账户
  from?: string;
  to?: string;
}

// 现金账户
export interface CashAccount {
  id: number;
  account_id: number; // 关联到accounts表
  account_name: string;
  amount: number;
  currency: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// 创建现金账户请求
export interface CreateCashAccountRequest {
  account_id: number; // 关联到accounts表
  account_name: string;
  amount: number;
  currency?: string;
  notes?: string;
}

// 更新现金账户请求
export interface UpdateCashAccountRequest {
  account_id?: number;
  account_name?: string;
  amount?: number;
  currency?: string;
  notes?: string;
}

