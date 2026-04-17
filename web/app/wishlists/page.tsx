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
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const newInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (renamingId) {
      setTimeout(() => renameInputRef.current?.focus(), 50);
    }
  }, [renamingId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!openMenuId) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openMenuId]);

  const { data: wishlists, isLoading: wishlistsLoading } = useWishlists(userId);
  const { createWishlist, renameWishlist, deleteWishlist } = useWishlistMutations(userId);

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

  function startRename(id: string, currentName: string) {
    setOpenMenuId(null);
    setRenamingId(id);
    setRenameValue(currentName);
  }

  function commitRename(id: string) {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== wishlists?.find(w => w.id === id)?.name) {
      renameWishlist.mutate({ id, name: trimmed });
    }
    setRenamingId(null);
    setRenameValue('');
  }

  function handleRenameKeyDown(e: React.KeyboardEvent, id: string) {
    if (e.key === 'Enter') commitRename(id);
    if (e.key === 'Escape') {
      setRenamingId(null);
      setRenameValue('');
    }
  }

  function handleDelete(id: string) {
    setOpenMenuId(null);
    if (window.confirm('Delete this wishlist? This cannot be undone.')) {
      deleteWishlist.mutate(id);
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
              const isMenuOpen = openMenuId === wishlist.id;
              const isRenaming = renamingId === wishlist.id;

              return (
                <div key={wishlist.id} style={{ position: 'relative' }}>
                  <Link
                    href={`/wishlists/${wishlist.id}`}
                    style={{ textDecoration: 'none', display: 'block' }}
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', paddingRight: '28px' }}>
                        {isDefault && (
                          <span style={{ color: '#fbbf24', fontSize: '14px', flexShrink: 0 }}>★</span>
                        )}
                        {isRenaming ? (
                          <input
                            ref={renameInputRef}
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => handleRenameKeyDown(e, wishlist.id)}
                            onBlur={() => commitRename(wishlist.id)}
                            onClick={(e) => e.preventDefault()}
                            style={{
                              backgroundColor: '#0f1117',
                              border: '1px solid #58a6ff',
                              borderRadius: '4px',
                              padding: '2px 6px',
                              color: '#e1e4e8',
                              fontWeight: 600,
                              fontSize: '15px',
                              outline: 'none',
                              width: '100%',
                              boxSizing: 'border-box',
                            }}
                          />
                        ) : (
                          <span style={{ color: '#e1e4e8', fontWeight: 600, fontSize: '15px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {wishlist.name}
                          </span>
                        )}
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

                  {/* Three-dot menu button — sits outside the Link */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId(isMenuOpen ? null : wishlist.id);
                    }}
                    style={{
                      position: 'absolute',
                      top: '12px',
                      right: '12px',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: isMenuOpen ? '#e1e4e8' : '#8b949e',
                      fontSize: '16px',
                      lineHeight: 1,
                      padding: '2px 4px',
                      borderRadius: '4px',
                      transition: 'color 150ms ease',
                      zIndex: 2,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = '#e1e4e8'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = isMenuOpen ? '#e1e4e8' : '#8b949e'; }}
                    aria-label="Wishlist options"
                  >
                    ⋯
                  </button>

                  {/* Dropdown menu */}
                  {isMenuOpen && (
                    <div
                      ref={menuRef}
                      style={{
                        position: 'absolute',
                        top: '36px',
                        right: '8px',
                        backgroundColor: '#1c2028',
                        border: '1px solid #2d333b',
                        borderRadius: '8px',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                        zIndex: 100,
                        minWidth: '148px',
                        overflow: 'hidden',
                      }}
                    >
                      {/* Rename */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startRename(wishlist.id, wishlist.name);
                        }}
                        style={menuItemStyle}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#2d333b'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                        Rename
                      </button>

                      {/* Share */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenMenuId(null);
                          router.push(`/wishlists/${wishlist.id}`);
                        }}
                        style={menuItemStyle}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#2d333b'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                        </svg>
                        Share
                      </button>

                      {/* Delete — hidden for Favorites */}
                      {!isDefault && (
                        <>
                          <div style={{ borderTop: '1px solid #2d333b', margin: '4px 0' }} />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(wishlist.id);
                            }}
                            style={{ ...menuItemStyle, color: '#f85149' }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#2d333b'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'; }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f85149" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                              <path d="M10 11v6" />
                              <path d="M14 11v6" />
                              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                            </svg>
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
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

const menuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  width: '100%',
  padding: '8px 12px',
  background: 'transparent',
  border: 'none',
  color: '#c9d1d9',
  fontSize: '13px',
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'background-color 150ms ease',
  boxSizing: 'border-box',
};
