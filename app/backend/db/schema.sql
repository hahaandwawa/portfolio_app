-- Portfolio Guard 数据库 Schema
-- SQLite 数据库设计

-- 账户表
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_name TEXT NOT NULL UNIQUE,
    account_type TEXT NOT NULL CHECK(account_type IN ('stock', 'cash', 'mixed')),
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 交易记录表
CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    name TEXT,
    type TEXT NOT NULL CHECK(type IN ('buy', 'sell')),
    price REAL NOT NULL CHECK(price > 0),
    quantity REAL NOT NULL CHECK(quantity > 0),
    fee REAL DEFAULT 0 CHECK(fee >= 0),
    currency TEXT DEFAULT 'USD',
    trade_date TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT
);

-- 持仓表（同一只股票可以在不同账户中持有）
CREATE TABLE IF NOT EXISTS holdings (
    symbol TEXT NOT NULL,
    account_id INTEGER NOT NULL,
    name TEXT,
    avg_cost REAL NOT NULL CHECK(avg_cost >= 0),
    total_qty REAL NOT NULL CHECK(total_qty >= 0),
    last_price REAL DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    updated_at TEXT,
    PRIMARY KEY (symbol, account_id),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT
);

-- 原始快照表（存储每次生成的快照，用于计算每日均值）
CREATE TABLE IF NOT EXISTS raw_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    total_market_value REAL NOT NULL,
    cash_balance REAL DEFAULT 0,
    base_currency TEXT DEFAULT 'USD',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 每日快照表（用于净值曲线，存储每日的平均值）
CREATE TABLE IF NOT EXISTS daily_snapshots (
    date TEXT PRIMARY KEY,
    total_market_value REAL NOT NULL,
    cash_balance REAL DEFAULT 0,
    base_currency TEXT DEFAULT 'USD',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 汇率表（可选，用于多币种支持）
CREATE TABLE IF NOT EXISTS fx_rates (
    base TEXT NOT NULL,
    quote TEXT NOT NULL,
    rate REAL NOT NULL,
    as_of TEXT NOT NULL,
    PRIMARY KEY(base, quote)
);

-- 现金账户表（关联到账户表）
CREATE TABLE IF NOT EXISTS cash_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    account_name TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT
);

-- 应用设置表
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 投资目标表
CREATE TABLE IF NOT EXISTS targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    target_amount REAL NOT NULL CHECK(target_amount > 0),
    scope_type TEXT NOT NULL CHECK(scope_type IN ('ALL', 'ACCOUNT')),
    account_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    -- 唯一性约束：同一个 symbol + scope_type + account_id 只能有一个目标
    UNIQUE(symbol, scope_type, account_id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_symbol ON transactions(symbol);
CREATE INDEX IF NOT EXISTS idx_transactions_trade_date ON transactions(trade_date);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_holdings_account_id ON holdings(account_id);
CREATE INDEX IF NOT EXISTS idx_holdings_symbol ON holdings(symbol);
CREATE INDEX IF NOT EXISTS idx_daily_snapshots_date ON daily_snapshots(date);
CREATE INDEX IF NOT EXISTS idx_raw_snapshots_date ON raw_snapshots(date);
CREATE INDEX IF NOT EXISTS idx_raw_snapshots_timestamp ON raw_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_cash_accounts_account_id ON cash_accounts(account_id);
CREATE INDEX IF NOT EXISTS idx_cash_accounts_account_name ON cash_accounts(account_name);
CREATE INDEX IF NOT EXISTS idx_targets_symbol ON targets(symbol);
CREATE INDEX IF NOT EXISTS idx_targets_scope_type ON targets(scope_type);
CREATE INDEX IF NOT EXISTS idx_targets_account_id ON targets(account_id);

-- 视图：持仓详情（含计算字段）
CREATE VIEW IF NOT EXISTS v_positions AS
SELECT 
    h.symbol,
    h.account_id,
    h.name,
    h.avg_cost,
    h.total_qty,
    h.last_price,
    h.currency,
    h.updated_at,
    (h.total_qty * h.last_price) AS market_value,
    (h.total_qty * (h.last_price - h.avg_cost)) AS unrealized_pnl,
    CASE 
        WHEN h.avg_cost > 0 THEN ((h.last_price - h.avg_cost) / h.avg_cost * 100)
        ELSE 0 
    END AS unrealized_pnl_pct
FROM holdings h
WHERE h.total_qty > 0;

-- 视图：每日盈亏（净值变化）
CREATE VIEW IF NOT EXISTS v_pnl_daily AS
SELECT 
    s1.date,
    s1.total_market_value,
    s1.cash_balance,
    (s1.total_market_value + s1.cash_balance) AS total_asset,
    COALESCE(
        (s1.total_market_value + s1.cash_balance) - 
        (s2.total_market_value + s2.cash_balance),
        0
    ) AS daily_pnl,
    CASE 
        WHEN (s2.total_market_value + s2.cash_balance) > 0 THEN
            ((s1.total_market_value + s1.cash_balance) - (s2.total_market_value + s2.cash_balance)) 
            / (s2.total_market_value + s2.cash_balance) * 100
        ELSE 0 
    END AS daily_pnl_pct
FROM daily_snapshots s1
LEFT JOIN daily_snapshots s2 ON date(s1.date, '-1 day') = s2.date
ORDER BY s1.date;

-- 初始化默认设置
INSERT OR IGNORE INTO settings (key, value) VALUES 
    ('refresh_interval', '60s'),
    ('base_currency', 'USD'),
    ('default_provider', 'yahoo'),
    ('theme', 'dark');

-- 创建默认账户（如果不存在）
INSERT OR IGNORE INTO accounts (id, account_name, account_type) VALUES 
    (1, '默认账户', 'mixed');
