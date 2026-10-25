import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, Card, Input, Select, useToast } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { getCustomer, listCustomers } from '@/features/customers/customerService';
import { getBusinessProfile } from '@/features/settings/businessProfileService';
import { todayIST } from '@/lib/dates';
import { GST_RATES } from '@/lib/gst';
import { formatINR, formatINRShort, paise } from '@/lib/money';
import { can } from '@/lib/permissions';
import { errorMessage } from '@/lib/service/errors';
import {
  EMPTY_LINE,
  computeDraft,
  dueDateFor,
  type ComputedDraft,
  type DraftInput,
  type DraftLine,
} from './invoiceModel';
import { getInvoice, issueInvoice, overridePayability, saveDraft } from './invoiceService';
import { takePrefill } from './scan/scanService';
import type { ScannedInvoice } from './scan/audit';
import { PayabilityChecklist } from './PayabilityChecklist';
import { creditWarning, loadCreditContext, scoreDraft } from './payabilityService';
import { PAYABILITY_CONFIG } from '@/lib/payability';
import { ServiceError } from '@/lib/service/errors';

interface FormValues {
  poNumber: string;
  ewayBillNo: string;
  deliveryRef: string;
  customerId: string;
  issueDate: string;
  creditDays: string;
  dueDate: string;
  reverseCharge: boolean;
  deliveryAddress: string;
  notes: string;
  lines: DraftLine[];
}

const RATE_OPTIONS = GST_RATES.map((r) => ({ value: String(r), label: `${r}%` }));

