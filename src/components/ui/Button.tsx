import type { ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'light' | 'dark' | 'ghost';
}

export function Button({ variant = 'primary', type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className="ui-button" data-variant={variant} {...rest} />;
}
