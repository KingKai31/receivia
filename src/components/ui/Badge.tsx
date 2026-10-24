import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** Status is always conveyed with words, never colour alone. */
export function Badge({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return <span className="ui-badge">{typeof children === 'string' ? t(children) : children}</span>;
}