export function InvoiceFormPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [params] = useSearchParams();
  const org = useOrg();
  const orgId = org.data?.orgId;
  const writable = can.writeData(org.data?.role ?? null);
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [customerSearch, setCustomerSearch] = useState('');

  const profile = useQuery({
    queryKey: ['business-profile', orgId],
    enabled: Boolean(orgId),
    queryFn: () => getBusinessProfile(orgId!),
  });
  const customers = useQuery({
    queryKey: ['customer-options', orgId, customerSearch],
    enabled: Boolean(orgId),
    queryFn: () => listCustomers({ orgId: orgId!, search: customerSearch, pageSize: 100 }),
  });
  const existing = useQuery({
    queryKey: ['invoice', id],
    enabled: Boolean(id),
    queryFn: () => getInvoice(id!),
  });

  const { register, control, handleSubmit, watch, reset, setValue, getValues } =
    useForm<FormValues>({
      defaultValues: {
        customerId: params.get('customer') ?? '',
        poNumber: '',
        ewayBillNo: '',
        deliveryRef: '',
        issueDate: todayIST(),
        creditDays: '30',
        dueDate: dueDateFor(todayIST(), 30),
        reverseCharge: false,
        deliveryAddress: '',
        notes: '',
        lines: [{ ...EMPTY_LINE }],
      },
    });
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

  useEffect(() => {
    const e = existing.data;
    if (!e) return;
    reset({
      customerId: e.invoice.customer_id,
      poNumber: e.invoice.po_number ?? '',
      ewayBillNo: e.invoice.eway_bill_no ?? '',
      deliveryRef: e.invoice.delivery_ref ?? '',
      issueDate: e.invoice.issue_date,
      creditDays: '30',
      dueDate: e.invoice.due_date,
      reverseCharge: e.invoice.reverse_charge,
      deliveryAddress: e.invoice.delivery_address ?? '',
      notes: e.invoice.notes ?? '',
      lines: e.lines.map((l) => ({
        description: l.description,
        hsn_sac: l.hsn_sac ?? '',
        qty: String(l.qty),
        unit: l.unit ?? '',
        rate: (l.rate_paise / 100).toFixed(2),
        discount: l.discount_paise ? (l.discount_paise / 100).toFixed(2) : '',
        gst_rate: Number(l.gst_rate),
      })),
    });
  }, [existing.data, reset]);

  // "Scan invoice" hands over a reading once; the owner reviews and saves it, nothing is saved here.
  const scanned = useRef<ScannedInvoice | null | undefined>(undefined);
  useEffect(() => {
    if (id || !params.get('scan') || scanned.current !== undefined) return;
    const s = takePrefill();
    scanned.current = s;
    if (!s) return;
    const slabs = GST_RATES as readonly number[];
    setValue('issueDate', s.date ?? todayIST());
    setValue(
      'notes',
      `Read from invoice ${s.invoice_no ?? ''} by AI. Check every line before saving.`,
    );
    if (s.lines.length)
      setValue(
        'lines',
        s.lines.map((l) => ({
          description: l.description,
          hsn_sac: l.hsn,
          qty: String(l.qty),
          unit: 'Nos',
          rate: l.rate.toFixed(2),
          discount: l.discount ? l.discount.toFixed(2) : '',
          gst_rate: slabs.includes(l.gst_rate) ? l.gst_rate : 18,
        })),
      );
  }, [id, params, setValue]);
  useEffect(() => {
    const s = scanned.current;
    if (!s?.buyer_gstin || getValues('customerId') || !customers.data) return;
    const match = customers.data.rows.find((c) => c.gstin === s.buyer_gstin);
    if (match) setValue('customerId', match.id);
  }, [customers.data, getValues, setValue]);

  const customerId = watch('customerId');
  const customer = useQuery({
    queryKey: ['customer', customerId],
    enabled: Boolean(customerId),
    queryFn: () => getCustomer(customerId),
  });
  // Credit days default from the customer; the user can still change the due date.
  useEffect(() => {
    if (!customer.data || id) return;
    setValue('creditDays', String(customer.data.credit_days));
    setValue('dueDate', dueDateFor(getValues('issueDate'), customer.data.credit_days));
  }, [customer.data, id, setValue, getValues]);

  const values = watch();
  const recomputeDue = (issueDate: string, creditDays: string) => {
    const n = Number(creditDays);
    if (Number.isInteger(n) && n >= 0 && issueDate) setValue('dueDate', dueDateFor(issueDate, n));
  };

  const toInput = (v: FormValues): DraftInput => ({
    customerId: v.customerId,
    issueDate: v.issueDate,
    creditDays: Number(v.creditDays),
    dueDate: v.dueDate || undefined,
    reverseCharge: v.reverseCharge,
    deliveryAddress: v.deliveryAddress,
    notes: v.notes,
    lines: v.lines.map((l) => ({ ...l, gst_rate: Number(l.gst_rate) })),
    poNumber: v.poNumber,
    ewayBillNo: v.ewayBillNo,
    deliveryRef: v.deliveryRef,
  });

  const supplier = profile.data?.state_code
    ? { stateCode: profile.data.state_code, registrationType: profile.data.registration_type }
    : null;

  const live: { computed?: ComputedDraft; error?: string } = useMemo(() => {
    if (!supplier || !customer.data) return {};
    try {
      return { computed: computeDraft(toInput(values), supplier, customer.data) };
    } catch (e) {
      return { error: errorMessage(e) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(values), supplier?.stateCode, supplier?.registrationType, customer.data]);

  const threshold = profile.data?.payability_threshold ?? PAYABILITY_CONFIG.defaultThreshold;
  const payability = useMemo(
    () =>
      live.computed && customer.data && profile.data
        ? scoreDraft(toInput(values), live.computed, customer.data, profile.data)
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live.computed, customer.data, profile.data, JSON.stringify(values)],
  );
  const belowThreshold = payability !== null && payability.score < threshold;
  const isOwner = org.data?.role === 'owner';
  const [overrideReason, setOverrideReason] = useState('');
  const creditCtx = useQuery({
    queryKey: ['credit-context', orgId, customerId],
    enabled: Boolean(orgId && customerId),
    queryFn: () => loadCreditContext(orgId!, customerId),
  });
  const credit =
    creditCtx.data && customer.data && live.computed
      ? creditWarning(creditCtx.data, customer.data, live.computed.calc.grandTotal)
      : null;

  const save = useMutation({
    mutationFn: async (args: { v: FormValues; issue: boolean; override?: string }) => {
      if (!supplier || !customer.data || !orgId || !profile.data)
        throw new Error('Choose a customer first.');
      const input = toInput(args.v);
      const score = scoreDraft(
        input,
        computeDraft(input, supplier, customer.data),
        customer.data,
        profile.data,
      ).score;
      let inv = await saveDraft({
        orgId,
        invoice: existing.data?.invoice,
        input: { ...input, payabilityScore: score },
        supplier,
        buyer: customer.data,
      });
      if (args.issue) {
        if (score < threshold) {
          if (!args.override?.trim())
            throw new ServiceError(
              'VALIDATION',
              `Payability score ${score} is below ${threshold}. The owner can override with a reason.`,
            );
          inv = await overridePayability(inv.id, args.override);
        }
        inv = await issueInvoice(inv);
      }
      return inv;
    },
    onSuccess: (inv) => {
      toast.show(inv.number ? t('Issued {{number}}.', { number: inv.number }) : t('Draft saved.'));
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      void qc.invalidateQueries({ queryKey: ['invoice', inv.id] });
      nav(`/invoices/${inv.id}`);
    },
    onError: (e) => toast.show(errorMessage(e)),
  });

  if (existing.data && existing.data.invoice.status !== 'draft') {
    return (
      <p role="alert">
        {t('Only drafts can be edited. Issue a credit or debit note to change an issued invoice.')}
      </p>
    );
  }
  if (profile.data && !profile.data.state_code) {
    return (
      <p role="alert">
        {t('Set your business GSTIN or state in Settings before creating invoices.')}
      </p>
    );
  }

  const c = live.computed?.calc;
  const customerOptions = [
    { value: '', label: t('Choose a customer') },
    ...(customers.data?.rows ?? []).map((x) => ({ value: x.id, label: x.name })),
    ...(customer.data && !(customers.data?.rows ?? []).some((x) => x.id === customer.data!.id)
      ? [{ value: customer.data.id, label: customer.data.name }]
      : []),
  ];

  return (
    <>
      <h1>{id ? t('Edit draft invoice') : t('New invoice')}</h1>
      <form onSubmit={handleSubmit((v) => save.mutateAsync({ v, issue: false }))} noValidate>
        <fieldset disabled={!writable || save.isPending} className="m-0 grid gap-3 border-0 p-0">
          <Input
            label={t('Find customer')}
            type="search"
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
          />
          <Select label={t('Customer')} options={customerOptions} {...register('customerId')} />
          <Input
            label={t('Invoice date')}
            type="date"
            {...register('issueDate', {
              onChange: (e) => recomputeDue(e.target.value, getValues('creditDays')),
            })}
          />
          <Input
            label={t('Credit days')}
            inputMode="numeric"
            {...register('creditDays', {
              onChange: (e) => recomputeDue(getValues('issueDate'), e.target.value),
            })}
          />
          <Input label={t('Due date')} type="date" {...register('dueDate')} />
          <label>
            <input type="checkbox" {...register('reverseCharge')} /> {t('Reverse charge applies')}
          </label>
          <Input label={t('Delivery address')} {...register('deliveryAddress')} />
          <Input label={t('PO or reference number')} {...register('poNumber')} />
          <Input label={t('E-way bill number')} {...register('ewayBillNo')} />
          <Input
            label={t('GRN or challan number')}
            hint={t('Proof of delivery can be uploaded after the invoice is issued.')}
            {...register('deliveryRef')}
          />

          <h2>{t('Lines')}</h2>
          {fields.map((f, i) => (
            <Card key={f.id}>
              <div className="grid gap-3">
                <Input
                  label={t('Description (line {{v}})', { v: i + 1 })}
                  {...register(`lines.${i}.description`)}
                />
                <Input label={t('HSN / SAC')} {...register(`lines.${i}.hsn_sac`)} />
                <Input label={t('Quantity')} inputMode="decimal" {...register(`lines.${i}.qty`)} />
                <Input label={t('Unit')} {...register(`lines.${i}.unit`)} />
                <Input label={t('Rate (₹)')} inputMode="decimal" {...register(`lines.${i}.rate`)} />
                <Input
                  label={t('Discount (₹)')}
                  inputMode="decimal"
                  {...register(`lines.${i}.discount`)}
                />
                <Select
                  label={t('GST rate')}
                  options={RATE_OPTIONS}
                  {...register(`lines.${i}.gst_rate`, { valueAsNumber: true })}
                />
                {c?.lines[i] ? (
                  <p>
                    {t('Line total:')} {formatINR(c.lines[i]!.total)}
                  </p>
                ) : null}
                {fields.length > 1 ? (
                  <Button variant="secondary" onClick={() => remove(i)}>
                    {t('Remove line')} {i + 1}
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
          <Button variant="secondary" onClick={() => append({ ...EMPTY_LINE })}>
            {t('Add line')}
          </Button>
          <Input label={t('Notes')} {...register('notes')} />

          <Card>
            <h2>{t('Totals')}</h2>
            {live.error ? <p role="alert">{live.error}</p> : null}
            {c ? (
              <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                <dt>{t('Taxable value')}</dt>
                <dd>{formatINR(c.taxable)}</dd>
                {c.intraState ? (
                  <>
                    <dt>{t('CGST')}</dt>
                    <dd>{formatINR(c.cgst)}</dd>
                    <dt>{t('SGST')}</dt>
                    <dd>{formatINR(c.sgst)}</dd>
                  </>
                ) : (
                  <>
                    <dt>{t('IGST')}</dt>
                    <dd>{formatINR(c.igst)}</dd>
                  </>
                )}
                <dt>{t('Round off')}</dt>
                <dd>{formatINR(c.roundOff)}</dd>
                <dt>
                  <strong>{t('Total')}</strong>
                </dt>
                <dd>
                  <strong>{formatINR(c.grandTotal)}</strong>{' '}
                  {t('({{formatINRShort}})', { formatINRShort: formatINRShort(c.grandTotal) })}
                </dd>
              </dl>
            ) : (
              <p>{t('Choose a customer to see totals.')}</p>
            )}
          </Card>

          {credit?.exceeded ? (
            <p role="alert">
              {t('{{over}} over the credit limit; usually pays {{days}} days late.', {
                over: formatINRShort(paise(credit.overPaise)),
                days: credit.usualDelayDays,
              })}
            </p>
          ) : null}
          {payability ? <PayabilityChecklist p={payability} threshold={threshold} /> : null}
          {belowThreshold ? (
            <Card>
              <p role="alert">
                {isOwner
                  ? t(
                      'Below the payability threshold. Give a reason to issue anyway; it is logged.',
                    )
                  : t('Below the payability threshold. Only the owner can override.')}
              </p>
              {isOwner ? (
                <Input
                  label={t('Reason for override')}
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                />
              ) : null}
            </Card>
          ) : null}
          {writable ? (
            <div className="flex flex-wrap gap-3">
              <Button type="submit" variant="secondary">
                {t('Save draft')}
              </Button>
              <Button
                onClick={() =>
                  void handleSubmit((v) =>
                    save.mutateAsync({ v, issue: true, override: overrideReason }),
                  )()
                }
              >
                {t('Save and issue')}
              </Button>
            </div>
          ) : null}
        </fieldset>
      </form>
    </>
  );
}
