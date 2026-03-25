'use client';

import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '@/lib/cn';
import { ButtonBase } from './ButtonBase';

type ActionVariant = 'wouldLive' | 'favorite' | 'like' | 'dislike';

interface ActionButtonProps extends Omit<ComponentPropsWithoutRef<'button'>, 'children'> {
  variant: ActionVariant;
  active: boolean;
  /** If true, renders as a compact icon-only button (used in cards). If false, renders a larger labeled button (used in detail views). */
  compact?: boolean;
  label?: string;
}

const HomeIcon = ({ active }: { active: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {/* House body - filled when active, always stroked */}
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill={active ? 'currentColor' : 'none'} stroke="currentColor" />
    {/* Door rectangle - drawn on top with contrasting color when active */}
    <rect x="9" y="12" width="6" height="10" fill={active ? 'rgba(0,0,0,0.35)' : 'none'} stroke="currentColor" rx="0" />
  </svg>
);

const StarIcon = ({ active }: { active: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const ThumbsUpIcon = ({ active }: { active: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3m7-2V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14" />
  </svg>
);

const ThumbsDownIcon = ({ active }: { active: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 2H20a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3m-7 2v4a3 3 0 0 0 3 3l4-9V2H6.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10" />
  </svg>
);

const compactClasses: Record<ActionVariant, { base: string; active: string; inactive: string }> = {
  wouldLive: {
    base: 'p-1.5 rounded-md min-w-[44px] min-h-[44px] flex items-center justify-center',
    active: 'text-[#f97316] bg-[#f97316]/[0.12] hover:bg-[#f97316]/25 hover:text-[#fb923c]',
    inactive: 'text-[#8b949e] bg-transparent hover:bg-[#8b949e]/[0.08] hover:text-[#a1a7ae]',
  },
  favorite: {
    base: 'p-1.5 rounded-md min-w-[44px] min-h-[44px] flex items-center justify-center',
    active: 'text-[#fbbf24] bg-[#fbbf24]/[0.12] hover:bg-[#fbbf24]/25 hover:text-[#fcd34d]',
    inactive: 'text-[#8b949e] bg-transparent hover:bg-[#8b949e]/[0.08] hover:text-[#a1a7ae]',
  },
  like: {
    base: 'p-1.5 rounded-md min-w-[44px] min-h-[44px] flex items-center justify-center',
    active: 'text-[#fbbf24] bg-[#fbbf24]/[0.12] hover:bg-[#fbbf24]/25 hover:text-[#fcd34d]',
    inactive: 'text-[#8b949e] bg-transparent hover:bg-[#8b949e]/[0.08] hover:text-[#a1a7ae]',
  },
  dislike: {
    base: 'p-1.5 rounded-md min-w-[44px] min-h-[44px] flex items-center justify-center',
    active: 'text-[#f85149] bg-[#f85149]/[0.12] hover:bg-[#f85149]/25 hover:text-[#f97583]',
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
  like: {
    base: 'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
    active: 'bg-[#fbbf24] text-[#0f1117] hover:bg-[#fcd34d]',
    inactive: 'bg-[#2d333b] text-[#e1e4e8] hover:bg-[#3d444d]',
  },
  dislike: {
    base: 'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium',
    active: 'bg-[#f85149] text-white hover:bg-[#f97583]',
    inactive: 'bg-[#2d333b] text-[#e1e4e8] hover:bg-[#3d444d]',
  },
};

export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(
  function ActionButton({ variant, active, compact = false, label, className, ...rest }, ref) {
    const styles = compact ? compactClasses[variant] : fullClasses[variant];
    const iconMap: Record<ActionVariant, typeof HomeIcon> = {
      wouldLive: HomeIcon,
      favorite: StarIcon,
      like: ThumbsUpIcon,
      dislike: ThumbsDownIcon,
    };
    const titleMap: Record<ActionVariant, string> = {
      wouldLive: 'I would live there',
      favorite: 'Favorite',
      like: 'Like',
      dislike: 'Dislike',
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
