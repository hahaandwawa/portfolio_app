/**
 * 轻量级模拟用户测试脚本
 * 
 * 模拟一个真实用户最近三个月的投资行为：
 * - 10个不同的美股股票（包括个股和ETF）
 * - 约30笔交易记录
 * - 现金账户操作
 * 
 * 使用方法:
 *   npm run test:lightweight
 *   或
 *   tsx scripts/test-lightweight-simulation.ts
 */

import { initDatabase, closeDatabase, getDatabase, saveDatabase } from '../app/backend/db/index.js';
import { transactionService } from '../app/backend/services/transactionService.js';
import { snapshotService } from '../app/backend/services/snapshotService.js';
import { cashService } from '../app/backend/services/cashService.js';
import { marketDataService } from '../app/backend/services/marketDataService.js';
import { yahooProvider } from '../app/backend/providers/yahoo.js';
import { alphaVantageProvider } from '../app/backend/providers/alphaVantage.js';
import { transactionDao } from '../app/backend/db/dao.js';
import { getTodayET } from '../app/shared/timeUtils.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 股票池（10只：6只个股 + 4只ETF）
const STOCKS = [
  // 科技股
  { symbol: 'AAPL', name: 'Apple Inc.', basePrice: 180, type: 'stock' as const },
  { symbol: 'MSFT', name: 'Microsoft Corporation', basePrice: 380, type: 'stock' as const },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', basePrice: 500, type: 'stock' as const },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', basePrice: 140, type: 'stock' as const },
  // 金融股
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', basePrice: 160, type: 'stock' as const },
  { symbol: 'V', name: 'Visa Inc.', basePrice: 250, type: 'stock' as const },
  // ETF
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', basePrice: 450, type: 'etf' as const },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust', basePrice: 380, type: 'etf' as const },
  { symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', basePrice: 240, type: 'etf' as const },
  { symbol: 'VOO', name: 'Vanguard S&P 500 ETF', basePrice: 420, type: 'etf' as const },
];

/**
 * 在指定日期基础上增加天数（跳过周末）
 */
function addBusinessDays(date: string, days: number): string {
  const d = new Date(date);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) {
      added++;
    }
  }
  return d.toISOString().split('T')[0];
}

/**
 * 生成日期范围内的随机日期
 */
function randomDateInRange(startDate: string, endDate: string): string {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const randomTime = start.getTime() + Math.random() * (end.getTime() - start.getTime());
  const randomDate = new Date(randomTime);
  
  // 确保是工作日
  while (randomDate.getDay() === 0 || randomDate.getDay() === 6) {
    randomDate.setDate(randomDate.getDate() + 1);
  }
  
  return randomDate.toISOString().split('T')[0];
}

/**
 * 生成价格波动（基于基础价格）
 */
function generatePrice(basePrice: number): number {
  // 模拟价格波动：-20% 到 +30%
  const volatility = 0.2 + Math.random() * 0.1; // 20%-30% 波动
  const direction = Math.random() > 0.5 ? 1 : -1;
  const change = basePrice * volatility * direction * Math.random();
  const price = basePrice + change;
  return Math.max(price * 0.8, price); // 确保不低于基础价格的80%
}

/**
 * 生成交易数量
 */
function generateQuantity(type: 'buy' | 'sell', stockType: 'stock' | 'etf'): number {
  if (type === 'buy') {
    if (stockType === 'etf') {
      return Math.floor(Math.random() * 15) + 5; // ETF: 5-19股
    } else {
      return Math.floor(Math.random() * 10) + 3; // 个股: 3-12股
    }
  } else {
    return Math.floor(Math.random() * 8) + 1; // 卖出: 1-8股
  }
}

/**
 * 清空所有数据
 */
