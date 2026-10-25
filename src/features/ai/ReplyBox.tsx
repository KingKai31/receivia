import { tr } from '@/app/i18n';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, Pill, Select, Skeleton, useToast } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { formatINR, parseRupees } from '@/lib/money';
import { errorMessage } from '@/lib/service/errors';
import { supabase } from '@/lib/supabase';
import {
  applyReply,
  blockingIssues,
  needsConfirm,
  readReply,
  type ApplyPlan,
  type ReadResult,
} from './aiService';
import { INTENTS, MAX_TEXT, type Intent, type OpenInv } from './reply';
import type { ISODate } from '@/lib/dates';

const INTENT_LABEL: Record<Intent, string> = {
  promise: 'Promise to pay',
  dispute: 'Dispute',
  paid_claim: 'Says already paid',
  partial: 'Part payment',
  question: 'Question',
  other: 'Other',
};

const APPLY_LABEL: Record<Intent, string> = {
  promise: 'Record the promise',
  dispute: 'Record the dispute',
  paid_claim: 'Record the payment claim',
  partial: 'Record the part-payment promise',
  question: 'Nothing to record',
  other: 'Nothing to record',
};

interface Reading {
  result: ReadResult;
  today: ISODate;
  invoices: OpenInv[];
}

/** Paste a buyer's reply, see what it means, change anything that is wrong, apply it with one tap. */
export function ReplyBox({ customerId }: { customerId?: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const org = useOrg();
  const orgId = org.data?.orgId;
  const canWrite = org.data?.role === 'owner' || org.data?.role === 'accountant';
  const [picked, setPicked] = useState('');
  const customer = customerId ?? picked;
  const [text, setText] = useState('');
  const [reading, setReading] = useState<Reading | null>(null);
  const [intent, setIntent] = useState<Intent>('other');
  const [invoiceId, setInvoiceId] = useState('');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const customers = useQuery({
    queryKey: ['reply-customers', orgId],
    enabled: Boolean(orgId) && !customerId,
    queryFn: async () => {
      const r = await supabase
        .from('customers')
        .select('id, name')
        .eq('org_id', orgId!)
        .order('name')
        .limit(200);
      if (r.error) throw r.error;
      return (r.data ?? []) as { id: string; name: string }[];
    },
  });

  const read = useMutation({
    mutationFn: () => readReply(orgId!, customer, text),
    onSuccess: (d) => {
      setReading(d);
      const r = d.result;
      setIntent(r.intent);
      setInvoiceId(r.invoiceId ?? '');
      setDate(r.date ?? '');
      setAmount(r.amountPaise === null ? '' : String(r.amountPaise / 100));
      setReason(r.reason ?? '');
    },
    onError: (e) => toast.show(errorMessage(e)),
  });

  let amountPaise: number | null = null;
  let amountBad = false;
  if (amount.trim()) {
    try {
      amountPaise = parseRupees(amount);
    } catch {
      amountBad = true;
    }
  }
  const plan: ApplyPlan = {
    intent,
    customerId: customer,
    invoiceId: invoiceId || null,
    date: (date || null) as ISODate | null,
    amountPaise,
    reason: reason.trim() || null,
  };
  const issues = reading
    ? [
        ...(amountBad ? ['The amount is not valid.'] : []),
        ...blockingIssues(plan, reading.invoices, reading.today).filter(
          (i) => !i.startsWith('Not sure'),
        ),
      ]
    : [];
  const unsure = reading ? needsConfirm(reading.result) : false;
  const recordable = intent !== 'question' && intent !== 'other';

  const apply = useMutation({
    mutationFn: () => applyReply(orgId!, plan),
    onSuccess: (a) => {
      toast.show(a === 'exists' ? t('Already recorded for this invoice.') : t('Recorded.'));
      void qc.invalidateQueries();
      setReading(null);
      setText('');
    },
    onError: (e) => toast.show(errorMessage(e)),
  });

  if (!canWrite) return null;
  const busy = read.isPending || apply.isPending;
  return (
    <Card>
      <h2>{t("Read a buyer's reply")}</h2>
      {!customerId ? (
        <Select
          label="Customer"
          value={picked}
          onChange={(e) => {
            setPicked(e.target.value);
            setReading(null);
          }}
          options={[
            { value: '', label: t('Choose a customer') },
            ...(customers.data ?? []).map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
      ) : null}
      <div className="ui-field">
        <label htmlFor="reply-text">
          {t('Paste the reply from WhatsApp or email (English, Hindi, Marathi)')}
        </label>
        <textarea
          id="reply-text"
          className="ui-input"
          rows={4}
          maxLength={MAX_TEXT}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      <Button disabled={busy || !customer || !text.trim()} onClick={() => read.mutate()}>
        {t('Read reply')}
      </Button>
      {read.isPending ? (
        <div aria-live="polite">
          <p className="ui-hint">{t('Reading the reply…')}</p>
          <Skeleton rows={1} />
        </div>
      ) : null}
      {reading && !read.isPending ? (
        <div className="seq" aria-live="polite">
          <p>
            <Pill tone={unsure ? 'due' : 'paid'}>{t(INTENT_LABEL[intent])}</Pill>{' '}
            <span className="ui-hint">
              {reading.result.source === 'ai' ? t('Read by AI') : t('Read by simple rules')}
              {' · '}
              {t('{{pct}}% sure', { pct: Math.round(reading.result.confidence * 100) })}
            </span>
          </p>
          <Select
            label="What it means"
            value={intent}
            onChange={(e) => setIntent(e.target.value as Intent)}
            options={INTENTS.map((i) => ({ value: i, label: t(INTENT_LABEL[i]) }))}
          />
          {recordable ? (
            <>
              <Select
                label="Invoice"
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
                options={[
                  { value: '', label: t('Choose an invoice') },
                  ...reading.invoices.map((i) => ({
                    value: i.id,
                    label: `${i.number} · ${formatINR(i.balancePaise as never)}`,
                  })),
                ]}
              />
              {intent !== 'dispute' ? (
                <Input
                  label={intent === 'paid_claim' ? 'Date they say they paid' : 'Promised date'}
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              ) : null}
              {intent !== 'dispute' ? (
                <Input
                  label="Amount in rupees (optional)"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              ) : (
                <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
              )}
            </>
          ) : null}
          {unsure ? (
            <p role="status" className="ui-hint">
              {t('Not sure about this one: please check it.')}
            </p>
          ) : null}
          {issues.length ? (
            <ul role="alert">
              {issues.map((i) => (
                <li key={i}>{tr(i)}</li>
              ))}
            </ul>
          ) : null}
          {recordable ? (
            <Button disabled={busy || issues.length > 0} onClick={() => apply.mutate()}>
              {unsure ? t('Confirm and record') : t(APPLY_LABEL[intent])}
            </Button>
          ) : (
            <p>{t('Nothing to record for this kind of reply. Answer the buyer yourself.')}</p>
          )}
        </div>
      ) : null}
    </Card>
  );
}
