import { mkdir, readFile, rename, writeFile, open, unlink, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { ServiceError } from './errors.mjs';

export const seoulDay = (now = Date.now()) => new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

export async function atomicWriteJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(() => {}); }
}

// Only aggregate call counts are durable. No locations, station IDs, URLs, or credentials.
export class DailyQuota {
  constructor({ ledgerPath, limit = 300, clock = Date.now, provider = 'OPINET' }) {
    this.ledgerPath = ledgerPath;
    this.limit = Math.max(1, Math.min(provider === 'OPINET' ? 300 : 10_000, Math.floor(limit)));
    this.clock = clock;
    this.provider = provider;
    this.queue = Promise.resolve();
  }

  async read() {
    let ledger;
    try { ledger = JSON.parse(await readFile(this.ledgerPath, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return { version: 1, day: seoulDay(this.clock()), used: 0 };
      throw new ServiceError('QUOTA_LEDGER_UNREADABLE', '호출량 기록을 읽을 수 없어 새 외부 조회를 중단했습니다.', 503);
    }
    if (ledger.version !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(ledger.day) || !Number.isSafeInteger(ledger.used) || ledger.used < 0) {
      throw new ServiceError('QUOTA_LEDGER_UNREADABLE', '호출량 기록 형식이 올바르지 않아 새 외부 조회를 중단했습니다.', 503);
    }
    if (ledger.day > seoulDay(this.clock())) throw new ServiceError('QUOTA_CLOCK_INVALID', '호출량 기록과 서버 날짜가 일치하지 않습니다.', 503);
    return ledger.day === seoulDay(this.clock()) ? ledger : { version: 1, day: seoulDay(this.clock()), used: 0 };
  }

  async snapshot() {
    const ledger = await this.read();
    return { day: ledger.day, used: ledger.used, limit: this.limit, remaining: Math.max(0, this.limit - ledger.used), timezone: 'Asia/Seoul' };
  }

  reserve(count = 1) {
    const work = this.queue.then(() => this.withLock(async () => {
      const ledger = await this.read();
      if (!Number.isSafeInteger(count) || count < 1 || ledger.used + count > this.limit) {
        throw new ServiceError(`${this.provider}_DAILY_QUOTA_EXCEEDED`, '오늘의 데이터 조회 한도에 도달했습니다. 마지막으로 받은 자료의 기준시각을 확인해 주세요.', 429);
      }
      ledger.used += count;
      ledger.updatedAt = new Date(this.clock()).toISOString();
      await atomicWriteJson(this.ledgerPath, ledger);
      return { used: ledger.used, remaining: this.limit - ledger.used };
    }));
    this.queue = work.catch(() => {});
    return work;
  }

  async withLock(work) {
    await mkdir(dirname(this.ledgerPath), { recursive: true });
    const lockPath = `${this.ledgerPath}.lock`;
    let handle;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { handle = await open(lockPath, 'wx', 0o600); break; }
      catch (error) {
        if (error.code !== 'EEXIST') throw new ServiceError('QUOTA_LEDGER_UNWRITABLE', '호출량 기록을 저장할 수 없어 새 외부 조회를 중단했습니다.', 503);
        // The lock covers a small local write only, never an HTTP request.
        const lockInfo = await stat(lockPath).catch(() => null);
        if (lockInfo && Date.now() - lockInfo.mtimeMs > 120_000) await unlink(lockPath).catch(() => {});
        await delay(40);
      }
    }
    if (!handle) throw new ServiceError('QUOTA_LEDGER_BUSY', '조회 기록을 저장 중입니다. 잠시 후 다시 시도해 주세요.', 503);
    try { return await work(); }
    finally { await handle.close(); await unlink(lockPath).catch(() => {}); }
  }
}

export class RunQuota {
  constructor(dailyQuota, limit = 36) { this.dailyQuota = dailyQuota; this.limit = Math.max(1, Math.min(300, limit)); this.used = 0; }
  async reserve(count = 1) {
    if (this.used + count > this.limit) throw new ServiceError('COLLECTION_RUN_QUOTA_EXCEEDED', '이번 수집의 호출 예산에 도달했습니다.', 429);
    this.used += count;
    try { return await this.dailyQuota.reserve(count); }
    catch (error) { this.used -= count; throw error; }
  }
  snapshot() { return this.dailyQuota.snapshot(); }
}
