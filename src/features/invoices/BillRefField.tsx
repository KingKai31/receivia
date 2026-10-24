import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, useToast } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { errorMessage } from '@/lib/service/errors';

/** Bill-tracking reference for government / PSU buyers; goes into their reminders. */
export function BillRefField({
  invoiceId,
  value,
  writable,
}: {
  invoiceId: string;
  value: string | null;
  writable: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState(value ?? '');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const { error } = await supabase
      .from('invoices')
      .update({ bill_ref: v.trim() || null })
      .eq('id', invoiceId);
    setBusy(false);
    if (error) toast.show(errorMessage(error));
    else {
      toast.show(t('Saved.'));
      void qc.invalidateQueries({ queryKey: ['invoice', invoiceId] });
    }
  }
  return (
    <section aria-label={t('Bill-tracking reference')}>
      <Input
        label={t('Bill-tracking reference')}
        value={v}
        maxLength={60}
        disabled={!writable}
        onChange={(e) => setV(e.target.value)}
      />
      {writable ? (
        <Button onClick={() => void save()} disabled={busy || v.trim() === (value ?? '')}>
          {t('Save')}
        </Button>
      ) : null}
    </section>
  );
}
