import Fastify from 'fastify';
import cors from '@fastify/cors';
import { initDatabase, closeDatabase } from './db/index.js';
import { transactionService, TransactionError } from './services/transactionService.js';
import { holdingService } from './services/holdingService.js';
import { marketDataService } from './services/marketDataService.js';
import { analyticsService } from './services/analyticsService.js';
import { snapshotService } from './services/snapshotService.js';
import { cashService } from './services/cashService.js';
import { accountService } from './services/accountService.js';
import { targetService } from './services/targetService.js';
import { settingsDao } from './db/dao.js';
import { yahooProvider } from './providers/yahoo.js';
import { alphaVantageProvider } from './providers/alphaVantage.js';
import { getTodayET } from '../shared/timeUtils.js';
import type { 
  CreateTransactionRequest,
  UpdateTransactionRequest,
  TransactionQuery, 
  RefreshPricesRequest,
  SnapshotQuery,
  CreateCashAccountRequest,
  UpdateCashAccountRequest,
  CreateAccountRequest,
  UpdateAccountRequest,
  CreateTargetRequest,
  UpdateTargetRequest,
} from '../shared/types.js';

// 创建 Fastify 实例
const fastify = Fastify({
  logger: true,
});

// 错误处理
fastify.setErrorHandler((error, request, reply) => {
  if (error instanceof TransactionError) {
    reply.status(error.statusCode).send({
      success: false,
      error: error.message,
      code: error.statusCode,
    });
  } else {
    fastify.log.error(error);
    reply.status(500).send({
      success: false,
      error: '服务器内部错误',
      code: 500,
    });
  }
});

// ==================== 交易 API ====================

// 创建交易
fastify.post<{ Body: CreateTransactionRequest }>('/api/transactions', async (request, reply) => {
  const result = await transactionService.createTransaction(request.body);
  
  // 从交易日期开始，重新计算之后所有日期的快照
  try {
    const today = getTodayET();
    const tradeDate = request.body.trade_date;
    
    if (tradeDate <= today) {
      fastify.log.info(`交易日期 ${tradeDate}，开始重新计算从该日期到今天的快照...`);
      await snapshotService.recalculateSnapshotsFromDate(tradeDate);
      fastify.log.info(`快照重新计算完成`);
    }
  } catch (error) {
    // 快照生成失败不影响交易创建，只记录日志
    fastify.log.warn({ error }, '重新计算快照失败，但不影响交易创建');
  }
  
  return {
    success: true,
    data: result,
  };
});

// 查询交易列表
fastify.get<{ Querystring: TransactionQuery }>('/api/transactions', async (request, reply) => {
  // 处理account_ids参数（可能是逗号分隔的字符串）
  const query = { ...request.query };
  if (query.account_ids && typeof query.account_ids === 'string') {
    query.account_ids = query.account_ids.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id));
  }
  const result = transactionService.queryTransactions(query);
  return {
    success: true,
    data: result,
  };
});

// 更新交易
fastify.put<{ Params: { id: string }; Body: UpdateTransactionRequest }>('/api/transactions/:id', async (request, reply) => {
  try {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) {
      reply.status(400).send({
        success: false,
        error: '无效的交易ID',
        code: 400,
      });
      return;
    }
    
    fastify.log.info({ id, body: request.body }, `[API] 更新交易记录: ID=${id}`);
    
    const result = await transactionService.updateTransaction(id, request.body);
    
    // 确认更新成功
    if (!result || !result.transaction) {
      fastify.log.error(`[API] 更新交易记录失败：返回结果无效 ID=${id}`);
      reply.status(500).send({
        success: false,
        error: '更新交易记录失败：返回结果无效',
        code: 500,
      });
      return;
    }
    
    fastify.log.info(`[API] ✅ 交易记录更新成功: ID=${id}`);
    
    // 从交易日期开始，重新计算之后所有日期的快照
    try {
      const today = getTodayET();
      const tradeDate = result.transaction.trade_date;
      
      if (tradeDate <= today) {
        fastify.log.info(`交易日期 ${tradeDate}，开始重新计算从该日期到今天的快照...`);
        await snapshotService.recalculateSnapshotsFromDate(tradeDate);
        fastify.log.info(`快照重新计算完成`);
      }
    } catch (error) {
      fastify.log.warn({ error }, '重新计算快照失败，但不影响交易更新');
    }
    
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    fastify.log.error({ error }, `[API] ❌ 更新交易记录失败`);
    if (error instanceof TransactionError) {
      reply.status(error.statusCode).send({
        success: false,
        error: error.message,
        code: error.statusCode,
      });
    } else {
      fastify.log.error(error);
      reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : '更新交易失败',
        code: 500,
      });
    }
  }
});

