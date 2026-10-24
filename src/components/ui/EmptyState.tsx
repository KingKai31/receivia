import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  const { t } = useTranslation();
  return (
    <div className="ui-empty">
      <h2>{t(title)}</h2>
      {description ? <p>{t(description)}</p> : null}
      {action}
    </div>
  );
}
