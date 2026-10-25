import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Badge, Button, Card, CountDown, CountUp, Input, Select, Skeleton } from '@/components/ui';
import { upiUri } from '@/features/documents/invoiceDocument';
import { addDays, todayIST } from '@/lib/dates';
import { INSTALMENT_CONFIG, splitEvenly, validatePlan } from '@/lib/instalments';
import { buyerLens } from '@/lib/legal';
import type { BuyerFacts, InvoiceFacts, SellerFacts } from '@/lib/legal';
import { formatINR, paise } from '@/lib/money';
import { supabase } from '@/lib/supabase';
import { PAY_TEXT, type PayLang } from './payText';
import { TalkToAccounts } from './TalkToAccounts';

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
  acceptance_source?: 'buyer_confirmed' | 'proof_uploaded' | 'assumed_delivery_date' | null;
  plan?: {
    status: 'requested' | 'approved';
    owner_reply: string | null;
    items: { seq: number; due_on: string; amount_paise: number }[];
  } | null;
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
      acceptance_source: v.acceptance_source,
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
      <main className="app-main" style={{ maxWidth: 560 }}>
        <p className="sr-only">{PAY_TEXT.en.loading}</p>
        <Skeleton />
      </main>
    );
  if (q.error || !q.data) {
    const e = q.error instanceof PayError ? q.error : null;
    return (
      <main className="app-main" style={{ maxWidth: 560 }}>
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
  const [lang, setLang] = useState<PayLang>(v.language);
  const t = PAY_TEXT[lang] ?? PAY_TEXT.en;
  const [done, setDone] = useState(false);
  const balance = paise(v.balance_paise);
  const paid = v.balance_paise <= 0 || v.status === 'paid';
  const lens = lensFor(v);
  const lensLine = lang === 'hi' ? lens.line_hi : lang === 'mr' ? lens.line_mr : lens.line_en;
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
    queryFn: async () =>
      (await import('qrcode')).default.toDataURL(uri!, { margin: 1, width: 240 }),
  });
  const paused = v.open_dispute || v.pending_claim || done;
  const online = v.razorpay.configured && v.razorpay_link_url ? v.razorpay_link_url : null;
  const payHref = online ?? uri;

  return (
    <main className="app-main" style={{ maxWidth: 560 }}>
      <div className="app-top">
        <strong className="brand">{v.business_name}</strong>
        <div role="group" aria-label="Language / भाषा" className="chip-group glass">
          {(
            [
              ['en', 'EN', 'English'],
              ['hi', 'हि', 'हिन्दी'],
              ['mr', 'मरा', 'मराठी'],
            ] as const
          ).map(([code, short, name]) => (
            <button
              key={code}
              type="button"
              className="chip-btn"
              lang={code}
              aria-label={name}
              aria-pressed={lang === code}
              onClick={() => setLang(code)}
            >
              {short}
            </button>
          ))}
        </div>
      </div>
      <h1 className="sr-only">{v.business_name}</h1>
      <section className="hero page-enter" aria-label={t.amountDue}>
        {paid ? (
          <svg
            className="tick"
            viewBox="0 0 40 40"
            width="44"
            height="44"
            aria-hidden="true"
            style={{ display: 'block', margin: '0 auto' }}
          >
            <circle
              cx="20"
              cy="20"
              r="18"
              fill="none"
              stroke="#fff"
              strokeOpacity=".6"
              strokeWidth="2"
            />
            <path
              d="M11 21l6 6 12-13"
              fill="none"
              stroke="#fff"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
        <span className="hero-label">
          {t.invoice} <strong>{v.invoice_number}</strong> · {t.amountDue}
        </span>
        <div className="hero-big">
          {paid ? (
            <CountDown from={v.total_paise} format={(n) => formatINR(paise(n))} />
          ) : (
            <CountUp value={v.balance_paise} format={(n) => formatINR(paise(n))} />
          )}
        </div>
        <div className="hero-sub num">
          {t.dueOn}: {v.due_date}
        </div>
        {paid ? (
          <p role="status" className="hero-sub">
            {t.fullyPaid}
          </p>
        ) : null}
        {done ? (
          <p role="status" className="hero-sub soft-in">
            <svg
              className="tick"
              viewBox="0 0 40 40"
              width="20"
              height="20"
              aria-hidden="true"
              style={{ verticalAlign: 'middle', marginRight: 6 }}
            >
              <path
                d="M11 21l6 6 12-13"
                fill="none"
                stroke="#fff"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {t.thanks}
          </p>
        ) : null}
        {v.pending_claim ? (
          <p role="status" className="hero-sub">
            {t.claimPending}
          </p>
        ) : null}
        {v.open_dispute ? (
          <p role="status" className="hero-sub">
            {t.disputeOpen}
          </p>
        ) : null}
        {paused && !v.pending_claim && !v.open_dispute && !done ? (
          <p role="status" className="hero-sub">
            {t.paused}
          </p>
        ) : null}
        {!paid && payHref ? (
          <div className="hero-actions" style={{ gridTemplateColumns: '1fr' }}>
            <a className="ui-button" data-variant="light" href={payHref}>
              {t.payNow}
            </a>
          </div>
        ) : null}
      </section>

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
              {qr.data ? (
                <img
                  src={qr.data}
                  alt={t.upiQrAlt}
                  width={200}
                  height={200}
                  style={{ borderRadius: 16 }}
                />
              ) : null}
              <p>
                <a className="ui-button" data-variant="primary" href={uri}>
                  {t.upiButton}
                </a>
              </p>
            </Card>
          ) : null}
          <Card>
            {online ? (
              <p style={{ margin: 0 }}>
                <a className="ui-button" data-variant="primary" href={online}>
                  {t.online}
                </a>{' '}
                {v.razorpay.test_mode ? <Badge>{t.testMode}</Badge> : null}
              </p>
            ) : (
              <p style={{ margin: 0 }}>{t.onlineNotConfigured}</p>
            )}
          </Card>

          <ReceivedCard token={token} v={v} t={t} onDone={onChanged} />
          <PartsCard token={token} v={v} t={t} onDone={onChanged} />
          <TalkToAccounts token={token} lang={lang} onChanged={onChanged} />
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
          <details className="collapsible">
            <summary>{t.lensHeading}</summary>
            <p>{lensLine}</p>
          </details>
        </Card>
      ) : null}
      {v.business_phone || v.business_email ? (
        <p className="ui-hint">
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

type PayT = (typeof PAY_TEXT)['en'];

/** "Goods/services received": the buyer's acceptance date, which MSMED and 43B(h) lines count from. */
function ReceivedCard({
  token,
  v,
  t,
  onDone,
}: {
  token: string;
  v: PayView;
  t: PayT;
  onDone: () => void;
}) {
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const send = useMutation({
    mutationFn: () => call('pay-action', { token, kind: 'received', payload: { date, note } }),
    onSuccess: onDone,
  });
  if (v.acceptance_source === 'buyer_confirmed' && v.accepted_on) {
    return (
      <Card>
        <p role="status" style={{ margin: 0 }}>
          {t.receivedThanks} {t.receivedDone} <span className="num">{v.accepted_on}</span>
        </p>
      </Card>
    );
  }
  const err = send.error instanceof PayError ? send.error : null;
  return (
    <Card>
      <details className="collapsible">
        <summary>{t.receivedBtn}</summary>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (date) send.mutate();
          }}
        >
          <Input
            label={t.receivedOn}
            type="date"
            min={v.issue_date}
            max={todayIST()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Input label={t.receivedNote} value={note} onChange={(e) => setNote(e.target.value)} />
          {err ? (
            <p role="alert">{err.kind === 'invalid' && err.message ? err.message : t.error}</p>
          ) : null}
          <Button type="submit" disabled={!date || send.isPending}>
            {t.send}
          </Button>
        </form>
      </details>
    </Card>
  );
}

/** "Pay in parts": 2 to 4 instalments within the configured limits; the owner approves. */
function PartsCard({
  token,
  v,
  t,
  onDone,
}: {
  token: string;
  v: PayView;
  t: PayT;
  onDone: () => void;
}) {
  const today = todayIST();
  const [count, setCount] = useState(2);
  const [items, setItems] = useState(() => splitEvenly(v.balance_paise, 2, today));
  const send = useMutation({
    mutationFn: () => call('pay-action', { token, kind: 'instalments', payload: { items } }),
    onSuccess: onDone,
  });
  if (v.plan) {
    return (
      <Card>
        <p role="status" style={{ margin: 0 }}>
          {v.plan.status === 'approved' ? t.partsApproved : t.partsPending}
        </p>
        <ul>
          {v.plan.items.map((i) => (
            <li key={i.seq} className="num">
              {i.due_on}: {formatINR(paise(i.amount_paise))}
            </li>
          ))}
        </ul>
        {v.plan.owner_reply ? <p>{v.plan.owner_reply}</p> : null}
      </Card>
    );
  }
  const problems = validatePlan(items, v.balance_paise, today);
  const err = send.error instanceof PayError ? send.error : null;
  return (
    <Card>
      <details className="collapsible">
        <summary>{t.partsBtn}</summary>
        <p className="ui-hint">{t.partsHint}</p>
        <Select
          label={t.partsCount}
          value={String(count)}
          onChange={(e) => {
            const n = Number(e.target.value);
            setCount(n);
            setItems(splitEvenly(v.balance_paise, n, today));
          }}
          options={Array.from(
            { length: INSTALMENT_CONFIG.maxCount - INSTALMENT_CONFIG.minCount + 1 },
            (_, i) => {
              const n = i + INSTALMENT_CONFIG.minCount;
              return { value: String(n), label: String(n) };
            },
          )}
        />
        {items.map((it, i) => (
          <div key={i} className="flex gap-2">
            <Input
              label={`${t.partsDate} ${i + 1}`}
              type="date"
              min={today}
              max={addDays(today, INSTALMENT_CONFIG.maxDaysAhead)}
              value={it.date}
              onChange={(e) =>
                setItems(items.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))
              }
            />
            <Input
              label={`${t.partsAmount} ${i + 1}`}
              inputMode="decimal"
              value={String(it.amount_paise / 100)}
              onChange={(e) => {
                const n = Math.round(Number(e.target.value) * 100);
                setItems(
                  items.map((x, j) =>
                    j === i ? { ...x, amount_paise: Number.isFinite(n) ? n : 0 } : x,
                  ),
                );
              }}
            />
          </div>
        ))}
        {problems.length ? <p className="ui-hint">{problems[0]}</p> : null}
        {err ? (
          <p role="alert">{err.kind === 'invalid' && err.message ? err.message : t.error}</p>
        ) : null}
        <Button disabled={problems.length > 0 || send.isPending} onClick={() => send.mutate()}>
          {t.send}
        </Button>
        {send.isSuccess ? <p role="status">{t.partsSent}</p> : null}
      </details>
    </Card>
  );
}
