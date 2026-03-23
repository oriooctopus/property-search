import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';
import { ButtonBase } from './ButtonBase';

type PrimaryVariant = 'accent' | 'green';

interface PrimaryButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: PrimaryVariant;
  fullWidth?: boolean;
  loading?: boolean;
}

const variantClasses: Record<PrimaryVariant, string> = {
  accent: 'bg-[#58a6ff] text-[#0f1117] hover:bg-[#4c8fdf]',
  green: 'bg-[#7ee787] text-[#0f1117] hover:bg-[#6bd874]',
};

export const PrimaryButton = forwardRef<HTMLButtonElement, PrimaryButtonProps>(
  function PrimaryButton({ variant = 'accent', fullWidth = false, loading = false, className, children, disabled, ...rest }, ref) {
    return (
      <ButtonBase
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'rounded-lg px-4 py-2.5 text-sm font-medium',
          variantClasses[variant],
          fullWidth && 'w-full',
          className,
        )}
        {...rest}
      >
        {loading ? 'Loading...' : children}
      </ButtonBase>
    );
  },
);
