import { forwardRef, useRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { ButtonBase } from './ButtonBase';

interface FilterChipProps extends Omit<ComponentPropsWithoutRef<'button'>, 'children'> {
  label: string;
  active?: boolean;
  open?: boolean;
  compact?: boolean;
  children?: ReactNode;
  onToggle?: () => void;
  /** Align the dropdown to the right edge of the chip instead of the left */
  dropdownAlign?: 'left' | 'right';
}

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 4.5L6 7.5L9 4.5" />
    </svg>
  );
}

export const FilterChip = forwardRef<HTMLButtonElement, FilterChipProps>(
  function FilterChip({ label, active = false, open = false, compact = false, children, onToggle, dropdownAlign = 'left', className, ...rest }, ref) {
    const chipRef = useRef<HTMLDivElement>(null);
    return (
      <div className="relative shrink-0" ref={chipRef}>
        <ButtonBase
          ref={ref}
          onClick={onToggle}
          className={cn(
            'flex items-center gap-1 rounded-md font-medium whitespace-nowrap border',
            compact
              ? 'px-2.5 py-0.5 text-[11px] h-[28px]'
              : 'px-3.5 py-1.5 text-sm min-h-[44px] gap-1.5 rounded-full',
            active
              ? 'bg-[#58a6ff]/[0.08] text-[#58a6ff] border-[#58a6ff] hover:bg-[#58a6ff]/[0.18]'
              : 'bg-transparent text-[#8b949e] border-[#2d333b] hover:bg-[#58a6ff]/20 hover:text-[#c0d6f5] hover:border-[#58a6ff]/40',
            className,
          )}
          {...rest}
        >
          {label}
          {children !== undefined && (
            <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
          )}
        </ButtonBase>

        {open && children && (
          <div
            className="fixed z-[9999] rounded-xl border border-[#2d333b] p-5 shadow-xl"
            style={{
              backgroundColor: '#1c2028',
              minWidth: '320px',
              maxWidth: 'calc(100vw - 16px)',
              top: chipRef.current ? chipRef.current.getBoundingClientRect().bottom + 8 : 0,
              ...(dropdownAlign === 'right'
                ? { right: chipRef.current ? window.innerWidth - chipRef.current.getBoundingClientRect().right : 0 }
                : { left: chipRef.current ? chipRef.current.getBoundingClientRect().left : 0 }),
            }}
          >
            {children}
          </div>
        )}
      </div>
    );
  },
);
