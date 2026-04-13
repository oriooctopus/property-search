'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getLastUsedWishlistId } from '@/lib/wishlist-storage';

interface WishlistPickerProps {
  listingId: number;
  wishlists: Array<{
    id: string;
    name: string;
    wishlist_items: Array<{ listing_id: number }>;
  }>;
  onToggle: (wishlistId: string, checked: boolean) => void;
  onCreateNew: (name: string) => void;
  onClose: () => void;
  anchorRect: DOMRect | null;
}

export default function WishlistPicker({
  listingId,
  wishlists,
  onToggle,
  onCreateNew,
  onClose,
  anchorRect,
}: WishlistPickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null);
  const [showInput, setShowInput] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const isInAnyWishlist = wishlists.some((wl) =>
    wl.wishlist_items.some((item) => item.listing_id === listingId),
  );
  const lastUsedId = getLastUsedWishlistId();

  // Click-outside — ignore clicks on map popups / leaflet elements
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        const target = e.target as HTMLElement;
        // Don't close if clicking inside a Leaflet popup or map control
        if (target.closest('.leaflet-popup') || target.closest('.leaflet-control')) return;
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (showInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showInput]);

  // Position
  let top = 0;
  let left = 0;
  const PICKER_WIDTH = 200;

  if (anchorRect) {
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    if (spaceBelow >= 180 || spaceBelow >= anchorRect.top) {
      top = anchorRect.bottom + 6;
    } else {
      top = anchorRect.top - 180 - 6;
    }
    left = Math.max(8, Math.min(anchorRect.right - PICKER_WIDTH, window.innerWidth - PICKER_WIDTH - 8));
  }

  const content = (
    <div
      ref={pickerRef}
      style={{
        position: 'fixed',
        top,
        left,
        backgroundColor: '#1c2028',
        border: '1px solid #3d444d',
        borderRadius: '10px',
        boxShadow: '0 12px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
        padding: '10px',
        width: `${PICKER_WIDTH}px`,
        zIndex: 1350,
      }}
    >
      {/* Header */}
      <div style={{
        color: '#8b949e',
        fontSize: '11px',
        fontWeight: 600,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.5px',
        marginBottom: '8px',
        paddingLeft: '2px',
      }}>
        Save to
      </div>

      {/* Wishlist list */}
      {wishlists.length === 0 ? (
        <div style={{ color: '#8b949e', fontSize: '12px', marginBottom: '8px', paddingLeft: '2px' }}>
          No wishlists yet
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', marginBottom: '8px' }}>
          {wishlists.map((wl) => {
            const isChecked = wl.wishlist_items.some((item) => item.listing_id === listingId)
              || (!isInAnyWishlist && wl.id === lastUsedId);
            return (
              <label
                key={wl.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  padding: '5px 6px',
                  borderRadius: '6px',
                  transition: 'background-color 100ms',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
              >
                {/* Custom checkbox */}
                <div
                  style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '4px',
                    border: isChecked ? 'none' : '1.5px solid #484f58',
                    backgroundColor: isChecked ? '#58a6ff' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'all 100ms',
                  }}
                >
                  {isChecked && (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path d="M2.5 6L5 8.5L9.5 3.5" stroke="#0f1117" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={(e) => {
                    onToggle(wl.id, e.target.checked);
                    onClose();
                  }}
                  style={{ display: 'none' }}
                />
                <span style={{
                  color: '#e1e4e8',
                  fontSize: '13px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>{wl.name}</span>
              </label>
            );
          })}
        </div>
      )}

      {/* Divider */}
      <div style={{ height: '1px', backgroundColor: '#2d333b', margin: '4px 0 6px' }} />

      {showInput ? (
        <div style={{ display: 'flex', gap: '4px' }}>
          <input
            ref={inputRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newName.trim()) {
                onCreateNew(newName.trim());
                setNewName('');
                setShowInput(false);
              } else if (e.key === 'Escape') {
                setShowInput(false);
                setNewName('');
              }
            }}
            placeholder="Name"
            style={{
              flex: 1,
              backgroundColor: '#0f1117',
              border: '1px solid #3d444d',
              borderRadius: '5px',
              color: '#e1e4e8',
              fontSize: '12px',
              padding: '4px 8px',
              outline: 'none',
              minWidth: 0,
            }}
          />
          <button
            onClick={() => {
              if (newName.trim()) {
                onCreateNew(newName.trim());
                setNewName('');
                setShowInput(false);
              }
            }}
            style={{
              backgroundColor: '#fbbf24',
              color: '#0f1117',
              border: 'none',
              borderRadius: '5px',
              fontSize: '11px',
              fontWeight: 600,
              padding: '4px 10px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Add
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowInput(true)}
          style={{
            color: '#58a6ff',
            fontSize: '12px',
            background: 'none',
            border: 'none',
            padding: '2px 6px',
            cursor: 'pointer',
            borderRadius: '4px',
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(88,166,255,0.08)'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
        >
          + New list
        </button>
      )}
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(content, document.body);
}
