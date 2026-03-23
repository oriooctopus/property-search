'use client';

import type { ParsedFilter } from '@/lib/chat-types';

interface ChatMessageProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  parsedFilters?: ParsedFilter[];
  onReAddFilter?: (key: ParsedFilter['filterKey'], value: ParsedFilter['filterValue']) => void;
  listingCount?: number;
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0 mt-0.5">
      <circle cx="7" cy="7" r="7" fill="#7ee787" opacity="0.15" />
      <path d="M4 7.2L6 9.2L10 5" stroke="#7ee787" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M6 2V10M2 6H10" />
    </svg>
  );
}

function UserMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div
        className="max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm"
        style={{ backgroundColor: '#58a6ff', color: '#ffffff' }}
      >
        {content}
      </div>
    </div>
  );
}

function AssistantMessage({
  content,
  parsedFilters,
  onReAddFilter,
  listingCount,
}: {
  content: string;
  parsedFilters?: ParsedFilter[];
  onReAddFilter?: (key: ParsedFilter['filterKey'], value: ParsedFilter['filterValue']) => void;
  listingCount?: number;
}) {
  return (
    <div className="flex justify-start">
      <div
        className="max-w-[85%] rounded-2xl rounded-bl-sm px-4 py-3 text-sm"
        style={{
          backgroundColor: '#1c2028',
          border: '1px solid #2d333b',
          color: '#e1e4e8',
        }}
      >
        <p className="mb-2 leading-relaxed">{content}</p>

        {parsedFilters && parsedFilters.length > 0 && (
          <div className="flex flex-col gap-1.5 mt-3">
            {parsedFilters.map((filter) => (
              <button
                key={filter.filterKey}
                onClick={() => onReAddFilter?.(filter.filterKey, filter.filterValue)}
                className="flex items-center gap-2 text-left text-xs transition-colors hover:bg-white/5 rounded px-1.5 py-1 -mx-1.5 cursor-pointer"
                style={{ color: '#e1e4e8' }}
                title={`Click to re-add: ${filter.label}`}
              >
                <CheckIcon />
                <span>{filter.label}</span>
              </button>
            ))}
          </div>
        )}

        {listingCount !== undefined && (
          <div className="mt-3 pt-2" style={{ borderTop: '1px solid #2d333b' }}>
            <span
              className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{
                backgroundColor: 'rgba(88, 166, 255, 0.1)',
                color: '#58a6ff',
              }}
            >
              {listingCount} listing{listingCount !== 1 ? 's' : ''} match
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function SystemMessage({ content }: { content: string }) {
  return (
    <div className="flex justify-center">
      <p
        className="text-xs italic px-3 py-1"
        style={{ color: '#8b949e' }}
      >
        {content}
      </p>
    </div>
  );
}

export default function ChatMessage({
  role,
  content,
  parsedFilters,
  onReAddFilter,
  listingCount,
}: ChatMessageProps) {
  if (role === 'user') {
    return <UserMessage content={content} />;
  }
  if (role === 'assistant') {
    return (
      <AssistantMessage
        content={content}
        parsedFilters={parsedFilters}
        onReAddFilter={onReAddFilter}
        listingCount={listingCount}
      />
    );
  }
  return <SystemMessage content={content} />;
}