async function clearAllData() {
  console.log('🗑️  正在清空所有数据...');
  
  const db = getDatabase();
  
  try {
    db.run('BEGIN TRANSACTION');
    
    console.log('  - 清空交易记录...');
    db.run('DELETE FROM transactions');
    
    console.log('  - 清空持仓...');
    db.run('DELETE FROM holdings');
    
    console.log('  - 清空原始快照...');
    db.run('DELETE FROM raw_snapshots');
    
    console.log('  - 清空每日快照...');
    db.run('DELETE FROM daily_snapshots');
    
    console.log('  - 清空现金账户...');
    db.run('DELETE FROM cash_accounts');
    
    console.log('  - 清空汇率...');
    db.run('DELETE FROM fx_rates');
    
    console.log('  - 重置设置...');
    db.run('DELETE FROM settings');
    db.run(`INSERT INTO settings (key, value) VALUES 
      ('refresh_interval', 'manual'),
      ('base_currency', 'USD'),
      ('default_provider', 'yahoo'),
      ('theme', 'dark')`);
    
    db.run('COMMIT');
    saveDatabase();
    
    console.log('✅ 所有数据已清空！\n');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}

/**
 * 生成交易记录
 */
interface TransactionRecord {
  symbol: string;
  name: string;
  type: 'buy' | 'sell';
  price: number;
  quantity: number;
  fee: number;
  currency: string;
  trade_date: string;
}

async function generateTransactions(): Promise<TransactionRecord[]> {
  console.log('📝 开始生成交易记录（最近3个月，约30笔）...\n');
  
  const transactions: TransactionRecord[] = [];
  const today = new Date();
  const threeMonthsAgo = new Date(today);
  threeMonthsAgo.setMonth(today.getMonth() - 3);
  const startDate = threeMonthsAgo.toISOString().split('T')[0];
  const endDate = getTodayET();
  
  // 跟踪每只股票的持仓
  const stockState = new Map<string, {
    holdings: number;
    lastTradeDate: string | null;
    stockType: 'stock' | 'etf';
  }>();
  
  // 初始化股票状态
  for (const stock of STOCKS) {
    stockState.set(stock.symbol, {
      holdings: 0,
      lastTradeDate: null,
      stockType: stock.type,
    });
  }
  
  // 生成约30笔交易
  const targetTransactions = 30;
  let transactionCount = 0;
  let currentDate = startDate;
  
  console.log('📊 阶段1: 初期建仓（前1个月）...');
  const initialPeriodEnd = addBusinessDays(startDate, 20); // 约1个月
  
  // 初期建仓：买入所有10只股票
  for (const stock of STOCKS) {
    if (transactionCount >= targetTransactions) break;
    
    const state = stockState.get(stock.symbol)!;
    const buyDate = randomDateInRange(currentDate, initialPeriodEnd);
    const price = generatePrice(stock.basePrice);
    const quantity = generateQuantity('buy', state.stockType);
    
    transactions.push({
      symbol: stock.symbol,
      name: stock.name,
      type: 'buy',
      price: Math.round(price * 100) / 100,
      quantity,
      fee: Math.round(Math.random() * 3 * 100) / 100, // 0-3美元手续费
      currency: 'USD',
      trade_date: buyDate,
    });
    
    state.holdings += quantity;
    state.lastTradeDate = buyDate;
    transactionCount++;
    currentDate = addBusinessDays(buyDate, Math.floor(Math.random() * 3) + 1);
  }
  
  console.log(`  ✅ 初期建仓完成，已生成 ${transactionCount} 笔交易\n`);
  
  // 继续生成交易直到达到目标数量
  console.log('📊 阶段2: 持续交易（加仓、减仓）...');
  
  while (transactionCount < targetTransactions) {
    // 随机选择一只股票
    const stock = STOCKS[Math.floor(Math.random() * STOCKS.length)];
    const state = stockState.get(stock.symbol)!;
    
    // 决定操作类型
    let action: 'buy' | 'sell';
    if (state.holdings === 0) {
      action = 'buy';
    } else {
      // 有持仓，70%概率买入，30%概率卖出
      action = Math.random() < 0.7 ? 'buy' : 'sell';
    }
    
    // 生成交易日期
    let tradeDate: string;
    if (state.lastTradeDate) {
      // 在上次交易后3-15个交易日
      const daysAfter = Math.floor(Math.random() * 13) + 3;
      const calculatedDate = addBusinessDays(state.lastTradeDate, daysAfter);
      tradeDate = calculatedDate > endDate ? endDate : calculatedDate;
    } else {
      tradeDate = randomDateInRange(currentDate, endDate);
    }
    
    // 确保日期在有效范围内
    if (tradeDate > endDate) {
      tradeDate = endDate;
    }
    if (tradeDate < startDate) {
      tradeDate = startDate;
    }
    
    // 如果日期已经等于或超过结束日期，停止生成
    if (tradeDate >= endDate && transactionCount >= targetTransactions - 5) {
      break;
    }
    
    const price = generatePrice(stock.basePrice);
    let quantity: number;
    
    if (action === 'buy') {
      quantity = generateQuantity('buy', state.stockType);
      transactions.push({
        symbol: stock.symbol,
        name: stock.name,
        type: 'buy',
        price: Math.round(price * 100) / 100,
        quantity,
        fee: Math.round(Math.random() * 3 * 100) / 100,
        currency: 'USD',
        trade_date: tradeDate,
      });
      state.holdings += quantity;
    } else {
      // 卖出：不能超过持仓
      const maxSell = Math.min(state.holdings, generateQuantity('sell', state.stockType));
      if (maxSell > 0) {
        quantity = maxSell;
        
        // 20% 概率清仓
        if (Math.random() < 0.2 && state.holdings > 0) {
          quantity = state.holdings;
        }
        
        transactions.push({
          symbol: stock.symbol,
          name: stock.name,
          type: 'sell',
          price: Math.round(price * 100) / 100,
          quantity,
          fee: Math.round(Math.random() * 3 * 100) / 100,
          currency: 'USD',
          trade_date: tradeDate,
        });
        state.holdings -= quantity;
      } else {
        continue; // 跳过，重新选择
      }
    }
    
    state.lastTradeDate = tradeDate;
    transactionCount++;
    currentDate = tradeDate;
  }
  
  console.log(`\n✅ 交易记录生成完成！共 ${transactions.length} 笔交易\n`);
  
  // 按日期排序
  transactions.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  
  return transactions;
}

/**
 * 创建交易记录
 */
async function createTransactions(transactions: TransactionRecord[]): Promise<void> {
  console.log('💾 开始录入交易记录到数据库...\n');
  
  let successCount = 0;
  let errorCount = 0;
  
  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    try {
      const result = transactionService.createTransaction(tx);
      successCount++;
      
      if ((i + 1) % 10 === 0 || i === transactions.length - 1) {
        console.log(`  ✅ 已录入 ${i + 1}/${transactions.length} 笔交易...`);
      }
    } catch (error) {
      console.error(`  ❌ 创建交易失败 ${tx.symbol} ${tx.type} (${tx.trade_date}):`, 
        error instanceof Error ? error.message : error);
      errorCount++;
    }
  }
  
  console.log(`\n✅ 交易录入完成！成功: ${successCount}, 失败: ${errorCount}\n`);
}

