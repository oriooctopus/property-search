'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { PrimaryButton } from '@/components/ui';

interface AuthModalProps {
  mode: 'login' | 'signup';
  onClose: () => void;
  onSuccess: () => void;
}

export default function AuthModal({ mode: initialMode, onClose, onSuccess }: AuthModalProps) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmSent, setConfirmSent] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const siteUrl = typeof window !== 'undefined' ? window.location.origin : '';

  // Reset form when toggling mode
  const switchMode = useCallback((newMode: 'login' | 'signup') => {
    setMode(newMode);
    setError(null);
    setConfirmSent(false);
  }, []);

  // Close on escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    onSuccess();
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error, data } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${siteUrl}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Auto-confirmed — redirect to profile setup
    if (data.session) {
      router.push('/profile?setup=true');
      router.refresh();
      return;
    }

    // Confirmation email sent
    setConfirmSent(true);
    setLoading(false);
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center px-4"
      style={{ zIndex: 1300, backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="relative w-full max-w-md rounded-lg p-8"
        style={{
          backgroundColor: '#1c2028',
          border: '1px solid #2d333b',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-[#8b949e] hover:text-[#e1e4e8] transition-colors cursor-pointer"
          aria-label="Close"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        {confirmSent ? (
          <div className="text-center py-4">
            <div className="text-3xl mb-4">📧</div>
            <h1 className="text-xl font-semibold mb-2" style={{ color: '#e1e4e8' }}>
              Check your email
            </h1>
            <p className="text-sm mb-4" style={{ color: '#8b949e' }}>
              We sent a confirmation link to <strong style={{ color: '#e1e4e8' }}>{email}</strong>.
              Click the link to activate your account.
            </p>
            <button
              onClick={() => switchMode('login')}
              className="text-sm hover:underline cursor-pointer"
              style={{ color: '#58a6ff' }}
            >
              Go to login →
            </button>
          </div>
        ) : (
          <>
            <h1
              className="mb-6 text-center text-2xl font-semibold"
              style={{ color: '#e1e4e8' }}
            >
              {mode === 'login' ? 'Log in' : 'Sign up'}
            </h1>

            <form
              onSubmit={mode === 'login' ? handleLogin : handleSignup}
              className="flex flex-col gap-4"
            >
              <div>
                <label
                  htmlFor="auth-modal-email"
                  className="mb-1.5 block text-xs text-[#8b949e]"
                >
                  Email
                </label>
                <input
                  id="auth-modal-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-9 w-full rounded-md border border-[#2d333b] bg-[#0f1117] px-3 text-sm text-[#e1e4e8] placeholder-[#8b949e] outline-none transition focus:border-[#58a6ff]"
                  placeholder="you@example.com"
                />
              </div>

              <div>
                <label
                  htmlFor="auth-modal-password"
                  className="mb-1.5 block text-xs text-[#8b949e]"
                >
                  Password
                </label>
                <input
                  id="auth-modal-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-9 w-full rounded-md border border-[#2d333b] bg-[#0f1117] px-3 text-sm text-[#e1e4e8] placeholder-[#8b949e] outline-none transition focus:border-[#58a6ff]"
                  placeholder={mode === 'login' ? 'Your password' : 'At least 6 characters'}
                />
              </div>

              {error && (
                <p className="text-sm" style={{ color: '#f85149' }}>
                  {error}
                </p>
              )}

              <PrimaryButton
                type="submit"
                variant={mode === 'signup' ? 'green' : undefined}
                disabled={loading}
                loading={loading}
                fullWidth
                className="mt-2 rounded-md py-2"
              >
                {mode === 'login' ? 'Log in' : 'Sign up'}
              </PrimaryButton>
            </form>

            <p
              className="mt-6 text-center text-sm"
              style={{ color: '#8b949e' }}
            >
              {mode === 'login' ? (
                <>
                  Don&apos;t have an account?{' '}
                  <button
                    onClick={() => switchMode('signup')}
                    className="hover:underline cursor-pointer"
                    style={{ color: '#58a6ff' }}
                  >
                    Sign up
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button
                    onClick={() => switchMode('login')}
                    className="hover:underline cursor-pointer"
                    style={{ color: '#58a6ff' }}
                  >
                    Log in
                  </button>
                </>
              )}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
