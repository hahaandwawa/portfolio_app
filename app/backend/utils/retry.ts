/**
 * 重试工具函数
 * 提供指数退避重试机制，用于处理 API 速率限制和临时错误
 */

import { logger } from './logger.js';

/**
 * 判断错误是否为速率限制错误
 */
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const errorMsg = error.message.toLowerCase();
    return (
      errorMsg.includes('too many requests') ||
      errorMsg.includes('rate limit') ||
      errorMsg.includes('429') ||
      errorMsg.includes('api call frequency') ||
      errorMsg.includes('thank you for using alpha vantage') ||
      errorMsg.includes('quota exceeded') ||
      errorMsg.includes('throttled')
    );
  }
  
  if (typeof error === 'string') {
    const errorMsg = error.toLowerCase();
    return (
      errorMsg.includes('too many requests') ||
      errorMsg.includes('rate limit') ||
      errorMsg.includes('429') ||
      errorMsg.includes('api call frequency') ||
      errorMsg.includes('note')
    );
  }
  
  // 检查对象中是否包含速率限制相关的字段
  if (typeof error === 'object' && error !== null) {
    const errorObj = error as Record<string, unknown>;
    if (errorObj['Note'] || errorObj['Error Message']) {
      const note = String(errorObj['Note'] || errorObj['Error Message'] || '').toLowerCase();
      return note.includes('api call frequency') || note.includes('rate limit');
    }
  }
  
  return false;
}

/**
 * 重试配置选项
 */
export interface RetryOptions {
  /** 最大重试次数（不包括首次尝试） */
  maxRetries?: number;
  /** 初始等待时间（毫秒） */
  initialDelay?: number;
  /** 最大等待时间（毫秒） */
  maxDelay?: number;
  /** 是否使用指数退避 */
  exponentialBackoff?: boolean;
  /** 退避倍数 */
  backoffMultiplier?: number;
  /** 是否只对速率限制错误重试 */
  retryOnlyOnRateLimit?: boolean;
  /** 自定义错误判断函数 */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** 重试前的回调 */
  onRetry?: (error: unknown, attempt: number, delay: number) => void;
}

/**
 * 默认重试配置
 */
const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelay: 2000, // 2秒
  maxDelay: 60000, // 60秒
  exponentialBackoff: true,
  backoffMultiplier: 2,
  retryOnlyOnRateLimit: false,
  shouldRetry: () => true,
  onRetry: () => {},
};

/**
 * 计算重试延迟时间
 */
function calculateDelay(attempt: number, options: Required<RetryOptions>): number {
  if (!options.exponentialBackoff) {
    return options.initialDelay;
  }
  
  const delay = options.initialDelay * Math.pow(options.backoffMultiplier, attempt);
  return Math.min(delay, options.maxDelay);
}

/**
 * 等待指定时间
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 带重试的函数执行器
 * 
 * @param fn 要执行的异步函数
 * @param options 重试配置选项
 * @returns 函数执行结果
 * 
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => api.getQuote('AAPL'),
 *   {
 *     maxRetries: 3,
 *     initialDelay: 2000,
 *     retryOnlyOnRateLimit: true
 *   }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts: Required<RetryOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
    shouldRetry: options.shouldRetry || DEFAULT_OPTIONS.shouldRetry,
    onRetry: options.onRetry || DEFAULT_OPTIONS.onRetry,
  };
  
  let lastError: unknown;
  
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // 检查是否应该重试
      const shouldRetry = attempt < opts.maxRetries && (
        opts.retryOnlyOnRateLimit 
          ? isRateLimitError(error)
          : opts.shouldRetry(error, attempt)
      );
      
      if (!shouldRetry) {
        // 不应该重试，直接抛出错误
        throw error;
      }
      
      // 计算延迟时间
      const delay = calculateDelay(attempt, opts);
      
      // 调用重试回调
      opts.onRetry(error, attempt + 1, delay);
      
      // 记录重试信息
      if (isRateLimitError(error)) {
        logger.warn(
          `⚠️ API 请求频率过高，将在 ${delay}ms 后重试 (尝试 ${attempt + 1}/${opts.maxRetries})...`
        );
      } else {
        logger.warn(
          `⚠️ 请求失败，将在 ${delay}ms 后重试 (尝试 ${attempt + 1}/${opts.maxRetries})...`,
          error
        );
      }
      
      // 等待后重试
      await sleep(delay);
    }
  }
  
  // 所有重试都失败了
  logger.error(`❌ 请求失败，已重试 ${opts.maxRetries} 次`, lastError);
  throw lastError;
}

/**
 * 速率限制器
 * 确保请求之间的最小间隔
 */
export class RateLimiter {
  private lastRequestTime: number = 0;
  private minInterval: number;
  private queue: Array<() => void> = [];
  private processing: boolean = false;

  constructor(minIntervalMs: number) {
    this.minInterval = minIntervalMs;
  }

  /**
   * 执行请求，确保遵守速率限制
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const executeRequest = async () => {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        
        if (timeSinceLastRequest < this.minInterval) {
          const waitTime = this.minInterval - timeSinceLastRequest;
          logger.debug(`速率限制：等待 ${waitTime}ms 后执行请求...`);
          await sleep(waitTime);
        }
        
        this.lastRequestTime = Date.now();
        
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.processing = false;
          this.processQueue();
        }
      };
      
      this.queue.push(executeRequest);
      this.processQueue();
    });
  }

  /**
   * 处理队列中的请求
   */
  private processQueue(): void {
    if (this.processing || this.queue.length === 0) {
      return;
    }
    
    this.processing = true;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }

  /**
   * 重置速率限制器
   */
  reset(): void {
    this.lastRequestTime = 0;
    this.queue = [];
    this.processing = false;
  }
}

/**
 * 创建速率限制器实例
 */
export function createRateLimiter(minIntervalMs: number): RateLimiter {
  return new RateLimiter(minIntervalMs);
}
