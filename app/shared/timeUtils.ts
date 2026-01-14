/**
 * 时间工具模块 - 统一处理美国东岸时间（ET）
 * 
 * 根据PM文档要求：
 * - 所有系统逻辑时间使用美国东岸时间（ET）
 * - 存储层时间统一为UTC时间戳
 * - 显示层负责UTC → ET和UTC → 用户本地时间的转换
 */

/**
 * 获取当前美国东岸时间（ET）的日期字符串（YYYY-MM-DD）
 * 用于系统逻辑判断，如"今天"、"今日盈亏"等
 */
export function getTodayET(): string {
  const now = new Date();
  // 直接获取ET时区的日期部分，避免Date对象解析问题
  const etParts = now.toLocaleString('en-US', { 
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  // 解析格式化的字符串 (MM/DD/YYYY)
  const [month, day, year] = etParts.split('/');
  
  // 格式化为 YYYY-MM-DD
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * 获取当前美国东岸时间（ET）的Date对象
 */
export function getNowET(): Date {
  const now = new Date();
  const etString = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  return new Date(etString);
}

/**
 * 将日期字符串转换为ET时区的Date对象
 * @param dateStr 日期字符串 (YYYY-MM-DD)
 */
export function parseDateET(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  // 直接创建日期对象，使用本地时间
  // 注意：这个函数主要用于日期比较，不涉及具体时间
  return new Date(year, month - 1, day);
}

/**
 * 格式化日期为ET时间显示（用于UI显示）
 * @param date 日期字符串或Date对象
 * @param includeTime 是否包含时间
 * @returns 格式化的ET时间字符串，如 "2026-01-15 16:00 ET"
 */
export function formatDateET(date: string | Date, includeTime: boolean = false): string {
  const d = typeof date === 'string' ? new Date(date + 'T12:00:00') : date;
  
  if (includeTime) {
    const etString = d.toLocaleString('en-US', { 
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    return `${etString} ET`;
  } else {
    const etString = d.toLocaleString('en-US', { 
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    // 转换为 YYYY-MM-DD 格式
    const [month, day, year] = etString.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
}

/**
 * 格式化日期为ET时间 + 用户本地时间显示
 * @param date 日期字符串或Date对象
 * @param includeTime 是否包含时间
 * @returns 格式化的时间字符串，如 "2026-01-15 16:00 ET（13:00 PT）"
 */
export function formatDateWithLocalTime(date: string | Date, includeTime: boolean = false): string {
  const d = typeof date === 'string' ? new Date(date + 'T12:00:00') : date;
  
  const etString = includeTime
    ? d.toLocaleString('en-US', { 
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
    : d.toLocaleString('en-US', { 
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
  
  // 获取用户本地时间
  const localString = includeTime
    ? d.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
    : d.toLocaleString('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
  
  // 如果ET时间和本地时间相同，只显示ET时间
  if (etString === localString) {
    return includeTime ? `${etString} ET` : etString;
  }
  
  // 获取时区缩写
  const etTz = Intl.DateTimeFormat('en-US', { 
    timeZone: 'America/New_York',
    timeZoneName: 'short'
  }).formatToParts(d).find(part => part.type === 'timeZoneName')?.value || 'ET';
  
  const localTz = Intl.DateTimeFormat('en-US', {
    timeZoneName: 'short'
  }).formatToParts(d).find(part => part.type === 'timeZoneName')?.value || 'Local';
  
  return includeTime 
    ? `${etString} ${etTz}（${localString} ${localTz}）`
    : `${etString} ${etTz}（${localString} ${localTz}）`;
}

/**
 * 判断是否为交易日（周一到周五，基于ET时区）
 */
export function isTradingDayET(dateStr: string): boolean {
  const [year, month, day] = dateStr.split('-').map(Number);
  // 创建ET时区的日期对象
  const etDate = new Date();
  etDate.setFullYear(year, month - 1, day);
  const etString = etDate.toLocaleString('en-US', { 
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parsed = new Date(etString);
  const dayOfWeek = parsed.getDay();
  return dayOfWeek >= 1 && dayOfWeek <= 5; // 周一到周五
}

/**
 * 获取UTC时间戳（用于数据库存储）
 * @param dateStr 日期字符串 (YYYY-MM-DD)，默认为今天ET
 */
export function getUTCTimestamp(dateStr?: string): number {
  const date = dateStr ? parseDateET(dateStr) : getNowET();
  return date.getTime();
}

/**
 * 从UTC时间戳转换为ET日期字符串
 * @param timestamp UTC时间戳
 */
export function timestampToETDate(timestamp: number): string {
  const date = new Date(timestamp);
  const etString = date.toLocaleString('en-US', { 
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  // 转换为 YYYY-MM-DD 格式
  const [month, day, year] = etString.split('/');
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * 获取当前ET时区的小时和分钟
 * @returns { hour: number, minute: number } ET时区的小时和分钟
 */
export function getCurrentTimeET(): { hour: number; minute: number } {
  const now = new Date();
  const etString = now.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const [hour, minute] = etString.split(':').map(Number);
  return { hour, minute };
}

/**
 * 判断当前时间是否在美股开市时间段内（9:30 AM - 4:00 PM ET）
 * @returns true 如果在开市时间段内，false 否则
 */
export function isMarketOpenET(): boolean {
  const { hour, minute } = getCurrentTimeET();
  const currentTime = hour * 60 + minute; // 转换为分钟数
  const openTime = 9 * 60 + 30; // 9:30 AM = 570 分钟
  const closeTime = 16 * 60; // 4:00 PM = 960 分钟
  
  return currentTime >= openTime && currentTime < closeTime;
}

/**
 * 判断指定日期是否为休息日或节假日
 * 目前只判断周末，节假日需要后续扩展
 * @param dateStr 日期字符串 (YYYY-MM-DD)
 * @returns { isHoliday: boolean, reason?: string } 是否为休息日及原因
 */
export function isHolidayET(dateStr: string): { isHoliday: boolean; reason?: string } {
  // 首先判断是否为交易日（周一到周五）
  if (!isTradingDayET(dateStr)) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const etDate = new Date();
    etDate.setFullYear(year, month - 1, day);
    const etString = etDate.toLocaleString('en-US', { 
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const parsed = new Date(etString);
    const dayOfWeek = parsed.getDay();
    
    if (dayOfWeek === 0) {
      return { isHoliday: true, reason: '休息日（周日）' };
    } else if (dayOfWeek === 6) {
      return { isHoliday: true, reason: '休息日（周六）' };
    }
  }
  
  // TODO: 后续可以添加法定节假日的判断
  // 例如：新年、马丁路德金日、总统日、阵亡将士纪念日、独立日、劳动节、感恩节、圣诞节等
  
  return { isHoliday: false };
}
