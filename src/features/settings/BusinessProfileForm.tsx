import { tr } from '@/app/i18n';
import { useTranslation } from 'react-i18next';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button, Card, Input, Loading, Select, useToast } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { validateGstin } from '@/lib/gstin';
import { GST_STATES } from '@/lib/gst';
import { can } from '@/lib/permissions';
import { errorMessage } from '@/lib/service/errors';
import {
  businessProfileSchema,
  getBusinessProfile,
  profileToForm,
  saveBusinessProfile,
  type BusinessProfileForm as FormValues,
} from './businessProfileService';

const STATE_OPTIONS = [
  { value: '', label: 'Not set' },
  ...Object.entries(GST_STATES).map(([code, name]) => ({ value: code, label: `${code} ${name}` })),
];
const REG_OPTIONS = [
  { value: 'regular', label: 'Regular (Tax Invoice)' },
  { value: 'composition', label: 'Composition (Bill of Supply)' },
  { value: 'unregistered', label: 'Unregistered (Invoice)' },
];
const SIZE_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'micro', label: 'Micro' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
];
const ACTIVITY_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'services', label: 'Services' },
  { value: 'trading', label: 'Trading' },
];

export function BusinessProfileForm() {
  const { t } = useTranslation();
  const org = useOrg();
  const orgId = org.data?.orgId;
  const role = org.data?.role ?? null;
  const qc = useQueryClient();
  const toast = useToast();
  const profile = useQuery({
    queryKey: ['business-profile', orgId],
    enabled: Boolean(orgId),
    queryFn: () => getBusinessProfile(orgId!),
  });
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(businessProfileSchema), mode: 'onChange' });

  useEffect(() => {
    if (profile.data) reset(profileToForm(profile.data));
  }, [profile.data, reset]);

  const save = useMutation({
    mutationFn: (values: FormValues) => saveBusinessProfile(profile.data!, values),
    onSuccess: () => {
      toast.show(t('Business profile saved.'));
      void qc.invalidateQueries({ queryKey: ['business-profile', orgId] });
    },
    onError: (e) => toast.show(errorMessage(e)),
  });

  const gstin = watch('gstin') ?? '';
  const g = gstin.trim() ? validateGstin(gstin) : null;
  const derivedState = g && g.valid ? GST_STATES[g.stateCode] : null;
  const editable = can.manageBusiness(role);

  if (profile.isLoading) return <Loading />;
  if (profile.error) return <p role="alert">{errorMessage(profile.error)}</p>;
  if (!profile.data) return null;

  return (
    <Card>
      <h2>{t('Business profile')}</h2>
      {!editable ? <p>{t('Only the owner can change the business profile.')}</p> : null}
      <form onSubmit={handleSubmit((v) => save.mutateAsync(v))} noValidate>
        <fieldset disabled={!editable || isSubmitting} className="m-0 grid gap-3 border-0 p-0">
          <Input
            label={t('Legal name')}
            error={errors.legal_name?.message}
            {...register('legal_name')}
          />
          <Input label={t('Trade name')} {...register('trade_name')} />
          <Select
            label={t('Registration type')}
            options={REG_OPTIONS}
            error={errors.registration_type?.message}
            {...register('registration_type')}
          />
          <Input
            label={t('GSTIN')}
            maxLength={15}
            autoCapitalize="characters"
            error={
              errors.gstin?.message ??
              (g && !g.valid
                ? t('GSTIN is not valid ({{v}})', { v: g.reason.toLowerCase() })
                : undefined)
            }
            hint={
              derivedState
                ? t('State: {{derivedState}}', { derivedState: tr(derivedState) })
                : undefined
            }
            {...register('gstin')}
          />
          {derivedState ? null : (
            <Select label={t('State')} options={STATE_OPTIONS} {...register('state_code')} />
          )}
          <Input
            label={t('Annual turnover (₹)')}
            inputMode="decimal"
            error={errors.annual_turnover?.message}
            {...register('annual_turnover')}
          />
          <Input
            label={t('Udyam registration number')}
            error={errors.udyam_number?.message}
            {...register('udyam_number')}
          />
          <Select
            label={t('Enterprise size (Udyam)')}
            options={SIZE_OPTIONS}
            {...register('enterprise_size')}
          />
          <Select label={t('Main activity')} options={ACTIVITY_OPTIONS} {...register('activity')} />
          <Input label={t('Address')} {...register('address')} />
          <Input
            label={t('Email')}
            type="email"
            error={errors.email?.message}
            {...register('email')}
          />
          <Input label={t('Phone')} type="tel" {...register('phone')} />
          <Input label={t('Bank name')} {...register('bank_name')} />
          <Input label={t('Account holder')} {...register('bank_account_holder')} />
          <Input label={t('Account number')} {...register('bank_account_number')} />
          <Input label={t('IFSC')} error={errors.bank_ifsc?.message} {...register('bank_ifsc')} />
          <Input label={t('UPI ID')} error={errors.upi_id?.message} {...register('upi_id')} />
          <Input
            label={t('Invoice prefix')}
            maxLength={4}
            hint={t('1 to 4 letters or digits. Numbers look like INV/26-27/0001.')}
            error={errors.invoice_prefix?.message}
            {...register('invoice_prefix')}
          />
          {editable ? (
            <Button type="submit">{save.isPending ? t('Saving…') : t('Save')}</Button>
          ) : null}
        </fieldset>
      </form>
    </Card>
  );
}
