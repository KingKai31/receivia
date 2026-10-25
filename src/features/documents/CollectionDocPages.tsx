import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Link, useParams } from 'react-router-dom';
import { Button, Loading } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import type { Stage } from '@/features/collect/ladder';
import { getCustomer, type Customer } from '@/features/customers/customerService';
import { getInvoice } from '@/features/invoices/invoiceService';
import {
  getBusinessProfile,
  type BusinessProfile,
} from '@/features/settings/businessProfileService';
import { todayIST } from '@/lib/dates';
import { errorMessage, fromPgError } from '@/lib/service/errors';
import { supabase } from '@/lib/supabase';
import { upiUri } from './invoiceDocument';
import {
  CaseDocument,
  LetterDocument,
  buildCaseModel,
  buildLetterModel,
  type CaseInput,
  type DocInvoice,
  type DocParty,
} from './collectionDocs';

const INVOICE_COLS =
  'id, number, invoice_type, issue_date, accepted_on, acceptance_source, due_date, total_paise, paid_paise, credited_paise, tds_paise, cgst_paise, sgst_paise, igst_paise, reverse_charge';

async function openInvoices(
  customerId: string,
  onlyOverdue: boolean,
  today: string,
): Promise<DocInvoice[]> {
  let q = supabase
    .from('invoices')
    .select(INVOICE_COLS)
    .eq('customer_id', customerId)
    .in('status', ['issued', 'partially_paid'])
    .order('due_date', { ascending: true })
    .limit(200);
  if (onlyOverdue) q = q.lt('due_date', today);
  const res = await q;
  if (res.error) throw fromPgError(res.error);
  return (res.data ?? []) as unknown as DocInvoice[];
}

type Profile = BusinessProfile & { demand_letter_days?: number };

function seller(p: Profile) {
  return {
    ...p,
    name: p.trade_name || p.legal_name,
    address: p.address ?? '',
  } satisfies DocParty & Record<string, unknown>;
}
function buyer(c: Customer) {
  return { ...c, address: c.address ?? '' };
}

function Toolbar({ back, children }: { back: string; children?: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="doc-toolbar">
      <Link to={back}>{t('Back')}</Link>
      {children}
      <Button onClick={() => window.print()}>{t('Print or save as PDF')}</Button>
    </div>
  );
}

export function LetterDocPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const org = useOrg();
  const orgId = org.data?.orgId;
  const [withInterest, setWithInterest] = useState(false);
  const today = todayIST();
  const q = useQuery({
    queryKey: ['doc-letter', id, orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const { invoice } = await getInvoice(id!);
      const [profile, cust] = await Promise.all([
        getBusinessProfile(orgId!),
        getCustomer(invoice.customer_id),
      ]);
      let invoices = await openInvoices(invoice.customer_id, true, today);
      invoices = invoices.filter((i) => i.id !== invoice.id);
      const self = (await openInvoices(invoice.customer_id, false, today)).find(
        (i) => i.id === invoice.id,
      );
      if (self) invoices = [self, ...invoices];
      return { profile: profile as Profile, cust, invoices };
    },
  });
  const data = q.data;
  const model = data
    ? buildLetterModel({
        today,
        seller: seller(data.profile),
        buyer: buyer(data.cust),
        invoices: data.invoices,
        deadlineDays: data.profile.demand_letter_days ?? 7,
        includeInterest: withInterest,
      })
    : null;
  const vpa = data?.profile.upi_id;
  const qr = useQuery({
    queryKey: ['letter-qr', vpa, model?.upiAmount],
    enabled: Boolean(model && vpa && model.upiAmount > 0),
    queryFn: () =>
      QRCode.toDataURL(
        upiUri({
          vpa: vpa!,
          payee: model!.seller.name,
          amount: model!.upiAmount,
          note: t('Invoice payment'),
        }),
        { margin: 1, width: 240 },
      ),
  });
  if (q.isLoading || org.isLoading) return <Loading />;
  if (q.error) return <p role="alert">{errorMessage(q.error)}</p>;
  if (!model) return null;
  return (
    <>
      <Toolbar back={`/invoices/${id}`}>
        {model.interestEligible ? (
          <label>
            <input
              type="checkbox"
              checked={withInterest}
              onChange={(e) => setWithInterest(e.target.checked)}
            />{' '}
            {t('Add MSMED interest to the amount')}
          </label>
        ) : null}
      </Toolbar>
      {model.rows.length === 0 ? (
        <p>{t('No overdue unpaid invoices for this customer.')}</p>
      ) : (
        <LetterDocument model={model} qrDataUrl={qr.data} />
      )}
    </>
  );
}

export function CaseDocPage() {
  const { customerId } = useParams();
  const org = useOrg();
  const orgId = org.data?.orgId;
  const today = todayIST();
  const q = useQuery({
    queryKey: ['doc-case', customerId, orgId],
    enabled: Boolean(orgId),
    queryFn: async () => {
      const [profile, cust, invoices] = await Promise.all([
        getBusinessProfile(orgId!),
        getCustomer(customerId!),
        openInvoices(customerId!, false, today),
      ]);
      const [rem, pay, dis] = await Promise.all([
        supabase
          .from('reminders')
          .select('sent_at, stage, channel')
          .eq('customer_id', customerId!)
          .eq('status', 'sent')
          .order('sent_at')
          .limit(200),
        supabase
          .from('payments')
          .select('received_on, amount_paise, method, reference')
          .eq('customer_id', customerId!)
          .order('received_on')
          .limit(200),
        supabase
          .from('disputes')
          .select('reason, status, raised_at, resolved_at, resolution_note')
          .eq('customer_id', customerId!)
          .order('raised_at')
          .limit(200),
      ]);
      for (const r of [rem, pay, dis]) if (r.error) throw fromPgError(r.error);
      const input: CaseInput = {
        today,
        seller: seller(profile as Profile),
        buyer: buyer(cust),
        invoices,
        reminders: (rem.data ?? []) as { sent_at: string; stage: Stage; channel: string }[],
        payments: (pay.data ?? []) as CaseInput['payments'],
        disputes: (dis.data ?? []) as CaseInput['disputes'],
      };
      return buildCaseModel(input);
    },
  });
  if (q.isLoading || org.isLoading) return <Loading />;
  if (q.error) return <p role="alert">{errorMessage(q.error)}</p>;
  if (!q.data) return null;
  return (
    <>
      <Toolbar back={`/customers/${customerId}`} />
      <CaseDocument model={q.data} />
    </>
  );
}