// 删除交易
fastify.delete<{ Params: { id: string } }>('/api/transactions/:id', async (request, reply) => {
  try {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) {
      reply.status(400).send({
        success: false,
        error: '无效的交易ID',
        code: 400,
      });
      return;
    }
    
    fastify.log.info(`[API] 删除交易记录: ID=${id}`);
    
    // 在删除前获取交易信息（用于后续生成快照）
    const { transactionDao } = await import('./db/dao.js');
    const transaction = transactionDao.getById(id);
    const tradeDate = transaction?.trade_date;
    
    const deleted = transactionService.deleteTransaction(id);
    if (!deleted) {
      fastify.log.warn(`[API] ⚠️ 删除交易记录失败：返回 false ID=${id}`);
      reply.status(404).send({
        success: false,
        error: '交易记录不存在或删除失败',
        code: 404,
      });
      return;
    }
    
    // 从交易日期开始，重新计算之后所有日期的快照（删除后持仓已更新）
    if (tradeDate) {
      try {
        const today = getTodayET();
        
        if (tradeDate <= today) {
          fastify.log.info(`交易日期 ${tradeDate}，开始重新计算从该日期到今天的快照...`);
          await snapshotService.recalculateSnapshotsFromDate(tradeDate);
          fastify.log.info(`快照重新计算完成`);
        }
      } catch (error) {
        fastify.log.warn({ error }, '重新计算快照失败，但不影响交易删除');
      }
    }
    
    fastify.log.info(`[API] ✅ 交易记录删除成功: ID=${id}`);
    return {
      success: true,
      message: '交易记录已成功删除',
    };
  } catch (error) {
    fastify.log.error({ error }, `[API] ❌ 删除交易记录失败`);
    if (error instanceof TransactionError) {
      reply.status(error.statusCode).send({
        success: false,
        error: error.message,
        code: error.statusCode,
      });
    } else {
      const errorMessage = error instanceof Error ? error.message : '删除交易失败';
      fastify.log.error({ error }, `删除交易失败: ${errorMessage}`);
      reply.status(500).send({
        success: false,
        error: errorMessage,
        code: 500,
      });
    }
  }
});

// 导出交易 CSV
fastify.get('/api/export/transactions.csv', async (request, reply) => {
  const csv = transactionService.exportToCsv();
  reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', 'attachment; filename="transactions.csv"')
    .send(csv);
});

// ==================== 持仓 API ====================

// 获取所有持仓
fastify.get<{ Querystring: { account_ids?: string } }>('/api/holdings', async (request, reply) => {
  let accountIds: number[] | undefined;
  if (request.query.account_ids) {
    accountIds = request.query.account_ids.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id));
  }
  const holdings = holdingService.getAllHoldings(accountIds);
  return {
    success: true,
    data: holdings,
  };
});

// 获取持仓占比分布
fastify.get<{ Querystring: { account_ids?: string } }>('/api/holdings/distribution', async (request, reply) => {
  let accountIds: number[] | undefined;
  if (request.query.account_ids) {
    accountIds = request.query.account_ids.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id));
  }
  const distribution = holdingService.getWeightDistribution(accountIds);
  return {
    success: true,
    data: distribution,
  };
});

// ==================== 行情 API ====================

// 刷新价格
fastify.post<{ Body: RefreshPricesRequest }>('/api/refresh-prices', async (request, reply) => {
  const { symbols, provider } = request.body || {};
  
  let result;
  if (symbols && symbols.length > 0) {
    result = await marketDataService.refreshPrices(symbols, provider);
  } else {
    result = await marketDataService.refreshAllPrices(provider);
  }
  
  return {
    success: true,
    data: result,
  };
});

// 获取单个股票行情
fastify.get<{ Params: { symbol: string }; Querystring: { provider?: string } }>(
  '/api/quote/:symbol',
  async (request, reply) => {
    const quote = await marketDataService.getQuote(request.params.symbol, request.query.provider);
    return {
      success: true,
      data: quote,
    };
  }
);

// ==================== 分析 API ====================

// 获取总览
fastify.get<{ Querystring: { account_ids?: string } }>('/api/analytics/overview', async (request, reply) => {
  try {
    let accountIds: number[] | undefined;
    if (request.query.account_ids) {
      accountIds = request.query.account_ids.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id));
    }
    const overview = await analyticsService.getOverview(accountIds);
    return {
      success: true,
      data: overview,
    };
  } catch (error) {
    console.error('获取总览失败:', error);
    reply.code(500);
    return {
      success: false,
      error: error instanceof Error ? error.message : '获取总览失败',
    };
  }
});

