import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Button, Card, ResponsiveTable, Select, useToast } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { getBusinessProfile } from '@/features/settings/businessProfileService';
import { invoiceTypeFor } from '@/lib/gst';
import { can } from '@/lib/permissions';
import { errorMessage } from '@/lib/service/errors';
import {
  CUSTOMER_FIELDS,
  INVOICE_FIELDS,
  applyMapping,
  guessMapping,
  missingRequired,
  readSheet,
  summarise,
  validateCustomerRows,
  validateInvoiceRows,
  type FieldDef,
  type Mapping,
  type RowReport,
  type Sheet,
} from './importCore';
import {
  commitCustomers,
  commitInvoices,
  loadExistingCustomers,
  loadExistingInvoiceNumbers,
} from './importService';
import { parseTallyXml, type TallyResult } from './tally';

type Kind = 'customers' | 'invoices';
type Rows = { row: number; values: Record<string, string> }[];

export function ImportPage() {
  const { t } = useTranslation();
  const org = useOrg();
  const orgId = org.data?.orgId;
  const toast = useToast();
  const [kind, setKind] = useState<Kind>('invoices');
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [tally, setTally] = useState<TallyResult | null>(null);
  const [report, setReport] = useState<RowReport[] | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const profile = useQuery({
    queryKey: ['business-profile', orgId],
    enabled: Boolean(orgId),
    queryFn: () => getBusinessProfile(orgId!),
  });

  const fields: FieldDef[] = kind === 'customers' ? CUSTOMER_FIELDS : INVOICE_FIELDS;
  const writable = can.writeData(org.data?.role ?? null);

  const reset = () => {
    setSheet(null);
    setTally(null);
    setReport(null);
    setResult(null);
    setError(null);
  };

  const rows: Rows = useMemo(() => {
    if (tally) return kind === 'customers' ? tally.customers : tally.invoices;
    if (sheet) return applyMapping(sheet, mapping, fields);
    return [];
  }, [tally, sheet, mapping, fields, kind]);

  async function onFile(file: File) {
    reset();
    try {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.xml')) {
        setTally(parseTallyXml(await file.text()));
      } else {
        const csv = lower.endsWith('.csv');
        const s = readSheet(csv ? await file.text() : await file.arrayBuffer(), csv);
        setSheet(s);
        setMapping(guessMapping(s.headers, fields));
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function validate() {
    setBusy(true);
    setError(null);
    try {
      const existing = await loadExistingCustomers(orgId!);
      if (kind === 'customers') {
        const v = validateCustomerRows(rows, existing);
        setReport(v.report.sort((a, b) => a.row - b.row));
      } else {
        const p = profile.data;
        if (!p?.state_code) throw new Error('Set your business GSTIN or state in Settings first.');
        const numbers = rows.map((r) => r.values.number?.trim() ?? '').filter(Boolean);
        const existingNumbers = await loadExistingInvoiceNumbers(orgId!, numbers);
        const customerStates = new Map([...existing.byName].map(([k, v]) => [k, v.state_code]));
        const v = validateInvoiceRows(rows, {
          supplierStateCode: p.state_code,
          existingNumbers,
          customerStates,
        });
        setReport(v.report.sort((a, b) => a.row - b.row));
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    setBusy(true);
    setError(null);
    try {
      const existing = await loadExistingCustomers(orgId!);
      if (kind === 'customers') {
        const v = validateCustomerRows(rows, existing);
        const r = await commitCustomers(orgId!, v.valid);
        setReport([...v.report.filter((x) => x.status !== 'ok'), ...r.failed]);
        setResult(t('{{imported}} customers imported.', { imported: r.imported }));
      } else {
        const p = profile.data!;
        const numbers = rows.map((r) => r.values.number?.trim() ?? '').filter(Boolean);
        const existingNumbers = await loadExistingInvoiceNumbers(orgId!, numbers);
        const customerStates = new Map([...existing.byName].map(([k, v]) => [k, v.state_code]));
        const v = validateInvoiceRows(rows, {
          supplierStateCode: p.state_code!,
          existingNumbers,
          customerStates,
        });
        const r = await commitInvoices(
          orgId!,
          p.state_code!,
          invoiceTypeFor(p.registration_type),
          v.valid,
        );
        setReport([...v.report.filter((x) => x.status !== 'ok'), ...r.failed]);
        setResult(
          t('{{imported}} invoices imported, {{customersCreated}} new customers created.', {
            imported: r.imported,
            customersCreated: r.customersCreated,
          }),
        );
      }
      toast.show(t('Import finished.'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const sum = report ? summarise(report) : null;
  const skippedTags = tally ? Object.entries(tally.skippedTags) : [];
  const missing = sheet ? missingRequired(mapping, fields) : [];

  if (!writable) return <p>{t('You have read-only access, so you cannot import.')}</p>;

  return (
    <>
      <h1>{t('Import')}</h1>
      <Card>
        <div className="grid gap-3">
          <Select
            label={t('What are you importing?')}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as Kind);
              reset();
            }}
            options={[
              { value: 'invoices', label: t('Invoices (CSV, Excel or Tally sales vouchers)') },
              { value: 'customers', label: t('Customers (CSV, Excel or Tally ledgers)') },
            ]}
          />
          <label>
            {t('File (.csv, .xlsx, .xls or Tally .xml)')}
            <br />
            <input
              type="file"
              accept=".csv,.xlsx,.xls,.xml"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
          </label>
        </div>
      </Card>
      {error ? <p role="alert">{error}</p> : null}

      {tally ? (
        <Card>
          <h2>{t('Tally file read')}</h2>
          <p>
            {kind === 'invoices' ? tally.invoices.length : tally.customers.length}{' '}
            {t('record(s) found.')}
          </p>
          {skippedTags.length ? (
            <>
              <p>{t('Skipped tags that this import does not use:')}</p>
              <ul>
                {skippedTags.map(([tag, n]) => (
                  <li key={tag}>{t('{{tag}} ({{n}})', { tag, n })}</li>
                ))}
              </ul>
            </>
          ) : null}
          {tally.notes.length ? (
            <ul>
              {tally.notes.slice(0, 50).map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {sheet ? (
        <Card>
          <h2>{t('Match your columns')}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {fields.map((f) => (
              <Select
                key={f.key}
                label={`${f.label}${f.required ? ' (required)' : ''}`}
                value={String(mapping[f.key] ?? -1)}
                onChange={(e) => {
                  setMapping({ ...mapping, [f.key]: Number(e.target.value) });
                  setReport(null);
                }}
                options={[
                  { value: '-1', label: t('Not in my file') },
                  ...sheet.headers.map((h, i) => ({
                    value: String(i),
                    label: h || t('Column {{v}}', { v: i + 1 }),
                  })),
                ]}
              />
            ))}
          </div>
          {missing.length ? (
            <p role="alert">{t('Map these required fields: {{v}}.', { v: missing.join(', ') })}</p>
          ) : null}
          <p>
            {sheet.rows.length} {t('data row(s) in the file.')}
          </p>
        </Card>
      ) : null}

      {(sheet || tally) && rows.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            disabled={busy || missing.length > 0}
            onClick={() => void validate()}
          >
            {t('Check rows')}
          </Button>
          <Button
            disabled={busy || missing.length > 0 || !report || sum?.ok === 0 || result !== null}
            onClick={() => void runImport()}
          >
            {t('Import')} {sum ? t('{{ok}} valid row(s)', { ok: sum.ok }) : ''}
          </Button>
        </div>
      ) : null}

      {result ? <p role="status">{result}</p> : null}
      {report && sum ? (
        <>
          <h2>{t('Row report')}</h2>
          <p>
            {t('{{ok}} ready, {{skipped}} already exist, {{errors}} with problems.', {
              ok: sum.ok,
              skipped: sum.skipped,
              errors: sum.errors,
            })}
          </p>
          <ResponsiveTable<RowReport>
            caption={t('Import row report')}
            rows={report.filter((r) => r.status !== 'ok')}
            rowKey={(r) => String(r.row)}
            emptyText="Every row is valid."
            columns={[
              { key: 'row', header: 'Row', render: (r) => String(r.row) },
              {
                key: 'status',
                header: 'Result',
                render: (r) => (r.status === 'error' ? t('Rejected') : t('Skipped')),
              },
              { key: 'msg', header: 'Why', render: (r) => r.messages.join('; ') },
            ]}
          />
        </>
      ) : null}
    </>
  );
}
