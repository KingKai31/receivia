import type { HTMLAttributes, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  title?: string;
  children: ReactNode;
}

/** Dense content card: solid glass so text and numbers stay sharp. */
export function Card({ title, children, className = '', ...rest }: CardProps) {
  const { t } = useTranslation();
  return (
    <section className={`ui-card rv ${className}`} {...rest}>
      {title ? <h2>{t(title)}</h2> : null}
      {children}
    </section>
  );
}
