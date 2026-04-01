import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';
import { ButtonBase } from './ButtonBase';

interface TagButtonProps extends ComponentPropsWithoutRef<'button'> {
  active?: boolean;
}

export const TagButton = forwardRef<HTMLButtonElement, TagButtonProps>(
  function TagButton({ active = false, className, children, ...rest }, ref) {
    return (
      <ButtonBase
        ref={ref}
        className={cn(
          'px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap border min-h-[44px]',
          active
            ? 'bg-[#58a6ff] text-[#0f1117] border-[#58a6ff] hover:bg-[#6bb4ff]'
            : 'bg-transparent text-[#8b949e] border-[#2d333b] hover:bg-[#58a6ff]/20 hover:text-[#c0d6f5] hover:border-[#58a6ff]/40',
          className,
        )}
        {...rest}
      >
        {children}
      </ButtonBase>
    );
  },
);
