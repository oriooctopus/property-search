'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PrimaryButton, TextButton } from '@/components/ui';

interface SaveSearchModalProps {
  suggestedName: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}

export default function SaveSearchModal({
  suggestedName,
  onSave,
  onCancel,
}: SaveSearchModalProps) {
  const [name, setName] = useState(suggestedName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleSave = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
  }, [name, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSave();
      }
      if (e.key === 'Escape') {
        onCancel();
      }
    },
    [handleSave, onCancel],
  );

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[1500]"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
        onClick={onCancel}
      />

      {/* Modal */}
      <div
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[1600] w-[90%] max-w-sm rounded-xl p-5"
        style={{
          backgroundColor: '#1c2028',
          border: '1px solid #2d333b',
          boxShadow: '0 16px 48px rgba(0, 0, 0, 0.5)',
        }}
      >
        <h3 className="text-base font-semibold mb-4" style={{ color: '#e1e4e8' }}>
          Name this search
        </h3>

        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g. Brooklyn 5-bed hunt"
          className="w-full rounded-lg px-3 py-2.5 text-sm outline-none mb-5"
          style={{
            backgroundColor: '#0f1117',
            border: '1px solid #2d333b',
            color: '#e1e4e8',
          }}
        />

        <div className="flex items-center justify-end gap-3">
          <TextButton variant="muted" onClick={onCancel}>
            Cancel
          </TextButton>
          <PrimaryButton
            onClick={handleSave}
            disabled={!name.trim()}
            className="h-9 px-6 text-sm font-bold"
          >
            Save
          </PrimaryButton>
        </div>
      </div>
    </>
  );
}
