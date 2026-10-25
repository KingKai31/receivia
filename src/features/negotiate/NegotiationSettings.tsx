import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, useToast } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { getBusinessProfile } from '@/features/settings/businessProfileService';
import { errorMessage, updateGuarded } from '@/lib/service/errors';
import { supabase } from '@/lib/supabase';

interface NegProfile {
  id: string;
  updated_at: string;
  neg_enabled: boolean;
  neg_max_discount_pct: number;
  neg_max_instalments: number;
  neg_max_promise_days: number;
}

/** Owner limits for the buyer chat on the pay page. The database enforces them on every tool call. */
export function NegotiationSettings() {
  const { t } = useTranslation();
  const org = useOrg();
  const orgId = org.data?.orgId;
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = org.data?.role === 'owner';
  const q = useQuery({
    queryKey: ['business-profile', orgId],
    enabled: Boolean(orgId),
    queryFn: () => getBusinessProfile(orgId!),
  });
  const p = q.data as unknown as NegProfile | undefined;
  const [on, setOn] = useState(false);
  const [disc, setDisc] = useState('2');
  const [inst, setInst] = useState('3');
  const [days, setDays] = useState('30');
  useEffect(() => {
    if (!p) return;
    setOn(Boolean(p.neg_enabled));
    setDisc(String(p.neg_max_discount_pct ?? 2));
    setInst(String(p.neg_max_instalments ?? 3));
    setDays(String(p.neg_max_promise_days ?? 30));
  }, [p]);
  const d = Number(disc);
  const n = Number(inst);
  const m = Number(days);
  const valid =
    Number.isFinite(d) &&
    d >= 0 &&
    d <= 10 &&
    Number.isInteger(n) &&
    n >= 2 &&
    n <= 4 &&
    Number.isInteger(m) &&
    m >= 1 &&
    m <= 120;
  const save = useMutation({
    mutationFn: () =>
      updateGuarded(supabase, 'business_profile', p!.id, p!.updated_at, {
        neg_enabled: on,
        neg_max_discount_pct: d,
        neg_max_instalments: n,
        neg_max_promise_days: m,
      }),
    onSuccess: () => {
      toast.show(t('Saved.'));
      void qc.invalidateQueries({ queryKey: ['business-profile'] });
    },
    onError: (e) => toast.show(errorMessage(e)),
  });
  if (!p) return null;
  return (
    <Card>
      <h2>{t('Buyer chat (Talk to accounts)')}</h2>
      <p>
        {t(
          'An AI assistant on the pay page can offer instalments, an early-payment discount or a pay date, only within these limits. Every message and action is logged and shows in your Inbox.',
        )}
      </p>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={on}
          disabled={!canEdit}
          onChange={(e) => setOn(e.target.checked)}
        />
        {t('Turn on the buyer chat')}
      </label>
      <Input
        label={t('Highest early-payment discount (%)')}
        value={disc}
        disabled={!canEdit}
        error={Number.isFinite(d) && d >= 0 && d <= 10 ? undefined : t('Between 0 and 10')}
        onChange={(e) => setDisc(e.target.value)}
      />
      <Input
        label={t('Most instalments (2 to 4)')}
        value={inst}
        disabled={!canEdit}
        error={Number.isInteger(n) && n >= 2 && n <= 4 ? undefined : t('Between 2 and 4')}
        onChange={(e) => setInst(e.target.value)}
      />
      <Input
        label={t('Furthest promise date (days from today)')}
        value={days}
        disabled={!canEdit}
        error={Number.isInteger(m) && m >= 1 && m <= 120 ? undefined : t('Between 1 and 120')}
        onChange={(e) => setDays(e.target.value)}
      />
      {canEdit ? (
        <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          {t('Save')}
        </Button>
      ) : (
        <p>{t('Only the owner can change these.')}</p>
      )}
    </Card>
  );
}
