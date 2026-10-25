import { useTranslation } from 'react-i18next';
import { Gauge } from '@/components/ui/display';
import type { Payability } from '@/lib/payability';

/** Animated checklist: the gauge sweeps to the score; each row fades up with a tick, dot or cross. */
export function PayabilityChecklist({ p, threshold }: { p: Payability; threshold: number }) {
  const { t } = useTranslation();
  return (
    <section
      aria-label={t('Ready to get paid')}
      className="glass"
      style={{ padding: 16, borderRadius: 20 }}
    >
      <h2 style={{ marginTop: 0 }}>{t('Ready to get paid')}</h2>
      <Gauge percent={p.score} label={t('Payability {{v}} of 100', { v: p.score })} />
      <p className="ui-hint">{t('Issuing needs {{v}} or more.', { v: threshold })}</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        {p.checks.map((c, i) => (
          <li
            key={c.key}
            data-ok={c.ok}
            style={{
              display: 'flex',
              gap: 8,
              animation: `fadeUp 0.6s var(--ease) ${i * 60}ms both`,
            }}
          >
            <span aria-hidden="true">{c.ok ? '✓' : c.points > 0 ? '•' : '✕'}</span>
            <span>
              <strong>{t(c.label)}</strong>{' '}
              <span className="num">
                {c.points}/{c.max}
              </span>
              <br />
              <span className="ui-hint">{t(c.reason)}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
