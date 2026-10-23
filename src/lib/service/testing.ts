import type { SupabaseClient } from '@supabase/supabase-js';

export interface FakeCall {
  table?: string;
  rpc?: string;
  args?: unknown;
  /** Chained builder calls in order, e.g. ['eq', ['id', '1']]. */
  ops: [string, unknown[]][];
}

type Reply = { data: unknown; error: { code?: string; message?: string } | null; count?: number };

/**
 * Minimal stand-in for the Supabase client in unit tests: every chained call is recorded and
 * awaiting the chain returns whatever `respond` gives for that call.
 */
export function fakeClient(respond: (call: FakeCall) => Reply) {
  const calls: FakeCall[] = [];
  const make = (base: Omit<FakeCall, 'ops'>) => {
    const ops: FakeCall['ops'] = [];
    const builder: unknown = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'then') {
            return (ok: (v: Reply) => unknown, bad: (e: unknown) => unknown) => {
              const call = { ...base, ops };
              calls.push(call);
              return Promise.resolve(respond(call)).then(ok, bad);
            };
          }
          return (...args: unknown[]) => {
            ops.push([prop, args]);
            return builder;
          };
        },
      },
    );
    return builder;
  };
  const client = {
    from: (table: string) => make({ table }),
    rpc: (rpc: string, args: unknown) => make({ rpc, args }),
  };
  return { client: client as unknown as SupabaseClient, calls };
}

export const hasOp = (c: FakeCall, name: string, ...args: unknown[]) =>
  c.ops.some(([n, a]) => n === name && args.every((x, i) => a[i] === x));
