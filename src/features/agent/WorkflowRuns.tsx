import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Card, Timeline } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { errorMessage } from '@/lib/service/errors';
import { loadRecentRuns, type RunRow } from './agentService';

const seconds = (r: RunRow) =>
  r.finished_at ? Math.max(0, (Date.parse(r.finished_at) - Date.parse(r.started_at)) / 1000) : null;

/** Recent daily-agent, owner-brief and cron runs: trigger, steps, duration, result. */
export function WorkflowRuns() {
  const { t } = useTranslation();
  const org = useOrg();
  const orgId = org.data?.orgId;
  const q = useQuery({
    queryKey: ['agent-runs', orgId],
    enabled: Boolean(orgId),
    queryFn: () => loadRecentRuns(orgId!),
  });
  return (
    <Card title="Automation runs">
      {q.error ? <p role="alert">{errorMessage(q.error)}</p> : null}
      {q.data?.length === 0 ? <p>{t('No automation runs yet.')}</p> : null}
      {q.data && q.data.length > 0 ? (
        <Timeline
          label={t('Automation runs')}
          steps={q.data.map((r) => {
            const d = seconds(r);
            const steps = (r.steps ?? []).map((s) => `${s.step} ${s.ok ? '✓' : '✗'}`).join(' · ');
            return {
              key: r.id,
              title: `${r.trigger} · ${t(r.status)}`,
              detail: `${steps}${d !== null ? ` · ${d.toFixed(1)} s` : ''}`,
              time: new Date(r.started_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
            };
          })}
        />
      ) : null}
    </Card>
  );
}
