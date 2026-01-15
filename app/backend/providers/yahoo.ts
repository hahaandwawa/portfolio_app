import YahooFinance from 'yahoo-finance2';
import type { MarketDataProvider, HistoricalPricePoint } from '../services/marketDataService.js';
import type { QuoteData } from '../../shared/types.js';
import { withRetry, isRateLimitError, createRateLimiter } from '../utils/retry.js';

// v3 需要先实例化
const yahooFinance = new YahooFinance();

// Yahoo Finance 速率限制：建议每次请求间隔至少 1 秒
// 创建速率限制器，确保请求间隔至少 1 秒
const rateLimiter = createRateLimiter(1000);

/**
 * 将股票代码转换为 Yahoo Finance 格式
 * A股：600000 -> 600000.SS (上海) 或 000001 -> 000001.SZ (深圳)
 * 港股：00700 -> 0700.HK
 * 美股：AAPL -> AAPL
 */
function toYahooSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  
  // 已经是 Yahoo 格式
  if (upper.includes('.')) {
    return upper;
  }
  
  // A股判断
  if (/^\d{6}$/.test(upper)) {
    // 6开头是上海，其他是深圳
    if (upper.startsWith('6')) {
      return `${upper}.SS`;
    } else {
      return `${upper}.SZ`;
    }
  }
  
  // 港股判断 (4-5位数字)
  if (/^\d{4,5}$/.test(upper)) {
    const padded = upper.padStart(4, '0');
    return `${padded}.HK`;
  }
  
  // 默认美股
  return upper;
}

/**
 * 将 Yahoo Finance 代码转换回原始格式
 */
function fromYahooSymbol(yahooSymbol: string): string {
  const parts = yahooSymbol.split('.');
  if (parts.length > 1) {
    const suffix = parts[parts.length - 1];
    const code = parts.slice(0, -1).join('.');
    
    if (['SS', 'SZ', 'HK'].includes(suffix)) {
      return code;
    }
  }
  return yahooSymbol;
}

/**
 * Yahoo Finance 数据提供者
 */
