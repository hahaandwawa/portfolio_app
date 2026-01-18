import { accountDao, transactionDao, cashAccountDao, targetDao } from '../db/dao.js';
import { accountService } from './accountService.js';
import { transactionService } from './transactionService.js';
import { cashService } from './cashService.js';
import { targetService } from './targetService.js';
import { snapshotService } from './snapshotService.js';
import { getDatabase } from '../db/index.js';
import { getTodayET } from '../../shared/timeUtils.js';
import type {
  Account,
  Transaction,
  CashAccount,
  Target,
  CreateAccountRequest,
  CreateTransactionRequest,
  CreateCashAccountRequest,
  CreateTargetRequest,
} from '../../shared/types.js';

/**
 * CSV导出/导入服务
 * 
 * CSV格式设计：
 * - accounts.csv: id, account_name, account_type, notes, created_at, updated_at
 * - transactions.csv: id, account_id, symbol, name, type, price, quantity, fee, currency, trade_date, cash_account_id, created_at
 * - cash_accounts.csv: id, account_id, account_name, amount, currency, notes, created_at, updated_at
 * - targets.csv: id, symbol, target_amount, scope_type, account_id, created_at, updated_at
 */

/**
 * 转义CSV字段（处理逗号、引号、换行符）
 */
function escapeCsvField(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  // 如果包含逗号、引号或换行符，需要用引号包裹，并转义引号
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * 解析CSV行（处理引号包裹的字段）
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // 转义的引号
        current += '"';
        i++; // 跳过下一个引号
      } else {
        // 切换引号状态
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // 字段分隔符
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  
  // 添加最后一个字段
  result.push(current);
  
  return result;
}

/**
 * 导出服务
 */
export const exportService = {
  /**
   * 导出所有账户为CSV
   */
  exportAccounts(): string {
    const accounts = accountDao.getAll();
    const headers = ['id', 'account_name', 'account_type', 'notes', 'created_at', 'updated_at'];
    
    const rows = accounts.map(acc => [
      acc.id,
      acc.account_name,
      acc.account_type,
      acc.notes || '',
      acc.created_at,
      acc.updated_at,
    ]);
    
    return [
      headers.join(','),
      ...rows.map(row => row.map(escapeCsvField).join(',')),
    ].join('\n');
  },

  /**
   * 导出所有交易为CSV
   */
  exportTransactions(): string {
    const transactions = transactionDao.getAll();
    const headers = [
      'id',
      'account_id',
      'symbol',
      'name',
      'type',
      'price',
      'quantity',
      'fee',
      'currency',
      'trade_date',
      'cash_account_id',
      'created_at',
    ];
    
    const rows = transactions.map(tx => [
      tx.id,
      tx.account_id,
      tx.symbol,
      tx.name || '',
      tx.type,
      tx.price,
      tx.quantity,
      tx.fee,
      tx.currency,
      tx.trade_date,
      tx.cash_account_id || '',
      tx.created_at,
    ]);
    
    return [
      headers.join(','),
      ...rows.map(row => row.map(escapeCsvField).join(',')),
    ].join('\n');
  },

  /**
   * 导出所有现金账户为CSV
   */
  exportCashAccounts(): string {
    const cashAccounts = cashAccountDao.getAll();
    const headers = [
      'id',
      'account_id',
      'account_name',
      'amount',
      'currency',
      'notes',
      'created_at',
      'updated_at',
    ];
    
    const rows = cashAccounts.map(ca => [
      ca.id,
      ca.account_id,
      ca.account_name,
      ca.amount,
      ca.currency,
      ca.notes || '',
      ca.created_at,
      ca.updated_at,
    ]);
    
    return [
      headers.join(','),
      ...rows.map(row => row.map(escapeCsvField).join(',')),
    ].join('\n');
  },

  /**
   * 导出所有投资目标为CSV
   */
  exportTargets(): string {
    const targets = targetDao.getAll();
    const headers = [
      'id',
      'symbol',
      'target_amount',
      'scope_type',
      'account_id',
      'created_at',
      'updated_at',
    ];
    
    const rows = targets.map(t => [
      t.id,
      t.symbol,
      t.target_amount,
      t.scope_type,
      t.account_id || '',
      t.created_at,
      t.updated_at,
    ]);
    
    return [
      headers.join(','),
      ...rows.map(row => row.map(escapeCsvField).join(',')),
    ].join('\n');
  },

  /**
   * 导出所有数据为ZIP（返回多个CSV文件的base64编码JSON）
   * 由于在浏览器环境中，我们返回一个包含所有CSV的对象
   */
  exportAll(): {
    accounts: string;
    transactions: string;
    cash_accounts: string;
    targets: string;
    metadata: {
      export_date: string;
      version: string;
    };
  } {
    return {
      accounts: this.exportAccounts(),
      transactions: this.exportTransactions(),
      cash_accounts: this.exportCashAccounts(),
      targets: this.exportTargets(),
      metadata: {
        export_date: new Date().toISOString(),
        version: '1.0',
      },
    };
  },
};

