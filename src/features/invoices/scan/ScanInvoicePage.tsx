import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, GlassCard } from '@/components/ui';
import { useOrg } from '@/features/auth/useOrg';
import { can } from '@/lib/permissions';
import { auditScan, type AuditResult, type ScannedInvoice } from './audit';
import { scanInvoiceFile, stashPrefill } from './scanService';
import './scan.css';

type Stage = 'idle' | 'reading' | 'auditing' | 'result';
const STEPS: Stage[] = ['reading', 'auditing', 'result'];

/** Scan invoice: read with AI, audit with rules, review, then hand to New invoice. Never auto-saves. */
export function ScanInvoicePage() {
  const { t } = useTranslation();
  const org = useOrg();
  const nav = useNavigate();
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<ScannedInvoice | null>(null);
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const writable = can.writeData(org.data?.role ?? null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  async function onFile(file: File | undefined) {
    if (!file || !org.data) return;
    setError(null);
    setScan(null);
    setAudit(null);
    setStage('reading');
    try {
      const s = await scanInvoiceFile(org.data.orgId, file);
      setStage('auditing');
      const a = auditScan(s);
      // Short pause so the "auditing" step is visible; the audit itself is instant.
      timers.current.push(
        window.setTimeout(() => {
          setScan(s);
          setAudit(a);
          setStage('result');
        }, 700),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read this invoice.');
      setStage('idle');
    }
  }

  return (
    <main>
      <h1>{t('Scan invoice')}</h1>
      <p>
        {t(
          'Upload a photo or PDF of an invoice. AI reads it, then fixed GST rules check it. Nothing is saved until you review it and save it yourself. The file is not stored.',
        )}
      </p>
      {writable ? (
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          aria-label={t('Invoice file')}
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      ) : (
        <Alert>{t('Your role cannot add invoices.')}</Alert>
      )}
      {error ? <Alert urgent>{error}</Alert> : null}
      {stage !== 'idle' ? (
        <ol className="scan-steps" aria-live="polite">
          {STEPS.map((s) => (
            <li
              key={s}
              data-state={
                stage === 'result' || STEPS.indexOf(s) < STEPS.indexOf(stage)
                  ? 'done'
                  : s === stage
                    ? 'active'
                    : 'todo'
              }
            >
              {s === 'reading' ? t('Reading') : s === 'auditing' ? t('Auditing') : t('Result')}
            </li>
          ))}
        </ol>
      ) : null}
      {scan && audit && stage === 'result' ? (
        <GlassCard variant="solid" className="impact-card">
          <h2>
            {scan.invoice_no ?? t('Invoice')} {scan.date ? `· ${scan.date}` : ''}
          </h2>
          <ul className="scan-findings">
            {audit.findings.map((f, i) => (
              <li key={i} data-level={f.level}>
                {f.level === 'error' ? '✗ ' : f.level === 'ok' ? '✓ ' : '! '}
                {f.message}
              </li>
            ))}
          </ul>
          <p>
            {audit.mismatches > 0
              ? t('{{n}} problems found. Review before you use these details.', {
                  n: audit.mismatches,
                })
              : t('No GST problems found.')}
          </p>
          <Button
            variant="dark"
            onClick={() => {
              stashPrefill(scan);
              nav('/invoices/new?scan=1');
            }}
          >
            {t('Use in New invoice (review first)')}
          </Button>
        </GlassCard>
      ) : null}
    </main>
  );
}