// 获取第一条记录的日期
fastify.get('/api/analytics/first-record-date', async (request, reply) => {
  try {
    const firstDate = analyticsService.getFirstRecordDate();
    return {
      success: true,
      data: firstDate,
    };
  } catch (error) {
    fastify.log.error(error);
    reply.status(500).send({
      success: false,
      error: error instanceof Error ? error.message : '获取第一条记录日期失败',
      code: 500,
    });
  }
});

// 获取快照/净值曲线
fastify.get<{ Querystring: SnapshotQuery }>('/api/analytics/snapshots', async (request, reply) => {
  try {
    const { from, to, account_ids } = request.query;
    
    // 处理account_ids参数
    let accountIds: number[] | undefined;
    if (account_ids && typeof account_ids === 'string') {
      accountIds = account_ids.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id));
    }
    
    // 获取第一条记录的日期
    const firstRecordDate = analyticsService.getFirstRecordDate();
    
    // 如果没有指定 from，使用第一条记录的日期或最近 90 天（取较晚的）
    const toDate = to || getTodayET();
    let fromDate = from;
    
    if (!fromDate) {
      // 默认最近 90 天
      const defaultFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      // 如果有第一条记录日期，使用两者中较晚的（确保不早于第一条记录）
      if (firstRecordDate) {
        fromDate = firstRecordDate > defaultFrom ? firstRecordDate : defaultFrom;
      } else {
        fromDate = defaultFrom;
      }
    }
    
    const curve = await analyticsService.getNetValueCurve(fromDate, toDate, accountIds);
    return {
      success: true,
      data: curve,
    };
  } catch (error) {
    fastify.log.error(error);
    reply.status(500).send({
      success: false,
      error: error instanceof Error ? error.message : '获取净值曲线失败',
      code: 500,
    });
  }
});

// 获取对比数据
fastify.get<{ Querystring: { from?: string; to?: string; index?: string } }>(
  '/api/analytics/comparison',
  async (request, reply) => {
    const { from, to, index } = request.query;
    
    const toDate = to || getTodayET();
    const fromDate = from || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const indexSymbol = index || '000300.SS';
    
    const data = await analyticsService.getComparisonData(fromDate, toDate, indexSymbol);
    return {
      success: true,
      data,
    };
  }
);

// 获取收益统计
fastify.get<{ Querystring: { from?: string; to?: string } }>(
  '/api/analytics/stats',
  async (request, reply) => {
    try {
      const { from, to } = request.query;
      
      const toDate = to || getTodayET();
      const fromDate = from || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      const stats = await analyticsService.calculateStats(fromDate, toDate);
      return {
        success: true,
        data: stats,
      };
    } catch (error) {
      fastify.log.error(error);
      reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : '计算统计数据失败',
        code: 500,
      });
    }
  }
);

// ==================== 快照 API ====================

