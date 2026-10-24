import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { useParams } from 'react-router-dom';
import { Badge, Button, Card, Input, Select } from '@/components/ui';
import { upiUri } from '@/features/documents/invoiceDocument';
import { addDays, todayIST } from '@/lib/dates';
import { buyerLens } from '@/lib/legal';
import type { BuyerFacts, InvoiceFacts, SellerFacts } from '@/lib/legal';
import { formatINR, paise } from '@/lib/money';
import { supabase } from '@/lib/supabase';
import { PAY_TEXT, type PayLang } from './payText';

export interface PayView {
  business_name: string;
  business_phone: string | null;
  business_email: string | null;
  upi_id: string | null;
  invoice_id: string;
  invoice_number: string;
  invoice_type: InvoiceFacts['invoice_type'];
  issue_date: string;
  due_date: string;
  accepted_on: string | null;
  total_paise: number;
  paid_paise: number;
  credited_paise: number;
  tds_paise: number;
  balance_paise: number;
  status: string;
  reverse_charge: boolean;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  razorpay_link_url: string | null;
  customer_name: string;
  language: PayLang;
  lens_facts: { seller: SellerFacts; buyer: BuyerFacts };
  open_dispute: boolean;
  pending_claim: boolean;
  replies: string[];
  razorpay: { configured: boolean; test_mode: boolean };
}

class PayError extends Error {
  constructor(
    readonly kind: 'not_found' | 'rate_limited' | 'invalid' | 'failed',
    message?: string,
  ) {
    super(message ?? kind);
  }
}

async function call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const res = await supabase.functions.invoke(fn, { body });
  if (res.error) {
    const ctx = (res.error as { context?: Response }).context;
    const status = ctx?.status;
    const detail = ctx ? await ctx.json().catch(() => null) : null;
    if (status === 404) throw new PayError('not_found');
    if (status === 429) throw new PayError('rate_limited');
    if (status === 400)
      throw new PayError('invalid', (detail as { message?: string } | null)?.message);
    throw new PayError('failed');
  }
  return res.data as T;
}

export function lensFor(v: PayView) {
  return buyerLens({
    seller: v.lens_facts.seller,
    buyer: v.lens_facts.buyer,
    invoice: {
      invoice_type: v.invoice_type,
      issue_date: v.issue_date,
      accepted_on: v.accepted_on,
      total_paise: v.total_paise,
      paid_paise: v.paid_paise,
      credited_paise: v.credited_paise,
      tds_paise: v.tds_paise,
      cgst_paise: v.cgst_paise,
      sgst_paise: v.sgst_paise,
      igst_paise: v.igst_paise,
      reverse_charge: v.reverse_charge,
    },
    today: todayIST(),
  });
}

/** Public buyer pay page: no login, phone first, in the customer's language. */
export function PayPage() {
  const { token = '' } = useParams<{ token: string }>();
  const q = useQuery({
    queryKey: ['pay-view', token],
    retry: false,
    queryFn: () => call<PayView>('get-pay-view', { token }),
  });
  if (q.isLoading)
    return (
      <main className="mx-auto max-w-xl p-4">
        <p>{PAY_TEXT.en.loading}</p>
      </main>
    );
  if (q.error || !q.data) {
    const e = q.error instanceof PayError ? q.error : null;
    return (
      <main className="mx-auto max-w-xl p-4">
        <p role="alert">
          {e?.kind === 'rate_limited'
            ? PAY_TEXT.en.tooMany
            : e?.kind === 'not_found'
              ? PAY_TEXT.en.notFound
              : PAY_TEXT.en.error}
        </p>
      </main>
    );
  }
  return <PayBody token={token} v={q.data} onChanged={() => void q.refetch()} />;
}

