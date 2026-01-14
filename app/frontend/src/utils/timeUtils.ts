/**
 * 前端时间工具模块 - 统一处理美国东岸时间（ET）
 * 
 * 浏览器环境下的ET时间处理
 */

/**
 * 获取当前美国东岸时间（ET）的日期字符串（YYYY-MM-DD）
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
 * 格式化日期为ET时间显示（用于UI显示）
 * @param date 日期字符串或Date对象
 * @param includeTime 是否包含时间
 * @returns 格式化的ET时间字符串，如 "2026-01-15 16:00 ET"
 */
export function formatDateET(date: string | Date, includeTime: boolean = false): string {
  const d = typeof date === 'string' ? new Date(date + 'T00:00:00') : date;
  
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
  const d = typeof date === 'string' ? new Date(date + 'T00:00:00') : date;
  
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
