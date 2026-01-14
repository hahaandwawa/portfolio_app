import type { QuoteData } from '../../shared/types.js';
import { holdingService } from './holdingService.js';

/**
 * 历史价格数据点
 */
export interface HistoricalPricePoint {
  date: string;
  open: number;
  close: number;
  high?: number;
  low?: number;
}

/**
 * 行情数据 Provider 接口
 */
export interface MarketDataProvider {
  name: string;
  getQuote(symbol: string): Promise<QuoteData | null>;
  getQuotes(symbols: string[]): Promise<Map<string, QuoteData>>;
  getHistoricalPrices(symbol: string, from: string, to: string): Promise<{ date: string; close: number }[]>;
  getHistoricalPricesWithOpen(symbol: string, date: string): Promise<HistoricalPricePoint | null>;
}

/**
 * 行情缓存
 */
interface CacheEntry {
  data: QuoteData;
  timestamp: number;
}

// 缓存配置
const CACHE_TTL = 5000; // 5秒缓存
const MIN_REQUEST_INTERVAL = 30000; // 最小请求间隔 30秒

// 内存缓存
const quoteCache = new Map<string, CacheEntry>();
let lastRequestTime = 0;

/**
 * 行情数据服务
 */
export const marketDataService = {
  providers: new Map<string, MarketDataProvider>(),
  defaultProvider: 'yahoo',

  /**
   * 注册 Provider
   */
  registerProvider(provider: MarketDataProvider): void {
    this.providers.set(provider.name, provider);
  },

  /**
   * 设置默认 Provider
   */
  setDefaultProvider(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(`Provider "${name}" 未注册`);
    }
    this.defaultProvider = name;
  },

  /**
   * 获取 Provider
   */
  getProvider(name?: string): MarketDataProvider {
    const providerName = name || this.defaultProvider;
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new Error(`Provider "${providerName}" 未注册`);
    }
    return provider;
  },

  /**
   * 获取单个股票行情（带缓存和自动降级）
   */
  async getQuote(symbol: string, providerName?: string): Promise<QuoteData | null> {
    const requestedProvider = providerName || this.defaultProvider;
    const cacheKey = `${symbol}:${requestedProvider}`;
    
    // 检查缓存
    const cached = quoteCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    // 尝试使用请求的 provider
    try {
      const provider = this.getProvider(requestedProvider);
      const quote = await provider.getQuote(symbol);
      
      if (quote) {
        quoteCache.set(cacheKey, { data: quote, timestamp: Date.now() });
        return quote;
      }
    } catch (error) {
      console.warn(`[${requestedProvider}] 获取 ${symbol} 行情失败，尝试备用 provider:`, error);
    }

    // 如果主 provider 失败，尝试备用 provider
    const fallbackProviders = ['alphavantage', 'yahoo'].filter(p => p !== requestedProvider);
    
    for (const fallbackName of fallbackProviders) {
      if (!this.providers.has(fallbackName)) {
        continue;
      }
      
      try {
        console.log(`尝试使用备用 provider: ${fallbackName}`);
        const fallbackProvider = this.getProvider(fallbackName);
        const quote = await fallbackProvider.getQuote(symbol);
        
        if (quote) {
          const fallbackCacheKey = `${symbol}:${fallbackName}`;
          quoteCache.set(fallbackCacheKey, { data: quote, timestamp: Date.now() });
          return quote;
        }
      } catch (error) {
        console.warn(`[${fallbackName}] 备用 provider 也失败:`, error);
      }
    }
    
    return null;
  },

  /**
   * 批量获取行情（带节流、缓存和自动降级）
   */
  async getQuotes(symbols: string[], providerName?: string): Promise<Map<string, QuoteData>> {
    const result = new Map<string, QuoteData>();
    const symbolsToFetch: string[] = [];
    const requestedProvider = providerName || this.defaultProvider;
    const provider = this.getProvider(requestedProvider);

    // 检查缓存
    for (const symbol of symbols) {
      const cacheKey = `${symbol}:${provider.name}`;
      const cached = quoteCache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        result.set(symbol, cached.data);
      } else {
        symbolsToFetch.push(symbol);
      }
    }

    // 节流检查
    if (symbolsToFetch.length > 0) {
      const now = Date.now();
      const timeSinceLastRequest = now - lastRequestTime;
      
      if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        console.log(`请求频率限制，请等待 ${MIN_REQUEST_INTERVAL - timeSinceLastRequest}ms`);
        // 返回已缓存的数据
        return result;
      }
      
      lastRequestTime = now;

      // 尝试批量获取
      try {
        const quotes = await provider.getQuotes(symbolsToFetch);
        
        // 更新缓存和结果
        for (const [symbol, quote] of quotes) {
          const cacheKey = `${symbol}:${provider.name}`;
          quoteCache.set(cacheKey, { data: quote, timestamp: Date.now() });
          result.set(symbol, quote);
        }
      } catch (error) {
        console.warn(`[${provider.name}] 批量获取失败，降级到逐个获取:`, error);
        
        // 降级到逐个获取
        for (const symbol of symbolsToFetch) {
          const quote = await this.getQuote(symbol, requestedProvider);
          if (quote) {
            result.set(symbol, quote);
          }
        }
      }
    }

    return result;
  },

  /**
   * 刷新所有持仓的价格
   */
  async refreshAllPrices(providerName?: string): Promise<{ updated: number; failed: string[] }> {
    const symbols = holdingService.getAllSymbols();
    
    if (symbols.length === 0) {
      return { updated: 0, failed: [] };
    }

    const quotes = await this.getQuotes(symbols, providerName);
    const prices = new Map<string, number>();
    const failed: string[] = [];

    for (const symbol of symbols) {
      const quote = quotes.get(symbol);
      if (quote) {
        prices.set(symbol, quote.price);
      } else {
        failed.push(symbol);
      }
    }

    // 更新数据库
    if (prices.size > 0) {
      holdingService.updatePrices(prices);
    }

    return { updated: prices.size, failed };
  },

  /**
   * 刷新指定股票的价格
   */
  async refreshPrices(symbols: string[], providerName?: string): Promise<{ updated: number; failed: string[] }> {
    if (symbols.length === 0) {
      return { updated: 0, failed: [] };
    }

    const quotes = await this.getQuotes(symbols, providerName);
    const prices = new Map<string, number>();
    const failed: string[] = [];

    for (const symbol of symbols) {
      const quote = quotes.get(symbol);
      if (quote) {
        prices.set(symbol, quote.price);
      } else {
        failed.push(symbol);
      }
    }

    // 更新数据库
    if (prices.size > 0) {
      holdingService.updatePrices(prices);
    }

    return { updated: prices.size, failed };
  },

  /**
   * 获取历史价格
   */
  async getHistoricalPrices(
    symbol: string, 
    from: string, 
    to: string, 
    providerName?: string
  ): Promise<{ date: string; close: number }[]> {
    const provider = this.getProvider(providerName);
    return provider.getHistoricalPrices(symbol, from, to);
  },

  /**
   * 获取指定日期的开市和闭市价格（用于计算平均值）
   */
  async getHistoricalPriceWithOpen(
    symbol: string,
    date: string,
    providerName?: string
  ): Promise<HistoricalPricePoint | null> {
    const provider = this.getProvider(providerName);
    if (provider.getHistoricalPricesWithOpen) {
      return provider.getHistoricalPricesWithOpen(symbol, date);
    }
    // 如果没有实现，尝试从历史数据中获取
    const from = new Date(date);
    from.setDate(from.getDate() - 1);
    const to = new Date(date);
    to.setDate(to.getDate() + 1);
    
    const historical = await this.getHistoricalPrices(
      symbol,
      from.toISOString().split('T')[0],
      to.toISOString().split('T')[0],
      providerName
    );
    
    const point = historical.find(h => h.date === date);
    if (point) {
      // 如果没有 open，使用 close 作为近似值
      return {
        date: point.date,
        open: point.close,
        close: point.close,
      };
    }
    
    return null;
  },

  /**
   * 清除缓存
   */
  clearCache(): void {
    quoteCache.clear();
  },
};

export default marketDataService;

