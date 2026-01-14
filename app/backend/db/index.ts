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
    if (error instanceof Error && !error.message.includes('already exists')) {
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
