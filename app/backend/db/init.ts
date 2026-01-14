/**
 * 数据库初始化脚本
 * 运行: npm run db:init
 */

import { initDatabase, closeDatabase } from './index.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  console.log('正在初始化数据库...');
  
  // 确保数据目录存在
  const dataDir = join(__dirname, '..', '..', '..', 'data');
  mkdirSync(dataDir, { recursive: true });
  
  // 初始化数据库
  const dbPath = join(dataDir, 'portfolio-guard.db');
  await initDatabase(dbPath);
  
  console.log('数据库初始化完成!');
  console.log(`数据库路径: ${dbPath}`);
  
  closeDatabase();
}

main().catch(console.error);
