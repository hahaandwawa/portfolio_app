import { snapshotDao, transactionDao, cashAccountDao } from '../db/dao.js';
import { holdingService } from './holdingService.js';
import { marketDataService } from './marketDataService.js';
import { snapshotService } from './snapshotService.js';
import { getTodayET, isTradingDayET } from '../../shared/timeUtils.js';
import type { NetValuePoint, IndexPoint, PortfolioOverview, Transaction, CashAccount } from '../../shared/types.js';

/**
 * 分析服务 - 处理净值曲线、指数对比等
 */
export const analyticsService = {
  /**
   * 获取投资组合总览
   */
  getOverview(accountIds?: number[]): PortfolioOverview {
    return holdingService.getOverview(accountIds);
  },

  /**
   * 获取净值曲线数据（自动补全缺失日期）
   * @param from 开始日期 YYYY-MM-DD
   * @param to 结束日期 YYYY-MM-DD
   * @param accountIds 账户ID列表，为空则查询所有账户
   */
  async getNetValueCurve(from: string, to: string, accountIds?: number[]): Promise<NetValuePoint[]> {
    // 获取第一条股票交易记录的日期
    const firstTransactionDate = this.getFirstRecordDate();
    if (!firstTransactionDate) {
      return [];
    }

    // 关键修复：确保只从第一条交易记录日期开始获取快照
    // 如果请求的开始日期早于第一条交易记录日期，从第一条记录日期开始获取快照
    // 但保留原始请求的 from 日期，用于在 convertSnapshotsToNetValuePoints 中填充0值
    const actualFrom = firstTransactionDate < from ? firstTransactionDate : from;
    
    // 确保 actualFrom 不早于第一条交易记录日期
    const safeFrom = actualFrom < firstTransactionDate ? firstTransactionDate : actualFrom;
    
    const snapshots = snapshotDao.getRange(safeFrom, to);
    
    // 获取所有持仓
    const holdings = holdingService.getAllHoldings(accountIds);
    if (holdings.length === 0 && snapshots.length === 0) {
      // 如果没有任何快照，但请求的日期早于第一条交易日期，返回0值点
      if (from < firstTransactionDate) {
        return this.convertSnapshotsToNetValuePoints([], from, firstTransactionDate, accountIds);
      }
      return [];
    }

    // 找出缺失的交易日（只查找第一条交易日期之后的）
    const missingDates = this.findMissingTradingDays(safeFrom, to, snapshots);
    
    // 如果有缺失的日期，尝试从API获取并补全
    if (missingDates.length > 0 && holdings.length > 0) {
      console.log(`发现 ${missingDates.length} 个缺失的交易日，开始自动补全...`);
      await this.fillMissingSnapshots(missingDates, holdings, accountIds);
      
      // 重新获取快照数据
      const updatedSnapshots = snapshotDao.getRange(safeFrom, to);
      return this.convertSnapshotsToNetValuePoints(updatedSnapshots, from, firstTransactionDate, accountIds);
    }
    
    // 传入原始请求的 from 和第一条交易记录日期，用于填充0值
    // convertSnapshotsToNetValuePoints 会过滤掉所有早于第一条交易日期的快照
    return this.convertSnapshotsToNetValuePoints(snapshots, from, firstTransactionDate, accountIds);
  },

  /**
   * 获取第一条记录的日期（包括股票交易和现金账户）
   * 返回最早的股票交易记录日期或现金账户创建日期
   */
  getFirstRecordDate(): string | null {
    // 获取最早的股票交易记录日期（buy 或 sell 类型）
    const transactions = transactionDao.getAll();
    
    // 过滤出股票交易（buy/sell），排除其他类型（虽然当前只有buy/sell）
    const stockTransactions = transactions.filter((tx) => 
      tx.type === 'buy' || tx.type === 'sell'
    );
    
    let firstTransactionDate: string | null = null;
    if (stockTransactions.length > 0) {
      const firstTransaction = stockTransactions.reduce<Transaction | null>((earliest, tx) => {
        // 确保日期字符串比较正确（YYYY-MM-DD 格式可以直接比较）
        if (!earliest) {
          return tx;
        }
        // 字符串比较：'2026-01-01' < '2026-01-02' 为 true
        return tx.trade_date < earliest.trade_date ? tx : earliest;
      }, null);
      firstTransactionDate = firstTransaction ? firstTransaction.trade_date : null;
    }
    
    // 获取最早的现金账户创建日期
    const cashAccounts = cashAccountDao.getAll();
    let firstCashAccountDate: string | null = null;
    if (cashAccounts.length > 0) {
      const firstCashAccount = cashAccounts.reduce<CashAccount | null>((earliest, account) => {
        if (!earliest) {
          return account;
        }
        // 从 created_at 提取日期部分（YYYY-MM-DD）
        const earliestDate = earliest.created_at.split(' ')[0];
        const accountDate = account.created_at.split(' ')[0];
        return accountDate < earliestDate ? account : earliest;
      }, null);
      if (firstCashAccount) {
        firstCashAccountDate = firstCashAccount.created_at.split(' ')[0];
      }
    }
    
    // 返回两者中较早的日期
    if (firstTransactionDate && firstCashAccountDate) {
      const result = firstTransactionDate < firstCashAccountDate ? firstTransactionDate : firstCashAccountDate;
      console.log(`[getFirstRecordDate] 第一条记录日期: ${result} (股票: ${firstTransactionDate}, 现金: ${firstCashAccountDate})`);
      return result;
    }
    
    const result = firstTransactionDate || firstCashAccountDate;
    if (result) {
      console.log(`[getFirstRecordDate] 第一条记录日期: ${result}`);
    }
    return result;
  },

  /**
   * 判断是否为交易日（周一到周五，基于ET时区）
   */
  isTradingDay(dateStr: string): boolean {
    return isTradingDayET(dateStr);
  },

  /**
   * 将快照转换为净值曲线数据点
   * @param snapshots 快照数据
   * @param requestedFrom 用户请求的开始日期
   * @param firstRecordDate 第一条记录的日期
   * @param accountIds 账户ID列表，为空则查询所有账户
   */
  convertSnapshotsToNetValuePoints(
    snapshots: Array<{ date: string; total_market_value: number; cash_balance: number }>,
    requestedFrom?: string,
    firstRecordDate?: string | null,
    accountIds?: number[]
  ): NetValuePoint[] {
    const result: NetValuePoint[] = [];
    
    // 如果没有第一条记录日期，无法处理
    if (!firstRecordDate) {
      return [];
    }
    
    // 获取当前总资产作为参考，用于验证快照数据的合理性
    // 使用文件顶部已导入的模块
    const currentHoldings = holdingService.getAllHoldings();
    const currentMarketValue = currentHoldings.reduce((sum, h) => sum + (h.market_value || 0), 0);
    const currentCash = cashAccountDao.getTotalCash();
    const currentTotalAsset = currentMarketValue + currentCash;
    
    // 过滤掉周末和节假日的快照，只保留交易日
    let tradingDaySnapshots = snapshots.filter(s => this.isTradingDay(s.date));
    
    // 关键修复：过滤掉所有早于第一条交易记录日期的快照数据
    // 只保留第一条交易日期及之后的数据
    tradingDaySnapshots = tradingDaySnapshots.filter(s => s.date >= firstRecordDate);
    
    // 只过滤掉明显无效的快照数据（负值或零值）
    // 注意：不再基于与当前总资产的差异来过滤，因为历史快照可能是真实的
    // 用户可能卖出股票、提取现金等操作导致资产变化
    tradingDaySnapshots = tradingDaySnapshots.filter(s => {
      const totalValue = s.total_market_value + (s.cash_balance || 0);
      // 只过滤掉总资产为0或负数的快照
      if (totalValue <= 0) {
        console.warn(`过滤无效快照: ${s.date}, 总资产=${totalValue.toFixed(2)}`);
        return false;
      }
      return true;
    });
    
    // 如果请求的开始日期早于第一条记录日期，添加0值点
    if (requestedFrom && requestedFrom < firstRecordDate) {
      const fromDate = new Date(requestedFrom);
      const firstDate = new Date(firstRecordDate);
      const current = new Date(fromDate);
      
      // 添加从请求开始日期到第一条记录日期之间的0值点（仅交易日）
      while (current < firstDate) {
        const dayOfWeek = current.getDay();
        if (dayOfWeek >= 1 && dayOfWeek <= 5) { // 周一到周五
          result.push({
            date: current.toISOString().split('T')[0],
            value: 0,
            cost: 0,
            pnl_pct: 0,
            stock_value: 0,
            cash_value: 0,
            stock_pnl_pct: 0,
            cash_pnl_pct: 0,
          });
        }
        current.setDate(current.getDate() + 1);
      }
    }
    
    // 如果没有有效的快照数据，尝试添加今天的实时数据
    if (tradingDaySnapshots.length === 0) {
      // 如果今天在请求范围内，添加今天的实时数据
      const today = getTodayET();
      if (firstRecordDate && today >= firstRecordDate) {
        // 使用当前总资产作为今天的净值
        const todayValue = currentTotalAsset;
        const todayCost = this.calculateCostAtDate(today, accountIds);
        result.push({
          date: today,
          value: todayValue,
          cost: todayCost,
          pnl_pct: 0, // 因为没有基准，盈亏百分比设为0
          stock_value: currentMarketValue,
          cash_value: currentCash,
          stock_pnl_pct: 0,
          cash_pnl_pct: 0,
        });
      }
      return result.sort((a, b) => a.date.localeCompare(b.date));
    }
    
    // 找到第一个有效的基准值（第一条记录当天的快照）
    const firstSnapshot = tradingDaySnapshots[0];
    const firstSnapshotDate = firstSnapshot.date;
    
    // 关键修复：计算基准日的股票总成本（不是市值），作为收益计算的基准
    // 现金是本金，不应该计入收益，只计算股票的增值部分
    const holdingsAtBaseDate = this.calculateHoldingsAtDate(firstSnapshotDate);
    const baseStockCost = Array.from(holdingsAtBaseDate.values()).reduce(
      (sum, h) => sum + (h.total_qty * h.avg_cost),
      0
    );
    
    // 保留原有的基准值用于显示总资产（但收益计算不使用）
    const baseValue = firstSnapshot.total_market_value + firstSnapshot.cash_balance;
    const baseStockValue = firstSnapshot.total_market_value;
    const baseCashValue = firstSnapshot.cash_balance || 0;
    
    // 添加实际快照数据点（已经是交易日，且都在第一条交易日期之后）
    const snapshotPoints = tradingDaySnapshots.map(s => {
      const totalValue = s.total_market_value + s.cash_balance;
      const stockValue = s.total_market_value;
      const cashValue = s.cash_balance || 0;
      
      // 计算该日期的累计净投入（成本）
      const cost = this.calculateCostAtDate(s.date, accountIds);
      
      // 关键修复：收益百分比只计算股票的增值部分（市值 - 成本），不包含现金
      // 对于每个时间点，都需要计算该时间点的股票成本
      // 收益 = (当前股票市值 - 当前股票成本) / 基准股票成本 * 100
      const holdingsAtCurrentDate = this.calculateHoldingsAtDate(s.date);
      const currentStockCost = Array.from(holdingsAtCurrentDate.values()).reduce(
        (sum, h) => sum + (h.total_qty * h.avg_cost),
        0
      );
      
      // 收益 = (当前市值 - 当前成本) / 基准成本 * 100
      // 这样只计算股票的增值部分，不包含新投入的本金
      const pnlPct = baseStockCost > 0 
        ? ((stockValue - currentStockCost) / baseStockCost) * 100 
        : 0;
      
      // 股票收益百分比：相对于基准日股票市值的增长
      const stockPnlPct = baseStockValue > 0 ? ((stockValue - baseStockValue) / baseStockValue) * 100 : 0;
      // 现金收益百分比：通常为0，除非有现金变化
      const cashPnlPct = baseCashValue > 0 ? ((cashValue - baseCashValue) / baseCashValue) * 100 : 0;
      
      return {
        date: s.date,
        value: totalValue,
        cost: cost,
        pnl_pct: pnlPct,
        stock_value: stockValue,
        cash_value: cashValue,
        stock_pnl_pct: stockPnlPct,
        cash_pnl_pct: cashPnlPct,
      };
    });
    
    // 如果今天在请求范围内，使用实时数据替换或添加今天的快照数据
    const today = getTodayET();
    const hasTodayInSnapshots = tradingDaySnapshots.some(s => s.date === today);
    // 检查今天是否在请求范围内（今天应该 >= firstRecordDate 且是交易日）
    const todayInRange = today >= firstRecordDate && this.isTradingDay(today);
    // 如果今天在范围内，无论是否有快照，都使用实时数据（确保新交易后能立即显示）
    if (todayInRange) {
      const todayValue = currentTotalAsset;
      const todayStockValue = currentMarketValue;
      const todayCashValue = currentCash;
      const todayCost = this.calculateCostAtDate(today, accountIds);
      
      // 关键修复：收益百分比只计算股票的增值部分（市值 - 成本），不包含现金
      // 计算今天的股票成本
      const holdingsAtToday = this.calculateHoldingsAtDate(today);
      const todayStockCost = Array.from(holdingsAtToday.values()).reduce(
        (sum, h) => sum + (h.total_qty * h.avg_cost),
        0
      );
      
      // 收益 = (当前市值 - 当前成本) / 基准成本 * 100
      const todayPnlPct = baseStockCost > 0 
        ? ((todayStockValue - todayStockCost) / baseStockCost) * 100 
        : 0;
      const todayStockPnlPct = baseStockValue > 0 ? ((todayStockValue - baseStockValue) / baseStockValue) * 100 : 0;
      const todayCashPnlPct = baseCashValue > 0 ? ((todayCashValue - baseCashValue) / baseCashValue) * 100 : 0;
      
      // 查找是否已有今天的快照数据
      const todayIndex = snapshotPoints.findIndex(p => p.date === today);
      if (todayIndex >= 0) {
        // 如果已有今天的快照，用实时数据替换
        snapshotPoints[todayIndex] = {
          date: today,
          value: todayValue,
          cost: todayCost,
          pnl_pct: todayPnlPct,
          stock_value: todayStockValue,
          cash_value: todayCashValue,
          stock_pnl_pct: todayStockPnlPct,
          cash_pnl_pct: todayCashPnlPct,
        };
      } else {
        // 如果没有今天的快照，添加实时数据
        snapshotPoints.push({
          date: today,
          value: todayValue,
          cost: todayCost,
          pnl_pct: todayPnlPct,
          stock_value: todayStockValue,
          cash_value: todayCashValue,
          stock_pnl_pct: todayStockPnlPct,
          cash_pnl_pct: todayCashPnlPct,
        });
      }
    }
    
    // 合并并按日期排序
    const allPoints = [...result, ...snapshotPoints];
    return allPoints.sort((a, b) => a.date.localeCompare(b.date));
  },

  /**
   * 找出缺失的交易日
   */
  findMissingTradingDays(from: string, to: string, existingSnapshots: { date: string }[]): string[] {
    const existingDates = new Set(existingSnapshots.map(s => s.date));
    const missingDates: string[] = [];
    
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const current = new Date(fromDate);
    
    while (current <= toDate) {
      // 跳过周末
      const dayOfWeek = current.getDay();
      if (dayOfWeek >= 1 && dayOfWeek <= 5) {
        const dateStr = current.toISOString().split('T')[0];
        if (!existingDates.has(dateStr)) {
          missingDates.push(dateStr);
        }
      }
      current.setDate(current.getDate() + 1);
    }
    
    return missingDates;
  },

  /**
   * 计算指定日期的持仓状态（基于历史交易记录）
   */
  calculateHoldingsAtDate(date: string): Map<string, { symbol: string; name: string | null; total_qty: number; avg_cost: number; currency: string }> {
    const holdings = new Map<string, { symbol: string; name: string | null; total_qty: number; avg_cost: number; currency: string }>();
    
    // 获取所有交易，按时间顺序（从早到晚）
    const allTransactions = transactionDao.getAll();
    
    // 过滤出指定日期及之前的交易
    const transactionsUpToDate = allTransactions.filter((tx) => tx.trade_date <= date);
    
    // 按交易日期排序（从早到晚）
    transactionsUpToDate.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
    
    // 计算持仓
    for (const tx of transactionsUpToDate) {
      const symbol = tx.symbol.toUpperCase();
      let holding = holdings.get(symbol);
      
      if (!holding) {
        holding = {
          symbol,
          name: tx.name,
          total_qty: 0,
          avg_cost: 0,
          currency: tx.currency,
        };
      }
      
      if (tx.type === 'buy') {
        const totalCostBefore = holding.total_qty * holding.avg_cost;
        const newPurchaseCost = tx.quantity * tx.price + tx.fee;
        const totalCostAfter = totalCostBefore + newPurchaseCost;
        
        holding.total_qty += tx.quantity;
        holding.avg_cost = holding.total_qty > 0 ? totalCostAfter / holding.total_qty : 0;
      } else if (tx.type === 'sell') {
        holding.total_qty -= tx.quantity;
        // 卖出后，如果持仓为0，重置成本价
        if (holding.total_qty <= 0) {
          holding.total_qty = 0;
          holding.avg_cost = 0;
        }
      }
      
      // 更新名称
      if (tx.name) {
        holding.name = tx.name;
      }
      
      holdings.set(symbol, holding);
    }
    
    return holdings;
  },

  /**
   * 计算指定日期的现金余额（基于现金账户创建时间和更新时间）
   * 注意：由于现金账户表没有历史记录，这里使用启发式方法：
   * - 如果账户在指定日期或之前创建，且更新日期不晚于指定日期，使用当前金额
   * - 如果账户在指定日期之后创建，不计入
   * - 如果账户在指定日期之前创建，但更新日期晚于指定日期，使用当前金额（可能不准确）
   * @param date 日期字符串 (YYYY-MM-DD)
   * @param accountIds 账户ID列表，为空则查询所有账户
   */
  calculateCashAtDate(date: string, accountIds?: number[]): number {
    const cashAccounts = cashAccountDao.getAll(accountIds);
    const today = getTodayET();
    
    // 如果查询的是未来日期，返回0
    if (date > today) {
      console.warn(`尝试计算未来日期 ${date} 的现金余额，返回0`);
      return 0;
    }
    
    let totalCash = 0;
    for (const account of cashAccounts) {
      // 从 created_at 和 updated_at 提取日期部分
      const createdDate = account.created_at.split(' ')[0];
      const updatedDate = account.updated_at ? account.updated_at.split(' ')[0] : createdDate;
      
      // 如果现金账户在指定日期或之前创建，计入总现金
      // 注意：如果账户在指定日期之后更新，我们仍然使用当前金额（因为无法知道历史金额）
      if (createdDate <= date) {
        // 如果更新日期晚于查询日期，记录警告（数据可能不准确）
        if (updatedDate > date) {
          console.warn(`现金账户 ${account.account_name} 在 ${date} 之后更新过，历史余额可能不准确`);
        }
        totalCash += account.amount;
      }
    }
    
    return totalCash;
  },

  /**
   * 计算指定日期的累计净投入（成本）
   * 成本 = 所有买入交易的总金额（价格 × 数量 + 手续费）- 所有卖出交易的总金额（价格 × 数量）+ 现金账户余额
   * 
   * 说明：
   * - 买入：投入了钱，增加成本
   * - 卖出：收回了钱，减少成本
   * - 现金账户余额：代表实际投入的现金（包括直接存入的现金和卖出股票得到的现金）
   *   由于无法区分现金的来源，我们采用：成本 = 买入总额 - 卖出总额 + 现金余额
   *   这样，如果现金是通过卖出股票得到的，卖出减少了成本，现金增加了成本，两者抵消，结果是正确的
   *   如果现金是直接存入的，现金增加了成本，这也是正确的
   * 
   * @param date 日期字符串 (YYYY-MM-DD)
   * @param accountIds 账户ID列表，为空则查询所有账户
   */
  calculateCostAtDate(date: string, accountIds?: number[]): number {
    const allTransactions = transactionDao.getAll();
    
    // 过滤出指定日期及之前的交易
    let transactionsUpToDate = allTransactions.filter((tx) => tx.trade_date <= date);
    
    // 如果指定了账户ID列表，只处理这些账户的交易
    if (accountIds && accountIds.length > 0) {
      transactionsUpToDate = transactionsUpToDate.filter(tx => accountIds.includes(tx.account_id));
    }
    
    // 按交易日期排序（从早到晚）
    transactionsUpToDate.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
    
    let totalCost = 0;
    
    // 计算所有买入和卖出交易的成本
    for (const tx of transactionsUpToDate) {
      if (tx.type === 'buy') {
        // 买入：增加成本（价格 × 数量 + 手续费）
        totalCost += tx.price * tx.quantity + tx.fee;
      } else if (tx.type === 'sell') {
        // 卖出：减少成本（价格 × 数量，不包括手续费，因为手续费是成本的一部分）
        totalCost -= tx.price * tx.quantity;
      }
    }
    
    // 加上现金账户的余额（现金余额代表实际投入的现金）
    const cashAtDate = this.calculateCashAtDate(date, accountIds);
    totalCost += cashAtDate;
    
    return totalCost;
  },

  /**
   * 补全缺失的快照数据
   * @param missingDates 缺失的日期列表
   * @param holdings 持仓列表
   * @param accountIds 账户ID列表，为空则查询所有账户
   */
  async fillMissingSnapshots(missingDates: string[], holdings: ReturnType<typeof holdingService.getAllHoldings>, accountIds?: number[]): Promise<void> {
    for (const date of missingDates) {
      try {
        console.log(`正在补全 ${date} 的快照数据...`);
        
        // 关键修复：基于历史交易记录计算该日期的持仓状态
        const holdingsAtDate = this.calculateHoldingsAtDate(date);
        
        // 获取该日期所有持仓的开市和闭市价格
        const priceMap = new Map<string, { open: number; close: number; avg: number }>();
        
        for (const [symbol, holding] of holdingsAtDate.entries()) {
          if (holding.total_qty <= 0) {
            continue; // 跳过没有持仓的股票
          }
          
          let avgPrice: number | null = null;
          let openPrice: number | null = null;
          let closePrice: number | null = null;
          
          try {
            const priceData = await marketDataService.getHistoricalPriceWithOpen(
              symbol,
              date
            );
            
            if (priceData) {
              // 计算平均值 (开市 + 闭市) / 2
              openPrice = priceData.open;
              closePrice = priceData.close;
              avgPrice = (priceData.open + priceData.close) / 2;
              priceMap.set(symbol, {
                open: priceData.open,
                close: priceData.close,
                avg: avgPrice,
              });
            }
            
            // 添加延迟以避免API频率限制
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (error) {
            console.error(`获取 ${symbol} ${date} 价格失败:`, error);
          }
          
          // 如果无法获取当天的历史价格，尝试获取前一天的闭市价格
          if (!avgPrice) {
            console.log(`无法获取 ${symbol} ${date} 的历史价格，尝试获取前一天的闭市价格...`);
            
            // 向前查找前一个交易日（最多查找30天）
            let previousClosePrice: number | null = null;
            for (let i = 1; i <= 30; i++) {
              const checkDate = new Date(date);
              checkDate.setDate(checkDate.getDate() - i);
              const checkDateStr = checkDate.toISOString().split('T')[0];
              
              // 跳过周末
              if (!isTradingDayET(checkDateStr)) {
                continue;
              }
              
              try {
                const previousPriceData = await marketDataService.getHistoricalPriceWithOpen(symbol, checkDateStr);
                if (previousPriceData) {
                  // 使用前一天的闭市价格
                  previousClosePrice = previousPriceData.close;
                  console.log(`✅ 找到 ${symbol} ${checkDateStr} 的闭市价格: ${previousClosePrice.toFixed(2)}，用作 ${date} 的后备价格`);
                  break;
                }
                
                // 添加延迟以避免API频率限制
                await new Promise(resolve => setTimeout(resolve, 200));
              } catch (error) {
                console.warn(`获取 ${symbol} ${checkDateStr} 价格失败:`, error);
              }
            }
            
            if (previousClosePrice) {
              avgPrice = previousClosePrice;
              openPrice = previousClosePrice;
              closePrice = previousClosePrice;
              priceMap.set(symbol, {
                open: openPrice,
                close: closePrice,
                avg: avgPrice,
              });
            } else {
              // 如果连前一天的价格也找不到，使用平均成本作为最后的后备
              console.warn(`⚠️ 无法找到 ${symbol} 前30天的价格数据，使用平均成本 ${holding.avg_cost.toFixed(2)} 作为最后的后备`);
              avgPrice = holding.avg_cost;
              openPrice = holding.avg_cost;
              closePrice = holding.avg_cost;
              priceMap.set(symbol, {
                open: openPrice,
                close: closePrice,
                avg: avgPrice,
              });
            }
          }
        }
        
        // 计算总市值（基于该日期的持仓状态和历史价格）
        // 重要：市值 = 股数 × 价格（必须乘以股数！）
        const validHoldings = Array.from(holdingsAtDate.entries()).filter(([_, h]) => h.total_qty > 0);
        console.log(`  ${date} 共有 ${validHoldings.length} 只股票需要计算市值`);
        
        let totalMarketValue = 0;
        
        if (validHoldings.length === 0) {
          console.log(`  ${date} 没有持仓，总市值为0`);
        } else {
          // 确保所有股票都被计算
          let calculatedCount = 0;
          
          for (const [symbol, holding] of validHoldings) {
            const prices = priceMap.get(symbol);
            let marketValue = 0;
            
            if (prices) {
              // 验证：价格应该是合理的单股价格（不应该超过成本价的10倍或低于成本价的10%）
              const costPrice = holding.avg_cost;
              if (prices.avg > costPrice * 10 || prices.avg < costPrice * 0.1) {
                console.warn(`⚠️ ${symbol} ${date} 价格异常: ${prices.avg.toFixed(2)} (成本: ${costPrice.toFixed(2)})，尝试使用前一天的闭市价格`);
                
                // 价格异常时，尝试使用前一天的闭市价格
                let previousClosePrice: number | null = null;
                for (let i = 1; i <= 30; i++) {
                  const checkDate = new Date(date);
                  checkDate.setDate(checkDate.getDate() - i);
                  const checkDateStr = checkDate.toISOString().split('T')[0];
                  
                  if (!isTradingDayET(checkDateStr)) {
                    continue;
                  }
                  
                  try {
                    const previousPriceData = await marketDataService.getHistoricalPriceWithOpen(symbol, checkDateStr);
                    if (previousPriceData) {
                      previousClosePrice = previousPriceData.close;
                      console.log(`✅ 找到 ${symbol} ${checkDateStr} 的闭市价格: ${previousClosePrice.toFixed(2)}，用作 ${date} 的后备价格`);
                      break;
                    }
                    await new Promise(resolve => setTimeout(resolve, 200));
                  } catch (error) {
                    console.warn(`获取 ${symbol} ${checkDateStr} 价格失败:`, error);
                  }
                }
                
                if (previousClosePrice) {
                  marketValue = holding.total_qty * previousClosePrice;
                } else {
                  // 如果找不到前一天的价格，使用成本价作为最后的后备
                  console.warn(`⚠️ 无法找到 ${symbol} 前30天的价格数据，使用成本价 ${costPrice.toFixed(2)} 作为最后的后备`);
                  marketValue = holding.total_qty * costPrice;
                }
              } else {
                // 市值计算：股数 × 平均价格（重要：必须乘以股数！）
                marketValue = holding.total_qty * prices.avg;
                
                // 验证计算是否正确
                const expectedMin = holding.total_qty * costPrice * 0.5; // 至少应该是成本价的一半
                if (marketValue < expectedMin) {
                  console.warn(`⚠️ ${symbol} ${date} 市值 ${marketValue.toFixed(2)} 小于预期最小值 ${expectedMin.toFixed(2)}，但继续使用计算值`);
                }
              }
              totalMarketValue += marketValue;
              calculatedCount++;
              console.log(`  ${symbol}: ${holding.total_qty} 股 × ${prices.avg.toFixed(2)} 价格 = ${marketValue.toFixed(2)} 市值`);
            } else {
              // 如果仍然没有价格，使用平均成本
              const fallbackPrice = holding.avg_cost;
              marketValue = holding.total_qty * fallbackPrice;
              totalMarketValue += marketValue;
              calculatedCount++;
              console.warn(`无法获取 ${symbol} ${date} 的价格数据，使用平均成本 ${fallbackPrice.toFixed(2)} 计算市值: ${holding.total_qty} 股 × ${fallbackPrice.toFixed(2)} = ${marketValue.toFixed(2)}`);
            }
          }
          
          console.log(`  总市值（累加后）: ${totalMarketValue.toFixed(2)}`);
          console.log(`  已计算股票数: ${calculatedCount}/${validHoldings.length}`);
          
          // 验证：确保所有股票都被计算了
          if (calculatedCount !== validHoldings.length) {
            console.error(`❌ ${date} 只计算了 ${calculatedCount}/${validHoldings.length} 只股票，可能遗漏了某些股票！`);
          }
          
          // 最终验证：总市值应该至少等于所有持仓的成本价总和
          const minExpectedValue = validHoldings.reduce((sum, [_, h]) => {
            return sum + (h.total_qty * h.avg_cost);
          }, 0);
          
          console.log(`  预期最小总市值（所有股票成本价总和）: ${minExpectedValue.toFixed(2)}`);
          
          // 如果总市值明显小于预期最小值，记录警告但不强制替换（因为价格可能确实下跌了）
          if (totalMarketValue < minExpectedValue * 0.3) {
            console.error(`❌ ${date} 总市值 ${totalMarketValue.toFixed(2)} 明显小于预期最小值 ${minExpectedValue.toFixed(2)}，可能存在计算错误！`);
            console.error(`   已计算股票数: ${calculatedCount}/${validHoldings.length}`);
            // 不再强制替换，只记录警告
          }
        }
        
        // 计算该日期的现金余额（基于现金账户创建时间）
        const totalCash = this.calculateCashAtDate(date, accountIds);
        
        // 保存原始快照
        const rawSnapshot = {
          date,
          timestamp: new Date().toISOString(),
          total_market_value: totalMarketValue,
          cash_balance: totalCash,
          base_currency: 'USD',
        };
        snapshotDao.insertRawSnapshot(rawSnapshot);
        
        // 计算并保存每日均值快照
        const dailyAvg = snapshotDao.calculateDailyAverage(date);
        snapshotDao.upsert({
          date,
          total_market_value: dailyAvg?.total_market_value ?? totalMarketValue,
          cash_balance: dailyAvg?.cash_balance ?? totalCash,
          base_currency: dailyAvg?.base_currency ?? 'USD',
        });
        
        console.log(`✅ 成功补全 ${date} 的快照，总市值: ${totalMarketValue.toFixed(2)}, 现金: ${totalCash.toFixed(2)}`);
      } catch (error) {
        console.error(`补全 ${date} 快照失败:`, error);
      }
    }
  },

  /**
   * 获取每日盈亏数据
   */
  getDailyPnl(from?: string, to?: string) {
    return snapshotDao.getPnlDaily(from, to);
  },

  /**
   * 获取指数数据用于对比
   * @param indexSymbol 指数代码，如 '000300.SS' (沪深300) 或 '^GSPC' (S&P 500)
   */
  async getIndexData(
    indexSymbol: string, 
    from: string, 
    to: string
  ): Promise<IndexPoint[]> {
    try {
      const historicalData = await marketDataService.getHistoricalPrices(indexSymbol, from, to);
      
      if (historicalData.length === 0) {
        return [];
      }

      const baseValue = historicalData[0].close;
      
      return historicalData.map(d => ({
        date: d.date,
        value: d.close,
        change_pct: baseValue > 0 ? ((d.close - baseValue) / baseValue) * 100 : 0,
      }));
    } catch (error) {
      console.error(`获取指数 ${indexSymbol} 数据失败:`, error);
      return [];
    }
  },

  /**
   * 获取对比数据（个人收益 vs 指数）
   */
  async getComparisonData(
    from: string, 
    to: string, 
    indexSymbol: string = '000300.SS'
  ): Promise<{
    portfolio: NetValuePoint[];
    index: IndexPoint[];
  }> {
    const [portfolio, index] = await Promise.all([
      this.getNetValueCurve(from, to),
      this.getIndexData(indexSymbol, from, to),
    ]);

    return { portfolio, index };
  },

  /**
   * 计算投资收益统计
   * 关键修复：只计算股票的收益，不包含现金部分
   */
  async calculateStats(from: string, to: string): Promise<{
    totalReturn: number;
    totalReturnPct: number;
    maxDrawdown: number;
    volatility: number;
    sharpeRatio: number;
  }> {
    const curve = await this.getNetValueCurve(from, to);
    
    if (curve.length < 2) {
      return {
        totalReturn: 0,
        totalReturnPct: 0,
        maxDrawdown: 0,
        volatility: 0,
        sharpeRatio: 0,
      };
    }

    // 获取第一个数据点的日期，用于计算基准股票成本
    const firstDate = curve[0].date;
    const firstRecordDate = this.getFirstRecordDate();
    if (!firstRecordDate) {
      return {
        totalReturn: 0,
        totalReturnPct: 0,
        maxDrawdown: 0,
        volatility: 0,
        sharpeRatio: 0,
      };
    }
    
    // 计算基准日的股票总成本（不是市值）
    const holdingsAtBaseDate = this.calculateHoldingsAtDate(firstDate);
    const baseStockCost = Array.from(holdingsAtBaseDate.values()).reduce(
      (sum, h) => sum + (h.total_qty * h.avg_cost),
      0
    );

    // 总收益：只计算股票的增值部分（市值 - 成本），不包含现金
    const firstStockValue = curve[0].stock_value ?? 0;
    const lastStockValue = curve[curve.length - 1].stock_value ?? 0;
    
    // 计算最后一个数据点的股票成本
    const lastDate = curve[curve.length - 1].date;
    const holdingsAtLastDate = this.calculateHoldingsAtDate(lastDate);
    const lastStockCost = Array.from(holdingsAtLastDate.values()).reduce(
      (sum, h) => sum + (h.total_qty * h.avg_cost),
      0
    );
    
    // 收益 = (最后市值 - 最后成本) / 基准成本 * 100
    const totalReturn = lastStockValue - lastStockCost;
    const totalReturnPct = baseStockCost > 0 ? (totalReturn / baseStockCost) * 100 : 0;

    // 最大回撤：基于股票市值的变化，不包含现金
    let peak = firstStockValue;
    let maxDrawdown = 0;
    
    for (const point of curve) {
      const stockValue = point.stock_value ?? 0;
      if (stockValue > peak) {
        peak = stockValue;
      }
      const drawdown = peak > 0 ? (peak - stockValue) / peak : 0;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    // 日收益率：基于股票市值的变化，不包含现金
    const dailyReturns: number[] = [];
    for (let i = 1; i < curve.length; i++) {
      const prevStockValue = curve[i - 1].stock_value ?? 0;
      const currStockValue = curve[i].stock_value ?? 0;
      if (prevStockValue > 0) {
        dailyReturns.push((currStockValue - prevStockValue) / prevStockValue);
      }
    }

    // 波动率（年化）
    const avgReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / dailyReturns.length;
    const dailyVolatility = Math.sqrt(variance);
    const volatility = dailyVolatility * Math.sqrt(252) * 100; // 年化

    // 夏普比率（假设无风险收益率为 2%）
    const riskFreeRate = 0.02 / 252; // 日化无风险收益率
    const excessReturn = avgReturn - riskFreeRate;
    const sharpeRatio = dailyVolatility > 0 ? (excessReturn / dailyVolatility) * Math.sqrt(252) : 0;

    return {
      totalReturn,
      totalReturnPct,
      maxDrawdown: maxDrawdown * 100,
      volatility,
      sharpeRatio,
    };
  },
};

export default analyticsService;

