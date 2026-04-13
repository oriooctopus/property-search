'use client';

import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';
import { ButtonBase } from './ButtonBase';

type ActionVariant = 'save' | 'hide';

interface ActionButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'children'> {
  variant: ActionVariant;
  active: boolean;
  /** If true, renders as a compact icon-only button (used in cards). If false, renders a larger labeled button (used in detail views). */
  compact?: boolean;
  label?: string;
}

const StarIcon = ({ active }: { active: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const EyeSlashIcon = ({ active }: { active: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" stroke={active ? 'currentColor' : 'currentColor'} />
  </svg>
);

const compactClasses: Record<ActionVariant, { base: string; active: string; inactive: string }> = {
  save: {
    base: 'p-1.5 rounded-md min-w-[44px] min-h-[44px] flex items-center justify-center',
    active: 'text-[#fbbf24] bg-[#fbbf24]/[0.12] hover:bg-[#fbbf24]/25 hover:text-[#fcd34d]',
    inactive: 'text-[#8b949e] bg-transparent hover:bg-[#8b949e]/[0.08] hover:text-[#a1a7ae]',
  },
  hide: {
    base: 'p-1.5 rounded-md min-w-[44px] min-h-[44px] flex items-center justify-center',
    active: 'text-[#f85149] bg-[#f85149]/[0.12] hover:bg-[#f85149]/25 hover:text-[#f97583]',
    inactive: 'text-[#8b949e] bg-transparent hover:bg-[#8b949e]/[0.08] hover:text-[#a1a7ae]',
  },
};

const fullClasses: Record<ActionVariant, { base: string; active: string; inactive: string }> = {
  save: {
    base: 'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
    active: 'bg-[#fbbf24] text-[#0f1117] hover:bg-[#fcd34d]',
    inactive: 'bg-[#2d333b] text-[#e1e4e8] hover:bg-[#3d444d]',
  },
  hide: {
    base: 'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
    active: 'bg-[#f85149] text-white hover:bg-[#f97583]',
    inactive: 'bg-[#2d333b] text-[#e1e4e8] hover:bg-[#3d444d]',
  },
};

export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(
  function ActionButton({ variant, active, compact = false, label, className, ...rest }, ref) {
    const styles = compact ? compactClasses[variant] : fullClasses[variant];
    const iconMap: Record<ActionVariant, typeof StarIcon> = {
      save: StarIcon,
      hide: EyeSlashIcon,
    };
    const titleMap: Record<ActionVariant, string> = {
      save: 'Save',
      hide: 'Hide',
    };
    const Icon = iconMap[variant];

    return (
      <ButtonBase
        ref={ref}
        className={cn(styles.base, active ? styles.active : styles.inactive, className)}
        title={titleMap[variant]}
        {...rest}
      >
        <Icon active={active} />
        {!compact && label}
      </ButtonBase>
    );
  },
);
