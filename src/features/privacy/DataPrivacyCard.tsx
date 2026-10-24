import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button, Card, Input, useToast } from '@/components/ui';
import { signOut } from '@/features/auth/authApi';
import { useOrg } from '@/features/auth/useOrg';
import { errorMessage } from '@/lib/service/errors';
import {
  DEMO_ORG_ID,
  EXPORT_TABLES,
  deleteOrg,
  download,
  exportOrgData,
  toCsv,
  type OrgExport,
} from './privacyService';

const CSV_TABLES = ['customers', 'invoices', 'payments', 'expenses', 'customer_consents'] as const;

/** Export my data, retention and hosting notes, and deleting the organisation. */
export function DataPrivacyCard() {
  const { t } = useTranslation();
  const org = useOrg();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState('');
  const isOwner = org.data?.role === 'owner';
  const isDemo = org.data?.orgId === DEMO_ORG_ID;
  const name = org.data?.orgName ?? '';

  async function run(kind: 'json' | 'csv') {
    if (!org.data) return;
    setBusy(true);
    try {
      const data: OrgExport = await exportOrgData(org.data.orgId);
      const day = data.exported_at.slice(0, 10);
      if (kind === 'json') {
        download(`receivia-export-${day}.json`, 'application/json', JSON.stringify(data, null, 2));
      } else {
        for (const tbl of CSV_TABLES) {
          download(`receivia-${tbl}-${day}.csv`, 'text/csv', toCsv(data.tables[tbl] ?? []));
        }
      }
      toast.show(t('Export ready: {{n}} tables.', { n: Object.keys(data.tables).length }));
    } catch (e) {
      toast.show(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function erase() {
    if (!org.data) return;
    setBusy(true);
    try {
      await deleteOrg(org.data.orgId, typed);
      toast.show(t('The organisation and its data were deleted.'));
      await signOut();
    } catch (e) {
      toast.show(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <Card title="Your data and privacy">
      <p>
        <Link to="/privacy">{t('Read the privacy notice')}</Link>
      </p>
      <p className="ui-hint">
        {t(
          'Your data is stored in the ap-northeast-1 region (Tokyo, Japan). Invoices and payment records are kept until you delete the organisation, because accounting and tax rules generally expect businesses to keep them for several years; check the period with your CA.',
        )}
      </p>
      <h3>{t('Export my data')}</h3>
      <p className="ui-hint">
        {t(
          'JSON has every table ({{n}}). CSV downloads customers, invoices, payments, expenses and consent records.',
          { n: EXPORT_TABLES.length },
        )}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" disabled={busy || !org.data} onClick={() => void run('json')}>
          {t('Download JSON')}
        </Button>
        <Button variant="secondary" disabled={busy || !org.data} onClick={() => void run('csv')}>
          {t('Download CSV files')}
        </Button>
      </div>
      <h3>{t('Delete this organisation')}</h3>
      {isDemo ? (
        <>
          <p className="ui-hint">{t('The shared demo organisation cannot be deleted.')}</p>
          <Button disabled>{t('Delete everything')}</Button>
        </>
      ) : !isOwner ? (
        <p className="ui-hint">{t('Only the owner can delete the organisation.')}</p>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void erase();
          }}
        >
          <p className="ui-hint">
            {t(
              'This permanently deletes the business, its customers, invoices, payments and settings. It cannot be undone. Download your data first. Type the business name exactly to confirm: {{name}}',
              { name },
            )}
          </p>
          <Input
            label="Business name"
            value={typed}
            autoComplete="off"
            onChange={(e) => setTyped(e.target.value)}
          />
          <Button type="submit" disabled={busy || typed !== name || !name}>
            {t('Delete everything')}
          </Button>
        </form>
      )}
    </Card>
  );
}
