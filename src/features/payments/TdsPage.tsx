import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Button, Card, Loading, useToast } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { mailtoUrl, whatsappUrl } from '@/features/collect/templates';
import {
  certificateRequestText,
  match26as,
  parse26as,
  summarizeTds,
  type TdsSummaryLine,
} from '@/lib/match';
import { formatINR, paise } from '@/lib/money';
import { errorMessage } from '@/lib/service/errors';
import { getBusinessProfile } from '@/features/settings/businessProfileService';
import { loadTdsRows, markCertificate, markClaimed } from './tdsService';

function Line({
  l,
  orgId,
  contact,
  business,
  done,
}: {
  l: TdsSummaryLine;
  orgId: string;
  contact: { phone: string | null; email: string | null };
  business: string;
  done: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const open = l.deductedPaise - l.receivedPaise;
  const m = useMutation({
    mutationFn: async (what: 'request' | 'received') => {
      if (what === 'received') return markCertificate(orgId, l.openIds, 'received');
      const text = certificateRequestText({
        customer: l.customerName,
        quarter: l.quarter,
        amountPaise: open,
        business,
        contact: '',
      });
      await markCertificate(orgId, l.openIds, 'requested');
      const url = contact.phone
        ? whatsappUrl(contact.phone, text)
        : mailtoUrl(
            contact.email ?? '',
            t('TDS certificate {{quarter}}', { quarter: l.quarter }),
            text,
          );
      window.open(url, '_blank', 'noopener');
    },
    onSuccess: done,
    onError: (e) => toast.show(errorMessage(e)),
  });
  return (
    <Card>
      <h3>
        {t('{{customerName}} · {{quarter}}', { customerName: l.customerName, quarter: l.quarter })}
      </h3>
      <p>
        {t('Deducted {{formatINR}} · Certificate received', {
          formatINR: formatINR(paise(l.deductedPaise)),
        })}{' '}
        {t('{{formatINR}} · In 26AS {{formatINR2}}', {
          formatINR: formatINR(paise(l.receivedPaise)),
          formatINR2: formatINR(paise(l.claimedPaise)),
        })}
      </p>
      {open > 0 ? (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={m.isPending || (!contact.phone && !contact.email)}
            onClick={() => m.mutate('request')}
          >
            {t('Ask for the certificate')}
          </Button>
          <Button variant="secondary" disabled={m.isPending} onClick={() => m.mutate('received')}>
            {t('Mark received')}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

export function TdsPage() {
  const { t } = useTranslation();
  const org = useOrg();
  const orgId = org.data?.orgId;
  const qc = useQueryClient();
  const toast = useToast();
  const [report, setReport] = useState<string>('');
  const q = useQuery({
    queryKey: ['tds-rows', orgId],
    enabled: Boolean(orgId),
    queryFn: async () => ({
      rows: await loadTdsRows(orgId!),
      profile: await getBusinessProfile(orgId!),
    }),
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['tds-rows'] });
  const summary = q.data ? summarizeTds(q.data.rows.map((r) => r.row)) : [];
  const contactOf = (id: string) => q.data?.rows.find((r) => r.row.customerId === id) ?? null;

  return (
    <>
      <h1>{t('TDS certificates')}</h1>
      <p>
        <Link to="/payments">{t('Payments')}</Link>
      </p>
      <Card>
        <h2>{t('Check against Form 26AS or AIS')}</h2>
        <label htmlFor="f26">{t('Upload the CSV export')}</label>
        <input
          id="f26"
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f || !q.data) return;
            const p = parse26as(await f.text());
            if (p.errors.length && !p.rows.length) return void setReport(p.errors[0]!);
            const m = match26as(
              p.rows,
              q.data.rows.map((r) => r.row),
            );
            try {
              await markClaimed(
                orgId!,
                m.matched.map((x) => x.entryId),
              );
              setReport(
                t(
                  '{{length}} entries found in 26AS; {{length2}} line(s) in the file not matched to anything you recorded.',
                  {
                    length: m.matched.length,
                    length2: m.unmatched.length,
                  },
                ),
              );
              refresh();
            } catch (err) {
              toast.show(errorMessage(err));
            }
          }}
        />
        {report ? <p role="status">{report}</p> : null}
      </Card>
      {q.isLoading ? <Loading /> : null}
      {q.error ? <p role="alert">{errorMessage(q.error)}</p> : null}
      {q.data && summary.length === 0 ? (
        <p>{t('No TDS recorded yet. It appears here when you confirm a short payment as TDS.')}</p>
      ) : null}
      {q.data
        ? summary.map((l) => {
            const c = contactOf(l.customerId);
            return (
              <Line
                key={`${l.customerId}-${l.quarter}`}
                l={l}
                orgId={orgId!}
                contact={{ phone: c?.phone ?? null, email: c?.email ?? null }}
                business={q.data!.profile.trade_name || q.data!.profile.legal_name}
                done={refresh}
              />
            );
          })
        : null}
    </>
  );
}
