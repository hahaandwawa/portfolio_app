/**
 * 数据库迁移脚本
 * 将现有数据库迁移到支持多账户的版本
 * 运行: npm run db:migrate
 */

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 检查列是否存在
 */
function columnExists(db: SqlJsDatabase, tableName: string, columnName: string): boolean {
  try {
    const result = db.exec(`PRAGMA table_info(${tableName})`);
    if (result.length === 0) return false;
    
    const columns = result[0].values;
    return columns.some((col: unknown[]) => col[1] === columnName);
  } catch {
    return false;
  }
}

/**
 * 检查表是否存在
 */
function tableExists(db: SqlJsDatabase, tableName: string): boolean {
  try {
    const result = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`);
    return result.length > 0 && result[0].values.length > 0;
  } catch {
    return false;
  }
}

/**
 * 查询单行
 */
function queryOne<T = Record<string, unknown>>(db: SqlJsDatabase, sql: string, params: (string | number | null)[] = []): T | null {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  
  let result: T | null = null;
  if (stmt.step()) {
    result = stmt.getAsObject() as T;
  }
  stmt.free();
  
  return result;
}

async function migrate() {
  console.log('开始数据库迁移...');
  
  const dataDir = join(__dirname, '..', '..', '..', 'data');
  mkdirSync(dataDir, { recursive: true });
  
  const dbPath = join(dataDir, 'portfolio-guard.db');
  
  // 初始化 SQL.js
  const SQL = await initSqlJs();
  
  // 如果数据库文件存在，读取它；否则创建新的
  let db: SqlJsDatabase;
  if (existsSync(dbPath)) {
    const fileBuffer = readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    console.log('数据库文件不存在，无需迁移');
    return;
  }
  
  function saveDb() {
    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(dbPath, buffer);
  }
  
  try {
    db.run('BEGIN TRANSACTION');
      // 1. 创建 accounts 表（如果不存在）
      if (!tableExists(db, 'accounts')) {
        console.log('创建 accounts 表...');
        db.run(`
          CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_name TEXT NOT NULL UNIQUE,
            account_type TEXT NOT NULL CHECK(account_type IN ('stock', 'cash', 'mixed')),
            notes TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
          )
        `);
        
        // 创建默认账户
        db.run(`
          INSERT OR IGNORE INTO accounts (id, account_name, account_type) 
          VALUES (1, '默认账户', 'mixed')
        `);
        console.log('✓ 已创建 accounts 表并添加默认账户');
      } else {
        console.log('✓ accounts 表已存在');
      }
      
      // 2. 为 transactions 表添加 account_id 列
      if (!columnExists(db, 'transactions', 'account_id')) {
        console.log('为 transactions 表添加 account_id 列...');
        // SQLite 不支持在 ALTER TABLE 中添加 NOT NULL 列（如果表中有数据）
        // 所以先添加可空列，然后更新数据，最后尝试添加约束（但SQLite不支持）
        db.run(`
          ALTER TABLE transactions 
          ADD COLUMN account_id INTEGER DEFAULT 1
        `);
        
        // 更新现有数据，设置默认账户ID
        db.run(`
          UPDATE transactions 
          SET account_id = 1 
          WHERE account_id IS NULL
        `);
        
        console.log('✓ 已为 transactions 表添加 account_id 列');
      } else {
        console.log('✓ transactions 表的 account_id 列已存在');
        // 确保现有数据都有account_id
        db.run(`
          UPDATE transactions 
          SET account_id = 1 
          WHERE account_id IS NULL
        `);
      }
      
      // 2.1. 为 transactions 表添加 cash_account_id 列
      if (!columnExists(db, 'transactions', 'cash_account_id')) {
        console.log('为 transactions 表添加 cash_account_id 列...');
        db.run(`
          ALTER TABLE transactions 
          ADD COLUMN cash_account_id INTEGER
        `);
        console.log('✓ 已为 transactions 表添加 cash_account_id 列');
      } else {
        console.log('✓ transactions 表的 cash_account_id 列已存在');
      }
      
      // 3. 为 holdings 表添加 account_id 列并更新主键
      if (!columnExists(db, 'holdings', 'account_id')) {
        console.log('为 holdings 表添加 account_id 列...');
        
        // 先删除可能存在的视图（因为它依赖holdings表）
        try {
          db.run('DROP VIEW IF EXISTS v_positions');
        } catch {
          // 忽略错误
        }
        
        // 由于 SQLite 不支持直接修改主键，我们需要重建表
        console.log('重建 holdings 表以添加 account_id 列并更新主键...');
        
        // 检查是否有数据
        const hasData = queryOne<{ count: number }>(db, 'SELECT COUNT(*) as count FROM holdings');
        const rowCount = hasData?.count || 0;
        
        if (rowCount > 0) {
          console.log(`发现 ${rowCount} 条持仓记录，将迁移到新表结构...`);
        }
        
        // 1. 创建新表
        db.run(`
          CREATE TABLE holdings_new (
            symbol TEXT NOT NULL,
            account_id INTEGER NOT NULL DEFAULT 1,
            name TEXT,
            avg_cost REAL NOT NULL CHECK(avg_cost >= 0),
            total_qty REAL NOT NULL CHECK(total_qty >= 0),
            last_price REAL DEFAULT 0,
            currency TEXT DEFAULT 'USD',
            updated_at TEXT,
            PRIMARY KEY (symbol, account_id),
            FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT
          )
        `);
        
        // 2. 复制数据（如果有）
        if (rowCount > 0) {
          db.run(`
            INSERT INTO holdings_new (symbol, account_id, name, avg_cost, total_qty, last_price, currency, updated_at)
            SELECT symbol, 1, name, avg_cost, total_qty, last_price, currency, updated_at
            FROM holdings
          `);
        }
        
        // 3. 删除旧表
        db.run('DROP TABLE holdings');
        
        // 4. 重命名新表
        db.run('ALTER TABLE holdings_new RENAME TO holdings');
        
        console.log('✓ 已为 holdings 表添加 account_id 列并更新主键');
      } else {
        console.log('✓ holdings 表的 account_id 列已存在');
        // 确保现有数据都有account_id
        db.run(`
          UPDATE holdings 
          SET account_id = 1 
          WHERE account_id IS NULL
        `);
      }
      
      // 4. 为 cash_accounts 表添加 account_id 列
      if (!columnExists(db, 'cash_accounts', 'account_id')) {
        console.log('为 cash_accounts 表添加 account_id 列...');
        db.run(`
          ALTER TABLE cash_accounts 
          ADD COLUMN account_id INTEGER DEFAULT 1
        `);
        
        // 更新现有数据
        db.run(`
          UPDATE cash_accounts 
          SET account_id = 1 
          WHERE account_id IS NULL
        `);
        
        console.log('✓ 已为 cash_accounts 表添加 account_id 列');
      } else {
        console.log('✓ cash_accounts 表的 account_id 列已存在');
        // 确保现有数据都有account_id
        db.run(`
          UPDATE cash_accounts 
          SET account_id = 1 
          WHERE account_id IS NULL
        `);
      }
      
      // 5. 创建索引
      console.log('创建索引...');
      db.run('CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_holdings_account_id ON holdings(account_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_cash_accounts_account_id ON cash_accounts(account_id)');
      console.log('✓ 索引创建完成');
      
      // 6. 更新视图（删除旧视图，创建新视图）
      console.log('更新视图...');
      try {
        db.run('DROP VIEW IF EXISTS v_positions');
      } catch {
        // 忽略错误
      }
      
      // 只有在holdings表存在时才创建视图
      if (tableExists(db, 'holdings')) {
        db.run(`
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
        WHERE h.total_qty > 0
      `);
        console.log('✓ 视图更新完成');
      }
    
    db.run('COMMIT');
    saveDb();
    console.log('\n✅ 数据库迁移完成！');
  } catch (error) {
    db.run('ROLLBACK');
    console.error('❌ 迁移失败:', error);
    throw error;
  } finally {
    db.close();
  }
}

// 运行迁移
migrate().catch((error) => {
  console.error('迁移脚本执行失败:', error);
  process.exit(1);
});
