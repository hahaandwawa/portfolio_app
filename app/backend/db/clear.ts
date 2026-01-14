/**
 * 清空所有数据脚本
 * 运行: npm run db:clear
 * 
 * 警告：此操作会删除所有数据，包括：
 * - 所有交易记录
 * - 所有持仓
 * - 所有快照
 * - 所有现金账户
 * - 所有设置（会恢复为默认值）
 */

import { initDatabase, closeDatabase, getDatabase } from './index.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  console.log('正在连接数据库...');
  
  // 确保数据目录存在
  const dataDir = join(__dirname, '..', '..', '..', 'data');
  const dbPath = join(dataDir, 'portfolio-guard.db');
  
  // 初始化数据库连接
  await initDatabase(dbPath);
  const db = getDatabase();
  
  console.log('开始清空数据...');
  
  try {
    // 开始事务
    db.run('BEGIN TRANSACTION');
    
    // 清空所有表
    console.log('  清空交易记录...');
    db.run('DELETE FROM transactions');
    
    console.log('  清空持仓...');
    db.run('DELETE FROM holdings');
    
    console.log('  清空原始快照...');
    db.run('DELETE FROM raw_snapshots');
    
    console.log('  清空每日快照...');
    db.run('DELETE FROM daily_snapshots');
    
    console.log('  清空现金账户...');
    db.run('DELETE FROM cash_accounts');
    
    console.log('  清空汇率...');
    db.run('DELETE FROM fx_rates');
    
    console.log('  重置设置...');
    db.run('DELETE FROM settings');
    // 恢复默认设置
    db.run(`INSERT INTO settings (key, value) VALUES 
      ('refresh_interval', 'manual'),
      ('base_currency', 'USD'),
      ('default_provider', 'yahoo'),
      ('theme', 'dark')`);
    
    // 提交事务
    db.run('COMMIT');
    
    // 保存数据库
    const data = db.export();
    const buffer = Buffer.from(data);
    const { writeFileSync } = await import('fs');
    writeFileSync(dbPath, buffer);
    
    console.log('✅ 所有数据已清空！');
    console.log(`数据库路径: ${dbPath}`);
    console.log('\n注意：数据库结构保持不变，您可以重新开始录入数据。');
  } catch (error) {
    db.run('ROLLBACK');
    console.error('❌ 清空数据失败:', error);
    process.exit(1);
  } finally {
    closeDatabase();
  }
}

main().catch(console.error);

