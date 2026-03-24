import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';

export interface SegmentedControlProps extends Omit<ComponentPropsWithoutRef<'div'>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}

export const SegmentedControl = forwardRef<HTMLDivElement, SegmentedControlProps>(
  function SegmentedControl({ value, onChange, options, className, ...rest }, ref) {
    return (
      <div
        ref={ref}
        className={cn('inline-flex items-stretch rounded-lg overflow-hidden', className)}
        style={{
          background: '#0f1117',
          border: '1px solid #2d333b',
        }}
        {...rest}
      >
        {options.map((opt, i) => {
          const isActive = opt.value === value;
          return (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              className={cn(
                'border-none text-[13px] font-medium px-3 sm:px-5 py-[5px] min-h-[44px] cursor-pointer transition-all duration-150 relative whitespace-nowrap',
                isActive
                  ? 'font-semibold'
                  : 'hover:text-[#e1e4e8]',
              )}
              style={{
                background: isActive ? 'rgba(88, 166, 255, 0.15)' : 'transparent',
                color: isActive ? '#58a6ff' : '#8b949e',
                borderLeft: i > 0 ? '1px solid #2d333b' : 'none',
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
