import { cashAccountDao } from '../db/dao.js';
import type { CashAccount, CreateCashAccountRequest, UpdateCashAccountRequest } from '../../shared/types.js';

/**
 * 现金账户服务
 */
export const cashService = {
  /**
   * 获取所有现金账户
   */
  getAllAccounts(): CashAccount[] {
    return cashAccountDao.getAll();
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
  getTotalCash(): number {
    return cashAccountDao.getTotalCash();
  },
};

export default cashService;

