'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="5" />
      <path d="M11 11L14 14" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2.5 8L13.5 2.5L8 13.5L7 9L2.5 8Z" fill="currentColor" stroke="currentColor" strokeWidth="0.8" strokeLinejoin="round" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="animate-spin">
      <circle cx="8" cy="8" r="6" stroke="#3d444d" strokeWidth="2" />
      <path d="M8 2a6 6 0 0 1 6 6" stroke="#58a6ff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

interface AISearchBarProps {
  onSearch: (query: string) => void;
  isLoading: boolean;
  lastQuery?: string | null;
  isLoggedIn?: boolean;
}

export default function AISearchBar({ onSearch, isLoading, lastQuery, isLoggedIn = true }: AISearchBarProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleSubmit = useCallback(() => {
    const value = input.trim();
    if (!value || isLoading) return;
    onSearch(value);
    setInput('');
  }, [input, isLoading, onSearch]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div className="px-3 pt-2 pb-1.5" style={{ backgroundColor: '#1c2028' }}>
      <div
        className="flex items-center gap-2 rounded-lg px-3 py-2 transition-colors"
        style={{
          backgroundColor: '#0f1117',
          border: '1px solid #3d444d',
        }}
      >
        <span style={{ color: '#8b949e' }} className="shrink-0">
          <SearchIcon />
        </span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (!isLoggedIn) {
              inputRef.current?.blur();
              router.push('/auth/login');
            }
          }}
          placeholder={isLoggedIn ? 'Search apartments with AI...' : 'Log in to search with AI...'}
          disabled={isLoading}
          readOnly={!isLoggedIn}
          className={`flex-1 bg-transparent text-sm outline-none placeholder:text-[#6e7681] ${!isLoggedIn ? 'cursor-pointer' : ''}`}
          style={{ color: '#e1e4e8', minHeight: '22px' }}
        />
        {isLoading ? (
          <span className="shrink-0 p-1">
            <SpinnerIcon />
          </span>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!input.trim()}
            className="shrink-0 rounded-md min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors cursor-pointer disabled:opacity-20 disabled:cursor-not-allowed"
            style={{
              backgroundColor: input.trim() ? '#58a6ff' : 'transparent',
              color: input.trim() ? '#0f1117' : '#8b949e',
            }}
            aria-label="Search"
          >
            <SendIcon />
          </button>
        )}
      </div>
      {lastQuery && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px]" style={{ color: '#8b949e' }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
            <path d="M5 1v4l2.5 1.5" />
            <circle cx="5" cy="5" r="4" />
          </svg>
          <span className="truncate">AI searched: &ldquo;{lastQuery}&rdquo;</span>
        </div>
      )}
    </div>
  );
}
