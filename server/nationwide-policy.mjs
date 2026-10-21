const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const KST_OFFSET = 9 * HOUR;
export const NATIONWIDE_RETRY_MS = 2 * HOUR;
export const NATIONWIDE_REFRESH_MS = 24 * HOUR;

export function kstDay(now = Date.now()) {
  return new Date(now + KST_OFFSET).toISOString().slice(0, 10);
}

export function normalizePriceDate(value) {
  const date = String(value ?? '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === date ? date : null;
}

// A file's observation date and its download time have different meanings.
// Reusing/re-mapping a downloaded file must never renew either of those values.
export function planNationwideCollection({
  now = Date.now(), hasPrices = false, sourceDate, fetchedAt,
  lastDownloadAttemptAt, lastDownloadStatus, forceRefresh = false,
} = {}) {
  const today = kstDay(now);
  const yesterday = kstDay(now - DAY);
  const windowAt = Date.parse(`${today}T20:37:00+09:00`);
  const nextWindowAt = now < windowAt ? windowAt : windowAt + DAY;
  const expectedDate = now >= windowAt ? today : yesterday;
  const date = normalizePriceDate(sourceDate);
  const fetched = Date.parse(fetchedAt ?? '');
  const validFetch = Number.isFinite(fetched) && fetched <= now + 5 * 60 * 1000;
  const age = validFetch ? Math.max(0, now - fetched) : Infinity;
  const validDate = Boolean(date && date <= today);
  const eligible = hasPrices && validDate && date >= yesterday && validFetch && age <= 30 * HOUR;
  const expectedDateAvailable = Boolean(hasPrices && validDate && date >= expectedDate);
  const lastAttempt = Date.parse(lastDownloadAttemptAt ?? '');
  const retryAt = Number.isFinite(lastAttempt) ? lastAttempt + NATIONWIDE_RETRY_MS : now;
  const enteredNewWindow = now >= windowAt && lastAttempt < windowAt;
  const enteredNewDay = Number.isFinite(lastAttempt) && kstDay(lastAttempt) !== today;
  let reason = !hasPrices ? 'missing_prices'
    : !validDate || !validFetch ? 'invalid_observation_metadata'
    : !eligible ? 'expired_prices'
    : !expectedDateAvailable ? 'source_date_behind'
    : age >= NATIONWIDE_REFRESH_MS ? 'refresh_age_reached'
    : lastDownloadStatus === 'error' ? 'retry_failed_download'
    : 'current_snapshot';
  const needsRefresh = reason !== 'current_snapshot';
  const base = {
    sourceDate: date, expectedDate, eligible, expectedDateAvailable,
    usedPreviousDate: Boolean(validDate && date < today),
  };
  if (forceRefresh) return { ...base, due: true, reason: 'forced_refresh', nextRetryAt: null };
  if (needsRefresh) {
    if (retryAt > now && !enteredNewWindow && !enteredNewDay) {
      return { ...base, due: false, reason: 'retry_backoff', pendingReason: reason, nextRetryAt: new Date(retryAt).toISOString() };
    }
    return { ...base, due: true, reason, nextRetryAt: null };
  }
  const dateExpiry = Date.parse(`${date}T00:00:00+09:00`) + 2 * DAY;
  const next = Math.min(nextWindowAt, fetched + NATIONWIDE_REFRESH_MS, dateExpiry);
  return { ...base, due: false, reason, nextRetryAt: new Date(Math.max(now, next)).toISOString() };
}
