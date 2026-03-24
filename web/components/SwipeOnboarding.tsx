'use client';

import { useEffect, useRef } from 'react';
import { PrimaryButton } from '@/components/ui';

interface SwipeOnboardingProps {
  onDismiss: () => void;
}

export default function SwipeOnboarding({ onDismiss }: SwipeOnboardingProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes swipe-pulse {
        0%, 100% { transform: scale(1); opacity: 0.9; }
        50% { transform: scale(1.1); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  const handleDismiss = () => {
    localStorage.setItem('dwelligence_swipe_onboarded', '1');
    onDismiss();
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
      handleDismiss();
    }
  };

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center px-6"
      style={{ zIndex: 1300, backgroundColor: 'rgba(0,0,0,0.85)' }}
      onClick={handleOverlayClick}
    >
      {/* Gesture indicators + mock card */}
      <div className="relative flex items-center justify-center" ref={cardRef}>
        {/* Left arrow */}
        <div
          className="absolute flex flex-col items-center gap-1"
          style={{ left: '-100px', animation: 'swipe-pulse 2s ease-in-out infinite' }}
        >
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <path d="M28 20H12M12 20L20 12M12 20L20 28" stroke="#ef4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-xs font-medium whitespace-nowrap" style={{ color: '#ef4444' }}>
            Swipe left to skip
          </span>
        </div>

        {/* Right arrow */}
        <div
          className="absolute flex flex-col items-center gap-1"
          style={{ right: '-110px', animation: 'swipe-pulse 2s ease-in-out infinite 0.3s' }}
        >
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <path d="M12 20H28M28 20L20 12M28 20L20 28" stroke="#eab308" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-xs font-medium whitespace-nowrap" style={{ color: '#eab308' }}>
            Swipe right to favorite
          </span>
        </div>

        {/* Up arrow */}
        <div
          className="absolute flex flex-col items-center gap-1"
          style={{ top: '-80px', animation: 'swipe-pulse 2s ease-in-out infinite 0.6s' }}
        >
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <path d="M20 28V12M20 12L12 20M20 12L28 20" stroke="#f97316" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-xs font-medium whitespace-nowrap" style={{ color: '#f97316' }}>
            Swipe up = would live here
          </span>
        </div>

        {/* Mock card silhouette */}
        <div
          className="rounded-2xl border border-white/20 bg-white/5 backdrop-blur-sm flex flex-col items-center justify-center gap-3"
          style={{ width: 220, height: 300 }}
        >
          <div className="w-16 h-16 rounded-full bg-white/10" />
          <div className="w-28 h-3 rounded bg-white/15" />
          <div className="w-20 h-3 rounded bg-white/10" />
          <div className="w-24 h-3 rounded bg-white/10" />
        </div>
      </div>

      {/* Got it button */}
      <div className="mt-10">
        <PrimaryButton onClick={handleDismiss} className="px-8 py-3 text-base">
          Got it!
        </PrimaryButton>
      </div>
    </div>
  );
}
