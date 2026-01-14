import { query, queryOne, run, withTransaction } from './index.js';
import { getTodayET } from '../../shared/timeUtils.js';
import type {
  Transaction,
  CreateTransactionRequest,
  UpdateTransactionRequest,
  Holding,
  DailySnapshot,
  FxRate,
  TransactionQuery,
  CashAccount,
  CreateCashAccountRequest,
  UpdateCashAccountRequest,
} from '../../shared/types.js';

// ==================== 交易 DAO ====================

export const transactionDao = {
  /**
   * 创建交易记录
   */
  create(data: CreateTransactionRequest): Transaction {
    const result = run(
      `INSERT INTO transactions (symbol, name, type, price, quantity, fee, currency, trade_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.symbol.toUpperCase(),
        data.name || null,
        data.type,
        data.price,
        data.quantity,
        data.fee || 0,
        data.currency || 'USD',
        data.trade_date
      ]
    );

    return this.getById(result.lastInsertRowid)!;
  },

  /**
   * 根据 ID 获取交易
   */
  getById(id: number): Transaction | null {
    return queryOne<Transaction>('SELECT * FROM transactions WHERE id = ?', [id]);
  },

  /**
   * 更新交易记录
   */
  update(id: number, data: UpdateTransactionRequest): Transaction {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error('交易记录不存在');
    }

    // 构建更新字段
    const updates: string[] = [];
    const values: (string | number)[] = [];

    if (data.symbol !== undefined) {
      updates.push('symbol = ?');
      values.push(data.symbol.toUpperCase());
    }
    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name || null);
    }
    if (data.type !== undefined) {
      updates.push('type = ?');
      values.push(data.type);
    }
    if (data.price !== undefined) {
      updates.push('price = ?');
      values.push(data.price);
    }
    if (data.quantity !== undefined) {
      updates.push('quantity = ?');
      values.push(data.quantity);
    }
    if (data.fee !== undefined) {
      updates.push('fee = ?');
      values.push(data.fee);
    }
    if (data.currency !== undefined) {
      updates.push('currency = ?');
      values.push(data.currency);
    }
    if (data.trade_date !== undefined) {
      updates.push('trade_date = ?');
      values.push(data.trade_date);
    }

    if (updates.length === 0) {
      return existing;
    }

    values.push(id);
    const sql = `UPDATE transactions SET ${updates.join(', ')} WHERE id = ?`;
    const result = run(sql, values);
    
    // 确认数据库写入是否成功
    if (result.changes === 0) {
      throw new Error(`更新交易记录失败：未影响任何行 (ID: ${id})`);
    }
    
    // 验证更新后的记录是否存在
    const updated = this.getById(id);
    if (!updated) {
      throw new Error(`更新交易记录失败：更新后无法找到记录 (ID: ${id})`);
    }
    
    // 日志已移除，由调用方处理
    return updated;
  },

  /**
   * 查询交易列表
   */
  query(params: TransactionQuery = {}): { items: Transaction[]; total: number } {
    const conditions: string[] = [];
    const values: (string | number)[] = [];

    if (params.symbol) {
      conditions.push('symbol = ?');
      values.push(params.symbol.toUpperCase());
    }
    if (params.type) {
      conditions.push('type = ?');
      values.push(params.type);
    }
    if (params.from) {
      conditions.push('trade_date >= ?');
      values.push(params.from);
    }
    if (params.to) {
      conditions.push('trade_date <= ?');
      values.push(params.to);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    // 获取总数
    const countResult = queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM transactions ${whereClause}`,
      values
    );
    const total = countResult?.count || 0;

    // 获取列表
    const limit = params.limit || 50;
    const offset = params.offset || 0;
    const items = query<Transaction>(
      `SELECT * FROM transactions ${whereClause}
       ORDER BY trade_date DESC, created_at DESC
       LIMIT ? OFFSET ?`,
      [...values, limit, offset]
    );

    return { items, total };
  },

  /**
   * 获取某只股票的所有交易
   */
  getBySymbol(symbol: string): Transaction[] {
    return query<Transaction>(
      `SELECT * FROM transactions 
       WHERE symbol = ? 
       ORDER BY trade_date ASC, created_at ASC`,
      [symbol.toUpperCase()]
    );
  },

  /**
   * 删除交易
   */
  delete(id: number): boolean {
    // 先检查记录是否存在
    const existing = this.getById(id);
    if (!existing) {
      return false;
    }
    
    const result = run('DELETE FROM transactions WHERE id = ?', [id]);
    
    // 确认数据库写入是否成功
    if (result.changes === 0) {
      return false;
    }
    
    // 验证记录是否真的被删除
    const deleted = this.getById(id);
    if (deleted) {
      return false;
    }
    
    return true;
  },

  /**
   * 获取所有交易（用于导出）
   */
  getAll(): Transaction[] {
    return query<Transaction>('SELECT * FROM transactions ORDER BY trade_date DESC, created_at DESC');
  },
};

