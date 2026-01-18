import { transactionDao, holdingDao } from '../db/dao.js';
import { withTransaction } from '../db/index.js';
import { logger } from '../utils/logger.js';
import { marketDataService } from './marketDataService.js';
import { cashService } from './cashService.js';
import type { 
  Transaction, 
  CreateTransactionRequest,
  UpdateTransactionRequest,
  Holding, 
  TransactionQuery 
} from '../../shared/types.js';

/**
 * 交易服务 - 处理交易录入、校验和持仓更新
 */
export const transactionService = {
  /**
   * 创建交易记录
   * 执行校验、写入交易、更新持仓
   * 如果股票名称为空，会自动从 API 查询并填入
   */
  async createTransaction(data: CreateTransactionRequest): Promise<{ transaction: Transaction; holding: Holding }> {
    // 基础校验
    this.validateTransaction(data);

    // 如果名称为空，尝试从 API 获取
    if (!data.name || data.name.trim() === '') {
      try {
        const stockName = await marketDataService.getStockName(data.symbol);
        if (stockName) {
          data.name = stockName;
          logger.info(`自动获取股票名称: ${data.symbol} -> ${stockName}`);
        } else {
          logger.warn(`无法获取股票名称: ${data.symbol}，将使用空名称`);
        }
      } catch (error) {
        logger.warn(`获取股票名称失败: ${data.symbol}`, error);
        // 即使获取名称失败，也继续创建交易
      }
    }

    // 卖出校验
    if (data.type === 'sell') {
      const currentHolding = holdingDao.getBySymbol(data.symbol, data.account_id);
      const currentQty = currentHolding?.total_qty || 0;
      
      if (data.quantity > currentQty) {
        throw new TransactionError(
          `卖出数量 (${data.quantity}) 超过当前持仓量 (${currentQty})`,
          409
        );
      }
    }

    // 写入交易记录
    const transaction = transactionDao.create(data);
    
    // 更新持仓
    const holding = this.updateHolding(data);
    
    // 更新现金账户余额（如果提供了现金账户ID）
    if (data.cash_account_id) {
      try {
        if (data.type === 'buy') {
          // 买入：从现金账户扣除（价格*数量+手续费）
          const totalAmount = data.price * data.quantity + (data.fee || 0);
          cashService.adjustBalance(data.cash_account_id, -totalAmount);
          logger.info(`从现金账户 ${data.cash_account_id} 扣除 ${totalAmount}`);
        } else {
          // 卖出：向现金账户增加（价格*数量-手续费）
          const totalAmount = data.price * data.quantity - (data.fee || 0);
          cashService.adjustBalance(data.cash_account_id, totalAmount);
          logger.info(`向现金账户 ${data.cash_account_id} 增加 ${totalAmount}`);
        }
      } catch (error) {
        logger.error('更新现金账户余额失败', error);
        // 如果现金账户更新失败，可以选择回滚交易或继续（这里选择继续，因为交易已经记录）
        // 在实际应用中，可能需要使用事务来确保一致性
      }
    }
    
    return { transaction, holding };
  },

  /**
   * 校验交易数据
   */
  validateTransaction(data: CreateTransactionRequest): void {
    if (!data.symbol || data.symbol.trim() === '') {
      throw new TransactionError('股票代码不能为空', 400);
    }
    
    if (!['buy', 'sell'].includes(data.type)) {
      throw new TransactionError('交易类型必须是 buy 或 sell', 400);
    }
    
    if (typeof data.price !== 'number' || data.price <= 0) {
      throw new TransactionError('价格必须是正数', 400);
    }
    
    if (typeof data.quantity !== 'number' || data.quantity <= 0) {
      throw new TransactionError('数量必须是正数', 400);
    }
    
    if (data.fee !== undefined && (typeof data.fee !== 'number' || data.fee < 0)) {
      throw new TransactionError('手续费不能为负数', 400);
    }
    
    if (!data.trade_date || !/^\d{4}-\d{2}-\d{2}$/.test(data.trade_date)) {
      throw new TransactionError('交易日期格式无效，应为 YYYY-MM-DD', 400);
    }
  },

  /**
   * 更新持仓（使用加权平均法）
   */
  updateHolding(data: CreateTransactionRequest): Holding {
    const symbol = data.symbol.toUpperCase();
    const currentHolding = holdingDao.getBySymbol(symbol, data.account_id);
    
    let newAvgCost: number;
    let newTotalQty: number;
    const fee = data.fee || 0;

    if (data.type === 'buy') {
      // 买入：加权平均成本计算
      const currentQty = currentHolding?.total_qty || 0;
      const currentCost = currentHolding?.avg_cost || 0;
      
      // 新的总成本 = 原持仓成本 + 新买入成本（含手续费）
      const totalCostBefore = currentQty * currentCost;
      const newPurchaseCost = data.quantity * data.price + fee;
      const totalCostAfter = totalCostBefore + newPurchaseCost;
      
      newTotalQty = currentQty + data.quantity;
      newAvgCost = newTotalQty > 0 ? totalCostAfter / newTotalQty : 0;
    } else {
      // 卖出：减少数量，成本不变（或可记录已实现盈亏）
      const currentQty = currentHolding?.total_qty || 0;
      newTotalQty = currentQty - data.quantity;
      newAvgCost = currentHolding?.avg_cost || 0;
    }

    // 更新持仓
    const holding: Omit<Holding, 'updated_at'> = {
      symbol,
      account_id: data.account_id,
      name: data.name || currentHolding?.name || null,
      avg_cost: newAvgCost,
      total_qty: newTotalQty,
      last_price: currentHolding?.last_price || data.price,
      currency: data.currency || currentHolding?.currency || 'USD',
    };

    if (newTotalQty > 0) {
      holdingDao.upsert(holding);
    } else {
      // 清仓：可以选择删除或保留记录
      holdingDao.upsert({ ...holding, total_qty: 0 });
    }

    return holdingDao.getBySymbol(symbol, data.account_id)!;
  },

  /**
   * 从交易记录重新计算持仓
   * 用于数据修正或恢复
   */
  recalculateHoldings(accountIds?: number[]): Map<string, Holding> {
    const holdings = new Map<string, Holding>();
    
    // 获取所有交易，按时间顺序
    const transactions = transactionDao.getAll().reverse();
    
    for (const tx of transactions) {
      // 如果指定了账户ID列表，只处理这些账户的交易
      if (accountIds && accountIds.length > 0 && !accountIds.includes(tx.account_id)) {
        continue;
      }
      
      const key = `${tx.symbol.toUpperCase()}_${tx.account_id}`;
      let holding = holdings.get(key);
      
      if (!holding) {
        holding = {
          symbol: tx.symbol.toUpperCase(),
          account_id: tx.account_id,
          name: tx.name,
          avg_cost: 0,
          total_qty: 0,
          last_price: 0,
          currency: tx.currency,
          updated_at: null,
        };
      }

      if (tx.type === 'buy') {
        const totalCostBefore = holding.total_qty * holding.avg_cost;
        const newPurchaseCost = tx.quantity * tx.price + tx.fee;
        const totalCostAfter = totalCostBefore + newPurchaseCost;
        
        holding.total_qty += tx.quantity;
        holding.avg_cost = holding.total_qty > 0 ? totalCostAfter / holding.total_qty : 0;
      } else {
        holding.total_qty -= tx.quantity;
      }

      // 更新名称
      if (tx.name) {
        holding.name = tx.name;
      }

      holdings.set(key, holding);
    }

    // 写入数据库
    withTransaction(() => {
      for (const holding of holdings.values()) {
        holdingDao.upsert(holding);
      }
    });

    return holdings;
  },

  /**
   * 查询交易记录
   */
  queryTransactions(params: TransactionQuery) {
    return transactionDao.query(params);
  },

  /**
   * 获取股票的所有交易
   */
  getTransactionsBySymbol(symbol: string, accountIds?: number[]): Transaction[] {
    return transactionDao.getBySymbol(symbol, accountIds);
  },

  /**
   * 更新交易记录（需要重新计算持仓）
   * 如果股票名称为空或股票代码改变，会自动从 API 查询并填入
   */
  async updateTransaction(id: number, data: UpdateTransactionRequest): Promise<{ transaction: Transaction; holding: Holding }> {
    const existingTransaction = transactionDao.getById(id);
    if (!existingTransaction) {
      throw new TransactionError('交易记录不存在', 404);
    }

    // 校验更新数据
    if (data.price !== undefined && data.price <= 0) {
      throw new TransactionError('价格必须是正数', 400);
    }
    if (data.quantity !== undefined && data.quantity <= 0) {
      throw new TransactionError('数量必须是正数', 400);
    }
    if (data.fee !== undefined && data.fee < 0) {
      throw new TransactionError('手续费不能为负数', 400);
    }
    if (data.type && !['buy', 'sell'].includes(data.type)) {
      throw new TransactionError('交易类型必须是 buy 或 sell', 400);
    }

    // 如果名称为空或股票代码改变，尝试从 API 获取名称
    const symbol = data.symbol?.toUpperCase() || existingTransaction.symbol;
    const needsNameUpdate = (!data.name || data.name.trim() === '') && 
                            (symbol !== existingTransaction.symbol || !existingTransaction.name);
    
    if (needsNameUpdate) {
      try {
        const stockName = await marketDataService.getStockName(symbol);
        if (stockName) {
          data.name = stockName;
          logger.info(`自动获取股票名称: ${symbol} -> ${stockName}`);
        } else {
          logger.warn(`无法获取股票名称: ${symbol}，将使用空名称`);
        }
      } catch (error) {
        logger.warn(`获取股票名称失败: ${symbol}`, error);
        // 即使获取名称失败，也继续更新交易
      }
    }

    try {
      logger.debug(`开始更新交易记录 ID=${id}`, data);
      
      // 先回滚旧交易对现金账户的影响
      if (existingTransaction.cash_account_id) {
        try {
          if (existingTransaction.type === 'buy') {
            // 买入：回滚扣除，即增加回去（价格*数量+手续费）
            const oldTotalAmount = existingTransaction.price * existingTransaction.quantity + existingTransaction.fee;
            cashService.adjustBalance(existingTransaction.cash_account_id, oldTotalAmount);
            logger.info(`回滚：向现金账户 ${existingTransaction.cash_account_id} 增加 ${oldTotalAmount}`);
          } else {
            // 卖出：回滚增加，即扣除回去（价格*数量-手续费）
            const oldTotalAmount = existingTransaction.price * existingTransaction.quantity - existingTransaction.fee;
            cashService.adjustBalance(existingTransaction.cash_account_id, -oldTotalAmount);
            logger.info(`回滚：从现金账户 ${existingTransaction.cash_account_id} 扣除 ${oldTotalAmount}`);
          }
        } catch (error) {
          logger.error('回滚现金账户余额失败', error);
        }
      }
      
      const result = withTransaction(() => {
        // 更新交易记录
        const updatedTransaction = transactionDao.update(id, data);
        
        // 确认更新成功
        if (!updatedTransaction) {
          throw new TransactionError('更新交易记录失败：无法获取更新后的记录', 500);
        }
        
        // 重新计算相关股票的持仓
        const symbol = data.symbol?.toUpperCase() || existingTransaction.symbol;
        const accountId = data.account_id || existingTransaction.account_id;
        const holding = this.recalculateHoldingForSymbol(symbol, accountId);
        
        // 如果股票代码改变了，也需要重新计算原股票的持仓
        if (data.symbol && data.symbol.toUpperCase() !== existingTransaction.symbol) {
          this.recalculateHoldingForSymbol(existingTransaction.symbol, accountId);
        }
        
        // 如果账户改变了，也需要重新计算原账户的持仓
        if (data.account_id && data.account_id !== existingTransaction.account_id) {
          this.recalculateHoldingForSymbol(symbol, existingTransaction.account_id);
        }
        
        if (!holding) {
          throw new TransactionError('重新计算持仓失败', 500);
        }
        
        return { transaction: updatedTransaction, holding };
      });
      
      // 应用新交易对现金账户的影响
      const finalTransaction = transactionDao.getById(id);
      if (finalTransaction && finalTransaction.cash_account_id) {
        try {
          const newPrice = data.price !== undefined ? data.price : existingTransaction.price;
          const newQuantity = data.quantity !== undefined ? data.quantity : existingTransaction.quantity;
          const newFee = data.fee !== undefined ? data.fee : existingTransaction.fee;
          const newType = data.type || existingTransaction.type;
          
          if (newType === 'buy') {
            // 买入：从现金账户扣除（价格*数量+手续费）
            const newTotalAmount = newPrice * newQuantity + newFee;
            cashService.adjustBalance(finalTransaction.cash_account_id, -newTotalAmount);
            logger.info(`从现金账户 ${finalTransaction.cash_account_id} 扣除 ${newTotalAmount}`);
          } else {
            // 卖出：向现金账户增加（价格*数量-手续费）
            const newTotalAmount = newPrice * newQuantity - newFee;
            cashService.adjustBalance(finalTransaction.cash_account_id, newTotalAmount);
            logger.info(`向现金账户 ${finalTransaction.cash_account_id} 增加 ${newTotalAmount}`);
          }
        } catch (error) {
          logger.error('更新现金账户余额失败', error);
        }
      }
      
      // 最终确认：再次查询数据库验证更新是否成功
      const finalCheck = transactionDao.getById(id);
      if (!finalCheck) {
        throw new TransactionError('更新交易记录失败：最终验证时无法找到记录', 500);
      }
      
      logger.info(`交易记录更新成功: ID=${id}`);
      return result;
    } catch (error) {
      logger.error(`更新交易记录失败: ID=${id}`, error);
      if (error instanceof TransactionError) {
        throw error;
      }
      throw new TransactionError(
        error instanceof Error ? error.message : '更新交易记录失败',
        500
      );
    }
  },

  /**
   * 删除交易（需要重新计算持仓）
   */
  deleteTransaction(id: number): boolean {
    try {
      const transaction = transactionDao.getById(id);
      if (!transaction) {
        throw new TransactionError('交易记录不存在', 404);
      }

      logger.debug(`开始删除交易记录 ID=${id}`, transaction);
      
      // 先回滚现金账户的影响
      if (transaction.cash_account_id) {
        try {
          if (transaction.type === 'buy') {
            // 买入：回滚扣除，即增加回去（价格*数量+手续费）
            const totalAmount = transaction.price * transaction.quantity + transaction.fee;
            cashService.adjustBalance(transaction.cash_account_id, totalAmount);
            logger.info(`回滚：向现金账户 ${transaction.cash_account_id} 增加 ${totalAmount}`);
          } else {
            // 卖出：回滚增加，即扣除回去（价格*数量-手续费）
            const totalAmount = transaction.price * transaction.quantity - transaction.fee;
            cashService.adjustBalance(transaction.cash_account_id, -totalAmount);
            logger.info(`回滚：从现金账户 ${transaction.cash_account_id} 扣除 ${totalAmount}`);
          }
        } catch (error) {
          logger.error('回滚现金账户余额失败', error);
        }
      }
      
      const result = withTransaction(() => {
        const deleted = transactionDao.delete(id);
        if (!deleted) {
          throw new TransactionError('删除交易记录失败：数据库操作返回 false', 500);
        }
        
        // 最终确认：再次查询数据库验证删除是否成功
        const finalCheck = transactionDao.getById(id);
        if (finalCheck) {
          throw new TransactionError('删除交易记录失败：删除后记录仍然存在', 500);
        }
        
        try {
          // 重新计算该股票的持仓
          this.recalculateHoldingForSymbol(transaction.symbol, transaction.account_id);
        } catch (error) {
          logger.warn('重新计算持仓失败，但交易已删除', error);
          // 即使重新计算失败，交易已经删除，所以继续
        }
        
        return deleted;
      });
      
      // 最终确认：再次查询数据库验证删除是否成功
      const finalCheck = transactionDao.getById(id);
      if (finalCheck) {
        throw new TransactionError('删除交易记录失败：最终验证时记录仍然存在', 500);
      }
      
      logger.info(`交易记录删除成功: ID=${id}`);
      return result;
    } catch (error) {
      logger.error(`删除交易记录失败: ID=${id}`, error);
      if (error instanceof TransactionError) {
        throw error;
      }
      throw new TransactionError(
        error instanceof Error ? error.message : '删除交易失败',
        500
      );
    }
  },

  /**
   * 重新计算单只股票在指定账户的持仓
   */
  recalculateHoldingForSymbol(symbol: string, accountId: number): Holding | null {
    const transactions = transactionDao.getBySymbol(symbol, [accountId]);
    
    if (transactions.length === 0) {
      holdingDao.delete(symbol, accountId);
      return null;
    }

    let avgCost = 0;
    let totalQty = 0;
    let name: string | null = null;
    let currency = 'USD';

    for (const tx of transactions) {
      if (tx.type === 'buy') {
        const totalCostBefore = totalQty * avgCost;
        const newPurchaseCost = tx.quantity * tx.price + tx.fee;
        totalQty += tx.quantity;
        avgCost = totalQty > 0 ? (totalCostBefore + newPurchaseCost) / totalQty : 0;
      } else {
        totalQty -= tx.quantity;
      }
      
      if (tx.name) name = tx.name;
      currency = tx.currency;
    }

    const currentHolding = holdingDao.getBySymbol(symbol, accountId);
    
    const holding: Omit<Holding, 'updated_at'> = {
      symbol: symbol.toUpperCase(),
      account_id: accountId,
      name,
      avg_cost: avgCost,
      total_qty: Math.max(0, totalQty),
      last_price: currentHolding?.last_price || 0,
      currency,
    };

    holdingDao.upsert(holding);
    return holdingDao.getBySymbol(symbol, accountId);
  },

  /**
   * 导出所有交易为 CSV 格式
   */
  exportToCsv(): string {
    const transactions = transactionDao.getAll();
    const headers = ['ID', '股票代码', '名称', '类型', '价格', '数量', '手续费', '币种', '交易日期', '创建时间'];
    
    const rows = transactions.map(tx => [
      tx.id,
      tx.symbol,
      tx.name || '',
      tx.type === 'buy' ? '买入' : '卖出',
      tx.price,
      tx.quantity,
      tx.fee,
      tx.currency,
      tx.trade_date,
      tx.created_at,
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    return csvContent;
  },
};

/**
 * 交易错误类
 */
export class TransactionError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'TransactionError';
  }
}

export default transactionService;

