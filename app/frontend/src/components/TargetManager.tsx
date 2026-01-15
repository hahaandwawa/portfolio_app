import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Target as TargetIcon, CheckCircle, AlertCircle, TrendingUp } from 'lucide-react';
import { targetApi, accountApi } from '../api';
import type { Target, CreateTargetRequest, UpdateTargetRequest, Account } from '../../../shared/types';
import { formatCurrency, formatPercent } from '../utils/format';

function TargetManager() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<CreateTargetRequest>({
    symbol: '',
    target_amount: 0,
    scope_type: 'ALL',
    account_id: null,
  });
  const [error, setError] = useState<string | null>(null);

  const fetchTargets = async () => {
    try {
      setIsLoading(true);
      const data = await targetApi.list();
      setTargets(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取投资目标失败');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAccounts = async () => {
    try {
      const data = await accountApi.list();
      setAccounts(data);
    } catch (err) {
      console.error('获取账户失败:', err);
    }
  };

  useEffect(() => {
    fetchTargets();
    fetchAccounts();
  }, []);

  const handleOpenForm = (target?: Target) => {
    if (target) {
      setEditingId(target.id);
      setFormData({
        symbol: target.symbol,
        target_amount: target.target_amount,
        scope_type: target.scope_type,
        account_id: target.account_id,
      });
    } else {
      setEditingId(null);
      setFormData({
        symbol: '',
        target_amount: 0,
        scope_type: 'ALL',
        account_id: null,
      });
    }
    setIsFormOpen(true);
    setError(null);
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setFormData({
      symbol: '',
      target_amount: 0,
      scope_type: 'ALL',
      account_id: null,
    });
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // 验证
    if (!formData.symbol || formData.symbol.trim() === '') {
      setError('股票代码不能为空');
      return;
    }

    if (formData.target_amount <= 0) {
      setError('目标金额必须大于0');
      return;
    }

    if (formData.scope_type === 'ACCOUNT' && !formData.account_id) {
      setError('选择单账户时必须指定账户');
      return;
    }

    try {
      if (editingId) {
        await targetApi.update(editingId, formData);
      } else {
        await targetApi.create(formData);
      }
      await fetchTargets();
      handleCloseForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个投资目标吗？')) {
      return;
    }

    try {
      await targetApi.delete(id);
      await fetchTargets();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'exceeded':
        return <TrendingUp className="w-5 h-5 text-orange-500" />;
      default:
        return <AlertCircle className="w-5 h-5 text-blue-500" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed':
        return '已完成';
      case 'exceeded':
        return '超出目标';
      default:
        return '进行中';
    }
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm p-6">
        <div className="flex items-center justify-center py-8">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <TargetIcon className="w-6 h-6 text-blue-500" />
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">投资目标</h2>
        </div>
        <button
          onClick={() => handleOpenForm()}
          className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          新建目标
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      {targets.length === 0 ? (
        <div className="text-center py-12 text-slate-500 dark:text-slate-400">
          <TargetIcon className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>暂无投资目标</p>
          <p className="text-sm mt-2">点击"新建目标"开始设置投资目标</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-700 dark:text-slate-300">股票</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-slate-700 dark:text-slate-300">范围</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-slate-700 dark:text-slate-300">目标金额</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-slate-700 dark:text-slate-300">已投入</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-slate-700 dark:text-slate-300">剩余</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-slate-700 dark:text-slate-300">进度</th>
                <th className="text-center py-3 px-4 text-sm font-medium text-slate-700 dark:text-slate-300">状态</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-slate-700 dark:text-slate-300">操作</th>
              </tr>
            </thead>
            <tbody>
              {targets.map((target) => (
                <tr
                  key={target.id}
                  className="border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
                >
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-900 dark:text-slate-100">{target.symbol}</div>
                  </td>
                  <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                    {target.scope_display || (target.scope_type === 'ALL' ? 'All Accounts' : `Account #${target.account_id}`)}
                  </td>
                  <td className="py-3 px-4 text-right font-medium text-slate-900 dark:text-slate-100">
                    {formatCurrency(target.target_amount)}
                  </td>
                  <td className="py-3 px-4 text-right text-slate-600 dark:text-slate-400">
                    {formatCurrency(target.invested || 0)}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className={target.remaining && target.remaining >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                      {formatCurrency(target.remaining || 0)}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-24 bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            (target.progress || 0) >= 1
                              ? 'bg-green-500'
                              : (target.progress || 0) > 0.8
                              ? 'bg-blue-500'
                              : 'bg-blue-400'
                          }`}
                          style={{ width: `${Math.min((target.progress || 0) * 100, 100)}%` }}
                        />
                      </div>
                      <span className="text-sm text-slate-600 dark:text-slate-400 min-w-[3rem] text-right">
                        {((target.progress || 0) * 100).toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-center gap-2">
                      {getStatusIcon(target.status || 'pending')}
                      <span className="text-sm text-slate-600 dark:text-slate-400">
                        {getStatusText(target.status || 'pending')}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleOpenForm(target)}
                        className="p-2 text-slate-600 dark:text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                        title="编辑"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(target.id)}
                        className="p-2 text-slate-600 dark:text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 表单弹窗 */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {editingId ? '编辑目标' : '新建目标'}
                </h3>
                <button
                  onClick={handleCloseForm}
                  className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    股票代码 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.symbol}
                    onChange={(e) => setFormData({ ...formData, symbol: e.target.value.toUpperCase() })}
                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="例如: NVDA"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    目标金额 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={formData.target_amount || ''}
                    onChange={(e) => setFormData({ ...formData, target_amount: parseFloat(e.target.value) || 0 })}
                    className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="例如: 10000"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    作用范围 <span className="text-red-500">*</span>
                  </label>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 p-3 border border-slate-300 dark:border-slate-600 rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                      <input
                        type="radio"
                        name="scope_type"
                        value="ALL"
                        checked={formData.scope_type === 'ALL'}
                        onChange={(e) => setFormData({ ...formData, scope_type: 'ALL', account_id: null })}
                        className="w-4 h-4 text-blue-500"
                      />
                      <span className="text-slate-700 dark:text-slate-300">所有账户</span>
                    </label>
                    <label className="flex items-center gap-2 p-3 border border-slate-300 dark:border-slate-600 rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                      <input
                        type="radio"
                        name="scope_type"
                        value="ACCOUNT"
                        checked={formData.scope_type === 'ACCOUNT'}
                        onChange={(e) => setFormData({ ...formData, scope_type: 'ACCOUNT' })}
                        className="w-4 h-4 text-blue-500"
                      />
                      <span className="text-slate-700 dark:text-slate-300">指定账户</span>
                    </label>
                  </div>
                </div>

                {formData.scope_type === 'ACCOUNT' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      选择账户 <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.account_id || ''}
                      onChange={(e) => setFormData({ ...formData, account_id: parseInt(e.target.value) || null })}
                      className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      required={formData.scope_type === 'ACCOUNT'}
                    >
                      <option value="">请选择账户</option>
                      {accounts.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.account_name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {error && (
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
                    {error}
                  </div>
                )}

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={handleCloseForm}
                    className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
                  >
                    {editingId ? '更新' : '创建'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TargetManager;
