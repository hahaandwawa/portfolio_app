import { useState } from 'react';
import { ArrowUpDown, TrendingUp, TrendingDown } from 'lucide-react';
import { usePortfolioStore, useUIStore } from '../store';
import { formatCurrency, formatPercent, formatNumber } from '../utils/format';

type SortKey = 'symbol' | 'market_value' | 'unrealized_pnl' | 'unrealized_pnl_pct' | 'weight' | 'avg_cost' | 'last_price';
type SortOrder = 'asc' | 'desc';

function HoldingsTable() {
  const { holdings, isLoadingHoldings } = usePortfolioStore();
  const { openTransactionForm, selectSymbol } = useUIStore();
  const [sortKey, setSortKey] = useState<SortKey>('market_value');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('desc');
    }
  };

  const sortedHoldings = [...holdings].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortOrder === 'asc' 
        ? aVal.localeCompare(bVal) 
        : bVal.localeCompare(aVal);
    }
    
    const aNum = Number(aVal) || 0;
    const bNum = Number(bVal) || 0;
    return sortOrder === 'asc' ? aNum - bNum : bNum - aNum;
  });

  const SortHeader = ({ label, sortKeyName }: { label: string; sortKeyName: SortKey }) => (
    <th 
      className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3 px-4 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300 transition-colors text-left whitespace-nowrap"
      onClick={() => handleSort(sortKeyName)}
    >
      <div className="flex items-center gap-1">
        {label}
        <ArrowUpDown className={`w-3 h-3 ${sortKey === sortKeyName ? 'text-blue-500' : ''}`} />
      </div>
    </th>
  );

  if (isLoadingHoldings) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">持仓明细</h2>
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-4 animate-pulse">
              <div className="h-4 w-20 bg-slate-200 dark:bg-slate-700 rounded" />
              <div className="h-4 w-24 bg-slate-200 dark:bg-slate-700 rounded" />
              <div className="h-4 w-16 bg-slate-200 dark:bg-slate-700 rounded" />
              <div className="h-4 w-20 bg-slate-200 dark:bg-slate-700 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (holdings.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-4">持仓明细</h2>
        <div className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 bg-slate-100 dark:bg-slate-700 rounded-full flex items-center justify-center">
            <TrendingUp className="w-8 h-8 text-slate-400 dark:text-slate-500" />
          </div>
          <p className="text-slate-500 dark:text-slate-400 mb-4">暂无持仓</p>
          <button 
            onClick={() => openTransactionForm('buy')}
            className="px-4 py-2 rounded-lg font-medium bg-blue-500 hover:bg-blue-600 text-white transition-colors"
          >
            录入首笔交易
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between p-5 pb-0">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">持仓明细</h2>
        <span className="text-sm text-slate-500 dark:text-slate-400">{holdings.length} 只股票</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px]">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700">
              <SortHeader label="代码/名称" sortKeyName="symbol" />
              <SortHeader label="最新价" sortKeyName="last_price" />
              <SortHeader label="成本价" sortKeyName="avg_cost" />
              <SortHeader label="持仓数量" sortKeyName="market_value" />
              <SortHeader label="市值" sortKeyName="market_value" />
              <SortHeader label="浮动盈亏" sortKeyName="unrealized_pnl" />
              <SortHeader label="盈亏比例" sortKeyName="unrealized_pnl_pct" />
              <SortHeader label="占比" sortKeyName="weight" />
              <th className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3 px-4 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {sortedHoldings.map((holding, index) => {
              const isProfit = holding.unrealized_pnl >= 0;
              
              return (
                <tr 
                  key={holding.symbol} 
                  className="border-b border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors animate-fade-in"
                  style={{ animationDelay: `${index * 30}ms` }}
                >
                  {/* 代码/名称 */}
                  <td className="py-3 px-4">
                    <div>
                      <div className="font-semibold text-slate-800 dark:text-slate-100">{holding.symbol}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{holding.name || '-'}</div>
                    </div>
                  </td>

                  {/* 最新价 */}
                  <td className="py-3 px-4 font-mono text-slate-800 dark:text-slate-100">
                    {formatNumber(holding.last_price, 2)}
                  </td>

                  {/* 成本价 */}
                  <td className="py-3 px-4 font-mono text-slate-500 dark:text-slate-400">
                    {formatNumber(holding.avg_cost, 2)}
                  </td>

                  {/* 持仓数量 */}
                  <td className="py-3 px-4 font-mono text-slate-800 dark:text-slate-100">
                    {formatNumber(holding.total_qty, 0)}
                  </td>

                  {/* 市值 */}
                  <td className="py-3 px-4 font-mono font-semibold text-slate-800 dark:text-slate-100">
                    {formatCurrency(holding.market_value, holding.currency)}
                  </td>

                  {/* 浮动盈亏 */}
                  <td className={`py-3 px-4 font-mono font-semibold ${isProfit ? 'text-emerald-500' : 'text-red-500'}`}>
                    <div className="flex items-center gap-1">
                      {isProfit ? (
                        <TrendingUp className="w-3 h-3" />
                      ) : (
                        <TrendingDown className="w-3 h-3" />
                      )}
                      {formatCurrency(holding.unrealized_pnl, holding.currency)}
                    </div>
                  </td>

                  {/* 盈亏比例 */}
                  <td className={`py-3 px-4 font-mono font-semibold ${isProfit ? 'text-emerald-500' : 'text-red-500'}`}>
                    {formatPercent(holding.unrealized_pnl_pct)}
                  </td>

                  {/* 占比 */}
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-blue-500 rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(holding.weight, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatPercent(holding.weight)}
                      </span>
                    </div>
                  </td>

                  {/* 操作 */}
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          selectSymbol(holding.symbol);
                          openTransactionForm('buy');
                        }}
                        className="px-2 py-1 text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded hover:bg-emerald-500/20 transition-colors font-medium"
                      >
                        买入
                      </button>
                      <button
                        onClick={() => {
                          selectSymbol(holding.symbol);
                          openTransactionForm('sell');
                        }}
                        className="px-2 py-1 text-xs bg-red-500/10 text-red-600 dark:text-red-400 rounded hover:bg-red-500/20 transition-colors font-medium"
                      >
                        卖出
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default HoldingsTable;
