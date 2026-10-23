import { describe, expect, it } from 'vitest';
import {
  CONFLICT_MESSAGE,
  ServiceError,
  fromPgError,
  likeTerm,
  range,
  updateGuarded,
} from './errors';
import { fakeClient } from './testing';

describe('fromPgError', () => {
  it('maps postgres codes to typed errors', () => {
    expect(fromPgError({ code: '40001' })).toMatchObject({
      code: 'CONFLICT',
      message: CONFLICT_MESSAGE,
    });
    expect(fromPgError({ code: '42501' }).code).toBe('FORBIDDEN');
    expect(fromPgError({ code: '23505' }).code).toBe('DUPLICATE');
    expect(fromPgError({ code: '23514', message: 'check failed' })).toMatchObject({
      code: 'VALIDATION',
      message: 'check failed',
    });
    expect(fromPgError({ code: 'P0002' }).code).toBe('NOT_FOUND');
    expect(fromPgError({ code: 'XX000' }).code).toBe('UNKNOWN');
  });
});

describe('updateGuarded (optimistic concurrency)', () => {
  it('returns the row when updated_at still matches, filtering on it', async () => {
    const { client, calls } = fakeClient(() => ({
      data: { id: 'a', updated_at: 't2' },
      error: null,
    }));
    const row = await updateGuarded(client, 'customers', 'a', 't1', { name: 'x' });
    expect(row).toEqual({ id: 'a', updated_at: 't2' });
    const ops = calls[0]!.ops;
    expect(ops).toContainEqual(['eq', ['updated_at', 't1']]);
    expect(ops).toContainEqual(['eq', ['id', 'a']]);
  });

  it('reports a clear conflict when the row exists but was changed', async () => {
    let n = 0;
    const { client } = fakeClient(() =>
      n++ === 0 ? { data: null, error: null } : { data: { id: 'a' }, error: null },
    );
    const err = await updateGuarded(client, 'customers', 'a', 't1', {}).catch((e) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect(err).toMatchObject({ code: 'CONFLICT', message: CONFLICT_MESSAGE });
  });

  it('reports not found when the row is gone or not visible', async () => {
    const { client } = fakeClient(() => ({ data: null, error: null }));
    await expect(updateGuarded(client, 'customers', 'a', 't1', {})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('surfaces database errors as typed errors', async () => {
    const { client } = fakeClient(() => ({ data: null, error: { code: '23505', message: 'dup' } }));
    await expect(updateGuarded(client, 'customers', 'a', 't1', {})).rejects.toMatchObject({
      code: 'DUPLICATE',
    });
  });
});

describe('helpers', () => {
  it('escapes filter characters', () => {
    expect(likeTerm('a%b_c,d(e)')).toBe('a\\%b\\_c\\,d\\(e\\)');
  });
  it('pages are zero-based ranges', () => {
    expect(range(0, 25)).toEqual([0, 24]);
    expect(range(2, 25)).toEqual([50, 74]);
  });
});
