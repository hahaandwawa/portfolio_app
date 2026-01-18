import type { QuoteData } from '../../shared/types.js';
import { holdingService } from './holdingService.js';
import { isRateLimitError } from '../utils/retry.js';
import { logger } from '../utils/logger.js';

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
  /**
   * 获取股票名称
   * @param symbol 股票代码
   * @returns 股票名称，如果无法获取则返回 null
   */
  getStockName?(symbol: string): Promise<string | null>;
}

/**
 * 行情缓存
 */
interface CacheEntry {
  data: QuoteData;
  timestamp: number;
}

// 缓存配置
const CACHE_TTL = 30000; // 30秒缓存（与最小请求间隔保持一致）
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
      // 如果是速率限制错误，记录警告但不立即尝试备用 provider
      // 因为备用 provider 可能也会遇到同样的问题
      if (isRateLimitError(error)) {
        logger.warn(`[${requestedProvider}] 获取 ${symbol} 行情失败: API 速率限制，provider 已自动重试`);
      } else {
        logger.warn(`[${requestedProvider}] 获取 ${symbol} 行情失败，尝试备用 provider:`, error);
      }
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
        if (isRateLimitError(error)) {
          logger.warn(`[${fallbackName}] 备用 provider 也遇到速率限制:`, error);
        } else {
          logger.warn(`[${fallbackName}] 备用 provider 也失败:`, error);
        }
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
        logger.info(`请求频率限制，请等待 ${MIN_REQUEST_INTERVAL - timeSinceLastRequest}ms`);
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
        // 如果是速率限制错误，provider 已经尝试重试过了
        if (isRateLimitError(error)) {
          logger.warn(`[${provider.name}] 批量获取失败: API 速率限制，provider 已自动重试，降级到逐个获取`);
        } else {
          logger.warn(`[${provider.name}] 批量获取失败，降级到逐个获取:`, error);
        }
        
        // 降级到逐个获取（每个请求都会经过 provider 的重试机制）
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
   * 同时检查并更新名称为空的股票
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

    // 更新数据库中的价格
    if (prices.size > 0) {
      holdingService.updatePrices(prices);
    }

    // 检查并更新名称为空的股票
    await this.updateMissingStockNames(symbols, providerName);

    return { updated: prices.size, failed };
  },

  /**
   * 刷新指定股票的价格
   * 同时检查并更新名称为空的股票
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

    // 更新数据库中的价格
    if (prices.size > 0) {
      holdingService.updatePrices(prices);
    }

    // 检查并更新名称为空的股票
    await this.updateMissingStockNames(symbols, providerName);

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
   * 获取股票名称
   * @param symbol 股票代码
   * @param providerName 可选的 provider 名称
   * @returns 股票名称，如果无法获取则返回 null
   */
  async getStockName(symbol: string, providerName?: string): Promise<string | null> {
    const requestedProvider = providerName || this.defaultProvider;
    
    try {
      const provider = this.getProvider(requestedProvider);
      
      // 如果 provider 实现了 getStockName 方法，使用它
      if (provider.getStockName) {
        const name = await provider.getStockName(symbol);
        if (name) {
          return name;
        }
      }
      } catch (error) {
        if (isRateLimitError(error)) {
          logger.warn(`[${requestedProvider}] 获取 ${symbol} 名称失败: API 速率限制`);
        } else {
          logger.warn(`[${requestedProvider}] 获取 ${symbol} 名称失败，尝试备用 provider:`, error);
        }
      }

    // 如果主 provider 失败，尝试备用 provider
    const fallbackProviders = ['alphavantage', 'yahoo'].filter(p => p !== requestedProvider);
    
    for (const fallbackName of fallbackProviders) {
      if (!this.providers.has(fallbackName)) {
        continue;
      }
      
      try {
        const fallbackProvider = this.getProvider(fallbackName);
        if (fallbackProvider.getStockName) {
          const name = await fallbackProvider.getStockName(symbol);
          if (name) {
            return name;
          }
        }
      } catch (error) {
        if (isRateLimitError(error)) {
          logger.warn(`[${fallbackName}] 备用 provider 也遇到速率限制:`, error);
        } else {
          logger.warn(`[${fallbackName}] 备用 provider 也失败:`, error);
        }
      }
    }
    
    return null;
  },

  /**
   * 更新名称为空的股票
   * @param symbols 股票代码列表
   * @param providerName 可选的 provider 名称
   */
  async updateMissingStockNames(symbols: string[], providerName?: string): Promise<void> {
    const { holdingDao } = await import('../db/dao.js');
    
    for (const symbol of symbols) {
      try {
        // 检查该股票的所有持仓，看是否有名称为空的
        const holdings = holdingDao.getAll().filter(h => h.symbol.toUpperCase() === symbol.toUpperCase() && (!h.name || h.name.trim() === ''));
        
        if (holdings.length > 0) {
          // 获取股票名称
          const stockName = await this.getStockName(symbol, providerName);
          
          if (stockName) {
            // 更新所有该股票的持仓名称
            for (const holding of holdings) {
              holdingDao.upsert({
                ...holding,
                name: stockName,
              });
            }
            logger.info(`✅ 已更新股票名称: ${symbol} -> ${stockName}`);
          }
        }
      } catch (error) {
        if (isRateLimitError(error)) {
          logger.warn(`更新股票名称失败: ${symbol} (API 速率限制)`);
        } else {
          logger.warn(`更新股票名称失败: ${symbol}`, error);
        }
      }
    }
  },

  /**
   * 清除缓存
   */
  clearCache(): void {
    quoteCache.clear();
  },
};

export default marketDataService;

