import { useState, useEffect } from 'react';
import { X, ArrowDown, ArrowUp } from 'lucide-react';
import { usePortfolioStore, useUIStore } from '../store';
import { accountApi } from '../api';
import { getTodayET } from '../utils/timeUtils';
import type { CreateTransactionRequest, Account } from '../../../shared/types';

function TransactionForm() {
  const { createTransaction, holdings } = usePortfolioStore();
  const { closeTransactionForm, transactionFormType, selectedSymbol, selectSymbol } = useUIStore();
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<'buy' | 'sell'>(transactionFormType);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number>(1); // 默认账户ID为1
  
  const [formData, setFormData] = useState({
    symbol: selectedSymbol || '',
    name: '',
    price: '',
    quantity: '',
    fee: '',
    trade_date: getTodayET(),
  });

  // 加载账户列表
  useEffect(() => {
    accountApi.list().then(setAccounts).catch(console.error);
    // 如果有账户，设置第一个为默认选中
    accountApi.list().then(accs => {
      if (accs.length > 0) {
        setSelectedAccountId(accs[0].id);
      }
    }).catch(console.error);
  }, []);

  // 选中的持仓信息（根据选中的账户和股票代码查找）
  const selectedHolding = holdings.find(
    h => h.symbol === formData.symbol.toUpperCase() && h.account_id === selectedAccountId
  );

  // 初始化时填充股票名称
  useEffect(() => {
    if (selectedHolding) {
      setFormData(prev => ({
        ...prev,
        name: selectedHolding.name || '',
      }));
    }
  }, [selectedHolding]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    
    // 对于日期字段，确保格式正确
    if (name === 'trade_date' && value) {
      // HTML5 date input 应该返回 YYYY-MM-DD 格式
      // 但如果用户手动输入，可能需要验证
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(value)) {
        // 尝试转换日期
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          const formattedDate = date.toISOString().split('T')[0];
          setFormData(prev => ({ ...prev, [name]: formattedDate }));
          setError(null);
          return;
        }
      }
    }
    
    setFormData(prev => ({ ...prev, [name]: value }));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      // 日期格式验证和转换
      let tradeDate = formData.trade_date;
      if (!tradeDate) {
        throw new Error('请输入交易日期');
      }
      
      // 确保日期格式为 YYYY-MM-DD
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(tradeDate)) {
        // 尝试转换其他格式
        const date = new Date(tradeDate);
        if (isNaN(date.getTime())) {
          throw new Error('交易日期格式无效，请使用 YYYY-MM-DD 格式');
        }
        tradeDate = date.toISOString().split('T')[0];
      }

      const data: CreateTransactionRequest = {
        account_id: selectedAccountId,
        symbol: formData.symbol.toUpperCase(),
        name: formData.name || undefined,
        type,
        price: parseFloat(formData.price),
        quantity: parseFloat(formData.quantity),
        fee: formData.fee ? parseFloat(formData.fee) : 0,
        trade_date: tradeDate,
      };

      // 基础验证
      if (!data.symbol) {
        throw new Error('请输入股票代码');
      }
      if (isNaN(data.price) || data.price <= 0) {
        throw new Error('请输入有效的价格');
      }
      if (isNaN(data.quantity) || data.quantity <= 0) {
        throw new Error('请输入有效的数量');
      }

      // 卖出数量验证
      if (type === 'sell' && selectedHolding) {
        if (data.quantity > selectedHolding.total_qty) {
          throw new Error(`卖出数量不能超过持仓量 (${selectedHolding.total_qty})`);
        }
      }

      await createTransaction(data);
      selectSymbol(null);
      closeTransactionForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  // 快捷填充
  const handleQuickFill = (percent: number) => {
    if (selectedHolding && type === 'sell') {
      const qty = Math.floor(selectedHolding.total_qty * percent / 100);
      setFormData(prev => ({ ...prev, quantity: String(qty) }));
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={() => {
        selectSymbol(null);
        closeTransactionForm();
      }}
    >
      <div 
        className="bg-white dark:bg-slate-800 rounded-xl p-6 border border-slate-200 dark:border-slate-700 shadow-xl w-full max-w-md relative animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        {/* 关闭按钮 */}
        <button
          onClick={() => {
            selectSymbol(null);
            closeTransactionForm();
          }}
          className="absolute top-4 right-4 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
        >
          <X className="w-5 h-5 text-slate-400" />
        </button>

        {/* 标题 */}
        <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-6">录入交易</h2>

        {/* 类型切换 */}
        <div className="flex gap-2 mb-6">
          <button
            type="button"
            onClick={() => setType('buy')}
            className={`flex-1 py-3 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
              type === 'buy'
                ? 'bg-emerald-500 text-white'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            <ArrowDown className="w-4 h-4" />
            买入
          </button>
          <button
            type="button"
            onClick={() => setType('sell')}
            className={`flex-1 py-3 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
              type === 'sell'
                ? 'bg-red-500 text-white'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            <ArrowUp className="w-4 h-4" />
            卖出
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 账户选择 */}
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">选择账户 *</label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
              required
            >
              {accounts.map(account => (
                <option key={account.id} value={account.id}>
                  {account.account_name} ({account.account_type === 'stock' ? '股票' : account.account_type === 'cash' ? '现金' : '混合'})
                </option>
              ))}
            </select>
          </div>

          {/* 股票代码 */}
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">股票代码 *</label>
            <input
              type="text"
              name="symbol"
              value={formData.symbol}
              onChange={handleChange}
              placeholder="如 600000、AAPL、0700"
              className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 uppercase transition-all"
              autoFocus
            />
            {selectedHolding && (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Current: {selectedHolding.total_qty} shares, cost ${selectedHolding.avg_cost.toFixed(2)}
              </p>
            )}
          </div>

          {/* 股票名称 */}
          <div>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">股票名称</label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="可选"
              className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
            />
          </div>

          {/* 价格和数量 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">成交价格 *</label>
              <input
                type="number"
                name="price"
                value={formData.price}
                onChange={handleChange}
                placeholder="0.00"
                step="0.01"
                min="0"
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 font-mono transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">成交数量 *</label>
              <input
                type="number"
                name="quantity"
                value={formData.quantity}
                onChange={handleChange}
                placeholder="0"
                step="1"
                min="1"
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 font-mono transition-all"
              />
            </div>
          </div>

          {/* 卖出快捷按钮 */}
          {type === 'sell' && selectedHolding && selectedHolding.total_qty > 0 && (
            <div className="flex gap-2">
              {[25, 50, 75, 100].map(percent => (
                <button
                  key={percent}
                  type="button"
                  onClick={() => handleQuickFill(percent)}
                  className="flex-1 py-1.5 text-xs bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors font-medium text-slate-600 dark:text-slate-300"
                >
                  {percent}%
                </button>
              ))}
            </div>
          )}

          {/* 手续费和日期 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">手续费</label>
              <input
                type="number"
                name="fee"
                value={formData.fee}
                onChange={handleChange}
                placeholder="0.00"
                step="0.01"
                min="0"
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 font-mono transition-all"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">交易日期 *</label>
              <input
                type="date"
                name="trade_date"
                value={formData.trade_date}
                onChange={handleChange}
                required
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
              />
            </div>
          </div>

          {/* 预估金额 */}
          {formData.price && formData.quantity && (
            <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500 dark:text-slate-400">
                  {type === 'buy' ? '预估买入金额' : '预估卖出金额'}
                </span>
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-100">
                  ${(parseFloat(formData.price) * parseFloat(formData.quantity) + (parseFloat(formData.fee) || 0)).toLocaleString()}
                </span>
              </div>
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-500">
              {error}
            </div>
          )}

          {/* 提交按钮 */}
          <button
            type="submit"
            disabled={isSubmitting}
            className={`w-full py-3 rounded-lg font-medium transition-all text-white ${
              type === 'buy'
                ? 'bg-emerald-500 hover:bg-emerald-600'
                : 'bg-red-500 hover:bg-red-600'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isSubmitting ? '提交中...' : type === 'buy' ? '确认买入' : '确认卖出'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default TransactionForm;
