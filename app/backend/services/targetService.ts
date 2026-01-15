import { targetDao, transactionDao, accountDao } from '../db/dao.js';
import type { 
  Target, 
  CreateTargetRequest,
  UpdateTargetRequest,
  Transaction,
} from '../../shared/types.js';

/**
 * 投资目标服务 - 处理投资目标的创建、更新和计算
 */
export const targetService = {
  /**
   * 计算已投入金额（净投入）
   * BUY: qty * price + fee
   * SELL: qty * price - fee
   * invested = Σ(BUY) - Σ(SELL)
   */
  calculateInvested(symbol: string, accountIds?: number[]): number {
    const transactions = transactionDao.getBySymbol(symbol, accountIds);
    
    let invested = 0;
    for (const tx of transactions) {
      if (tx.type === 'buy') {
        invested += tx.quantity * tx.price + tx.fee;
      } else if (tx.type === 'sell') {
        invested -= tx.quantity * tx.price - tx.fee;
      }
    }
    
    return invested;
  },

  /**
   * 为目标计算并填充计算字段
   */
  enrichTarget(target: Target): Target {
    let accountIds: number[] | undefined;
    
    if (target.scope_type === 'ALL') {
      // 全账户：统计所有账户
      accountIds = undefined;
    } else {
      // 单账户：只统计指定账户
      if (!target.account_id) {
        throw new Error('ACCOUNT 类型的目标必须指定 account_id');
      }
      accountIds = [target.account_id];
    }
    
    // 计算已投入金额
    const invested = this.calculateInvested(target.symbol, accountIds);
    
    // 计算剩余金额和进度
    const remaining = target.target_amount - invested;
    const progress = target.target_amount > 0 ? invested / target.target_amount : 0;
    
    // 确定状态
    let status: 'pending' | 'completed' | 'exceeded';
    if (progress < 1) {
      status = 'pending';
    } else if (progress === 1) {
      status = 'completed';
    } else {
      status = 'exceeded';
    }
    
    // 获取范围显示文本
    let scopeDisplay: string;
    if (target.scope_type === 'ALL') {
      scopeDisplay = 'All Accounts';
    } else {
      const account = target.account_id ? accountDao.getById(target.account_id) : null;
      scopeDisplay = account ? account.account_name : `Account #${target.account_id}`;
    }
    
    return {
      ...target,
      invested,
      remaining,
      progress,
      status,
      scope_display: scopeDisplay,
    };
  },

  /**
   * 获取所有目标（带计算字段）
   */
  getAllTargets(): Target[] {
    const targets = targetDao.getAll();
    return targets.map(target => this.enrichTarget(target));
  },

  /**
   * 获取单个目标（带计算字段）
   */
  getTarget(id: number): Target | null {
    const target = targetDao.getById(id);
    if (!target) {
      return null;
    }
    return this.enrichTarget(target);
  },

  /**
   * 创建目标
   */
  createTarget(data: CreateTargetRequest): Target {
    // 验证
    if (!data.symbol || data.symbol.trim() === '') {
      throw new Error('股票代码不能为空');
    }
    
    if (typeof data.target_amount !== 'number' || data.target_amount <= 0) {
      throw new Error('目标金额必须是正数');
    }
    
    if (!['ALL', 'ACCOUNT'].includes(data.scope_type)) {
      throw new Error('范围类型必须是 ALL 或 ACCOUNT');
    }
    
    if (data.scope_type === 'ACCOUNT') {
      if (!data.account_id) {
        throw new Error('ACCOUNT 类型的目标必须指定 account_id');
      }
      // 验证账户存在
      const account = accountDao.getById(data.account_id);
      if (!account) {
        throw new Error('指定的账户不存在');
      }
    }
    
    const target = targetDao.create(data);
    return this.enrichTarget(target);
  },

  /**
   * 更新目标
   */
  updateTarget(id: number, data: UpdateTargetRequest): Target {
    const existing = targetDao.getById(id);
    if (!existing) {
      throw new Error('目标不存在');
    }
    
    // 验证
    if (data.target_amount !== undefined && (typeof data.target_amount !== 'number' || data.target_amount <= 0)) {
      throw new Error('目标金额必须是正数');
    }
    
    if (data.scope_type !== undefined && !['ALL', 'ACCOUNT'].includes(data.scope_type)) {
      throw new Error('范围类型必须是 ALL 或 ACCOUNT');
    }
    
    // 如果更新 scope_type 为 ACCOUNT，需要验证 account_id
    if (data.scope_type === 'ACCOUNT' || (data.scope_type === undefined && existing.scope_type === 'ACCOUNT' && data.account_id !== undefined)) {
      const accountId = data.account_id !== undefined ? data.account_id : existing.account_id;
      if (!accountId) {
        throw new Error('ACCOUNT 类型的目标必须指定 account_id');
      }
      const account = accountDao.getById(accountId);
      if (!account) {
        throw new Error('指定的账户不存在');
      }
    }
    
    const target = targetDao.update(id, data);
    return this.enrichTarget(target);
  },

  /**
   * 删除目标
   */
  deleteTarget(id: number): boolean {
    return targetDao.delete(id);
  },
};

export default targetService;
