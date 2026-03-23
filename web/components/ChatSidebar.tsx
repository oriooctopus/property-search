'use client';

import { useState } from 'react';
import type { ConversationSummary } from '@/lib/chat-types';

interface ChatSidebarProps {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewSearch: () => void;
}

function formatTimestamp(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + '...';
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M7 2V12M2 7H12" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 6H17M3 10H17M3 14H17" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M4 4L14 14M14 4L4 14" />
    </svg>
  );
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
}: {
  conversation: ConversationSummary;
  isActive: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className="w-full text-left px-3 py-2.5 rounded-lg transition-colors cursor-pointer"
      style={{
        backgroundColor: isActive ? 'rgba(88, 166, 255, 0.08)' : 'transparent',
        borderLeft: isActive ? '2px solid #58a6ff' : '2px solid transparent',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="text-sm font-medium truncate"
          style={{ color: isActive ? '#58a6ff' : '#e1e4e8' }}
        >
          {conversation.name || truncate(conversation.firstMessage, 40)}
        </span>
      </div>
      <span className="text-[10px] mt-0.5 block" style={{ color: '#8b949e' }}>
        {formatTimestamp(conversation.updatedAt)}
      </span>
    </button>
  );
}

function SidebarContent({
  conversations,
  activeId,
  onSelect,
  onNewSearch,
}: ChatSidebarProps) {
  const saved = conversations.filter((c) => c.isSaved);
  const recent = conversations.filter((c) => !c.isSaved);

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: '#0f1117' }}>
      {/* New Search button */}
      <div className="px-3 pt-3 pb-2">
        <button
          onClick={onNewSearch}
          className="w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors hover:bg-[#58a6ff]/10 cursor-pointer"
          style={{
            color: '#58a6ff',
            border: '1px solid #2d333b',
          }}
        >
          <PlusIcon />
          New Search
        </button>
      </div>

      {/* Scrollable conversation list */}
      <div className="flex-1 overflow-y-auto min-h-0 px-2 pb-3">
        {saved.length > 0 && (
          <div className="mb-3">
            <div
              className="text-[10px] font-bold uppercase tracking-wider px-3 py-2"
              style={{ color: '#8b949e' }}
            >
              Saved
            </div>
            <div className="flex flex-col gap-0.5">
              {saved.map((c) => (
                <ConversationItem
                  key={c.id}
                  conversation={c}
                  isActive={c.id === activeId}
                  onSelect={() => onSelect(c.id)}
                />
              ))}
            </div>
          </div>
        )}

        {recent.length > 0 && (
          <div>
            <div
              className="text-[10px] font-bold uppercase tracking-wider px-3 py-2"
              style={{ color: '#8b949e' }}
            >
              Recent
            </div>
            <div className="flex flex-col gap-0.5">
              {recent.map((c) => (
                <ConversationItem
                  key={c.id}
                  conversation={c}
                  isActive={c.id === activeId}
                  onSelect={() => onSelect(c.id)}
                />
              ))}
            </div>
          </div>
        )}

        {conversations.length === 0 && (
          <div className="text-center py-8">
            <p className="text-xs" style={{ color: '#8b949e' }}>
              No conversations yet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatSidebar(props: ChatSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar */}
      <div
        className="hidden lg:flex flex-col shrink-0"
        style={{
          width: 240,
          borderRight: '1px solid #2d333b',
        }}
      >
        <SidebarContent {...props} />
      </div>

      {/* Mobile hamburger toggle */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-[70px] left-3 z-[1200] rounded-lg p-2 cursor-pointer"
        style={{
          backgroundColor: '#1c2028',
          border: '1px solid #2d333b',
          color: '#e1e4e8',
        }}
        aria-label="Open search history"
      >
        <MenuIcon />
      </button>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 z-[1300]"
            style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
            onClick={() => setMobileOpen(false)}
          />
          <div
            className="lg:hidden fixed inset-y-0 left-0 z-[1400] flex flex-col"
            style={{
              width: 280,
              borderRight: '1px solid #2d333b',
              backgroundColor: '#0f1117',
            }}
          >
            <div className="flex items-center justify-between px-3 py-3" style={{ borderBottom: '1px solid #2d333b' }}>
              <span className="text-sm font-semibold" style={{ color: '#e1e4e8' }}>
                Searches
              </span>
              <button
                onClick={() => setMobileOpen(false)}
                className="rounded p-1 transition-colors hover:bg-white/5 cursor-pointer"
                style={{ color: '#8b949e' }}
                aria-label="Close sidebar"
              >
                <CloseIcon />
              </button>
            </div>
            <SidebarContent
              {...props}
              onSelect={(id) => {
                props.onSelect(id);
                setMobileOpen(false);
              }}
              onNewSearch={() => {
                props.onNewSearch();
                setMobileOpen(false);
              }}
            />
          </div>
        </>
      )}
    </>
  );
}
