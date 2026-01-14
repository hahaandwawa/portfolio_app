/**
 * 统一的日志工具
 * 提供统一的日志接口，便于后续替换为专业的日志库
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface Logger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, error?: unknown, ...args: unknown[]) => void;
}

class SimpleLogger implements Logger {
  private shouldLog(level: LogLevel): boolean {
    // 在生产环境可以只记录 warn 和 error
    const env = process.env.NODE_ENV || 'development';
    if (env === 'production') {
      return level === 'warn' || level === 'error';
    }
    return true;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.shouldLog('debug')) {
      console.debug(`[DEBUG] ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.shouldLog('info')) {
      console.log(`[INFO] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.shouldLog('warn')) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  }

  error(message: string, error?: unknown, ...args: unknown[]): void {
    if (this.shouldLog('error')) {
      if (error instanceof Error) {
        console.error(`[ERROR] ${message}`, error.message, error.stack, ...args);
      } else {
        console.error(`[ERROR] ${message}`, error, ...args);
      }
    }
  }
}

// 导出单例
export const logger = new SimpleLogger();

// 导出类型
export type { Logger, LogLevel };
