import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Explanation } from '@/lib/explain';
import { Dialog } from './Dialog';

/** "Why this number": a small button beside a computed figure; opens the formula, inputs, sources and law. */
export function Why({
  explain,
  label = 'Why this number',
}: {
  explain: () => Explanation | null;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [e, setE] = useState<Explanation | null>(null);
  return (
    <>
      <button
        type="button"
        className="why-btn"
        aria-label={label}
        title={label}
        onClick={() => {
          setE(explain());
          setOpen(true);
        }}
      >
        <span aria-hidden="true">?</span>
      </button>
      {e ? (
        <Dialog open={open} title={e.title} onClose={() => setOpen(false)}>
          <p className="num">
            <strong>{e.display}</strong>
          </p>
          <h3>Formula</h3>
          <p>{e.formula}</p>
          <h3>Inputs</h3>
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
              <h3>Source rows</h3>
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
              <h3>Law</h3>
              <p>{e.law}</p>
            </>
          ) : null}
        </Dialog>
      ) : null}
    </>
  );
}
