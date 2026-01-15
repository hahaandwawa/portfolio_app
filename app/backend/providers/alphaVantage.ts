import AlphaVantage from 'alphavantage';
import type { MarketDataProvider, HistoricalPricePoint } from '../services/marketDataService.js';
import type { QuoteData } from '../../shared/types.js';

/**
 * Alpha Vantage API 配置
 * 注意：需要在环境变量中设置 ALPHA_VANTAGE_API_KEY
 * 获取免费 API Key: https://www.alphavantage.co/support/#api-key
 */
const API_KEY = process.env.ALPHA_VANTAGE_API_KEY || 'demo'; // demo key 有严格限制

const av = AlphaVantage({ key: API_KEY });

/**
 * 将股票代码转换为 Alpha Vantage 格式
 * Alpha Vantage 主要支持美股，格式与原始代码相同
 */
function toAlphaVantageSymbol(symbol: string): string {
  return symbol.toUpperCase();
}

/**
 * Alpha Vantage 数据提供者
 * 免费层限制：每分钟 5 次请求，每天 500 次请求
 */
export const alphaVantageProvider: MarketDataProvider = {
  name: 'alphavantage',

  /**
   * 获取单个股票行情
   */
  async getQuote(symbol: string): Promise<QuoteData | null> {
    try {
      const avSymbol = toAlphaVantageSymbol(symbol);
      console.log(`[Alpha Vantage] 正在获取 ${symbol} 的行情数据...`);
      
      // Alpha Vantage 使用 quote 函数获取实时数据
      const data = await av.data.quote(avSymbol);
      
      // 检查错误响应
      if (data && data['Error Message']) {
        console.warn(`[Alpha Vantage] API 错误: ${data['Error Message']}`);
        return null;
      }
      
      // 检查频率限制
      if (data && data['Note']) {
        console.warn(`[Alpha Vantage] API 频率限制: ${data['Note']}`);
        return null;
      }
      
      if (!data || !data['Global Quote'] || !data['Global Quote']['05. price']) {
        console.warn(`[Alpha Vantage] 无法获取 ${symbol} 的行情数据，返回数据:`, Object.keys(data || {}));
        return null;
      }

      const quote = data['Global Quote'];
      const price = parseFloat(quote['05. price']);
      const change = parseFloat(quote['09. change'] || '0');
      const changePercentStr = quote['10. change percent'] || '0%';
      const changePercent = parseFloat(changePercentStr.replace('%', ''));
      const volume = parseInt(quote['06. volume'] || '0', 10);

      if (isNaN(price) || price <= 0) {
        console.warn(`[Alpha Vantage] 无效的价格数据: ${price}`);
        return null;
      }

      const result: QuoteData = {
        symbol: symbol.toUpperCase(),
        price: price,
        change: change,
        change_pct: changePercent,
        volume: volume,
        timestamp: new Date().toISOString(),
      };
      
      console.log(`[Alpha Vantage] ✅ 成功获取 ${symbol} 行情: $${result.price}`);
      return result;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Alpha Vantage] 获取 ${symbol} 行情失败:`, errorMsg);
      
      // Alpha Vantage 免费层限制提示
      if (errorMsg.includes('API call frequency') || errorMsg.includes('Thank you for using Alpha Vantage') || errorMsg.includes('Note')) {
        console.warn('[Alpha Vantage] ⚠️ API 调用频率限制，请稍后再试或升级到付费计划');
      }
      
      return null;
    }
  },

  /**
   * 批量获取股票行情
   * 注意：Alpha Vantage 免费层不支持批量查询，需要逐个获取
   */
  async getQuotes(symbols: string[]): Promise<Map<string, QuoteData>> {
    const result = new Map<string, QuoteData>();
    
    if (symbols.length === 0) {
      return result;
    }

    // Alpha Vantage 免费层限制：每分钟 5 次请求
    // 为了避免触发限制，我们添加延迟
    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      
      // 除了第一个请求，其他请求之间延迟 15 秒（确保不超过每分钟 5 次的限制）
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 15000));
      }
      
      const quote = await this.getQuote(symbol);
      if (quote) {
        result.set(symbol.toUpperCase(), quote);
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
      const avSymbol = toAlphaVantageSymbol(symbol);
      console.log(`[Alpha Vantage] 正在获取 ${symbol} 的历史数据 (${from} 到 ${to})...`);
      
      // Alpha Vantage 使用 daily 函数获取历史数据
      const data = await av.data.daily(avSymbol, 'full');
      
      if (!data || !data['Time Series (Daily)']) {
        console.warn(`[Alpha Vantage] 无法获取 ${symbol} 的历史数据`);
        return [];
      }

      const timeSeries = data['Time Series (Daily)'];
      const fromDate = new Date(from);
      const toDate = new Date(to);
      
      const result: { date: string; close: number }[] = [];
      
      for (const [dateStr, values] of Object.entries(timeSeries)) {
        const date = new Date(dateStr);
        
        // 过滤日期范围
        if (date >= fromDate && date <= toDate) {
          const dayData = values as Record<string, string>;
          const close = parseFloat(dayData['4. close']);
          if (!isNaN(close)) {
            result.push({
              date: dateStr,
              close: close,
            });
          }
        }
      }
      
      // 按日期排序
      result.sort((a, b) => a.date.localeCompare(b.date));
      
      console.log(`[Alpha Vantage] ✅ 成功获取 ${symbol} 历史数据: ${result.length} 条记录`);
      return result;
    } catch (error: any) {
      console.error(`[Alpha Vantage] 获取 ${symbol} 历史数据失败:`, error?.message || error);
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
      const avSymbol = toAlphaVantageSymbol(symbol);
      console.log(`[Alpha Vantage] 正在获取 ${symbol} ${date} 的开闭市价格...`);
      
      // Alpha Vantage 使用 daily 函数获取历史数据
      const data = await av.data.daily(avSymbol, 'full');
      
      if (!data || !data['Time Series (Daily)']) {
        console.warn(`[Alpha Vantage] 无法获取 ${symbol} 的历史数据`);
        return null;
      }

      const timeSeries = data['Time Series (Daily)'] as Record<string, Record<string, string>>;
      const dayData = timeSeries[date];
      
      if (!dayData) {
        console.warn(`[Alpha Vantage] 无法找到 ${symbol} ${date} 的数据`);
        return null;
      }

      const open = parseFloat(dayData['1. open']);
      const high = parseFloat(dayData['2. high']);
      const low = parseFloat(dayData['3. low']);
      const close = parseFloat(dayData['4. close']);

      if (isNaN(open) || isNaN(close)) {
        console.warn(`[Alpha Vantage] ${symbol} ${date} 的价格数据无效`);
        return null;
      }

      return {
        date,
        open,
        close,
        high: isNaN(high) ? undefined : high,
        low: isNaN(low) ? undefined : low,
      };
    } catch (error: any) {
      console.error(`[Alpha Vantage] 获取 ${symbol} ${date} 的开闭市价格失败:`, error?.message || error);
      return null;
    }
  },

  /**
   * 获取股票名称
   * 注意：Alpha Vantage 的 quote API 不直接提供公司名称
   * 可以尝试使用 overview API，但需要额外的 API 调用
   */
  async getStockName(symbol: string): Promise<string | null> {
    try {
      const avSymbol = toAlphaVantageSymbol(symbol);
      console.log(`正在获取 ${symbol} 的股票名称 (Alpha Vantage)...`);
      
      // Alpha Vantage 的 overview API 提供公司信息
      const data = await av.data.companyOverview(avSymbol);
      
      if (data && data['Name']) {
        const name = data['Name'];
        console.log(`✅ 成功获取 ${symbol} 名称: ${name}`);
        return name;
      }
      
      // 如果 overview API 失败，尝试从 quote 中获取（虽然通常没有名称）
      const quoteData = await av.data.quote(avSymbol);
      if (quoteData && quoteData['Global Quote'] && quoteData['Global Quote']['01. symbol']) {
        // Alpha Vantage quote 不提供名称，返回 null
        console.warn(`Alpha Vantage quote API 不提供股票名称`);
        return null;
      }
      
      return null;
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`获取 ${symbol} 股票名称失败 (Alpha Vantage):`, errorMsg);
      return null;
    }
  },
};

export default alphaVantageProvider;

