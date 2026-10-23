import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Button, Card, Input, Select, useToast } from '@/components/ui';
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
      toast.show('Business profile saved.');
      void qc.invalidateQueries({ queryKey: ['business-profile', orgId] });
    },
    onError: (e) => toast.show(errorMessage(e)),
  });

  const gstin = watch('gstin') ?? '';
  const g = gstin.trim() ? validateGstin(gstin) : null;
  const derivedState = g && g.valid ? GST_STATES[g.stateCode] : null;
  const editable = can.manageBusiness(role);

  if (profile.isLoading) return <p>Loading…</p>;
  if (profile.error) return <p role="alert">{errorMessage(profile.error)}</p>;
  if (!profile.data) return null;

  return (
    <Card>
      <h2>Business profile</h2>
      {!editable ? <p>Only the owner can change the business profile.</p> : null}
      <form onSubmit={handleSubmit((v) => save.mutateAsync(v))} noValidate>
        <fieldset disabled={!editable || isSubmitting} className="m-0 grid gap-3 border-0 p-0">
          <Input
            label="Legal name"
            error={errors.legal_name?.message}
            {...register('legal_name')}
          />
          <Input label="Trade name" {...register('trade_name')} />
          <Select
            label="Registration type"
            options={REG_OPTIONS}
            error={errors.registration_type?.message}
            {...register('registration_type')}
          />
          <Input
            label="GSTIN"
            maxLength={15}
            autoCapitalize="characters"
            error={
              errors.gstin?.message ??
              (g && !g.valid ? `GSTIN is not valid (${g.reason.toLowerCase()})` : undefined)
            }
            hint={derivedState ? `State: ${derivedState}` : undefined}
            {...register('gstin')}
          />
          {derivedState ? null : (
            <Select label="State" options={STATE_OPTIONS} {...register('state_code')} />
          )}
          <Input
            label="Annual turnover (₹)"
            inputMode="decimal"
            error={errors.annual_turnover?.message}
            {...register('annual_turnover')}
          />
          <Input
            label="Udyam registration number"
            error={errors.udyam_number?.message}
            {...register('udyam_number')}
          />
          <Select
            label="Enterprise size (Udyam)"
            options={SIZE_OPTIONS}
            {...register('enterprise_size')}
          />
          <Select label="Main activity" options={ACTIVITY_OPTIONS} {...register('activity')} />
          <Input label="Address" {...register('address')} />
          <Input label="Email" type="email" error={errors.email?.message} {...register('email')} />
          <Input label="Phone" type="tel" {...register('phone')} />
          <Input label="Bank name" {...register('bank_name')} />
          <Input label="Account holder" {...register('bank_account_holder')} />
          <Input label="Account number" {...register('bank_account_number')} />
          <Input label="IFSC" error={errors.bank_ifsc?.message} {...register('bank_ifsc')} />
          <Input label="UPI ID" error={errors.upi_id?.message} {...register('upi_id')} />
          <Input
            label="Invoice prefix"
            maxLength={4}
            hint="1 to 4 letters or digits. Numbers look like INV/26-27/0001."
            error={errors.invoice_prefix?.message}
            {...register('invoice_prefix')}
          />
          {editable ? <Button type="submit">{save.isPending ? 'Saving…' : 'Save'}</Button> : null}
        </fieldset>
      </form>
    </Card>
  );
}
