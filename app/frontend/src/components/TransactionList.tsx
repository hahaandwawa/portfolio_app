import { useState, useEffect } from 'react';
import { Trash2, Edit2, ChevronLeft, ChevronRight, ArrowDown, ArrowUp } from 'lucide-react';
import { usePortfolioStore } from '../store';
import { accountApi } from '../api';
import { formatCurrency, formatNumber } from '../utils/format';
import type { Transaction, UpdateTransactionRequest, Account } from '../../../shared/types';

const PAGE_SIZE = 10;

function TransactionList() {
  const { transactions, transactionsTotal, fetchTransactions, updateTransaction, deleteTransaction, isLoadingTransactions } = usePortfolioStore();
  const [currentPage, setCurrentPage] = useState(1);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<UpdateTransactionRequest>>({});
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountMap, setAccountMap] = useState<Map<number, Account>>(new Map());

  // 加载账户列表
  useEffect(() => {
    accountApi.list().then(accs => {
      setAccounts(accs);
      const map = new Map<number, Account>();
      accs.forEach(acc => map.set(acc.id, acc));
      setAccountMap(map);
    }).catch(console.error);
  }, []);

  // 获取账户名称
  const getAccountName = (accountId: number): string => {
    return accountMap.get(accountId)?.account_name || `账户 #${accountId}`;
  };

  const totalPages = Math.ceil(transactionsTotal / PAGE_SIZE);

  const handlePageChange = (page: number) => {
    if (page < 1 || page > totalPages) return;
    setCurrentPage(page);
    fetchTransactions(page, PAGE_SIZE);
  };

  const handleEdit = (tx: Transaction) => {
    setEditingId(tx.id);
    setEditForm({
      account_id: tx.account_id,
      symbol: tx.symbol,
      name: tx.name || undefined,
      type: tx.type,
      price: tx.price,
      quantity: tx.quantity,
      fee: tx.fee || undefined,
      currency: tx.currency,
      trade_date: tx.trade_date,
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handleSaveEdit = async (id: number) => {
    try {
      await updateTransaction(id, editForm);
      setEditingId(null);
      setEditForm({});
    } catch (error) {
      // Error handled by store
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这条交易记录吗？删除后持仓将重新计算。')) {
      return;
    }

    setDeletingId(id);
    try {
      await deleteTransaction(id);
    } catch (error) {
      // Error handled by store
    } finally {
      setDeletingId(null);
    }
  };

  if (isLoadingTransactions && transactions.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">交易记录</h2>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-4 animate-pulse">
              <div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 rounded" />
              <div className="h-4 w-16 bg-slate-200 dark:bg-slate-700 rounded" />
              <div className="h-4 w-20 bg-slate-200 dark:bg-slate-700 rounded" />
              <div className="h-4 w-20 bg-slate-200 dark:bg-slate-700 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
      <div className="flex items-center justify-between p-5 pb-0">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">交易记录</h2>
        <span className="text-sm text-slate-500 dark:text-slate-400">共 {transactionsTotal} 条</span>
      </div>

      {transactions.length === 0 ? (
        <div className="text-center py-12 text-slate-500 dark:text-slate-400">
          暂无交易记录
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3 px-4 text-left">日期</th>
                  <th className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3 px-4 text-left">账户</th>
                  <th className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3 px-4 text-left">代码/名称</th>
                  <th className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3 px-4 text-left">类型</th>
                  <th className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3 px-4 text-right">价格</th>
                  <th className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3 px-4 text-right">数量</th>
                  <th className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3 px-4 text-right">金额</th>
                  <th className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3 px-4 text-right">手续费</th>
                  <th className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3 px-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx, index) => {
                  const isBuy = tx.type === 'buy';
                  const amount = tx.price * tx.quantity;
                  
                  return (
                    <tr 
                      key={tx.id} 
                      className="border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors animate-fade-in"
                      style={{ animationDelay: `${index * 30}ms` }}
                    >
                      {/* 日期 */}
                      <td className="py-3 px-4 font-mono text-slate-500 dark:text-slate-400">
                        {editingId === tx.id ? (
                          <input
                            type="date"
                            value={editForm.trade_date || tx.trade_date}
                            onChange={(e) => setEditForm({ ...editForm, trade_date: e.target.value })}
                            className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700"
                          />
                        ) : (
                          tx.trade_date
                        )}
                      </td>

                      {/* 账户 */}
                      <td className="py-3 px-4">
                        {editingId === tx.id ? (
                          <select
                            value={editForm.account_id ?? tx.account_id}
                            onChange={(e) => setEditForm({ ...editForm, account_id: parseInt(e.target.value, 10) })}
                            className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700"
                          >
                            {accounts.map(acc => (
                              <option key={acc.id} value={acc.id}>
                                {acc.account_name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-sm text-slate-700 dark:text-slate-300">
                            {getAccountName(tx.account_id)}
                          </span>
                        )}
                      </td>

                      {/* 代码/名称 */}
                      <td className="py-3 px-4">
                        {editingId === tx.id ? (
                          <div className="space-y-1">
                            <input
                              type="text"
                              value={editForm.symbol || tx.symbol}
                              onChange={(e) => setEditForm({ ...editForm, symbol: e.target.value })}
                              className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700"
                              placeholder="股票代码"
                            />
                            <input
                              type="text"
                              value={editForm.name || tx.name || ''}
                              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                              className="w-full px-2 py-1 text-xs border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700"
                              placeholder="股票名称"
                            />
                          </div>
                        ) : (
                          <div>
                            <div className="font-semibold text-slate-800 dark:text-slate-100">{tx.symbol}</div>
                            {tx.name && (
                              <div className="text-xs text-slate-500 dark:text-slate-400">{tx.name}</div>
                            )}
                          </div>
                        )}
                      </td>

                      {/* 类型 */}
                      <td className="py-3 px-4">
                        {editingId === tx.id ? (
                          <select
                            value={editForm.type || tx.type}
                            onChange={(e) => setEditForm({ ...editForm, type: e.target.value as 'buy' | 'sell' })}
                            className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700"
                          >
                            <option value="buy">买入</option>
                            <option value="sell">卖出</option>
                          </select>
                        ) : (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                            isBuy 
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' 
                              : 'bg-red-500/10 text-red-600 dark:text-red-400'
                          }`}>
                            {isBuy ? (
                              <>
                                <ArrowDown className="w-3 h-3" />
                                买入
                              </>
                            ) : (
                              <>
                                <ArrowUp className="w-3 h-3" />
                                卖出
                              </>
                            )}
                          </span>
                        )}
                      </td>

                      {/* 价格 */}
                      <td className="py-3 px-4 text-right font-mono text-slate-800 dark:text-slate-100">
                        {editingId === tx.id ? (
                          <input
                            type="number"
                            step="0.01"
                            value={editForm.price ?? tx.price}
                            onChange={(e) => setEditForm({ ...editForm, price: parseFloat(e.target.value) })}
                            className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-right"
                          />
                        ) : (
                          formatNumber(tx.price, 2)
                        )}
                      </td>

                      {/* 数量 */}
                      <td className="py-3 px-4 text-right font-mono text-slate-800 dark:text-slate-100">
                        {editingId === tx.id ? (
                          <input
                            type="number"
                            step="1"
                            value={editForm.quantity ?? tx.quantity}
                            onChange={(e) => setEditForm({ ...editForm, quantity: parseFloat(e.target.value) })}
                            className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-right"
                          />
                        ) : (
                          formatNumber(tx.quantity, 0)
                        )}
                      </td>

                      {/* 金额 */}
                      <td className="py-3 px-4 text-right font-mono font-semibold text-slate-800 dark:text-slate-100">
                        {editingId === tx.id ? (
                          formatCurrency(
                            (editForm.price ?? tx.price) * (editForm.quantity ?? tx.quantity),
                            editForm.currency || tx.currency
                          )
                        ) : (
                          formatCurrency(amount, tx.currency)
                        )}
                      </td>

                      {/* 手续费 */}
                      <td className="py-3 px-4 text-right font-mono text-slate-500 dark:text-slate-400">
                        {editingId === tx.id ? (
                          <input
                            type="number"
                            step="0.01"
                            value={editForm.fee ?? tx.fee ?? 0}
                            onChange={(e) => setEditForm({ ...editForm, fee: parseFloat(e.target.value) || 0 })}
                            className="w-full px-2 py-1 text-sm border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700 text-right"
                          />
                        ) : (
                          tx.fee > 0 ? formatCurrency(tx.fee, tx.currency) : '-'
                        )}
                      </td>

                      {/* 操作 */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {editingId === tx.id ? (
                            <>
                              <button
                                onClick={() => handleSaveEdit(tx.id)}
                                className="p-1.5 rounded hover:bg-green-500/10 text-slate-400 hover:text-green-500 transition-colors"
                                title="保存"
                              >
                                <span className="text-xs">✓</span>
                              </button>
                              <button
                                onClick={handleCancelEdit}
                                className="p-1.5 rounded hover:bg-slate-500/10 text-slate-400 hover:text-slate-500 transition-colors"
                                title="取消"
                              >
                                <span className="text-xs">✕</span>
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => handleEdit(tx)}
                                disabled={deletingId === tx.id}
                                className="p-1.5 rounded hover:bg-blue-500/10 text-slate-400 hover:text-blue-500 transition-colors disabled:opacity-50"
                                title="编辑"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDelete(tx.id)}
                                disabled={deletingId === tx.id || editingId !== null}
                                className="p-1.5 rounded hover:bg-red-500/10 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-50"
                                title="删除"
                              >
                                <Trash2 className={`w-4 h-4 ${deletingId === tx.id ? 'animate-pulse' : ''}`} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-5 pt-4 border-t border-slate-200 dark:border-slate-700">
              <span className="text-sm text-slate-500 dark:text-slate-400">
                第 {currentPage} / {totalPages} 页
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                {/* 页码按钮 */}
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let page: number;
                    if (totalPages <= 5) {
                      page = i + 1;
                    } else if (currentPage <= 3) {
                      page = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      page = totalPages - 4 + i;
                    } else {
                      page = currentPage - 2 + i;
                    }

                    return (
                      <button
                        key={page}
                        onClick={() => handlePageChange(page)}
                        className={`w-8 h-8 rounded-lg text-sm transition-colors font-medium ${
                          currentPage === page
                            ? 'bg-blue-500 text-white'
                            : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600'
                        }`}
                      >
                        {page}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="p-2 rounded-lg bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default TransactionList;
