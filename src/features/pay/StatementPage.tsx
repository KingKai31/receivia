import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Button, Card, Input, Skeleton } from '@/components/ui';
import { formatINR, paise } from '@/lib/money';
import { supabase } from '@/lib/supabase';

interface Row {
  id?: string;
  number?: string;
  date?: string;
  issue_date?: string;
  due_date?: string;
  invoice_id?: string;
  amount_paise?: number;
  total_paise?: number;
  paid_paise?: number;
  credited_paise?: number;
  tds_paise?: number;
  balance_paise?: number;
  disputed?: boolean;
  section?: string;
  method?: string;
}
export interface Statement {
  business_name: string;
  customer_name: string;
  as_of: string;
  invoices: Row[];
  credit_notes: Row[];
  payments: Row[];
  tds: Row[];
  balance_paise: number;
  last_response: { kind: 'confirmed' | 'disputed_line'; at: string } | null;
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const res = await supabase.functions.invoke('statement', { body });
  if (res.error) {
    const status = (res.error as { context?: Response }).context?.status;
    throw new Error(status === 404 ? 'not_found' : status === 429 ? 'rate_limited' : 'failed');
  }
  return res.data as T;
}

const inr = (n: number | undefined) => formatINR(paise(n ?? 0));

/** Public statement of account: the open ledger, with Confirm balance or Dispute a line. */
export function StatementPage() {
  const { token = '' } = useParams<{ token: string }>();
  const q = useQuery({
    queryKey: ['statement', token],
    retry: false,
    queryFn: () => call<Statement>({ token }),
  });
  const [dispute, setDispute] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const act = useMutation({
    mutationFn: (b: { kind: 'confirm' | 'dispute_line'; payload?: object }) =>
      call({ token, ...b }),
    onSuccess: () => {
      setDispute(null);
      setReason('');
      void q.refetch();
    },
  });
  if (q.isLoading)
    return (
      <main className="app-main" style={{ maxWidth: 720 }}>
        <Skeleton />
      </main>
    );
  if (q.error || !q.data) {
    return (
      <main className="app-main" style={{ maxWidth: 720 }}>
        <p role="alert">
          {q.error instanceof Error && q.error.message === 'rate_limited'
            ? 'Too many attempts. Please wait a few minutes.'
            : 'This link is not valid or has expired. Please ask the business for a new one.'}
        </p>
      </main>
    );
  }
  const s = q.data;
  const noteFor = (id: string | undefined) => s.credit_notes.filter((n) => n.invoice_id === id);
  const lines = (rows: Row[], id: string | undefined) => rows.filter((r) => r.invoice_id === id);
  return (
    <main className="app-main" style={{ maxWidth: 720 }}>
      <div className="app-top">
        <strong className="brand">{s.business_name}</strong>
      </div>
      <h1>Statement of account</h1>
      <p className="ui-hint">
        {s.customer_name} · as of <span className="num">{s.as_of}</span>
      </p>
      <section className="hero page-enter" aria-label="Balance">
        <span className="hero-label">Balance outstanding</span>
        <div className="hero-big">{inr(s.balance_paise)}</div>
      </section>
      {s.last_response ? (
        <p role="status" className="ui-hint">
          {s.last_response.kind === 'confirmed'
            ? 'You confirmed this balance'
            : 'You raised a question on a line'}{' '}
          on {s.last_response.at.slice(0, 10)}.
        </p>
      ) : null}
      {s.invoices.length === 0 ? (
        <Card>
          <p style={{ margin: 0 }}>Nothing is outstanding.</p>
        </Card>
      ) : null}
      {s.invoices.map((i) => (
        <Card key={i.id}>
          <h2 style={{ marginTop: 0 }}>{i.number}</h2>
          <p className="ui-hint num">
            Invoice date {i.issue_date} · due {i.due_date}
            {i.disputed ? ' · query open' : ''}
          </p>
          <table className="ui-table">
            <tbody>
              <tr>
                <td>Invoice</td>
                <td className="num">{inr(i.total_paise)}</td>
              </tr>
              {noteFor(i.id).map((n) => (
                <tr key={n.number}>
                  <td>
                    Credit note {n.number} ({n.date})
                  </td>
                  <td className="num">− {inr(n.amount_paise)}</td>
                </tr>
              ))}
              {lines(s.payments, i.id).map((p, k) => (
                <tr key={k}>
                  <td>Payment {p.date}</td>
                  <td className="num">− {inr(p.amount_paise)}</td>
                </tr>
              ))}
              {lines(s.tds, i.id).map((p, k) => (
                <tr key={k}>
                  <td>
                    TDS {p.section} {p.date ?? ''}
                  </td>
                  <td className="num">− {inr(p.amount_paise)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">Balance</th>
                <th className="num">{inr(i.balance_paise)}</th>
              </tr>
            </tbody>
          </table>
          {dispute === i.id ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (reason.trim())
                  act.mutate({ kind: 'dispute_line', payload: { invoice_id: i.id, reason } });
              }}
            >
              <Input
                label="What is wrong with this line?"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <Button type="submit" disabled={!reason.trim() || act.isPending}>
                Send
              </Button>
            </form>
          ) : (
            <Button variant="secondary" onClick={() => setDispute(i.id ?? null)}>
              Dispute this line
            </Button>
          )}
        </Card>
      ))}
      {s.invoices.length ? (
        <Card>
          <Button disabled={act.isPending} onClick={() => act.mutate({ kind: 'confirm' })}>
            Confirm balance
          </Button>
          {act.isError ? <p role="alert">Something went wrong. Please try again.</p> : null}
        </Card>
      ) : null}
    </main>
  );
}
