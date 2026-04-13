'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { PrimaryButton, TextButton } from '@/components/ui';

interface ShareWishlistModalProps {
  wishlistId: string;
  wishlistName: string;
  shares: Array<{ id: number; shared_with_email: string; permission: string }>;
  onClose: () => void;
  onSharesChanged: () => void;
}

const inputStyle: React.CSSProperties = {
  backgroundColor: '#0f1117',
  border: '1px solid #2d333b',
  borderRadius: '6px',
  padding: '8px 12px',
  color: '#e1e4e8',
  outline: 'none',
};

export default function ShareWishlistModal({
  wishlistId,
  wishlistName,
  shares,
  onClose,
  onSharesChanged,
}: ShareWishlistModalProps) {
  const [email, setEmail] = useState('');
  const [selectedPermission, setSelectedPermission] = useState('viewer');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) onClose();
  };

  const handleInvite = async () => {
    if (!email.trim()) return;
    setInviting(true);
    setInviteError(null);
    try {
      const { error } = await supabase.from('wishlist_shares').insert({
        wishlist_id: wishlistId,
        shared_with_email: email.trim(),
        permission: selectedPermission,
      });
      if (error) throw error;
      setEmail('');
      onSharesChanged();
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : 'Failed to invite');
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (shareId: number) => {
    setRemovingId(shareId);
    try {
      await supabase.from('wishlist_shares').delete().eq('id', shareId);
      onSharesChanged();
    } finally {
      setRemovingId(null);
    }
  };

  const handleCopyLink = async () => {
    const link = `${window.location.origin}/wishlists/${wishlistId}`;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1300,
        backgroundColor: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        style={{
          backgroundColor: '#1c2028',
          border: '1px solid #2d333b',
          borderRadius: '12px',
          maxWidth: '440px',
          width: '100%',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#e1e4e8' }}>
            Share &ldquo;{wishlistName}&rdquo;
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#8b949e',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '6px',
              transition: 'color 150ms ease',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#e1e4e8'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#8b949e'; }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z" />
            </svg>
          </button>
        </div>

        {/* Invite row */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleInvite(); }}
              style={{ ...inputStyle, flex: 1, fontSize: '14px' }}
            />
            <select
              value={selectedPermission}
              onChange={(e) => setSelectedPermission(e.target.value)}
              style={{
                ...inputStyle,
                cursor: 'pointer',
                fontSize: '13px',
                flexShrink: 0,
              }}
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
          </div>
          <PrimaryButton
            onClick={handleInvite}
            disabled={inviting || !email.trim()}
            style={{ alignSelf: 'flex-start' }}
          >
            {inviting ? 'Inviting…' : 'Invite'}
          </PrimaryButton>
          {inviteError && (
            <p style={{ margin: 0, fontSize: '12px', color: '#f85149' }}>{inviteError}</p>
          )}
        </div>

        {/* Current shares list */}
        {shares.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <p style={{ margin: 0, fontSize: '12px', fontWeight: 600, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Shared with
            </p>
            {shares.map((share) => (
              <div
                key={share.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                }}
              >
                <span style={{ fontSize: '14px', color: '#e1e4e8', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {share.shared_with_email}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      color: share.permission === 'editor' ? '#fbbf24' : '#58a6ff',
                      backgroundColor: share.permission === 'editor' ? 'rgba(251,191,36,0.12)' : 'rgba(88,166,255,0.12)',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      textTransform: 'capitalize',
                    }}
                  >
                    {share.permission}
                  </span>
                  <TextButton
                    onClick={() => handleRemove(share.id)}
                    disabled={removingId === share.id}
                    style={{ fontSize: '12px', color: '#f85149' }}
                  >
                    {removingId === share.id ? 'Removing…' : 'Remove'}
                  </TextButton>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Copy link */}
        <div>
          <button
            onClick={handleCopyLink}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'none',
              border: '1px solid #2d333b',
              borderRadius: '6px',
              padding: '8px 12px',
              color: copied ? '#7ee787' : '#58a6ff',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 500,
              transition: 'color 150ms ease, border-color 150ms ease',
              width: '100%',
              justifyContent: 'center',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M7.775 3.275a.75.75 0 0 0 1.06 1.06l1.25-1.25a2 2 0 1 1 2.83 2.83l-2.5 2.5a2 2 0 0 1-2.83 0 .75.75 0 0 0-1.06 1.06 3.5 3.5 0 0 0 4.95 0l2.5-2.5a3.5 3.5 0 0 0-4.95-4.95l-1.25 1.25zm-4.69 9.64a2 2 0 0 1 0-2.83l2.5-2.5a2 2 0 0 1 2.83 0 .75.75 0 0 0 1.06-1.06 3.5 3.5 0 0 0-4.95 0l-2.5 2.5a3.5 3.5 0 0 0 4.95 4.95l1.25-1.25a.75.75 0 0 0-1.06-1.06l-1.25 1.25a2 2 0 0 1-2.83 0z" />
            </svg>
            {copied ? 'Copied!' : 'Copy share link'}
          </button>
        </div>

        {/* Footer note */}
        <p style={{ margin: 0, fontSize: '12px', color: '#8b949e', lineHeight: '1.5' }}>
          Viewers can see listings. Editors can also add and remove listings.
        </p>
      </div>
    </div>
  );
}
