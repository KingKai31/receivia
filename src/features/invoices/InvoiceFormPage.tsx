import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, Card, Input, Select, useToast } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { getCustomer, listCustomers } from '@/features/customers/customerService';
import { getBusinessProfile } from '@/features/settings/businessProfileService';
import { todayIST } from '@/lib/dates';
import { GST_RATES } from '@/lib/gst';
import { formatINR, formatINRShort } from '@/lib/money';
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
import { getInvoice, issueInvoice, saveDraft } from './invoiceService';

interface FormValues {
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

  const save = useMutation({
    mutationFn: async (args: { v: FormValues; issue: boolean }) => {
      if (!supplier || !customer.data || !orgId) throw new Error('Choose a customer first.');
      let inv = await saveDraft({
        orgId,
        invoice: existing.data?.invoice,
        input: toInput(args.v),
        supplier,
        buyer: customer.data,
      });
      if (args.issue) inv = await issueInvoice(inv);
      return inv;
    },
    onSuccess: (inv) => {
      toast.show(inv.number ? `Issued ${inv.number}.` : 'Draft saved.');
      void qc.invalidateQueries({ queryKey: ['invoices'] });
      void qc.invalidateQueries({ queryKey: ['invoice', inv.id] });
      nav(`/invoices/${inv.id}`);
    },
    onError: (e) => toast.show(errorMessage(e)),
  });

  if (existing.data && existing.data.invoice.status !== 'draft') {
    return (
      <p role="alert">
        Only drafts can be edited. Issue a credit or debit note to change an issued invoice.
      </p>
    );
  }
  if (profile.data && !profile.data.state_code) {
    return (
      <p role="alert">Set your business GSTIN or state in Settings before creating invoices.</p>
    );
  }

  const c = live.computed?.calc;
  const customerOptions = [
    { value: '', label: 'Choose a customer' },
    ...(customers.data?.rows ?? []).map((x) => ({ value: x.id, label: x.name })),
    ...(customer.data && !(customers.data?.rows ?? []).some((x) => x.id === customer.data!.id)
      ? [{ value: customer.data.id, label: customer.data.name }]
      : []),
  ];

  return (
    <>
      <h1>{id ? 'Edit draft invoice' : 'New invoice'}</h1>
      <form onSubmit={handleSubmit((v) => save.mutateAsync({ v, issue: false }))} noValidate>
        <fieldset disabled={!writable || save.isPending} className="m-0 grid gap-3 border-0 p-0">
          <Input
            label="Find customer"
            type="search"
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
          />
          <Select label="Customer" options={customerOptions} {...register('customerId')} />
          <Input
            label="Invoice date"
            type="date"
            {...register('issueDate', {
              onChange: (e) => recomputeDue(e.target.value, getValues('creditDays')),
            })}
          />
          <Input
            label="Credit days"
            inputMode="numeric"
            {...register('creditDays', {
              onChange: (e) => recomputeDue(getValues('issueDate'), e.target.value),
            })}
          />
          <Input label="Due date" type="date" {...register('dueDate')} />
          <label>
            <input type="checkbox" {...register('reverseCharge')} /> Reverse charge applies
          </label>
          <Input label="Delivery address" {...register('deliveryAddress')} />

          <h2>Lines</h2>
          {fields.map((f, i) => (
            <Card key={f.id}>
              <div className="grid gap-3">
                <Input
                  label={`Description (line ${i + 1})`}
                  {...register(`lines.${i}.description`)}
                />
                <Input label="HSN / SAC" {...register(`lines.${i}.hsn_sac`)} />
                <Input label="Quantity" inputMode="decimal" {...register(`lines.${i}.qty`)} />
                <Input label="Unit" {...register(`lines.${i}.unit`)} />
                <Input label="Rate (₹)" inputMode="decimal" {...register(`lines.${i}.rate`)} />
                <Input
                  label="Discount (₹)"
                  inputMode="decimal"
                  {...register(`lines.${i}.discount`)}
                />
                <Select
                  label="GST rate"
                  options={RATE_OPTIONS}
                  {...register(`lines.${i}.gst_rate`, { valueAsNumber: true })}
                />
                {c?.lines[i] ? <p>Line total: {formatINR(c.lines[i]!.total)}</p> : null}
                {fields.length > 1 ? (
                  <Button variant="secondary" onClick={() => remove(i)}>
                    Remove line {i + 1}
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
          <Button variant="secondary" onClick={() => append({ ...EMPTY_LINE })}>
            Add line
          </Button>
          <Input label="Notes" {...register('notes')} />

          <Card>
            <h2>Totals</h2>
            {live.error ? <p role="alert">{live.error}</p> : null}
            {c ? (
              <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                <dt>Taxable value</dt>
                <dd>{formatINR(c.taxable)}</dd>
                {c.intraState ? (
                  <>
                    <dt>CGST</dt>
                    <dd>{formatINR(c.cgst)}</dd>
                    <dt>SGST</dt>
                    <dd>{formatINR(c.sgst)}</dd>
                  </>
                ) : (
                  <>
                    <dt>IGST</dt>
                    <dd>{formatINR(c.igst)}</dd>
                  </>
                )}
                <dt>Round off</dt>
                <dd>{formatINR(c.roundOff)}</dd>
                <dt>
                  <strong>Total</strong>
                </dt>
                <dd>
                  <strong>{formatINR(c.grandTotal)}</strong> ({formatINRShort(c.grandTotal)})
                </dd>
              </dl>
            ) : (
              <p>Choose a customer to see totals.</p>
            )}
          </Card>

          {writable ? (
            <div className="flex flex-wrap gap-3">
              <Button type="submit" variant="secondary">
                Save draft
              </Button>
              <Button
                onClick={() => void handleSubmit((v) => save.mutateAsync({ v, issue: true }))()}
              >
                Save and issue
              </Button>
            </div>
          ) : null}
        </fieldset>
      </form>
    </>
  );
}
