import { cashAccountDao } from '../db/dao.js';
import type { CashAccount, CreateCashAccountRequest, UpdateCashAccountRequest } from '../../shared/types.js';

/**
 * 现金账户服务
 */
export const cashService = {
  /**
   * 获取所有现金账户
   */
  getAllAccounts(accountIds?: number[]): CashAccount[] {
    return cashAccountDao.getAll(accountIds);
  },

  /**
   * 获取单个现金账户
   */
  getAccount(id: number): CashAccount | null {
    return cashAccountDao.getById(id);
  },

  /**
   * 创建现金账户
   */
  createAccount(data: CreateCashAccountRequest): CashAccount {
    // 验证
    if (!data.account_name || data.account_name.trim() === '') {
      throw new Error('账户名称不能为空');
    }
    if (data.amount < 0) {
      throw new Error('金额不能为负数');
    }

    return cashAccountDao.create(data);
  },

  /**
   * 更新现金账户
   */
  updateAccount(id: number, data: UpdateCashAccountRequest): CashAccount {
    const existing = cashAccountDao.getById(id);
    if (!existing) {
      throw new Error('现金账户不存在');
    }

    // 验证
    if (data.account_name !== undefined && data.account_name.trim() === '') {
      throw new Error('账户名称不能为空');
    }
    if (data.amount !== undefined && data.amount < 0) {
      throw new Error('金额不能为负数');
    }

    return cashAccountDao.update(id, data);
  },

  /**
   * 删除现金账户
   */
  deleteAccount(id: number): boolean {
    return cashAccountDao.delete(id);
  },

  /**
   * 获取总现金余额
   */
  getTotalCash(accountIds?: number[]): number {
    return cashAccountDao.getTotalCash(accountIds);
  },

  /**
   * 调整现金账户余额（增加或减少）
   * @param id 现金账户ID
   * @param amount 调整金额（正数表示增加，负数表示减少）
   */
  adjustBalance(id: number, amount: number): CashAccount {
    const account = cashAccountDao.getById(id);
    if (!account) {
      throw new Error('现金账户不存在');
    }

    const newAmount = account.amount + amount;
    if (newAmount < 0) {
      throw new Error(`余额不足：当前余额 ${account.amount}，尝试扣除 ${Math.abs(amount)}`);
    }

    return cashAccountDao.update(id, { amount: newAmount });
  },
};

export default cashService;

