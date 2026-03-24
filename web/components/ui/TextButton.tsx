import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';
import { ButtonBase } from './ButtonBase';

type TextVariant = 'muted' | 'accent' | 'danger';

interface TextButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: TextVariant;
}

const variantClasses: Record<TextVariant, string> = {
  muted: 'text-[#8b949e] hover:text-[#e1e4e8]',
  accent: 'text-[#58a6ff] hover:text-[#79b8ff]',
  danger: 'text-[#8b949e] hover:text-[#f85149] border border-[#2d333b] hover:border-[#f85149] rounded px-3 py-1.5',
};

export const TextButton = forwardRef<HTMLButtonElement, TextButtonProps>(
  function TextButton({ variant = 'muted', className, ...rest }, ref) {
    return (
      <ButtonBase
        ref={ref}
        className={cn('text-sm font-medium', variantClasses[variant], className)}
        {...rest}
      />
    );
  },
);