/**
 * 生成现金账户操作
 */
async function generateCashAccounts(): Promise<void> {
  console.log('💰 开始生成现金账户操作...\n');
  
  // 创建2个现金账户
  const accounts = [
    { name: '主账户', amount: 15000 },
    { name: '备用账户', amount: 5000 },
  ];
  
  for (const account of accounts) {
    try {
      const created = cashService.createAccount({
        account_name: account.name,
        amount: account.amount,
        currency: 'USD',
        notes: `初始存入 $${account.amount.toLocaleString()}`,
      });
      console.log(`  ✅ 创建现金账户: ${account.name} - $${account.amount.toLocaleString()}`);
    } catch (error) {
      console.error(`  ❌ 创建现金账户失败 ${account.name}:`, 
        error instanceof Error ? error.message : error);
    }
  }
  
  // 模拟一次追加存入
  const allAccounts = cashService.getAllAccounts();
  if (allAccounts.length > 0) {
    const accountToUpdate = allAccounts[0];
    try {
      const additionalAmount = 3000;
      const newAmount = accountToUpdate.amount + additionalAmount;
      cashService.updateAccount(accountToUpdate.id, {
        amount: newAmount,
        notes: `追加存入 $${additionalAmount.toLocaleString()}`,
      });
      console.log(`  ✏️  更新现金账户: ${accountToUpdate.account_name} - 追加 $${additionalAmount.toLocaleString()}, 总额: $${newAmount.toLocaleString()}`);
    } catch (error) {
      console.error(`  ❌ 更新现金账户失败:`, 
        error instanceof Error ? error.message : error);
    }
  }
  
  console.log('\n✅ 现金账户操作完成！\n');
}

/**
 * 生成统计信息
 */
