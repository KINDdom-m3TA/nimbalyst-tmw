// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DatabaseErrorRateLimiter,
  categorizeDBError,
  describeDBError,
} from '../PGLiteDatabaseWorker';

/**
 * On 2026-08-03 a single session emitted ~55,000 `database_error` events in one
 * hour, every one of them `errorType: 'unknown'` with no message. These tests
 * pin the three properties that made that spike both unbounded and unreadable.
 */
describe('categorizeDBError', () => {
  it('names the failures this file actually produces', () => {
    // Every one of these landed in 'unknown' before, which is why the spike
    // could not be diagnosed after the fact.
    expect(categorizeDBError(new Error('canceling statement due to statement timeout (5000ms)')))
      .toBe('timeout');
    expect(categorizeDBError(new Error('Request query timed out'))).toBe('timeout');
    expect(categorizeDBError(new Error('Worker not initialized'))).toBe('worker_unavailable');
    expect(categorizeDBError(new Error('Database is closed'))).toBe('closed');
  });

  it('keeps the established categories', () => {
    expect(categorizeDBError(new Error('EACCES: permission denied'))).toBe('permission');
    expect(categorizeDBError(new Error('ENOSPC: no space left on device'))).toBe('disk_full');
    expect(categorizeDBError(new Error('database is locked'))).toBe('lock');
    expect(categorizeDBError(new Error('database disk image is malformed and corrupt'))).toBe('corruption');
    expect(categorizeDBError(new Error('syntax error at or near "SELCT"'))).toBe('syntax');
  });
});

describe('describeDBError', () => {
  it('keeps the error shape but not the user content inside it', () => {
    const error = Object.assign(
      new Error(`duplicate key value violates unique constraint "ai_sessions_pkey": Key (id)=(a1b2) already exists, note 'buy milk for Dana'`),
      { name: 'PostgresError', code: '23505' },
    );
    const described = describeDBError(error);

    expect(described.errorName).toBe('PostgresError');
    expect(described.sqlState).toBe('23505');
    expect(described.errorMessage).toContain('duplicate key value violates unique constraint');
    // Row values quoted into the message are the user's prose.
    expect(described.errorMessage).not.toContain('buy milk for Dana');
    expect(described.errorMessage).not.toContain('a1b2');
  });

  it('truncates and tolerates a non-Error throw', () => {
    expect(describeDBError(new Error('x'.repeat(1000))).errorMessage.length).toBe(300);
    const described = describeDBError('plain string failure');
    expect(described.errorName).toBe('Error');
    expect(described.sqlState).toBe('none');
    expect(described.errorMessage).toBe('plain string failure');
  });
});

describe('DatabaseErrorRateLimiter', () => {
  it('reports a signature once per window and counts what it suppressed', () => {
    let now = 0;
    const limiter = new DatabaseErrorRateLimiter(60_000, () => now);

    expect(limiter.admit('write|transaction|timeout|BEGIN failed')).toBe(0);

    // A wedged database keeps failing; the next 999 attempts must not each cost
    // an analytics event.
    for (let i = 0; i < 999; i += 1) {
      expect(limiter.admit('write|transaction|timeout|BEGIN failed')).toBeNull();
    }

    now = 60_000;
    expect(limiter.admit('write|transaction|timeout|BEGIN failed')).toBe(999);
  });

  it('does not let one noisy signature mask a different failure', () => {
    let now = 0;
    const limiter = new DatabaseErrorRateLimiter(60_000, () => now);

    expect(limiter.admit('write|transaction|timeout|BEGIN failed')).toBe(0);
    expect(limiter.admit('write|transaction|timeout|BEGIN failed')).toBeNull();
    // A genuinely new problem still gets through immediately.
    expect(limiter.admit('read|ai_agent_messages|corruption|malformed')).toBe(0);
  });
});
