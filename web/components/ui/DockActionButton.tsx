import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { ButtonBase } from './ButtonBase';

type Tone = 'reject' | 'neutral' | 'heart';

interface DockActionButtonProps extends ComponentPropsWithoutRef<'button'> {
  tone?: Tone;
  'aria-label': string;
  children: ReactNode;
}

// 56px circular action buttons used inside the mobile glassmorphic swipe dock.
// Composes ButtonBase so it inherits focus ring, cursor-pointer, disabled state,
// and the 150ms transition. Active state brightens the background and scales 95%.
const toneClasses: Record<Tone, string> = {
  reject: [
    'bg-white/5 border border-white/10',
    'active:bg-red-500/20 active:border-red-500/40',
    'hover:bg-red-500/10 hover:border-red-500/30',
  ].join(' '),
  neutral: [
    'bg-white/5 border border-white/10',
    'active:bg-white/15',
    'hover:bg-white/10 hover:border-white/20',
  ].join(' '),
  heart: [
    'bg-white/5 border border-white/10',
    'active:bg-pink-500/20 active:border-pink-500/40',
    'hover:bg-pink-500/10 hover:border-pink-500/30',
  ].join(' '),
};

export const DockActionButton = forwardRef<HTMLButtonElement, DockActionButtonProps>(
  function DockActionButton({ tone = 'neutral', className, children, ...rest }, ref) {
    return (
      <ButtonBase
        ref={ref}
        className={cn(
          'relative flex items-center justify-center rounded-full',
          'w-14 h-14',
          'active:scale-95',
          'transition-all duration-150',
          toneClasses[tone],
          className,
        )}
        {...rest}
      >
        {children}
      </ButtonBase>
    );
  },
);