// 重新构建历史每日数据
fastify.post('/api/snapshots/rebuild', async (request, reply) => {
  try {
    fastify.log.info('开始重新构建历史每日数据...');
    
    // 获取最早的交易日期
    const firstRecordDate = analyticsService.getFirstRecordDate();
    
    if (!firstRecordDate) {
      fastify.log.warn('没有找到交易记录，无法重新构建历史数据');
      return {
        success: true,
        message: '没有交易记录，无需重新构建',
        data: { rebuilt: 0 },
      };
    }
    
    fastify.log.info(`最早的交易日期: ${firstRecordDate}`);
    
    // 清空所有快照数据
    const { getDatabase, withTransaction } = await import('./db/index.js');
    const db = getDatabase();
    
    fastify.log.info('正在清空所有快照数据...');
    withTransaction(() => {
      db.run('DELETE FROM raw_snapshots');
      db.run('DELETE FROM daily_snapshots');
    });
    fastify.log.info('快照数据已清空');
    
    // 从最早交易日期开始，重新计算所有日期的快照
    fastify.log.info(`从 ${firstRecordDate} 开始重新计算快照...`);
    await snapshotService.recalculateSnapshotsFromDate(firstRecordDate);
    
    fastify.log.info('历史每日数据重新构建完成');
    
    return {
      success: true,
      message: '历史每日数据已重新构建',
      data: {
        firstRecordDate,
        rebuilt: true,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '重新构建历史数据失败';
    const errorStack = error instanceof Error ? error.stack : String(error);
    fastify.log.error({ error, errorMessage, errorStack }, '重新构建历史数据失败');
    reply.status(500).send({
      success: false,
      error: errorMessage,
      code: 500,
    });
  }
});

// ==================== 账户 API ====================

// 获取所有账户
fastify.get('/api/accounts', async (request, reply) => {
  try {
    const accounts = accountService.getAllAccounts();
    return {
      success: true,
      data: accounts,
    };
  } catch (error) {
    fastify.log.error(error);
    reply.status(500).send({
      success: false,
      error: error instanceof Error ? error.message : '获取账户失败',
      code: 500,
    });
  }
});

// 创建账户
fastify.post<{ Body: CreateAccountRequest }>('/api/accounts', async (request, reply) => {
  try {
    const account = accountService.createAccount(request.body);
    return {
      success: true,
      data: account,
    };
  } catch (error) {
    fastify.log.error(error);
    reply.status(400).send({
      success: false,
      error: error instanceof Error ? error.message : '创建账户失败',
      code: 400,
    });
  }
});

// 更新账户
fastify.put<{ Params: { id: string }; Body: UpdateAccountRequest }>('/api/accounts/:id', async (request, reply) => {
  try {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) {
      reply.status(400).send({
        success: false,
        error: '无效的账户ID',
        code: 400,
      });
      return;
    }
    
    const account = accountService.updateAccount(id, request.body);
    return {
      success: true,
      data: account,
    };
  } catch (error) {
    fastify.log.error(error);
    reply.status(400).send({
      success: false,
      error: error instanceof Error ? error.message : '更新账户失败',
      code: 400,
    });
  }
});

// 删除账户
fastify.delete<{ Params: { id: string } }>('/api/accounts/:id', async (request, reply) => {
  try {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) {
      reply.status(400).send({
        success: false,
        error: '无效的账户ID',
        code: 400,
      });
      return;
    }
    
    const deleted = accountService.deleteAccount(id);
    if (!deleted) {
      reply.status(404).send({
        success: false,
        error: '账户不存在',
        code: 404,
      });
      return;
    }
    
    return {
      success: true,
    };
  } catch (error) {
    fastify.log.error(error);
    reply.status(400).send({
      success: false,
      error: error instanceof Error ? error.message : '删除账户失败',
      code: 400,
    });
  }
});

// ==================== 现金账户 API ====================

// 获取所有现金账户
fastify.get<{ Querystring: { account_ids?: string } }>('/api/cash-accounts', async (request, reply) => {
  try {
    let accountIds: number[] | undefined;
    if (request.query.account_ids) {
      accountIds = request.query.account_ids.split(',').map(id => parseInt(id, 10)).filter(id => !isNaN(id));
    }
    const accounts = cashService.getAllAccounts(accountIds);
    return {
      success: true,
      data: accounts,
    };
  } catch (error) {
    fastify.log.error(error);
    reply.status(500).send({
      success: false,
      error: error instanceof Error ? error.message : '获取现金账户失败',
      code: 500,
    });
  }
});

// 创建现金账户
fastify.post<{ Body: CreateCashAccountRequest }>('/api/cash-accounts', async (request, reply) => {
  try {
    const account = cashService.createAccount(request.body);
    return {
      success: true,
      data: account,
    };
  } catch (error) {
    fastify.log.error(error);
    reply.status(400).send({
      success: false,
      error: error instanceof Error ? error.message : '创建现金账户失败',
      code: 400,
    });
  }
});

// 更新现金账户
fastify.put<{ Params: { id: string }; Body: UpdateCashAccountRequest }>('/api/cash-accounts/:id', async (request, reply) => {
  try {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) {
      reply.status(400).send({
        success: false,
        error: '无效的账户ID',
        code: 400,
      });
      return;
    }
    
    const account = cashService.updateAccount(id, request.body);
    return {
      success: true,
      data: account,
    };
  } catch (error) {
    fastify.log.error(error);
    reply.status(400).send({
      success: false,
      error: error instanceof Error ? error.message : '更新现金账户失败',
      code: 400,
    });
  }
});

// 删除现金账户
fastify.delete<{ Params: { id: string } }>('/api/cash-accounts/:id', async (request, reply) => {
  try {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) {
      reply.status(400).send({
        success: false,
        error: '无效的账户ID',
        code: 400,
      });
      return;
    }
    
    const deleted = cashService.deleteAccount(id);
    if (!deleted) {
      reply.status(404).send({
        success: false,
        error: '现金账户不存在',
        code: 404,
      });
      return;
    }
    
    return {
      success: true,
    };
  } catch (error) {
    fastify.log.error(error);
    reply.status(500).send({
      success: false,
      error: error instanceof Error ? error.message : '删除现金账户失败',
      code: 500,
    });
  }
});

