import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, useToast } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { useOrg } from '@/features/auth/useOrg';
import { AgentPipeline } from './AgentPipeline';
import { STAGE_LABEL, type Stage } from '@/features/collect/ladder';
import { todayIST } from '@/lib/dates';
import { formatINR, paise } from '@/lib/money';
import { errorMessage } from '@/lib/service/errors';
import {
  approveAndSend,
  decide,
  loadActions,
  loadAgentSettings,
  loadLastRun,
  markWhatsappSent,
  retryAction,
  runAgentNow,
  type AgentAction,
} from './agentService';

const stageLabel = (s: string | null) =>
  s && s in STAGE_LABEL ? STAGE_LABEL[s as Stage] : (s ?? '');

function Row({
  a,
  orgId,
  userId,
  canWrite,
  onChanged,
}: {
  a: AgentAction;
  orgId: string;
  userId: string;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const m = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: onChanged,
    onError: (e) => toast.show(errorMessage(e)),
  });
  const amount = a.payload.amount_due_paise ? formatINR(paise(a.payload.amount_due_paise)) : '';
  return (
    <li className="row-in ui-row-card" style={{ marginBottom: 10 }}>
      <strong>{a.payload.customer ?? t('Customer')}</strong>{' '}
      {t('· {{invoice_no}} · {{amount}} ·', { invoice_no: a.payload.invoice_no, amount })}{' '}
      {t('{{stageLabel}} ·', { stageLabel: stageLabel(a.stage) })} <Badge>{a.status}</Badge>
      {a.channel ? t(' · {{channel}}', { channel: a.channel }) : ''}
      <br />
      <small>{a.reasoning}</small>
      {a.draft_note ? (
        <>
          <br />
          <small>
            {t('Wording:')} {a.draft_source === 'ai' ? 'written by the model' : 'standard template'}
            {t(';')} {a.draft_note}
          </small>
        </>
      ) : null}
      {a.body_template && a.status !== 'skipped' ? (
        <blockquote
          className="soft-in"
          style={{ margin: '8px 0 4px', paddingLeft: 10, borderLeft: '3px solid var(--blue-mist)' }}
        >
          <small style={{ whiteSpace: 'pre-line' }}>{a.body_template.slice(0, 280)}</small>
        </blockquote>
      ) : null}
      {a.draft_source ? (
        <small className="soft-in" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {a.draft_note?.startsWith('draft rejected') ? (
            t('Safety check stopped the model wording, so the standard template was used.')
          ) : (
            <>
              <svg className="tick" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  d="M5 12l5 5 9-10"
                  fill="none"
                  stroke="var(--ok)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              {t('Safety check passed')}
            </>
          )}
        </small>
      ) : null}
      {a.error ? (
        <p role="alert">
          {t('Failed:')} {a.error}
        </p>
      ) : null}
      {canWrite ? (
        <div className="flex flex-wrap gap-2">
          {a.status === 'proposed' && a.action_type === 'send_reminder' ? (
            <>
              <Button
                disabled={m.isPending}
                onClick={() => m.mutate(() => approveAndSend(orgId, a, userId))}
              >
                {t('Approve and send')}
              </Button>
              <Button
                variant="secondary"
                disabled={m.isPending}
                onClick={() => m.mutate(() => decide(a, 'rejected', userId))}
              >
                {t('Reject')}
              </Button>
            </>
          ) : null}
          {a.status === 'proposed' && a.action_type === 'owner_task' ? (
            <Button
              variant="secondary"
              disabled={m.isPending}
              onClick={() => m.mutate(() => decide(a, 'rejected', userId))}
            >
              {t('Done')}
            </Button>
          ) : null}
          {a.status === 'failed' ? (
            <Button
              disabled={m.isPending}
              onClick={() => m.mutate(() => retryAction(orgId, a, userId))}
            >
              {t('Retry')}
            </Button>
          ) : null}
          {a.status === 'approved' && a.channel === 'whatsapp' && a.wa_url ? (
            <>
              <a href={a.wa_url} target="_blank" rel="noreferrer">
                {t('Open WhatsApp')}
              </a>
              <Button
                disabled={m.isPending}
                onClick={() => m.mutate(() => markWhatsappSent(orgId, a, userId))}
              >
                {t('Mark sent')}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** The agent's plan for the day: proposals to approve, failures to retry, WhatsApp to tap. */
export function AgentPanel({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const org = useOrg();
  const { session } = useAuth();
  const orgId = org.data?.orgId;
  const userId = session?.user.id ?? '';
  const canWrite = org.data?.role === 'owner' || org.data?.role === 'accountant';
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({
    queryKey: ['agent-settings', orgId],
    enabled: Boolean(orgId),
    queryFn: () => loadAgentSettings(orgId!),
  });
  const runningRef = useRef(false);
  const day = settings.data?.demo_date ?? todayIST();
  const actions = useQuery({
    queryKey: ['agent-actions', orgId, day],
    enabled: Boolean(orgId) && Boolean(settings.data),
    queryFn: () => loadActions(orgId!, day),
    refetchInterval: () => (runningRef.current ? 2000 : false),
  });
  const last = useQuery({
    queryKey: ['agent-last-run', orgId],
    enabled: Boolean(orgId),
    queryFn: () => loadLastRun(orgId!),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['agent-actions'] });
    void qc.invalidateQueries({ queryKey: ['agent-last-run'] });
    void qc.invalidateQueries({ queryKey: ['collect-today'] });
  };
  const run = useMutation({
    mutationFn: () => runAgentNow(orgId!),
    onSuccess: () => {
      toast.show(t('Agent run finished.'));
      refresh();
    },
    onError: (e) => toast.show(errorMessage(e)),
  });
  runningRef.current = run.isPending;
  const all = actions.data ?? [];
  const failed = all.filter((a) => a.status === 'failed');
  const open = all.filter((a) => ['proposed', 'approved', 'failed'].includes(a.status));
  const sent = all.filter((a) => a.status === 'sent');
  const shown = compact
    ? all.filter((a) => a.status === 'proposed' || a.status === 'failed')
    : open;
  if (compact && shown.length === 0) return null;
  return (
    <Card>
      <h2>{compact ? t('Awaiting your approval') : t('Agent')}</h2>
      {!compact ? (
        <>
          <p>
            {t('Plan for {{day}}. Autonomy L', { day })}
            {settings.data?.autonomy_level ?? 0}
            {settings.data?.test_mode ? t(', test mode on (messages go to the owner)') : ''}
            {t('.')}
            {last.data
              ? t(' Last run: {{status}}, {{v}} ({{trigger}}).', {
                  status: last.data.status,
                  v: new Date(last.data.started_at).toLocaleString('en-IN'),
                  trigger: last.data.trigger,
                })
              : t(' The agent has not run yet.')}
          </p>
          <AgentPipeline running={run.isPending} actions={all} last={last.data ?? null} />
          {canWrite ? (
            <Button
              variant="secondary"
              disabled={run.isPending || !orgId}
              onClick={() => run.mutate()}
            >
              {run.isPending ? t('Running…') : t('Run agent now')}
            </Button>
          ) : null}
        </>
      ) : failed.length > 0 ? (
        <p role="alert">
          {failed.length} {t('message(s) failed to send.')}
        </p>
      ) : null}
      {actions.error ? <p role="alert">{errorMessage(actions.error)}</p> : null}
      {!compact && open.length === 0 ? (
        <p>{t('Nothing waiting. {{length}} sent today.', { length: sent.length })}</p>
      ) : null}
      <ul>
        {shown.map((a) => (
          <Row
            key={a.id}
            a={a}
            orgId={orgId!}
            userId={userId}
            canWrite={canWrite}
            onChanged={refresh}
          />
        ))}
      </ul>
    </Card>
  );
}
