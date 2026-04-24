'use client';

import { useEffect, useRef, useState } from 'react';
import { ButtonBase, PrimaryButton, TextButton } from '@/components/ui';
import type { Wishlist } from '@/lib/hooks/useWishlists';

interface ManageWishlistsModalProps {
  myWishlists: Wishlist[];
  sharedWishlists: Wishlist[];
  currentUserEmail: string | null;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAddShare: (wishlistId: string, email: string, permission: 'viewer' | 'editor') => Promise<void>;
  onRemoveShare: (shareId: number) => Promise<void>;
  onUpdateSharePermission: (shareId: number, permission: 'viewer' | 'editor') => Promise<void>;
  onLeave: (wishlistId: string, email: string) => Promise<void>;
  onView: (wishlistId: string) => void;
}

export default function ManageWishlistsModal({
  myWishlists,
  sharedWishlists,
  currentUserEmail,
  onClose,
  onCreate,
  onRename,
  onDelete,
  onAddShare,
  onRemoveShare,
  onUpdateSharePermission,
  onLeave,
  onView,
}: ManageWishlistsModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [expandedShareId, setExpandedShareId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === overlayRef.current) onClose();
  }

  async function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      await onCreate(trimmed);
      setNewName('');
      setShowCreateInput(false);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-[2100] flex items-center justify-center sm:p-6"
      style={{
        background: 'rgba(0,0,0,0.72)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        className="flex flex-col overflow-hidden w-full sm:rounded-2xl sm:max-w-[600px] sm:max-h-[calc(100vh-120px)] h-full sm:h-auto"
        style={{
          background: '#161b22',
          border: '1px solid #2d333b',
          boxShadow: '0 24px 80px rgba(0,0,0,0.8)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between flex-shrink-0"
          style={{ padding: '16px 16px 14px', borderBottom: '1px solid #2d333b' }}
        >
          <div className="flex items-center gap-2 text-[16px] font-bold" style={{ color: '#e1e4e8' }}>
            <span
              className="flex items-center justify-center"
              style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                background: 'rgba(126,231,135,0.12)',
                border: '1px solid rgba(126,231,135,0.2)',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#7ee787">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </span>
            Manage Wishlists
          </div>
          <ButtonBase
            onClick={onClose}
            aria-label="Close"
            className="flex items-center justify-center"
            style={{
              width: 32,
              height: 32,
              borderRadius: 7,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid #2d333b',
              color: '#8b949e',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M2 2L11 11M11 2L2 11" />
            </svg>
          </ButtonBase>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* My wishlists */}
          {myWishlists.length > 0 && (
            <>
              <SectionLabel>Created by you ({myWishlists.length})</SectionLabel>
              {myWishlists.map((wl) => (
                <WishlistRow
                  key={wl.id}
                  wishlist={wl}
                  isOwner
                  isRenaming={renamingId === wl.id}
                  renameValue={renameValue}
                  onStartRename={() => {
                    setRenamingId(wl.id);
                    setRenameValue(wl.name);
                    setExpandedShareId(null);
                    setDeletingId(null);
                  }}
                  onChangeRenameValue={setRenameValue}
                  onCommitRename={async () => {
                    const trimmed = renameValue.trim();
                    if (trimmed && trimmed !== wl.name) {
                      await onRename(wl.id, trimmed);
                    }
                    setRenamingId(null);
                    setRenameValue('');
                  }}
                  onCancelRename={() => {
                    setRenamingId(null);
                    setRenameValue('');
                  }}
                  isShareExpanded={expandedShareId === wl.id}
                  onToggleShare={() => {
                    setExpandedShareId((prev) => (prev === wl.id ? null : wl.id));
                    setDeletingId(null);
                    setRenamingId(null);
                  }}
                  isDeleting={deletingId === wl.id}
                  onStartDelete={() => {
                    setDeletingId(wl.id);
                    setExpandedShareId(null);
                    setRenamingId(null);
                  }}
                  onConfirmDelete={async () => {
                    await onDelete(wl.id);
                    setDeletingId(null);
                  }}
                  onCancelDelete={() => setDeletingId(null)}
                  onAddShare={onAddShare}
                  onRemoveShare={onRemoveShare}
                  onUpdateSharePermission={onUpdateSharePermission}
                  onLeave={onLeave}
                  onView={onView}
                  currentUserEmail={currentUserEmail}
                />
              ))}
            </>
          )}

          {/* Shared with me */}
          {sharedWishlists.length > 0 && (
            <>
              <SectionLabel>Shared with you ({sharedWishlists.length})</SectionLabel>
              {sharedWishlists.map((wl) => (
                <WishlistRow
                  key={wl.id}
                  wishlist={wl}
                  isOwner={false}
                  isRenaming={false}
                  renameValue=""
                  onStartRename={() => {}}
                  onChangeRenameValue={() => {}}
                  onCommitRename={async () => {}}
                  onCancelRename={() => {}}
                  isShareExpanded={false}
                  onToggleShare={() => {}}
                  isDeleting={false}
                  onStartDelete={() => {}}
                  onConfirmDelete={async () => {}}
                  onCancelDelete={() => {}}
                  onAddShare={onAddShare}
                  onRemoveShare={onRemoveShare}
                  onUpdateSharePermission={onUpdateSharePermission}
                  onLeave={onLeave}
                  onView={onView}
                  currentUserEmail={currentUserEmail}
                />
              ))}
            </>
          )}

          {/* New wishlist row (always at the bottom of the list) */}
          {showCreateInput ? (
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #2d333b' }}>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate();
                    if (e.key === 'Escape') {
                      setNewName('');
                      setShowCreateInput(false);
                    }
                  }}
                  autoFocus
                  placeholder="Wishlist name..."
                  className="flex-1 outline-none"
                  style={{
                    background: '#0d1117',
                    border: '1px solid rgba(126,231,135,0.4)',
                    borderRadius: 7,
                    padding: '10px 12px',
                    fontSize: 14,
                    color: '#e1e4e8',
                  }}
                />
                <div className="flex gap-2">
                  <PrimaryButton
                    onClick={handleCreate}
                    disabled={!newName.trim() || creating}
                    loading={creating}
                    className="text-[13px] font-semibold flex-1 sm:flex-initial"
                  >
                    Create
                  </PrimaryButton>
                  <TextButton
                    variant="muted"
                    onClick={() => {
                      setNewName('');
                      setShowCreateInput(false);
                    }}
                    className="text-[13px]"
                  >
                    Cancel
                  </TextButton>
                </div>
              </div>
            </div>
          ) : (
            <ButtonBase
              onClick={() => setShowCreateInput(true)}
              className="w-full flex items-center justify-center gap-2 text-[13px] font-medium"
              style={{
                margin: '12px 16px 16px',
                width: 'calc(100% - 32px)',
                padding: '14px 12px',
                border: '1.5px dashed #30363d',
                borderRadius: 9,
                background: 'transparent',
                color: '#8b949e',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New wishlist
            </ButtonBase>
          )}

          {myWishlists.length === 0 && sharedWishlists.length === 0 && !showCreateInput && (
            <div
              className="py-4 text-center text-[13px]"
              style={{ color: '#8b949e' }}
            >
              No wishlists yet. Tap &ldquo;New wishlist&rdquo; to create one.
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between gap-3 flex-shrink-0"
          style={{
            padding: '12px 16px',
            borderTop: '1px solid #2d333b',
            background: '#161b22',
          }}
        >
          <span className="text-[11px] hidden sm:block" style={{ color: '#6e7681' }}>
            Collaborators with &ldquo;Editor&rdquo; access can add and remove listings.
          </span>
          <PrimaryButton onClick={onClose} className="text-[13px] sm:flex-initial flex-1">
            Done
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[11px] font-semibold uppercase"
      style={{
        padding: '14px 16px 6px',
        color: '#6e7681',
        letterSpacing: '0.07em',
      }}
    >
      {children}
    </div>
  );
}

interface WishlistRowProps {
  wishlist: Wishlist;
  isOwner: boolean;
  currentUserEmail: string | null;
  isRenaming: boolean;
  renameValue: string;
  onStartRename: () => void;
  onChangeRenameValue: (v: string) => void;
  onCommitRename: () => Promise<void>;
  onCancelRename: () => void;
  isShareExpanded: boolean;
  onToggleShare: () => void;
  isDeleting: boolean;
  onStartDelete: () => void;
  onConfirmDelete: () => Promise<void>;
  onCancelDelete: () => void;
  onAddShare: (wishlistId: string, email: string, permission: 'viewer' | 'editor') => Promise<void>;
  onRemoveShare: (shareId: number) => Promise<void>;
  onUpdateSharePermission: (shareId: number, permission: 'viewer' | 'editor') => Promise<void>;
  onLeave: (wishlistId: string, email: string) => Promise<void>;
  onView: (wishlistId: string) => void;
}

function WishlistRow({
  wishlist,
  isOwner,
  currentUserEmail,
  isRenaming,
  renameValue,
  onStartRename,
  onChangeRenameValue,
  onCommitRename,
  onCancelRename,
  isShareExpanded,
  onToggleShare,
  isDeleting,
  onStartDelete,
  onConfirmDelete,
  onCancelDelete,
  onAddShare,
  onRemoveShare,
  onUpdateSharePermission,
  onLeave,
  onView,
}: WishlistRowProps) {
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePermission, setInvitePermission] = useState<'viewer' | 'editor'>('editor');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const itemCount = wishlist.wishlist_items.length;
  const shareCount = wishlist.wishlist_shares.length;

  async function handleInvite() {
    const email = inviteEmail.trim();
    if (!email || inviting) return;
    setInviting(true);
    setInviteError(null);
    try {
      await onAddShare(wishlist.id, email, invitePermission);
      setInviteEmail('');
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : 'Failed to invite');
    } finally {
      setInviting(false);
    }
  }

  return (
    <div style={{ borderBottom: '1px solid #2d333b' }}>
      <div className="flex items-center gap-3" style={{ padding: '14px 16px' }}>
        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="text-[14px] font-semibold truncate"
              style={{ color: '#e1e4e8' }}
            >
              {wishlist.name}
            </span>
            {!isOwner && (() => {
              const myShare = wishlist.wishlist_shares[0];
              const perm = myShare?.permission === 'editor' ? 'editor' : 'viewer';
              return (
                <span className="uppercase font-semibold text-[10px] flex-shrink-0" style={{
                  color: perm === 'editor' ? '#7ee787' : '#8b949e',
                  background: perm === 'editor' ? 'rgba(126,231,135,0.08)' : 'rgba(255,255,255,0.05)',
                  border: perm === 'editor' ? '1px solid rgba(126,231,135,0.2)' : '1px solid #2d333b',
                  padding: '2px 7px',
                  borderRadius: 4,
                  letterSpacing: '0.05em',
                }}>
                  {perm === 'editor' ? 'Editor' : 'Viewer'}
                </span>
              );
            })()}
          </div>
          <div className="flex items-center gap-2.5 mt-1">
            <span className="text-[12px]" style={{ color: '#8b949e' }}>
              {itemCount} listing{itemCount === 1 ? '' : 's'}
            </span>
            {isOwner && shareCount > 0 && (
              <span className="text-[11px]" style={{ color: '#6e7681' }}>
                Shared with {shareCount}
              </span>
            )}
            {!isOwner && wishlist.owner_email && (
              <span className="text-[11px] truncate" style={{ color: '#6e7681' }}>
                Shared by {wishlist.owner_email}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Primary View button */}
          <ButtonBase
            onClick={() => onView(wishlist.id)}
            className="flex items-center gap-1.5 font-semibold"
            style={{
              height: 32,
              padding: '0 12px',
              fontSize: 13,
              borderRadius: 7,
              background: 'rgba(126,231,135,0.1)',
              border: '1px solid #7ee787',
              color: '#7ee787',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            View
          </ButtonBase>
          {isOwner ? (
            <>
              <IconActionButton
                onClick={onStartRename}
                active={isRenaming}
                ariaLabel="Rename wishlist"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              </IconActionButton>
              <IconActionButton
                onClick={onToggleShare}
                active={isShareExpanded}
                ariaLabel="Share wishlist"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
              </IconActionButton>
              <IconActionButton
                onClick={onStartDelete}
                active={isDeleting}
                ariaLabel="Delete wishlist"
                danger
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </IconActionButton>
            </>
          ) : (
            <IconActionButton
              onClick={async () => {
                if (currentUserEmail) {
                  await onLeave(wishlist.id, currentUserEmail);
                }
              }}
              active={false}
              ariaLabel="Leave wishlist"
              danger
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </IconActionButton>
          )}
        </div>
      </div>

      {/* Rename panel */}
      {isRenaming && (
        <div
          className="flex items-center gap-2"
          style={{
            background: '#0d1117',
            borderTop: '1px solid #2d333b',
            padding: '10px 16px 12px',
          }}
        >
          <input
            value={renameValue}
            onChange={(e) => onChangeRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitRename();
              if (e.key === 'Escape') onCancelRename();
            }}
            autoFocus
            placeholder="Wishlist name..."
            className="flex-1 outline-none"
            style={{
              background: '#161b22',
              border: '1px solid rgba(88,166,255,0.4)',
              borderRadius: 7,
              padding: '7px 12px',
              fontSize: 13,
              color: '#e1e4e8',
            }}
          />
          <PrimaryButton onClick={onCommitRename} className="text-[12px] px-3">
            Save
          </PrimaryButton>
          <TextButton variant="muted" onClick={onCancelRename} className="text-[12px]">
            Cancel
          </TextButton>
        </div>
      )}

      {/* Delete confirm panel */}
      {isDeleting && (
        <div
          className="flex items-center gap-2.5"
          style={{
            background: 'rgba(248,81,73,0.04)',
            borderTop: '1px solid rgba(248,81,73,0.15)',
            padding: '10px 16px 12px',
          }}
        >
          <span className="flex-1 text-[12px]" style={{ color: '#f85149' }}>
            Delete &ldquo;{wishlist.name}&rdquo;? This will remove {itemCount} saved listing
            {itemCount === 1 ? '' : 's'} and cannot be undone.
          </span>
          <ButtonBase
            onClick={onConfirmDelete}
            className="text-[12px] font-semibold"
            style={{
              background: 'rgba(248,81,73,0.12)',
              border: '1px solid rgba(248,81,73,0.3)',
              color: '#f85149',
              borderRadius: 6,
              padding: '6px 12px',
            }}
          >
            Delete
          </ButtonBase>
          <TextButton variant="muted" onClick={onCancelDelete} className="text-[12px]">
            Cancel
          </TextButton>
        </div>
      )}

      {/* Share panel */}
      {isShareExpanded && isOwner && (
        <div
          style={{
            background: '#0d1117',
            borderTop: '1px solid #2d333b',
            padding: '14px 16px 16px',
          }}
        >
          <div
            className="mb-2.5 text-[12px] font-semibold uppercase"
            style={{ color: '#8b949e', letterSpacing: '0.05em' }}
          >
            Shared with
          </div>

          {/* Existing shares */}
          {wishlist.wishlist_shares.length === 0 ? (
            <div className="text-[12px]" style={{ color: '#6e7681' }}>
              Not shared yet.
            </div>
          ) : (
            wishlist.wishlist_shares.map((share) => (
              <div key={share.id ?? share.shared_with_email} className="flex items-center gap-2.5 py-1.5">
                <div
                  className="flex items-center justify-center flex-shrink-0 font-semibold"
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    background: 'rgba(88,166,255,0.2)',
                    color: '#58a6ff',
                    fontSize: 12,
                  }}
                >
                  {(share.shared_with_email[0] ?? '?').toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] truncate" style={{ color: '#e1e4e8' }}>
                    {share.shared_with_email}
                  </div>
                </div>
                <select
                  value={share.permission === 'editor' ? 'editor' : 'viewer'}
                  onChange={async (e) => {
                    if (share.id != null) {
                      await onUpdateSharePermission(share.id, e.target.value as 'viewer' | 'editor');
                    }
                  }}
                  className="outline-none cursor-pointer"
                  style={{
                    background: '#161b22',
                    border: '1px solid #2d333b',
                    color: '#e1e4e8',
                    borderRadius: 6,
                    padding: '5px 10px',
                    fontSize: 12,
                  }}
                >
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <ButtonBase
                  onClick={async () => {
                    if (share.id != null) await onRemoveShare(share.id);
                  }}
                  aria-label="Remove"
                  className="flex items-center justify-center"
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 5,
                    color: '#6e7681',
                    background: 'transparent',
                    border: 'none',
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M2 2L10 10M10 2L2 10" />
                  </svg>
                </ButtonBase>
              </div>
            ))
          )}

          {/* Invite row */}
          <div className="flex gap-2 mt-2.5">
            <input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleInvite();
              }}
              placeholder="Invite by email address..."
              className="flex-1 outline-none"
              style={{
                background: '#161b22',
                border: '1px solid #2d333b',
                borderRadius: 7,
                padding: '7px 12px',
                fontSize: 13,
                color: '#e1e4e8',
              }}
            />
            <select
              value={invitePermission}
              onChange={(e) => setInvitePermission(e.target.value as 'viewer' | 'editor')}
              className="outline-none cursor-pointer"
              style={{
                background: '#161b22',
                border: '1px solid #2d333b',
                color: '#e1e4e8',
                borderRadius: 7,
                padding: '7px 10px',
                fontSize: 12,
              }}
            >
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
            <PrimaryButton
              onClick={handleInvite}
              disabled={!inviteEmail.trim() || inviting}
              loading={inviting}
              className="text-[12px] font-semibold"
            >
              Invite
            </PrimaryButton>
          </div>
          {inviteError && (
            <div className="mt-2 text-[12px]" style={{ color: '#f85149' }}>
              {inviteError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IconActionButton({
  children,
  onClick,
  active,
  ariaLabel,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  ariaLabel: string;
  danger?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const activeColor = danger ? '#f85149' : '#8b949e';
  const color = active ? activeColor : '#8b949e';
  return (
    <ButtonBase
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex items-center justify-center"
      style={{
        width: 32,
        height: 32,
        borderRadius: 7,
        background: active
          ? danger
            ? 'rgba(248,81,73,0.1)'
            : 'rgba(255,255,255,0.08)'
          : hovered
          ? 'rgba(255,255,255,0.06)'
          : 'transparent',
        border: '1px solid transparent',
        color,
      }}
    >
      {children}
    </ButtonBase>
  );
}
