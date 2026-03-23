'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FiltersState } from '@/components/Filters';
import type { ChatMessageData, ParsedFilter } from '@/lib/chat-types';
import ChatMessage from '@/components/ChatMessage';
import FilterPills from '@/components/FilterPills';
import { PrimaryButton } from '@/components/ui';

const EXAMPLE_PROMPTS = [
  '5+ bedrooms near the L train',
  'Brooklyn under $2k/bed',
  'Manhattan with 3+ baths',
  '6 beds under $10k total',
  'Near Fulton St, listed this week',
];

interface ChatPanelProps {
  messages: ChatMessageData[];
  filters: FiltersState;
  onSendMessage: (text: string) => void;
  onRemoveFilter: (filterKey: keyof FiltersState) => void;
  onReAddFilter: (key: ParsedFilter['filterKey'], value: ParsedFilter['filterValue']) => void;
  onSaveSearch: () => void;
  isLoading: boolean;
  listingCount: number;
  conversationName?: string | null;
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div
        className="rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5"
        style={{ backgroundColor: '#1c2028', border: '1px solid #2d333b' }}
      >
        <span className="w-2 h-2 rounded-full bg-[#8b949e] animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-2 h-2 rounded-full bg-[#8b949e] animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-2 h-2 rounded-full bg-[#8b949e] animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M3 9L15 3L9 15L8 10L3 9Z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

export default function ChatPanel({
  messages,
  filters,
  onSendMessage,
  onRemoveFilter,
  onReAddFilter,
  onSaveSearch,
  isLoading,
  listingCount,
  conversationName,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  const handleSubmit = useCallback(
    (text?: string) => {
      const value = (text ?? input).trim();
      if (!value || isLoading) return;
      onSendMessage(value);
      setInput('');
      inputRef.current?.focus();
    },
    [input, isLoading, onSendMessage],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const isEmpty = messages.length === 0;

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: '#0f1117' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 shrink-0"
        style={{ borderBottom: '1px solid #2d333b' }}
      >
        <h2 className="text-sm font-semibold truncate" style={{ color: '#e1e4e8' }}>
          {conversationName || 'New Search'}
        </h2>
        {messages.length > 0 && (
          <button
            onClick={onSaveSearch}
            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-white/5 cursor-pointer"
            style={{ color: '#58a6ff', border: '1px solid #2d333b' }}
          >
            Save Search
          </button>
        )}
      </div>

      {/* Filter pills */}
      <FilterPills filters={filters} onRemoveFilter={onRemoveFilter} />

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full gap-6">
            <div className="text-center">
              <h3 className="text-lg font-semibold mb-2" style={{ color: '#e1e4e8' }}>
                What are you looking for?
              </h3>
              <p className="text-sm" style={{ color: '#8b949e' }}>
                Describe your ideal apartment and I will find matching listings.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-md">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleSubmit(prompt)}
                  className="text-xs px-3 py-2 rounded-full transition-colors hover:bg-[#58a6ff]/10 cursor-pointer"
                  style={{
                    color: '#58a6ff',
                    border: '1px solid #2d333b',
                    backgroundColor: 'transparent',
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                role={msg.role}
                content={msg.content}
                parsedFilters={msg.parsedFilters}
                onReAddFilter={onReAddFilter}
                listingCount={msg.listingCount}
              />
            ))}
            {isLoading && <TypingIndicator />}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div
        className="shrink-0 px-4 py-3"
        style={{ borderTop: '1px solid #2d333b' }}
      >
        <div
          className="flex items-center gap-2 rounded-xl px-3 py-2"
          style={{
            backgroundColor: '#1c2028',
            border: '1px solid #2d333b',
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your search..."
            disabled={isLoading}
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-[#8b949e]"
            style={{ color: '#e1e4e8' }}
          />
          <button
            onClick={() => handleSubmit()}
            disabled={!input.trim() || isLoading}
            className="shrink-0 rounded-lg p-2 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              backgroundColor: input.trim() ? '#58a6ff' : 'transparent',
              color: input.trim() ? '#0f1117' : '#8b949e',
            }}
            aria-label="Send message"
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
