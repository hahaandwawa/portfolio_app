import { accountDao } from '../db/dao.js';
import type { Account, CreateAccountRequest, UpdateAccountRequest } from '../../shared/types.js';

/**
 * 账户服务
 */
export const accountService = {
  /**
   * 获取所有账户
   */
  getAllAccounts(): Account[] {
    return accountDao.getAll();
  },

  /**
   * 获取单个账户
   */
  getAccount(id: number): Account | null {
    return accountDao.getById(id);
  },

  /**
   * 创建账户
   */
  createAccount(data: CreateAccountRequest): Account {
    // 验证
    if (!data.account_name || data.account_name.trim() === '') {
      throw new Error('账户名称不能为空');
    }
    if (!['stock', 'cash', 'mixed'].includes(data.account_type)) {
      throw new Error('账户类型必须是 stock、cash 或 mixed');
    }

    // 检查名称是否已存在
    const existing = accountDao.getByName(data.account_name);
    if (existing) {
      throw new Error('账户名称已存在');
    }

    return accountDao.create(data);
  },

  /**
   * 更新账户
   */
  updateAccount(id: number, data: UpdateAccountRequest): Account {
    const existing = accountDao.getById(id);
    if (!existing) {
      throw new Error('账户不存在');
    }

    // 验证
    if (data.account_name !== undefined && data.account_name.trim() === '') {
      throw new Error('账户名称不能为空');
    }
    if (data.account_type !== undefined && !['stock', 'cash', 'mixed'].includes(data.account_type)) {
      throw new Error('账户类型必须是 stock、cash 或 mixed');
    }

    // 如果更新名称，检查是否与其他账户冲突
    if (data.account_name && data.account_name !== existing.account_name) {
      const nameExists = accountDao.getByName(data.account_name);
      if (nameExists && nameExists.id !== id) {
        throw new Error('账户名称已存在');
      }
    }

    return accountDao.update(id, data);
  },

  /**
   * 删除账户
   */
  deleteAccount(id: number): boolean {
    // 默认账户（ID为1）不能删除
    if (id === 1) {
      throw new Error('无法删除默认账户');
    }

    return accountDao.delete(id);
  },

  /**
   * 获取默认账户
   */
  getDefaultAccount(): Account | null {
    return accountDao.getDefault();
  },
};

export default accountService;
