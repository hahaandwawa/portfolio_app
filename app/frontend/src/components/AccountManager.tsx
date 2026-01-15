import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Wallet, TrendingUp, DollarSign } from 'lucide-react';
import { accountApi } from '../api';
import type { Account, CreateAccountRequest, UpdateAccountRequest } from '../../../shared/types';

const ACCOUNT_TYPE_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  stock: { label: '股票账户', icon: <TrendingUp className="w-4 h-4" /> },
  cash: { label: '现金账户', icon: <DollarSign className="w-4 h-4" /> },
  mixed: { label: '混合账户', icon: <Wallet className="w-4 h-4" /> },
};

function AccountManager() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<CreateAccountRequest>({
    account_name: '',
    account_type: 'mixed',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);

  const fetchAccounts = async () => {
    try {
      setIsLoading(true);
      const data = await accountApi.list();
      setAccounts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取账户失败');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const handleOpenForm = (account?: Account) => {
    if (account) {
      setEditingId(account.id);
      setFormData({
        account_name: account.account_name,
        account_type: account.account_type,
        notes: account.notes || '',
      });
    } else {
      setEditingId(null);
      setFormData({
        account_name: '',
        account_type: 'mixed',
        notes: '',
      });
    }
    setIsFormOpen(true);
    setError(null);
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setFormData({
      account_name: '',
      account_type: 'mixed',
      notes: '',
    });
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      if (editingId) {
        await accountApi.update(editingId, formData);
      } else {
        await accountApi.create(formData);
      }
      await fetchAccounts();
      handleCloseForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个账户吗？删除前请确保该账户下没有交易记录、持仓或现金账户。')) {
      return;
    }

    try {
      await accountApi.delete(id);
      await fetchAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm">
        <div className="animate-pulse space-y-3">
          <div className="h-6 w-32 bg-slate-200 dark:bg-slate-700 rounded" />
          <div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
      <div className="flex items-center justify-between p-5 pb-0">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">账户管理</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            共 {accounts.length} 个账户
          </p>
        </div>
        <button
          onClick={() => handleOpenForm()}
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">添加账户</span>
        </button>
      </div>

      {error && (
        <div className="mx-5 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-600 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="p-5">
        {accounts.length === 0 ? (
          <div className="text-center py-12 text-slate-500 dark:text-slate-400">
            <Wallet className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="mb-2">暂无账户</p>
            <p className="text-xs">点击"添加账户"开始管理您的投资账户</p>
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.map((account) => {
              const typeInfo = ACCOUNT_TYPE_LABELS[account.account_type] || ACCOUNT_TYPE_LABELS.mixed;
              return (
                <div
                  key={account.id}
                  className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-lg border border-slate-200 dark:border-slate-600"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="text-slate-400 dark:text-slate-500">
                        {typeInfo.icon}
                      </div>
                      <h3 className="font-semibold text-slate-800 dark:text-slate-100">
                        {account.account_name}
                      </h3>
                      <span className="text-xs px-2 py-0.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded">
                        {typeInfo.label}
                      </span>
                      {account.id === 1 && (
                        <span className="text-xs px-2 py-0.5 bg-slate-500/10 text-slate-600 dark:text-slate-400 rounded">
                          默认账户
                        </span>
                      )}
                    </div>
                    {account.notes && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 ml-6">{account.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleOpenForm(account)}
                      className="p-2 rounded hover:bg-blue-500/10 text-slate-400 hover:text-blue-500 transition-colors"
                      title="编辑"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    {account.id !== 1 && (
                      <button
                        onClick={() => handleDelete(account.id)}
                        className="p-2 rounded hover:bg-red-500/10 text-slate-400 hover:text-red-500 transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 表单模态框 */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl p-6 w-full max-w-md border border-slate-200 dark:border-slate-700 shadow-lg">
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">
              {editingId ? '编辑账户' : '添加账户'}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  账户名称 *
                </label>
                <input
                  type="text"
                  required
                  value={formData.account_name}
                  onChange={(e) => setFormData({ ...formData, account_name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100"
                  placeholder="例如：A股账户、美股账户"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  账户类型 *
                </label>
                <select
                  value={formData.account_type}
                  onChange={(e) => setFormData({ ...formData, account_type: e.target.value as 'stock' | 'cash' | 'mixed' })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100"
                >
                  <option value="stock">股票账户</option>
                  <option value="cash">现金账户</option>
                  <option value="mixed">混合账户（股票+现金）</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  备注
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100"
                  placeholder="可选：账户说明或其他信息"
                  rows={3}
                />
              </div>

              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-600 dark:text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleCloseForm}
                  className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  {editingId ? '保存' : '添加'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default AccountManager;