// ==================== 投资目标 API ====================

// 获取所有目标
fastify.get('/api/targets', async (request, reply) => {
  try {
    const targets = targetService.getAllTargets();
    return {
      success: true,
      data: targets,
    };
  } catch (error) {
    fastify.log.error(error);
    reply.status(500).send({
      success: false,
      error: error instanceof Error ? error.message : '获取投资目标失败',
      code: 500,
    });
  }
});

// 获取单个目标
fastify.get<{ Params: { id: string } }>('/api/targets/:id', async (request, reply) => {
  try {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) {
      reply.status(400).send({
        success: false,
        error: '无效的目标ID',
        code: 400,
      });
      return;
    }
    
    const target = targetService.getTarget(id);
    if (!target) {
      reply.status(404).send({
        success: false,
        error: '目标不存在',
        code: 404,
      });
      return;
    }
    
    return {
      success: true,
      data: target,
    };
  } catch (error) {
    fastify.log.error(error);
    reply.status(500).send({
      success: false,
      error: error instanceof Error ? error.message : '获取投资目标失败',
      code: 500,
    });
  }
});

// 创建目标
fastify.post<{ Body: CreateTargetRequest }>('/api/targets', async (request, reply) => {
  try {
    const target = targetService.createTarget(request.body);
    return {
      success: true,
      data: target,
    };
  } catch (error) {
    fastify.log.error(error);
    reply.status(400).send({
      success: false,
      error: error instanceof Error ? error.message : '创建投资目标失败',
      code: 400,
    });
  }
});

// 更新目标
fastify.put<{ Params: { id: string }; Body: UpdateTargetRequest }>('/api/targets/:id', async (request, reply) => {
  try {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) {
      reply.status(400).send({
        success: false,
        error: '无效的目标ID',
        code: 400,
      });
      return;
    }
    
    const target = targetService.updateTarget(id, request.body);
    return {
      success: true,
      data: target,
    };
  } catch (error) {
    fastify.log.error(error);
    reply.status(400).send({
      success: false,
      error: error instanceof Error ? error.message : '更新投资目标失败',
      code: 400,
    });
  }
});

// 删除目标
fastify.delete<{ Params: { id: string } }>('/api/targets/:id', async (request, reply) => {
  try {
    const id = parseInt(request.params.id, 10);
    if (isNaN(id)) {
      reply.status(400).send({
        success: false,
        error: '无效的目标ID',
        code: 400,
      });
      return;
    }
    
    const deleted = targetService.deleteTarget(id);
    if (!deleted) {
      reply.status(404).send({
        success: false,
        error: '目标不存在',
        code: 404,
      });
      return;
    }
    
    return {
      success: true,
    };
  } catch (error) {
    fastify.log.error(error);
    reply.status(500).send({
      success: false,
      error: error instanceof Error ? error.message : '删除投资目标失败',
      code: 500,
    });
  }
});

// ==================== 设置 API ====================

// 获取设置
fastify.get('/api/settings', async (request, reply) => {
  const settings = settingsDao.getAll();
  return {
    success: true,
    data: settings,
  };
});

// 更新设置
fastify.post<{ Body: Record<string, string> }>('/api/settings', async (request, reply) => {
  settingsDao.setMany(request.body);
  return {
    success: true,
  };
});

// ==================== 健康检查 ====================

fastify.get('/api/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// ==================== 启动服务器 ====================

export async function startServer(port: number = 3001, host: string = '127.0.0.1') {
  try {
    // 注册 CORS
    await fastify.register(cors, {
      origin: true,
    });
    
    // 初始化数据库（异步）
    await initDatabase();
    
    // 注册行情 Provider
    marketDataService.registerProvider(yahooProvider);
    marketDataService.registerProvider(alphaVantageProvider);
    
    // 设置默认 provider（优先使用 yahoo，失败时自动降级到 alphavantage）
    marketDataService.setDefaultProvider('yahoo');
    
    // 启动自动快照任务（开盘和收市）
    const { cleanup: cleanupSnapshots } = snapshotService.scheduleAutoSnapshots();
    
    // 处理退出事件
    process.on('SIGINT', () => {
      cleanupSnapshots();
      closeDatabase();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      cleanupSnapshots();
      closeDatabase();
      process.exit(0);
    });
    
    // 启动服务器
    await fastify.listen({ port, host });
    console.log(`服务器已启动: http://${host}:${port}`);
    console.log('自动快照已启动：每天 09:30 ET（开盘）和 16:00 ET（4:00 PM，收市）自动生成快照');
    
    return fastify;
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

// 启动服务器
startServer();

export default fastify;
