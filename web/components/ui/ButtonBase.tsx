import React, { forwardRef } from 'react';
import { cn } from '@/lib/cn';

export interface ButtonBaseProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string;
}

const baseClasses = [
  'cursor-pointer transition-colors duration-150',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#58a6ff] focus-visible:ring-offset-1 focus-visible:ring-offset-[#0f1117]',
  'disabled:opacity-50 disabled:pointer-events-none',
].join(' ');

export const ButtonBase = forwardRef<HTMLButtonElement, ButtonBaseProps>(
  function ButtonBase({ className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={cn(baseClasses, className)}
        {...rest}
      />
    );
  },
);

/** Shared base classes for non-button elements that need the same styling */
export { baseClasses as buttonBaseClasses };
