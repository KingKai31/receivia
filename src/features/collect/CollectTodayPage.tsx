import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button, Card, Input, Select, useToast } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { addDays, todayIST } from '@/lib/dates';
import { formatINR, paise } from '@/lib/money';
import { errorMessage } from '@/lib/service/errors';
import {
  approveStage,
  createPayLink,
  loadToday,
  promiseToPay,
  recordSend,
  snoozeCustomer,
  type SendChannel,
} from './collectService';
import { STAGE_LABEL } from './ladder';
import { PAY_LINK_PLACEHOLDER, prettyDate, type TodayGroup } from './today';
import { rankGroups, reasonByInvoice } from './rank';
import { canSend, mailtoUrl, smsUrl, whatsappUrl } from './templates';
import { useForecast } from '@/features/forecast/useForecast';

function GroupCard({
  group,
  orgId,
  onChanged,
  reasons,
}: {
  group: TodayGroup;
  orgId: string;
  onChanged: () => void;
  reasons: Map<string, string>;
}) {
  const toast = useToast();
  const c = group.customer;
  const p = group.primary;
  const [text, setText] = useState(group.message ?? '');
  const [channel, setChannel] = useState<SendChannel>('whatsapp');
  const [promiseDate, setPromiseDate] = useState('');
  const [snoozeDays, setSnoozeDays] = useState('3');

  const run = useMutation({
    mutationFn: async (fn: () => Promise<void>) => fn(),
    onSuccess: onChanged,
    onError: (e) => toast.show(errorMessage(e)),
  });

  const send = (ch: SendChannel, open: boolean) =>
    run.mutate(async () => {
      const check = canSend({
        now: new Date(),
        sentTodayToCustomer: group.alreadyMessagedToday ? 1 : 0,
      });
      if (!check.ok) throw new Error(check.reason);
      const link = await createPayLink(p.invoice.id);
      const body = text.split(PAY_LINK_PLACEHOLDER).join(link);
      await recordSend({ orgId, invoiceId: p.invoice.id, stage: p.stage, channel: ch, body });
      if (open) {
        const url =
          ch === 'whatsapp'
            ? whatsappUrl(c.phone ?? '', body)
            : ch === 'email'
              ? mailtoUrl(c.email ?? '', `Payment reminder: ${p.invoice.number}`, body)
              : smsUrl(c.phone ?? '', body);
        window.open(url, '_blank', 'noopener');
      }
      toast.show('Logged as sent.');
    });

  const missing =
    (channel === 'whatsapp' || channel === 'sms') && !c.phone
      ? 'No phone number for this customer.'
      : channel === 'email' && !c.email
        ? 'No email address for this customer.'
        : null;

  return (
    <Card>
      <h2>
        <Link to={`/customers/${c.id}`}>{c.name}</Link>
        {c.tier === 'key' ? ' (key customer)' : ''}
      </h2>
      <ul>
        {group.items.map((it) => (
          <li key={it.invoice.id}>
            <Link to={`/invoices/${it.invoice.id}`}>{it.invoice.number}</Link> · due{' '}
            {prettyDate(it.invoice.due_date)} · {formatINR(paise(it.decision.amountDue))} ·{' '}
            {STAGE_LABEL[it.stage]}
            {it.invoice === p.invoice
              ? ''
              : ' (waits for a later day: one message per customer per day)'}
            {it.needsApproval ? ' · needs your approval' : ''}
            {reasons.get(it.invoice.id) ? <div>Priority: {reasons.get(it.invoice.id)}</div> : null}
          </li>
        ))}
      </ul>

      {p.needsApproval ? (
        <p>
          {p.decision.reason}{' '}
          <Button
            disabled={run.isPending}
            onClick={() =>
              run.mutate(async () => {
                await approveStage(p.invoice, p.stage);
              })
            }
          >
            Approve this stage
          </Button>
        </p>
      ) : null}

      {group.guide ? (
        <>
          <h3>Next steps</h3>
          <ul>
            {group.guide.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
          <p>
            <Link to={`/doc/case/${c.id}`}>Open case pack</Link>
          </p>
        </>
      ) : null}

      {group.callPrompt ? (
        <p>
          <strong>Call:</strong> {group.callPrompt}
        </p>
      ) : null}

      {group.message ? (
        <>
          <label htmlFor={`msg-${c.id}`}>Message ({c.language})</label>
          <textarea
            id={`msg-${c.id}`}
            className="ui-input"
            rows={7}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {group.lensLine ? (
            <p>Compliance line included where it applies: {group.lensLine}</p>
          ) : null}
          {p.stage === 'demand_letter' ? (
            <p>
              <Link to={`/doc/letter/${p.invoice.id}`}>Open Payment Demand Letter</Link>
            </p>
          ) : null}
          {group.alreadyMessagedToday ? (
            <p role="status">This customer already has a message today.</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button disabled={run.isPending || !c.phone} onClick={() => send('whatsapp', true)}>
              WhatsApp
            </Button>
            <Button disabled={run.isPending || !c.email} onClick={() => send('email', true)}>
              Email
            </Button>
            <Button disabled={run.isPending || !c.phone} onClick={() => send('sms', true)}>
              SMS
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Select
              label="Sent by"
              value={channel}
              onChange={(e) => setChannel(e.target.value as SendChannel)}
              options={[
                { value: 'whatsapp', label: 'WhatsApp' },
                { value: 'email', label: 'Email' },
                { value: 'sms', label: 'SMS' },
              ]}
            />
            <Button
              variant="secondary"
              disabled={run.isPending}
              onClick={() => send(channel, false)}
            >
              Mark as sent
            </Button>
          </div>
          {missing ? <p>{missing}</p> : null}
        </>
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <Select
          label="Snooze for"
          value={snoozeDays}
          onChange={(e) => setSnoozeDays(e.target.value)}
          options={[
            { value: '1', label: '1 day' },
            { value: '3', label: '3 days' },
            { value: '7', label: '7 days' },
          ]}
        />
        <Button
          variant="secondary"
          disabled={run.isPending}
          onClick={() =>
            run.mutate(async () => {
              await snoozeCustomer(c, addDays(todayIST(), Number(snoozeDays)));
            })
          }
        >
          Snooze
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Input
          label="Promised date"
          type="date"
          value={promiseDate}
          onChange={(e) => setPromiseDate(e.target.value)}
        />
        <Button
          variant="secondary"
          disabled={run.isPending || !promiseDate}
          onClick={() =>
            run.mutate(async () => {
              await promiseToPay({
                orgId,
                invoiceId: p.invoice.id,
                customerId: c.id,
                date: promiseDate,
              });
            })
          }
        >
          Promise to pay
        </Button>
      </div>
    </Card>
  );
}

export function CollectTodayPage() {
  const org = useOrg();
  const orgId = org.data?.orgId;
  const qc = useQueryClient();
  const today = todayIST();
  const fc = useForecast();
  const chase = fc.computed?.chase ?? [];
  const reasons = reasonByInvoice(chase);
  const q = useQuery({
    queryKey: ['collect-today', orgId, today],
    enabled: Boolean(orgId),
    queryFn: () => loadToday(orgId!, today),
  });
  return (
    <>
      <h1>Collect: today</h1>
      <p>
        Actions due on {prettyDate(today)}. Messages go out 09:00–21:00 IST, one per customer per
        day.
      </p>
      {q.isLoading || org.isLoading ? <p>Loading…</p> : null}
      {q.error ? <p role="alert">{errorMessage(q.error)}</p> : null}
      {q.data?.truncated ? <p role="status">Showing the first 1000 live invoices only.</p> : null}
      {q.data && q.data.groups.length === 0 ? <p>Nothing to send today.</p> : null}
      {(q.data ? rankGroups(q.data.groups, chase) : []).map((g) => (
        <GroupCard
          key={`${g.customer.id}-${g.primary.invoice.id}-${g.primary.stage}`}
          group={g}
          orgId={orgId!}
          reasons={reasons}
          onChanged={() => void qc.invalidateQueries({ queryKey: ['collect-today'] })}
        />
      ))}
    </>
  );
}
