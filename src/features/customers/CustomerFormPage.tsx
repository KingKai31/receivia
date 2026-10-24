import { tr } from '@/app/i18n';
import { useTranslation } from 'react-i18next';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Input, Select, useToast } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { GST_STATES } from '@/lib/gst';
import { validateGstin } from '@/lib/gstin';
import { can } from '@/lib/permissions';
import { errorMessage } from '@/lib/service/errors';
import {
  EMPTY_CUSTOMER,
  createCustomer,
  customerSchema,
  customerToForm,
  getCustomer,
  updateCustomer,
  type CustomerForm,
} from './customerService';

const STATE_OPTIONS = [
  { value: '', label: 'Not set' },
  ...Object.entries(GST_STATES).map(([code, name]) => ({ value: code, label: `${code} ${name}` })),
];
const TIER = [
  { value: 'standard', label: 'Standard' },
  { value: 'key', label: 'Key customer' },
];
const LANG = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'mr', label: 'Marathi' },
];
const ENTITY = [
  { value: '', label: 'Not set' },
  { value: 'company', label: 'Company' },
  { value: 'firm', label: 'Firm / LLP' },
  { value: 'proprietor', label: 'Proprietor' },
  { value: 'government', label: 'Government' },
  { value: 'individual', label: 'Individual' },
];
const PRESUMPTIVE = [
  { value: 'unknown', label: 'Unknown' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

export function CustomerFormPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const org = useOrg();
  const orgId = org.data?.orgId;
  const writable = can.writeData(org.data?.role ?? null);
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const existing = useQuery({
    queryKey: ['customer', id],
    enabled: Boolean(id),
    queryFn: () => getCustomer(id!),
  });
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CustomerForm>({
    resolver: zodResolver(customerSchema),
    mode: 'onChange',
    defaultValues: EMPTY_CUSTOMER,
  });
  useEffect(() => {
    if (existing.data) reset(customerToForm(existing.data));
  }, [existing.data, reset]);

  const save = useMutation({
    mutationFn: (v: CustomerForm) =>
      id ? updateCustomer(existing.data!, v) : createCustomer(orgId!, v),
    onSuccess: (c) => {
      toast.show(t('Customer saved.'));
      void qc.invalidateQueries({ queryKey: ['customers'] });
      void qc.invalidateQueries({ queryKey: ['customer', c.id] });
      nav(`/customers/${c.id}`);
    },
    onError: (e) => toast.show(errorMessage(e)),
  });

  const gstin = watch('gstin') ?? '';
  const g = gstin.trim() ? validateGstin(gstin) : null;
  const derived = g && g.valid ? GST_STATES[g.stateCode] : null;

  if (id && existing.isLoading) return <p>{t('Loading…')}</p>;
  if (id && existing.error) return <p role="alert">{errorMessage(existing.error)}</p>;

  return (
    <>
      <h1>{id ? t('Edit customer') : t('New customer')}</h1>
      <form onSubmit={handleSubmit((v) => save.mutateAsync(v))} noValidate>
        <fieldset disabled={!writable || isSubmitting} className="m-0 grid gap-3 border-0 p-0">
          <Input label={t('Name')} error={errors.name?.message} {...register('name')} />
          <Input
            label={t('GSTIN')}
            maxLength={15}
            error={
              errors.gstin?.message ??
              (g && !g.valid
                ? t('GSTIN is not valid ({{v}})', { v: g.reason.toLowerCase() })
                : undefined)
            }
            hint={
              derived
                ? t('State: {{derived}}', { derived: tr(derived) })
                : t('Leave empty for an unregistered buyer.')
            }
            {...register('gstin')}
          />
          {derived ? null : (
            <Select label={t('State')} options={STATE_OPTIONS} {...register('state_code')} />
          )}
          <Input
            label={t('Credit days')}
            inputMode="numeric"
            error={errors.credit_days?.message}
            {...register('credit_days')}
          />
          <Select label={t('Tier')} options={TIER} {...register('tier')} />
          <Select label={t('Language')} options={LANG} {...register('language')} />
          <Select label={t('Entity type')} options={ENTITY} {...register('entity_type')} />
          <Select
            label={t('Presumptive tax (Section 44AD/44ADA)')}
            options={PRESUMPTIVE}
            {...register('presumptive_tax')}
          />
          <label>
            <input type="checkbox" {...register('has_written_agreement')} />{' '}
            {t('Written agreement on payment terms')}
          </label>
          <Input label={t('Contact name')} {...register('contact_name')} />
          <Input
            label={t('Email')}
            type="email"
            error={errors.email?.message}
            {...register('email')}
          />
          <Input label={t('Phone')} type="tel" {...register('phone')} />
          <Input label={t('Address')} {...register('address')} />
          <label>
            <input type="checkbox" {...register('opt_in_whatsapp')} />{' '}
            {t('Agreed to receive WhatsApp messages')}
          </label>
          {writable ? (
            <Button type="submit">{save.isPending ? t('Saving…') : t('Save')}</Button>
          ) : null}
        </fieldset>
      </form>
    </>
  );
}
