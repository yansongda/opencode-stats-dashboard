const TIMEZONE_KEY = 'opencode-stats-timezone'

export function getStoredTimezone(): string | null {
  return localStorage.getItem(TIMEZONE_KEY)
}

export function setStoredTimezone(tz: string): void {
  localStorage.setItem(TIMEZONE_KEY, tz)
}

export function getBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function getActiveTimezone(): string {
  return getStoredTimezone() ?? getBrowserTimezone()
}

export function formatInTimezone(
  utcDateStr: string | null,
  options: Intl.DateTimeFormatOptions = {}
): string {
  if (!utcDateStr) return '—'

  const date = new Date(utcDateStr.replace(' ', 'T') + 'Z')
  if (isNaN(date.getTime())) return '—'

  const tz = getActiveTimezone()

  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: tz,
    ...options
  }

  return new Intl.DateTimeFormat('zh-CN', defaultOptions).format(date)
}

export function formatRelativeTime(utcDateStr: string | number | null): string {
  if (!utcDateStr) return '—'

  let date: Date
  if (typeof utcDateStr === 'number') {
    date = new Date(utcDateStr)
  } else {
    date = new Date(utcDateStr.replace(' ', 'T') + 'Z')
  }
  if (isNaN(date.getTime())) return '—'

  return formatRelativeTimeFromDate(date)
}

export function formatRelativeTimeFromDate(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  if (diffHour < 24) return `${diffHour} 小时前`
  if (diffDay < 7) return `${diffDay} 天前`

  return formatInTimezone(date.toISOString(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
}

/**
 * Convert a UTC bucket string from the backend to a local-timezone display label.
 *
 * Handles two formats:
 * - Daily:  "YYYY-MM-DD"           → "MM-DD" (or "YYYY-MM-DD" if year differs)
 * - Hourly: "YYYY-MM-DD HH:00"    → "MM-DD HH:00" (or "YYYY-MM-DD HH:00" if year differs)
 *
 * Parses the string as UTC and reformats using the browser's local timezone.
 */
export function formatBucketLocal(bucket: string): string {
  // Hourly format: "YYYY-MM-DD HH:00" (space-separated, has ":00")
  const hourlyMatch = bucket.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):00$/)
  if (hourlyMatch) {
    const [, y, m, d, h] = hourlyMatch
    const utcDate = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h)))
    const localY = utcDate.getFullYear()
    const localM = String(utcDate.getMonth() + 1).padStart(2, '0')
    const localD = String(utcDate.getDate()).padStart(2, '0')
    const localH = String(utcDate.getHours()).padStart(2, '0')
    const currentYear = new Date().getFullYear()
    if (localY !== currentYear) {
      return `${localY}-${localM}-${localD} ${localH}:00`
    }
    return `${localM}-${localD} ${localH}:00`
  }

  // Daily format: "YYYY-MM-DD"
  const dailyMatch = bucket.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dailyMatch) {
    const [, y, m, d] = dailyMatch
    const utcDate = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
    const localY = utcDate.getFullYear()
    const localM = String(utcDate.getMonth() + 1).padStart(2, '0')
    const localD = String(utcDate.getDate()).padStart(2, '0')
    const currentYear = new Date().getFullYear()
    if (localY !== currentYear) {
      return `${localY}-${localM}-${localD}`
    }
    return `${localM}-${localD}`
  }

  // Unrecognized format, return as-is
  return bucket
}

export const COMMON_TIMEZONES = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Pacific/Auckland',
  'Australia/Sydney',
]