// ==================== 持仓 DAO ====================

export const holdingDao = {
  /**
   * 获取所有持仓
   */
  getAll(): Holding[] {
    return query<Holding>('SELECT * FROM holdings WHERE total_qty > 0 ORDER BY symbol');
  },

  /**
   * 获取单个持仓
   */
  getBySymbol(symbol: string): Holding | null {
    return queryOne<Holding>('SELECT * FROM holdings WHERE symbol = ?', [symbol.toUpperCase()]);
  },

  /**
   * 更新或创建持仓
   */
  upsert(holding: Omit<Holding, 'updated_at'>): void {
    run(
      `INSERT INTO holdings (symbol, name, avg_cost, total_qty, last_price, currency, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(symbol) DO UPDATE SET
         name = excluded.name,
         avg_cost = excluded.avg_cost,
         total_qty = excluded.total_qty,
         last_price = COALESCE(excluded.last_price, last_price),
         currency = excluded.currency,
         updated_at = datetime('now')`,
      [
        holding.symbol.toUpperCase(),
        holding.name,
        holding.avg_cost,
        holding.total_qty,
        holding.last_price,
        holding.currency || 'USD'
      ]
    );
  },

  /**
   * 更新最新价格
   */
  updatePrice(symbol: string, price: number): void {
    run(
      `UPDATE holdings 
       SET last_price = ?, updated_at = datetime('now')
       WHERE symbol = ?`,
      [price, symbol.toUpperCase()]
    );
  },

  /**
   * 批量更新价格
   */
  updatePrices(prices: Map<string, number>): void {
    withTransaction(() => {
      for (const [symbol, price] of prices) {
        run(
          `UPDATE holdings 
           SET last_price = ?, updated_at = datetime('now')
           WHERE symbol = ?`,
          [price, symbol.toUpperCase()]
        );
      }
    });
  },

  /**
   * 删除持仓
   */
  delete(symbol: string): boolean {
    const result = run('DELETE FROM holdings WHERE symbol = ?', [symbol.toUpperCase()]);
    return result.changes > 0;
  },

  /**
   * 获取持仓详情视图
   */
  getPositions(): (Holding & { market_value: number; unrealized_pnl: number; unrealized_pnl_pct: number })[] {
    return query<Holding & { market_value: number; unrealized_pnl: number; unrealized_pnl_pct: number }>(
      'SELECT * FROM v_positions ORDER BY market_value DESC'
    );
  },
};

// ==================== 快照 DAO ====================

interface RawSnapshot {
  date: string;
  timestamp: string;
  total_market_value: number;
  cash_balance: number;
  base_currency: string;
}

