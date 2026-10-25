import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { Explanation } from '@/lib/explain';
import { Dialog } from './Dialog';

/** "Why this number": a small button beside a computed figure; opens the formula, inputs, sources and law. */
export function Why({ explain, label }: { explain: () => Explanation | null; label?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const name = label ?? t('Why this number');
  const [e, setE] = useState<Explanation | null>(null);
  return (
    <>
      <button
        type="button"
        className="why-btn"
        aria-label={name}
        title={name}
        onClick={() => {
          setE(explain());
          setOpen(true);
        }}
      >
        <span aria-hidden="true">?</span>
      </button>
      {e
        ? createPortal(
            <Dialog open={open} title={e.title} onClose={() => setOpen(false)}>
              <p className="num">
                <strong>{e.display}</strong>
              </p>
              <h3>{t('Formula')}</h3>
              <p>{e.formula}</p>
              <h3>{t('Inputs')}</h3>
              <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                {e.inputs.map((i, n) => (
                  <div key={n} className="contents">
                    <dt>{i.label}</dt>
                    <dd className="num m-0">{i.value}</dd>
                  </div>
                ))}
              </dl>
              {e.sources.length ? (
                <>
                  <h3>{t('Source rows')}</h3>
                  <ul>
                    {e.sources.map((s) => (
                      <li key={s.href}>
                        <Link to={s.href} onClick={() => setOpen(false)}>
                          {s.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {e.law ? (
                <>
                  <h3>{t('Law')}</h3>
                  <p>{e.law}</p>
                </>
              ) : null}
            </Dialog>,
            document.body,
          )
        : null}
    </>
  );
}
