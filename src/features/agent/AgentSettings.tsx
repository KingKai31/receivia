import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, Input, Select, useToast } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { errorMessage } from '@/lib/service/errors';
import { loadAgentSettings, saveAgentSettings, type AgentSettingsRow } from './agentService';
import { AUTONOMY_LABEL } from './planner';

export function AgentSettings() {
  const { t } = useTranslation();
  const org = useOrg();
  const orgId = org.data?.orgId;
  const canEdit = org.data?.role === 'owner';
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ['agent-settings', orgId],
    enabled: Boolean(orgId),
    queryFn: () => loadAgentSettings(orgId!),
  });
  const [f, setF] = useState<AgentSettingsRow | null>(null);
  useEffect(() => {
    if (q.data) setF(q.data);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => {
      const { id, updated_at, ...patch } = f!;
      void id;
      void updated_at;
      return saveAgentSettings(q.data!, {
        autonomy_level: patch.autonomy_level,
        channels: patch.channels,
        quiet_start_hour: patch.quiet_start_hour,
        quiet_end_hour: patch.quiet_end_hour,
        test_mode: patch.test_mode,
        demo_date: patch.demo_date || null,
        owner_email: patch.owner_email || null,
        owner_language: patch.owner_language,
      });
    },
    onSuccess: () => {
      toast.show('Saved.');
      void qc.invalidateQueries({ queryKey: ['agent-settings'] });
    },
    onError: (e) => toast.show(errorMessage(e)),
  });
  if (!f) return null;
  const set = <K extends keyof AgentSettingsRow>(k: K, v: AgentSettingsRow[K]) =>
    setF({ ...f, [k]: v });
  const toggle = (c: 'email' | 'whatsapp') =>
    set(
      'channels',
      f.channels.includes(c) ? f.channels.filter((x) => x !== c) : [...f.channels, c],
    );
  return (
    <Card>
      <h2>{t('Collections agent')}</h2>
      <p>
        {t(
          'The agent plans reminders every morning. Demand letters and key customers always need your approval.',
        )}
      </p>
      <Select
        label={t('Autonomy')}
        value={String(f.autonomy_level)}
        disabled={!canEdit}
        options={([0, 1, 2] as const).map((l) => ({ value: String(l), label: AUTONOMY_LABEL[l] }))}
        onChange={(e) => set('autonomy_level', Number(e.target.value) as 0 | 1 | 2)}
      />
      <fieldset disabled={!canEdit}>
        <legend>{t('Channels')}</legend>
        <label>
          <input
            type="checkbox"
            checked={f.channels.includes('email')}
            onChange={() => toggle('email')}
          />{' '}
          {t('Email')}
        </label>{' '}
        <label>
          <input
            type="checkbox"
            checked={f.channels.includes('whatsapp')}
            onChange={() => toggle('whatsapp')}
          />{' '}
          {t('WhatsApp (only customers who opted in)')}
        </label>
      </fieldset>
      <Input
        label={t('Quiet hours start (hour, IST)')}
        type="number"
        value={String(f.quiet_start_hour)}
        disabled={!canEdit}
        onChange={(e) => set('quiet_start_hour', Number(e.target.value))}
      />
      <Input
        label={t('Quiet hours end (hour, IST)')}
        type="number"
        value={String(f.quiet_end_hour)}
        disabled={!canEdit}
        onChange={(e) => set('quiet_end_hour', Number(e.target.value))}
      />
      <label>
        <input
          type="checkbox"
          checked={f.test_mode}
          disabled={!canEdit}
          onChange={(e) => set('test_mode', e.target.checked)}
        />{' '}
        {t("Test mode: send every message to the owner's email instead of customers")}
      </label>
      <Input
        label={t('Owner email for test mode and the daily brief')}
        type="email"
        value={f.owner_email ?? ''}
        disabled={!canEdit}
        onChange={(e) => set('owner_email', e.target.value)}
      />
      <Select
        label={t('Brief language')}
        value={f.owner_language}
        disabled={!canEdit}
        options={[
          { value: 'en', label: 'English' },
          { value: 'hi', label: 'Hindi' },
          { value: 'mr', label: 'Marathi' },
        ]}
        onChange={(e) => set('owner_language', e.target.value as 'en' | 'hi' | 'mr')}
      />
      <Input
        label={t('Demo date (pins today for the planner; leave empty for the real date)')}
        type="date"
        value={f.demo_date ?? ''}
        disabled={!canEdit}
        onChange={(e) => set('demo_date', e.target.value || null)}
      />
      {canEdit ? (
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          {t('Save')}
        </Button>
      ) : (
        <p>{t('Only the owner can change these.')}</p>
      )}
    </Card>
  );
}