function PayBody({ token, v, onChanged }: { token: string; v: PayView; onChanged: () => void }) {
  const t = PAY_TEXT[v.language] ?? PAY_TEXT.en;
  const [done, setDone] = useState(false);
  const balance = paise(v.balance_paise);
  const paid = v.balance_paise <= 0 || v.status === 'paid';
  const lens = lensFor(v);
  const lensLine =
    v.language === 'hi' ? lens.line_hi : v.language === 'mr' ? lens.line_mr : lens.line_en;
  const uri = v.upi_id
    ? upiUri({
        vpa: v.upi_id,
        payee: v.business_name,
        amount: balance,
        note: `Invoice ${v.invoice_number}`,
      })
    : null;
  const qr = useQuery({
    queryKey: ['pay-qr', uri],
    enabled: Boolean(uri) && !paid,
    queryFn: () => QRCode.toDataURL(uri!, { margin: 1, width: 240 }),
  });
  const paused = v.open_dispute || v.pending_claim || done;

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-3 p-4">
      <h1>{v.business_name}</h1>
      <Card>
        <p>
          {t.invoice} <strong>{v.invoice_number}</strong>
        </p>
        <p>
          {t.amountDue}: <strong>{formatINR(balance)}</strong>
        </p>
        <p>
          {t.dueOn}: {v.due_date}
        </p>
        {paid ? <p role="status">{t.fullyPaid}</p> : null}
        {v.pending_claim ? <p role="status">{t.claimPending}</p> : null}
        {v.open_dispute ? <p role="status">{t.disputeOpen}</p> : null}
        {paused && !v.pending_claim && !v.open_dispute ? <p role="status">{t.paused}</p> : null}
      </Card>

      {v.replies.length ? (
        <Card>
          <h2>{t.replyHeading}</h2>
          {v.replies.map((r) => (
            <p key={r}>{r}</p>
          ))}
        </Card>
      ) : null}

      {!paid ? (
        <>
          {uri ? (
            <Card>
              <h2>{t.upiTitle}</h2>
              {qr.data ? <img src={qr.data} alt={t.upiQrAlt} width={200} height={200} /> : null}
              <a className="ui-button" data-variant="primary" href={uri}>
                {t.upiButton}
              </a>
            </Card>
          ) : null}
          <Card>
            {v.razorpay.configured && v.razorpay_link_url ? (
              <p>
                <a className="ui-button" data-variant="primary" href={v.razorpay_link_url}>
                  {t.online}
                </a>{' '}
                {v.razorpay.test_mode ? <Badge>{t.testMode}</Badge> : null}
              </p>
            ) : (
              <p>{t.onlineNotConfigured}</p>
            )}
          </Card>

          <ActionForms
            token={token}
            t={t}
            onDone={() => {
              setDone(true);
              onChanged();
            }}
          />
        </>
      ) : null}

      {lensLine ? (
        <Card>
          <h2>{t.lensHeading}</h2>
          <p>{lensLine}</p>
        </Card>
      ) : null}
      {v.business_phone || v.business_email ? (
        <p>
          {t.contact}: {[v.business_phone, v.business_email].filter(Boolean).join(' · ')}
        </p>
      ) : null}
    </main>
  );
}

function ActionForms({
  token,
  t,
  onDone,
}: {
  token: string;
  t: (typeof PAY_TEXT)['en'];
  onDone: () => void;
}) {
  const [open, setOpen] = useState<'paid' | 'wrong' | 'promise' | null>(null);
  const [ref, setRef] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState('');
  const today = todayIST();

  const send = useMutation({
    mutationFn: async () => {
      if (open === 'paid')
        return call('pay-action', {
          token,
          kind: 'paid',
          payload: { reference: ref, paid_on: paidOn },
        });
      if (open === 'wrong') {
        const label = t.reasons.find(([k]) => k === reason)?.[1] ?? reason;
        return call('pay-action', { token, kind: 'dispute', payload: { reason: label, note } });
      }
      return call('pay-action', { token, kind: 'promise', payload: { date } });
    },
    onSuccess: onDone,
  });
  const err = send.error instanceof PayError ? send.error : null;
  const ready =
    open === 'paid' ? Boolean(paidOn) : open === 'wrong' ? Boolean(reason) : Boolean(date);

  return (
    <Card>
      <div className="flex flex-col gap-2">
        <Button variant="secondary" onClick={() => setOpen('paid')}>
          {t.alreadyPaid}
        </Button>
        <Button variant="secondary" onClick={() => setOpen('wrong')}>
          {t.wrong}
        </Button>
        <Button variant="secondary" onClick={() => setOpen('promise')}>
          {t.willPay}
        </Button>
      </div>
      {open ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) send.mutate();
          }}
        >
          {open === 'paid' ? (
            <>
              <Input label={t.reference} value={ref} onChange={(e) => setRef(e.target.value)} />
              <Input
                label={t.paidOn}
                type="date"
                max={today}
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
              />
            </>
          ) : null}
          {open === 'wrong' ? (
            <>
              <Select
                label={t.reason}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                options={[
                  { value: '', label: '—' },
                  ...t.reasons.map(([value, label]) => ({ value, label })),
                ]}
              />
              <Input label={t.note} value={note} onChange={(e) => setNote(e.target.value)} />
            </>
          ) : null}
          {open === 'promise' ? (
            <Input
              label={t.payDate}
              type="date"
              min={today}
              max={addDays(today, 120)}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          ) : null}
          {err ? (
            <p role="alert">
              {err.kind === 'rate_limited'
                ? t.tooMany
                : err.kind === 'invalid' && err.message
                  ? err.message
                  : t.error}
            </p>
          ) : null}
          <Button type="submit" disabled={!ready || send.isPending}>
            {t.send}
          </Button>
        </form>
      ) : null}
    </Card>
  );
}