export const yahooProvider: MarketDataProvider = {
  name: 'yahoo',

  /**
   * 获取单个股票行情（带重试机制和速率限制）
   */
  async getQuote(symbol: string): Promise<QuoteData | null> {
    const yahooSymbol = toYahooSymbol(symbol);
    
    try {
      // 使用速率限制器和重试机制
      const quote = await rateLimiter.execute(() =>
        withRetry(
          async () => {
            console.log(`正在获取 ${symbol} (${yahooSymbol}) 的行情数据...`);
            return await yahooFinance.quote(yahooSymbol);
          },
          {
            maxRetries: 3,
            initialDelay: 2000, // 初始延迟2秒
            maxDelay: 30000, // 最大延迟30秒
            retryOnlyOnRateLimit: true,
            onRetry: (error, attempt, delay) => {
              console.log(`[Yahoo Finance] 重试获取 ${symbol} (尝试 ${attempt}/3，等待 ${delay}ms)...`);
            },
          }
        )
      );
      
      if (!quote) {
        console.warn(`无法获取 ${symbol} 的行情数据: 返回数据为空`);
        return null;
      }
      
      // 检查是否有价格数据
      const price = quote.regularMarketPrice || quote.price || quote.currentPrice;
      if (!price) {
        console.warn(`无法获取 ${symbol} 的价格数据，返回的数据结构:`, Object.keys(quote));
        return null;
      }

      const result: QuoteData = {
        symbol: symbol.toUpperCase(),
        price: price,
        change: quote.regularMarketChange || quote.change || quote.changeInPercent || 0,
        change_pct: quote.regularMarketChangePercent || quote.changePercent || 0,
        volume: quote.regularMarketVolume || quote.volume || 0,
        timestamp: new Date().toISOString(),
      };
      
      console.log(`✅ 成功获取 ${symbol} 行情: $${result.price}`);
      return result;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // 如果是速率限制错误，已经通过重试机制处理过了
      if (isRateLimitError(error)) {
        console.error(`❌ 获取 ${symbol} 行情失败: Yahoo Finance API 请求频率过高，已尝试重试但失败，请稍后再试`);
      } else {
        console.error(`获取 ${symbol} 行情失败:`, errorMsg);
      }
      
      return null;
    }
  },

  /**
   * 批量获取股票行情（带重试机制和速率限制）
   */
  async getQuotes(symbols: string[]): Promise<Map<string, QuoteData>> {
    const result = new Map<string, QuoteData>();
    
    if (symbols.length === 0) {
      return result;
    }

    try {
      // 使用速率限制器和重试机制进行批量获取
      const yahooSymbols = symbols.map(toYahooSymbol);
      const quotes = await rateLimiter.execute(() =>
        withRetry(
          async () => {
            console.log(`[Yahoo Finance] 批量获取 ${symbols.length} 个股票的行情数据...`);
            return await yahooFinance.quote(yahooSymbols);
          },
          {
            maxRetries: 3,
            initialDelay: 3000, // 初始延迟3秒
            maxDelay: 30000, // 最大延迟30秒
            retryOnlyOnRateLimit: true,
            onRetry: (error, attempt, delay) => {
              console.log(`[Yahoo Finance] 批量获取重试 (尝试 ${attempt}/3，等待 ${delay}ms)...`);
            },
          }
        )
      );
      
      // quote 可能返回单个对象或数组
      const quotesArray = Array.isArray(quotes) ? quotes : [quotes];
      
      for (const quote of quotesArray) {
        if (quote && quote.regularMarketPrice && quote.symbol) {
          const originalSymbol = fromYahooSymbol(quote.symbol);
          
          result.set(originalSymbol.toUpperCase(), {
            symbol: originalSymbol.toUpperCase(),
            price: quote.regularMarketPrice,
            change: quote.regularMarketChange || 0,
            change_pct: quote.regularMarketChangePercent || 0,
            volume: quote.regularMarketVolume,
            timestamp: new Date().toISOString(),
          });
        }
      }
      
      console.log(`[Yahoo Finance] ✅ 批量获取成功: ${result.size}/${symbols.length} 个股票`);
    } catch (error) {
      console.warn('[Yahoo Finance] 批量获取行情失败，降级到逐个获取:', error);
      
      // 降级到逐个获取（每个请求都会经过速率限制器和重试机制）
      for (const symbol of symbols) {
        const quote = await this.getQuote(symbol);
        if (quote) {
          result.set(symbol.toUpperCase(), quote);
        }
      }
    }

    return result;
  },

  /**
   * 获取历史价格数据
   */
  async getHistoricalPrices(
    symbol: string, 
    from: string, 
    to: string
  ): Promise<{ date: string; close: number }[]> {
    try {
      const yahooSymbol = toYahooSymbol(symbol);
      
      // 将日期字符串转换为 Unix 时间戳（秒）
      const period1 = Math.floor(new Date(from).getTime() / 1000);
      const period2 = Math.floor(new Date(to).getTime() / 1000);
      
      const historical = await yahooFinance.chart(yahooSymbol, {
        period1,
        period2,
        interval: '1d',
      });
      
      if (!historical || !historical.quotes) {
        return [];
      }

      return historical.quotes
        .filter(q => q.close !== null && q.close !== undefined)
        .map(q => ({
          date: new Date(q.date).toISOString().split('T')[0],
          close: q.close as number,
        }));
    } catch (error) {
      console.error(`获取 ${symbol} 历史数据失败:`, error);
      return [];
    }
  },

  /**
   * 获取指定日期的开市和闭市价格
   */
  async getHistoricalPricesWithOpen(
    symbol: string,
    date: string
  ): Promise<HistoricalPricePoint | null> {
    try {
      const yahooSymbol = toYahooSymbol(symbol);
      
      // 获取前后几天的数据以确保能获取到目标日期
      const targetDate = new Date(date);
      const from = new Date(targetDate);
      from.setDate(from.getDate() - 2);
      const to = new Date(targetDate);
      to.setDate(to.getDate() + 2);
      
      const period1 = Math.floor(from.getTime() / 1000);
      const period2 = Math.floor(to.getTime() / 1000);
      
      const historical = await yahooFinance.chart(yahooSymbol, {
        period1,
        period2,
        interval: '1d',
      });
      
      if (!historical || !historical.quotes) {
        return null;
      }

      // 查找目标日期的数据
      const quote = historical.quotes.find(q => {
        const quoteDate = new Date(q.date).toISOString().split('T')[0];
        return quoteDate === date;
      });

      if (!quote) {
        return null;
      }

      // Yahoo Finance chart API 返回的数据包含 open, high, low, close
      interface QuoteWithOHLC {
        open?: number;
        high?: number;
        low?: number;
        close: number;
      }
      const quoteWithOHLC = quote as QuoteWithOHLC;
      const open = quoteWithOHLC.open ?? quote.close;
      const close = quote.close;
      const high = quoteWithOHLC.high;
      const low = quoteWithOHLC.low;

      if (open === null || open === undefined || close === null || close === undefined) {
        return null;
      }

      return {
        date,
        open: open as number,
        close: close as number,
        high: high as number | undefined,
        low: low as number | undefined,
      };
    } catch (error) {
      console.error(`获取 ${symbol} ${date} 的开闭市价格失败:`, error);
      return null;
    }
  },

  /**
   * 获取股票名称
   */
  async getStockName(symbol: string): Promise<string | null> {
    try {
      const yahooSymbol = toYahooSymbol(symbol);
      console.log(`正在获取 ${symbol} (${yahooSymbol}) 的股票名称...`);
      
      const quote = await yahooFinance.quote(yahooSymbol);
      
      if (!quote) {
        console.warn(`无法获取 ${symbol} 的股票名称: 返回数据为空`);
        return null;
      }
      
      // Yahoo Finance 通常提供 longName 或 shortName
      const name = (quote as any).longName || (quote as any).shortName || (quote as any).displayName;
      
      if (name) {
        console.log(`✅ 成功获取 ${symbol} 名称: ${name}`);
        return name;
      }
      
      console.warn(`无法从 ${symbol} 的行情数据中提取名称，返回的数据结构:`, Object.keys(quote));
      return null;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`获取 ${symbol} 股票名称失败:`, errorMsg);
      return null;
    }
  },
};

export default yahooProvider;

