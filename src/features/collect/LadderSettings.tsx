import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, useToast } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { getBusinessProfile } from '@/features/settings/businessProfileService';
import { errorMessage } from '@/lib/service/errors';
import { ladderFromProfile, saveLadder } from './collectService';
import { STAGES, STAGE_LABEL, validateLadder, type LadderConfig } from './ladder';

export function LadderSettings() {
  const org = useOrg();
  const orgId = org.data?.orgId;
  const qc = useQueryClient();
  const toast = useToast();
  const profile = useQuery({
    queryKey: ['ladder-profile', orgId],
    enabled: Boolean(orgId),
    queryFn: () => getBusinessProfile(orgId!),
  });
  const [days, setDays] = useState<Record<string, string>>({});
  const [letterDays, setLetterDays] = useState('7');
  const p = profile.data as
    (typeof profile.data & { ladder_config?: unknown; demand_letter_days?: number }) | undefined;
  useEffect(() => {
    if (!p) return;
    const cfg = ladderFromProfile(p);
    setDays(Object.fromEntries(STAGES.map((s) => [s, String(cfg[s])])));
    setLetterDays(String(p.demand_letter_days ?? 7));
  }, [p]);

  const parsed = Object.fromEntries(STAGES.map((s) => [s, Number(days[s])])) as LadderConfig;
  const error = STAGES.every((s) => days[s] !== undefined) ? validateLadder(parsed) : null;
  const canEdit = org.data?.role === 'owner';

  const save = useMutation({
    mutationFn: () => saveLadder(p!, parsed, Number(letterDays)),
    onSuccess: () => {
      toast.show('Saved.');
      void qc.invalidateQueries({ queryKey: ['ladder-profile'] });
    },
    onError: (e) => toast.show(errorMessage(e)),
  });

  if (!p) return null;
  return (
    <Card>
      <h2>Collection reminders</h2>
      <p>Days from the due date when each step is due (negative = before the due date).</p>
      {STAGES.map((s) => (
        <Input
          key={s}
          label={STAGE_LABEL[s]}
          type="number"
          value={days[s] ?? ''}
          disabled={!canEdit}
          onChange={(e) => setDays({ ...days, [s]: e.target.value })}
        />
      ))}
      <Input
        label="Payment Demand Letter deadline (days)"
        type="number"
        value={letterDays}
        disabled={!canEdit}
        onChange={(e) => setLetterDays(e.target.value)}
      />
      {error ? <p role="alert">{error}</p> : null}
      {canEdit ? (
        <Button disabled={Boolean(error) || save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      ) : (
        <p>Only the owner can change these.</p>
      )}
    </Card>
  );
}
