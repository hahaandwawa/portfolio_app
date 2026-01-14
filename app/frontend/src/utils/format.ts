/**
 * 格式化货币金额
 */
export function formatCurrency(value: number, currency: string = 'USD'): string {
  const symbols: Record<string, string> = {
    USD: '$',
    CNY: '¥',
    HKD: 'HK$',
    EUR: '€',
    GBP: '£',
    JPY: '¥',
  };

  const symbol = symbols[currency] || currency;
  const absValue = Math.abs(value);
  
  let formatted: string;
  if (absValue >= 1000000000) {
    formatted = `${(absValue / 1000000000).toFixed(2)}B`;
  } else if (absValue >= 1000000) {
    formatted = `${(absValue / 1000000).toFixed(2)}M`;
  } else if (absValue >= 1000) {
    formatted = `${(absValue / 1000).toFixed(2)}K`;
  } else {
    formatted = absValue.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  return `${value < 0 ? '-' : ''}${symbol}${formatted}`;
}

/**
 * 格式化百分比
 */
export function formatPercent(value: number, showSign: boolean = true): string {
  const sign = showSign && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * 格式化数字
 */
export function formatNumber(value: number, decimals: number = 2): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * 格式化日期
 */
export function formatDate(date: string | Date, format: 'full' | 'short' | 'time' = 'full'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  
  switch (format) {
    case 'short':
      return d.toLocaleDateString('en-US', {
        month: '2-digit',
        day: '2-digit',
      });
    case 'time':
      return d.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });
    case 'full':
    default:
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
  }
}

/**
 * 格式化时间差
 */
export function formatTimeAgo(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days} day${days > 1 ? 's' : ''} ago`;
  } else if (hours > 0) {
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  } else {
    return 'just now';
  }
}

/**
 * 格式化大数字
 */
export function formatLargeNumber(value: number): string {
  if (value >= 1e12) {
    return `${(value / 1e12).toFixed(2)}T`;
  } else if (value >= 1e9) {
    return `${(value / 1e9).toFixed(2)}B`;
  } else if (value >= 1e6) {
    return `${(value / 1e6).toFixed(2)}M`;
  } else if (value >= 1e3) {
    return `${(value / 1e3).toFixed(2)}K`;
  }
  return value.toLocaleString('en-US');
}
