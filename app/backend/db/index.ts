import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let db: SqlJsDatabase | null = null;
let dbPath: string = '';
let inTransactionMode = false; // 事务模式标志，避免 run() 在事务中自动保存

/**
 * 获取数据库路径
 */
export function getDbPath(): string {
  if (dbPath) return dbPath;
  
  // 在 ES modules 中，检查是否在 Electron 环境
  // 由于 require 在 ES modules 中不可用，我们直接使用默认路径
  // Electron 环境会通过 customPath 参数传入正确的路径
  return join(__dirname, '..', '..', '..', 'data', 'portfolio-guard.db');
}

/**
 * 初始化数据库连接
 */
export async function initDatabase(customPath?: string): Promise<SqlJsDatabase> {
  if (db) {
    return db;
  }

  dbPath = customPath || getDbPath();
  
  // 确保数据目录存在
  const dbDir = dirname(dbPath);
  mkdirSync(dbDir, { recursive: true });

  // 初始化 SQL.js
  const SQL = await initSqlJs();

  // 如果数据库文件存在，读取它；否则创建新的
  if (existsSync(dbPath)) {
    const fileBuffer = readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // 如果数据库已存在，先运行迁移（添加新列等）
  if (existsSync(dbPath)) {
    try {
      // 检查是否需要迁移（检查是否有transactions表但没有account_id列）
      const hasTransactions = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='transactions'");
      if (hasTransactions.length > 0 && hasTransactions[0].values.length > 0) {
        // 检查account_id列是否存在
        const tableInfo = db.exec("PRAGMA table_info(transactions)");
        const hasAccountId = tableInfo.length > 0 && 
          tableInfo[0].values.some((col: unknown[]) => col[1] === 'account_id');
        
        if (!hasAccountId) {
          console.log('检测到需要数据库迁移，正在执行...');
          // 运行迁移逻辑（简化版，只添加必要的列）
          try {
            // 创建accounts表（如果不存在）
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
            db.run(`INSERT OR IGNORE INTO accounts (id, account_name, account_type) VALUES (1, '默认账户', 'mixed')`);
            
            // 添加account_id列
            db.run(`ALTER TABLE transactions ADD COLUMN account_id INTEGER DEFAULT 1`);
            db.run(`UPDATE transactions SET account_id = 1 WHERE account_id IS NULL`);
            
            // 重建holdings表
            const holdingsExists = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='holdings'");
            if (holdingsExists.length > 0 && holdingsExists[0].values.length > 0) {
              db.run(`CREATE TABLE holdings_new (
                symbol TEXT NOT NULL,
                account_id INTEGER NOT NULL DEFAULT 1,
                name TEXT,
                avg_cost REAL NOT NULL CHECK(avg_cost >= 0),
                total_qty REAL NOT NULL CHECK(total_qty >= 0),
                last_price REAL DEFAULT 0,
                currency TEXT DEFAULT 'USD',
                updated_at TEXT,
                PRIMARY KEY (symbol, account_id)
              )`);
              db.run(`INSERT INTO holdings_new SELECT symbol, 1, name, avg_cost, total_qty, last_price, currency, updated_at FROM holdings`);
              db.run(`DROP TABLE holdings`);
              db.run(`ALTER TABLE holdings_new RENAME TO holdings`);
            }
            
            // 添加cash_accounts的account_id
            db.run(`ALTER TABLE cash_accounts ADD COLUMN account_id INTEGER DEFAULT 1`);
            db.run(`UPDATE cash_accounts SET account_id = 1 WHERE account_id IS NULL`);
            
            // 创建索引
            db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_holdings_account_id ON holdings(account_id)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_cash_accounts_account_id ON cash_accounts(account_id)`);
            
            console.log('数据库迁移完成');
            saveDatabase();
          } catch (migrateError) {
            console.warn('自动迁移失败，请手动运行 npm run db:migrate:', migrateError);
          }
        }
      }
    } catch (error) {
      // 迁移检查失败不影响初始化
      console.warn('迁移检查失败:', error);
    }
  }

  // 执行 schema 初始化（即使数据库已存在，也会执行 CREATE TABLE IF NOT EXISTS）
  const schemaPath = join(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');
  try {
    db.run(schema);
    // 保存到文件
    saveDatabase();
  } catch (error) {
    console.error('执行数据库schema失败:', error);
    // 即使出错也继续，因为可能是表已存在
    if (error instanceof Error && !error.message.includes('already exists') && !error.message.includes('duplicate column')) {
      throw error;
    }
  }

  console.log(`数据库已初始化: ${dbPath}`);
  return db;
}

/**
 * 获取数据库实例（同步版本，用于已初始化后的调用）
 */
export function getDatabase(): SqlJsDatabase {
  if (!db) {
    throw new Error('数据库未初始化，请先调用 initDatabase()');
  }
  return db;
}

/**
 * 保存数据库到文件
 */
export function saveDatabase(): void {
  if (db && dbPath) {
    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(dbPath, buffer);
  }
}

/**
 * 关闭数据库连接
 */
export function closeDatabase(): void {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
    console.log('数据库连接已关闭');
  }
}

/**
 * 在事务中执行操作
 * 事务期间 run() 不会自动保存，事务结束后统一保存
 */
export function withTransaction<T>(fn: () => T): T {
  const database = getDatabase();
  let transactionStarted = false;
  
  try {
    database.run('BEGIN TRANSACTION');
    transactionStarted = true;
    inTransactionMode = true; // 进入事务模式
    
    const result = fn();
    
    database.run('COMMIT');
    transactionStarted = false;
    inTransactionMode = false; // 退出事务模式
    saveDatabase(); // 事务成功后统一保存
    return result;
  } catch (error) {
    inTransactionMode = false; // 确保退出事务模式
    if (transactionStarted) {
      try {
        database.run('ROLLBACK');
      } catch {
        // 忽略回滚错误
      }
    }
    throw error;
  }
}

/**
 * 执行 SQL 查询并返回所有结果
 */
export function query<T = Record<string, unknown>>(sql: string, params: (string | number | null)[] = []): T[] {
  const database = getDatabase();
  const stmt = database.prepare(sql);
  stmt.bind(params);
  
  const results: T[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as T;
    results.push(row);
  }
  stmt.free();
  
  return results;
}

/**
 * 执行 SQL 查询并返回单行结果
 */
export function queryOne<T = Record<string, unknown>>(sql: string, params: (string | number | null)[] = []): T | null {
  const results = query<T>(sql, params);
  return results.length > 0 ? results[0] : null;
}

/**
 * 执行 SQL 命令（INSERT/UPDATE/DELETE）
 * 在事务模式下不自动保存，由 withTransaction 统一保存
 */
export function run(sql: string, params: (string | number | null)[] = []): { changes: number; lastInsertRowid: number } {
  const database = getDatabase();
  
  // 使用 prepared statement 来正确绑定参数
  const stmt = database.prepare(sql);
  try {
    stmt.bind(params);
    stmt.step();
    
    // 获取最后插入的行 ID 和影响的行数
    const lastIdResult = database.exec('SELECT last_insert_rowid() as id');
    const changesResult = database.exec('SELECT changes() as changes');
    
    const lastInsertRowid = lastIdResult[0]?.values[0]?.[0] as number || 0;
    const changes = changesResult[0]?.values[0]?.[0] as number || 0;
    
    // 只在非事务模式下自动保存
    if (!inTransactionMode) {
      saveDatabase();
    }
    
    return { changes, lastInsertRowid };
  } finally {
    stmt.free();
  }
}

/**
 * 备份数据库
 */
export function backupDatabase(targetPath: string): void {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(targetPath, buffer);
    console.log(`数据库已备份至: ${targetPath}`);
  }
}

export default {
  initDatabase,
  getDatabase,
  closeDatabase,
  withTransaction,
  query,
  queryOne,
  run,
  saveDatabase,
  backupDatabase,
  getDbPath,
};
