import { TrendingUp, TrendingDown, Wallet, PieChart, Activity } from 'lucide-react';
import { usePortfolioStore } from '../store';
import { formatCurrency, formatPercent } from '../utils/format';

function OverviewCards() {
  const { overview, isLoadingOverview } = usePortfolioStore();

  if (isLoadingOverview || !overview) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm animate-pulse">
            <div className="h-4 w-20 bg-slate-200 dark:bg-slate-700 rounded mb-3" />
            <div className="h-8 w-32 bg-slate-200 dark:bg-slate-700 rounded mb-2" />
            <div className="h-3 w-24 bg-slate-200 dark:bg-slate-700 rounded" />
          </div>
        ))}
      </div>
    );
  }

  const cards = [
    {
      title: '总资产',
      value: formatCurrency(overview.total_asset, overview.base_currency),
      subtitle: `持仓 ${overview.holdings_count} 只${overview.cash > 0 ? ` · 现金 ${formatCurrency(overview.cash, overview.base_currency)}` : ''}`,
      icon: Wallet,
      iconBg: 'bg-blue-500/10',
      iconColor: 'text-blue-500',
    },
    {
      title: '总盈亏',
      value: formatCurrency(overview.total_pnl, overview.base_currency),
      subtitle: formatPercent(overview.total_pnl_pct),
      icon: overview.total_pnl >= 0 ? TrendingUp : TrendingDown,
      iconBg: overview.total_pnl >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10',
      iconColor: overview.total_pnl >= 0 ? 'text-emerald-500' : 'text-red-500',
      valueClass: overview.total_pnl >= 0 ? 'text-emerald-500' : 'text-red-500',
      subtitleClass: overview.total_pnl >= 0 ? 'text-emerald-500' : 'text-red-500',
    },
    {
      title: '今日盈亏',
      value: formatCurrency(overview.today_pnl, overview.base_currency),
      subtitle: overview.today_pnl_status 
        ? `${formatPercent(overview.today_pnl_pct)} · ${overview.today_pnl_status}`
        : formatPercent(overview.today_pnl_pct),
      icon: Activity,
      iconBg: overview.today_pnl >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10',
      iconColor: overview.today_pnl >= 0 ? 'text-emerald-500' : 'text-red-500',
      valueClass: overview.today_pnl >= 0 ? 'text-emerald-500' : 'text-red-500',
      subtitleClass: overview.today_pnl >= 0 ? 'text-emerald-500' : 'text-red-500',
    },
    {
      title: '总成本',
      value: formatCurrency(overview.total_cost, overview.base_currency),
      subtitle: `收益率 ${formatPercent(overview.total_pnl_pct)}`,
      icon: PieChart,
      iconBg: 'bg-purple-500/10',
      iconColor: 'text-purple-500',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card, index) => (
        <div 
          key={card.title}
          className="bg-white dark:bg-slate-800 rounded-xl p-5 border border-slate-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-all duration-300 animate-slide-up"
          style={{ animationDelay: `${index * 50}ms` }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-slate-500 dark:text-slate-400 font-medium">{card.title}</span>
            <div className={`p-2 rounded-lg ${card.iconBg}`}>
              <card.icon className={`w-4 h-4 ${card.iconColor}`} />
            </div>
          </div>
          <div className={`text-xl sm:text-2xl font-bold mb-1 ${card.valueClass || 'text-slate-800 dark:text-slate-100'}`}>
            {card.value}
          </div>
          <div className={`text-sm ${card.subtitleClass || 'text-slate-500 dark:text-slate-400'}`}>
            {card.subtitle}
          </div>
        </div>
      ))}
    </div>
  );
}

export default OverviewCards;