/**
 * 导入服务
 */
export const importService = {
  /**
   * 从CSV字符串导入账户
   */
  importAccounts(csvContent: string, options: { skipExisting?: boolean } = {}): {
    success: number;
    errors: Array<{ row: number; error: string }>;
  } {
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) {
      return { success: 0, errors: [{ row: 0, error: 'CSV文件为空或格式不正确' }] };
    }

    const headers = parseCsvLine(lines[0]);
    const dataLines = lines.slice(1);
    
    let successCount = 0;
    const errors: Array<{ row: number; error: string }> = [];

    for (let i = 0; i < dataLines.length; i++) {
      const line = dataLines[i];
      if (!line.trim()) continue;

      try {
        const values = parseCsvLine(line);
        if (values.length < headers.length) {
          errors.push({ row: i + 2, error: '字段数量不足' });
          continue;
        }

        // 解析字段
        const id = values[0] ? parseInt(values[0], 10) : null;
        const account_name = values[1]?.trim() || '';
        const account_type = values[2]?.trim() as 'stock' | 'cash' | 'mixed';
        const notes = values[3]?.trim() || undefined;

        // 验证
        if (!account_name) {
          errors.push({ row: i + 2, error: '账户名称不能为空' });
          continue;
        }

        if (!['stock', 'cash', 'mixed'].includes(account_type)) {
          errors.push({ row: i + 2, error: `无效的账户类型: ${account_type}` });
          continue;
        }

        // 检查是否已存在
        const existing = accountDao.getByName(account_name);
        if (existing) {
          if (options.skipExisting) {
            continue; // 跳过已存在的账户
          }
          errors.push({ row: i + 2, error: `账户名称已存在: ${account_name}` });
          continue;
        }

        // 创建账户
        const createRequest: CreateAccountRequest = {
          account_name,
          account_type,
          notes,
        };

        accountService.createAccount(createRequest);
        successCount++;
      } catch (error) {
        errors.push({
          row: i + 2,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { success: successCount, errors };
  },

  /**
   * 从CSV字符串导入交易
   */
  async importTransactions(
    csvContent: string,
    options: { skipExisting?: boolean; recalculateSnapshots?: boolean } = {}
  ): Promise<{
    success: number;
    errors: Array<{ row: number; error: string }>;
  }> {
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) {
      return { success: 0, errors: [{ row: 0, error: 'CSV文件为空或格式不正确' }] };
    }

    // 确保cash_account_id列存在
    try {
      const db = getDatabase();
      const tableInfo = db.exec("PRAGMA table_info(transactions)");
      const hasCashAccountId = tableInfo.length > 0 && 
        tableInfo[0].values.some((col: unknown[]) => col[1] === 'cash_account_id');
      
      if (!hasCashAccountId) {
        console.log('检测到transactions表缺少cash_account_id列，正在添加...');
        db.run('ALTER TABLE transactions ADD COLUMN cash_account_id INTEGER');
        console.log('✓ 已添加cash_account_id列');
      }
    } catch (error) {
      console.warn('检查/添加cash_account_id列失败:', error);
      // 继续执行，如果列不存在会在插入时失败
    }

    const headers = parseCsvLine(lines[0]);
    const dataLines = lines.slice(1);
    
    // 检查CSV中是否有cash_account_id列（兼容旧格式）
    const hasCashAccountIdInCsv = headers.includes('cash_account_id');
    
    // 解析所有交易数据，先不创建
    const transactions: Array<{
      row: number;
      account_id: number;
      symbol: string;
      name?: string;
      type: 'buy' | 'sell';
      price: number;
      quantity: number;
      fee: number;
      currency: string;
      trade_date: string;
      cash_account_id: number | null;
    }> = [];
    
    const errors: Array<{ row: number; error: string }> = [];

    // 第一步：解析和验证所有交易
    for (let i = 0; i < dataLines.length; i++) {
      const line = dataLines[i];
      if (!line.trim()) continue;

      try {
        const values = parseCsvLine(line);
        if (values.length < headers.length) {
          errors.push({ row: i + 2, error: '字段数量不足' });
          continue;
        }

        // 解析字段（根据headers索引，更灵活）
        const account_id = parseInt(values[headers.indexOf('account_id')] || values[1], 10);
        const symbol = (values[headers.indexOf('symbol')] || values[2])?.trim().toUpperCase() || '';
        const name = (values[headers.indexOf('name')] || values[3])?.trim() || undefined;
        const type = (values[headers.indexOf('type')] || values[4])?.trim().toLowerCase() as 'buy' | 'sell';
        const price = parseFloat(values[headers.indexOf('price')] || values[5]);
        const quantity = parseFloat(values[headers.indexOf('quantity')] || values[6]);
        const fee = values[headers.indexOf('fee')] !== undefined ? parseFloat(values[headers.indexOf('fee')] || values[7] || '0') : 0;
        const currency = (values[headers.indexOf('currency')] || values[8])?.trim() || 'USD';
        const trade_date = (values[headers.indexOf('trade_date')] || values[9])?.trim() || '';
        const cashAccountIdIndex = headers.indexOf('cash_account_id');
        const cash_account_id = hasCashAccountIdInCsv && cashAccountIdIndex >= 0 && values[cashAccountIdIndex] && values[cashAccountIdIndex].trim()
          ? parseInt(values[cashAccountIdIndex], 10)
          : null;

        // 验证
        if (!symbol) {
          errors.push({ row: i + 2, error: '股票代码不能为空' });
          continue;
        }

        if (!['buy', 'sell'].includes(type)) {
          errors.push({ row: i + 2, error: `无效的交易类型: ${type}` });
          continue;
        }

        if (isNaN(price) || price <= 0) {
          errors.push({ row: i + 2, error: `无效的价格: ${values[5]}` });
          continue;
        }

        if (isNaN(quantity) || quantity <= 0) {
          errors.push({ row: i + 2, error: `无效的数量: ${values[6]}` });
          continue;
        }

        if (!trade_date || !/^\d{4}-\d{2}-\d{2}$/.test(trade_date)) {
          errors.push({ row: i + 2, error: `无效的交易日期格式: ${trade_date}` });
          continue;
        }

        // 验证账户ID
        const account = accountDao.getById(account_id);
        if (!account) {
          errors.push({ row: i + 2, error: `账户不存在: ${account_id}` });
          continue;
        }

        // 验证现金账户ID（如果提供）
        if (cash_account_id) {
          const cashAccount = cashAccountDao.getById(cash_account_id);
          if (!cashAccount) {
            errors.push({ row: i + 2, error: `现金账户不存在: ${cash_account_id}` });
            continue;
          }
        }

        // 添加到待处理列表
        transactions.push({
          row: i + 2,
          account_id,
          symbol,
          name,
          type,
          price,
          quantity,
          fee,
          currency,
          trade_date,
          cash_account_id,
        });
      } catch (error) {
        errors.push({
          row: i + 2,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 第二步：按日期排序（确保买入在卖出之前，同一天内按时间顺序）
    transactions.sort((a, b) => {
      const dateCompare = a.trade_date.localeCompare(b.trade_date);
      if (dateCompare !== 0) return dateCompare;
      // 同一天内，买入优先于卖出
      if (a.type === 'buy' && b.type === 'sell') return -1;
      if (a.type === 'sell' && b.type === 'buy') return 1;
      return 0;
    });

    // 第三步：先导入所有买入交易，再导入卖出交易
    // 这样可以避免卖出时持仓不足的问题
    const buyTransactions = transactions.filter(tx => tx.type === 'buy');
    const sellTransactions = transactions.filter(tx => tx.type === 'sell');
    
    let successCount = 0;
    const earliestDate: string[] = [];

    // 先处理所有买入交易
    for (const tx of buyTransactions) {
      try {
        const createRequest: CreateTransactionRequest = {
          account_id: tx.account_id,
          symbol: tx.symbol,
          name: tx.name,
          type: tx.type,
          price: tx.price,
          quantity: tx.quantity,
          fee: tx.fee,
          currency: tx.currency,
          trade_date: tx.trade_date,
          cash_account_id: tx.cash_account_id || undefined,
        };

        await transactionService.createTransaction(createRequest);
        earliestDate.push(tx.trade_date);
        successCount++;
      } catch (error) {
        errors.push({
          row: tx.row,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 再处理所有卖出交易（此时持仓应该已经建立）
    for (const tx of sellTransactions) {
      try {
        const createRequest: CreateTransactionRequest = {
          account_id: tx.account_id,
          symbol: tx.symbol,
          name: tx.name,
          type: tx.type,
          price: tx.price,
          quantity: tx.quantity,
          fee: tx.fee,
          currency: tx.currency,
          trade_date: tx.trade_date,
          cash_account_id: tx.cash_account_id || undefined,
        };

        await transactionService.createTransaction(createRequest);
        earliestDate.push(tx.trade_date);
        successCount++;
      } catch (error) {
        errors.push({
          row: tx.row,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 重新计算快照（如果启用）- 异步执行，不阻塞导入完成
    if (options.recalculateSnapshots && earliestDate.length > 0) {
      const firstDate = earliestDate.sort()[0];
      const today = getTodayET();
      if (firstDate <= today) {
        // 异步执行，不等待完成
        snapshotService.recalculateSnapshotsFromDate(firstDate).catch((error) => {
          console.error('后台重新计算快照失败:', error);
        });
      }
    }

    return { success: successCount, errors };
  },

  /**
   * 从CSV字符串导入现金账户
   */
  importCashAccounts(csvContent: string, options: { skipExisting?: boolean } = {}): {
    success: number;
    errors: Array<{ row: number; error: string }>;
  } {
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) {
      return { success: 0, errors: [{ row: 0, error: 'CSV文件为空或格式不正确' }] };
    }

    const headers = parseCsvLine(lines[0]);
    const dataLines = lines.slice(1);
    
    let successCount = 0;
    const errors: Array<{ row: number; error: string }> = [];

    for (let i = 0; i < dataLines.length; i++) {
      const line = dataLines[i];
      if (!line.trim()) continue;

      try {
        const values = parseCsvLine(line);
        if (values.length < headers.length) {
          errors.push({ row: i + 2, error: '字段数量不足' });
          continue;
        }

        // 解析字段
        const account_id = parseInt(values[1], 10);
        const account_name = values[2]?.trim() || '';
        const amount = parseFloat(values[3]);
        const currency = values[4]?.trim() || 'USD';
        const notes = values[5]?.trim() || undefined;

        // 验证
        if (!account_name) {
          errors.push({ row: i + 2, error: '账户名称不能为空' });
          continue;
        }

        if (isNaN(amount) || amount < 0) {
          errors.push({ row: i + 2, error: `无效的金额: ${values[3]}` });
          continue;
        }

        // 验证账户ID
        const account = accountDao.getById(account_id);
        if (!account) {
          errors.push({ row: i + 2, error: `账户不存在: ${account_id}` });
          continue;
        }

        // 创建现金账户
        const createRequest: CreateCashAccountRequest = {
          account_id,
          account_name,
          amount,
          currency,
          notes,
        };

        cashService.createAccount(createRequest);
        successCount++;
      } catch (error) {
        errors.push({
          row: i + 2,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { success: successCount, errors };
  },

  /**
   * 从CSV字符串导入投资目标
   */
  importTargets(csvContent: string, options: { skipExisting?: boolean } = {}): {
    success: number;
    errors: Array<{ row: number; error: string }>;
  } {
    const lines = csvContent.trim().split('\n').filter(line => line.trim());
    if (lines.length < 2) {
      return { success: 0, errors: [{ row: 0, error: 'CSV文件为空或格式不正确（至少需要标题行和一行数据）' }] };
    }

    const headers = parseCsvLine(lines[0]);
    const dataLines = lines.slice(1).filter(line => line.trim());
    
    if (dataLines.length === 0) {
      return { success: 0, errors: [{ row: 0, error: 'CSV文件没有数据行' }] };
    }
    
    let successCount = 0;
    const errors: Array<{ row: number; error: string }> = [];

    for (let i = 0; i < dataLines.length; i++) {
      const line = dataLines[i];
      if (!line.trim()) continue;

      try {
        const values = parseCsvLine(line);
        if (values.length < headers.length) {
          errors.push({ row: i + 2, error: '字段数量不足' });
          continue;
        }

        // 解析字段（根据headers索引，更灵活）
        const symbol = (values[headers.indexOf('symbol')] || values[1])?.trim().toUpperCase() || '';
        const target_amount = parseFloat(values[headers.indexOf('target_amount')] || values[2] || '0');
        const scope_type = (values[headers.indexOf('scope_type')] || values[3])?.trim() as 'ALL' | 'ACCOUNT';
        const account_id = (values[headers.indexOf('account_id')] || values[4]) ? parseInt(values[headers.indexOf('account_id')] || values[4] || '0', 10) : null;

        // 验证
        if (!symbol) {
          errors.push({ row: i + 2, error: '股票代码不能为空' });
          continue;
        }

        if (isNaN(target_amount) || target_amount <= 0) {
          errors.push({ row: i + 2, error: `无效的目标金额: ${values[2]}` });
          continue;
        }

        if (!['ALL', 'ACCOUNT'].includes(scope_type)) {
          errors.push({ row: i + 2, error: `无效的范围类型: ${scope_type}` });
          continue;
        }

        if (scope_type === 'ACCOUNT' && !account_id) {
          errors.push({ row: i + 2, error: 'ACCOUNT类型的目标必须指定account_id' });
          continue;
        }

        // 验证账户ID（如果提供）
        if (account_id) {
          const account = accountDao.getById(account_id);
          if (!account) {
            errors.push({ row: i + 2, error: `账户不存在: ${account_id}` });
            continue;
          }
        }

        // 检查是否已存在（如果启用跳过选项）
        if (options.skipExisting) {
          const existing = targetDao.getBySymbolAndScope(symbol, scope_type, account_id);
          if (existing) {
            continue; // 跳过已存在的目标
          }
        }

        // 创建目标
        const createRequest: CreateTargetRequest = {
          symbol,
          target_amount,
          scope_type,
          account_id: account_id || undefined,
        };

        targetService.createTarget(createRequest);
        successCount++;
      } catch (error) {
        errors.push({
          row: i + 2,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { success: successCount, errors };
  },

  /**
   * 导入所有数据（从包含所有CSV的对象）
   */
  async importAll(data: {
    accounts?: string;
    transactions?: string;
    cash_accounts?: string;
    targets?: string;
  }, options: {
    skipExisting?: boolean;
    recalculateSnapshots?: boolean;
  } = {}): Promise<{
    accounts: { success: number; errors: Array<{ row: number; error: string }> };
    transactions: { success: number; errors: Array<{ row: number; error: string }> };
    cash_accounts: { success: number; errors: Array<{ row: number; error: string }> };
    targets: { success: number; errors: Array<{ row: number; error: string }> };
  }> {
    const result = {
      accounts: { success: 0, errors: [] as Array<{ row: number; error: string }> },
      transactions: { success: 0, errors: [] as Array<{ row: number; error: string }> },
      cash_accounts: { success: 0, errors: [] as Array<{ row: number; error: string }> },
      targets: { success: 0, errors: [] as Array<{ row: number; error: string }> },
    };

    // 按顺序导入：先账户，再现金账户，再交易，最后目标
    if (data.accounts) {
      result.accounts = this.importAccounts(data.accounts, options);
    }

    if (data.cash_accounts) {
      result.cash_accounts = this.importCashAccounts(data.cash_accounts, options);
    }

    if (data.transactions) {
      result.transactions = await this.importTransactions(data.transactions, options);
    }

    if (data.targets) {
      result.targets = this.importTargets(data.targets, options);
    }

    return result;
  },
};

export default { exportService, importService };
