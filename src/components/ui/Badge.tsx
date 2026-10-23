import type { ReactNode } from 'react';

/** Status is always conveyed with words, never colour alone. */
export function Badge({ children }: { children: ReactNode }) {
  return <span className="ui-badge">{children}</span>;
}
