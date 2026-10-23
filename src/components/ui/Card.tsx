import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  title?: string;
  children: ReactNode;
}

export function Card({ title, children, ...rest }: CardProps) {
  return (
    <section className="ui-card" {...rest}>
      {title ? <h2>{title}</h2> : null}
      {children}
    </section>
  );
}
