import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

export function buttonClassName(variant: ButtonVariant = 'primary'): string {
  return `button button--${variant}`;
}

export function Button({
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const { variant = 'primary', ...buttonProps } = props;
  return (
    <button
      type={type}
      className={`${buttonClassName(variant)} ${className}`.trim()}
      {...buttonProps}
    />
  );
}
