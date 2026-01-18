/**
 * 导入交易数据脚本
 * 从CSV文件导入交易到指定账户
 * 运行: tsx app/backend/scripts/importTransactions.ts <csv_file_path> <account_name>
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase } from '../db/index.js';
import { accountService } from '../services/accountService.js';
import { transactionService } from '../services/transactionService.js';
import { snapshotService } from '../services/snapshotService.js';
import { marketDataService } from '../services/marketDataService.js';
import { yahooProvider } from '../providers/yahoo.js';
import { alphaVantageProvider } from '../providers/alphaVantage.js';
import type { CreateAccountRequest, CreateTransactionRequest } from '../../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 解析CSV文件
 */
function parseCSV(filePath: string): Array<{
  date: string;
  action: string;
  symbol: string;
  description: string;
  quantity: string;
  price: string;
  fees: string;
  amount: string;
}> {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n');
  
  // 跳过标题行
  const dataLines = lines.slice(1);
  
  return dataLines.map(line => {
    // CSV格式：用引号包裹，逗号分隔
    const matches = line.match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g);
    if (!matches || matches.length < 8) {
      throw new Error(`无法解析行: ${line}`);
    }
    
    // 移除引号
    const values = matches.map(v => v.trim().replace(/^"|"$/g, ''));
    
    return {
      date: values[0],
      action: values[1],
      symbol: values[2],
      description: values[3],
      quantity: values[4],
      price: values[5],
      fees: values[6],
      amount: values[7],
    };
  });
}

/**
 * 转换日期格式：MM/DD/YYYY -> YYYY-MM-DD
 */
function convertDate(dateStr: string): string {
  const [month, day, year] = dateStr.split('/');
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * 解析价格字符串（移除$符号和逗号）
 */
function parsePrice(priceStr: string): number {
  return parseFloat(priceStr.replace(/[$,]/g, ''));
}

/**
 * 解析费用字符串（可能为空）
 */
function parseFee(feeStr: string): number {
  if (!feeStr || feeStr.trim() === '') {
    return 0;
  }
  return parseFloat(feeStr.replace(/[$,]/g, ''));
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('用法: tsx app/backend/scripts/importTransactions.ts <csv_file_path> <account_name> [account_type]');
    console.error('示例: tsx app/backend/scripts/importTransactions.ts transactions.csv "Charles Schwab" stock');
    process.exit(1);
  }
  
  const csvFilePath = args[0];
  const accountName = args[1];
  const accountType = (args[2] as 'stock' | 'cash' | 'mixed') || 'stock';
  
  console.log(`正在导入交易数据...`);
  console.log(`CSV文件: ${csvFilePath}`);
  console.log(`账户名称: ${accountName}`);
  console.log(`账户类型: ${accountType}`);
  
  try {
    // 初始化数据库
    const dataDir = join(__dirname, '..', '..', '..', 'data');
    const dbPath = join(dataDir, 'portfolio-guard.db');
    await initDatabase(dbPath);
    console.log('数据库已初始化');
    
    // 注册行情 Provider（用于快照计算）
    marketDataService.registerProvider(yahooProvider);
    marketDataService.registerProvider(alphaVantageProvider);
    marketDataService.setDefaultProvider('yahoo');
    console.log('市场数据提供者已注册');
    
    // 检查账户是否已存在
    const { accountDao } = await import('../db/dao.js');
    let account = accountDao.getByName(accountName);
    
    if (!account) {
      // 创建账户
      console.log(`正在创建账户: ${accountName}...`);
      const createAccountRequest: CreateAccountRequest = {
        account_name: accountName,
        account_type: accountType,
        notes: '从CSV文件导入',
      };
      account = accountService.createAccount(createAccountRequest);
      console.log(`账户创建成功，ID: ${account.id}`);
    } else {
      console.log(`账户已存在，ID: ${account.id}`);
      
      // 删除该账户的所有现有交易（重新导入）
      const { transactionDao } = await import('../db/dao.js');
      const existingTransactions = transactionDao.query({ account_ids: [account.id] });
      if (existingTransactions.items.length > 0) {
        console.log(`发现 ${existingTransactions.items.length} 条现有交易，正在删除...`);
        for (const tx of existingTransactions.items) {
          try {
            transactionService.deleteTransaction(tx.id);
          } catch (error) {
            console.warn(`删除交易 ID ${tx.id} 失败: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        console.log(`已删除所有现有交易`);
      }
    }
    
    // 解析CSV文件
    console.log(`正在解析CSV文件...`);
    const csvData = parseCSV(csvFilePath);
    console.log(`找到 ${csvData.length} 条交易记录`);
    
    // 按日期排序（从早到晚，确保买入在卖出之前）
    csvData.sort((a, b) => {
      const dateA = new Date(convertDate(a.date));
      const dateB = new Date(convertDate(b.date));
      return dateA.getTime() - dateB.getTime();
    });
    
    // 导入交易
    let successCount = 0;
    let errorCount = 0;
    const errors: Array<{ row: number; error: string }> = [];
    
    console.log(`开始导入交易...`);
    for (let i = 0; i < csvData.length; i++) {
      const row = csvData[i];
      try {
        const action = row.action.toLowerCase();
        if (action !== 'buy' && action !== 'sell') {
          throw new Error(`未知的交易类型: ${row.action}`);
        }
        
        const transactionRequest: CreateTransactionRequest = {
          account_id: account.id,
          symbol: row.symbol,
          name: row.description || undefined,
          type: action as 'buy' | 'sell',
          price: parsePrice(row.price),
          quantity: Math.round(parseFloat(row.quantity)), // 四舍五入到最接近的整数
          fee: 0, // 忽略手续费，始终设置为0
          currency: 'USD',
          trade_date: convertDate(row.date),
        };
        
        await transactionService.createTransaction(transactionRequest);
        successCount++;
        
        if ((i + 1) % 10 === 0) {
          console.log(`已导入 ${i + 1}/${csvData.length} 条交易...`);
        }
      } catch (error) {
        errorCount++;
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push({ row: i + 2, error: errorMsg }); // +2 因为标题行和0-based索引
        console.error(`第 ${i + 2} 行导入失败: ${errorMsg}`);
      }
    }
    
    console.log(`\n导入完成!`);
    console.log(`成功: ${successCount} 条`);
    console.log(`失败: ${errorCount} 条`);
    
    if (errors.length > 0) {
      console.log(`\n错误详情:`);
      errors.forEach(({ row, error }) => {
        console.log(`  第 ${row} 行: ${error}`);
      });
    }
    
    // 重新计算快照
    if (successCount > 0) {
      console.log(`\n正在重新计算快照...`);
      try {
        const firstDate = convertDate(csvData[0].date);
        await snapshotService.recalculateSnapshotsFromDate(firstDate);
        console.log(`快照重新计算完成`);
      } catch (error) {
        console.warn(`快照重新计算失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    console.log(`\n所有操作完成!`);
    
  } catch (error) {
    console.error('导入失败:', error);
    process.exit(1);
  } finally {
    closeDatabase();
  }
}

main().catch(console.error);
