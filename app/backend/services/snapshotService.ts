import { snapshotDao, transactionDao } from '../db/dao.js';
import { holdingService } from './holdingService.js';
import { marketDataService } from './marketDataService.js';
import { analyticsService } from './analyticsService.js';
import { getTodayET, isTradingDayET, getCurrentTimeET } from '../../shared/timeUtils.js';
import type { DailySnapshot } from '../../shared/types.js';

/**
 * 快照服务 - 处理每日快照的生成和管理
 */
export const snapshotService = {
  /**
   * 生成当日快照（异步版本，会先刷新价格）
   */
  async createTodaySnapshot(): Promise<DailySnapshot> {
    const today = getTodayET();
    return await this.createSnapshot(today, true);
  },

  /**
   * 生成指定日期的快照
   * @param date 日期字符串 (YYYY-MM-DD)
   * @param refreshPrices 是否先刷新价格（默认false）
   */
  async createSnapshot(date: string, refreshPrices: boolean = false): Promise<DailySnapshot> {
    try {
      const today = getTodayET();
      
      // 验证日期：不允许创建未来日期的快照
      if (date > today) {
        throw new Error(`不能创建未来日期 ${date} 的快照，当前日期为 ${today}`);
      }
      
      const isToday = date === today;
      
      let totalMarketValue = 0;
      let totalCash = 0;
      
      if (isToday) {
        // 如果是今天，使用当前持仓状态和当前价格
        if (refreshPrices) {
          try {
            await marketDataService.refreshAllPrices();
          } catch (error) {
            console.warn('刷新价格失败，使用当前价格:', error);
          }
        }

        const holdings = holdingService.getAllHoldings();
        // 市值计算：每个持仓的 market_value 已经是 total_qty * last_price（来自视图 v_positions）
        totalMarketValue = holdings.reduce((sum, h) => {
          const marketValue = h.market_value || 0;
          // 验证：market_value 应该等于 total_qty * last_price
          const expectedValue = h.total_qty * h.last_price;
          if (Math.abs(marketValue - expectedValue) > 0.01) {
            console.warn(`⚠️ ${h.symbol} 市值计算不一致: market_value=${marketValue}, 预期=${expectedValue} (${h.total_qty} × ${h.last_price})`);
          }
          return sum + marketValue;
        }, 0);
        
        // 获取总现金余额
        const { cashAccountDao } = await import('../db/dao.js');
        totalCash = cashAccountDao.getTotalCash();
      } else {
        // 如果是历史日期，基于历史交易记录计算持仓状态
        console.log(`生成历史快照 ${date}，基于交易记录计算持仓...`);
        
        // 计算该日期的持仓状态
        const holdingsAtDate = analyticsService.calculateHoldingsAtDate(date);
        
        // 验证：确保有持仓数据
        const validHoldings = Array.from(holdingsAtDate.entries()).filter(([_, h]) => h.total_qty > 0);
        console.log(`  ${date} 共有 ${validHoldings.length} 只股票需要计算市值`);
        
        if (validHoldings.length === 0) {
          console.log(`  ${date} 没有持仓，总市值为0`);
          totalMarketValue = 0;
        } else {
          // 获取该日期的历史价格
          const priceMap = new Map<string, number>();
          
          // 第一步：获取所有股票的价格
          for (const [symbol, holding] of validHoldings) {
            let avgPrice: number | null = null;
            
            try {
              const priceData = await marketDataService.getHistoricalPriceWithOpen(symbol, date);
              if (priceData) {
                // 使用平均价格 (开市 + 闭市) / 2
                const calculatedAvgPrice = (priceData.open + priceData.close) / 2;
                
                // 验证价格合理性（应该是单股价格，不应该超过成本价的10倍或低于成本价的10%）
                const costPrice = holding.avg_cost;
                if (calculatedAvgPrice > costPrice * 10 || calculatedAvgPrice < costPrice * 0.1) {
                  console.warn(`⚠️ ${symbol} ${date} 价格异常: ${calculatedAvgPrice.toFixed(2)} (成本: ${costPrice.toFixed(2)})，尝试使用前一天的闭市价格`);
                  // 价格异常时，不设置avgPrice，让下面的逻辑使用前一天的闭市价格
                  avgPrice = null;
                } else {
                  avgPrice = calculatedAvgPrice;
                  priceMap.set(symbol, avgPrice);
                }
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
              let previousPrice: number | null = null;
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
                    previousPrice = previousPriceData.close;
                    console.log(`✅ 找到 ${symbol} ${checkDateStr} 的闭市价格: ${previousPrice.toFixed(2)}，用作 ${date} 的后备价格`);
                    break;
                  }
                  
                  // 添加延迟以避免API频率限制
                  await new Promise(resolve => setTimeout(resolve, 200));
                } catch (error) {
                  console.warn(`获取 ${symbol} ${checkDateStr} 价格失败:`, error);
                }
              }
              
              if (previousPrice) {
                avgPrice = previousPrice;
                priceMap.set(symbol, avgPrice);
              } else {
                // 如果连前一天的价格也找不到，使用平均成本作为最后的后备
                console.warn(`⚠️ 无法找到 ${symbol} 前30天的价格数据，使用平均成本 ${holding.avg_cost.toFixed(2)} 作为最后的后备`);
                avgPrice = holding.avg_cost;
                priceMap.set(symbol, avgPrice);
              }
            }
          }
          
          // 第二步：计算所有股票的总市值（确保所有股票都被计算）
          console.log(`  开始计算 ${validHoldings.length} 只股票的总市值...`);
          for (const [symbol, holding] of validHoldings) {
            const avgPrice = priceMap.get(symbol);
            if (!avgPrice) {
              console.error(`❌ ${symbol} 没有价格数据，跳过`);
              continue;
            }
            
            // 市值计算：股数 × 价格（重要：必须乘以股数！）
            const marketValue = holding.total_qty * avgPrice;
            
            // 验证：市值应该至少是成本价的一半
            const minExpectedValue = holding.total_qty * holding.avg_cost * 0.5;
            if (marketValue < minExpectedValue) {
              console.warn(`⚠️ ${symbol} ${date} 市值 ${marketValue.toFixed(2)} 小于预期最小值 ${minExpectedValue.toFixed(2)}，使用成本价计算`);
              const correctedValue = holding.total_qty * holding.avg_cost;
              totalMarketValue += correctedValue;
              console.log(`  ${symbol}: ${holding.total_qty} 股 × ${holding.avg_cost.toFixed(2)} 成本价 = ${correctedValue.toFixed(2)} 市值`);
            } else {
              totalMarketValue += marketValue;
              console.log(`  ${symbol}: ${holding.total_qty} 股 × ${avgPrice.toFixed(2)} 价格 = ${marketValue.toFixed(2)} 市值`);
            }
          }
          
          console.log(`  总市值（累加后）: ${totalMarketValue.toFixed(2)}`);
          
          // 最终验证：总市值应该至少等于所有持仓的成本价总和
          const minExpectedTotal = validHoldings.reduce((sum, [_, h]) => {
            return sum + (h.total_qty * h.avg_cost);
          }, 0);
          
          console.log(`  预期最小总市值（所有股票成本价总和）: ${minExpectedTotal.toFixed(2)}`);
          
          // 验证：确保所有股票都被计算了
          const calculatedCount = validHoldings.filter(([symbol]) => priceMap.has(symbol)).length;
          if (calculatedCount !== validHoldings.length) {
            console.error(`❌ ${date} 只计算了 ${calculatedCount}/${validHoldings.length} 只股票，可能遗漏了某些股票！`);
          }
          
          // 如果总市值明显小于预期最小值，记录警告但不强制替换（因为价格可能确实下跌了）
          if (totalMarketValue < minExpectedTotal * 0.3) {
            console.error(`❌ ${date} 总市值 ${totalMarketValue.toFixed(2)} 明显小于预期最小值 ${minExpectedTotal.toFixed(2)}，可能存在计算错误！`);
            console.error(`   已计算股票数: ${calculatedCount}/${validHoldings.length}`);
            // 不再强制替换，只记录警告
          }
        }
        
        // 计算该日期的现金余额
        totalCash = analyticsService.calculateCashAtDate(date);
      }
      
      // 保存原始快照（用于计算每日均值）
      const rawSnapshot = {
        date,
        timestamp: new Date().toISOString(),
        total_market_value: totalMarketValue,
        cash_balance: totalCash,
        base_currency: 'USD',
      };
      
      try {
        snapshotDao.insertRawSnapshot(rawSnapshot);
      } catch (error) {
        console.error('插入原始快照失败:', error);
        // 如果表不存在，尝试创建表
        if (error instanceof Error && error.message.includes('no such table')) {
          throw new Error('数据库表 raw_snapshots 不存在，请运行 npm run db:init 初始化数据库');
        }
        throw error;
      }
      
      // 计算并保存每日均值快照
      const dailyAvg = snapshotDao.calculateDailyAverage(date);
      const snapshot: Omit<DailySnapshot, 'created_at'> = {
        date,
        total_market_value: dailyAvg.total_market_value || totalMarketValue,
        cash_balance: dailyAvg.cash_balance || totalCash,
        base_currency: dailyAvg.base_currency || 'USD',
      };

      snapshotDao.upsert(snapshot);
      
      console.log(`已生成 ${date} 的快照，总市值: ${totalMarketValue.toFixed(2)}, 现金: ${totalCash.toFixed(2)}, 总资产: ${(totalMarketValue + totalCash).toFixed(2)}`);
      
      return {
        ...snapshot,
        created_at: new Date().toISOString(),
      };
    } catch (error) {
      console.error('生成快照时出错:', error);
      throw error;
    }
  },

  /**
   * 获取日期范围内的快照
   */
  getSnapshots(from: string, to: string): DailySnapshot[] {
    return snapshotDao.getRange(from, to);
  },

  /**
   * 获取最新快照
   */
  getLatestSnapshot(): DailySnapshot | null {
    return snapshotDao.getLatest();
  },

  /**
   * 批量生成历史快照（用于数据补全）
   * 注意：这需要历史价格数据，当前实现仅使用现有持仓的最新价格
   */
  async generateHistoricalSnapshots(fromDate: string, toDate: string): Promise<number> {
    const from = new Date(fromDate);
    const to = new Date(toDate);
    let count = 0;

    const current = new Date(from);
    while (current <= to) {
      // 跳过周末
      const dayOfWeek = current.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        const dateStr = current.toISOString().split('T')[0];
        await this.createSnapshot(dateStr, false);
        count++;
      }
      current.setDate(current.getDate() + 1);
    }

    return count;
  },

  /**
   * 从交易日期开始，重新计算之后所有日期的快照
   * 逻辑：对于每一天，重新计算到那一天为止所有交易的总值（通过API获取当日价格）
   * 这样可以避免重复计算和覆盖问题
   * @param tradeDate 交易日期 (YYYY-MM-DD)
   */
  async recalculateSnapshotsFromDate(tradeDate: string): Promise<void> {
    const today = getTodayET();
    
    // 如果交易日期是未来，不处理
    if (tradeDate > today) {
      return;
    }

    console.log(`[重新计算快照] 从交易日期 ${tradeDate} 开始重新计算快照`);
    
    // 获取所有交易日期，确保有交易的日期（即使不是交易日）也会生成快照
    const allTransactions = transactionDao.getAll();
    const tradeDates = new Set<string>();
    for (const tx of allTransactions) {
      if (tx.trade_date <= today) {
        tradeDates.add(tx.trade_date);
      }
    }
    
    // 从交易日期开始，重新计算之后所有交易日期的快照
    const currentDate = new Date(tradeDate);
    const todayDate = new Date(today);
    
    while (currentDate <= todayDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const dayOfWeek = currentDate.getDay();
      const isTradingDay = dayOfWeek >= 1 && dayOfWeek <= 5;
      const hasTrade = tradeDates.has(dateStr);
      
      // 如果是交易日，或者该日期有交易记录，则生成快照
      // 这样可以确保交易当天（即使是非交易日）也会生成快照
      if (isTradingDay || hasTrade) {
        // 重新计算该日期的快照（基于所有交易记录）
        try {
          await this.createSnapshot(dateStr, false);
        } catch (error) {
          console.warn(`重新计算 ${dateStr} 的快照失败:`, error);
        }
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    console.log(`[重新计算快照] 完成从 ${tradeDate} 到 ${today} 的快照重新计算`);
  },

  /**
   * 判断是否为交易日（周一到周五）
   */
  isTradingDay(date: Date = new Date()): boolean {
    const dayOfWeek = date.getDay();
    return dayOfWeek >= 1 && dayOfWeek <= 5; // 周一到周五
  },

  /**
   * 设置自动快照任务（开盘和收市）
   * 开盘时间：09:30 ET（美股）
   * 收市时间：16:00 ET（4:00 PM，美股）
   * 使用ET时区时间
   */
  scheduleAutoSnapshots(): { intervals: NodeJS.Timeout[]; cleanup: () => void } {
    const intervals: NodeJS.Timeout[] = [];
    const lastRunTimes = new Map<string, number>(); // 记录上次执行时间，避免重复执行

    const checkAndRun = async (timeLabel: string, hour: number, minute: number) => {
      // 使用ET时区时间
      const { hour: etHour, minute: etMinute } = getCurrentTimeET();
      const today = getTodayET();
      const timeKey = `${timeLabel}-${today}`;
      const lastRun = lastRunTimes.get(timeKey) || 0;
      const currentTime = Date.now();

      // 检查是否是交易日
      if (!isTradingDayET(today)) {
        return;
      }

      // 检查是否到了指定时间（ET时区），且距离上次执行至少1分钟
      if (etHour === hour && etMinute === minute && (currentTime - lastRun) > 60000) {
        try {
          console.log(`[自动快照] ${timeLabel} 时间到达（${etHour}:${etMinute.toString().padStart(2, '0')} ET），开始生成快照...`);
          await this.createTodaySnapshot();
          lastRunTimes.set(timeKey, currentTime);
          console.log(`[自动快照] ${timeLabel} 快照生成完成`);
        } catch (error) {
          console.error(`[自动快照] ${timeLabel} 快照生成失败:`, error);
        }
      }
    };

    // 开盘快照：09:30 ET
    const openInterval = setInterval(() => {
      checkAndRun('开盘', 9, 30);
    }, 60 * 1000); // 每分钟检查一次
    intervals.push(openInterval);

    // 收市快照：16:00 ET（4:00 PM）
    const closeInterval = setInterval(() => {
      checkAndRun('收市', 16, 0);
    }, 60 * 1000); // 每分钟检查一次
    intervals.push(closeInterval);

    // 清理函数
    const cleanup = () => {
      intervals.forEach(interval => clearInterval(interval));
      lastRunTimes.clear();
    };

    return { intervals, cleanup };
  },

  /**
   * 设置定时任务（每日生成快照）- 保留向后兼容
   * @param hour 执行小时（24小时制），默认 23
   * @param minute 执行分钟，默认 59
   * @deprecated 使用 scheduleAutoSnapshots 代替
   */
  scheduleDaily(hour: number = 23, minute: number = 59): NodeJS.Timeout {
    const checkAndRun = async () => {
      const now = new Date();
      if (now.getHours() === hour && now.getMinutes() === minute) {
        await this.createTodaySnapshot();
      }
    };

    // 每分钟检查一次
    return setInterval(checkAndRun, 60 * 1000);
  },

  /**
   * 删除旧快照（可选，用于清理）
   * @param beforeDate 删除此日期之前的快照
   */
  deleteOldSnapshots(beforeDate: string): number {
    // 暂不实现删除功能，保留所有历史数据
    console.warn('deleteOldSnapshots 暂未实现');
    return 0;
  },
};

export default snapshotService;

