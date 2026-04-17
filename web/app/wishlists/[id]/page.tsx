'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase-browser';
import { useWishlistMutations } from '@/lib/hooks/useWishlists';
import { PrimaryButton } from '@/components/ui';
import ListingCard from '@/components/ListingCard';
import ListingsMapLayout from '@/components/ListingsMapLayout';
import ShareWishlistModal from '@/components/ShareWishlistModal';
import type { Database } from '@/lib/types';

type Listing = Database['public']['Tables']['listings']['Row'];

interface WishlistShare {
  id: number;
  shared_with_email: string;
  permission: string;
}

interface WishlistDetail {
  id: string;
  name: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  wishlist_items: Array<{ listing_id: number; listings: Listing | null }>;
  wishlist_shares: WishlistShare[];
}

export default function WishlistDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const queryClient = useQueryClient();

  const [userId, setUserId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.replace('/auth/login');
        return;
      }
      setUserId(user.id);
      setAuthLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isEditingName) {
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [isEditingName]);

  const { data: wishlist, isLoading: wishlistLoading } = useQuery<WishlistDetail>({
    queryKey: ['wishlist-detail', params.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wishlists')
        .select('*, wishlist_items(listing_id, listings(*)), wishlist_shares(id, shared_with_email, permission)')
        .eq('id', params.id)
        .single();
      if (error) throw error;
      return data as unknown as WishlistDetail;
    },
    enabled: !!params.id,
  });

  const { removeFromWishlist, deleteWishlist, renameWishlist } = useWishlistMutations(userId);

  const listings: Listing[] = wishlist?.wishlist_items
    ?.map((item) => item.listings)
    .filter((l): l is Listing => l != null) ?? [];

  const isOwner = userId != null && wishlist?.user_id === userId;

  // ── Name editing ──────────────────────────────────────────────
  const handleNameDoubleClick = () => {
    if (!isOwner) return;
    setEditNameValue(wishlist?.name ?? '');
    setIsEditingName(true);
  };

  const commitRename = () => {
    const trimmed = editNameValue.trim();
    if (trimmed && trimmed !== wishlist?.name) {
      renameWishlist.mutate(
        { id: params.id, name: trimmed },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['wishlist-detail', params.id] });
          },
        }
      );
    }
    setIsEditingName(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitRename();
    if (e.key === 'Escape') setIsEditingName(false);
  };

  // ── Delete ────────────────────────────────────────────────────
  const handleDelete = () => {
    if (!confirm(`Delete "${wishlist?.name}"? This cannot be undone.`)) return;
    deleteWishlist.mutate(params.id, {
      onSuccess: () => router.replace('/wishlists'),
    });
  };

  // ── Remove from wishlist ──────────────────────────────────────
  const handleRemoveListing = (listingId: number) => {
    removeFromWishlist.mutate(
      { wishlistId: params.id, listingId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['wishlist-detail', params.id] });
        },
      }
    );
  };

  // ── Loading / auth states ─────────────────────────────────────
  if (authLoading || wishlistLoading) {
    return (
      <div
        style={{
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0f1117',
        }}
      >
        <p style={{ color: '#8b949e' }}>Loading…</p>
      </div>
    );
  }

  if (!wishlist) {
    return (
      <div
        style={{
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0f1117',
        }}
      >
        <p style={{ color: '#8b949e' }}>Wishlist not found.</p>
      </div>
    );
  }

  const shares = wishlist.wishlist_shares ?? [];

  // ── Wishlist header bar ───────────────────────────────────────
  const wishlistHeader = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        borderBottom: '1px solid #2d333b',
        padding: '12px 16px',
        flexShrink: 0,
        flexWrap: 'wrap',
      }}
    >
      {/* Back link */}
      <Link
        href="/wishlists"
        style={{ color: '#58a6ff', fontSize: '14px', textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}
      >
        ← My Wishlists
      </Link>

      {/* Name (editable on double-click for owner) */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
        {isEditingName ? (
          <input
            ref={nameInputRef}
            value={editNameValue}
            onChange={(e) => setEditNameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleNameKeyDown}
            style={{
              backgroundColor: '#0f1117',
              border: '1px solid #58a6ff',
              borderRadius: '6px',
              padding: '4px 8px',
              color: '#e1e4e8',
              fontSize: '18px',
              fontWeight: 700,
              outline: 'none',
              minWidth: 0,
              flex: 1,
            }}
          />
        ) : (
          <>
            <span
              onDoubleClick={handleNameDoubleClick}
              title={isOwner ? 'Double-click to rename' : undefined}
              style={{
                fontWeight: 700,
                fontSize: '18px',
                color: '#e1e4e8',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                cursor: isOwner ? 'text' : 'default',
              }}
            >
              {wishlist.name}
            </span>

            {/* Pencil / edit icon — owner only */}
            {isOwner && (
              <button
                onClick={handleNameDoubleClick}
                title="Rename wishlist"
                aria-label="Rename wishlist"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'none',
                  border: 'none',
                  padding: '2px',
                  marginLeft: '2px',
                  color: '#8b949e',
                  cursor: 'pointer',
                  flexShrink: 0,
                  transition: 'color 150ms ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = '#58a6ff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = '#8b949e'; }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm1.414 1.06a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354l-1.086-1.086ZM11.189 6.25 9.75 4.81 3.34 11.22c-.044.044-.072.099-.084.16l-.608 2.126 2.126-.608a.253.253 0 0 0 .16-.084l6.41-6.41-.155-.154Z" />
                </svg>
              </button>
            )}
          </>
        )}

        {/* Listing count badge */}
        <span
          style={{
            fontSize: '12px',
            color: '#8b949e',
            backgroundColor: '#1c2028',
            border: '1px solid #2d333b',
            borderRadius: '10px',
            padding: '2px 8px',
            flexShrink: 0,
          }}
        >
          {listings.length} {listings.length === 1 ? 'listing' : 'listings'}
        </span>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <PrimaryButton
          onClick={() => setShowShareModal(true)}
          style={{ fontSize: '13px', padding: '6px 12px' }}
        >
          Share
        </PrimaryButton>

        {isOwner && (
          <button
            onClick={handleDelete}
            disabled={deleteWishlist.isPending}
            title="Delete wishlist"
            aria-label="Delete wishlist"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'none',
              border: '1px solid #2d333b',
              borderRadius: '6px',
              padding: '6px',
              color: '#8b949e',
              cursor: 'pointer',
              transition: 'color 150ms ease, border-color 150ms ease',
            }}
            onMouseEnter={(e) => {
              const btn = e.currentTarget;
              btn.style.color = '#f85149';
              btn.style.borderColor = '#f85149';
            }}
            onMouseLeave={(e) => {
              const btn = e.currentTarget;
              btn.style.color = '#8b949e';
              btn.style.borderColor = '#2d333b';
            }}
          >
            {/* Trash icon */}
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
              <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.149l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );

  // ── Empty state ───────────────────────────────────────────────
  const emptyState = listings.length === 0 ? (
    <div style={{ textAlign: 'center', padding: '48px 0', color: '#8b949e' }}>
      <p>No listings in this wishlist yet.</p>
    </div>
  ) : null;

  return (
    <>
      <ListingsMapLayout
        listings={listings}
        selectedId={selectedId}
        onSelectId={setSelectedId}
        header={wishlistHeader}
        footer={emptyState}
        favoritedIds={new Set(listings.map((l) => l.id))}
        onHideListing={() => {}}
        renderCard={(listing, isSelected) => (
          <div key={listing.id} style={{ position: 'relative' }}>
            <ListingCard
              listing={listing}
              isSelected={isSelected}
              isFavorited={true}
              isHiding={false}
              onClick={() => setSelectedId(listing.id === selectedId ? null : listing.id)}
              onStarClick={() => {}}
              onExpand={() => {}}
              onHide={() => {}}
            />
            {/* Remove overlay button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRemoveListing(listing.id);
              }}
              title="Remove from wishlist"
              aria-label="Remove from wishlist"
              style={{
                position: 'absolute',
                top: '8px',
                right: '8px',
                zIndex: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                backgroundColor: 'rgba(15,17,23,0.85)',
                border: '1px solid #2d333b',
                color: '#8b949e',
                cursor: 'pointer',
                padding: 0,
                transition: 'color 150ms ease, background-color 150ms ease',
              }}
              onMouseEnter={(e) => {
                const btn = e.currentTarget;
                btn.style.color = '#f85149';
                btn.style.backgroundColor = 'rgba(248,81,73,0.15)';
              }}
              onMouseLeave={(e) => {
                const btn = e.currentTarget;
                btn.style.color = '#8b949e';
                btn.style.backgroundColor = 'rgba(15,17,23,0.85)';
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                <path d="M.22.22a.75.75 0 0 1 1.06 0L5 3.94 8.72.22a.75.75 0 1 1 1.06 1.06L6.06 5l3.72 3.72a.75.75 0 1 1-1.06 1.06L5 6.06 1.28 9.78A.75.75 0 0 1 .22 8.72L3.94 5 .22 1.28A.75.75 0 0 1 .22.22z" />
              </svg>
            </button>
          </div>
        )}
      />

      {/* Share modal */}
      {showShareModal && (
        <ShareWishlistModal
          wishlistId={wishlist.id}
          wishlistName={wishlist.name}
          shares={shares}
          onClose={() => setShowShareModal(false)}
          onSharesChanged={() => {
            queryClient.invalidateQueries({ queryKey: ['wishlist-detail', params.id] });
          }}
        />
      )}
    </>
  );
}
