import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { ButtonBase } from './ButtonBase';

type Variant = 'overlay' | 'ghost';
type Size = 'sm' | 'md';

interface IconButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: Variant;
  size?: Size;
  'aria-label': string;
  children: ReactNode;
}

const sizeClasses: Record<Size, string> = {
  sm: 'h-6 w-6 text-sm min-w-[44px] min-h-[44px]',
  md: 'h-8 w-8 text-base min-w-[44px] min-h-[44px]',
};

const variantClasses: Record<Variant, string> = {
  overlay: [
    'rounded-full flex items-center justify-center',
    'bg-black/55 text-white',
    'hover:bg-black/75',
  ].join(' '),
  ghost: [
    'rounded-md flex items-center justify-center',
    'bg-transparent text-[#8b949e]',
    'hover:bg-[#8b949e]/10 hover:text-[#e1e4e8]',
  ].join(' '),
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ variant = 'ghost', size = 'md', className, children, ...rest }, ref) {
    return (
      <ButtonBase
        ref={ref}
        className={cn(sizeClasses[size], variantClasses[variant], className)}
        {...rest}
      >
        {children}
      </ButtonBase>
    );
  },
);
