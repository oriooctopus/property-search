'use client';

import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';
import { ButtonBase } from './ButtonBase';

type ActionVariant = 'wouldLive' | 'favorite';

interface ActionButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'children'> {
  variant: ActionVariant;
  active: boolean;
  /** If true, renders as a compact icon-only button (used in cards). If false, renders a larger labeled button (used in detail views). */
  compact?: boolean;
  label?: string;
}

const HomeIcon = ({ active }: { active: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const StarIcon = ({ active }: { active: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const compactClasses: Record<ActionVariant, { base: string; active: string; inactive: string }> = {
  wouldLive: {
    base: 'p-1.5 rounded-md',
    active: 'text-[#f97316] bg-[#f97316]/[0.12] hover:bg-[#f97316]/25 hover:text-[#fb923c]',
    inactive: 'text-[#8b949e] bg-transparent hover:bg-[#8b949e]/[0.08] hover:text-[#a1a7ae]',
  },
  favorite: {
    base: 'p-1.5 rounded-md',
    active: 'text-[#fbbf24] bg-[#fbbf24]/[0.12] hover:bg-[#fbbf24]/25 hover:text-[#fcd34d]',
    inactive: 'text-[#8b949e] bg-transparent hover:bg-[#8b949e]/[0.08] hover:text-[#a1a7ae]',
  },
};

const fullClasses: Record<ActionVariant, { base: string; active: string; inactive: string }> = {
  wouldLive: {
    base: 'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
    active: 'bg-[#f97316] text-white hover:bg-[#fb923c]',
    inactive: 'bg-[#2d333b] text-[#e1e4e8] hover:bg-[#3d444d]',
  },
  favorite: {
    base: 'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
    active: 'bg-[#fbbf24] text-[#0f1117] hover:bg-[#fcd34d]',
    inactive: 'bg-[#2d333b] text-[#e1e4e8] hover:bg-[#3d444d]',
  },
};

export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(
  function ActionButton({ variant, active, compact = false, label, className, ...rest }, ref) {
    const styles = compact ? compactClasses[variant] : fullClasses[variant];
    const Icon = variant === 'wouldLive' ? HomeIcon : StarIcon;

    return (
      <ButtonBase
        ref={ref}
        className={cn(styles.base, active ? styles.active : styles.inactive, className)}
        title={variant === 'wouldLive' ? 'I would live there' : 'Favorite'}
        {...rest}
      >
        <Icon active={active} />
        {!compact && label}
      </ButtonBase>
    );
  },
);