export const snapshotDao = {
  /**
   * 插入原始快照（每次生成的快照）
   */
  insertRawSnapshot(snapshot: RawSnapshot): void {
    try {
      run(
        `INSERT INTO raw_snapshots (date, timestamp, total_market_value, cash_balance, base_currency)
         VALUES (?, ?, ?, ?, ?)`,
        [
          snapshot.date,
          snapshot.timestamp,
          snapshot.total_market_value,
          snapshot.cash_balance,
          snapshot.base_currency || 'USD'
        ]
      );
    } catch (error) {
      console.error('插入原始快照失败:', error);
      // 如果是表不存在错误，提供更友好的错误信息
      if (error instanceof Error && error.message.includes('no such table')) {
        throw new Error('数据库表 raw_snapshots 不存在。请运行: npm run db:init');
      }
      throw error;
    }
  },

  /**
   * 计算指定日期的所有快照的平均值
   * 如果当天有多个快照，返回平均值；如果只有一个，返回该值
   */
  calculateDailyAverage(date: string): { total_market_value: number; cash_balance: number; base_currency: string } {
    const result = queryOne<{ 
      avg_value: number; 
      avg_cash: number; 
      base_currency: string;
      count: number;
    }>(
      `SELECT 
        AVG(total_market_value) as avg_value,
        AVG(cash_balance) as avg_cash,
        COALESCE(MAX(base_currency), 'USD') as base_currency,
        COUNT(*) as count
       FROM raw_snapshots 
       WHERE date = ?`,
      [date]
    );

    if (result && result.count > 0) {
      return {
        total_market_value: result.avg_value || 0,
        cash_balance: result.avg_cash || 0,
        base_currency: result.base_currency || 'USD',
      };
    }

    // 如果没有原始快照，返回默认值
    return {
      total_market_value: 0,
      cash_balance: 0,
      base_currency: 'USD',
    };
  },

  /**
   * 获取指定日期的所有原始快照（用于实时显示）
   */
  getRawSnapshotsByDate(date: string): RawSnapshot[] {
    return query<RawSnapshot>(
      `SELECT date, timestamp, total_market_value, cash_balance, base_currency
       FROM raw_snapshots 
       WHERE date = ?
       ORDER BY timestamp ASC`,
      [date]
    );
  },

  /**
   * 获取当天的实时快照（最新的原始快照）
   */
  getTodayRawSnapshot(): RawSnapshot | null {
    const today = getTodayET();
    return queryOne<RawSnapshot>(
      `SELECT date, timestamp, total_market_value, cash_balance, base_currency
       FROM raw_snapshots 
       WHERE date = ?
       ORDER BY timestamp DESC
       LIMIT 1`,
      [today]
    );
  },

  /**
   * 创建或更新每日快照（存储每日平均值）
   */
  upsert(snapshot: Omit<DailySnapshot, 'created_at'>): void {
    run(
      `INSERT INTO daily_snapshots (date, total_market_value, cash_balance, base_currency)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         total_market_value = excluded.total_market_value,
         cash_balance = excluded.cash_balance,
         base_currency = excluded.base_currency`,
      [
        snapshot.date,
        snapshot.total_market_value,
        snapshot.cash_balance,
        snapshot.base_currency || 'USD'
      ]
    );
  },

  /**
   * 获取日期范围内的快照（优先使用每日平均值，当天使用实时快照）
   * 自动过滤掉未来日期和异常数据
   */
  getRange(from: string, to: string): DailySnapshot[] {
    const today = getTodayET();
    const snapshots: DailySnapshot[] = [];

    // 确保查询范围不包含未来日期
    const safeTo = to > today ? today : to;
    const safeFrom = from;

    // 获取历史快照（使用每日平均值）
    const dailySnapshots = query<DailySnapshot>(
      `SELECT * FROM daily_snapshots 
       WHERE date >= ? AND date < ?
       ORDER BY date ASC`,
      [safeFrom, today]
    );
    
      // 过滤掉未来日期和异常数据
      const validDailySnapshots = dailySnapshots.filter(s => {
        // 过滤未来日期
        if (s.date > today) {
          return false;
        }
        // 过滤异常数据：市值和现金余额应该为非负数，且不应该异常大（比如超过1e10）
        if (s.total_market_value < 0 || s.cash_balance < 0 ||
            s.total_market_value > 1e10 || s.cash_balance > 1e10) {
          return false;
        }
        return true;
      });
    
    snapshots.push(...validDailySnapshots);

    // 如果是今天，使用实时快照（原始快照的平均值或最新值）
    if (today >= safeFrom && today <= safeTo) {
      const todayRaw = this.getTodayRawSnapshot();
      if (todayRaw) {
        // 验证今天的快照数据
        if (todayRaw.total_market_value >= 0 && todayRaw.cash_balance >= 0 &&
            todayRaw.total_market_value <= 1e10 && todayRaw.cash_balance <= 1e10) {
          snapshots.push({
            date: todayRaw.date,
            total_market_value: todayRaw.total_market_value,
            cash_balance: todayRaw.cash_balance,
            base_currency: todayRaw.base_currency,
            created_at: todayRaw.timestamp,
          });
        } else {
          // 数据异常，跳过
        }
      } else {
        // 如果没有原始快照，尝试从每日快照获取
        const todayDaily = queryOne<DailySnapshot>(
          'SELECT * FROM daily_snapshots WHERE date = ?',
          [today]
        );
        if (todayDaily) {
          // 验证数据
          if (todayDaily.total_market_value >= 0 && todayDaily.cash_balance >= 0 &&
              todayDaily.total_market_value <= 1e10 && todayDaily.cash_balance <= 1e10) {
            snapshots.push(todayDaily);
          }
        }
      }
    }

    return snapshots.sort((a, b) => a.date.localeCompare(b.date));
  },

  /**
   * 获取最新快照
   */
  getLatest(): DailySnapshot | null {
    const today = getTodayET();
    // 优先返回今天的实时快照
    const todayRaw = this.getTodayRawSnapshot();
    if (todayRaw) {
      return {
        date: todayRaw.date,
        total_market_value: todayRaw.total_market_value,
        cash_balance: todayRaw.cash_balance,
        base_currency: todayRaw.base_currency,
        created_at: todayRaw.timestamp,
      };
    }
    // 否则返回最新的每日快照
    return queryOne<DailySnapshot>('SELECT * FROM daily_snapshots ORDER BY date DESC LIMIT 1');
  },

  /**
   * 获取每日盈亏视图
   */
  getPnlDaily(from?: string, to?: string): Record<string, unknown>[] {
    let sql = 'SELECT * FROM v_pnl_daily';
    const params: string[] = [];

    if (from || to) {
      const conditions: string[] = [];
      if (from) {
        conditions.push('date >= ?');
        params.push(from);
      }
      if (to) {
        conditions.push('date <= ?');
        params.push(to);
      }
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    sql += ' ORDER BY date ASC';
    return query(sql, params);
  },

  /**
   * 清理旧原始快照（保留每日均值后，可以删除旧的原始快照）
   * 只保留最近7天的原始快照，更早的可以删除
   */
  cleanupOldRawSnapshots(daysToKeep: number = 7): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

    const result = run(
      'DELETE FROM raw_snapshots WHERE date < ?',
      [cutoffDateStr]
    );

    return result.changes;
  },
};

