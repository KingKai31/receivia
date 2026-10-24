import { tr } from '@/app/i18n';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, Select, useToast } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import {
  guessMapping,
  parseBankCsv,
  parseCsv,
  type BankLine,
  type ColumnMapping,
} from '@/lib/match';
import { formatINR, paise } from '@/lib/money';
import { errorMessage } from '@/lib/service/errors';
import {
  confirmSuggestion,
  ignoreTxn,
  importBankLines,
  listPayments,
  loadSuggestions,
  type BankSuggestion,
} from './bankService';

const STEP = 25;
const KIND_LABEL: Record<string, string> = {
  exact: 'Exact match',
  multi: 'One payment, several invoices',
  part: 'Part payment',
  tds_short: 'Short by TDS',
  overpayment: 'Overpayment',
  unknown: 'Unknown deposit',
};

function SuggestionCard({
  s,
  orgId,
  done,
}: {
  s: BankSuggestion;
  orgId: string;
  done: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const m = useMutation({
    mutationFn: (what: 'confirm' | 'ignore') =>
      what === 'confirm' ? confirmSuggestion(orgId, s) : ignoreTxn(orgId, s.txnId),
    onSuccess: done,
    onError: (e) => toast.show(errorMessage(e)),
  });
  const canConfirm = s.allocations.length > 0 && s.customerId !== null;
  return (
    <Card>
      <p>
        <strong>{s.line.date}</strong>{' '}
        {t('· {{formatINR}} · {{description}}', {
          formatINR: formatINR(s.line.creditPaise),
          description: s.line.description,
        })}
        {s.line.reference ? ` (${s.line.reference})` : ''}
      </p>
      <p>
        <Badge>{KIND_LABEL[s.kind] ?? s.kind}</Badge>{' '}
        {t('Confidence {{v}}%', { v: Math.round(s.confidence * 100) })}
      </p>
      <p>{s.reason}</p>
      {s.allocations.length ? (
        <ul>
          {s.allocations.map((a) => (
            <li key={a.invoiceId}>
              {t('{{invoiceNumber}}: {{formatINR}}', {
                invoiceNumber: a.invoiceNumber,
                formatINR: formatINR(a.amountPaise),
              })}
            </li>
          ))}
          {s.tds ? (
            <li>
              {t('TDS {{v}} ({{ratePct}}%):', {
                v: s.tds.section.replace('_', ' '),
                ratePct: s.tds.ratePct,
              })}{' '}
              {formatINR(s.tds.amountPaise)}
            </li>
          ) : null}
          {s.creditBalancePaise > 0 ? (
            <li>
              {t('Credit balance:')} {formatINR(s.creditBalancePaise)}
            </li>
          ) : null}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!canConfirm || m.isPending} onClick={() => m.mutate('confirm')}>
          {t('Confirm')}
        </Button>
        <Button variant="secondary" disabled={m.isPending} onClick={() => m.mutate('ignore')}>
          {t('Ignore this line')}
        </Button>
      </div>
    </Card>
  );
}

const FIELDS: { key: keyof ColumnMapping; label: string; optional?: boolean }[] = [
  { key: 'date', label: 'Date column' },
  { key: 'description', label: 'Description column' },
  { key: 'credit', label: 'Credit (money in) column' },
  { key: 'debit', label: 'Debit (money out) column' },
  { key: 'reference', label: 'Reference column', optional: true },
];

function ImportCard({ orgId, done }: { orgId: string; done: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [text, setText] = useState('');
  const [mapping, setMapping] = useState<Partial<ColumnMapping>>({});
  const headers = text ? (parseCsv(text)[0] ?? []) : [];
  const complete = FIELDS.every((f) => f.optional || mapping[f.key]);
  const parsed: { lines: BankLine[]; errors: { row: number; message: string }[] } | null =
    text && complete ? parseBankCsv(text, { reference: '', ...mapping } as ColumnMapping) : null;
  const run = useMutation({
    mutationFn: () => importBankLines(orgId, parsed!.lines),
    onSuccess: (r) => {
      toast.show(
        t('Imported {{added}} new line(s), skipped {{skipped}} already imported.', {
          added: r.added,
          skipped: r.skipped,
        }),
      );
      setText('');
      done();
    },
    onError: (e) => toast.show(errorMessage(e)),
  });
  return (
    <Card>
      <h2>{t('Import a bank statement')}</h2>
      <label htmlFor="bank-file">{t('Statement (.csv)')}</label>
      <input
        id="bank-file"
        type="file"
        accept=".csv,text/csv"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const t = await f.text();
          setText(t);
          setMapping(guessMapping(parseCsv(t)[0] ?? []));
        }}
      />
      {headers.length ? (
        <>
          {FIELDS.map((f) => (
            <Select
              key={f.key}
              label={f.label}
              value={mapping[f.key] ?? ''}
              onChange={(e) => setMapping({ ...mapping, [f.key]: e.target.value })}
              options={[
                { value: '', label: f.optional ? t('None') : t('Choose…') },
                ...headers.map((h) => ({ value: h, label: h })),
              ]}
            />
          ))}
          {parsed ? (
            <>
              <p>
                {t('{{length}} readable line(s)', { length: parsed.lines.length })}
                {parsed.errors.length
                  ? t(', {{length}} skipped', { length: parsed.errors.length })
                  : ''}
                {t('.')}
              </p>
              {parsed.errors.slice(0, 5).map((er) => (
                <p key={er.row} role="alert">
                  {t('Row {{row}}: {{message}}', { row: er.row, message: er.message })}
                </p>
              ))}
              <Button disabled={!parsed.lines.length || run.isPending} onClick={() => run.mutate()}>
                {t('Import {{length}} lines', { length: parsed.lines.length })}
              </Button>
            </>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

export function PaymentsPage() {
  const { t } = useTranslation();
  const org = useOrg();
  const orgId = org.data?.orgId;
  const qc = useQueryClient();
  const [limit, setLimit] = useState(STEP);
  const sugg = useQuery({
    queryKey: ['bank-suggestions', orgId, limit],
    enabled: Boolean(orgId),
    queryFn: () => loadSuggestions(orgId!, limit),
  });
  const pays = useQuery({
    queryKey: ['payments-list', orgId],
    enabled: Boolean(orgId),
    queryFn: () => listPayments(orgId!, 25),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['bank-suggestions'] });
    void qc.invalidateQueries({ queryKey: ['payments-list'] });
    void qc.invalidateQueries({ queryKey: ['collect-today'] });
  };
  return (
    <>
      <h1>{t('Payments')}</h1>
      <p>
        <Link to="/payments/tds">{t('TDS certificates')}</Link>
      </p>
      {orgId ? <ImportCard orgId={orgId} done={refresh} /> : null}
      <h2>{t('Deposits to match')}</h2>
      <p>{t('Nothing is marked paid until you confirm.')}</p>
      {sugg.isLoading ? <p>{t('Loading…')}</p> : null}
      {sugg.error ? <p role="alert">{errorMessage(sugg.error)}</p> : null}
      {sugg.data?.length === 0 ? <p>{t('No unmatched deposits.')}</p> : null}
      {sugg.data?.map((s) => (
        <SuggestionCard key={s.txnId} s={s} orgId={orgId!} done={refresh} />
      ))}
      {sugg.data && sugg.data.length >= limit ? (
        <Button variant="secondary" onClick={() => setLimit(limit + STEP)}>
          {t('Show more')}
        </Button>
      ) : null}
      <h2>{t('Recent payments')}</h2>
      {pays.data?.length === 0 ? <p>{t('No payments yet.')}</p> : null}
      <ul>
        {pays.data?.map((p) => (
          <li key={p.id}>
            {t('{{received_on}} · {{formatINR}} ·', {
              received_on: p.received_on,
              formatINR: formatINR(paise(p.amount_paise)),
            })}{' '}
            {p.customers?.name ?? '—'} {t('·')}{' '}
            {t('{{method}} ({{source}})', { method: tr(p.method), source: tr(p.source) })}
            {p.reference ? t(' · {{reference}}', { reference: p.reference }) : ''}
          </li>
        ))}
      </ul>
    </>
  );
}
