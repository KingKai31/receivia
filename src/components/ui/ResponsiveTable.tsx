import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
}

export interface ResponsiveTableProps<T> {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyText?: string;
}

/** Table from 768px up; stacked cards with labelled fields on phones. */
export function ResponsiveTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  emptyText,
}: ResponsiveTableProps<T>) {
  if (rows.length === 0 && emptyText) return <p className="ui-hint">{emptyText}</p>;
  return (
    <>
      <table className="ui-table hidden md:table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key}>{c.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="m-0 flex list-none flex-col gap-3 p-0 md:hidden" aria-label={caption}>
        {rows.map((row) => (
          <li key={rowKey(row)} className="ui-card">
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {columns.map((c) => (
                <div key={c.key} className="contents">
                  <dt className="font-semibold">{c.header}</dt>
                  <dd className="m-0">{c.render(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
