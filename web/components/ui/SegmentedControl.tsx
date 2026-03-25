import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SegmentedControlProps extends Omit<ComponentPropsWithoutRef<'div'>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: ReactNode }[];
}

export const SegmentedControl = forwardRef<HTMLDivElement, SegmentedControlProps>(
  function SegmentedControl({ value, onChange, options, className, ...rest }, ref) {
    return (
      <div
        ref={ref}
        className={cn('inline-flex items-stretch rounded-md overflow-hidden', className)}
        style={{
          background: 'transparent',
        }}
        {...rest}
      >
        {options.map((opt) => {
          const isActive = opt.value === value;
          return (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              className={cn(
                'border-none text-[11px] font-medium px-2 py-0.5 cursor-pointer transition-all duration-150 relative whitespace-nowrap h-[26px]',
                isActive
                  ? 'font-semibold'
                  : 'hover:text-[#e1e4e8]',
              )}
              style={{
                background: isActive ? 'rgba(88, 166, 255, 0.1)' : 'transparent',
                color: isActive ? '#58a6ff' : '#8b949e',
                borderRadius: '5px',
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  },
);
