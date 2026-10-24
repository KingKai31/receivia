import type { HTMLAttributes, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  title?: string;
  children: ReactNode;
}

export function Card({ title, children, ...rest }: CardProps) {
  const { t } = useTranslation();
  return (
    <section className="ui-card" {...rest}>
      {title ? <h2>{t(title)}</h2> : null}
      {children}
    </section>
  );
}
