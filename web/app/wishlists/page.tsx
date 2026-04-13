'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';
import { useWishlists, useWishlistMutations } from '@/lib/hooks/useWishlists';
import { PrimaryButton, TextButton } from '@/components/ui';

export default function WishlistsPage() {
  const supabase = createClient();
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const newInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.replace('/auth/login');
        return;
      }
      setUserId(user.id);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (showNewModal) {
      setTimeout(() => newInputRef.current?.focus(), 50);
    }
  }, [showNewModal]);

  const { data: wishlists, isLoading: wishlistsLoading } = useWishlists(userId);
  const { createWishlist } = useWishlistMutations(userId);

  function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    createWishlist.mutate(trimmed, {
      onSuccess: () => {
        setShowNewModal(false);
        setNewName('');
      },
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleCreate();
    if (e.key === 'Escape') {
      setShowNewModal(false);
      setNewName('');
    }
  }

  if (loading || wishlistsLoading) {
    return (
      <div style={{ display: 'flex', minHeight: '60vh', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f1117' }}>
        <p style={{ color: '#8b949e' }}>Loading...</p>
      </div>
    );
  }

  if (!userId) return null;

  return (
    <div style={{ backgroundColor: '#0f1117', minHeight: '100vh' }}>
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '32px 16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <h1 style={{ color: '#e1e4e8', fontSize: '24px', fontWeight: 600, margin: 0 }}>
            My Wishlists
          </h1>
          <PrimaryButton
            variant="accent"
            onClick={() => setShowNewModal(true)}
          >
            + New Wishlist
          </PrimaryButton>
        </div>

        {/* Grid */}
        {!wishlists || wishlists.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '64px 0', color: '#8b949e' }}>
            <p style={{ marginBottom: '12px' }}>No wishlists yet.</p>
            <p style={{ fontSize: '14px' }}>Create one to start saving listings.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
            {wishlists.map((wishlist) => {
              const isDefault = wishlist.name === 'Favorites';
              const itemCount = wishlist.wishlist_items?.length ?? 0;
              const shareCount = wishlist.wishlist_shares?.length ?? 0;
              const isHovered = hoveredId === wishlist.id;

              return (
                <Link
                  key={wishlist.id}
                  href={`/wishlists/${wishlist.id}`}
                  style={{ textDecoration: 'none' }}
                >
                  <div
                    onMouseEnter={() => setHoveredId(wishlist.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{
                      backgroundColor: '#1c2028',
                      border: `1px solid ${isHovered ? '#58a6ff' : '#2d333b'}`,
                      borderRadius: '12px',
                      padding: '16px',
                      cursor: 'pointer',
                      transition: 'border-color 150ms ease',
                    }}
                  >
                    {/* Name row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                      {isDefault && (
                        <span style={{ color: '#fbbf24', fontSize: '14px', flexShrink: 0 }}>★</span>
                      )}
                      <span style={{ color: '#e1e4e8', fontWeight: 600, fontSize: '15px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {wishlist.name}
                      </span>
                    </div>

                    {/* Count */}
                    <div style={{ color: '#8b949e', fontSize: '13px' }}>
                      {itemCount === 1 ? '1 listing' : `${itemCount} listings`}
                    </div>

                    {/* Shared indicator */}
                    {shareCount > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '6px', color: '#8b949e', fontSize: '12px' }}>
                        {/* People icon */}
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                        <span>Shared with {shareCount}</span>
                      </div>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* New Wishlist Modal */}
      {showNewModal && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) { setShowNewModal(false); setNewName(''); } }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1300,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              backgroundColor: '#1c2028',
              border: '1px solid #2d333b',
              borderRadius: '12px',
              maxWidth: '400px',
              width: '100%',
              margin: '0 16px',
              padding: '24px',
            }}
          >
            <h2 style={{ color: '#e1e4e8', fontSize: '18px', fontWeight: 600, margin: '0 0 16px' }}>
              New Wishlist
            </h2>
            <input
              ref={newInputRef}
              type="text"
              placeholder="Wishlist name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleKeyDown}
              style={{
                width: '100%',
                backgroundColor: '#0f1117',
                border: '1px solid #2d333b',
                borderRadius: '6px',
                padding: '8px 12px',
                color: '#e1e4e8',
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
                marginBottom: '16px',
              }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <TextButton
                variant="muted"
                onClick={() => { setShowNewModal(false); setNewName(''); }}
              >
                Cancel
              </TextButton>
              <PrimaryButton
                variant="accent"
                onClick={handleCreate}
                disabled={!newName.trim() || createWishlist.isPending}
                loading={createWishlist.isPending}
              >
                Create
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