function generateStatistics(transactions: TransactionRecord[]): void {
  console.log('📊 生成统计信息...\n');
  
  const stats = {
    totalTransactions: transactions.length,
    buyCount: transactions.filter(tx => tx.type === 'buy').length,
    sellCount: transactions.filter(tx => tx.type === 'sell').length,
    stocks: new Set(transactions.map(tx => tx.symbol)).size,
    dateRange: {
      earliest: transactions[0]?.trade_date || 'N/A',
      latest: transactions[transactions.length - 1]?.trade_date || 'N/A',
    },
    byStock: {} as Record<string, { buy: number; sell: number; total: number }>,
  };
  
  for (const tx of transactions) {
    if (!stats.byStock[tx.symbol]) {
      stats.byStock[tx.symbol] = { buy: 0, sell: 0, total: 0 };
    }
    stats.byStock[tx.symbol][tx.type]++;
    stats.byStock[tx.symbol].total++;
  }
  
  console.log('📈 交易统计:');
  console.log(`  总交易数: ${stats.totalTransactions}`);
  console.log(`  买入: ${stats.buyCount}`);
  console.log(`  卖出: ${stats.sellCount}`);
  console.log(`  涉及股票数: ${stats.stocks}`);
  console.log(`  日期范围: ${stats.dateRange.earliest} 至 ${stats.dateRange.latest}`);
  console.log(`\n📊 各股票交易统计:`);
  
  for (const [symbol, data] of Object.entries(stats.byStock).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${symbol}: 买入${data.buy}笔, 卖出${data.sell}笔, 总计${data.total}笔`);
  }
  
  console.log('');
}

/**
 * 主函数
 */
async function main() {
  console.log('🚀 开始轻量级模拟用户测试...\n');
  console.log('='.repeat(60));
  console.log('📋 测试计划:');
  console.log('  1. 清空所有数据');
  console.log('  2. 生成约30笔交易记录（最近3个月）');
  console.log('  3. 涉及10只美股（6只个股 + 4只ETF）');
  console.log('  4. 生成现金账户操作');
  console.log('  5. 生成快照数据');
  console.log('='.repeat(60));
  console.log('');
  
  try {
    // 确保数据目录存在
    const dataDir = join(__dirname, '..', 'data');
    const dbPath = join(dataDir, 'portfolio-guard.db');
    
    // 初始化数据库连接
    console.log('📂 初始化数据库...');
    console.log(`   数据库路径: ${dbPath}\n`);
    await initDatabase(dbPath);
    
    // 注册行情 Provider
    console.log('📡 注册行情数据提供者...');
    marketDataService.registerProvider(yahooProvider);
    marketDataService.registerProvider(alphaVantageProvider);
    marketDataService.setDefaultProvider('yahoo');
    console.log('✅ 行情数据提供者注册完成\n');
    
    // 1. 清空所有数据
    await clearAllData();
    
    // 2. 生成交易记录
    const transactions = await generateTransactions();
    
    // 3. 创建交易记录
    await createTransactions(transactions);
    
    // 4. 生成统计信息
    generateStatistics(transactions);
    
    // 5. 生成现金账户
    await generateCashAccounts();
    
    // 6. 生成快照数据
    console.log('📸 开始生成快照数据...');
    const allTransactions = transactionDao.getAll();
    if (allTransactions.length > 0) {
      const earliestDate = allTransactions
        .map(tx => tx.trade_date)
        .sort()[0];
      
      console.log(`   从最早交易日期 ${earliestDate} 开始生成快照...`);
      console.log('   ⚠️  注意：生成快照需要获取历史价格数据，可能需要一些时间...\n');
      
      try {
        await snapshotService.recalculateSnapshotsFromDate(earliestDate);
        console.log('✅ 快照生成完成！\n');
      } catch (error) {
        console.warn('⚠️  快照生成时出现警告:', error instanceof Error ? error.message : error);
        console.log('   这不会影响交易数据，但净值曲线可能不完整\n');
      }
    } else {
      console.log('⚠️  没有交易记录，跳过快照生成\n');
    }
    
    // 最终统计
    console.log('='.repeat(60));
    console.log('✅ 轻量级模拟用户测试完成！\n');
    console.log('📊 最终数据统计:');
    const finalTransactions = transactionDao.getAll();
    
    // 计算持仓
    const holdingsMap = new Map<string, number>();
    for (const tx of finalTransactions) {
      const current = holdingsMap.get(tx.symbol) || 0;
      if (tx.type === 'buy') {
        holdingsMap.set(tx.symbol, current + tx.quantity);
      } else {
        holdingsMap.set(tx.symbol, current - tx.quantity);
      }
    }
    
    const activeHoldings = Array.from(holdingsMap.values())
      .filter(qty => qty > 0)
      .length;
    
    const uniqueStocks = new Set(finalTransactions.map(tx => tx.symbol)).size;
    
    console.log(`  交易记录: ${finalTransactions.length} 笔`);
    console.log(`  涉及股票: ${uniqueStocks} 只`);
    console.log(`  活跃持仓: ${activeHoldings} 只股票`);
    console.log(`  现金账户: ${cashService.getAllAccounts().length} 个`);
    console.log(`  总现金: $${cashService.getTotalCash().toLocaleString()}`);
    console.log('');
    console.log('💡 提示: 现在可以启动系统查看测试数据！');
    console.log('   运行: npm run dev\n');
    
  } catch (error) {
    console.error('❌ 测试过程中出错:', error);
    process.exit(1);
  } finally {
    closeDatabase();
  }
}

// 运行脚本
main().catch((error) => {
  console.error('❌ 脚本执行失败:', error);
  process.exit(1);
});