// ==================== 汇率 DAO ====================

export const fxRateDao = {
  /**
   * 更新汇率
   */
  upsert(rate: FxRate): void {
    run(
      `INSERT INTO fx_rates (base, quote, rate, as_of)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(base, quote) DO UPDATE SET
         rate = excluded.rate,
         as_of = excluded.as_of`,
      [rate.base, rate.quote, rate.rate, rate.as_of]
    );
  },

  /**
   * 获取汇率
   */
  getRate(base: string, quote: string): FxRate | null {
    return queryOne<FxRate>(
      'SELECT * FROM fx_rates WHERE base = ? AND quote = ?',
      [base, quote]
    );
  },

  /**
   * 获取所有汇率
   */
  getAll(): FxRate[] {
    return query<FxRate>('SELECT * FROM fx_rates');
  },
};

// ==================== 设置 DAO ====================

export const settingsDao = {
  /**
   * 获取设置值
   */
  get(key: string): string | null {
    const row = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    return row?.value || null;
  },

  /**
   * 设置值
   */
  set(key: string, value: string): void {
    run(
      `INSERT INTO settings (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = datetime('now')`,
      [key, value]
    );
  },

  /**
   * 获取所有设置
   */
  getAll(): Record<string, string> {
    const rows = query<{ key: string; value: string }>('SELECT key, value FROM settings');
    return rows.reduce((acc, row) => {
      acc[row.key] = row.value;
      return acc;
    }, {} as Record<string, string>);
  },

  /**
   * 批量设置
   */
  setMany(settings: Record<string, string>): void {
    withTransaction(() => {
      for (const [key, value] of Object.entries(settings)) {
        this.set(key, value);
      }
    });
  },
};

// ==================== 现金账户 DAO ====================

export const cashAccountDao = {
  /**
   * 获取所有现金账户
   */
  getAll(): CashAccount[] {
    return query<CashAccount>('SELECT * FROM cash_accounts ORDER BY account_name ASC');
  },

  /**
   * 根据 ID 获取现金账户
   */
  getById(id: number): CashAccount | null {
    return queryOne<CashAccount>('SELECT * FROM cash_accounts WHERE id = ?', [id]);
  },

  /**
   * 创建现金账户
   */
  create(data: CreateCashAccountRequest): CashAccount {
    const result = run(
      `INSERT INTO cash_accounts (account_name, amount, currency, notes, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [
        data.account_name,
        data.amount,
        data.currency || 'USD',
        data.notes || null,
      ]
    );

    return this.getById(result.lastInsertRowid)!;
  },

  /**
   * 更新现金账户
   */
  update(id: number, data: UpdateCashAccountRequest): CashAccount {
    const existing = this.getById(id);
    if (!existing) {
      throw new Error('现金账户不存在');
    }

    const updates: string[] = [];
    const values: (string | number)[] = [];

    if (data.account_name !== undefined) {
      updates.push('account_name = ?');
      values.push(data.account_name);
    }
    if (data.amount !== undefined) {
      updates.push('amount = ?');
      values.push(data.amount);
    }
    if (data.currency !== undefined) {
      updates.push('currency = ?');
      values.push(data.currency);
    }
    if (data.notes !== undefined) {
      updates.push('notes = ?');
      values.push(data.notes || null);
    }

    if (updates.length === 0) {
      return existing;
    }

    updates.push("updated_at = datetime('now')");
    values.push(id);

    const sql = `UPDATE cash_accounts SET ${updates.join(', ')} WHERE id = ?`;
    run(sql, values);

    return this.getById(id)!;
  },

  /**
   * 删除现金账户
   */
  delete(id: number): boolean {
    const result = run('DELETE FROM cash_accounts WHERE id = ?', [id]);
    return result.changes > 0;
  },

  /**
   * 获取总现金余额
   */
  getTotalCash(): number {
    const result = queryOne<{ total: number }>(
      'SELECT COALESCE(SUM(amount), 0) as total FROM cash_accounts'
    );
    return result?.total || 0;
  },
};

export default {
  transactionDao,
  holdingDao,
  snapshotDao,
  fxRateDao,
  settingsDao,
  cashAccountDao,
};
