import { holdingDao, cashAccountDao, snapshotDao } from '../db/dao.js';
import { getTodayET, isTradingDayET, isMarketOpenET, isHolidayET, getCurrentTimeET } from '../../shared/timeUtils.js';
import type { Holding, PortfolioOverview } from '../../shared/types.js';
import type { DailySnapshot } from '../../shared/types.js';

/**
 * 持仓服务 - 处理持仓查询和计算
 */
export const holdingService = {
  /**
   * 获取所有持仓（含计算字段）
   * 如果同一股票在多个账户中持有，会自动合并为一条记录
   */
  getAllHoldings(accountIds?: number[]): (Holding & { market_value: number; unrealized_pnl: number; unrealized_pnl_pct: number; weight: number })[] {
    const positions = holdingDao.getPositions(accountIds);
    
    // 按股票代码分组并合并（总是合并，即使只有一个账户也可能有重复，虽然理论上不应该）
    const mergedHoldings = new Map<string, {
      symbol: string;
      name: string | null;
      total_qty: number;
      total_cost: number; // 总成本（用于计算加权平均成本）
      last_price: number;
      currency: string;
      account_ids: number[]; // 记录哪些账户持有该股票
    }>();
    
    for (const pos of positions) {
      const symbol = pos.symbol.toUpperCase();
      const existing = mergedHoldings.get(symbol);
      
      if (existing) {
        // 合并持仓
        existing.total_qty += pos.total_qty;
        existing.total_cost += pos.avg_cost * pos.total_qty; // 累加总成本
        // 使用最新的价格（通常所有账户的价格应该相同）
        if (pos.last_price > existing.last_price) {
          existing.last_price = pos.last_price;
        }
        // 更新名称（使用第一个非空的名称）
        if (!existing.name && pos.name) {
          existing.name = pos.name;
        }
        // 记录账户ID
        if (!existing.account_ids.includes(pos.account_id)) {
          existing.account_ids.push(pos.account_id);
        }
      } else {
        // 创建新的合并持仓
        mergedHoldings.set(symbol, {
          symbol,
          name: pos.name,
          total_qty: pos.total_qty,
          total_cost: pos.avg_cost * pos.total_qty,
          last_price: pos.last_price,
          currency: pos.currency,
          account_ids: [pos.account_id],
        });
      }
    }
    
    // 转换为持仓格式并计算字段
    const mergedPositions = Array.from(mergedHoldings.values()).map(merged => {
      const avg_cost = merged.total_qty > 0 ? merged.total_cost / merged.total_qty : 0;
      const market_value = merged.total_qty * merged.last_price;
      const unrealized_pnl = market_value - merged.total_cost;
      const unrealized_pnl_pct = merged.total_cost > 0 ? (unrealized_pnl / merged.total_cost) * 100 : 0;
      
      return {
        symbol: merged.symbol,
        account_id: merged.account_ids[0], // 使用第一个账户ID（用于兼容，实际已合并）
        name: merged.name,
        avg_cost,
        total_qty: merged.total_qty,
        last_price: merged.last_price,
        currency: merged.currency,
        updated_at: null,
        market_value,
        unrealized_pnl,
        unrealized_pnl_pct,
        weight: 0, // 稍后计算
      };
    });
    
    // 计算总市值用于权重计算
    const totalMarketValue = mergedPositions.reduce((sum, p) => sum + (p.market_value || 0), 0);
    
    return mergedPositions.map(p => ({
      ...p,
      weight: totalMarketValue > 0 ? (p.market_value || 0) / totalMarketValue * 100 : 0,
    }));
  },

  /**
   * 获取单个持仓详情
   */
  getHolding(symbol: string, accountId: number): Holding | null {
    const holding = holdingDao.getBySymbol(symbol, accountId);
    if (!holding || holding.total_qty <= 0) {
      return null;
    }
    
    return {
      ...holding,
      market_value: holding.total_qty * holding.last_price,
      unrealized_pnl: holding.total_qty * (holding.last_price - holding.avg_cost),
      unrealized_pnl_pct: holding.avg_cost > 0 
        ? (holding.last_price - holding.avg_cost) / holding.avg_cost * 100 
        : 0,
    };
  },

  /**
   * 获取指定日期的开市快照（9:30 AM ET 左右的快照）
   * @param date 日期字符串 (YYYY-MM-DD)
   * @returns 开市快照，如果不存在则返回 null
   */
  getMarketOpenSnapshot(date: string): DailySnapshot | null {
    // 首先尝试从 raw_snapshots 中查找 9:30 左右的快照
    const rawSnapshots = snapshotDao.getRawSnapshotsByDate(date);
    
    if (rawSnapshots.length > 0) {
      // 查找最接近 9:30 AM ET 的快照
      // 9:30 AM = 9 * 60 + 30 = 570 分钟
      const targetMinutes = 9 * 60 + 30;
      let closestSnapshot = null;
      let minDiff = Infinity;
      
      for (const snapshot of rawSnapshots) {
        const timestamp = new Date(snapshot.timestamp);
        const etString = timestamp.toLocaleString('en-US', {
          timeZone: 'America/New_York',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
        const [hour, minute] = etString.split(':').map(Number);
        const snapshotMinutes = hour * 60 + minute;
        
        // 只考虑 9:00 - 10:00 之间的快照
        if (snapshotMinutes >= 9 * 60 && snapshotMinutes < 10 * 60) {
          const diff = Math.abs(snapshotMinutes - targetMinutes);
          if (diff < minDiff) {
            minDiff = diff;
            closestSnapshot = snapshot;
          }
        }
      }
      
      if (closestSnapshot) {
        return {
          date: closestSnapshot.date,
          total_market_value: closestSnapshot.total_market_value,
          cash_balance: closestSnapshot.cash_balance,
          base_currency: closestSnapshot.base_currency,
          created_at: closestSnapshot.timestamp,
        };
      }
    }
    
    // 如果没有找到原始快照，不返回每日快照（因为每日快照可能是闭市时的值）
    // 开市快照必须是在 9:00-10:00 之间的快照
    return null;
  },

  /**
   * 获取指定日期的闭市快照（4:00 PM ET 左右的快照）
   * @param date 日期字符串 (YYYY-MM-DD)
   * @returns 闭市快照，如果不存在则返回 null
   */
  getMarketCloseSnapshot(date: string): DailySnapshot | null {
    // 首先尝试从 raw_snapshots 中查找 16:00 左右的快照
    const rawSnapshots = snapshotDao.getRawSnapshotsByDate(date);
    
    if (rawSnapshots.length > 0) {
      // 查找最接近 4:00 PM ET 的快照
      // 4:00 PM = 16 * 60 = 960 分钟
      const targetMinutes = 16 * 60;
      let closestSnapshot = null;
      let minDiff = Infinity;
      
      for (const snapshot of rawSnapshots) {
        const timestamp = new Date(snapshot.timestamp);
        const etString = timestamp.toLocaleString('en-US', {
          timeZone: 'America/New_York',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
        const [hour, minute] = etString.split(':').map(Number);
        const snapshotMinutes = hour * 60 + minute;
        
        // 只考虑 15:30 - 16:30 之间的快照
        if (snapshotMinutes >= 15 * 60 + 30 && snapshotMinutes < 16 * 60 + 30) {
          const diff = Math.abs(snapshotMinutes - targetMinutes);
          if (diff < minDiff) {
            minDiff = diff;
            closestSnapshot = snapshot;
          }
        }
      }
      
      if (closestSnapshot) {
        return {
          date: closestSnapshot.date,
          total_market_value: closestSnapshot.total_market_value,
          cash_balance: closestSnapshot.cash_balance,
          base_currency: closestSnapshot.base_currency,
          created_at: closestSnapshot.timestamp,
        };
      }
    }
    
    // 如果没有找到原始快照，尝试使用每日快照（通常每日快照是闭市时的值）
    const dailySnapshots = snapshotDao.getRange(date, date);
    if (dailySnapshots.length > 0) {
      return dailySnapshots[0];
    }
    
    return null;
  },

  /**
   * 获取持仓总览
   */
  getOverview(accountIds?: number[]): PortfolioOverview {
    const holdings = this.getAllHoldings(accountIds);
    
    // 获取总现金余额
    const totalCash = cashAccountDao.getTotalCash(accountIds);
    
    const totalMarketValue = holdings.reduce((sum, h) => sum + h.market_value, 0);
    const totalAsset = totalMarketValue + totalCash;
    const totalCost = holdings.reduce((sum, h) => sum + h.avg_cost * h.total_qty, 0);
    // 总盈亏只计算持仓部分，不包含现金
    const totalPnl = totalMarketValue - totalCost;
    const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

    // 计算今日盈亏：根据开市/闭市状态使用不同的计算逻辑
    let todayPnl = 0;
    let todayPnlPct = 0;
    let todayPnlStatus: string | undefined = undefined;
    
    const today = getTodayET();
    const { hour, minute } = getCurrentTimeET();
    const currentTime = hour * 60 + minute;
    
    // 判断是否为休息日或节假日
    const holidayInfo = isHolidayET(today);
    if (holidayInfo.isHoliday) {
      // 休息日或节假日：任何时间都为0
      todayPnl = 0;
      todayPnlPct = 0;
      todayPnlStatus = holidayInfo.reason || '休息日';
    } else {
      // 交易日：根据时间段计算
      const isMarketOpen = isMarketOpenET();
      
      // 获取今日开市时的快照
      const todayOpenSnapshot = this.getMarketOpenSnapshot(today);
      
      // 获取今日闭市时的快照
      const todayCloseSnapshot = this.getMarketCloseSnapshot(today);
      
      if (isMarketOpen) {
        // 开市时间段：使用实时的总股票金额 - 开市时的总股票金额
        if (todayOpenSnapshot) {
          const openTotalStockValue = todayOpenSnapshot.total_market_value;
          const currentTotalStockValue = totalMarketValue;
          
          todayPnl = currentTotalStockValue - openTotalStockValue;
          
          if (openTotalStockValue > 0) {
            todayPnlPct = (todayPnl / openTotalStockValue) * 100;
          }
        } else {
          // 如果没有开市快照，无法计算
          console.warn('未找到今日开市快照，今日盈亏无法计算');
          todayPnl = 0;
          todayPnlPct = 0;
        }
      } else {
        // 闭市时间段或开市前
        if (currentTime < 9 * 60 + 30) {
          // 凌晨12:00am到开市前：使用前一日闭市时的总股票金额 - 前一日开市时的总股票金额
          // 向前查找最近一个交易日的快照（最多查找30天）
          let previousTradingDay = null;
          for (let i = 1; i <= 30; i++) {
            // 获取 i 天前的日期（ET时区）
            const checkDate = new Date();
            checkDate.setDate(checkDate.getDate() - i);
            const checkDateStr = checkDate.toLocaleString('en-US', { 
              timeZone: 'America/New_York',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit'
            });
            const [month, day, year] = checkDateStr.split('/');
            const formattedDateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
            
            if (isTradingDayET(formattedDateStr) && formattedDateStr < today) {
              previousTradingDay = formattedDateStr;
              break;
            }
          }
          
          if (previousTradingDay) {
            const prevOpenSnapshot = this.getMarketOpenSnapshot(previousTradingDay);
            const prevCloseSnapshot = this.getMarketCloseSnapshot(previousTradingDay);
            
            if (prevOpenSnapshot && prevCloseSnapshot) {
              const prevOpenTotalStockValue = prevOpenSnapshot.total_market_value;
              const prevCloseTotalStockValue = prevCloseSnapshot.total_market_value;
              
              todayPnl = prevCloseTotalStockValue - prevOpenTotalStockValue;
              
              if (prevOpenTotalStockValue > 0) {
                todayPnlPct = (todayPnl / prevOpenTotalStockValue) * 100;
              }
              
              todayPnlStatus = '已闭市';
            } else {
              // 如果没有找到前一日快照，尝试使用每日快照
              const prevDailySnapshots = snapshotDao.getRange(previousTradingDay, previousTradingDay);
              if (prevDailySnapshots.length > 0) {
                // 使用每日快照作为闭市快照，开市快照使用相同的值（作为近似）
                const prevTotalStockValue = prevDailySnapshots[0].total_market_value;
                todayPnl = 0; // 如果没有开市快照，无法计算盈亏
                todayPnlPct = 0;
                todayPnlStatus = '已闭市';
              }
            }
          }
        } else {
          // 闭市后（4:00 PM 到晚上11:59pm）：使用今日闭市时的总股票金额 - 开市时的总股票金额
          // 注意：这里使用之前获取的 todayCloseSnapshot（在开市时间段判断之前已获取）
          
          if (todayOpenSnapshot && todayCloseSnapshot) {
            const openTotalStockValue = todayOpenSnapshot.total_market_value;
            const closeTotalStockValue = todayCloseSnapshot.total_market_value;
            
            todayPnl = closeTotalStockValue - openTotalStockValue;
            
            if (openTotalStockValue > 0) {
              todayPnlPct = (todayPnl / openTotalStockValue) * 100;
            }
            
            // 闭市后添加"已闭市"标识
            todayPnlStatus = '已闭市';
          } else if (todayOpenSnapshot) {
            // 只有开市快照，没有闭市快照，使用每日快照作为闭市快照
            const dailySnapshots = snapshotDao.getRange(today, today);
            if (dailySnapshots.length > 0) {
              const openTotalStockValue = todayOpenSnapshot.total_market_value;
              const closeTotalStockValue = dailySnapshots[0].total_market_value;
              
              todayPnl = closeTotalStockValue - openTotalStockValue;
              
              if (openTotalStockValue > 0) {
                todayPnlPct = (todayPnl / openTotalStockValue) * 100;
              }
              
              // 闭市后添加"已闭市"标识
              todayPnlStatus = '已闭市';
            }
          } else if (todayCloseSnapshot) {
            // 只有闭市快照，没有开市快照，无法计算（需要开市快照作为基准）
            console.warn('未找到今日开市快照，无法计算今日盈亏（需要开市快照作为基准）');
            todayPnl = 0;
            todayPnlPct = 0;
            // 即使无法计算，也标注"已闭市"
            todayPnlStatus = '已闭市';
          } else {
            // 如果既没有开市快照也没有闭市快照，无法计算
            console.warn('未找到今日开市和闭市快照，今日盈亏无法计算');
            todayPnl = 0;
            todayPnlPct = 0;
            // 即使无法计算，也标注"已闭市"（因为当前时间在闭市后）
            todayPnlStatus = '已闭市';
          }
        }
      }
    }

    return {
      total_asset: totalAsset,
      total_cost: totalCost,
      total_pnl: totalPnl,
      total_pnl_pct: totalPnlPct,
      today_pnl: todayPnl,
      today_pnl_pct: todayPnlPct,
      base_currency: 'USD',
      cash: totalCash,
      holdings_count: holdings.length,
      today_pnl_status: todayPnlStatus,
    };
  },

  /**
   * 获取持仓占比数据（用于饼图）
   * 如果选择了多个账户，会自动合并同一股票的持仓
   */
  getWeightDistribution(accountIds?: number[]): { name: string; value: number; symbol: string }[] {
    const holdings = this.getAllHoldings(accountIds);
    
    return holdings.map(h => ({
      name: h.name || h.symbol,
      value: h.market_value,
      symbol: h.symbol,
    }));
  },

  /**
   * 更新最新价格
   */
  updatePrice(symbol: string, price: number, accountIds?: number[]): void {
    holdingDao.updatePrice(symbol, price, accountIds);
  },

  /**
   * 批量更新价格
   */
  updatePrices(prices: Map<string, number>, accountIds?: number[]): void {
    holdingDao.updatePrices(prices, accountIds);
  },

  /**
   * 获取所有持仓的股票代码
   */
  getAllSymbols(accountIds?: number[]): string[] {
    const holdings = holdingDao.getAll(accountIds);
    return holdings.filter(h => h.total_qty > 0).map(h => h.symbol);
  },
};

export default holdingService;

