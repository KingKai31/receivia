import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, ResponsiveTable, Select, useToast } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { can } from '@/lib/permissions';
import { errorMessage } from '@/lib/service/errors';
import {
  addConsent,
  currentConsent,
  listConsents,
  type ConsentBasis,
  type ConsentChannel,
  type ConsentRecord,
} from './privacyService';

export const CHANNELS: { value: ConsentChannel; label: string }[] = [
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'sms', label: 'SMS' },
  { value: 'any', label: 'All channels' },
];
export const BASES: { value: ConsentBasis; label: string }[] = [
  { value: 'written', label: 'In writing' },
  { value: 'verbal', label: 'Said on a call or in person' },
  { value: 'pay_page', label: 'On the pay page' },
  { value: 'existing_relationship', label: 'Existing business relationship' },
  { value: 'other', label: 'Other' },
];

/** Who the customer agreed to be contacted by, and when they asked us to stop. */
export function ConsentCard({ customerId }: { customerId: string }) {
  const { t } = useTranslation();
  const org = useOrg();
  const qc = useQueryClient();
  const toast = useToast();
  const writable = can.writeData(org.data?.role ?? null);
  const [channel, setChannel] = useState<ConsentChannel>('email');
  const [status, setStatus] = useState<'granted' | 'withdrawn'>('granted');
  const [basis, setBasis] = useState<ConsentBasis>('written');
  const [note, setNote] = useState('');
  const q = useQuery({
    queryKey: ['consents', customerId],
    queryFn: () => listConsents(customerId),
  });
  const save = useMutation({
    mutationFn: () =>
      addConsent({ orgId: org.data!.orgId, customerId, channel, status, basis, note }),
    onSuccess: () => {
      toast.show(t('Consent recorded.'));
      setNote('');
      void qc.invalidateQueries({ queryKey: ['consents', customerId] });
      void qc.invalidateQueries({ queryKey: ['today'] });
    },
    onError: (e) => toast.show(errorMessage(e)),
  });
  const now = currentConsent(q.data ?? []);
  return (
    <Card title="Consent to be contacted">
      <p className="ui-hint">
        {t(
          'Receivia only sends reminders on a channel the customer has not withdrawn. Record what the customer told you; the newest record for a channel counts.',
        )}
      </p>
      <p>
        {CHANNELS.map((c) => (
          <span key={c.value} className="mr-3">
            {t(c.label)}
            {t(':')} <strong>{now[c.value] ? t(now[c.value]!) : t('not recorded')}</strong>
          </span>
        ))}
      </p>
      {writable ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Select
            label="Channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value as ConsentChannel)}
            options={CHANNELS}
          />
          <Select
            label="Decision"
            value={status}
            onChange={(e) => setStatus(e.target.value as 'granted' | 'withdrawn')}
            options={[
              { value: 'granted', label: 'granted' },
              { value: 'withdrawn', label: 'withdrawn' },
            ]}
          />
          <Select
            label="How it was given"
            value={basis}
            onChange={(e) => setBasis(e.target.value as ConsentBasis)}
            options={BASES}
          />
          <Input
            label="Note (optional)"
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button type="submit" disabled={save.isPending || !org.data}>
            {save.isPending ? t('Saving…') : t('Record consent')}
          </Button>
        </form>
      ) : null}
      <ResponsiveTable<ConsentRecord>
        caption="Consent history"
        rows={q.data ?? []}
        rowKey={(r) => r.id}
        emptyText="No consent recorded yet."
        columns={[
          { key: 'on', header: 'Date', render: (r) => r.recorded_on },
          {
            key: 'ch',
            header: 'Channel',
            render: (r) => t(CHANNELS.find((c) => c.value === r.channel)?.label ?? r.channel),
          },
          { key: 'st', header: 'Decision', render: (r) => t(r.status) },
          {
            key: 'ba',
            header: 'How it was given',
            render: (r) => t(BASES.find((b) => b.value === r.basis)?.label ?? r.basis),
          },
          { key: 'no', header: 'Note', render: (r) => r.note ?? '—' },
        ]}
      />
    </Card>
  );
}
