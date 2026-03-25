'use client';

interface SwipeOnboardingProps {
  onDismiss: () => void;
}

export default function SwipeOnboarding({ onDismiss }: SwipeOnboardingProps) {
  const handleDismiss = () => {
    localStorage.setItem('dwelligence_swipe_onboarded', '1');
    onDismiss();
  };

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{ zIndex: 1300, backgroundColor: 'rgba(0,0,0,0.4)' }}
      onClick={handleDismiss}
    >
      {/* Left edge pill */}
      <div
        className="absolute left-3 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-full text-sm font-medium"
        style={{
          backgroundColor: '#1c2028',
          border: '1px solid #3d444d',
          color: '#e1e4e8',
        }}
      >
        &larr; Skip
      </div>

      {/* Right edge pill */}
      <div
        className="absolute right-3 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-full text-sm font-medium"
        style={{
          backgroundColor: '#1c2028',
          border: '1px solid #3d444d',
          color: '#e1e4e8',
        }}
      >
        Like &rarr;
      </div>

      {/* Top edge pill */}
      <div
        className="absolute top-4 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full text-sm font-medium"
        style={{
          backgroundColor: '#1c2028',
          border: '1px solid #3d444d',
          color: '#e1e4e8',
        }}
      >
        &uarr; Would live here
      </div>

      {/* Bottom edge pill */}
      <div
        className="absolute bottom-24 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full text-sm font-medium"
        style={{
          backgroundColor: '#1c2028',
          border: '1px solid #3d444d',
          color: '#e1e4e8',
        }}
      >
        &darr; Back of queue
      </div>

      {/* Tap to start */}
      <div
        className="absolute bottom-14 left-1/2 -translate-x-1/2 text-sm"
        style={{ color: '#8b949e' }}
      >
        Tap to start swiping
      </div>
    </div>
  );
}
