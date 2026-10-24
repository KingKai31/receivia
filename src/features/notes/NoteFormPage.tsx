import { tr } from '@/app/i18n';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Input, Select, useToast } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { getInvoice } from '@/features/invoices/invoiceService';
import { todayIST } from '@/lib/dates';
import { GST_RATES } from '@/lib/gst';
import { section34Warning } from '@/lib/legal/section34';
import { can } from '@/lib/permissions';
import { errorMessage } from '@/lib/service/errors';
import { createNoteDraft, issueNote } from './noteService';

export function NoteFormPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const org = useOrg();
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const inv = useQuery({ queryKey: ['invoice', id], queryFn: () => getInvoice(id!) });
  const [type, setType] = useState<'credit' | 'debit'>('credit');
  const [reason, setReason] = useState('');
  const [taxable, setTaxable] = useState('');
  const [rate, setRate] = useState<number | null>(null);
  const [date, setDate] = useState(todayIST());

  const create = useMutation({
    mutationFn: async () => {
      const draft = await createNoteDraft(org.data!.orgId, inv.data!.invoice, {
        type,
        reason,
        taxable,
        gstRate: rate ?? Number(inv.data!.lines[0]?.gst_rate ?? 18),
        issueDate: date,
      });
      return issueNote(draft);
    },
    onSuccess: (n) => {
      toast.show(t('Issued {{number}}.', { number: n.number }));
      void qc.invalidateQueries({ queryKey: ['notes', id] });
      void qc.invalidateQueries({ queryKey: ['timeline', id] });
      nav(`/invoices/${id}`);
    },
    onError: (e) => toast.show(errorMessage(e)),
  });

  if (inv.isLoading) return <p>{t('Loading…')}</p>;
  if (inv.error) return <p role="alert">{errorMessage(inv.error)}</p>;
  if (!inv.data) return null;
  const warning = type === 'credit' ? section34Warning(inv.data.invoice.issue_date, date) : null;
  const writable = can.writeData(org.data?.role ?? null);

  return (
    <>
      <h1>
        {t('Credit or debit note for')} {inv.data.invoice.number}
      </h1>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Select
          label={t('Type')}
          value={type}
          onChange={(e) => setType(e.target.value as 'credit' | 'debit')}
          options={[
            { value: 'credit', label: t('Credit note (reduces what is owed)') },
            { value: 'debit', label: t('Debit note (increases what is owed)') },
          ]}
        />
        <Input
          label={t('Note date')}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Input label={t('Reason')} value={reason} onChange={(e) => setReason(e.target.value)} />
        <Input
          label={t('Taxable amount (₹)')}
          inputMode="decimal"
          value={taxable}
          onChange={(e) => setTaxable(e.target.value)}
        />
        <Select
          label={t('GST rate')}
          value={String(rate ?? inv.data.lines[0]?.gst_rate ?? 18)}
          onChange={(e) => setRate(Number(e.target.value))}
          options={GST_RATES.map((r) => ({ value: String(r), label: `${r}%` }))}
        />
        {warning ? <p role="note">{tr(warning.text)}</p> : null}
        {writable ? (
          <Button type="submit" disabled={create.isPending}>
            {t('Issue note')}
          </Button>
        ) : null}
      </form>
    </>
  );
}
