import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';
import { ButtonBase } from './ButtonBase';

type PillPosition = 'first' | 'middle' | 'last' | 'only';

interface PillButtonProps extends ComponentPropsWithoutRef<'button'> {
  active?: boolean;
  position?: PillPosition;
}

const radiusClasses: Record<PillPosition, string> = {
  first: 'rounded-l-lg rounded-r-none',
  middle: 'rounded-none',
  last: 'rounded-r-lg rounded-l-none',
  only: 'rounded-lg',
};

export const PillButton = forwardRef<HTMLButtonElement, PillButtonProps>(
  function PillButton({ active = false, position = 'only', className, children, ...rest }, ref) {
    return (
      <ButtonBase
        ref={ref}
        className={cn(
          'px-4 py-2 text-sm font-medium border',
          radiusClasses[position],
          position !== 'first' && '-ml-px',
          active
            ? 'bg-[#58a6ff] text-[#0f1117] border-[#58a6ff] hover:bg-[#6bb4ff] z-[1]'
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
